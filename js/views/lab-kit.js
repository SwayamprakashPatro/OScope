/* Lab kit: one small builder that gives a lab the standard screen, so each view file only describes its own parts.
   A view passes a spec: inputs (fields, presets), compute(state) -> frames, and draw(frame) -> what to show.
   The kit handles saved inputs, error messages, the step player and the standard card layout. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util;
  const kids = (x) => [].concat(x).reduce((a, k) => (Array.isArray(k) ? a.concat(kids(k)) : k != null && k !== false ? a.concat([k]) : a), []);   // flatten nested lists; never pass null to replaceChildren
  const put = (node, x) => node.replaceChildren(...kids(x));

  function mount(host, spec) {
    const KEY = 'oslab.' + spec.key + '.v1';
    let state = Object.assign({}, spec.defaults, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null, player = null;

    const view = el('section', { class: 'view', 'aria-labelledby': spec.key + '-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: spec.key + '-title' }, spec.title), el('p', null, spec.intro)));
    let chipBox = null;
    if (spec.chips) {
      chipBox = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': spec.chips.label || 'Mode' }, spec.chips.options.map(([v, t]) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state[spec.chips.key] === v), dataset: { v }, onclick: () => { state[spec.chips.key] = v; if (spec.chips.onPick) spec.chips.onPick(state, v); save(); paintChips(); renderFields(); recompute(true); } }, t)));
      view.appendChild(chipBox);
    }
    const paintChips = () => chipBox && chipBox.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state[spec.chips.key])));
    const ws = el('div', { class: 'workspace' }), main = el('div', { class: 'col' }), side = el('div', { class: 'col problem' });
    ws.append(main, side); view.appendChild(ws); host.appendChild(view);

    const aboutCard = spec.about ? el('details', { class: 'card about' }) : null;   // folded by default so the animation is the first thing on the page
    const visCard = el('div', { class: 'card' }), visBody = el('div'), playerHost = el('div'), why = el('div', { class: 'why' });
    const sub = el('span', { class: 'sub' });
    visCard.append(...kids([el('div', { class: 'card-head' }, el('h3', null, spec.visualTitle || 'Result'), sub), visBody, spec.noPlayer ? null : el('div', { style: { height: '10px' } }), spec.noPlayer ? null : playerHost, why]));
    const statCard = spec.stats ? el('div', { class: 'card' }) : null, statBody = el('div');
    if (statCard) statCard.append(el('div', { class: 'card-head' }, el('h3', null, spec.statsTitle || 'Totals so far')), statBody);
    const extraHost = el('div', { class: 'col', style: { gap: '16px' } });
    main.append(...kids([aboutCard, visCard, statCard, extraHost]));
    if (!spec.noPlayer) player = new NS.Player(playerHost, { label: spec.label || 'Step', onChange: (i) => draw(i) });

    if (aboutCard) {
      put(aboutCard, [el('summary', null, 'How it works'), el('dl', null, spec.about.map(([a, b]) => [el('dt', null, a), el('dd', null, b)]))]);
      aboutCard.open = store.get('oslab.' + spec.key + '.about', false) === true;               // remember whether the student opened it
      aboutCard.addEventListener('toggle', () => store.set('oslab.' + spec.key + '.about', aboutCard.open));
    }

    // inputs
    const sel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), (spec.presets || []).map((p) => el('option', { value: p.id }, p.name)));
    const note = el('p', { class: 'hint' }), fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    sel.addEventListener('change', () => { const p = (spec.presets || []).find((x) => x.id === sel.value); if (!p) return; state = Object.assign({}, state, p.state); note.textContent = p.note || ''; save(); paintChips(); renderFields(); recompute(false); });
    side.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, spec.inputTitle || 'Your input')), el('div', { class: 'col', style: { gap: '12px' } }, spec.presets && spec.presets.length ? el('div', { class: 'field' }, sel, note) : null, fieldsHost, errBox, spec.inputNote ? el('p', { class: 'hint' }, spec.inputNote) : null)));
    const again = debounce(() => recompute(true), 250);
    function renderFields() {
      const out = [], row = [];
      spec.fields.forEach((f) => {
        const id = spec.key + '-' + f.key; let input;
        if (f.type === 'area') { input = el('textarea', { id, rows: f.rows || 7, class: 'mp-code', spellcheck: 'false', oninput: (e) => { state[f.key] = e.target.value; save(); again(); } }); input.value = state[f.key]; }
        else if (f.type === 'select') { input = el('select', { id, onchange: (e) => { state[f.key] = e.target.value; save(); again(); } }, f.options.map(([v, t]) => el('option', { value: v }, t))); input.value = String(state[f.key]); }
        else if (f.type === 'text') input = el('input', { type: 'text', id, value: state[f.key], oninput: (e) => { state[f.key] = e.target.value; save(); again(); } });
        else input = el('input', { type: 'number', id, min: f.min, max: f.max, step: f.step || 'any', value: state[f.key], oninput: (e) => { state[f.key] = e.target.value === '' ? '' : +e.target.value; save(); again(); } });
        const box = el('div', { class: 'field' }, el('label', { for: id }, f.label), input, f.hint ? el('p', { class: 'hint' }, f.hint) : null);
        if (f.half) { row.push(box); if (row.length === 2) { out.push(el('div', { class: 'grid2' }, row.splice(0))); } } else { if (row.length) out.push(el('div', { class: 'grid2' }, row.splice(0))); out.push(box); }
      });
      if (row.length) out.push(el('div', { class: 'grid2' }, row.splice(0)));
      put(fieldsHost, out);
    }

    function recompute(keep) {
      const r = spec.compute(state);
      errBox.hidden = !(r.errors && r.errors.length); put(errBox, (r.errors || []).map((m) => el('div', null, m)));
      if (!r.ok) return;
      sim = r;
      if (spec.extras) put(extraHost, spec.extras(sim, state).map((x) => el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, x.title), x.sub ? el('span', { class: 'sub' }, x.sub) : null), x.node)));
      if (spec.afterCompute) spec.afterCompute(sim, state, { about: aboutCard });
      if (spec.noPlayer) draw(0); else player.setStops(sim.frames.map((_, i) => i), keep ? Math.min(player.pos, sim.frames.length - 1) : 0);
    }
    function draw(i) {
      if (!sim) return;
      const f = sim.frames ? sim.frames[i] : null, out = spec.draw(f, i, sim, state);
      sub.textContent = spec.noPlayer ? '' : (i ? (spec.label || 'Step') + ' ' + i + ' of ' + (sim.frames.length - 1) : 'Start');
      put(visBody, out.visual); put(why, out.why);
      if (statCard) put(statBody, spec.stats(f, sim, state));
    }
    paintChips(); renderFields(); recompute(false);
    return { activate() { if (player) NS.Player.current = player; }, deactivate() { if (player) player.pause(); } };
  }
  const table = (headers, rows, cls) => el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl cd-tbl ' + (cls || '') }, el('thead', null, el('tr', null, headers.map((h) => el('th', null, h)))), el('tbody', null, rows.map((r) => el('tr', null, r.map((c, i) => el(i ? 'td' : 'th', null, c)))))));
  const metrics = (pairs) => el('div', { class: 'mp-metrics' }, pairs.map(([k, v]) => el('div', null, el('small', null, k), el('b', null, String(v)))));
  const reg = (name, spec) => { NS.views = NS.views || {}; NS.views[name] = { mount: (host) => mount(host, spec) }; };
  NS.kit = { mount, reg, table, metrics, put, kids };
})(typeof window !== 'undefined' ? window : globalThis);
