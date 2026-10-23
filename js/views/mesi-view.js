/* Cache coherence view: a grid of caches by line (coloured by MESI state), the bus transactions of the current
   step, running traffic counters, and a MESI-versus-MSI comparison on the same script. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util;
  const E = NS.mesi;
  const KEY = 'oslab.mesi.v1';
  const STATE_NAME = { M: 'Modified', E: 'Exclusive', S: 'Shared', I: 'Invalid' };

  function mount(host) {
    const p0 = E.PRESETS[0];
    let state = Object.assign({ cfg: Object.assign({}, p0.cfg), text: p0.text }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'me-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'me-title' }, 'Cache coherence (MESI)'),
      el('p', null, 'Each CPU keeps private copies of memory in its cache. If two CPUs could hold different values for the same line, programs would break, so the caches watch the bus and keep each line in one of four states. Type reads and writes and watch the states change.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Protocol' }, E.PROTOS.map((p) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.cfg.proto === p.id), dataset: { v: p.id }, onclick: () => { state.cfg.proto = p.id; save(); paint(); recompute(true); } }, p.short)));
    const paint = () => chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state.cfg.proto)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const gridCard = el('div', { class: 'card' }), gridBody = el('div'), legend = el('div', { class: 'key-legend' }), playerHost = el('div'), whyBox = el('div', { class: 'why' }), busBox = el('div', { class: 'me-bus' });
    gridCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Caches, line by line'), el('span', { class: 'sub', id: 'me-sub' })), gridBody, legend, el('div', { style: { height: '10px' } }), playerHost, busBox, whyBox);
    const statCard = el('div', { class: 'card' }), statBody = el('div');
    statCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Bus traffic so far')), statBody);
    const cmpCard = el('div', { class: 'card' }), cmpBody = el('div');
    cmpCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Same script, MSI versus MESI'), el('span', { class: 'sub' }, 'Whole-run totals')), cmpBody);
    colMain.append(aboutCard, gridCard, statCard, cmpCard);
    const player = new NS.Player(playerHost, { label: 'Operation', onChange: (i) => draw(i) });

    function renderAbout() {
      const p = E.PROTOS.find((x) => x.id === state.cfg.proto);
      aboutCard.replaceChildren(el('summary', null, p.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, p.about.rule), el('dt', null, 'Watch out for'), el('dd', null, p.about.watch), el('dt', null, 'Memory hook'), el('dd', null, p.hook)));
    }

    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), E.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = E.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; state.cfg = Object.assign({}, p.cfg); state.text = p.text; presetNote.textContent = p.note; save(); paint(); renderFields(); recompute(false); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your program')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    const schedule = debounce(() => recompute(false), 250);
    function renderFields() {
      const num = (key, id, label, lo, hi) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: lo, max: hi, value: state.cfg[key], oninput: (e) => { state.cfg[key] = e.target.value === '' ? '' : +e.target.value; save(); schedule(); } }));
      const box = el('textarea', { id: 'me-text', rows: 9, spellcheck: 'false', class: 'mp-code', oninput: (e) => { state.text = e.target.value; save(); schedule(); } }); box.value = state.text;
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('label', { for: 'me-text' }, 'Operations, one per line'), box, el('p', { class: 'hint' }, 'CPU read LINE, or CPU write LINE VALUE, for example "P0 read A" and "P1 write A 7". Optional first lines: "init A 5" sets memory. "#" starts a comment. Each line name is one cache line; the first operation on a line from a CPU is a cold miss.')),
        el('div', { class: 'grid2' }, num('cpus', 'me-cpus', 'CPUs (2-4)', 2, 4), num('lines', 'me-lines', 'Cache lines (1-4)', 1, 4)),
        el('p', { class: 'hint' }, 'Simplifications: write-back caches on one bus, one transaction at a time, and no evictions (every cache is large enough).'));
    }

    function recompute(keep) {
      const r = E.run(state.cfg, state.text);
      errBox.hidden = !(r.errors && r.errors.length); errBox.replaceChildren(...(r.errors || []).map((m) => el('div', null, m)));
      if (!r.ok) return;
      sim = r; renderAbout(); renderCompare();
      legend.replaceChildren(...['M', 'E', 'S', 'I'].filter((k) => k !== 'E' || r.cfg.proto === 'mesi').map((k) => el('span', null, el('i', { class: 'me-sw me-' + k }), k + ' = ' + STATE_NAME[k])), el('span', null, 'outlined = touched by this step'));
      player.setStops(r.frames.map((_, i) => i), keep ? Math.min(player.pos, r.frames.length - 1) : 0);
    }

    function renderCompare() {
      const rows = E.compare(state.cfg, state.text), keys = [['Bus transactions', 'bus'], ['BusRd', 'BusRd'], ['BusRdX', 'BusRdX'], ['BusUpgr', 'BusUpgr'], ['Write-backs', 'writebacks'], ['Cache-to-cache', 'c2c'], ['Invalidations', 'invalidations'], ['Misses', 'misses'], ['Coherence misses', 'coherence']];
      cmpBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl mp-tbl' }, el('thead', null, el('tr', null, [el('th', null, 'Measure')].concat(rows.map((r) => el('th', null, r.name))))), el('tbody', null, keys.map(([lab, k]) => el('tr', null, [el('td', null, lab)].concat(rows.map((r) => el('td', { class: r.id === state.cfg.proto ? 'me-cur' : '' }, r.stats ? String(r.stats[k]) : '–')))))))),
        el('p', { class: 'note', style: { marginTop: '8px' } }, 'MESI can only save traffic compared with MSI, and only when a CPU reads a line nobody else has and then writes it. A coherence miss is a miss caused by another CPU\'s write, not by the first touch: it is the cost of sharing.'));
    }

    // draw(i): the cache grid after operation i, with the cells touched by this step outlined.
    function draw(i) {
      if (!sim) return;
      const f = sim.frames[i], C = sim.cfg.cpus, A = sim.cfg.lines, tch = new Set((f.touched || []).map((t) => t[0] + ',' + t[1]));
      const head = el('tr', null, el('th', null, 'Line'), Array.from({ length: C }, (_, p) => el('th', { class: f.op && f.op.cpu === p ? 'me-act' : '' }, 'P' + p + ' cache')), el('th', null, 'Memory'));
      const rows = Array.from({ length: A }, (_, a) => el('tr', null, el('th', null, E.ADDR[a]), f.caches.map((c, p) => { const l = c[a]; return el('td', null, el('div', { class: 'me-cell me-' + l.s + (tch.has(p + ',' + a) ? ' touched' : ''), title: STATE_NAME[l.s] }, el('b', null, l.s), el('span', null, l.v == null ? '' : String(l.v)))); }),
        el('td', null, el('div', { class: 'me-cell me-mem' + (f.op && f.op.addr === a ? ' touched' : ''), title: 'main memory' }, el('span', null, String(f.mem[a]))))));
      gridBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'me-grid' }, el('thead', null, head), el('tbody', null, rows))));
      const sub = document.getElementById('me-sub'); if (sub) sub.textContent = i ? 'After operation ' + i + ' of ' + (sim.frames.length - 1) : 'Start';
      busBox.replaceChildren(el('b', null, 'Bus this step: '), ...(f.bus.length ? f.bus.map((t) => el('span', { class: 'me-tx' }, t)) : [el('em', null, i ? 'nothing (served from the local cache)' : 'idle')]));
      whyBox.replaceChildren(...[el('p', null, f.text), i && f.op ? el('p', { class: 'muted' }, (f.hit ? 'Hit' : 'Miss') + ' · ' + (f.op.op === 'read' ? 'value read: ' + f.result : 'value written: ' + f.op.value)) : null].filter(Boolean));
      const s = f.stats, cards = [['Operations', s.ops], ['Bus transactions', s.BusRd + s.BusRdX + s.BusUpgr], ['Hits / misses', s.hits + ' / ' + s.misses], ['Coherence misses', s.coherence], ['Invalidations', s.invalidations], ['Write-backs', s.writebacks], ['Cache-to-cache', s.c2c], ['Memory reads', s.memReads]];
      statBody.replaceChildren(el('div', { class: 'mp-metrics' }, cards.map(([k, v]) => el('div', null, el('small', null, k), el('b', null, String(v))))),
        el('ul', { class: 'mp-checks' }, el('li', { class: sim.violations.length ? 'bad' : 'ok' }, el('b', null, sim.violations.length ? '✗ ' : '✓ '), sim.violations.length ? sim.violations[0] : 'Coherence invariants held after every step: one writer or many readers, all copies equal, memory only stale behind a Modified copy.'), el('li', { class: sim.badReads.length ? 'bad' : 'ok' }, el('b', null, sim.badReads.length ? '✗ ' : '✓ '), sim.badReads.length ? sim.badReads[0] : 'Every read returned the most recently written value.')));
    }

    renderAbout(); renderFields(); recompute(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.mesi = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
