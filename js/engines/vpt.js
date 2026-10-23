/* Virtualised address translation engine: how a guest virtual address becomes a host physical address.
   Pure logic, no DOM. Three methods are modelled and costed in MEMORY REFERENCES:

   native  one page table, g levels:      a TLB miss costs g references to walk the table.
   shadow  the hypervisor keeps a COMBINED table (guest virtual -> host physical) that the hardware walks, so a miss is
           still g references; but every change the guest makes to its own page table, and every context switch, must be
           intercepted (a "VM exit"), and the first touch of a page faults into the hypervisor to build the entry.
   nested  (Intel EPT / AMD NPT) the hardware walks TWO tables: guest (g levels) and host (h levels). Every guest-table
           pointer is a guest-physical address that itself needs a host walk, so a miss costs (g+1)(h+1)-1 references,
           but the guest edits its tables freely with no exits.

   "Cost" below is: walk references + the data access itself (1) + exits x exitCost. The exit cost is an adjustable
   teaching constant, not a measured number. Simplifications (also shown in the lab): one guest address space,
   no huge pages, no page-walk caches, no paging-structure caches, every page is already present in guest memory. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { minLevels: 1, maxLevels: 5, maxEvents: 200, maxRepeat: 50, maxTlb: 16, maxExit: 100000 };

  const METHODS = [
    { id: 'native', name: 'Native (no virtualisation)', short: 'Native', hook: 'One table, one walk.' },
    { id: 'shadow', name: 'Shadow page tables', short: 'Shadow', hook: 'Fast walk, slow edits: the hypervisor spies on every guest page-table change.' },
    { id: 'nested', name: 'Nested paging (EPT / NPT)', short: 'Nested', hook: 'Hardware does a walk inside a walk: slow miss, free edits.' }
  ];
  const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));

  // walkRefs(method, g, h): memory references to translate ONE address on a TLB miss, not counting the data access.
  // Nested is a grid: each of the g guest levels, plus the final guest-physical address, needs an h-level host walk,
  // and each of the g guest entries must be read: (g+1)*h host reads + g guest reads = (g+1)(h+1)-1.
  function walkRefs(method, g, h) {
    if (method === 'nested') return (g + 1) * (h + 1) - 1;
    return g;
  }

  // nestedGrid(g, h): the numbered steps of the two-dimensional walk, row by row.
  // Row r (0..g) translates the guest-physical address that guest level r points at (row 0: the guest root).
  // Columns 0..h-1 are host levels; column h is the guest entry itself (absent in the last row, which ends at the data).
  function nestedGrid(g, h) {
    const cells = []; let n = 0;
    for (let r = 0; r <= g; r++) for (let c = 0; c <= h; c++) {
      if (r === g && c === h) continue; // the last cell is the data access, counted separately
      n++; cells.push({ n, row: r, col: c, kind: c < h ? 'host' : 'guest' });
    }
    return cells;
  }

  // parseEvents(text): lines "access P", "map P", "switch", with an optional "x N" repeat. # starts a comment.
  function parseEvents(text) {
    const errors = [], events = [];
    String(text || '').split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const m = /^(access|map|switch)(?:\s+([A-Za-z0-9_]{1,8}))?(?:\s+x\s*(\d+))?$/i.exec(line);
      if (!m) { errors.push('Line ' + (i + 1) + ': "' + raw.trim() + '" is not understood. Use: access PAGE, map PAGE, switch (optionally "x 3" to repeat).'); return; }
      const op = m[1].toLowerCase(), page = m[2] || null, rep = m[3] ? +m[3] : 1;
      if (op !== 'switch' && !page) { errors.push('Line ' + (i + 1) + ': "' + op + '" needs a page name, e.g. "' + op + ' A".'); return; }
      if (op === 'switch' && page) { errors.push('Line ' + (i + 1) + ': "switch" takes no page name.'); return; }
      if (rep < 1 || rep > LIMITS.maxRepeat) { errors.push('Line ' + (i + 1) + ': repeat must be 1-' + LIMITS.maxRepeat + '.'); return; }
      for (let k = 0; k < rep; k++) events.push({ op, page, line: i + 1 });
    });
    if (events.length > LIMITS.maxEvents) errors.push('Too many events (' + events.length + '); the limit is ' + LIMITS.maxEvents + '.');
    if (!events.length && !errors.length) errors.push('Type at least one event, for example "access A".');
    return { ok: !errors.length, events, errors };
  }

  function normCfg(cfg) {
    const c = Object.assign({ method: 'nested', g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 }, cfg || {});
    const errors = [];
    const num = (k, lo, hi, label) => { const v = Number(c[k]); if (!Number.isInteger(v) || v < lo || v > hi) errors.push(label + ' must be a whole number from ' + lo + ' to ' + hi + '.'); c[k] = v; };
    num('g', LIMITS.minLevels, LIMITS.maxLevels, 'Guest levels'); num('h', LIMITS.minLevels, LIMITS.maxLevels, 'Host levels');
    num('tlbSize', 1, LIMITS.maxTlb, 'TLB size'); num('exitCost', 0, LIMITS.maxExit, 'VM-exit cost');
    if (!METHOD_BY_ID[c.method]) errors.push('Unknown method "' + c.method + '".');
    c.tlb = !!c.tlb;
    return { cfg: c, errors };
  }

  // run(cfg, events): replay the events under one method. Returns frames (one per event, plus a start frame) and totals.
  function run(cfgIn, events) {
    const { cfg, errors } = normCfg(cfgIn);
    if (errors.length) return { ok: false, errors };
    const { method, g, h } = cfg;
    let tlb = [];            // gVA pages cached, most recent first
    const shadow = new Set(); // pages the hypervisor has built a combined entry for
    const tot = { refs: 0, exits: 0, accesses: 0, hits: 0, misses: 0, maps: 0, switches: 0 };
    const snap = (e) => Object.assign({}, tot, { cost: tot.refs + tot.exits * cfg.exitCost });
    const frames = [{ kind: 'start', text: 'Cold start: the TLB is empty' + (method === 'shadow' ? ' and the hypervisor has built no shadow entries yet.' : '.'), refs: 0, exits: 0, tlb: [], shadow: [], totals: snap() }];
    const touchTlb = (p) => { tlb = [p].concat(tlb.filter((x) => x !== p)).slice(0, cfg.tlbSize); };

    events.forEach((ev) => {
      let refs = 0, exits = 0, kind = ev.op, outcome = '', text = '', grid = null;
      if (ev.op === 'access') {
        tot.accesses++;
        if (cfg.tlb && tlb.includes(ev.page)) {
          tot.hits++; refs = 1; outcome = 'tlb-hit'; touchTlb(ev.page);
          text = 'TLB hit on ' + ev.page + ': the translation is cached, so only the data access itself is needed (1 reference).';
        } else {
          tot.misses++;
          const walk = walkRefs(method, g, h);
          if (method === 'native') {
            refs = walk + 1; outcome = 'walk';
            text = (cfg.tlb ? 'TLB miss' : 'No TLB') + ' on ' + ev.page + ': walk the ' + g + '-level page table (' + g + ' references), then the data access (1) = ' + refs + '.';
          } else if (method === 'nested') {
            refs = walk + 1; outcome = 'walk'; grid = nestedGrid(g, h);
            text = (cfg.tlb ? 'TLB miss' : 'No TLB') + ' on ' + ev.page + ': two-dimensional walk, (' + g + '+1) x (' + h + '+1) - 1 = ' + walk + ' references, plus the data access (1) = ' + refs + '.';
          } else if (shadow.has(ev.page)) {
            refs = walk + 1; outcome = 'walk';
            text = (cfg.tlb ? 'TLB miss' : 'No TLB') + ' on ' + ev.page + ': the hardware walks the hypervisor\'s shadow table (' + g + ' references) straight to host memory, then the data access (1) = ' + refs + '.';
          } else {
            exits = 1; outcome = 'shadow-fault'; shadow.add(ev.page);
            refs = g + h + walk + 1; // hypervisor reads the guest table (g) and host table (h), then the retried walk and data access
            text = 'Shadow miss on ' + ev.page + ': the shadow table has no entry, so the hardware faults into the hypervisor (a VM exit). It reads the guest table (' + g + ') and the host table (' + h + '), installs the combined entry, and the access retries: walk ' + walk + ' + data 1. Total ' + refs + ' references + 1 exit.';
          }
          if (cfg.tlb) touchTlb(ev.page);
        }
      } else if (ev.op === 'map') {
        tot.maps++; tlb = tlb.filter((x) => x !== ev.page); refs = 1;
        if (method === 'shadow') { exits = 1; shadow.delete(ev.page); outcome = 'trapped-write'; text = 'The guest edits its page-table entry for ' + ev.page + '. The hypervisor had write-protected that table, so the write traps (a VM exit); it emulates the write (1 reference) and discards the stale shadow entry and TLB entry.'; }
        else { outcome = 'free-write'; text = 'The guest edits its page-table entry for ' + ev.page + ' (1 write) and invalidates its TLB entry. ' + (method === 'nested' ? 'No exit: the hypervisor is not involved, the hardware simply walks the new table next time.' : 'Nothing else to do.'); }
      } else {
        tot.switches++; tlb = [];
        if (method === 'shadow') { exits = 1; refs = 1; outcome = 'trapped-cr3'; text = 'The guest switches process by writing the page-table base register. The hypervisor must trap it (a VM exit) to point the hardware at the matching shadow table. The TLB is flushed. (Shadow entries are kept per guest table, modelled here as retained.)'; }
        else { outcome = 'flush'; text = 'Context switch: the page-table base register changes and the TLB is flushed (no address-space tags in this model).' + (method === 'nested' ? ' No exit.' : ''); }
      }
      tot.refs += refs; tot.exits += exits;
      frames.push({ kind, outcome, line: ev.line, page: ev.page, text, refs, exits, cost: refs + exits * cfg.exitCost, grid, tlb: tlb.slice(), shadow: [...shadow].sort(), totals: snap() });
    });
    const t = snap(); t.avgRefs = tot.accesses ? tot.refs / tot.accesses : 0; t.hitRate = tot.accesses ? tot.hits / tot.accesses : 0;
    return { ok: true, cfg, frames, totals: t, events };
  }

  // compare(cfg, events): the same events under all three methods, for the side-by-side table.
  function compare(cfg, events) {
    return METHODS.map((m) => { const r = run(Object.assign({}, cfg, { method: m.id }), events); return { method: m.id, name: m.name, totals: r.ok ? r.totals : null }; });
  }

  // sweep(maxLevels): nested walk cost for every guest x host depth, for the cost table.
  function sweep(maxLevels) {
    const rows = [];
    for (let g = 1; g <= maxLevels; g++) { const r = []; for (let h = 1; h <= maxLevels; h++) r.push(walkRefs('nested', g, h)); rows.push(r); }
    return rows;
  }

  const PRESETS = [
    { id: 'steady', name: 'Steady working set (TLB friendly)', cfg: { g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 }, text: 'access A\naccess B\naccess C\naccess A x 3\naccess B x 3\naccess C x 3', note: 'After the first touches everything hits the TLB, so all three methods converge: translation cost only matters on misses.' },
    { id: 'scan', name: 'Big scan (TLB thrash)', cfg: { g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 }, text: 'access P1\naccess P2\naccess P3\naccess P4\naccess P5\naccess P6\naccess P7\naccess P8\naccess P1\naccess P2\naccess P3\naccess P4\naccess P5\naccess P6\naccess P7\naccess P8', note: 'Eight pages cycle through a 4-entry TLB (LRU), so every access misses. Nested pays 24 per walk; shadow pays only after its entries exist.' },
    { id: 'churn', name: 'Page-table churn (fork / mmap heavy)', cfg: { g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 }, text: 'map A\naccess A\nmap B\naccess B\nmap C\naccess C\nmap A\naccess A\nmap B\naccess B\nmap C\naccess C', note: 'The guest keeps editing its mappings. Shadow takes a VM exit on every edit and every refill; nested takes none.' },
    { id: 'switchy', name: 'Many context switches', cfg: { g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 }, text: 'access A\naccess B\nswitch\naccess A\naccess B\nswitch\naccess A\naccess B\nswitch\naccess A\naccess B', note: 'Each switch flushes the TLB (so misses repeat) and, under shadow paging, costs a VM exit as well.' },
    { id: 'notlb', name: 'No TLB at all (shows raw walk cost)', cfg: { g: 3, h: 3, tlb: false, tlbSize: 4, exitCost: 100 }, text: 'access A x 4', note: 'With no TLB every access walks. 3x3 levels: native 3+1, nested 15+1.' }
  ];

  const api = { LIMITS, METHODS, METHOD_BY_ID, PRESETS, walkRefs, nestedGrid, parseEvents, normCfg, run, compare, sweep };
  NS.vpt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
