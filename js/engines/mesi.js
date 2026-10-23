/* Cache-coherence engine: MSI and MESI snooping protocols on a shared bus. Pure logic, no DOM.

   Several CPUs each have a private cache; they share one memory over a bus that every cache watches ("snoops").
   Coherence means every CPU always sees the latest write to a location. Each cached copy of a line is in one state:
     M  Modified   the only valid copy, and it is NEWER than memory (memory is stale)
     E  Exclusive  the only copy, same as memory (MESI only): a write needs no bus traffic
     S  Shared     maybe several copies, all the same as memory
     I  Invalid    not usable
   Bus transactions: BusRd (read miss), BusRdX (write miss: read and invalidate others), BusUpgr (write hit on a Shared line:
   just invalidate the others), and a Flush (write-back) when a Modified line must hand its data over.

   Model limits: write-back, write-invalidate, one atomic bus transaction at a time (no transient states or races), no cache
   evictions (every cache is big enough), one value per line. Correctness is CHECKED after every step: single writer,
   equal copies, and every read returns the last value written. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { minCpus: 2, maxCpus: 4, minLines: 1, maxLines: 4, maxOps: 100, maxValue: 9999 };
  const ADDR = 'ABCD'.split('');
  const PROTOS = [
    { id: 'mesi', name: 'MESI', short: 'MESI', hook: 'Modified, Exclusive, Shared, Invalid. Alone and clean? Exclusive, so your first write is free.',
      about: { rule: 'A read miss with no other copy loads the line as Exclusive; a read miss with other copies loads Shared and downgrades them. A write to an Exclusive or Modified line needs no bus traffic; a write to a Shared line broadcasts an invalidate first.', watch: 'Writing a line another CPU also writes keeps bouncing it between caches. Each bounce is a bus transaction and a coherence miss.' } },
    { id: 'msi', name: 'MSI (no Exclusive state)', short: 'MSI', hook: 'Without E, even a private read-then-write costs a bus transaction.',
      about: { rule: 'Same as MESI but a read miss always loads the line as Shared, even if no one else has it. So the first write to it must broadcast an invalidate (BusUpgr), although nobody had a copy.', watch: 'This is the cost of leaving out E: extra bus transactions for data that is only ever used by one CPU.' } }
  ];

  // parseScript(text, cpus, lines): "P0 read A", "P1 write A 7", and "init A 5" (starting memory value).
  function parseScript(text, cpus, lines) {
    const errors = [], ops = [], init = {}, rows = String(text || '').split(/\r?\n/);
    rows.forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const tok = line.split(/\s+/), where = 'Line ' + (i + 1) + ': ';
      if (tok[0].toLowerCase() === 'init') {
        const a = ADDR.indexOf((tok[1] || '').toUpperCase());
        if (a < 0 || a >= lines || !/^\d+$/.test(tok[2] || '') || tok.length > 3) { errors.push(where + 'use "init A 5" (a line name A-' + ADDR[lines - 1] + ' and a whole number).'); return; }
        if (ops.length) { errors.push(where + 'init must come before the first read or write.'); return; }
        if (+tok[2] > LIMITS.maxValue) { errors.push(where + 'values go up to ' + LIMITS.maxValue + '.'); return; }
        init[a] = +tok[2]; return;
      }
      const m = /^p(\d+)$/i.exec(tok[0]);
      if (!m || +m[1] >= cpus) { errors.push(where + '"' + tok[0] + '" is not a CPU. With ' + cpus + ' CPUs use P0' + (cpus > 1 ? '-P' + (cpus - 1) : '') + '.'); return; }
      const op = (tok[1] || '').toLowerCase();
      if (op !== 'read' && op !== 'write') { errors.push(where + 'the second word must be read or write.'); return; }
      const a = ADDR.indexOf((tok[2] || '').toUpperCase());
      if (a < 0 || a >= lines) { errors.push(where + '"' + (tok[2] || '') + '" is not a line. With ' + lines + ' line(s) use ' + ADDR.slice(0, lines).join(', ') + '.'); return; }
      if (op === 'write') {
        if (!/^\d+$/.test(tok[3] || '') || tok.length > 4) { errors.push(where + 'a write needs the value to store, e.g. "P0 write A 7".'); return; }
        if (+tok[3] > LIMITS.maxValue) { errors.push(where + 'values go up to ' + LIMITS.maxValue + '.'); return; }
        ops.push({ cpu: +m[1], op, addr: a, value: +tok[3], line: i + 1 });
      } else { if (tok.length > 3) { errors.push(where + 'a read takes no value.'); return; } ops.push({ cpu: +m[1], op, addr: a, line: i + 1 }); }
    });
    if (ops.length > LIMITS.maxOps) errors.push('Too many operations (' + ops.length + '); the limit is ' + LIMITS.maxOps + '.');
    if (!errors.length && !ops.length) errors.push('Type at least one operation, for example "P0 read A".');
    return { ok: !errors.length, errors, ops, init };
  }

  function run(cfgIn, text) {
    const cfg = Object.assign({ proto: 'mesi', cpus: 3, lines: 2 }, cfgIn || {}), errors = [];
    const int = (k, lo, hi, lab) => { const v = Number(cfg[k]); if (!Number.isInteger(v) || v < lo || v > hi) errors.push(lab + ' must be a whole number from ' + lo + ' to ' + hi + '.'); cfg[k] = v; };
    int('cpus', LIMITS.minCpus, LIMITS.maxCpus, 'Number of CPUs'); int('lines', LIMITS.minLines, LIMITS.maxLines, 'Number of cache lines');
    if (cfg.proto !== 'mesi' && cfg.proto !== 'msi') errors.push('Unknown protocol "' + cfg.proto + '".');
    if (errors.length) return { ok: false, errors };
    const parsed = parseScript(text, cfg.cpus, cfg.lines); if (!parsed.ok) return { ok: false, errors: parsed.errors };
    const C = cfg.cpus, A = cfg.lines, mesi = cfg.proto === 'mesi';
    const cache = Array.from({ length: C }, () => Array.from({ length: A }, () => ({ s: 'I', v: null, inv: false }))); // inv: this copy was thrown away by another CPU's write
    const mem = Array.from({ length: A }, (_, a) => (parsed.init[a] != null ? parsed.init[a] : 0));
    const last = mem.slice(); // the value the last write stored (the reference answer)
    const st = { ops: 0, hits: 0, misses: 0, cold: 0, coherence: 0, BusRd: 0, BusRdX: 0, BusUpgr: 0, memReads: 0, writebacks: 0, c2c: 0, invalidations: 0 };
    const violations = [], badReads = [];
    const snap = () => ({ caches: cache.map((c) => c.map((l) => ({ s: l.s, v: l.v }))), mem: mem.slice() });
    const frames = [Object.assign({ i: 0, text: 'Start: every cache is empty (all lines Invalid). Memory holds ' + mem.map((v, a) => ADDR[a] + '=' + v).join(', ') + '.', bus: [], stats: Object.assign({}, st), touched: [], hit: null }, snap())];
    const check = (i) => {
      for (let a = 0; a < A; a++) {
        const copies = cache.map((c, p) => ({ p, l: c[a] })).filter((x) => x.l.s !== 'I'), owners = copies.filter((x) => x.l.s === 'M' || x.l.s === 'E');
        if (owners.length > 1 || (owners.length === 1 && copies.length > 1)) violations.push('step ' + i + ', line ' + ADDR[a] + ': a ' + owners[0].l.s + ' copy coexists with other valid copies');
        if (new Set(copies.map((x) => x.l.v)).size > 1) violations.push('step ' + i + ', line ' + ADDR[a] + ': valid copies hold different values');
        if (!copies.some((x) => x.l.s === 'M') && copies.length && copies[0].l.v !== mem[a]) violations.push('step ' + i + ', line ' + ADDR[a] + ': clean copies differ from memory');
        if (copies.length && copies[0].l.v !== last[a]) violations.push('step ' + i + ', line ' + ADDR[a] + ': the cached value is not the last value written');
      }
    };
    parsed.ops.forEach((o, k) => {
      const p = o.cpu, a = o.addr, L = cache[p][a], bus = [], notes = [], touched = [[p, a]], nm = 'P' + p, ln = ADDR[a];
      st.ops++; let hit = false, result = null;
      const others = () => cache.map((c, q) => ({ q, l: c[a] })).filter((x) => x.q !== p && x.l.s !== 'I');
      const downgradeOthers = () => others().forEach((x) => { if (x.l.s === 'M') { mem[a] = x.l.v; st.writebacks++; bus.push('Flush ' + ln + ' (P' + x.q + ' writes the Modified value ' + x.l.v + ' back to memory)'); notes.push('P' + x.q + ' holds ' + ln + ' Modified, so it must supply the data and write it back: memory now has ' + x.l.v + '.'); } x.l.s = 'S'; touched.push([x.q, a]); });
      const invalidateOthers = () => others().forEach((x) => { if (x.l.s === 'M') { mem[a] = x.l.v; st.writebacks++; bus.push('Flush ' + ln + ' (P' + x.q + ' writes back ' + x.l.v + ' before dying)'); notes.push('P' + x.q + ' was Modified: it flushes its value to memory first.'); } x.l.s = 'I'; x.l.v = null; x.l.inv = true; st.invalidations++; touched.push([x.q, a]); notes.push('P' + x.q + ' invalidates its copy of ' + ln + '.'); });
      if (o.op === 'read') {
        if (L.s !== 'I') { hit = true; st.hits++; result = L.v; notes.push(nm + ' reads ' + ln + ': ' + L.s + ' hit, no bus traffic. Value ' + L.v + '.'); }
        else {
          st.misses++; if (L.inv) { st.coherence++; notes.push('This is a COHERENCE miss: ' + nm + ' had the line but another CPU\'s write invalidated it.'); } else st.cold++;
          st.BusRd++; bus.push('BusRd ' + ln + ' (' + nm + ' asks for the line)');
          const sh = others(), owner = sh.find((x) => x.l.s === 'M' || x.l.s === 'E');
          if (sh.length) { if (owner) { st.c2c++; notes.push('P' + owner.q + ' holds ' + ln + ' ' + owner.l.s + ' and supplies the data directly (cache-to-cache).'); } downgradeOthers(); L.v = (owner ? owner.l.v : mem[a]); if (!owner) { st.memReads++; notes.push('Another CPU shares it, memory supplies the data.'); } L.s = 'S'; }
          else { st.memReads++; L.v = mem[a]; L.s = mesi ? 'E' : 'S'; notes.push('No other cache has ' + ln + ', so memory supplies it and ' + nm + ' loads it ' + (mesi ? 'EXCLUSIVE: alone and clean, so a later write will be free.' : 'SHARED (MSI has no Exclusive state).')); }
          L.inv = false; result = L.v; notes.unshift(nm + ' reads ' + ln + ': MISS. Value ' + L.v + ', line now ' + L.s + '.');
        }
      } else {
        const v = o.value;
        if (L.s === 'M') { hit = true; st.hits++; notes.push(nm + ' writes ' + ln + '=' + v + ': Modified hit, no bus traffic.'); }
        else if (L.s === 'E') { hit = true; st.hits++; notes.push(nm + ' writes ' + ln + '=' + v + ': Exclusive hit. Nobody else has it, so it silently becomes Modified with NO bus traffic.'); }
        else if (L.s === 'S') { hit = true; st.hits++; st.BusUpgr++; bus.push('BusUpgr ' + ln + ' (' + nm + ' tells the others to invalidate)'); invalidateOthers(); notes.unshift(nm + ' writes ' + ln + '=' + v + ': the line is Shared, so it must first invalidate every other copy (BusUpgr).'); }
        else {
          st.misses++; if (L.inv) { st.coherence++; notes.push('A COHERENCE miss: another CPU\'s write had invalidated ' + nm + '\'s copy.'); } else st.cold++;
          st.BusRdX++; bus.push('BusRdX ' + ln + ' (' + nm + ' reads the line and invalidates all others)');
          const sh = others(), owner = sh.find((x) => x.l.s === 'M'); if (owner) { st.c2c++; } else st.memReads++;
          invalidateOthers(); notes.unshift(nm + ' writes ' + ln + '=' + v + ': MISS (write miss). It fetches the line with intent to modify (BusRdX) and every other copy dies.');
        }
        L.s = 'M'; L.v = v; L.inv = false; last[a] = v; result = v;
      }
      if (o.op === 'read' && result !== last[a]) badReads.push('step ' + (k + 1) + ': ' + nm + ' read ' + ln + '=' + result + ' but the last value written was ' + last[a]);
      check(k + 1);
      frames.push(Object.assign({ i: k + 1, op: o, text: notes.join(' '), bus, stats: Object.assign({}, st), touched, hit, result }, snap()));
    });
    const busTotal = st.BusRd + st.BusRdX + st.BusUpgr;
    return { ok: true, cfg, frames, stats: Object.assign({ bus: busTotal }, st), violations, badReads, ops: parsed.ops };
  }

  // compare(cfg, text): the same script under MSI and MESI.
  function compare(cfg, text) { return PROTOS.map((p) => { const r = run(Object.assign({}, cfg, { proto: p.id }), text); return { id: p.id, name: p.name, stats: r.ok ? r.stats : null }; }); }

  const PRESETS = [
    { id: 'basic', name: 'One line, three CPUs', cfg: { proto: 'mesi', cpus: 3, lines: 1 }, text: 'P0 read A\nP0 write A 5\nP1 read A\nP1 write A 7\nP0 read A\nP2 read A', note: 'Follow line A through E, M, S, I and back. P0\'s write is free (E to M), P1\'s read forces a flush, P1\'s write invalidates, and P0\'s next read is a coherence miss.' },
    { id: 'private', name: 'Private data: why the E state exists', cfg: { proto: 'mesi', cpus: 2, lines: 2 }, text: 'P0 read A\nP0 write A 1\nP0 write A 2\nP0 read B\nP0 write B 3', note: 'Only P0 ever touches these lines. Under MESI the writes cost nothing; switch to MSI and each first write needs a BusUpgr.' },
    { id: 'pingpong', name: 'Ping-pong: two CPUs fighting over a line', cfg: { proto: 'mesi', cpus: 2, lines: 1 }, text: 'P0 write A 1\nP1 write A 2\nP0 write A 3\nP1 write A 4\nP0 write A 5\nP1 write A 6', note: 'Every write misses and bounces the line from one cache to the other: this is "cache line bouncing", the heart of false-sharing slowdowns.' },
    { id: 'readshare', name: 'Many readers (read sharing is cheap)', cfg: { proto: 'mesi', cpus: 4, lines: 1 }, text: 'init A 42\nP0 read A\nP1 read A\nP2 read A\nP3 read A\nP0 read A\nP1 read A', note: 'After each CPU has loaded the line, everyone hits in its own cache. Then one write (try adding "P3 write A 7") invalidates the lot.' },
    { id: 'falseshare', name: 'Two variables on different lines', cfg: { proto: 'mesi', cpus: 2, lines: 2 }, text: 'P0 write A 1\nP1 write B 1\nP0 write A 2\nP1 write B 2\nP0 write A 3\nP1 write B 3', note: 'Same pattern as the ping-pong, but each CPU uses its own line, so after the first miss nothing bounces. If A and B shared one line (false sharing) it would be the ping-pong preset.' }
  ];

  const api = { LIMITS, ADDR, PROTOS, PRESETS, parseScript, run, compare };
  NS.mesi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
