/* Address translation view: logical address bits → TLB → page table → physical address, one phase per step. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, fmt, icon, debounce, clamp } = NS.util;
  const T = NS.translation;
  const KEY = 'oslab.translation.v1';
  // PHASE: the engine's phase names mapped to step numbers 1-4 (start = 0), used to light up the step chips
  // and to decide which boxes are dimmed.
  const PHASE = { start: 0, split: 1, tlb: 2, table: 3, phys: 4 };

  // mount(host): build the Address Translation screen and return { activate, deactivate } for app.js.
  // The stage is three columns that mirror the hardware path: logical address (bits) -> TLB and page
  // table -> physical address and physical memory. One step = one phase of one address.
  function mount(host) {
    // fromPreset(p): turn an example into editable state. Page-table cells are kept as strings so a half-typed
    // entry does not break the input; '' means 'page not in memory'.
    const fromPreset = (p) => ({ addrBits: p.addrBits, pageSize: p.pageSize, numFrames: p.numFrames, table: p.table.map((x) => (x === null ? '' : String(x))), addrText: p.addrs, tlbSize: p.tlbSize, tlbPolicy: p.tlbPolicy, tMem: p.tMem, tTlb: p.tTlb });
    let state = Object.assign(fromPreset(T.PRESETS[0]), { hex: false, assumedH: '' }, store.get(KEY, {}));
    if (!Array.isArray(state.table)) state = Object.assign(fromPreset(T.PRESETS[0]), { hex: false, assumedH: '' });
    const save = () => store.set(KEY, state);
    // sim = engine result (frames + per-address rows); valid = last input was valid.
    let sim = null, valid = false;

    const view = el('section', { class: 'view', 'aria-labelledby': 'at-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'at-title' }, 'Address Translation'),
      el('p', null, 'A program uses logical addresses. The hardware turns each one into a physical address using a page table, with a small cache called the TLB to speed it up.')));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    /* ---- main column ---- */
    const aboutCard = el('div', { class: 'card' }, el('details', { class: 'about', open: true }, el('summary', null, 'Paging and the TLB'),
      el('dl', null,
        el('dt', null, 'The idea'), el('dd', null, 'Memory is cut into equal pages (logical) and frames (physical). A logical address = page number + offset. Only the page number is translated; the offset stays the same.'),
        el('dt', null, 'Memory hook'), el('dd', null, 'Page number = which room. Offset = which seat in the room. The page table is the key list that says which real room.'),
        el('dt', null, 'Watch out for'), el('dd', null, 'Without a TLB every access costs two memory reads (page table, then data). A TLB hit avoids the first one.'))));
    // The 'translation' card: four step chips, the three-column flow, the hex/decimal toggle and the player.
    const stageCard = el('div', { class: 'card' });
    const stepsRow = el('div', { class: 'at-steps', role: 'list' });
    const flow = el('div', { class: 'at-flow' });
    const colA = el('div', { class: 'at-box' }), colB = el('div', { class: 'at-col' }), colC = el('div', { class: 'at-box' });
    flow.append(colA, colB, colC);
    const playerHost = el('div');
    const hexDec = el('button', { type: 'button', onclick: () => { state.hex = false; save(); paintHex(); redraw(); } }, 'Decimal');
    const hexHx = el('button', { type: 'button', onclick: () => { state.hex = true; save(); paintHex(); redraw(); } }, 'Hex');
    const hexRow = el('div', { class: 'mode' }, 'Show addresses in:', el('div', { class: 'seg' }, hexDec, hexHx));
    function paintHex() { hexDec.setAttribute('aria-pressed', String(!state.hex)); hexHx.setAttribute('aria-pressed', String(state.hex)); }
    stageCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The translation'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), stepsRow, flow, el('div', { style: { height: '14px' } }), playerHost, hexRow);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const resCard = el('div', { class: 'card' });
    colMain.append(aboutCard, stageCard, whyCard, resCard);
    // Shared playback bar; each step is one phase (split / TLB / page table / physical) of one address.
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    /* ---- problem panel ---- */
    const presetSel = el('select', { id: 'at-preset', 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), T.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; the translations are computed by the engine.
    presetSel.addEventListener('change', () => {
      const p = T.PRESETS.find((x) => x.id === presetSel.value); if (!p) return;
      state = Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; save(); renderFields(); recompute();
    });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } });
    const derivedBox = el('p', { class: 'note at-derived' });
    const tableHost = el('div', { class: 'at-ptable' });
    const errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    const probCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your problem')),
      el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, derivedBox,
        el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Page table (leave empty = page not in memory)'), tableHost,
          el('div', { class: 'row-inline', style: { marginTop: '6px' } },
            el('button', { type: 'button', class: 'btn', onclick: fillSeq }, 'Fill in order'),
            el('button', { type: 'button', class: 'btn', onclick: randomize }, icon('dice', 16), 'Random'),
            el('button', { type: 'button', class: 'btn', onclick: clearAll }, 'Clear'))),
        errBox));
    colSide.appendChild(probCard);

    // num(): a labelled number input bound to state[key]; each keystroke saves and schedules a recompute.
    const num = (id, label, key, min, extra) => el('div', { class: 'field' }, el('label', { for: id }, label),
      el('input', { type: 'number', id, min, value: state[key], step: 'any', oninput: (e) => { state[key] = e.target.value; save(); schedule(); } }), extra ? el('p', { class: 'hint' }, extra) : null);
    // renderFields(): the settings form: address bits, page size, frames, TLB size and policy, timings, addresses.
    function renderFields() {
      fieldsHost.replaceChildren(
        el('div', { class: 'grid2' }, num('at-bits', 'Logical address bits', 'addrBits', 4), num('at-page', 'Page size', 'pageSize', 1)),
        el('div', { class: 'grid2' }, num('at-frames', 'Physical frames', 'numFrames', 1), num('at-tlb', 'TLB entries (0 = none)', 'tlbSize', 0)),
        el('div', { class: 'field' }, el('label', { for: 'at-policy' }, 'TLB replacement'),
          el('select', { id: 'at-policy', onchange: (e) => { state.tlbPolicy = e.target.value; save(); recompute(); } },
            el('option', { value: 'fifo', selected: state.tlbPolicy === 'fifo' }, 'FIFO (oldest entry out)'), el('option', { value: 'lru', selected: state.tlbPolicy === 'lru' }, 'LRU (least recently used out)'))),
        el('div', { class: 'grid2' }, num('at-tmem', 'Memory access (ns)', 'tMem', 1), num('at-ttlb', 'TLB access (ns)', 'tTlb', 0)),
        el('div', { class: 'field' }, el('label', { for: 'at-addrs' }, 'Logical addresses to translate'),
          el('input', { type: 'text', id: 'at-addrs', value: state.addrText, spellcheck: 'false', oninput: (e) => { state.addrText = e.target.value; save(); schedule(); } }),
          el('p', { class: 'hint' }, 'Decimal, 0x hex or 0b binary, separated by commas or spaces.')));
    }

    // cfgFromState(): turn the typed state into the engine's config. The number of page-table rows is derived
    // from the address bits and page size (2^pageBits), capped so the table stays editable.
    function cfgFromState() {
      const addrBits = +state.addrBits, pageSize = +state.pageSize;
      const dd = T.isPow2(pageSize) && addrBits >= 1 ? addrBits - T.log2(pageSize) : 0;
      const numPages = dd > 0 && dd <= 12 ? Math.pow(2, dd) : 0;
      const table = [];
      for (let p = 0; p < numPages; p++) { const v = (state.table[p] || '').toString().trim(); table.push(v === '' ? null : Number(v)); }
      return {
        addrBits, pageSize, numFrames: +state.numFrames, tlbSize: +state.tlbSize, tlbPolicy: state.tlbPolicy, tMem: +state.tMem, tTlb: +state.tTlb,
        pageTable: table, addrs: String(state.addrText).split(/[\s,;]+/).filter(Boolean).map(T.parseAddr)
      };
    }

    // renderTable(): the editable page table, one row per page; an empty frame cell means 'invalid / not in memory'.
    function renderTable() {
      const cfg = cfgFromState(); const n = cfg.pageTable.length;
      const rows = [];
      for (let p = 0; p < n; p++) {
        rows.push(el('tr', null, el('td', { class: 'mono muted' }, p), el('td', null, el('input', { type: 'text', inputmode: 'numeric', id: 'at-pt-' + p, value: state.table[p] || '', placeholder: '–', 'aria-label': 'Frame for page ' + p,
          oninput: (e) => { state.table[p] = e.target.value; save(); schedule(); } }))));
      }
      tableHost.replaceChildren(n ? el('div', { class: 'at-ptscroll' }, el('table', { class: 'ptable' }, el('thead', null, el('tr', null, el('th', null, 'Page'), el('th', null, 'Frame'))), el('tbody', null, rows))) : el('p', { class: 'hint' }, 'Fix the address bits and page size to edit the page table.'));
    }
    // Helpers for the page table: fill in order (page p -> frame p), clear, or a random valid mapping.
    function fillSeq() { const c = cfgFromState(); state.table = c.pageTable.map((_, p) => (p < c.numFrames ? String(p) : '')); save(); renderTable(); recompute(); }
    function clearAll() { state.table = state.table.map(() => ''); save(); renderTable(); recompute(); }
    function randomize() {
      const c = cfgFromState(); const frames = Array.from({ length: c.numFrames }, (_, i) => i);
      for (let i = frames.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [frames[i], frames[j]] = [frames[j], frames[i]]; }
      state.table = c.pageTable.map((_, p) => (p < frames.length && Math.random() < 0.8 ? String(frames[p]) : ''));
      save(); renderTable(); recompute();
    }

    // Debounced input handler: refresh the derived-bits note, rebuild the table if its size changed, recompute.
    const schedule = debounce(() => { const before = cfgFromState().pageTable.length; renderDerived(); if (before !== tableLen) { renderTable(); } recompute(); }, 220);
    let tableLen = -1;
    // renderDerived(): live note such as 'Page number: 3 bits (8 pages). Offset: 5 bits', so students see how
    // the address splits as they change page size or address bits.
    function renderDerived() {
      const c = cfgFromState();
      if (T.isPow2(c.pageSize) && c.addrBits >= 4) {
        const d = T.derive(c);
        derivedBox.textContent = d.pageBits >= 1 ? 'Page number: ' + d.pageBits + ' bits (' + d.numPages + ' pages). Offset: ' + d.offsetBits + ' bits. Logical space: ' + d.space + '. Physical memory: ' + c.numFrames * c.pageSize + '.' : '';
      } else derivedBox.textContent = '';
    }

    // recompute(): validate the config and simulate. Invalid input shows errors and keeps the old animation.
    function recompute() {
      const cfg = cfgFromState();
      renderDerived();
      if (cfg.pageTable.length !== tableLen) { tableLen = cfg.pageTable.length; renderTable(); }
      const v = T.validate(cfg);
      errBox.hidden = v.ok; errBox.replaceChildren(...v.errors.map((m) => el('div', null, m)));
      if (!v.ok) return;
      valid = true;
      sim = T.simulate(cfg);
      buildStage();
      player.setStops(sim.frames.map((_, i) => i), Math.min(player.pos, sim.frames.length - 1));
    }

    /* ---- stage ---- */
    let ui = null;
    // fmtA(v): format an address in the chosen base (decimal or hex).
    const fmtA = (v) => (state.hex ? '0x' + v.toString(16).toUpperCase() : String(v));
    // bitStrip(): draw an address as individual bits, coloured as page-number bits or offset bits.
    function bitStrip(value, bits, offBits, labels) {
      const s = T.bin(value, bits);
      return el('div', { class: 'at-bits', role: 'img', 'aria-label': s }, [...s].map((b, i) => el('span', { class: 'at-bit ' + (i < bits - offBits ? 'pg' : 'off') }, b)));
    }

    // buildStage(): build the three columns. Column A: logical address and the div / mod arithmetic.
    // Column B: the TLB table and the page table. Column C: the physical address and a grid of physical frames.
    function buildStage() {
      const c = sim.cfg;
      stepsRow.replaceChildren(...['1 Split', '2 TLB', '3 Page table', '4 Physical'].map((t, i) => el('span', { class: 'at-step', role: 'listitem', dataset: { n: i + 1 } }, t)));
      ui = { };
      // column A
      ui.logBits = el('div'); ui.logVals = el('p', { class: 'mono at-vals' }); ui.math = el('p', { class: 'at-math mono' });
      colA.replaceChildren(el('h4', null, 'Logical address'), ui.logBits, el('div', { class: 'at-key' }, el('span', { class: 'at-bit pg' }, 'p'), ' page number', el('span', { class: 'at-bit off' }, 'd'), ' offset'), ui.logVals, ui.math);
      // column B: TLB + page table
      ui.tlbBody = el('tbody');
      const tlbBox = el('div', { class: 'at-box' }, el('h4', null, 'TLB' + (c.tlbSize ? ' (' + c.tlbSize + ' entries, ' + c.tlbPolicy.toUpperCase() + ')' : '')),
        c.tlbSize ? el('table', { class: 'at-tbl' }, el('thead', null, el('tr', null, el('th', null, 'Page'), el('th', null, 'Frame'))), ui.tlbBody) : el('p', { class: 'hint' }, 'No TLB in this setup.'));
      ui.tlbStatus = el('p', { class: 'at-status' });
      tlbBox.appendChild(ui.tlbStatus);
      ui.ptBody = el('tbody');
      ui.ptRows = c.pageTable.map((f, p) => { const tr = el('tr', null, el('td', { class: 'mono' }, p), el('td', { class: 'mono' }, f === null ? 'invalid' : f)); if (f === null) tr.classList.add('inv'); ui.ptBody.appendChild(tr); return tr; });
      ui.ptWrap = el('div', { class: 'at-ptscroll small' }, el('table', { class: 'at-tbl' }, el('thead', null, el('tr', null, el('th', null, 'Page'), el('th', null, 'Frame'))), ui.ptBody));
      ui.ptBox = el('div', { class: 'at-box' }, el('h4', null, 'Page table (in memory)'), ui.ptWrap);
      colB.replaceChildren(tlbBox, ui.ptBox); ui.tlbBox = tlbBox;
      // column C
      ui.physBits = el('div'); ui.physVals = el('p', { class: 'mono at-vals' });
      const inv = {}; c.pageTable.forEach((f, p) => { if (f !== null) inv[f] = p; });
      ui.frameCells = Array.from({ length: c.numFrames }, (_, f) => el('div', { class: 'at-frame' + (inv[f] === undefined ? ' free' : ''), title: 'Frame ' + f + (inv[f] === undefined ? ' (free)' : ' holds page ' + inv[f]) }, el('b', null, f), el('small', null, inv[f] === undefined ? '' : 'p' + inv[f])));
      colC.replaceChildren(el('h4', null, 'Physical address'), ui.physBits, ui.physVals, el('h4', { style: { marginTop: '12px' } }, 'Physical memory'), el('div', { class: 'at-frames' }, ui.frameCells));
    }

    // draw(i): show one phase. It highlights the TLB entry that hit (or the new entry just inserted), the
    // page-table row consulted, the physical frame reached, dims the parts not involved in this phase
    // (for example the page table on a TLB hit), and fills the explanation and results table.
    function draw(i) {
      if (!sim || !ui) return;
      const f = sim.frames[i], c = sim.cfg, d = sim.d, ph = PHASE[f.phase];
      stepsRow.querySelectorAll('.at-step').forEach((s) => {
        const n = +s.dataset.n;
        s.className = 'at-step' + (n === ph ? ' active' : n < ph ? ' done' : '') + (n === 3 && f.addrIndex >= 0 && ph >= 3 && sim.rows[f.addrIndex] && sim.rows[f.addrIndex].tlbHit ? ' skipped' : '');
      });
      // logical
      const A = f.addrIndex >= 0 ? sim.cfg.addrs[f.addrIndex] : null;
      ui.logBits.replaceChildren(A === null ? el('p', { class: 'hint' }, 'Press Step to load the first address.') : bitStrip(A, c.addrBits, d.offsetBits));
      ui.logVals.textContent = A === null ? '' : 'address ' + fmtA(A) + (state.hex ? ' = ' + A : ' = 0x' + A.toString(16).toUpperCase());
      ui.math.textContent = A !== null && ph >= 1 ? 'p = ' + A + ' div ' + c.pageSize + ' = ' + f.page + '    d = ' + A + ' mod ' + c.pageSize + ' = ' + (A % c.pageSize) : '';
      // TLB
      ui.tlbBody.replaceChildren();
      for (let k = 0; k < c.tlbSize; k++) {
        const e = f.tlb[k];
        const hitRow = e && ph >= 2 && f.hit && e.page === f.page && f.phase === 'tlb';
        const newRow = e && f.phase === 'table' && f.frame !== null && e.page === f.page;
        ui.tlbBody.appendChild(el('tr', { class: (hitRow ? 'hit' : '') + (newRow ? ' fresh' : '') + (e ? '' : ' empty') }, el('td', { class: 'mono' }, e ? e.page : '–'), el('td', { class: 'mono' }, e ? e.frame : '–')));
      }
      ui.tlbStatus.className = 'at-status' + (f.phase === 'tlb' ? (f.hit ? ' good' : ' bad') : '');
      ui.tlbStatus.textContent = f.phase === 'tlb' ? (f.hit ? '✓ TLB hit' : c.tlbSize ? '✗ TLB miss' : 'no TLB') : (f.phase === 'table' && f.evicted ? 'evicted page ' + f.evicted.page : '');
      // page table
      const consulted = f.phase === 'table' || (f.phase === 'phys' && !(sim.rows[f.addrIndex] || {}).tlbHit);
      ui.ptRows.forEach((tr, p) => tr.classList.toggle('now', consulted && p === f.page));
      ui.ptBox.classList.toggle('dim', ph < 3 || (f.phase === 'tlb' && f.hit) || (f.phase === 'phys' && (sim.rows[f.addrIndex] || {}).tlbHit));
      if (consulted && ui.ptRows[f.page]) { const r = ui.ptRows[f.page]; ui.ptWrap.scrollTop = Math.max(0, r.offsetTop - ui.ptWrap.clientHeight / 2); }
      // physical
      const showPhys = f.phase === 'phys';
      ui.physBits.replaceChildren(showPhys ? bitStrip(f.phys, sim.physBits, d.offsetBits) : el('p', { class: 'hint' }, f.fault ? 'No physical address: page fault.' : 'Built in step 4.'));
      ui.physVals.textContent = showPhys ? 'address ' + fmtA(f.phys) : '';
      const target = f.frame !== undefined && f.frame !== null && ph >= 3 ? f.frame : (f.phase === 'tlb' && f.hit ? f.frame : null);
      ui.frameCells.forEach((cell, k) => cell.classList.toggle('now', k === target));
      colC.classList.toggle('dim', ph < 3 && !(f.phase === 'tlb' && f.hit));
      // why + results
      const kids = [el('p', { class: 'muted' }, f.addrIndex < 0 ? 'Before the first address' : 'Address ' + (f.addrIndex + 1) + ' of ' + c.addrs.length + ', step ' + ph + ' of 4'), el('p', null, f.text)];
      if (f.fault) kids.push(el('div', { class: 'callout' }, 'A page fault is not an error in the program. It is how demand paging brings a page in from disk.'));
      whyBody.replaceChildren(...kids);
      drawResults(f.rowsDone || 0, i === sim.frames.length - 1);
    }
    // Redraw the current frame (used when toggling hex / decimal).
    const redraw = () => { if (sim) draw(player.frame || 0); };

    // drawResults(): the per-address results table (fills in as addresses finish) and, at the end, the TLB hit
    // ratio and Effective Access Time with the formula and arithmetic. The student can type their own hit
    // ratio to see how EAT changes.
    function drawResults(done, all) {
      const rows = sim.rows.slice(0, done);
      const head = ['Address', 'Page', 'Offset', 'TLB', 'Frame', 'Physical', 'Time (ns)'];
      const body = rows.map((r) => el('tr', null, el('td', null, fmtA(r.addr)), el('td', null, r.page), el('td', null, r.offset),
        el('td', { class: r.tlbHit ? 'best' : '' }, sim.cfg.tlbSize ? (r.tlbHit ? 'hit' : 'miss') : '–'),
        el('td', null, r.fault ? '–' : r.frame), el('td', { class: r.fault ? 'text-bad' : '' }, r.fault ? 'page fault' : fmtA(r.phys)), el('td', null, r.ns)));
      const c = sim.cfg;
      const hasTlb = c.tlbSize > 0;
      const h = hasTlb ? sim.hitRatio : 0, t = hasTlb ? c.tTlb : 0;
      // One line of EAT working: h x (tTLB + tmem) + (1 - h) x (tTLB + 2 x tmem).
      const eatLine = (hh, label) => label + ': EAT = ' + fmt(hh, 3) + ' × (' + t + ' + ' + c.tMem + ') + (1 − ' + fmt(hh, 3) + ') × (' + t + ' + 2 × ' + c.tMem + ') = ' + fmt(T.eat(hh, t, c.tMem), 2) + ' ns';
      const workText = () => {
        const hAssumed = state.assumedH !== '' && !Number.isNaN(+state.assumedH) ? clamp(+state.assumedH, 0, 1) : null;
        return 'EAT = h × (t_TLB + t_mem) + (1 − h) × (t_TLB + 2 × t_mem)\n(a TLB miss costs one extra memory read for the page table)\n' + eatLine(h, 'Measured hit ratio ' + fmt(h, 3)) + (hAssumed !== null ? '\n' + eatLine(hAssumed, 'Assumed hit ratio') : '') + '\nWithout any TLB: 2 × ' + c.tMem + ' = ' + 2 * c.tMem + ' ns';
      };
      const workPre = el('pre', null, workText());
      const eatInput = el('input', { type: 'number', id: 'at-assumed', min: 0, max: 1, step: 0.05, value: state.assumedH, placeholder: 'e.g. 0.9', style: { width: '90px' }, oninput: (e) => { state.assumedH = e.target.value; save(); workPre.textContent = workText(); } });
      resCard.replaceChildren(...[
        el('div', { class: 'card-head' }, el('h3', null, 'Results'), el('span', { class: 'sub' }, 'Fills in as each address finishes')),
        rows.length ? el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, head.map((x) => el('th', null, x)))), el('tbody', null, body))) : el('p', { class: 'hint' }, 'Nothing translated yet.'),
        all ? el('div', { class: 'stats' }, el('div', { class: 'stat' }, el('span', null, 'TLB hit ratio'), el('b', null, hasTlb ? fmt(sim.hitRatio * 100, 1) + '%' : 'no TLB')), el('div', { class: 'stat' }, el('span', null, 'Page faults'), el('b', null, sim.faults)), el('div', { class: 'stat' }, el('span', null, 'Effective access time'), el('b', null, fmt(sim.eat, 1) + ' ns'))) : null,
        all ? el('details', { class: 'working', open: true }, el('summary', null, 'Show the working'), workPre) : null,
        all ? el('div', { class: 'field', style: { marginTop: '10px' } }, el('label', { for: 'at-assumed' }, 'Try your own hit ratio (0 to 1)'), eatInput) : null].filter(Boolean));
    }

    renderFields(); renderDerived(); paintHex(); recompute();
    return { activate() { NS.Player.current = player; redraw(); }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.translation = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
