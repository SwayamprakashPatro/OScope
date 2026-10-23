/* CPU Scheduling view: problem editor, animated stage (queue → CPU → finished), Gantt chart,
   "why did that happen" panel, live results table, and compare-all-algorithms tab. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, colorFor, textOn, clamp, store, fmt, icon, debounce } = NS.util;
  const S = NS.scheduling;
  const KEY = 'oslab.scheduling.v1';

  // pidIndex('P3') -> 2: every process has a fixed colour, taken from its number, so P1 is the same colour
  // in the stage, Gantt chart, tables and chips.
  const pidIndex = (pid) => parseInt(pid.slice(1), 10) - 1;
  const pillStyle = (pid) => { const c = colorFor(pidIndex(pid)); return { background: c, color: textOn(c) }; };
  // pill(pid): a small coloured badge with the process name, used in tables and text.
  const pill = (pid) => el('span', { class: 'pill', style: pillStyle(pid) }, pid);

  /* ================= Stage: processes physically move between zones ================= */
  // Stage: the animated 'machine'. Each process is a token (a div) that physically slides between four
  // zones: Not arrived -> Ready queue -> CPU -> Finished. It never computes anything; update(frame) just
  // places every token according to the frame the engine recorded, and CSS transitions animate the move.
  function Stage(host, sim) {
    const root = el('div', { class: 'stage', role: 'img', 'aria-label': 'Animation of processes moving from the ready queue to the CPU and then to the finished area' });
    host.appendChild(root);
    // The four zones (rectangles) and the clock. Their positions are set in measure().
    const zArr = el('div', { class: 'zone lane' }, el('span', { class: 'zlabel' }, 'Not arrived yet'));
    const zReady = el('div', { class: 'zone lane' }, el('span', { class: 'zlabel' }, 'Ready queue (front of the line is nearest the CPU)'));
    const zCpu = el('div', { class: 'zone zone-cpu' }, el('span', { class: 'zlabel' }, 'CPU'));
    const cpuInfo = el('div', { class: 'cpu-info' }, 'idle');
    zCpu.appendChild(cpuInfo);
    const zDone = el('div', { class: 'zone lane' }, el('span', { class: 'zlabel' }, 'Finished'));
    const arrow1 = el('div', { class: 'flowhint' }, '→');
    const clock = el('div', { class: 'clock' }, 'time ', el('b', null, '0'));
    root.append(zArr, zReady, zCpu, zDone, arrow1, clock);

    // One token per process, created once; update() only moves and restyles them.
    const chips = {};
    sim.procs.forEach((p) => {
      const c = colorFor(p.idx);
      const node = el('div', { class: 'proc is-waiting', style: { background: c, color: textOn(c) } },
        el('b', null, p.pid), el('small', null, ''), el('i', { class: 'bar' }));
      chips[p.pid] = node;
      root.appendChild(node);
    });

    // L = current layout rectangles; last = the frame most recently drawn (for redrawing on resize).
    let L = null, last = sim.frames[0];
    const CW = 56, CH = 56, PAD = 10;

    // measure(): compute where each zone goes from the stage's current width. Wide screens put the lanes
    // side by side (Ready -> CPU -> Finished); narrow screens stack them vertically so the stage still
    // fits on a phone.
    function measure() {
      const W = root.clientWidth || 600;
      const T0 = 44;
      let g;
      if (W >= 720) {
        const rw = Math.round(W * 0.44);
        const laneY = T0 + 104, laneH = 96;
        const cpu = { x: 10 + rw + 48, y: laneY + laneH / 2 - 65, w: 130, h: 130 };
        const dx = cpu.x + cpu.w + 48;
        g = {
          H: cpu.y + cpu.h + 18, wide: true,
          arr: { x: 10, y: T0, w: W - 20, h: 90 },
          ready: { x: 10, y: laneY, w: rw, h: laneH },
          cpu, done: { x: dx, y: laneY, w: W - 10 - dx, h: laneH },
          arrow: { x: 10 + rw + 14, y: laneY + laneH / 2, t: '→' }
        };
      } else {
        const cpu = { x: Math.round((W - 130) / 2), y: T0 + 102 + 90 + 30, w: 130, h: 130 };
        g = {
          H: cpu.y + cpu.h + 30 + 90 + 14, wide: false,
          arr: { x: 10, y: T0, w: W - 20, h: 90 },
          ready: { x: 10, y: T0 + 102, w: W - 20, h: 90 },
          cpu, done: { x: 10, y: cpu.y + cpu.h + 30, w: W - 20, h: 90 },
          arrow: { x: W / 2 - 8, y: cpu.y - 15, t: '↓' }
        };
      }
      L = g;
      root.style.height = g.H + 'px';
      [[zArr, g.arr], [zReady, g.ready], [zCpu, g.cpu], [zDone, g.done]].forEach(([z, r]) => {
        Object.assign(z.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      });
      Object.assign(arrow1.style, { left: g.arrow.x + 'px', top: g.arrow.y + 'px' });
      arrow1.textContent = g.arrow.t;
    }

    // slot(): position of the i-th of n tokens inside a lane. Tokens overlap slightly when the lane is crowded,
    // and the ready queue fills from the CPU side so the front of the line sits next to the CPU.
    function slot(lane, i, n, fromRight) {
      const step = n <= 1 ? 0 : clamp((lane.w - 2 * PAD - CW) / (n - 1), 12, CW + 8);
      const x = fromRight ? lane.x + lane.w - PAD - CW - i * step : lane.x + PAD + i * step;
      return { x, y: lane.y + Math.max(28, (lane.h - CH) / 2 + 8) };
    }

    // put(): move one token to a position and restyle it (waiting / ready / running / done), set its label
    // ('3 left') and its progress bar (fraction of burst remaining).
    function put(pid, pos, cls, text, frac) {
      const n = chips[pid];
      n.style.transform = 'translate(' + Math.round(pos.x) + 'px,' + Math.round(pos.y) + 'px)';
      n.className = 'proc ' + cls;
      n.querySelector('small').textContent = text;
      n.querySelector('.bar').style.width = Math.round(frac * 100) + '%';
      n.style.zIndex = cls === 'is-running' ? 4 : 2;
    }

    // update(frame): lay out every token for this frame: not-arrived, ready queue (in order), finished,
    // and the running process on the CPU, then update the clock and the CPU caption.
    function update(frame) {
      last = frame;
      if (!L) measure();
      clock.lastChild.textContent = frame.t;
      const byPid = {}; sim.procs.forEach((p) => { byPid[p.pid] = p; });
      frame.notArrived.forEach((pid, i) => put(pid, slot(L.arr, i, frame.notArrived.length, false), 'is-waiting', 'at ' + byPid[pid].arrival, 1));
      frame.queue.forEach((pid, k) => put(pid, slot(L.ready, k, frame.queue.length, true), 'is-ready', frame.remaining[pid] + ' left', frame.remaining[pid] / byPid[pid].burst));
      frame.done.forEach((pid, i) => put(pid, slot(L.done, i, frame.done.length, false), 'is-done', 'done', 0));
      if (frame.running) {
        const pid = frame.running;
        put(pid, { x: L.cpu.x + (L.cpu.w - CW) / 2, y: L.cpu.y + (L.cpu.h - CH) / 2 - 8 }, 'is-running', frame.remaining[pid] + ' left', frame.remaining[pid] / byPid[pid].burst);
        cpuInfo.textContent = S.isSliced(sim.cfg.algo) ? 'slice ' + frame.slice + ' of ' + sim.cfg.quantum : 'running';
        zCpu.classList.add('is-busy');
      } else {
        cpuInfo.textContent = frame.t >= sim.total ? 'all done' : 'idle';
        zCpu.classList.remove('is-busy');
      }
    }

    // Re-measure and redraw whenever the stage changes width (window resize, phone rotation).
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { measure(); update(last); }) : null;
    if (ro) ro.observe(root);
    measure();
    update(sim.frames[0]);
    return { update, destroy() { if (ro) ro.disconnect(); root.remove(); }, relayout() { measure(); update(last); } };
  }

  /* ================= Gantt chart ================= */
  // Gantt: the timeline of who used the CPU. Built from the engine's per-tick list merged into segments.
  // In animated mode it shows only the part up to the current time; `static` draws the whole chart
  // (used in the Compare tab).
  function Gantt(host, sim, opts) {
    const T = sim.total;
    const isStatic = !!(opts && opts.static);
    const track = el('div', { class: 'gantt-track', style: { '--T': T } });
    const axis = el('div', { class: 'gaxis' });
    const wrap = el('div', { class: 'gantt' + (isStatic ? ' static' : ''), role: 'img', 'aria-label': 'Gantt chart of CPU usage over time' }, track, axis);
    host.appendChild(wrap);
    // Choose the tick spacing on the time axis so labels never crowd, whatever the total length.
    const step = T <= 15 ? 1 : T <= 30 ? 2 : T <= 60 ? 5 : T <= 120 ? 10 : 20;
    const ticks = {};
    const mark = (k) => {
      const n = el('span', { class: 'gtick', style: { left: (k / T) * 100 + '%' } }, k);
      ticks[k] = n; axis.appendChild(n);
    };
    for (let k = 0; k <= T; k += step) mark(k);
    if (T % step !== 0 && T - Math.floor(T / step) * step > step / 2) mark(T);
    const segs = new Map();
    const now = isStatic ? null : el('div', { class: 'gnow' });
    if (now) track.appendChild(now);

    // update(t): show the timeline up to time t. Segments are keyed by 'pid@start' so existing bars are
    // reused (and animate their width as they grow) instead of being rebuilt.
    function update(t) {
      const merged = S.mergeTicks(sim.ticks, t);
      const seen = new Set();
      merged.forEach((sg) => {
        const key = sg.pid + '@' + sg.start;
        seen.add(key);
        let n = segs.get(key);
        if (!n) {
          n = el('div', { class: 'gseg' + (sg.pid === null ? ' idle' : '') });
          if (sg.pid !== null) { const c = colorFor(pidIndex(sg.pid)); n.style.background = c; n.style.color = textOn(c); n.textContent = sg.pid; }
          else n.textContent = 'idle';
          track.appendChild(n); segs.set(key, n);
        }
        n.style.left = (sg.start / T) * 100 + '%';
        n.style.width = ((sg.end - sg.start) / T) * 100 + '%';
        n.title = (sg.pid || 'idle') + ': ' + sg.start + ' → ' + sg.end;
      });
      segs.forEach((n, key) => { if (!seen.has(key)) { n.remove(); segs.delete(key); } });
      if (now) {
        now.style.display = t >= T ? 'none' : '';
        now.style.left = 'calc(' + (t / T) * 100 + '% + 1px)';
        now.style.width = 'calc(' + 100 / T + '% - 2px)';
      }
      Object.keys(ticks).forEach((k) => ticks[k].classList.toggle('is-now', !isStatic && +k === t));
    }
    update(isStatic ? T : 0);
    return { update };
  }

  /* ================= view ================= */
  // mount(host): build the whole Scheduling screen inside `host` and return { activate, deactivate }
  // for app.js. Layout: header, algorithm chips, Visualize / Compare tabs, and a two-column workspace
  // (left: animation + explanation + results; right: the editable problem).
  function mount(host) {
    // Starting problem. Your edits are saved in localStorage, so a refresh brings them back.
    const defaults = () => ({
      rows: S.PRESETS.find((p) => p.id === 'mixed').rows.map(([a, b, p]) => ({ arrival: a, burst: b, priority: p })),
      algo: 'srtf', quantum: 3, lowerIsHigher: true, tieBreak: 'arrival', rrArrivalsFirst: true, agingEvery: 3, seed: 1, mode: 'unit', tab: 'viz'
    });
    let state = Object.assign(defaults(), store.get(KEY, {}));
    if (!Array.isArray(state.rows) || !state.rows.length || !S.BY_ID[state.algo]) state = defaults();

    // sim = the latest simulation result; stage / gantt = the live visual components; lastValid = was the
    // previous input valid (used to keep showing the last good animation while you fix a typo).
    let sim = null, stage = null, gantt = null, resultsRefs = null, lastValid = false;
    const save = () => store.set(KEY, state);

    /* ---- skeleton ---- */
    const view = el('section', { class: 'view', 'aria-labelledby': 'sch-title' });
    view.appendChild(el('div', { class: 'view-head' },
      el('h2', { id: 'sch-title' }, 'CPU Scheduling'),
      el('p', null, 'Several processes want the CPU at the same time. The scheduler decides who runs next. Enter your own processes, pick an algorithm, and step through every decision.')));

    const chipRow = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Scheduling algorithm' });
    view.appendChild(chipRow);

    const tabsRow = el('div', { class: 'tabs', role: 'tablist' });
    const tabViz = el('button', { type: 'button', role: 'tab', onclick: () => setTab('viz') }, 'Visualize');
    const tabCmp = el('button', { type: 'button', role: 'tab', onclick: () => setTab('cmp') }, 'Compare all algorithms');
    tabsRow.append(tabViz, tabCmp);
    view.appendChild(tabsRow);

    // Two-column workspace: visualiser on the left, 'Your problem' editor on the right.
    const ws = el('div', { class: 'workspace' });
    const colMain = el('div', { class: 'col' });
    const colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide);
    view.appendChild(ws);
    host.appendChild(view);

    // main column parts
    const aboutHost = el('div', { class: 'card' });
    const vizHost = el('div', { class: 'col' });
    const cmpHost = el('div', { class: 'col' });
    colMain.append(aboutHost, vizHost, cmpHost);

    const stageCard = el('div', { class: 'card' });
    const stageSlot = el('div');
    // Shown when the current inputs are invalid but an older valid animation is still on screen.
    const stale = el('div', { class: 'stale', hidden: true }, 'Some values need fixing, so this animation still shows your last valid problem.');
    const modeRow = el('div', { class: 'mode' }, 'Step through:');
    const segMode = el('div', { class: 'seg' });
    const mUnit = el('button', { type: 'button', onclick: () => setMode('unit') }, 'Every time unit');
    const mEvent = el('button', { type: 'button', onclick: () => setMode('event') }, 'Key moments only');
    segMode.append(mUnit, mEvent);
    modeRow.appendChild(segMode);
    const playerHost = el('div');
    stageCard.append(
      el('div', { class: 'card-head' }, el('h3', null, 'The machine'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')),
      stale, stageSlot, el('div', { style: { height: '12px' } }), playerHost, modeRow);

    const ganttCard = el('div', { class: 'card' });
    const ganttSlot = el('div');
    ganttCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Gantt chart'), el('span', { class: 'sub' }, 'Who used the CPU, and when')), ganttSlot);

    const whyCard = el('div', { class: 'card' });
    const whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);

    const resCard = el('div', { class: 'card' });
    vizHost.append(stageCard, ganttCard, whyCard, resCard);

    // The shared playback bar. Its onChange redraws everything for the chosen frame.
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (fi) => draw(fi) });

    /* ---- algorithm chips + about ---- */
    // renderAlgo(): algorithm chips plus the 'about' card (rule, memory hook, watch out for).
    function renderAlgo() {
      chipRow.replaceChildren(...S.ALGOS.map((a) => el('button', {
        type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(a.id === state.algo), onclick: () => { state.algo = a.id; save(); renderAlgo(); renderSettings(); renderRows(); recompute(); }
      }, a.short)));
      const a = S.BY_ID[state.algo];
      aboutHost.replaceChildren(el('details', { class: 'about', open: true },
        el('summary', null, a.name, el('span', { class: 'tag' }, a.preemptive ? 'preemptive' : 'non-preemptive')),
        el('dl', null,
          el('dt', null, 'The rule'), el('dd', null, a.rule),
          el('dt', null, 'Memory hook'), el('dd', null, a.hook),
          el('dt', null, 'Watch out for'), el('dd', null, a.watch))));
    }

    /* ---- problem panel ---- */
    const probCard = el('div', { class: 'card' });
    const presetSel = el('select', { id: 'sch-preset', 'aria-label': 'Load an example' },
      el('option', { value: '' }, 'Load an example…'),
      S.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    // Loading an example only fills the inputs; the answer is still computed by the engine.
    presetSel.addEventListener('change', () => {
      const p = S.PRESETS.find((x) => x.id === presetSel.value);
      if (!p) return;
      state.rows = p.rows.map(([a, b, pr]) => ({ arrival: a, burst: b, priority: pr }));
      state.algo = p.algo; state.quantum = p.quantum;
      if (p.agingEvery != null) state.agingEvery = p.agingEvery;
      if (p.seed != null) state.seed = p.seed;
      presetNote.textContent = p.note;
      save(); renderAlgo(); renderSettings(); renderRows(); recompute();
    });
    const presetNote = el('p', { class: 'hint' });
    const tableHost = el('div');
    const errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    const settings = el('div', { class: 'col', style: { gap: '12px' } });
    const pasteBox = el('textarea', { id: 'sch-paste', placeholder: 'One process per line:\narrival burst priority\n0 5 2\n1 3 1', 'aria-label': 'Paste processes' });
    const paste = el('details', { class: 'paste' },
      el('summary', null, 'Paste a list'),
      el('div', { class: 'col', style: { gap: '8px', marginTop: '8px' } },
        pasteBox,
        el('p', { class: 'hint' }, 'Each line: arrival time, burst time, and optionally priority. Names P1, P2… are assigned in order.'),
        el('button', { type: 'button', class: 'btn', onclick: applyPaste }, 'Use this list')));

    probCard.append(
      el('div', { class: 'card-head' }, el('h3', null, 'Your problem')),
      el('div', { class: 'col', style: { gap: '12px' } },
        el('div', { class: 'field' }, presetSel, presetNote),
        tableHost, errBox,
        el('div', { class: 'row-inline' },
          el('button', { type: 'button', class: 'btn', onclick: addRow }, icon('plus', 16), 'Add process'),
          el('button', { type: 'button', class: 'btn', onclick: randomize }, icon('dice', 16), 'Random')),
        settings, paste));
    colSide.appendChild(probCard);

    // The priority column is only shown when it matters (priority algorithms, or the Compare tab).
    function showPrio() { return S.usesPriorityColumn(state.algo) || state.tab === 'cmp'; }

    // renderRows(): the editable process table. Each keystroke updates `state` and triggers a debounced recompute.
    function renderRows() {
      const prio = showPrio();
      const head = el('tr', null, el('th', null, 'Process'), el('th', null, 'Arrival'), el('th', null, 'Burst'), prio ? el('th', null, state.algo === 'lottery' ? 'Tickets' : 'Priority') : null, el('th', null, ''));
      const body = state.rows.map((r, i) => {
        const pid = 'P' + (i + 1);
        const inp = (field, min) => el('input', {
          type: 'number', inputmode: 'numeric', min, step: 1, value: r[field], id: 'sch-' + field + '-' + i,
          'aria-label': pid + ' ' + field, dataset: { row: i, field },
          oninput: (e) => { state.rows[i][field] = e.target.value; save(); schedule(); }
        });
        return el('tr', null,
          el('td', null, pill(pid)),
          el('td', null, inp('arrival', 0)),
          el('td', null, inp('burst', 1)),
          prio ? el('td', null, inp('priority', -99)) : null,
          el('td', null, el('button', { type: 'button', class: 'icon-btn', title: 'Remove ' + pid, 'aria-label': 'Remove ' + pid, disabled: state.rows.length <= 1, onclick: () => removeRow(i) }, icon('trash', 16))));
      });
      tableHost.replaceChildren(el('table', { class: 'ptable' }, el('thead', null, head), el('tbody', null, body)));
    }

    // renderSettings(): algorithm-specific options (quantum, tie conventions, which priority number is higher).
    function renderSettings() {
      const kids = [];
      if (S.isSliced(state.algo)) {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-quantum' }, 'Time quantum'),
          el('input', { type: 'number', id: 'sch-quantum', min: 1, step: 1, value: state.quantum, oninput: (e) => { state.quantum = e.target.value; save(); schedule(); } })));
      }
      // Priority aging: how many ticks of waiting earn one step of priority.
      if (state.algo === 'priority_aging') {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-aging' }, 'Boost priority by one step every N ticks of waiting'),
          el('input', { type: 'number', id: 'sch-aging', min: 1, step: 1, value: state.agingEvery, oninput: (e) => { state.agingEvery = e.target.value; save(); schedule(); } })));
      }
      // Lottery: the random seed. The same seed always gives the same draws.
      if (state.algo === 'lottery') {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-seed' }, 'Random seed (same seed = same draws)'),
          el('input', { type: 'number', id: 'sch-seed', step: 1, value: state.seed, oninput: (e) => { state.seed = e.target.value; save(); schedule(); } })));
      }
      if (state.algo === 'rr') {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-rrorder' }, 'When a quantum ends and a process arrives at the same moment'),
          el('select', { id: 'sch-rrorder', onchange: (e) => { state.rrArrivalsFirst = e.target.value === 'new'; save(); recompute(); } },
            el('option', { value: 'new', selected: state.rrArrivalsFirst }, 'New arrival joins the queue first'),
            el('option', { value: 'old', selected: !state.rrArrivalsFirst }, 'Preempted process joins the queue first'))));
      }
      if (/^priority/.test(state.algo)) {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-pdir' }, 'Which number is the higher priority?'),
          el('select', { id: 'sch-pdir', onchange: (e) => { state.lowerIsHigher = e.target.value === 'low'; save(); recompute(); } },
            el('option', { value: 'low', selected: state.lowerIsHigher }, 'Lower number = higher priority'),
            el('option', { value: 'high', selected: !state.lowerIsHigher }, 'Higher number = higher priority'))));
      }
      if (state.algo !== 'fcfs' && state.algo !== 'rr') {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sch-tie' }, 'If two processes tie'),
          el('select', { id: 'sch-tie', onchange: (e) => { state.tieBreak = e.target.value; save(); recompute(); } },
            el('option', { value: 'arrival', selected: state.tieBreak === 'arrival' }, 'Earlier arrival first, then lower process number'),
            el('option', { value: 'pid', selected: state.tieBreak === 'pid' }, 'Lower process number first'))));
      }
      kids.push(el('p', { class: 'hint' }, 'Textbooks differ on ties. Switch this to match your course.'));
      settings.replaceChildren(...kids);
    }

    // Add / remove / randomise / paste: ways to change the process list. All end in recompute().
    function addRow() {
      if (state.rows.length >= S.LIMITS.maxProcs) return;
      const maxA = Math.max(0, ...state.rows.map((r) => +r.arrival || 0));
      state.rows.push({ arrival: maxA, burst: 3, priority: 3 });
      save(); renderRows(); recompute();
    }
    function removeRow(i) { if (state.rows.length <= 1) return; state.rows.splice(i, 1); save(); renderRows(); recompute(); }
    function randomize() {
      const n = 4 + Math.floor(Math.random() * 3);
      const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
      state.rows = Array.from({ length: n }, (_, i) => ({ arrival: i === 0 ? 0 : rnd(0, 8), burst: rnd(1, 9), priority: rnd(1, 5) }));
      presetSel.value = ''; presetNote.textContent = '';
      save(); renderRows(); recompute();
    }
    function applyPaste() {
      const rows = [];
      pasteBox.value.split(/\n+/).forEach((line) => {
        const nums = (line.replace(/^\s*p\d+/i, '').match(/-?\d+/g) || []).map(Number);
        if (nums.length >= 2) rows.push({ arrival: nums[0], burst: nums[1], priority: nums.length > 2 ? nums[2] : 1 });
      });
      if (!rows.length) { showErrors(['Could not read any rows. Use "arrival burst priority" on each line.']); return; }
      state.rows = rows.slice(0, S.LIMITS.maxProcs);
      presetSel.value = ''; presetNote.textContent = '';
      save(); renderRows(); recompute();
    }

    // showErrors: show validation messages under the table.
    function showErrors(list) {
      errBox.hidden = !list.length;
      errBox.replaceChildren(...list.map((m) => el('div', null, m)));
    }

    /* ---- recompute / draw ---- */
    // Debounced recompute: wait until the user pauses typing.
    const schedule = debounce(() => recompute(), 160);

    // config(): the engine settings collected from the UI state.
    function config() {
      return { algo: state.algo, quantum: state.quantum, lowerIsHigher: state.lowerIsHigher, tieBreak: state.tieBreak, rrArrivalsFirst: state.rrArrivalsFirst, agingEvery: state.agingEvery, seed: state.seed };
    }

    // recompute(): validate -> simulate -> rebuild the visuals. If the input is invalid, mark the bad fields
    // and keep showing the last valid animation instead of blanking the screen.
    function recompute() {
      const cfg = config();
      const v = S.validate(state.rows, cfg);
      host.querySelectorAll('.ptable input').forEach((i) => i.classList.remove('bad'));
      if (!v.ok) {
        v.errors.forEach((e) => {
          if (e.row >= 0) { const i = host.querySelector('#sch-' + e.field + '-' + e.row); if (i) i.classList.add('bad'); }
        });
        showErrors(v.errors.map((e) => e.msg));
        stale.hidden = !lastValid;
        return;
      }
      showErrors([]); stale.hidden = true; lastValid = true;
      sim = S.simulate(v.clean, cfg);
      buildStage(); buildResults();
      if (state.tab === 'cmp') buildCompare();
      const keep = player.frame || 0;
      setStops(keep);
    }

    // stopsFor(): which frames the Player visits. 'Every time unit' = all frames; 'Key moments only' = only
    // frames where something happened (an arrival, dispatch, preemption, finish).
    function stopsFor() {
      const f = sim.frames;
      if (state.mode === 'unit') return f.map((_, i) => i);
      return f.map((x, i) => (i === 0 || i === f.length - 1 || x.events.length ? i : -1)).filter((i) => i >= 0);
    }
    // setStops(): install the stops while keeping the viewer at (or just after) the frame they were on.
    function setStops(keepFrame) {
      const stops = stopsFor();
      let pos = stops.findIndex((s) => s >= keepFrame);
      if (pos < 0) pos = stops.length - 1;
      player.setStops(stops, pos);
    }
    // Switch between the two stepping modes.
    function setMode(m) {
      state.mode = m; save(); paintMode();
      if (sim) setStops(player.frame || 0);
    }
    function paintMode() {
      mUnit.setAttribute('aria-pressed', String(state.mode === 'unit'));
      mEvent.setAttribute('aria-pressed', String(state.mode === 'event'));
    }

    // buildStage(): create fresh Stage and Gantt components for a new simulation.
    function buildStage() {
      if (stage) stage.destroy();
      stageSlot.replaceChildren();
      stage = Stage(stageSlot, sim);
      ganttSlot.replaceChildren();
      gantt = Gantt(ganttSlot, sim);
    }

    // eventText(): one plain-language sentence per engine event (arrive, dispatch, preempt, quantum, finish, idle).
    function eventText(ev, fr) {
      const p = (pid) => sim.procs.find((x) => x.pid === pid);
      switch (ev.type) {
        case 'arrive': return ev.pid + ' arrives (burst ' + p(ev.pid).burst + (state.algo === 'lottery' ? ', ' + p(ev.pid).priority + ' ticket' + (p(ev.pid).priority === 1 ? '' : 's') : (/^priority/.test(state.algo) ? ', priority ' + p(ev.pid).priority : '')) + ') and joins the ready queue.';
        case 'dispatch': return ev.pid + ' is dispatched: it gets the CPU.';
        case 'continue': return ev.won ? ev.pid + ' wins the draw again and gets another quantum.' : 'Nobody else is waiting, so ' + ev.pid + ' simply gets another quantum.';
        case 'preempt': return ev.pid + ' is preempted by ' + ev.by + ' and goes back to the ready queue with ' + fr.remaining[ev.pid] + ' unit' + (fr.remaining[ev.pid] === 1 ? '' : 's') + ' left.';
        case 'quantum': return ev.pid + ' has used its full quantum of ' + ev.quantum + '.';
        case 'finish': return ev.pid + ' finishes at time ' + ev.time + '.';
        case 'idle': return 'No process is ready, so the CPU sits idle.';
        default: return '';
      }
    }

    // drawWhy(): the 'Why did that happen?' panel: what happened at this time, then the scheduler's decision,
    // with the candidates compared (the winner highlighted).
    function drawWhy(fr) {
      const kids = [];
      kids.push(el('p', { class: 'muted' }, 'At time ', el('b', { class: 'mono' }, fr.t), fr.t >= sim.total ? ' (end of the schedule)' : ''));
      if (fr.events.length) kids.push(el('ul', { class: 'events' }, fr.events.map((ev) => el('li', { class: 'ev-' + ev.type }, el('span', { class: 'ev-dot' }), el('span', null, eventText(ev, fr))))));
      else if (fr.t < sim.total) kids.push(el('p', null, fr.running ? fr.running + ' keeps running. Nothing else changes at this moment.' : 'The CPU stays idle.'));
      if (fr.decision && fr.decision.text) {
        const d = fr.decision;
        const chips = d.candidates.length > 1 ? el('div', { class: 'cand' }, d.candidates.map((c) =>
          el('span', { class: c.pid === d.chosen ? 'win' : 'lose' }, c.pid + (c.value == null ? '' : ' · ' + c.value)))) : null;
        kids.push(el('div', { class: 'decision' }, el('b', null, 'The decision'), el('p', null, d.text), chips));
      }
      if (fr.t >= sim.total) kids.push(el('p', null, 'Every process has finished. Scroll to the results to see waiting, turnaround and response times.'));
      whyBody.replaceChildren(...kids);
    }

    /* ---- results ---- */
    // buildResults(): create the results table with '...' placeholders; drawResults fills them in as processes finish.
    function buildResults() {
      const prio = S.usesPriorityColumn(state.algo);
      const head = el('tr', null, ['Process', 'Arrival', 'Burst', prio ? (state.algo === 'lottery' ? 'Tickets' : 'Priority') : null, 'Finish', 'Turnaround', 'Waiting', 'Response'].filter(Boolean).map((h) => el('th', null, h)));
      const rows = sim.per.map((r) => {
        const cells = {
          ct: el('td', { class: 'pending' }, '…'), tat: el('td', { class: 'pending' }, '…'),
          wt: el('td', { class: 'pending' }, '…'), rt: el('td', { class: 'pending' }, '…')
        };
        const tr = el('tr', null, el('td', null, pill(r.pid)), el('td', null, r.arrival), el('td', null, r.burst), prio ? el('td', null, r.priority) : null, cells.ct, cells.tat, cells.wt, cells.rt);
        return { r, cells, tr };
      });
      const cols = prio ? 8 : 7;
      const avgCells = { tat: el('td', { class: 'pending' }, '…'), wt: el('td', { class: 'pending' }, '…'), rt: el('td', { class: 'pending' }, '…') };
      const foot = el('tr', null, el('td', { colspan: cols - 3, style: { textAlign: 'left' } }, 'Average'), avgCells.tat, avgCells.wt, avgCells.rt);
      const statEls = {};
      const tile = (key, label) => { const b = el('b', null, '…'); statEls[key] = b; return el('div', { class: 'stat' }, el('span', null, label), b); };
      const work = el('pre', null, '');
      resCard.replaceChildren(
        el('div', { class: 'card-head' }, el('h3', null, 'Results'), el('span', { class: 'sub' }, 'Fills in as each process finishes')),
        el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, head), el('tbody', null, rows.map((x) => x.tr)), el('tfoot', null, foot))),
        el('div', { class: 'formulas' }, el('span', null, 'Turnaround = Finish − Arrival'), el('span', null, 'Waiting = Turnaround − Burst'), el('span', null, 'Response = First CPU − Arrival')),
        el('div', { class: 'stats' }, tile('util', 'CPU utilization'), tile('thr', 'Throughput'), tile('sw', 'Context switches')),
        el('details', { class: 'working' }, el('summary', null, 'Show the working'), work));
      resultsRefs = { rows, avgCells, statEls, work };
    }

    // drawResults(): reveal finish / turnaround / waiting / response for processes done by this frame,
    // show averages and utilisation once everyone is done, and print the arithmetic in 'Show the working'.
    function drawResults(fr) {
      const R = resultsRefs; if (!R) return;
      const lines = [];
      R.rows.forEach(({ r, cells }) => {
        const done = fr.done.includes(r.pid);
        const vals = { ct: r.ct, tat: r.tat, wt: r.wt, rt: r.rt };
        Object.keys(cells).forEach((k) => { cells[k].textContent = done ? vals[k] : '…'; cells[k].className = done ? '' : 'pending'; });
        if (done) lines.push(r.pid + ':  Turnaround = ' + r.ct + ' − ' + r.arrival + ' = ' + r.tat + '   Waiting = ' + r.tat + ' − ' + r.burst + ' = ' + r.wt + '   Response = ' + r.start + ' − ' + r.arrival + ' = ' + r.rt);
      });
      const all = fr.done.length === sim.procs.length;
      const m = sim.metrics;
      const n = sim.per.length;
      R.avgCells.tat.textContent = all ? fmt(m.avgTAT) : '…';
      R.avgCells.wt.textContent = all ? fmt(m.avgWT) : '…';
      R.avgCells.rt.textContent = all ? fmt(m.avgRT) : '…';
      [R.avgCells.tat, R.avgCells.wt, R.avgCells.rt].forEach((c) => { c.className = all ? '' : 'pending'; });
      R.statEls.util.textContent = all ? fmt(m.utilization, 1) + '%' : '…';
      R.statEls.thr.textContent = all ? fmt(m.throughput, 3) + '/unit' : '…';
      R.statEls.sw.textContent = all ? m.switches : '…';
      if (all) lines.push('', 'Average waiting = (' + sim.per.map((r) => r.wt).join(' + ') + ') ÷ ' + n + ' = ' + fmt(m.avgWT));
      R.work.textContent = lines.length ? lines.join('\n') : 'Nothing has finished yet.';
    }

    // draw(): called by the Player for each frame: update stage, Gantt, explanation and results together.
    function draw(fi) {
      if (!sim) return;
      const fr = sim.frames[fi];
      stage.update(fr);
      gantt.update(fr.t);
      drawWhy(fr);
      drawResults(fr);
    }

    /* ---- compare tab ---- */
    // buildCompare(): run every deterministic algorithm (the random lottery is left out) on the same processes and tabulate the averages. The best value
    // in each column is marked; below it, every algorithm's Gantt chart is drawn side by side.
    function buildCompare() {
      const v = S.validate(state.rows, { algo: 'priority_np', quantum: state.quantum });
      if (!v.ok) { cmpHost.replaceChildren(el('div', { class: 'card' }, el('p', null, 'Fix the highlighted values in your problem to compare the algorithms.'))); return; }
      const all = S.simulateAll(v.clean, config());
      const keys = [['avgWT', 'Avg waiting'], ['avgTAT', 'Avg turnaround'], ['avgRT', 'Avg response'], ['switches', 'Context switches'], ['utilization', 'CPU util. %']];
      const bestOf = {};
      keys.forEach(([k]) => { bestOf[k] = Math.min.apply(null, S.COMPARE_ALGOS.map((a) => all[a.id].metrics[k])); });
      // Utilisation is the one metric where bigger is better.
      bestOf.utilization = Math.max.apply(null, S.COMPARE_ALGOS.map((a) => all[a.id].metrics.utilization));
      const rows = S.COMPARE_ALGOS.map((a) => {
        const m = all[a.id].metrics;
        return el('tr', null,
          el('td', null, a.short + (a.id === 'rr' ? ' (q=' + state.quantum + ')' : '')),
          keys.map(([k]) => el('td', { class: Math.abs(m[k] - bestOf[k]) < 1e-9 ? 'best' : '' }, k === 'utilization' ? fmt(m[k], 1) : k === 'switches' ? m[k] : fmt(m[k]))));
      });
      const waits = S.COMPARE_ALGOS.map((a) => ({ a, v: all[a.id].metrics.avgWT })).sort((x, y) => x.v - y.v);
      const bestNames = waits.filter((w) => Math.abs(w.v - waits[0].v) < 1e-9).map((w) => w.a.short).join(' and ');
      cmpHost.replaceChildren(
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', null, 'Same processes, every algorithm'), el('span', { class: 'sub' }, '✓ marks the best value in each column')),
          el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, el('th', null, 'Algorithm'), keys.map(([, l]) => el('th', null, l)))), el('tbody', null, rows))),
          el('p', { class: 'note', style: { marginTop: '10px' } }, 'Lowest average waiting time for this problem: ' + bestNames + ' (' + fmt(waits[0].v) + '). Highest: ' + waits[waits.length - 1].a.short + ' (' + fmt(waits[waits.length - 1].v) + ').')),
        el('div', { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', null, 'Gantt charts side by side')),
          S.COMPARE_ALGOS.map((a) => {
            const slot = el('div');
            const block = el('div', null, el('div', { class: 'row-inline', style: { marginBottom: '4px' } }, el('b', null, a.short), el('span', { class: 'hint' }, 'finishes at ' + all[a.id].total)), slot);
            Gantt(slot, all[a.id], { static: true });
            return block;
          })));
    }

    // setTab(): switch between the animated view and the comparison.
    function setTab(t) {
      state.tab = t; save();
      const viz = t === 'viz';
      vizHost.hidden = !viz; cmpHost.hidden = viz; aboutHost.hidden = !viz;
      tabViz.setAttribute('aria-selected', String(viz)); tabCmp.setAttribute('aria-selected', String(!viz));
      renderRows();
      if (!viz) buildCompare(); else if (stage) stage.relayout();
    }

    /* ---- go ---- */
    // First render.
    renderAlgo(); renderSettings(); renderRows(); paintMode();
    setTab(state.tab === 'cmp' ? 'cmp' : 'viz');
    recompute();

    return {
      // Called by app.js when this concept becomes visible: route keyboard shortcuts here and re-measure.
      activate() { NS.Player.current = player; if (stage) stage.relayout(); },
      deactivate() { player.pause(); }
    };
  }

  NS.views = NS.views || {};
  NS.views.scheduling = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
