/* Page Replacement view: reference strip, RAM frames, eviction order, live hit/fault counts,
   a trace table that fills in as you step, and a compare tab with a faults-vs-frames chart (Belady's anomaly). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, fmt, restart, icon, debounce, clamp } = NS.util;
  const G = NS.paging;
  const KEY = 'oslab.paging.v1';

  // series styling for the chart: colour + marker + dash, so identity never depends on colour alone
  const SERIES = {
    fifo: { color: '#E58A00', marker: 'circle', dash: '' },
    lru: { color: '#2F6BFF', marker: 'square', dash: '7 4' },
    opt: { color: '#0FA36B', marker: 'diamond', dash: '2 4' },
    clock: { color: '#B046D6', marker: 'triangle', dash: '10 3 2 3' }
  };
  // The chart plots only these algorithms (the engine's CHART_ALGOS); the table lists every algorithm.
  const CHART = G.ALGOS.filter((a) => G.CHART_ALGOS.includes(a.id));

  // marker(): draw a chart point as a circle, square or diamond, with a tooltip. Series are told apart by
  // shape and dash pattern as well as colour, so the chart still works for colour-blind readers.
  function marker(kind, x, y, color, title) {
    const common = { fill: color, stroke: 'var(--surface)', 'stroke-width': 2 };
    let n;
    if (kind === 'circle') n = svg('circle', Object.assign({ cx: x, cy: y, r: 5 }, common));
    else if (kind === 'square') n = svg('rect', Object.assign({ x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1.5 }, common));
    else if (kind === 'triangle') n = svg('path', Object.assign({ d: 'M' + x + ' ' + (y - 6.5) + 'L' + (x + 6) + ' ' + (y + 5) + 'L' + (x - 6) + ' ' + (y + 5) + 'Z' }, common));
    else n = svg('path', Object.assign({ d: 'M' + x + ' ' + (y - 6.5) + 'L' + (x + 6.5) + ' ' + y + 'L' + x + ' ' + (y + 6.5) + 'L' + (x - 6.5) + ' ' + y + 'Z' }, common));
    n.appendChild(svg('title', { text: title }));
    return n;
  }

  // mount(host): build the Page Replacement screen and return { activate, deactivate } for app.js.
  // Layout: header, algorithm chips, Visualize / Compare tabs, then a two-column workspace
  // (left: memory animation, explanation, trace table; right: the editable problem).
  function mount(host) {
    // Starting problem; your edits persist in localStorage.
    const defaults = () => ({ refsText: G.PRESETS[0].refs, frames: 3, algo: 'fifo', optTie: 'fifo', nruClear: 4, tab: 'viz' });
    let state = Object.assign(defaults(), store.get(KEY, {}));
    if (!G.BY_ID[state.algo]) state = defaults();

    // sim = engine result (list of steps); refs = parsed reference string; ui = handles to the live DOM pieces.
    let sim = null, refs = [], ui = null, valid = false;
    const save = () => store.set(KEY, state);

    /* ---- skeleton ---- */
    const view = el('section', { class: 'view', 'aria-labelledby': 'pg-title' });
    view.appendChild(el('div', { class: 'view-head' },
      el('h2', { id: 'pg-title' }, 'Page Replacement'),
      el('p', null, 'Memory has only a few frames. When a page is needed that is not in memory, a page fault happens, and if memory is full the OS must evict a page. Which one it picks is the algorithm.')));
    const chipRow = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Page replacement algorithm' });
    const tabViz = el('button', { type: 'button', role: 'tab', onclick: () => setTab('viz') }, 'Visualize');
    const tabCmp = el('button', { type: 'button', role: 'tab', onclick: () => setTab('cmp') }, 'Compare and Belady’s anomaly');
    view.append(chipRow, el('div', { class: 'tabs', role: 'tablist' }, tabViz, tabCmp));
    const ws = el('div', { class: 'workspace' });
    const colMain = el('div', { class: 'col' });
    const colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide);
    view.appendChild(ws);
    host.appendChild(view);

    const aboutHost = el('div', { class: 'card' });
    const vizHost = el('div', { class: 'col' });
    const cmpHost = el('div', { class: 'col' });
    colMain.append(aboutHost, vizHost, cmpHost);

    // The animated 'Memory' card: reference strip, RAM frames, eviction-order chips and live counters.
    const stageCard = el('div', { class: 'card' });
    const refStrip = el('div', { class: 'refstrip', role: 'list', 'aria-label': 'Page reference string' });
    const ramRow = el('div', { class: 'ram' });
    const orderBox = el('div', { class: 'order' });
    const statsBox = el('div', { class: 'stats' });
    const playerHost = el('div');
    stageCard.append(
      el('div', { class: 'card-head' }, el('h3', null, 'Memory'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')),
      el('p', { class: 'hint' }, 'Reference string: pages the program asks for, in order'),
      refStrip, ramRow, orderBox, statsBox, el('div', { style: { height: '14px' } }), playerHost);

    const whyCard = el('div', { class: 'card' });
    const whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);

    const traceCard = el('div', { class: 'card' });
    vizHost.append(stageCard, whyCard, traceCard);

    // Shared playback bar; each step is the state after one more page reference.
    const player = new NS.Player(playerHost, { label: 'Reference', onChange: (k) => draw(k) });

    /* ---- problem panel ---- */
    // Inputs for the problem: the reference string and the number of frames (with +/- stepper).
    const refsInput = el('input', { type: 'text', id: 'pg-refs', value: state.refsText, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Page reference string',
      oninput: (e) => { state.refsText = e.target.value; save(); schedule(); } });
    const framesInput = el('input', { type: 'number', id: 'pg-frames', min: 1, max: 10, value: state.frames, 'aria-label': 'Number of frames',
      oninput: (e) => { state.frames = e.target.value; save(); schedule(); } });
    const stepBtn = (d, label) => el('button', { type: 'button', 'aria-label': (d > 0 ? 'More' : 'Fewer') + ' frames', onclick: () => {
      state.frames = clamp((parseInt(state.frames, 10) || 3) + d, 1, G.LIMITS.maxFrames); framesInput.value = state.frames; save(); recompute();
    } }, label);
    const presetSel = el('select', { id: 'pg-preset', 'aria-label': 'Load an example' },
      el('option', { value: '' }, 'Load an example…'), G.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; the engine computes the result.
    presetSel.addEventListener('change', () => {
      const p = G.PRESETS.find((x) => x.id === presetSel.value); if (!p) return;
      state.refsText = p.refs; state.frames = p.frames; if (p.algo) state.algo = p.algo;
      refsInput.value = p.refs; framesInput.value = p.frames; presetNote.textContent = p.note;
      save(); renderAlgo(); recompute();
    });
    const errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    const parseNote = el('p', { class: 'hint' });
    const settings = el('div', { class: 'field' });
    const lenInput = el('input', { type: 'number', id: 'pg-len', min: 5, max: 40, value: 16, 'aria-label': 'Random string length', style: { width: '64px' } });
    const rangeInput = el('input', { type: 'number', id: 'pg-range', min: 2, max: 20, value: 8, 'aria-label': 'Number of different pages', style: { width: '64px' } });
    const probCard = el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Your problem')),
      el('div', { class: 'col', style: { gap: '12px' } },
        el('div', { class: 'field' }, presetSel, presetNote),
        el('div', { class: 'field' }, el('label', { for: 'pg-refs' }, 'Reference string'), refsInput,
          el('p', { class: 'hint' }, 'Separate pages with spaces or commas. Letters work too.'), parseNote),
        el('div', { class: 'field' }, el('label', { for: 'pg-frames' }, 'Number of frames'),
          el('div', { class: 'stepper' }, stepBtn(-1, '−'), framesInput, stepBtn(1, '+'))),
        errBox, settings,
        el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Random string'),
          el('div', { class: 'row-inline' },
            el('label', { class: 'hint', for: 'pg-len' }, 'length'), lenInput,
            el('label', { class: 'hint', for: 'pg-range' }, 'pages'), rangeInput,
            el('button', { type: 'button', class: 'btn', onclick: randomize }, icon('dice', 16), 'Generate')))));
    colSide.appendChild(probCard);

    // renderSettings(): Optimal has a tie option; NRU has how often its reference bits are cleared.
    function renderSettings() {
      if (state.algo === 'nru') {
        settings.hidden = false;
        settings.replaceChildren(
          el('label', { for: 'pg-nru' }, 'Clear all reference bits every N references'),
          el('input', { type: 'number', id: 'pg-nru', min: 1, max: 20, step: 1, value: state.nruClear, oninput: (e) => { state.nruClear = e.target.value; save(); recompute(); } }),
          el('p', { class: 'hint' }, 'A small N forgets quickly; a large N makes NRU behave like FIFO.'));
        return;
      }
      if (state.algo !== 'opt') { settings.replaceChildren(); settings.hidden = true; return; }
      settings.hidden = false;
      settings.replaceChildren(
        el('label', { for: 'pg-tie' }, 'If several pages are never used again'),
        el('select', { id: 'pg-tie', onchange: (e) => { state.optTie = e.target.value; save(); recompute(); } },
          el('option', { value: 'fifo', selected: state.optTie === 'fifo' }, 'Evict the one in memory longest'),
          el('option', { value: 'slot', selected: state.optTie === 'slot' }, 'Evict the one in the lowest frame')),
        el('p', { class: 'hint' }, 'Textbooks differ here. Match your course.'));
    }

    // randomize(): generate a random reference string of the chosen length from the chosen number of pages.
    function randomize() {
      const len = clamp(parseInt(lenInput.value, 10) || 16, 5, 40);
      const range = clamp(parseInt(rangeInput.value, 10) || 8, 2, 20);
      state.refsText = Array.from({ length: len }, () => Math.floor(Math.random() * range)).join(' ');
      refsInput.value = state.refsText; presetSel.value = ''; presetNote.textContent = '';
      save(); recompute();
    }

    // renderAlgo(): algorithm chips and the 'about' card (rule, memory hook, watch out for).
    function renderAlgo() {
      chipRow.replaceChildren(...G.ALGOS.map((a) => el('button', {
        type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(a.id === state.algo),
        onclick: () => { state.algo = a.id; save(); renderAlgo(); renderSettings(); recompute(); }
      }, a.short)));
      const a = G.BY_ID[state.algo];
      aboutHost.replaceChildren(el('details', { class: 'about', open: true },
        el('summary', null, a.name),
        el('dl', null, el('dt', null, 'The rule'), el('dd', null, a.rule), el('dt', null, 'Memory hook'), el('dd', null, a.hook), el('dt', null, 'Watch out for'), el('dd', null, a.watch))));
    }

    /* ---- recompute ---- */
    // Debounced recompute so we simulate once per pause in typing.
    const schedule = debounce(() => recompute(), 160);

    // recompute(): parse -> validate -> simulate -> rebuild the visuals. Invalid input shows errors and keeps
    // the previous animation untouched.
    function recompute() {
      const parsed = G.parseRefs(state.refsText);
      const v = G.validate(parsed.tokens, state.frames);
      parseNote.textContent = parsed.splitDigits ? 'No separators found, so each digit is read as its own page.' : '';
      errBox.hidden = v.ok; errBox.replaceChildren(...v.errors.map((m) => el('div', null, m)));
      if (!v.ok) return;
      refs = parsed.tokens; valid = true;
      sim = G.simulate(refs, +state.frames, state.algo, { optTie: state.optTie, nruClear: state.nruClear });
      buildStage(); buildTrace();
      if (state.tab === 'cmp') buildCompare();
      player.setStops(sim.steps.map((_, i) => i), Math.min(player.pos, sim.steps.length - 1));
    }

    // buildStage(): create the reference-string cells, the RAM frame sticks and the stat tiles for a new run.
    function buildStage() {
      const n = +state.frames;
      refStrip.replaceChildren();
      const cells = refs.map((r, j) => {
        const c = el('div', { class: 'rcell future', role: 'listitem', title: 'Reference ' + (j + 1) }, el('b', null, r), el('i', null, ''));
        refStrip.appendChild(c); return c;
      });
      ramRow.replaceChildren();
      const slots = [];
      for (let s = 0; s < n; s++) {
        const stick = el('div', { class: 'stick' }, '–');
        const out = el('span', { class: 'out', hidden: true });
        const node = el('div', { class: 'slot empty' }, out, stick, el('div', { class: 'flabel' }, 'frame ' + s));
        ramRow.appendChild(node); slots.push({ node, stick, out });
      }
      const verdict = el('div', { class: 'verdict' });
      ramRow.appendChild(verdict);
      const sv = {};
      const tile = (key, label) => { const b = el('b', null, '0'); sv[key] = b; return el('div', { class: 'stat' }, el('span', null, label), b); };
      statsBox.replaceChildren(tile('faults', 'Page faults'), tile('hits', 'Hits'), tile('hr', 'Hit ratio'), tile('fr', 'Fault ratio'));
      ui = { cells, slots, verdict, sv };
    }

    // draw(k): show the state after k references. Reference cells turn green (hit) or red (fault) as they are
    // processed; the changed RAM frame pops; the eviction-order list, counters, explanation and trace table
    // all update from the engine's step record.
    function draw(k) {
      if (!sim || !ui) return;
      const st = sim.steps[k];
      // reference strip
      ui.cells.forEach((c, j) => {
        const done = j < k;
        c.className = 'rcell ' + (done ? (sim.steps[j + 1].hit ? 'hit' : 'fault') : 'future') + (j === k - 1 ? ' now' : '');
        c.lastChild.textContent = done ? (sim.steps[j + 1].hit ? '✓' : '✗') : '';
      });
      const cur = ui.cells[k - 1];
      if (cur) refStrip.scrollLeft = Math.max(0, cur.offsetLeft - refStrip.clientWidth / 2 + 20);
      else refStrip.scrollLeft = 0;
      // RAM
      ui.slots.forEach((s, i) => {
        const p = st.frames[i];
        s.stick.textContent = p === null ? 'empty' : p;
        s.node.className = 'slot' + (p === null ? ' empty' : '');
        s.out.hidden = true;
        if (k > 0 && i === st.slot) {
          s.node.classList.add(st.hit ? 'hit' : 'load');
          restart(s.node, 'pop');
          if (!st.hit && st.victim !== null) { s.out.hidden = false; s.out.textContent = 'out: ' + st.victim; }
        }
      });
      ui.verdict.className = 'verdict' + (k > 0 ? ' ' + (st.hit ? 'hit' : 'fault') : '');
      ui.verdict.replaceChildren(...(k === 0
        ? [el('span', { class: 'req' }, 'Memory is empty')]
        : [el('span', { class: 'req' }, 'Request for page ' + st.page), el('span', { class: 'big' }, st.hit ? '✓ Hit' : '✗ Page fault')]));
      // order panel
      const m = st.meta, full = m.items.length === sim.nFrames;
      orderBox.replaceChildren(el('div', { class: 'otitle' }, m.title),
        m.items.length ? el('div', { class: 'order-list' }, m.items.map((it, i) => el('div', { class: 'ochip' + (i === 0 && full ? ' first' : '') }, el('b', null, it.page), el('small', null, it.note))))
          : el('p', { class: 'hint' }, 'Nothing in memory yet.'));
      // stats
      ui.sv.faults.textContent = st.faults; ui.sv.hits.textContent = st.hits;
      ui.sv.hr.textContent = k ? fmt((st.hits / k) * 100, 1) + '%' : '–';
      ui.sv.fr.textContent = k ? fmt((st.faults / k) * 100, 1) + '%' : '–';
      // why
      const kids = [el('p', { class: 'muted' }, k === 0 ? 'Before the first reference' : 'After reference ' + k + ' of ' + sim.refs.length), el('p', null, st.text)];
      if (st.cands && st.cands.length) {
        kids.push(el('div', { class: 'decision' }, el('b', null, 'Candidates to evict'),
          el('div', { class: 'cand' }, st.cands.map((c) => el('span', { class: c.page === st.victim ? 'win' : 'lose' }, c.page + ' · ' + c.label)))));
      }
      if (k === sim.steps.length - 1) kids.push(el('p', null, 'Done: ' + sim.faults + ' page fault' + (sim.faults === 1 ? '' : 's') + ' and ' + sim.hits + ' hit' + (sim.hits === 1 ? '' : 's') + ' out of ' + sim.refs.length + ' references.'));
      whyBody.replaceChildren(...kids);
      drawTrace(k);
    }

    /* ---- trace table ---- */
    // The 'classic table': the grid students are expected to write in exams (one column per reference).
    let trace = null;
    // buildTrace(): create the empty table (reference row, one row per frame, result row).
    function buildTrace() {
      const n = sim.nFrames, R = refs.length;
      const mk = (cls, text) => el('td', { class: cls }, text);
      const refRow = [], frameRows = [], resRow = [];
      const trs = [];
      const hdr = el('tr', null, el('th', null, 'Reference'));
      refs.forEach((r) => { const td = mk('ref', r); hdr.appendChild(td); refRow.push(td); });
      trs.push(hdr);
      for (let s = 0; s < n; s++) {
        const tr = el('tr', null, el('th', null, 'Frame ' + s)); const row = [];
        for (let j = 0; j < R; j++) { const td = mk('future', ''); tr.appendChild(td); row.push(td); }
        frameRows.push(row); trs.push(tr);
      }
      const rr = el('tr', null, el('th', null, 'Result'));
      for (let j = 0; j < R; j++) { const td = mk('res future', ''); rr.appendChild(td); resRow.push(td); }
      trs.push(rr);
      const wrap = el('div', { class: 'trace-wrap' }, el('table', { class: 'trace' }, el('tbody', null, trs)));
      traceCard.replaceChildren(
        el('div', { class: 'card-head' }, el('h3', null, 'The classic table'), el('span', { class: 'sub' }, 'The same thing as exam answers are written')),
        wrap,
        el('div', { class: 'legend' }, el('span', null, el('i', { style: { background: 'var(--fault-soft)', border: '1px solid var(--fault)' } }), '✗ page fault: page loaded here'),
          el('span', null, el('i', { style: { background: 'var(--hit-soft)', border: '1px solid var(--hit)' } }), '✓ hit: page already in memory')));
      trace = { refRow, frameRows, resRow, wrap };
    }

    // drawTrace(k): fill in the columns up to reference k; later columns stay hidden so the table 'writes itself'.
    function drawTrace(k) {
      if (!trace) return;
      const R = refs.length;
      for (let j = 0; j < R; j++) {
        const st = sim.steps[j + 1];
        const show = j < k;
        for (let s = 0; s < sim.nFrames; s++) {
          const td = trace.frameRows[s][j];
          let cls = show ? '' : 'future';
          if (show && st.slot === s) cls = st.hit ? 'hitcol' : 'changed';
          if (j === k - 1) cls += ' now';
          td.className = cls.trim();
          td.textContent = show ? (st.frames[s] === null ? '' : st.frames[s]) : '';
        }
        const rt = trace.resRow[j];
        rt.className = 'res ' + (show ? (st.hit ? 'hit' : 'fault') : 'future');
        rt.textContent = show ? (st.hit ? '✓' : '✗') : '';
        rt.title = show ? (st.hit ? 'hit' : 'page fault') : '';
      }
      const cur = trace.refRow[k - 1];
      if (cur) trace.wrap.scrollLeft = Math.max(0, cur.offsetLeft - trace.wrap.clientWidth / 2);
      else trace.wrap.scrollLeft = 0;
    }

    /* ---- compare tab ---- */
    // buildCompare(): run FIFO, LRU and Optimal on the same string, show the fault table, then sweep the number
    // of frames to draw the faults-vs-frames chart. Any rise in faults when frames increase is Belady's anomaly.
    function buildCompare() {
      const cfg = { optTie: state.optTie, nruClear: state.nruClear };
      const runs = G.ALGOS.map((a) => G.simulate(refs, +state.frames, a.id, cfg));
      const best = Math.min.apply(null, runs.map((r) => r.faults));
      const table = el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' },
        el('thead', null, el('tr', null, ['Algorithm', 'Page faults', 'Hits', 'Hit ratio', 'Fault ratio'].map((h) => el('th', null, h)))),
        el('tbody', null, runs.map((r) => el('tr', null,
          el('td', null, G.BY_ID[r.algo].short),
          el('td', { class: r.faults === best ? 'best' : '' }, r.faults), el('td', null, r.hits),
          el('td', null, fmt(r.hitRatio * 100, 1) + '%'), el('td', null, fmt(r.faultRatio * 100, 1) + '%'))))));
      // How many frame counts to plot (at least a few beyond the current setting).
      const maxF = clamp(Math.max(+state.frames + 3, 7), 4, 10);
      const sweeps = {};
      CHART.forEach((a) => { sweeps[a.id] = G.sweep(refs, a.id, maxF, cfg); });
      const anomalies = {};
      CHART.forEach((a) => { anomalies[a.id] = G.anomalies(sweeps[a.id]); });
      const notes = [];
      CHART.forEach((a) => anomalies[a.id].forEach((an) =>
        notes.push(a.short + ': with ' + an.from + ' frame' + (an.from === 1 ? '' : 's') + ' there are ' + an.before + ' faults, but with ' + an.to + ' frames there are ' + an.after + '. More memory made it worse.')));

      cmpHost.replaceChildren(
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', null, 'Every algorithm on your problem'), el('span', { class: 'sub' }, state.frames + ' frames, ' + refs.length + ' references')),
          table,
          el('p', { class: 'note', style: { marginTop: '10px' } }, 'Optimal is the lower bound: no algorithm can have fewer faults. The gap between it and the others is what a smarter guess could still save.')),
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', null, 'Page faults as memory grows'), el('span', { class: 'sub' }, 'Your reference string, 1 to ' + maxF + ' frames')),
          chart(sweeps, anomalies, maxF),
          el('div', { class: 'chart-legend' }, CHART.map((a) => el('span', null,
            svg('svg', { width: 34, height: 12, viewBox: '0 0 34 12', 'aria-hidden': 'true' },
              svg('line', { x1: 0, y1: 6, x2: 34, y2: 6, stroke: SERIES[a.id].color, 'stroke-width': 2.5, 'stroke-dasharray': SERIES[a.id].dash }),
              marker(SERIES[a.id].marker, 17, 6, SERIES[a.id].color, a.short)), a.short))),
          notes.length
            ? el('div', { class: 'callout', style: { marginTop: '12px' } }, el('b', null, 'Belady’s anomaly found. '), notes.join(' '))
            : el('p', { class: 'note', style: { marginTop: '12px' } }, 'On this string, more frames never increased the faults. Try the “Belady’s anomaly” example (1 2 3 4 1 2 5 1 2 3 4 5) to see FIFO get worse with 4 frames than with 3.')));
    }

    // chart(): hand-built SVG line chart (no library). X = number of frames, Y = page faults.
    // Each series has its own colour, marker shape and dash; anomalies get a red ring; the lines are
    // labelled directly at the right end instead of relying only on a legend.
    function chart(sweeps, anomalies, maxF) {
      const W = 640, H = 300, m = { l: 44, r: 62, t: 14, b: 44 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const peak = Math.max.apply(null, [].concat.apply([], CHART.map((a) => sweeps[a.id])));
      // Pick a tidy Y-axis step from the largest value, then round the axis maximum up to a multiple of it.
      const stepY = peak <= 6 ? 1 : peak <= 12 ? 2 : peak <= 30 ? 5 : 10;
      const yMax = Math.max(stepY, Math.ceil(peak / stepY) * stepY);
      // Scales: map a frame count to an x pixel and a fault count to a y pixel.
      const X = (f) => m.l + ((f - 1) / (maxF - 1)) * iw;
      const Y = (v) => m.t + ih - (v / yMax) * ih;
      const root = svg('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Line chart of page faults against number of frames for FIFO, LRU and Optimal' });
      for (let v = 0; v <= yMax; v += stepY) {
        root.appendChild(svg('line', { class: v === 0 ? 'axis-line' : 'gridline', x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v) }));
        root.appendChild(svg('text', { class: 'tick-label', x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end', text: v }));
      }
      for (let f = 1; f <= maxF; f++) root.appendChild(svg('text', { class: 'tick-label', x: X(f), y: m.t + ih + 18, 'text-anchor': 'middle', text: f }));
      root.appendChild(svg('text', { x: m.l + iw / 2, y: H - 6, 'text-anchor': 'middle', text: 'Number of frames' }));
      root.appendChild(svg('text', { x: 12, y: m.t + ih / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + ih / 2) + ')', text: 'Page faults' }));
      // current frame count guide
      const cf = clamp(+state.frames, 1, maxF);
      root.appendChild(svg('line', { x1: X(cf), x2: X(cf), y1: m.t, y2: m.t + ih, stroke: 'var(--accent)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: 0.7 }));
      root.appendChild(svg('text', { x: X(cf), y: m.t - 2, 'text-anchor': 'middle', fill: 'var(--accent)', style: 'fill:var(--accent)', text: 'yours' }));
      CHART.forEach((a) => {
        const s = SERIES[a.id], vals = sweeps[a.id];
        root.appendChild(svg('polyline', { points: vals.map((v, i) => X(i + 1) + ',' + Y(v)).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-dasharray': s.dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      });
      CHART.forEach((a) => {
        const s = SERIES[a.id], vals = sweeps[a.id];
        anomalies[a.id].forEach((an) => root.appendChild(svg('circle', { cx: X(an.to), cy: Y(an.after), r: 11, fill: 'none', stroke: 'var(--fault)', 'stroke-width': 2 }, svg('title', { text: 'Belady’s anomaly: ' + a.short + ' gets worse going from ' + an.from + ' to ' + an.to + ' frames' }))));
        vals.forEach((v, i) => root.appendChild(marker(s.marker, X(i + 1), Y(v), s.color, a.short + ', ' + (i + 1) + ' frame' + (i ? 's' : '') + ': ' + v + ' faults')));
      });
      // direct labels at the right end, nudged apart if they would collide
      const ends = CHART.map((a) => ({ a, y: Y(sweeps[a.id][maxF - 1]) })).sort((p, q) => p.y - q.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      ends.forEach((e) => root.appendChild(svg('text', { x: m.l + iw + 12, y: e.y + 4, text: e.a.short, style: 'fill:var(--ink)', 'font-weight': 600 })));
      return root;
    }

    // setTab(): switch between the animation and the comparison.
    function setTab(t) {
      state.tab = t; save();
      const viz = t === 'viz';
      vizHost.hidden = !viz; cmpHost.hidden = viz; aboutHost.hidden = !viz;
      tabViz.setAttribute('aria-selected', String(viz)); tabCmp.setAttribute('aria-selected', String(!viz));
      if (!viz && valid) buildCompare();
    }

    renderAlgo(); renderSettings();
    setTab(state.tab === 'cmp' ? 'cmp' : 'viz');
    recompute();

    return {
      // app.js calls activate() when this concept is shown: send keyboard shortcuts to this player.
      activate() { NS.Player.current = player; },
      deactivate() { player.pause(); }
    };
  }

  NS.views = NS.views || {};
  NS.views.paging = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
