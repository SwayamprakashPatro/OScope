/* Log-structured FS / SSD view: the device drawn as blocks of pages (free, live hot, live cold, dead), the cleaner's
   work, erase counts per block, and a side-by-side comparison of cleaning policies or wear-levelling choices. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce, fmt } = NS.util;
  const F = NS.flashlog;
  const KEY = 'oslab.flashlog.v1';

  function mount(host) {
    const p0 = F.PRESETS[0];
    let state = Object.assign({ preset: p0.id }, p0.cfg, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null;
    const cfgOf = () => ({ mode: state.mode, blocks: state.blocks, ppb: state.ppb, logical: state.logical, policy: state.policy, wear: state.wear, spread: state.spread, endurance: state.endurance, ops: state.ops, hotFrac: state.hotFrac, hotWrites: state.hotWrites, trimPct: state.trimPct, seed: state.seed });

    const view = el('section', { class: 'view', 'aria-labelledby': 'fl-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'fl-title' }, 'Log-structured FS & SSD wear levelling'),
      el('p', null, 'Flash cannot overwrite in place, and a log-structured file system chooses not to. Both write new data at the head of a log, leave dead copies behind, then clean. Watch how much extra copying that causes, and how unevenly the erases land.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Which device' }, F.MODES.map((m) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.mode === m.id), dataset: { m: m.id }, onclick: () => { state.mode = m.id; if (m.id === 'lfs') state.wear = 'none'; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === m.id))); renderFields(); recompute(false); } }, m.short)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const devCard = el('div', { class: 'card' }), devBody = el('div'), legend = el('div', { class: 'key-legend' }), playerHost = el('div');
    devCard.append(el('div', { class: 'card-head' }, el('h3', { id: 'fl-dev' }, 'The device'), el('span', { class: 'sub', id: 'fl-sub' })), devBody, legend, el('div', { style: { height: '12px' } }), playerHost);
    const statCard = el('div', { class: 'card' }), statBody = el('div');
    statCard.append(el('div', { class: 'card-head' }, el('h3', null, 'What it cost'), el('span', { class: 'sub' }, 'Running totals for the workload')), statBody);
    const cmpCard = el('div', { class: 'card' }), cmpBody = el('div');
    cmpCard.append(el('div', { class: 'card-head' }, el('h3', { id: 'fl-cmp-h' }, 'Same workload, every option'), el('span', { class: 'sub' }, 'Each row is a full replay')), cmpBody);
    colMain.append(aboutCard, devCard, statCard, cmpCard);
    const player = new NS.Player(playerHost, { label: 'Picture', onChange: (i) => draw(i) });

    function renderAbout() {
      const m = F.MODE_BY_ID[state.mode], pol = F.POLICIES.find((p) => p.id === state.policy), w = F.WEARS.find((x) => x.id === state.wear);
      const kids = [el('summary', null, m.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, 'You may only write into empty pages, and you can only empty a whole ' + m.unit + ' at a time. So an overwrite writes a new copy at the head of the log and leaves the old copy dead.'),
        el('dt', null, 'Cleaner policy'), el('dd', null, pol.name + ': ' + pol.rule), state.mode === 'ssd' ? el('dt', null, 'Wear levelling') : null, state.mode === 'ssd' ? el('dd', null, w.name + ': ' + w.rule) : null, el('dt', null, 'Memory hook'), el('dd', null, m.hook))];
      aboutCard.replaceChildren(...kids);
    }

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), F.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = F.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; Object.assign(state, p.cfg); presetNote.textContent = p.note; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === state.mode))); renderFields(); recompute(false); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Device and workload')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    const schedule = debounce(() => recompute(false), 250);
    function renderFields() {
      const num = (key, id, label, lo, hi) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: lo, max: hi, value: state[key], oninput: (e) => { state[key] = e.target.value === '' ? '' : +e.target.value; save(); schedule(); } }));
      const sel = (key, id, label, opts) => el('div', { class: 'field' }, el('label', { for: id }, label), el('select', { id, onchange: (e) => { state[key] = e.target.value; save(); renderAbout(); recompute(true); } }, opts.map((o) => el('option', { value: o.id, selected: state[key] === o.id }, o.name))));
      const L = F.LIMITS;
      fieldsHost.replaceChildren(
        el('div', { class: 'grid2' }, num('blocks', 'fl-b', (state.mode === 'lfs' ? 'Segments' : 'Erase blocks') + ' (' + L.minBlocks + '-' + L.maxBlocks + ')', L.minBlocks, L.maxBlocks), num('ppb', 'fl-p', 'Pages per ' + (state.mode === 'lfs' ? 'segment' : 'block') + ' (' + L.minPpb + '-' + L.maxPpb + ')', L.minPpb, L.maxPpb)),
        num('logical', 'fl-l', 'Logical pages the host can address (at most (blocks - 3) x pages per block)', 1, (L.maxBlocks - 3) * L.maxPpb),
        sel('policy', 'fl-pol', 'Cleaner policy', F.POLICIES),
        state.mode === 'ssd' ? sel('wear', 'fl-w', 'Wear levelling', F.WEARS) : null,
        state.mode === 'ssd' ? el('div', { class: 'grid2' }, num('spread', 'fl-sp', 'Static: wear gap that triggers a move', 1, L.maxSpread), num('endurance', 'fl-en', 'Erase cycles a block survives', 1, L.maxEndurance)) : null,
        el('div', { class: 'grid2' }, num('ops', 'fl-ops', 'Operations (1-' + L.maxOps + ')', 1, L.maxOps), num('seed', 'fl-seed', 'Seed', 0, 2147483647)),
        el('div', { class: 'grid2' }, num('hotFrac', 'fl-hf', 'Hot data: % of logical pages', 1, 99), num('hotWrites', 'fl-hw', '% of writes aimed at hot data', 0, 100)),
        num('trimPct', 'fl-trim', (state.mode === 'lfs' ? '% of operations that delete a block' : '% of operations that are TRIM'), 0, 50),
        el('p', { class: 'hint' }, 'The device is first filled once (so most data is cold), then your workload runs. Hot pages are drawn H, cold pages C, dead pages x, empty pages ·. The workload is random but seeded, so the same seed always replays the same writes.'));
    }

    function recompute(keep) {
      const r = F.run(cfgOf());
      errBox.hidden = !(r.errors && r.errors.length); errBox.replaceChildren(...(r.errors || []).map((m) => el('div', null, m)));
      if (!r.ok) return;
      sim = r; renderAbout(); renderCompare(); renderLegend();
      const hd = document.getElementById('fl-dev'); if (hd) hd.textContent = state.mode === 'lfs' ? 'The disk, as segments' : 'The flash chip, as erase blocks';
      const ch = document.getElementById('fl-cmp-h'); if (ch) ch.textContent = state.mode === 'lfs' ? 'Same workload, each cleaner policy' : 'Same workload, each wear-levelling choice';
      player.setStops(r.frames.map((_, i) => i), keep ? Math.min(player.pos, r.frames.length - 1) : 0);
    }
    function renderLegend() {
      legend.replaceChildren(...[['H', 'live, hot'], ['C', 'live, cold'], ['x', 'dead (old copy)'], ['f', 'empty']].map(([k, t]) => el('span', null, el('i', { class: 'fl-sw fl-' + k }), t)), el('span', null, el('i', { class: 'fl-sw fl-head' }), 'where new data is going'));
    }
    function renderCompare() {
      const rows = F.compare(cfgOf()), lfs = state.mode === 'lfs';
      const heads = lfs ? ['Policy', 'Write amp.', 'Cleaner copies', 'Segments cleaned'] : ['Choice', 'Write amp.', 'Cleaner copies', 'Most-worn block', 'Least-worn', 'Levelling (mean / max)', 'Writes until first block dies'];
      cmpBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl fl-cmp' }, el('thead', null, el('tr', null, heads.map((h) => el('th', null, h)))),
        el('tbody', null, rows.map((r) => { const s = r.stats; if (!s) return el('tr', null, el('td', { colspan: heads.length }, r.name + ': could not run')); const cur = (lfs ? r.id === state.policy : r.id === state.wear);
          return el('tr', { class: cur ? 'fl-sel' : '' }, lfs ? [el('td', null, r.name), el('td', null, fmt(s.wa, 2)), el('td', null, String(s.copies)), el('td', null, String(s.gcRuns))]
            : [el('td', null, r.name), el('td', null, fmt(s.wa, 2)), el('td', null, String(s.copies)), el('td', null, String(s.maxErase)), el('td', null, String(s.minErase)), el('td', null, fmt(s.levelling, 2)), el('td', null, s.lifeWrites == null ? '–' : String(s.lifeWrites))]); })))),
      el('p', { class: 'note', style: { marginTop: '8px' } }, lfs ? 'Write amplification = (host writes + cleaner copies) / host writes. A policy that wins here may lose with a different hot/cold mix, so change the workload and look again.'
        : 'Erase counts include the initial fill. "Levelling" is mean / max erase count: 1.00 means perfectly even. "Writes before first block dies" projects the workload forward until the most-worn block reaches its endurance. Static levelling spends extra copies to buy a more even wear.'));
    }

    function draw(i) {
      if (!sim) return;
      const f = sim.frames[i], s = f.stats, ssd = sim.cfg.mode === 'ssd', maxE = Math.max(1, ...f.blocks.map((b) => b.e));
      const sub = document.getElementById('fl-sub'); if (sub) sub.textContent = i ? 'After ' + f.i + ' of ' + sim.cfg.ops + ' operations' : 'After the initial fill';
      devBody.replaceChildren(el('div', { class: 'fl-blocks' }, f.blocks.map((b, k) => el('div', { class: 'fl-block' + (b.head ? ' head' : ''), title: (ssd ? 'Erase block ' : 'Segment ') + k + ', erased ' + b.e + ' times' },
        el('div', { class: 'fl-bn' }, String(k)),
        el('div', { class: 'fl-pages' }, b.pg.split('').map((ch) => el('i', { class: 'fl-pg fl-' + (ch === '.' ? 'f' : ch) }, ch === '.' ? '' : ch))),
        el('div', { class: 'fl-ebar', 'aria-label': 'erased ' + b.e + ' times' }, el('i', { style: { width: (100 * b.e / maxE) + '%' } }), el('b', null, String(b.e)))))));
      const cards = [['Host writes', s.host], ['Cleaner copies', s.copies], ['Write amp.', fmt(s.wa, 2)], ['Erases (total)', s.erases]];
      if (ssd) cards.push(['Wear gap (max - min)', s.maxErase - s.minErase], ['Most worn', s.wornPct.toFixed(1) + '% of life']);
      statBody.replaceChildren(...[el('div', { class: 'fl-totals' }, cards.map(([k, v]) => el('div', null, el('small', null, k), el('b', null, String(v))))), el('p', { class: 'muted', style: { marginTop: '8px' } }, f.text || ''),
        (f.log && f.log.length) ? el('ul', { class: 'fl-log' }, f.log.slice(-6).map((l) => el('li', null, 'Cleaned ' + (ssd ? 'block ' : 'segment ') + l.victim + ' (' + l.live + ' live page' + (l.live === 1 ? '' : 's') + ' copied): ' + l.why))) : null].filter(Boolean));
    }

    renderAbout(); renderFields(); recompute(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.flashlog = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
