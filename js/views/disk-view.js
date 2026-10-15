/* Disk scheduling view: head moving along the cylinder strip, the classic seek-path chart,
   running total with the full working, and a compare tab with bars and small multiples. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, fmt, debounce, clamp } = NS.util;
  const D = NS.disk;
  const KEY = 'oslab.disk.v1';

  // tickStep(n): a 'nice' tick spacing (1, 2, 5, 10, 20, 50, ...) giving about ten labels across n cylinders.
  function tickStep(n) { const raw = n / 10; const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  /* seek-path chart: cylinder on x, order of service going down */
  // seekChart(): the classic seek-path figure. Cylinder number runs left to right, time runs downwards:
  // each head movement is a line from the old to the new cylinder, one row lower. Solid lines are served
  // moves, dashed lines are circular jumps, the newest segment is highlighted, and the length of each
  // move is printed on it. `compact` draws the small version used in the Compare tab.
  function seekChart(sim, upto, opts) {
    const compact = !!(opts && opts.compact);
    const steps = sim.moves.length;
    const W = 640, m = { l: 22, r: 22, t: 30, b: 10 };
    // Row height shrinks as the number of moves grows so the chart always fits.
    const rowH = compact ? clamp(160 / Math.max(steps, 1), 8, 14) : clamp(300 / Math.max(steps, 1), 20, 34);
    const H = m.t + steps * rowH + m.b + 14;
    const iw = W - m.l - m.r;
    // Scales: cylinder -> x pixel, move number -> y pixel.
    const X = (c) => m.l + (c / (sim.cyl - 1)) * iw;
    const Y = (k) => m.t + k * rowH + 8;
    const root = svg('svg', { class: 'chart dk-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Seek path of the disk head for ' + sim.algo });
    const st = tickStep(sim.cyl - 1);
    for (let c = 0; c <= sim.cyl - 1; c += st) {
      root.appendChild(svg('line', { class: 'gridline', x1: X(c), x2: X(c), y1: m.t - 4, y2: H - m.b }));
      root.appendChild(svg('text', { class: 'tick-label', x: X(c), y: m.t - 12, 'text-anchor': 'middle', text: c }));
    }
    root.appendChild(svg('line', { class: 'axis-line', x1: m.l, x2: m.l + iw, y1: m.t - 4, y2: m.t - 4 }));
    // requests as tick marks on the axis
    const reqs = {}; sim.frames[0].pending.forEach((c) => { reqs[c] = true; });
    Object.keys(reqs).forEach((c) => root.appendChild(svg('path', { d: 'M' + X(+c) + ' ' + (m.t - 4) + 'l-4 -7h8z', fill: 'var(--ink-2)' }, svg('title', { text: 'request at ' + c }))));
    // path
    const n = Math.min(upto, steps);
    for (let k = 1; k <= n; k++) {
      const mv = sim.moves[k - 1];
      const isJump = mv.kind === 'jump';
      root.appendChild(svg('line', {
        x1: X(mv.from), y1: Y(k - 1), x2: X(mv.to), y2: Y(k), stroke: isJump ? 'var(--ink-3)' : (k === n ? 'var(--accent)' : 'var(--ink-2)'),
        'stroke-width': k === n ? 3 : 2, 'stroke-dasharray': isJump ? '6 5' : (mv.kind === 'edge' ? '' : ''), 'stroke-linecap': 'round'
      }));
      if (!compact && rowH >= 18) {
        const mx = (X(mv.from) + X(mv.to)) / 2, my = (Y(k - 1) + Y(k)) / 2;
        root.appendChild(svg('text', { x: mx + 6, y: my + 3, class: 'dk-dist', text: mv.dist + (mv.counted ? '' : ' (free)'), 'text-anchor': mx > W - 70 ? 'end' : 'start' }));
      }
    }
    // dots
    const pts = [{ c: sim.head, k: 0 }].concat(sim.moves.slice(0, n).map((mv, i) => ({ c: mv.to, k: i + 1, kind: mv.kind })));
    pts.forEach((p) => {
      const cur = p.k === n;
      root.appendChild(svg('circle', { cx: X(p.c), cy: Y(p.k), r: compact ? 2.5 : (cur ? 6 : 4.5), fill: cur ? 'var(--accent)' : (p.k === 0 ? 'var(--surface)' : 'var(--ink)'), stroke: p.k === 0 ? 'var(--ink)' : 'var(--surface)', 'stroke-width': 2 }, svg('title', { text: 'step ' + p.k + ': cylinder ' + p.c })));
      if (!compact) root.appendChild(svg('text', { x: X(p.c), y: Y(p.k) - 9, class: 'dk-cyl' + (cur ? ' now' : ''), 'text-anchor': 'middle', text: p.c }));
    });
    return root;
  }

  // mount(host): build the Disk Scheduling screen and return { activate, deactivate } for app.js.
  // Visualize tab: a strip with the read head moving along the cylinders, the seek-path chart, the
  // explanation and the running total. Compare tab: bars and small seek-path charts for every algorithm.
  function mount(host) {
    // fromPreset(p): turn an example into editable state (queue text, head, number of cylinders, direction).
    const fromPreset = (p) => ({ queue: p.queue, head: p.head, cyl: p.cyl, direction: p.direction });
    let state = Object.assign(fromPreset(D.PRESETS[0]), { algo: 'fcfs', countJump: true, sstfTie: 'lower', tab: 'viz' }, store.get(KEY, {}));
    if (!D.BY_ID[state.algo]) state.algo = 'fcfs';
    const save = () => store.set(KEY, state);
    // sim = engine result; valid = last input was valid.
    let sim = null, valid = false;

    const view = el('section', { class: 'view', 'aria-labelledby': 'dk-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'dk-title' }, 'Disk Scheduling'),
      el('p', null, 'The disk head must move to each requested cylinder. Moving costs time (seek time), so the order of service matters. Each algorithm picks a different order.')));
    const chipRow = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Disk scheduling algorithm' });
    const tabViz = el('button', { type: 'button', role: 'tab', onclick: () => setTab('viz') }, 'Visualize');
    const tabCmp = el('button', { type: 'button', role: 'tab', onclick: () => setTab('cmp') }, 'Compare all algorithms');
    view.append(chipRow, el('div', { class: 'tabs', role: 'tablist' }, tabViz, tabCmp));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);
    const aboutHost = el('div', { class: 'card' }), vizHost = el('div', { class: 'col' }), cmpHost = el('div', { class: 'col' });
    colMain.append(aboutHost, vizHost, cmpHost);

    // The 'disk' card: a strip of cylinders with pending requests (outlined) and served ones (filled), and the head.
    const stripCard = el('div', { class: 'card' });
    const strip = el('div', { class: 'dk-strip', role: 'img', 'aria-label': 'Disk cylinders with requests and the read head' });
    const playerHost = el('div');
    stripCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The disk'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), strip, el('div', { class: 'key-legend' },
      el('span', null, el('i', { class: 'dk-m pend' }), 'pending request'), el('span', null, el('i', { class: 'dk-m done' }), 'served'), el('span', null, el('i', { class: 'dk-head-sw' }), 'read head')), el('div', { style: { height: '14px' } }), playerHost);
    const chartCard = el('div', { class: 'card' }), chartSlot = el('div');
    chartCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Seek path'), el('span', { class: 'sub' }, 'Cylinder across, time going down')), chartSlot);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const resCard = el('div', { class: 'card' });
    vizHost.append(stripCard, chartCard, whyCard, resCard);
    // Shared playback bar; each step is one head movement.
    const player = new NS.Player(playerHost, { label: 'Move', onChange: (i) => draw(i) });

    /* panel */
    const presetSel = el('select', { id: 'dk-preset', 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), D.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; seek distances are computed by the engine.
    presetSel.addEventListener('change', () => {
      const p = D.PRESETS.find((x) => x.id === presetSel.value); if (!p) return;
      Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; save(); renderFields(); recompute();
    });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your problem')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));

    // Debounced recompute.
    const schedule = debounce(() => recompute(), 200);
    // renderFields(): the inputs. Algorithm-specific options appear only when relevant: direction for the SCAN
    // family, the return-jump convention for C-SCAN / C-LOOK, the tie rule for SSTF.
    function renderFields() {
      const a = D.BY_ID[state.algo];
      const kids = [
        el('div', { class: 'field' }, el('label', { for: 'dk-queue' }, 'Request queue (cylinder numbers)'), el('input', { type: 'text', id: 'dk-queue', value: state.queue, spellcheck: 'false', oninput: (e) => { state.queue = e.target.value; save(); schedule(); } })),
        el('div', { class: 'grid2' },
          el('div', { class: 'field' }, el('label', { for: 'dk-head' }, 'Head starts at'), el('input', { type: 'number', id: 'dk-head', min: 0, value: state.head, oninput: (e) => { state.head = e.target.value; save(); schedule(); } })),
          el('div', { class: 'field' }, el('label', { for: 'dk-cyl' }, 'Cylinders on disk'), el('input', { type: 'number', id: 'dk-cyl', min: 2, value: state.cyl, oninput: (e) => { state.cyl = e.target.value; save(); schedule(); } })))
      ];
      if (a.scan) kids.push(el('div', { class: 'field' }, el('label', { for: 'dk-dir' }, 'Head is moving'), el('select', { id: 'dk-dir', onchange: (e) => { state.direction = e.target.value; save(); recompute(); } },
        el('option', { value: 'up', selected: state.direction === 'up' }, 'Toward the higher cylinders'), el('option', { value: 'down', selected: state.direction === 'down' }, 'Toward cylinder 0'))));
      if (state.algo === 'cscan' || state.algo === 'clook') kids.push(el('div', { class: 'field' }, el('label', { for: 'dk-jump' }, 'The return jump'), el('select', { id: 'dk-jump', onchange: (e) => { state.countJump = e.target.value === 'count'; save(); recompute(); } },
        el('option', { value: 'count', selected: state.countJump }, 'Counts toward total seek distance'), el('option', { value: 'free', selected: !state.countJump }, 'Does not count'))));
      if (state.algo === 'sstf') kids.push(el('div', { class: 'field' }, el('label', { for: 'dk-tie' }, 'If two requests are equally close'), el('select', { id: 'dk-tie', onchange: (e) => { state.sstfTie = e.target.value; save(); recompute(); } },
        el('option', { value: 'lower', selected: state.sstfTie === 'lower' }, 'Take the lower cylinder'), el('option', { value: 'higher', selected: state.sstfTie === 'higher' }, 'Take the higher cylinder'))));
      kids.push(el('p', { class: 'hint' }, 'Textbooks differ on these conventions. Match your course.'));
      fieldsHost.replaceChildren(...kids);
    }
    // renderAlgo(): algorithm chips and the 'about' card.
    function renderAlgo() {
      chipRow.replaceChildren(...D.ALGOS.map((a) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(a.id === state.algo), onclick: () => { state.algo = a.id; save(); renderAlgo(); renderFields(); recompute(); } }, a.short)));
      const a = D.BY_ID[state.algo];
      aboutHost.replaceChildren(el('details', { class: 'about', open: true }, el('summary', null, a.name),
        el('dl', null, el('dt', null, 'The rule'), el('dd', null, a.rule), el('dt', null, 'Memory hook'), el('dd', null, a.hook), el('dt', null, 'Watch out for'), el('dd', null, a.watch))));
    }
    // cfgOf(): the engine settings from the UI state.
    const cfgOf = () => ({ direction: state.direction, countJump: state.countJump, sstfTie: state.sstfTie });
    // inputs(): parse the typed queue, head and cylinder count.
    function inputs() { return { reqs: D.parseQueue(state.queue), head: Number(state.head), cyl: Number(state.cyl) }; }

    // Handles to the live strip elements (head marker, request marks, scale).
    let strips = null;
    // recompute(): validate, simulate, rebuild the strip and (if on that tab) the comparison.
    function recompute() {
      const { reqs, head, cyl } = inputs();
      const v = D.validate(reqs, head, cyl);
      errBox.hidden = v.ok; errBox.replaceChildren(...v.errors.map((m) => el('div', null, m)));
      if (!v.ok) return;
      valid = true;
      sim = D.simulate(reqs, head, cyl, state.algo, cfgOf());
      buildStrip();
      if (state.tab === 'cmp') buildCompare();
      player.setStops(sim.frames.map((_, i) => i), Math.min(player.pos, sim.frames.length - 1));
    }

    // buildStrip(): create the cylinder strip: a request marker per request, a tick scale and the head.
    function buildStrip() {
      strip.replaceChildren();
      const track = el('div', { class: 'dk-track' });
      const headEl = el('div', { class: 'dk-head' }, el('b', null, ''), el('i', null, '▼'));
      const pct = (c) => (c / (sim.cyl - 1)) * 100 + '%';
      const st = tickStep(sim.cyl - 1);
      const ticks = [];
      for (let c = 0; c <= sim.cyl - 1; c += st) { const t = el('span', { class: 'dk-tick', style: { left: pct(c) } }, c); ticks.push(t); }
      const marks = sim.frames[0].pending.map((c, i) => { const m = el('i', { class: 'dk-req', title: 'request at ' + c, style: { left: pct(c) } }); return { c, m }; });
      track.append(...marks.map((x) => x.m), headEl);
      strip.append(headEl, track, el('div', { class: 'dk-ticks' }, ticks));
      strips = { headEl, marks, pct };
    }

    // draw(i): move the head to its position after move i, restyle request markers (pending vs served), redraw the
    // seek-path chart up to this move, and show the explanation and running total with its working.
    function draw(i) {
      if (!sim || !strips) return;
      const f = sim.frames[i];
      strips.headEl.style.left = strips.pct(f.pos);
      strips.headEl.firstChild.textContent = f.pos;
      // which requests are served: compare pending multiset
      const left = f.pending.slice();
      strips.marks.forEach((x) => { const k = left.indexOf(x.c); if (k >= 0) { left.splice(k, 1); x.m.className = 'dk-req'; } else x.m.className = 'dk-req done'; });
      chartSlot.replaceChildren(seekChart(sim, i));
      const kids = [el('p', { class: 'muted' }, i === 0 ? 'Before any move' : 'Move ' + i + ' of ' + sim.moves.length), el('p', null, f.text)];
      if (f.move && f.move.kind === 'jump') kids.push(el('div', { class: 'callout' }, state.countJump ? 'The jump is drawn dashed. Your setting counts it in the total.' : 'The jump is drawn dashed and is NOT counted in the total (your setting).'));
      if (i === sim.frames.length - 1 && i > 0) kids.push(el('p', null, 'All requests served. Total head movement: ' + f.total + ' cylinders.'));
      whyBody.replaceChildren(...kids);
      const tile = (l, v) => el('div', { class: 'stat' }, el('span', null, l), el('b', null, v));
      resCard.replaceChildren(el('div', { class: 'card-head' }, el('h3', null, 'Total seek distance')),
        el('div', { class: 'stats' }, tile('Total so far', f.total), tile('Requests served', f.served + ' / ' + sim.frames[0].pending.length), tile('Average per request', f.served ? fmt(f.total / f.served, 2) : '–')),
        f.working ? el('details', { class: 'working', open: true }, el('summary', null, 'Show the working'), el('pre', null, f.working)) : el('p', { class: 'hint', style: { marginTop: '10px' } }, 'The working appears as the head moves.'));
    }

    // buildCompare(): run all six algorithms on the same queue; show a bar chart and table of total seek distance
    // (the shortest is marked) and every algorithm's seek path side by side. Fewest cylinders is not the whole
    // story: SSTF can starve far requests.
    function buildCompare() {
      const { reqs, head, cyl } = inputs();
      const v = D.validate(reqs, head, cyl);
      if (!v.ok) { cmpHost.replaceChildren(el('div', { class: 'card' }, el('p', null, 'Fix the highlighted problems to compare.'))); return; }
      const all = D.simulateAll(reqs, head, cyl, cfgOf());
      const best = Math.min(...D.ALGOS.map((a) => all[a.id].total)), max = Math.max(...D.ALGOS.map((a) => all[a.id].total));
      const rows = D.ALGOS.map((a) => el('tr', null, el('td', null, a.short), el('td', { class: all[a.id].total === best ? 'best' : '' }, all[a.id].total), el('td', null, fmt(all[a.id].avg, 2)), el('td', null, all[a.id].countedMoves)));
      const bars = D.ALGOS.map((a) => el('div', { class: 'dk-bar-row' }, el('span', { class: 'dk-bar-label' }, a.short),
        el('div', { class: 'dk-bar-track' }, el('div', { class: 'dk-bar' + (all[a.id].total === best ? ' best' : ''), style: { width: (max ? (all[a.id].total / max) * 100 : 0) + '%' } })), el('b', { class: 'mono' }, all[a.id].total)));
      cmpHost.replaceChildren(
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Total seek distance by algorithm'), el('span', { class: 'sub' }, 'Shorter is better')),
          el('div', { class: 'dk-bars' }, bars),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, ['Algorithm', 'Total seek', 'Average per request', 'Counted moves'].map((h) => el('th', null, h)))), el('tbody', null, rows))),
          el('p', { class: 'note', style: { marginTop: '10px' } }, 'Fewest cylinders moved: ' + D.ALGOS.filter((a) => all[a.id].total === best).map((a) => a.short).join(' and ') + ' (' + best + '). Lowest total is not the whole story: SSTF can starve far requests and SCAN-style algorithms give more even waiting.')),
        el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Seek paths side by side')),
          el('div', { class: 'dk-multiples' }, D.ALGOS.map((a) => el('div', { class: 'dk-mini' }, el('b', null, a.short + ' · ' + all[a.id].total), seekChart(all[a.id], all[a.id].moves.length, { compact: true }))))));
    }

    // setTab(): switch between the animation and the comparison.
    function setTab(t) {
      state.tab = t; save();
      const viz = t === 'viz';
      vizHost.hidden = !viz; cmpHost.hidden = viz; aboutHost.hidden = !viz;
      tabViz.setAttribute('aria-selected', String(viz)); tabCmp.setAttribute('aria-selected', String(!viz));
      if (!viz && valid) buildCompare();
    }

    renderAlgo(); renderFields();
    setTab(state.tab === 'cmp' ? 'cmp' : 'viz');
    recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.disk = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
