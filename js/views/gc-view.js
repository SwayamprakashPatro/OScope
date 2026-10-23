/* Garbage collection view: an object graph (roots, pointers, colours / reference counts), the heap as a strip of
   cells (one strip, or two semispaces for the copying collector), the worklist, running statistics, and a
   side-by-side comparison of all three collectors on the SAME script. The view only draws what the engine computed. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, colorFor, textOn, debounce } = NS.util;
  const G = NS.gc;
  const KEY = 'oslab.gc.v1';

  // layout(names, W, H): put every object ever created on an ellipse, in creation order, so a node keeps the same
  // place for the whole run (freed objects fade out instead of the picture re-arranging itself).
  function layout(names, W, H) {
    const n = names.length, pos = {}, cx = W / 2, cy = H / 2, rx = W / 2 - 52, ry = H / 2 - 46;
    names.forEach((nm, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1); pos[nm] = { x: n === 1 ? cx : cx + rx * Math.cos(a), y: n === 1 ? cy : cy + ry * Math.sin(a), a }; });
    return pos;
  }

  // drawGraph(frame, names, algo): the object graph for one frame. Boxes are objects (name and size in cells),
  // arrows are pointers, small tags are roots. Status is shown by text as well as colour:
  //   mark-and-sweep: white / grey / black label while tracing;  reference counting: count badge and LEAK tag;
  //   copying: "copied" tag. Freed objects stay as dashed ghosts so you can see what disappeared.
  function drawGraph(f, names, algo, idPrefix) {
    const W = 640, H = 360, pos = layout(names, W, H), BW = 58, BH = 34;
    const s = svg('svg', { class: 'gc-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Object graph with ' + names.length + ' objects' });
    s.appendChild(svg('defs', null, svg('marker', { id: idPrefix, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, svg('path', { d: 'M0 0L10 5L0 10z', fill: 'context-stroke' }))));
    const by = {}; f.objs.forEach((o) => { by[o.name] = o; });
    // Edges first (nodes sit on top). A pointer from a freed object is not drawn.
    f.objs.forEach((o) => {
      if (!o.alive && !f.freedNow.includes(o.name)) return;
      o.refs.forEach((c) => {
        const A = pos[o.name], B = pos[c]; if (!A || !B) return;
        const hot = f.edge && f.edge[0] === o.name && f.edge[1] === c;
        if (o.name === c) {   // self pointer: a small loop above the box
          s.appendChild(svg('path', { class: 'gc-edge' + (hot ? ' hot' : ''), d: 'M' + (A.x - 10) + ' ' + (A.y - BH / 2) + ' c-6 -26 26 -26 20 0', 'marker-end': 'url(#' + idPrefix + ')' }));
          return;
        }
        const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        // Trim so the arrow starts and ends at the box border, and bend it so A->B and B->A do not overlap.
        const trim = (ux, uy) => Math.min(Math.abs(BW / 2 / (ux || 1e-6)), Math.abs(BH / 2 / (uy || 1e-6))) + 4;
        const x1 = A.x + ux * trim(ux, uy), y1 = A.y + uy * trim(ux, uy), x2 = B.x - ux * trim(ux, uy), y2 = B.y - uy * trim(ux, uy);
        const bend = 16, mx = (x1 + x2) / 2 - uy * bend, my = (y1 + y2) / 2 + ux * bend;
        s.appendChild(svg('path', { class: 'gc-edge' + (hot ? ' hot' : '') + (!o.alive ? ' gone' : ''), d: 'M' + x1 + ' ' + y1 + ' Q' + mx + ' ' + my + ' ' + x2 + ' ' + y2, 'marker-end': 'url(#' + idPrefix + ')' }));
      });
    });
    names.forEach((nm) => {
      const o = by[nm], p = pos[nm]; if (!o) return;
      const cls = ['gc-node', o.alive ? 'st-' + o.status : 'st-freed', f.focus === nm ? 'focus' : '', o.color ? 'col-' + o.color : ''].filter(Boolean).join(' ');
      const g = svg('g', { class: cls, transform: 'translate(' + p.x + ',' + p.y + ')' });
      g.appendChild(svg('rect', { x: -BW / 2, y: -BH / 2, width: BW, height: BH, rx: 8, class: 'gc-box' }));
      g.appendChild(svg('text', { class: 'gc-name', y: 5, 'text-anchor': 'middle', text: nm + (o.size > 1 ? '·' + o.size : '') }));
      // Small tag under the box: what is true about this object right now (text, not just colour).
      let tag = '';
      if (!o.alive) tag = 'freed';
      else if (algo === 'ms' && o.color) tag = o.color;
      else if (algo === 'cp' && o.copied) tag = 'copied';
      else if (o.status === 'leaked') tag = 'LEAK';
      else if (o.status === 'garbage') tag = 'garbage';
      else if (o.status === 'unclaimed') tag = 'count 0';
      if (tag) g.appendChild(svg('text', { class: 'gc-tag ' + tag.replace(/\s+/g, ''), y: BH / 2 + 13, 'text-anchor': 'middle', text: tag }));
      if (algo === 'rc' && o.alive) { g.appendChild(svg('circle', { cx: BW / 2, cy: -BH / 2, r: 10, class: 'gc-rc' })); g.appendChild(svg('text', { class: 'gc-rct', x: BW / 2, y: -BH / 2 + 4, 'text-anchor': 'middle', text: o.rc })); }
      // Root tag: a small triangle-and-label above every object a root variable points at.
      if (f.roots.includes(nm)) { g.appendChild(svg('path', { d: 'M0 ' + (-BH / 2 - 3) + ' l-5 -9 h10z', class: 'gc-rootmark' })); g.appendChild(svg('text', { class: 'gc-roottxt', y: -BH / 2 - 16, 'text-anchor': 'middle', text: 'root' })); }
      s.appendChild(g);
    });
    return s;
  }

  // drawHeap(f, order): the heap as cells. Single heap: one strip, cells coloured by owning object, empty cells
  // hatched. Copying: two semispaces with their role (from / to / active / idle), the scan and free pointers,
  // and forwarding pointers left behind in the from-space.
  function drawHeap(f, order) {
    const h = f.heap, cell = (c, addr, extra) => {
      if (!c) return el('div', { class: 'gc-cell free' + (extra || '') }, el('b', null, '·'), el('small', null, addr));
      const col = colorFor(order.indexOf(c.n));
      return el('div', { class: 'gc-cell used' + (extra || '') + (f.focus === c.n ? ' focus' : ''), style: { background: col, color: textOn(col) } }, el('b', null, c.n + (c.i ? '·' + c.i : '')), el('small', null, c.fwd != null ? '→' + c.fwd : addr));
    };
    if (h.kind === 'single') {
      return el('div', { class: 'gc-heap' }, el('div', { class: 'gc-spacehead' }, el('b', null, 'Heap'), el('span', { class: 'muted' }, h.size + ' cells, address under each cell')),
        el('div', { class: 'gc-cells' }, h.cells.map((c, a) => cell(c, a, f.freedCells.includes(a) ? ' just-freed' : ''))));
    }
    return el('div', { class: 'gc-heap' }, h.spaces.map((sp) => el('div', { class: 'gc-space role-' + sp.role },
      el('div', { class: 'gc-spacehead' }, el('b', null, 'Space ' + sp.id), el('span', { class: 'gc-role' }, { active: 'active (program allocates here)', idle: 'empty', from: 'from-space (being evacuated)', to: 'to-space (survivors go here)' }[sp.role]),
        sp.role === 'to' ? el('span', { class: 'muted mono' }, 'scan=' + h.scan + '  free=' + h.free) : (sp.role === 'active' ? el('span', { class: 'muted mono' }, 'free pointer=' + h.free) : null)),
      el('div', { class: 'gc-cells' }, sp.cells.map((c, a) => cell(c, a, (sp.role === 'to' && a === h.scan ? ' is-scan' : '') + (sp.role === 'to' && a === h.free ? ' is-free' : '')))))));
  }

  function mount(host) {
    let state = Object.assign({ algo: 'ms', script: G.PRESETS[2].script, heap: G.PRESETS[2].heap, autoGc: true }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'gc-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'gc-title' }, 'Garbage collection'),
      el('p', null, 'A program allocates objects and drops pointers. Who frees the memory nobody can reach? Run the same script under three collectors and compare what each one frees, leaks and costs.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Collector' }, G.ALGOS.map((a) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.algo === a.id), dataset: { algo: a.id }, onclick: () => { state.algo = a.id; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.algo === state.algo))); renderAbout(); setStops(true); } }, a.short)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const graphCard = el('div', { class: 'card' }), graphSlot = el('div', { class: 'gc-graph' }), legend = el('div', { class: 'key-legend', id: 'gc-legend' }), heapSlot = el('div'), listSlot = el('div'), playerHost = el('div');
    graphCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Objects and pointers'), el('span', { class: 'sub', id: 'gc-op' }, 'Arrow keys step, Space plays')), graphSlot, legend);
    const heapCard = el('div', { class: 'card' });
    heapCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The heap'), el('span', { class: 'sub' }, 'Where the objects actually sit')), heapSlot, listSlot, el('div', { style: { height: '12px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const statCard = el('div', { class: 'card' }), statBody = el('div');
    statCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Statistics so far')), statBody);
    const cmpCard = el('div', { class: 'card' }), cmpBody = el('div');
    cmpCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The three collectors on your script'), el('span', { class: 'sub' }, 'Totals at the end of the script')), cmpBody);
    colMain.append(aboutCard, graphCard, heapCard, whyCard, statCard, cmpCard);
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    // The about card follows the chosen collector: rule, memory hook, watch out.
    function renderAbout() {
      const a = G.BY_ID[state.algo];
      aboutCard.replaceChildren(el('summary', null, a.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, a.rule), el('dt', null, 'Memory hook'), el('dd', null, a.hook), el('dt', null, 'Watch out for'), el('dd', null, a.watch)));
    }

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), G.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = G.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; state.script = p.script; state.heap = p.heap; presetNote.textContent = p.note; save(); renderFields(); recompute(); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' }), warnBox = el('div', { class: 'callout', hidden: true });
    colSide.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your program')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox, warnBox)));
    const schedule = debounce(() => recompute(), 250);
    function renderFields() {
      const box = el('textarea', { id: 'gc-script', rows: 14, spellcheck: 'false', class: 'gc-code', oninput: (e) => { state.script = e.target.value; save(); schedule(); } }); box.value = state.script;
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('label', { for: 'gc-script' }, 'Program, one operation per line'), box,
          el('p', { class: 'hint' }, 'new A [size 1-3] · root A · unroot A · ref A B · unref A B · gc. Text after # is a comment. Roots are the variables on the stack.')),
        el('div', { class: 'grid2' },
          el('div', { class: 'field' }, el('label', { for: 'gc-heap' }, 'Heap size (cells, ' + G.LIMITS.minHeap + '-' + G.LIMITS.maxHeap + ')'), el('input', { type: 'number', id: 'gc-heap', min: G.LIMITS.minHeap, max: G.LIMITS.maxHeap, value: state.heap, oninput: (e) => { state.heap = e.target.value; save(); schedule(); } })),
          el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'When the heap is full'), el('label', { class: 'gc-check' }, el('input', { type: 'checkbox', id: 'gc-auto', checked: !!state.autoGc, onchange: (e) => { state.autoGc = e.target.checked; save(); recompute(); } }), ' run a collection automatically'))));
    }

    // recompute(): parse and replay the script under all three collectors (line-numbered errors if it is wrong).
    function recompute() {
      const r = G.run(state.script, { heap: state.heap, autoGc: state.autoGc });
      errBox.hidden = r.ok; errBox.replaceChildren(...(r.errors || []).map((m) => el('div', null, m)));
      if (!r.ok) { return; }
      sim = r;
      warnBox.hidden = !r.warnings.length; warnBox.replaceChildren(...r.warnings.map((w) => el('div', null, w)));
      renderCompare(); setStops(false);
    }
    // setStops(reset): load the frames of the chosen collector into the player.
    function setStops(reset) {
      if (!sim) return;
      const frames = sim.runs[state.algo].frames;
      player.setStops(frames.map((_, i) => i), reset ? 0 : Math.min(player.pos, frames.length - 1));
    }

    // renderCompare(): the same script under every collector, final numbers side by side.
    function renderCompare() {
      const rows = G.ALGOS.map((a) => { const r = sim.runs[a.id], st = r.stats; return { a, st, err: r.error }; });
      const pct = (st) => (st.freeCells ? Math.round(st.fragmentation * 100) + '%' : '–');
      const head = ['Collector', 'Freed', 'Bytes', 'Leaked', 'Waiting', 'Largest free', 'Holes', 'Work', 'Max pause', 'Moved'];
      cmpBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl gc-cmp' },
        el('thead', null, el('tr', null, head.map((h) => el('th', null, h)))),
        el('tbody', null, rows.map(({ a, st, err }) => el('tr', { class: a.id === state.algo ? 'now' : '' },
          el('td', null, a.short + (err ? ' (stopped)' : '')), el('td', null, st.freedObjects), el('td', null, st.bytesReclaimed),
          el('td', { class: a.id === 'rc' && st.leaked ? 'bad' : '' }, a.id === 'rc' ? st.leaked : 0), el('td', null, a.id === 'rc' ? 0 : st.garbageWaiting),
          el('td', null, st.largestFree + ' of ' + st.freeCells + ' free'), el('td', null, pct(st)), el('td', null, st.work), el('td', null, st.maxPause), el('td', null, st.moved)))))),
        el('p', { class: 'note', style: { marginTop: '8px' } }, 'Freed = objects freed, Bytes = memory reclaimed. Leaked = unreachable but still counted (reference counting only). Holes = fragmentation. Work = objects visited + swept. Max pause = most objects touched in one go. Waiting = unreachable garbage that a tracing collector has not collected yet. Fragmentation = how split-up the free cells are (0% = one block). The copying collector halves the usable memory but leaves no holes.'));
    }

    // draw(i): one frame: object graph, heap, worklist, explanation, statistics.
    function draw(i) {
      if (!sim) return;
      const run = sim.runs[state.algo], f = run.frames[i];
      graphSlot.replaceChildren(drawGraph(f, sim.names, state.algo, 'gc-arrow'));
      legend.replaceChildren(...legendFor(state.algo));
      heapSlot.replaceChildren(drawHeap(f, sim.names));
      listSlot.replaceChildren(...(f.worklist ? [el('div', { class: 'gc-work' }, el('b', null, 'Worklist (next to visit first): '), f.worklist.length ? f.worklist.map((n, k) => el('span', { class: 'gc-wchip' + (k === 0 ? ' top' : '') }, n)) : el('span', { class: 'muted' }, 'empty'))] : []));
      document.getElementById('gc-op') && (document.getElementById('gc-op').textContent = f.op ? 'Line ' + f.line + ': ' + f.op : 'Arrow keys step, Space plays');
      const kids = [el('p', { class: 'muted' }, 'Step ' + i + ' of ' + (run.frames.length - 1) + (f.stw ? '  ·  the program is PAUSED (stop the world)' : '')), el('p', null, f.text)];
      if (f.kind === 'error') kids.push(el('div', { class: 'callout callout-bad' }, 'This collector cannot continue the script here.'));
      if (f.kind === 'end' && state.algo === 'rc' && f.leaked && f.leaked.length) kids.push(el('div', { class: 'callout callout-bad' }, 'Leaked: ' + f.leaked.join(', ') + '. Reference counting can never free these; a tracing collector would.'));
      whyBody.replaceChildren(...kids);
      const st = f.stats;
      const tile = (l, v, cls) => el('div', { class: 'stat' }, el('span', null, l), el('b', { class: cls || '' }, v));
      statBody.replaceChildren(el('div', { class: 'stats' },
        tile('Objects freed', st.freedObjects), tile('Bytes reclaimed', st.bytesReclaimed), tile('Still allocated', st.alive),
        state.algo === 'rc' ? tile('Leaked now', st.leaked, st.leaked ? 'text-bad' : '') : tile('Garbage waiting', st.garbageWaiting),
        tile('Free cells', st.freeCells + (st.freeCells ? ' (largest ' + st.largestFree + ')' : '')), tile('Collections', st.gcRuns), tile('Longest pause', st.maxPause + ' visits'),
        state.algo === 'cp' ? tile('Objects moved', st.moved) : tile('Work so far', st.work)));
    }
    // legendFor(algo): what the colours and tags mean, written out.
    function legendFor(algo) {
      const sw = (c, t) => el('span', null, el('i', { class: 'gc-sw ' + c }), t);
      const base = [sw('live', 'reachable from a root'), sw('garbage', 'unreachable garbage'), sw('freed', 'freed')];
      if (algo === 'ms') base.push(sw('grey', 'grey: seen, pointers not followed yet'), sw('black', 'black: done'));
      if (algo === 'rc') base.push(sw('leaked', 'LEAK: unreachable but count above 0'), el('span', null, 'number in the circle = reference count'));
      if (algo === 'cp') base.push(sw('copied', 'copied to to-space'));
      return base;
    }

    renderAbout(); renderFields(); recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.gc = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
