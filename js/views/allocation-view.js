/* Memory allocation view: a memory bar where blocks are placed, split, freed, merged and compacted,
   with the hole search animated and a compare-all-algorithms tab. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, colorFor, textOn, store, fmt, icon, debounce } = NS.util;
  const A = NS.allocation;
  const KEY = 'oslab.allocation.v1';

  /* ---------- memory bar ---------- */
  // MemBar: the horizontal memory map. Memory is a bar from address 0 (left) to `total` (right); every block
  // is an absolutely positioned div whose left / width are percentages of the total, so resizing a block
  // is just a CSS transition. Allocated blocks are coloured per process; free holes are hatched.
  // The same component draws the live animation and the small static maps on the Compare tab.
  function MemBar(host, total, colorOf, opts) {
    const isStatic = !!(opts && opts.static);
    const bar = el('div', { class: 'ma-bar' });
    const marks = el('div', { class: 'ma-marks' });
    const axis = el('div', { class: 'ma-axis' });
    const ptr = el('div', { class: 'ma-ptr', hidden: true }, el('span', null, 'next-fit pointer'), el('i', null, '▼'));
    const wrap = el('div', { class: 'ma-barwrap' + (isStatic ? ' is-static' : ''), role: 'img', 'aria-label': 'Memory map' }, isStatic ? null : ptr, bar, marks, axis);
    host.appendChild(wrap);
    // procs: process name -> its DOM block, reused across frames so blocks slide and resize smoothly
    // instead of being recreated. holeEls: hole divs, rebuilt each update (holes have no identity).
    const procs = new Map();
    let holeEls = [];
    const pct = (v) => (v / total) * 100 + '%';

    // update(blocks, frame, algo): draw one frame. During a 'search' frame, the holes the algorithm examined
    // are outlined: red = too small, amber = fits, green = chosen, with a numbered tag above each.
    function update(blocks, frame, algo) {
      const W = bar.clientWidth || 600;
      holeEls.forEach((n) => n.remove()); holeEls = [];
      const seen = new Set();
      // probe: start address -> the search record for that hole (order examined, fits?, chosen?).
      const probe = {};
      if (frame && frame.search) frame.search.forEach((s, i) => { probe[s.start] = { i, s }; });
      marks.replaceChildren();
      blocks.forEach((b) => {
        if (b.pid !== null) {
          seen.add(b.pid);
          let n = procs.get(b.pid);
          if (!n) {
            n = el('div', { class: 'ma-block' }, el('b', null, b.pid), el('small', null, ''), el('i', { class: 'ma-int' }));
            const c = colorOf(b.pid); n.style.background = c; n.style.color = textOn(c);
            bar.appendChild(n); procs.set(b.pid, n);
          }
          n.style.left = pct(b.start); n.style.width = pct(b.size);
          n.querySelector('small').textContent = b.req;
          const wasted = b.size - b.req;
          const it = n.querySelector('.ma-int');
          it.style.width = wasted > 0 ? (wasted / b.size) * 100 + '%' : '0';
          n.title = b.pid + ': requested ' + b.req + ', block ' + b.size + ' at ' + b.start + (wasted > 0 ? ', ' + wasted + ' wasted inside' : '');
          n.classList.toggle('is-new', !!(frame && frame.phase === 'result' && frame.ok && frame.op && frame.op.op === 'alloc' && frame.op.name === b.pid));
        } else {
          const h = el('div', { class: 'ma-hole', title: 'Free hole: ' + b.size + ' at ' + b.start }, el('small', null, b.size));
          h.style.left = pct(b.start); h.style.width = pct(b.size);
          const p = probe[b.start];
          if (p) {
            h.classList.add(p.s.chosen ? 'is-pick' : p.s.fits ? 'is-fit' : 'is-small');
            const tag = el('span', { class: 'ma-tag ' + (p.s.chosen ? 'pick' : p.s.fits ? 'fit' : 'small'), title: p.s.size + (p.s.fits ? ' fits' : ' is too small') }, (p.i + 1) + (p.s.chosen ? ' ✓' : p.s.fits ? ' ok' : ' ✗'));
            tag.style.left = 'calc(' + pct(b.start + b.size / 2) + ' - 0px)';
            marks.appendChild(tag);
          }
          bar.appendChild(h); holeEls.push(h);
        }
      });
      procs.forEach((n, pid) => { if (!seen.has(pid)) { n.remove(); procs.delete(pid); } });
      // Address labels under the bar; skipped when two would overlap, so small blocks do not clutter it.
      // axis ticks
      axis.replaceChildren();
      let lastX = -999;
      const tick = (v) => {
        const x = (v / total) * W;
        if (x - lastX < 38 && v !== total) return;
        if (v === total && x - lastX < 30) return;
        lastX = x;
        axis.appendChild(el('span', { class: 'ma-tick', style: { left: pct(v) } }, v));
      };
      blocks.forEach((b) => tick(b.start)); tick(total);
      if (!isStatic) {
        // Next Fit's pointer is only drawn for that algorithm.
        const showPtr = algo === 'next' && frame && frame.ptr != null;
        ptr.hidden = !showPtr;
        if (showPtr) ptr.style.left = pct(Math.min(frame.ptr, total));
      }
    }
    return { update };
  }

  // mount(host): build the Memory Allocation screen and return { activate, deactivate } for app.js.
  // Left column: memory map + explanation + fragmentation numbers. Right column: the editable problem
  // (memory blocks and an ordered list of allocate / free / compact operations).
  function mount(host) {
    const P = A.PRESETS[0];
    // fromPreset(p): turn an example into the editable state (layout text, operation rows, mode).
    const fromPreset = (p) => ({ algo: p.algo, split: p.split, layoutText: p.layout, rows: p.ops.map(([op, name, size]) => ({ op, name: name || '', size: size == null ? '' : size })) });
    let state = Object.assign(fromPreset(P), { tab: 'viz' }, store.get(KEY, {}));
    if (!A.BY_ID[state.algo] || !Array.isArray(state.rows)) state = Object.assign(fromPreset(P), { tab: 'viz' });
    const save = () => store.set(KEY, state);
    // sim = engine result; bar = the live MemBar; valid = last input was valid.
    let sim = null, bar = null, valid = false;

    const view = el('section', { class: 'view', 'aria-labelledby': 'ma-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'ma-title' }, 'Memory Allocation'),
      el('p', null, 'Processes ask for chunks of memory. The OS must find a hole that fits. Which hole it picks decides how much memory ends up wasted (fragmentation).')));
    const chipRow = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Placement algorithm' });
    const tabViz = el('button', { type: 'button', role: 'tab', onclick: () => setTab('viz') }, 'Visualize');
    const tabCmp = el('button', { type: 'button', role: 'tab', onclick: () => setTab('cmp') }, 'Compare all algorithms');
    view.append(chipRow, el('div', { class: 'tabs', role: 'tablist' }, tabViz, tabCmp));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutHost = el('div', { class: 'card' }), vizHost = el('div', { class: 'col' }), cmpHost = el('div', { class: 'col' });
    colMain.append(aboutHost, vizHost, cmpHost);

    // The 'Memory map' card with its legend (hatched = free hole, striped = wasted inside a block).
    const memCard = el('div', { class: 'card' });
    const barSlot = el('div'), playerHost = el('div');
    memCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Memory map'), el('span', { class: 'sub' }, 'Left = address 0. Hatched = free hole.')),
      barSlot, el('div', { class: 'ma-legend' },
        el('span', null, el('i', { class: 'ma-sw hole' }), 'free hole'),
        el('span', null, el('i', { class: 'ma-sw int' }), 'wasted inside a block (internal fragmentation)')),
      el('div', { style: { height: '14px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    // Fragmentation numbers: external (scattered free space) and internal (waste inside blocks).
    const statCard = el('div', { class: 'card' }), statBody = el('div', { class: 'stats' });
    statCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Fragmentation')), statBody,
      el('p', { class: 'hint', style: { marginTop: '10px' } }, 'External = free memory split into pieces too small to use. Internal = space wasted inside an allocated block.'));
    vizHost.append(memCard, whyCard, statCard);
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    /* ---- problem panel ---- */
    const presetSel = el('select', { id: 'ma-preset', 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), A.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; placement results are computed by the engine.
    presetSel.addEventListener('change', () => {
      const p = A.PRESETS.find((x) => x.id === presetSel.value); if (!p) return;
      state = Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; layoutInput.value = state.layoutText;
      save(); renderAlgo(); renderMode(); renderOps(); recompute();
    });
    const layoutInput = el('input', { type: 'text', id: 'ma-layout', value: state.layoutText, spellcheck: 'false', 'aria-label': 'Memory block sizes', oninput: (e) => { state.layoutText = e.target.value; save(); schedule(); } });
    const modeSel = el('select', { id: 'ma-mode', onchange: (e) => { state.split = e.target.value === 'split'; save(); renderOps(); recompute(); } });
    const opsHost = el('div'), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    const probCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your problem')),
      el('div', { class: 'col', style: { gap: '12px' } },
        el('div', { class: 'field' }, presetSel, presetNote),
        el('div', { class: 'field' }, el('label', { for: 'ma-layout' }, 'Memory blocks (sizes, in order)'), layoutInput, el('p', { class: 'hint' }, 'One number = one big memory. Several numbers = existing blocks or partitions.')),
        el('div', { class: 'field' }, el('label', { for: 'ma-mode' }, 'When a request is smaller than its hole'), modeSel),
        el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Operations, in order'), opsHost),
        el('div', { class: 'row-inline' },
          el('button', { type: 'button', class: 'btn', onclick: () => addRow('alloc') }, icon('plus', 16), 'Allocate'),
          el('button', { type: 'button', class: 'btn', onclick: () => addRow('free') }, icon('plus', 16), 'Free'),
          el('button', { type: 'button', class: 'btn', onclick: () => addRow('compact') }, icon('plus', 16), 'Compact')),
        errBox));
    colSide.appendChild(probCard);

    // renderMode(): choose between variable partitions (split the hole) and fixed partitions (waste the leftover).
    function renderMode() {
      modeSel.replaceChildren(
        el('option', { value: 'split', selected: state.split }, 'Split: leftover becomes a new hole'),
        el('option', { value: 'fixed', selected: !state.split }, 'Fixed partitions: leftover is wasted'));
    }
    // liveBefore(i): which processes are in memory just before step i, used to offer only valid names to Free.
    function liveBefore(i) {
      const live = [];
      state.rows.slice(0, i).forEach((r) => { if (r.op === 'alloc' && r.name && !live.includes(r.name)) live.push(r.name); else if (r.op === 'free') { const k = live.indexOf(r.name); if (k >= 0) live.splice(k, 1); } });
      return live;
    }
    // renderOps(): the editable operation table. Allocate rows have a name and size, Free rows pick from live
    // processes, Compact rows need nothing.
    function renderOps() {
      const rows = state.rows.map((r, i) => {
        const label = { alloc: 'Allocate', free: 'Free', compact: 'Compact' }[r.op];
        let nameCell = el('td', null);
        if (r.op === 'alloc') nameCell = el('td', null, el('input', { type: 'text', value: r.name, maxlength: 6, id: 'ma-name-' + i, 'aria-label': 'Step ' + (i + 1) + ' process name', oninput: (e) => { r.name = e.target.value.trim(); save(); schedule(); } }));
        else if (r.op === 'free') {
          const live = liveBefore(i);
          if (r.name && !live.includes(r.name)) live.push(r.name);
          nameCell = el('td', null, el('select', { id: 'ma-name-' + i, 'aria-label': 'Step ' + (i + 1) + ' process to free', onchange: (e) => { r.name = e.target.value; save(); recompute(); } },
            live.length ? live.map((n) => el('option', { value: n, selected: n === r.name }, n)) : el('option', { value: '' }, 'none yet')));
          if (!r.name && live.length) r.name = live[0];
        }
        const sizeCell = el('td', null, r.op === 'alloc' ? el('input', { type: 'number', min: 1, value: r.size, id: 'ma-size-' + i, 'aria-label': 'Step ' + (i + 1) + ' size', oninput: (e) => { r.size = e.target.value; save(); schedule(); } }) : null);
        return el('tr', null, el('td', { class: 'mono muted' }, i + 1), el('td', null, label), nameCell, sizeCell,
          el('td', null, el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove step ' + (i + 1), onclick: () => { state.rows.splice(i, 1); save(); renderOps(); recompute(); } }, icon('trash', 16))));
      });
      opsHost.replaceChildren(el('table', { class: 'ptable ma-ops' }, el('thead', null, el('tr', null, ['#', 'Action', 'Process', 'Size', ''].map((h) => el('th', null, h)))), el('tbody', null, rows)));
    }
    // addRow(op): append an operation; new allocate rows get the next unused name (P1, P2, ...).
    function addRow(op) {
      if (op === 'alloc') {
        let n = 1; const used = new Set(state.rows.filter((r) => r.op === 'alloc').map((r) => r.name));
        while (used.has('P' + n)) n++;
        state.rows.push({ op, name: 'P' + n, size: 100 });
      } else if (op === 'free') state.rows.push({ op, name: liveBefore(state.rows.length)[0] || '', size: '' });
      else state.rows.push({ op, name: '', size: '' });
      save(); renderOps(); recompute();
    }

    // renderAlgo(): algorithm chips and the 'about' card.
    function renderAlgo() {
      chipRow.replaceChildren(...A.ALGOS.map((a) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(a.id === state.algo), onclick: () => { state.algo = a.id; save(); renderAlgo(); recompute(); } }, a.short)));
      const a = A.BY_ID[state.algo];
      aboutHost.replaceChildren(el('details', { class: 'about', open: true }, el('summary', null, a.name),
        el('dl', null, el('dt', null, 'The rule'), el('dd', null, a.rule), el('dt', null, 'Memory hook'), el('dd', null, a.hook), el('dt', null, 'Watch out for'), el('dd', null, a.watch))));
    }

    const schedule = debounce(() => recompute(), 200);
    // Colours are assigned by order of first appearance, so a process keeps its colour across all frames and maps.
    const colorOfFor = (names) => (n) => colorFor(Math.max(0, names.indexOf(n)));

    // recompute(): parse the layout, validate, simulate, rebuild the memory bar. Invalid input shows errors and
    // leaves the previous animation in place.
    function recompute() {
      const layout = A.parseLayout(state.layoutText);
      const ops = state.rows.map((r) => ({ op: r.op, name: r.name, size: r.size === '' ? NaN : +r.size }));
      const v = A.validate(layout, ops, { split: state.split });
      host.querySelectorAll('.ma-ops input.bad').forEach((n) => n.classList.remove('bad'));
      errBox.hidden = v.ok; errBox.replaceChildren(...v.errors.map((m) => el('div', null, m)));
      if (!v.ok) return;
      valid = true;
      sim = A.simulate(layout, ops, { algo: state.algo, split: state.split });
      barSlot.replaceChildren();
      bar = MemBar(barSlot, sim.total, colorOfFor(sim.names));
      if (state.tab === 'cmp') buildCompare();
      player.setStops(sim.frames.map((_, i) => i), Math.min(player.pos, sim.frames.length - 1));
    }

    // draw(i): render frame i: the memory map, the fragmentation tiles (external warns when a request fails
    // because free space is scattered), the explanation, and the holes the algorithm checked.
    function draw(i) {
      if (!sim || !bar) return;
      const f = sim.frames[i];
      bar.update(f.blocks, f, sim.cfg.algo);
      const s = f.stats;
      const tile = (label, v, cls) => el('div', { class: 'stat' + (cls ? ' ' + cls : '') }, el('span', null, label), el('b', null, v));
      const extWarn = f.phase === 'result' && f.ok === false && f.kind === 'external';
      statBody.replaceChildren(...[
        tile('Free in total', s.free), tile('Largest hole', s.largest), tile('Number of holes', s.holes),
        tile('External fragmentation', s.free ? fmt(s.extFrag, 0) + '%' : '0%', extWarn ? 'ma-warn' : ''),
        sim.cfg.split ? null : tile('Internal fragmentation', s.internal), tile('Memory in use', fmt(s.utilization, 0) + '%')].filter(Boolean));
      const kids = [el('p', { class: 'muted' }, f.op ? 'Step ' + (f.opIndex + 1) + ' of ' + sim.frames.filter((x) => x.phase === 'result').length : 'Before any operation'),
        el('p', null, f.text)];
      if (f.search && f.search.length) {
        kids.push(el('div', { class: 'decision' }, el('b', null, 'Holes checked, in order'),
          el('div', { class: 'cand' }, f.search.map((s2, k) => el('span', { class: s2.chosen ? 'win' : 'lose' }, (k + 1) + '. size ' + s2.size + ' @' + s2.start + (s2.chosen ? ' ✓ picked' : s2.fits ? ' fits' : ' too small'))))));
      }
      if (f.phase === 'result' && f.ok === false) kids.push(el('div', { class: 'callout' }, f.kind === 'external' ? 'Try the Compact operation before this step, then run it again.' : 'This request is not placed, so freeing it later is not possible.'));
      if (i === sim.frames.length - 1 && i > 0) kids.push(el('p', null, 'Done. ' + Object.keys(sim.placed).filter((k) => sim.placed[k] === null).length + ' request(s) failed.'));
      whyBody.replaceChildren(...kids);
    }

    // buildCompare(): run all four strategies on the same operations; show who placed what, who failed, and
    // a final memory map per strategy.
    function buildCompare() {
      const layout = A.parseLayout(state.layoutText);
      const ops = state.rows.map((r) => ({ op: r.op, name: r.name, size: +r.size }));
      const v = A.validate(layout, ops, { split: state.split });
      if (!v.ok) { cmpHost.replaceChildren(el('div', { class: 'card' }, el('p', null, 'Fix the highlighted problems to compare the algorithms.'))); return; }
      const all = A.simulateAll(layout, ops, { split: state.split });
      const names = all.first.names;
      const rows = A.ALGOS.map((a) => {
        const r = all[a.id];
        const fails = names.filter((n) => r.placed[n] === null);
        return el('tr', null, el('td', null, a.short),
          el('td', null, (names.length - fails.length) + ' / ' + names.length),
          el('td', { class: fails.length ? '' : 'best' }, fails.length ? fails.join(', ') : 'none'),
          el('td', null, r.stats.largest), el('td', null, fmt(r.stats.extFrag, 0) + '%'), state.split ? null : el('td', null, r.stats.internal));
      });
      const head = ['Algorithm', 'Placed', 'Failed', 'Largest hole', 'External frag.', state.split ? null : 'Internal frag.'].filter(Boolean);
      const placeRows = names.map((n) => el('tr', null, el('td', null, el('span', { class: 'pill', style: { background: colorFor(names.indexOf(n)), color: textOn(colorFor(names.indexOf(n))) } }, n)),
        A.ALGOS.map((a) => { const at = all[a.id].placed[n]; return el('td', { class: at === null ? 'text-bad' : '' }, at === null ? 'failed' : '@' + at); })));
      cmpHost.replaceChildren(
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Same requests, every algorithm'), el('span', { class: 'sub' }, 'Final state after all operations')),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, head.map((h) => el('th', null, h)))), el('tbody', null, rows))),
          el('h4', { class: 'ma-h4' }, 'Where each process landed (start address)'),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, el('th', null, 'Process'), A.ALGOS.map((a) => el('th', null, a.short)))), el('tbody', null, placeRows)))),
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Final memory maps')),
          A.ALGOS.map((a) => { const slot = el('div'); const blk = el('div', { class: 'ma-cmp' }, el('b', null, a.short), slot); const b = MemBar(slot, all[a.id].total, colorOfFor(names), { static: true }); requestAnimationFrame(() => b.update(all[a.id].final, null, a.id)); return blk; })));
    }

    function setTab(t) {
      state.tab = t; save();
      const viz = t === 'viz';
      vizHost.hidden = !viz; cmpHost.hidden = viz; aboutHost.hidden = !viz;
      tabViz.setAttribute('aria-selected', String(viz)); tabCmp.setAttribute('aria-selected', String(!viz));
      if (!viz && valid) buildCompare(); else if (sim) draw(player.frame || 0);
    }

    renderAlgo(); renderMode(); renderOps();
    setTab(state.tab === 'cmp' ? 'cmp' : 'viz');
    recompute();
    // The bar's tick spacing depends on pixel width, so redraw after the window is resized.
    window.addEventListener('resize', debounce(() => { if (sim && state.tab === 'viz') draw(player.frame || 0); }, 120));
    return { activate() { NS.Player.current = player; if (sim) draw(player.frame || 0); }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.allocation = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
