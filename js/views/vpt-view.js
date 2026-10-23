/* Virtualised address translation view: one event script replayed under native, shadow and nested paging.
   Shows the two-dimensional walk grid, the TLB, the hypervisor's shadow table, running costs and a side-by-side table. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce, fmt } = NS.util;
  const V = NS.vpt;
  const KEY = 'oslab.vpt.v1';
  const OUT = { 'tlb-hit': ['good', 'TLB hit'], walk: ['', 'page walk'], 'shadow-fault': ['bad', 'VM exit: shadow fault'], 'trapped-write': ['bad', 'VM exit: trapped page-table write'], 'trapped-cr3': ['bad', 'VM exit: trapped CR3 write'], 'free-write': ['good', 'free edit'], flush: ['', 'TLB flushed'] };

  function mount(host) {
    const p0 = V.PRESETS[1];
    let state = Object.assign({ method: 'nested', preset: p0.id, text: p0.text }, p0.cfg, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null, events = [];
    const cfgOf = () => ({ method: state.method, g: state.g, h: state.h, tlb: state.tlb, tlbSize: state.tlbSize, exitCost: state.exitCost });

    const view = el('section', { class: 'view', 'aria-labelledby': 'vp-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'vp-title' }, 'Shadow & nested page tables'),
      el('p', null, 'A virtual machine has two layers of translation: guest virtual to guest physical, then guest physical to real host memory. Replay the same memory events under three methods and see where each one pays: on a TLB miss, or on every page-table edit.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Translation method' }, V.METHODS.map((m) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.method === m.id), dataset: { m: m.id }, onclick: () => { state.method = m.id; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === m.id))); recompute(true); } }, m.short)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const stageCard = el('div', { class: 'card' }), stageBody = el('div'), playerHost = el('div');
    stageCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Replaying the events'), el('span', { class: 'sub', id: 'vp-sub' })), stageBody, el('div', { style: { height: '12px' } }), playerHost);
    const cmpCard = el('div', { class: 'card' }), cmpBody = el('div');
    cmpCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Same events, all three methods'), el('span', { class: 'sub' }, 'Each row is a full replay')), cmpBody);
    const costCard = el('div', { class: 'card' }), costBody = el('div');
    costCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why nested misses hurt: the walk grid'), el('span', { class: 'sub' }, 'Nested walk references for each depth')), costBody);
    colMain.append(aboutCard, stageCard, cmpCard, costCard);
    const player = new NS.Player(playerHost, { label: 'Event', onChange: (i) => draw(i) });

    function renderAbout() {
      const m = V.METHOD_BY_ID[state.method];
      const text = { native: ['One page table of g levels. A TLB miss reads one entry per level.', 'g references per miss.', 'Nothing special: this is the baseline the other two are compared against.'],
        shadow: ['The hypervisor builds a combined table (guest virtual straight to host physical) and points the hardware at it. The hardware walk is as short as native.', 'g references per miss once the entry exists.', 'The guest believes it owns its page tables, but the hypervisor must keep the shadow in sync: it write-protects the guest tables, so every edit, every context switch and every first touch is a VM exit.'],
        nested: ['The hardware walks the guest table and a second host table. Every guest-table pointer is a guest-physical address, so each guest level needs its own host walk.', '(g+1)(h+1)-1 references per miss.', 'Page-table edits and context switches need no hypervisor help, but a miss is much more expensive, and deeper tables make it worse for both layers.'] }[state.method];
      aboutCard.replaceChildren(el('summary', null, m.name), el('dl', null, el('dt', null, 'How it works'), el('dd', null, text[0]), el('dt', null, 'Cost of a miss'), el('dd', null, text[1]), el('dt', null, 'Trade-off'), el('dd', null, text[2]), el('dt', null, 'Memory hook'), el('dd', null, m.hook)));
    }

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), V.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = V.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; Object.assign(state, p.cfg, { text: p.text }); presetNote.textContent = p.note; save(); renderFields(); recompute(false); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your events and machine')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    const schedule = debounce(() => recompute(false), 250);
    function renderFields() {
      const box = el('textarea', { id: 'vp-text', rows: 8, spellcheck: 'false', class: 'vp-code', oninput: (e) => { state.text = e.target.value; save(); schedule(); } }); box.value = state.text;
      const num = (key, id, label, lo, hi) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: lo, max: hi, value: state[key], oninput: (e) => { state[key] = e.target.value === '' ? '' : +e.target.value; save(); schedule(); } }));
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('label', { for: 'vp-text' }, 'Events, one per line'), box, el('p', { class: 'hint' }, 'access PAGE (read or write memory), map PAGE (the guest OS edits its page table), switch (context switch). Add "x 5" to repeat. # starts a comment.')),
        el('div', { class: 'grid2' }, num('g', 'vp-g', 'Guest levels (1-5)', 1, 5), num('h', 'vp-h', 'Host levels (1-5)', 1, 5)),
        el('div', { class: 'grid2' }, num('tlbSize', 'vp-tlb', 'TLB entries', 1, V.LIMITS.maxTlb), num('exitCost', 'vp-exit', 'VM-exit cost (references)', 0, V.LIMITS.maxExit)),
        el('label', { class: 'vp-check' }, el('input', { type: 'checkbox', id: 'vp-usetlb', checked: !!state.tlb, onchange: (e) => { state.tlb = e.target.checked; save(); recompute(true); } }), ' Use a TLB (turn off to see the raw walk cost)'),
        el('p', { class: 'hint' }, 'The VM-exit cost is a teaching constant in memory-reference units. A real exit costs on the order of thousands of cycles, but the exact ratio depends on the CPU, so try a few values.'));
    }

    function recompute(keep) {
      const pe = V.parseEvents(state.text);
      const r = pe.ok ? V.run(cfgOf(), pe.events) : { ok: false, errors: [] };
      const errs = pe.errors.concat(r.errors || []);
      errBox.hidden = !errs.length; errBox.replaceChildren(...errs.map((m) => el('div', null, m)));
      if (!pe.ok || !r.ok) return;
      sim = r; events = pe.events; renderAbout(); renderCompare(); renderCost();
      player.setStops(r.frames.map((_, i) => i), keep ? Math.min(player.pos, r.frames.length - 1) : 0);
    }

    // renderCompare(): replay the same script under every method, with bars scaled to the largest total cost.
    function renderCompare() {
      const rows = V.compare(cfgOf(), events), max = Math.max(1, ...rows.map((r) => r.totals.cost));
      const best = Math.min(...rows.map((r) => r.totals.cost));
      cmpBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl vp-cmp' }, el('thead', null, el('tr', null, ['Method', 'Memory refs', 'VM exits', 'Total cost', 'Avg refs / access'].map((h) => el('th', null, h)))),
        el('tbody', null, rows.map((r) => el('tr', { class: r.method === state.method ? 'vp-sel' : '' },
          el('td', null, r.name, r.totals.cost === best ? el('span', { class: 'vp-best' }, ' cheapest') : null),
          el('td', null, String(r.totals.refs)), el('td', null, String(r.totals.exits)),
          el('td', null, el('div', { class: 'vp-bar' }, el('i', { style: { width: Math.max(2, 100 * r.totals.cost / max) + '%' } }), el('b', null, String(r.totals.cost)))),
          el('td', null, fmt(r.totals.avgRefs, 2))))))),
      el('p', { class: 'note', style: { marginTop: '8px' } }, 'Total cost = memory references + VM exits x ' + state.exitCost + '. "Cheapest" is only true for THIS script and these settings: change the events or the exit cost and the winner can flip, which is the real lesson.'));
    }
    function renderCost() {
      const rows = V.sweep(5), cur = (r, c) => (r + 1 === state.g && c + 1 === state.h);
      costBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl vp-sweep' }, el('thead', null, el('tr', null, [el('th', null, 'Guest ↓ / Host →')].concat([1, 2, 3, 4, 5].map((h) => el('th', null, String(h)))))),
        el('tbody', null, rows.map((r, i) => el('tr', null, [el('th', null, String(i + 1))].concat(r.map((v, c) => el('td', { class: cur(i, c) ? 'vp-sel' : '' }, String(v))))))))),
      el('p', { class: 'note', style: { marginTop: '8px' } }, 'Each cell is (g+1)(h+1)-1. Real 4-level x 4-level hardware needs up to 24 references per miss (25 with the data access), versus 4 native. That is why CPUs add page-walk caches, huge pages and big TLBs, none of which are modelled here.'));
    }

    // draw(i): the TLB, the shadow table, the 2-D grid for a nested miss, and the running totals at event i.
    function draw(i) {
      if (!sim) return;
      const f = sim.frames[i], c = sim.cfg, T = f.totals;
      const sub = document.getElementById('vp-sub'); if (sub) sub.textContent = f.line ? 'Script line ' + f.line : 'Before the first event';
      const kids = [];
      kids.push(el('div', { class: 'vp-totals' }, ...[['References', T.refs], ['VM exits', T.exits], ['Total cost', T.cost], ['TLB hits', T.hits + ' / ' + T.accesses]].map(([k, v]) => el('div', null, el('small', null, k), el('b', null, String(v))))));
      kids.push(el('p', { class: 'muted' }, i ? ('Event ' + i + ' of ' + (sim.frames.length - 1) + ': ' + f.kind + (f.page ? ' ' + f.page : '')) : 'Press Next to replay the first event.'));
      if (i) { const [cls, word] = OUT[f.outcome] || ['', f.outcome]; kids.push(el('div', { class: 'vp-badge ' + cls }, word + (f.refs || f.exits ? ' · ' + f.refs + ' ref' + (f.refs === 1 ? '' : 's') + (f.exits ? ' + ' + f.exits + ' exit' : '') : ''))); }
      kids.push(el('p', null, f.text));
      if (f.grid) kids.push(gridView(f.grid, c.g, c.h));
      kids.push(el('div', { class: 'vp-state' },
        el('div', null, el('b', null, 'TLB'), el('div', { class: 'vp-tags' }, c.tlb ? (f.tlb.length ? f.tlb.map((p) => el('span', { class: 'vp-tag' + (p === f.page ? ' now' : '') }, p)) : el('em', null, 'empty')) : el('em', null, 'disabled'))),
        c.method === 'shadow' ? el('div', null, el('b', null, 'Hypervisor shadow table'), el('div', { class: 'vp-tags' }, f.shadow.length ? f.shadow.map((p) => el('span', { class: 'vp-tag' + (p === f.page ? ' now' : '') }, p)) : el('em', null, 'no entries'))) : null));
      stageBody.replaceChildren(...kids);
    }
    function gridView(grid, g, h) {
      const rowsEl = [];
      for (let r = 0; r <= g; r++) {
        const cells = [el('div', { class: 'vp-rl' }, r === 0 ? 'guest root' : r < g ? 'guest L' + (r + 1) + ' table' : 'final data page')];
        for (let k = 0; k <= h; k++) { const cell = grid.find((x) => x.row === r && x.col === k); cells.push(cell ? el('div', { class: 'vp-cell ' + cell.kind, title: cell.kind === 'host' ? 'host table level ' + (k + 1) : 'read the guest table entry' }, String(cell.n)) : el('div', { class: 'vp-cell data', title: 'the data access itself (not counted in the walk)' }, 'data')); }
        rowsEl.push(el('div', { class: 'vp-row', style: { gridTemplateColumns: '92px repeat(' + (h + 1) + ', minmax(26px, 1fr))' } }, cells));
      }
      return el('div', { class: 'vp-grid' }, el('div', { class: 'vp-gcap' }, 'Each row is one host walk (blue, h steps) followed by one guest-table read (orange). Numbers are the order of memory references.'), rowsEl);
    }

    renderAbout(); renderFields(); recompute(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.vpt = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
