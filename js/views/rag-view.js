/* Deadlock graphs view: resource-allocation graph, cycle highlight, stepped graph reduction, wait-for graph. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, colorFor, textOn, debounce } = NS.util;
  const G = NS.rag;
  const KEY = 'oslab.rag.v1';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // The four necessary conditions for deadlock, with a way to break each (shown in a table).
  const CONDITIONS = [
    ['Mutual exclusion', 'A resource instance can be used by only one process at a time.', 'Make resources shareable (read-only files).'],
    ['Hold and wait', 'A process holds some resources while waiting for others.', 'Request everything at once, or release before asking.'],
    ['No preemption', 'The OS cannot forcibly take a resource back.', 'Allow preemption (CPU, memory pages).'],
    ['Circular wait', 'A closed chain of processes each waits for the next one\'s resource.', 'Number resources and always request in increasing order.']
  ];

  /* nodes spread around an ellipse, processes and resources interleaved so cycles look like rings */
  // layout(): place every node on an ellipse, interleaving processes and resources, so a circular wait looks
  // like a ring. Returns { name: { kind, x, y, ... } }.
  function layout(procs, res, W, H) {
    const order = []; let i = 0, j = 0;
    while (i < procs.length || j < res.length) {
      const wantP = i < procs.length && (j >= res.length || i / procs.length <= j / res.length);
      if (wantP) order.push({ kind: 'p', id: procs[i++] }); else order.push({ kind: 'r', id: res[j++].id, k: res[j - 1].k });
    }
    const n = order.length, cx = W / 2, cy = H / 2, rx = W / 2 - 62, ry = H / 2 - 44, pos = {};
    order.forEach((o, idx) => { const a = -Math.PI / 2 + (idx * 2 * Math.PI) / n; o.x = n === 1 ? cx : cx + rx * Math.cos(a); o.y = n === 1 ? cy : cy + ry * Math.sin(a); pos[o.id] = o; });
    return pos;
  }

  // drawGraph(): draw the graph as SVG for a given frame. Circles are processes, squares are resources (one dot
  // per instance, filled when assigned). Request edges are dashed, assignment edges solid. In the final
  // frame deadlocked processes get a red outline and a 'STUCK' label; processes already removed by the
  // reduction fade and show 'done'. `waitFor` draws the wait-for variant (processes only).
  function drawGraph(model, frame, opts) {
    const W = opts.W, H = opts.H;
    const pos = layout(model.procs, model.res, W, H);
    const root = svg('svg', { class: 'rg-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label });
    // Arrowhead marker (an id per graph so two graphs on one page do not clash).
    const mk = (id) => svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, svg('path', { d: 'M0 0L10 5L0 10z', fill: 'context-stroke' }));
    root.appendChild(svg('defs', null, mk(opts.mid)));
    // From the frame: processes already reduced away (done), the deadlocked set, and the cycle's nodes.
    const done = frame ? frame.done : [], dead = frame && frame.kind === 'end' ? frame.deadlocked : [];
    const cycleSet = frame && frame.cycle && (frame.kind === 'cycle' || frame.kind === 'end') ? frame.cycle : [];
    // Is the edge a -> b one of the consecutive pairs of the found cycle?
    const inCycleEdge = (a, b) => { const c = cycleSet; for (let k = 0; k < c.length; k++) if (c[k] === a && c[(k + 1) % c.length] === b) return true; return false; };
    const R = 22, RW = 34;
    // edge(): a curved arrow between two nodes, trimmed so it stops at the node boundary; the curve direction
    // separates a request and an assignment between the same pair.
    function edge(a, b, cls, bend, label) {
      const A = pos[a], B = pos[b]; if (!A || !B) return;
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const trim = (nd) => (nd.kind === 'p' ? R + 3 : RW / 2 + 6);
      const x1 = A.x + ux * trim(A), y1 = A.y + uy * trim(A), x2 = B.x - ux * trim(B), y2 = B.y - uy * trim(B);
      const mx = (x1 + x2) / 2 - uy * bend, my = (y1 + y2) / 2 + ux * bend;
      const path = svg('path', { class: 'rg-edge ' + cls, d: 'M' + x1 + ' ' + y1 + ' Q' + mx + ' ' + my + ' ' + x2 + ' ' + y2, 'marker-end': 'url(#' + opts.mid + ')' });
      root.appendChild(path);
      if (label) root.appendChild(svg('text', { class: 'rg-elabel', x: mx, y: my - 4, 'text-anchor': 'middle', text: label }));
    }
    // Wait-for graph edges versus resource-allocation graph edges.
    if (opts.waitFor) {
      opts.waitFor.forEach((w) => edge(w.from, w.to, 'wf' + (dead.includes(w.from) && dead.includes(w.to) ? ' dead' : ''), 18, 'via ' + w.via));
    } else {
      model.edges.forEach((e) => {
        const gone = done.includes(e.p);
        const a = e.type === 'req' ? e.p : e.r, b = e.type === 'req' ? e.r : e.p;
        const cyc = inCycleEdge(a, b);
        edge(a, b, (e.type === 'req' ? 'req' : 'asg') + (gone ? ' gone' : '') + (cyc ? ' cyc' : '') + (dead.includes(e.p) ? ' dead' : ''), 14);
      });
    }
    // Draw the nodes after the edges so they sit on top.
    // nodes
    Object.keys(pos).forEach((id) => {
      const nd = pos[id];
      if (nd.kind === 'p') {
        const idx = model.procs.indexOf(id), fill = colorFor(idx);
        const isDead = dead.includes(id), isDone = done.includes(id), isNow = frame && frame.p === id;
        const g = svg('g', { class: 'rg-node rg-p' + (isDead ? ' dead' : '') + (isDone ? ' gone' : '') + (isNow ? ' now' : ''), transform: 'translate(' + nd.x + ',' + nd.y + ')' },
          svg('circle', { r: R, fill, stroke: isDead ? 'var(--fault)' : 'var(--surface)', 'stroke-width': isDead ? 4 : 2 }),
          svg('text', { class: 'rg-nt', y: 4, 'text-anchor': 'middle', fill: textOn(fill), text: id }));
        if (isDead) g.appendChild(svg('text', { class: 'rg-flag', y: -R - 6, 'text-anchor': 'middle', text: 'STUCK' }));
        if (isDone) g.appendChild(svg('text', { class: 'rg-flag ok', y: -R - 6, 'text-anchor': 'middle', text: 'done' }));
        root.appendChild(g);
      } else if (!opts.waitFor) {
        const inst = model.res.find((r) => r.id === id);
        const held = model.edges.filter((e) => e.type === 'asg' && e.r === id && !done.includes(e.p)).length;
        const g = svg('g', { class: 'rg-node rg-r', transform: 'translate(' + nd.x + ',' + nd.y + ')' },
          svg('rect', { x: -RW / 2 - (inst.k > 2 ? 8 : 0), y: -RW / 2, width: RW + (inst.k > 2 ? 16 : 0), height: RW, rx: 6, class: 'rg-rbox' }),
          svg('text', { class: 'rg-rt', y: -RW / 2 - 6, 'text-anchor': 'middle', text: id }));
        const dots = inst.k, gap = 11, x0 = -((dots - 1) * gap) / 2;
        for (let d = 0; d < dots; d++) g.appendChild(svg('circle', { cx: x0 + d * gap, cy: 0, r: 4, class: 'rg-dot' + (d < held ? ' held' : '') }));
        root.appendChild(g);
      }
    });
    return root;
  }

  // mount(host): build the Deadlock Graphs screen and return { activate, deactivate } for app.js.
  // Left: graph, explanation, verdict, optional wait-for graph and the four-conditions table.
  // Right: processes, resources and edges as text, plus quick-add buttons.
  function mount(host) {
    const fromPreset = (p) => ({ procs: p.procs, res: p.res, edges: p.edges });
    // State: the three text inputs and the wait-for toggle (saved to localStorage).
    let state = Object.assign(fromPreset(G.PRESETS[0]), { showWF: false }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    // model = parsed graph; sim = engine result (cycle, deadlocked set, reduction frames).
    let sim = null, model = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'rg-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'rg-title' }, 'Deadlock Graphs'),
      el('p', null, 'Draw who holds what and who is waiting. The graph shows whether a deadlock exists, and which processes are stuck.')));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    colMain.appendChild(el('details', { class: 'card about', open: true }, el('summary', null, 'Reading a resource-allocation graph'),
      el('dl', null,
        el('dt', null, 'The rule'), el('dd', null, 'Circles are processes, squares are resources (dots are instances). An arrow from a process to a resource means "requests". An arrow from a resource to a process means "is assigned to". Remove any process whose requests can all be met, give back what it holds, and repeat. Whoever is left is deadlocked.'),
        el('dt', null, 'Memory hook'), el('dd', null, 'Request goes out (P → R), assignment comes in (R → P). Think of a process holding a resource by the arrow pointing at it.'),
        el('dt', null, 'Watch out for'), el('dd', null, 'Single instance per resource: a cycle means deadlock. Several instances: a cycle only means deadlock is possible. Always run the reduction.'))));

    const graphCard = el('div', { class: 'card' }), graphSlot = el('div', { class: 'rg-graph' }), legend = el('div', { class: 'key-legend' });
    const playerHost = el('div');
    legend.append(el('span', null, el('i', { class: 'rg-sw req' }), 'request (P → R)'), el('span', null, el('i', { class: 'rg-sw asg' }), 'assignment (R → P)'), el('span', null, el('i', { class: 'rg-sw cyc' }), 'cycle'), el('span', null, el('i', { class: 'rg-sw dead' }), 'deadlocked'));
    graphCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Resource-allocation graph'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), graphSlot, legend, el('div', { style: { height: '12px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const verdictCard = el('div', { class: 'card' });
    const wfCard = el('div', { class: 'card' }), wfSlot = el('div', { class: 'rg-graph' });
    wfCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Wait-for graph'), el('span', { class: 'sub' }, 'Same story with resources removed')), wfSlot);
    const condCard = el('div', { class: 'card' });
    condCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Four conditions for deadlock'), el('span', { class: 'sub' }, 'All four must hold at once')),
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl rg-cond' }, el('thead', null, el('tr', null, ['Condition', 'Meaning', 'Break it by'].map((h) => el('th', null, h)))), el('tbody', null, CONDITIONS.map((c) => el('tr', null, el('td', null, el('b', null, c[0])), el('td', null, c[1]), el('td', null, c[2])))))),
      el('p', { class: 'note', style: { marginTop: '10px' } }, 'Memory hook: "My Hands Never Circle", for Mutual exclusion, Hold and wait, No preemption, Circular wait.'));
    colMain.append(graphCard, whyCard, verdictCard, wfCard, condCard);
    // Shared playback bar; steps are: the graph, the cycle search, then each reduction.
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    /* ---------- side panel ---------- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), G.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; the verdict is computed by the engine.
    presetSel.addEventListener('change', () => { const p = G.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; save(); renderFields(); recompute(); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' }), quickHost = el('div', { class: 'col', style: { gap: '8px' } });
    colSide.append(
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your graph')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Quick add an edge')), quickHost));
    // Debounced recompute.
    const schedule = debounce(() => recompute(), 200);
    let edgeBox = null, qp = null, qr = null;
    // renderFields(): the three text inputs (processes, resources with instance counts, edges).
    function renderFields() {
      edgeBox = el('textarea', { id: 'rg-edges', rows: 8, spellcheck: 'false', oninput: (e) => { state.edges = e.target.value; save(); schedule(); } }); edgeBox.value = state.edges;
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('label', { for: 'rg-procs' }, 'Processes (names separated by commas)'), el('input', { type: 'text', id: 'rg-procs', value: state.procs, spellcheck: 'false', oninput: (e) => { state.procs = e.target.value; save(); schedule(); } })),
        el('div', { class: 'field' }, el('label', { for: 'rg-res' }, 'Resources (R1 or R1=2 for two instances)'), el('input', { type: 'text', id: 'rg-res', value: state.res, spellcheck: 'false', oninput: (e) => { state.res = e.target.value; save(); schedule(); } })),
        el('div', { class: 'field' }, el('label', { for: 'rg-edges' }, 'Edges, one per line'), edgeBox, el('p', { class: 'hint' }, 'P1 -> R1 means P1 requests R1. R1 -> P1 means R1 is assigned to P1.')),
        el('div', { class: 'field' }, el('label', { class: 'rg-check' }, el('input', { type: 'checkbox', checked: !!state.showWF, onchange: (e) => { state.showWF = e.target.checked; save(); applyWF(); } }), ' Show the wait-for graph')));
    }
    // renderQuick(): dropdown helpers that append 'P -> R' or 'R -> P' lines so edges can be added without typing.
    function renderQuick() {
      if (!model) { quickHost.replaceChildren(el('p', { class: 'hint' }, 'Fix the graph above to add edges.')); return; }
      qp = el('select', { 'aria-label': 'Process' }, model.procs.map((p) => el('option', { value: p }, p)));
      qr = el('select', { 'aria-label': 'Resource' }, model.res.map((r) => el('option', { value: r.id }, r.id)));
      const add = (line) => { state.edges = (state.edges.trim() ? state.edges.replace(/\s+$/, '') + '\n' : '') + line; save(); edgeBox.value = state.edges; recompute(); };
      quickHost.replaceChildren(el('div', { class: 'row-inline' }, qp, qr),
        el('div', { class: 'row-inline' }, el('button', { type: 'button', class: 'btn', onclick: () => add(qp.value + ' -> ' + qr.value) }, 'Process requests resource'), el('button', { type: 'button', class: 'btn', onclick: () => add(qr.value + ' -> ' + qp.value) }, 'Resource assigned to process')));
    }
    // Show or hide the wait-for graph card.
    function applyWF() { wfCard.hidden = !state.showWF; }

    // recompute(): parse (with readable errors), run the reduction, rebuild the quick-add helpers.
    function recompute() {
      const r = G.parse(state.procs, state.res, state.edges);
      errBox.hidden = r.ok; errBox.replaceChildren(...r.errors.map((m) => el('div', null, m)));
      if (!r.ok) { return; }
      model = r.model; sim = G.reduce(model); renderQuick();
      player.setStops(sim.frames.map((_, i) => i), Math.min(player.pos, sim.frames.length - 1));
    }

    // draw(i): render the graph and wait-for graph for this frame, the explanation, and the verdict card
    // (cycle? deadlock? who is stuck?). The note under the verdict explains the single- versus multi-instance rule.
    function draw(i) {
      if (!sim || !model) return;
      const f = sim.frames[i];
      graphSlot.replaceChildren(drawGraph(model, f, { W: 640, H: 380, mid: 'rg-a1', label: 'Resource allocation graph with ' + model.procs.length + ' processes and ' + model.res.length + ' resources' }));
      const wf = G.waitFor(model);
      wfSlot.replaceChildren(drawGraph(model, f, { W: 520, H: 300, mid: 'rg-a2', waitFor: wf, label: 'Wait-for graph' }), wf.length ? el('p', { class: 'note' }, wf.map((w) => w.from + ' waits for ' + w.to + ' (via ' + w.via + ')').join('; ') + '.') : el('p', { class: 'note' }, 'Nobody is waiting for another process, so the wait-for graph has no edges.'));
      applyWF();
      whyBody.replaceChildren(...[el('p', { class: 'muted' }, 'Step ' + i + ' of ' + (sim.frames.length - 1)), el('p', null, f.text), f.kind === 'end' ? el('div', { class: 'callout ' + (f.deadlocked.length ? 'callout-bad' : 'callout-good') }, f.deadlocked.length ? 'DEADLOCK: ' + f.deadlocked.join(', ') : 'No deadlock') : null].filter(Boolean));
      // Multi-instance resources change the lesson: a cycle is then necessary but not sufficient for deadlock.
      const multi = model.res.some((r) => r.k > 1);
      verdictCard.replaceChildren(el('div', { class: 'card-head' }, el('h3', null, 'Verdict')),
        el('div', { class: 'stats' }, el('div', { class: 'stat' }, el('span', null, 'Cycle in graph?'), el('b', null, sim.cycle ? 'Yes' : 'No')), el('div', { class: 'stat' }, el('span', null, 'Deadlock?'), el('b', { class: sim.deadlocked.length ? 'text-bad' : 'text-good' }, sim.deadlocked.length ? 'Yes' : 'No')), el('div', { class: 'stat' }, el('span', null, 'Stuck processes'), el('b', null, sim.deadlocked.length ? sim.deadlocked.join(', ') : 'none'))),
        el('p', { class: 'note', style: { marginTop: '10px' } }, sim.cycle && !sim.deadlocked.length ? 'A cycle without deadlock: possible only because a resource has spare instances. A cycle is necessary, not sufficient, here.'
          : sim.cycle ? (multi ? 'The cycle is real: nobody in it can ever be satisfied.' : 'Every resource has a single instance, so the cycle is exactly a deadlock.')
            : 'No cycle means no deadlock, whatever the number of instances.'));
    }

    renderFields(); recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.rag = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
