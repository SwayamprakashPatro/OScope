/* Process states view: five-state diagram with process chips that travel along the arrows,
   ready/waiting queues, a PCB panel showing the context switch, and an editable event script. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, colorFor, textOn, debounce, clamp } = NS.util;
  const P = NS.procstate;
  const KEY = 'oslab.procstate.v1';

  // NODE: centre of each state's box in the diagram's coordinate system (viewBox 660 x 320).
  const NODE = { new: [62, 70], ready: [235, 70], running: [410, 70], terminated: [595, 70], waiting: [322, 250] };
  // Size of a state box.
  const NW = 112, NH = 92;
  // Memory hook shown in the 'about' card.
  const HOOK = 'NRRWT: New, Ready, Running, Waiting, Terminated. Remember "Ready waits for the CPU, Waiting waits for I/O". Only Running holds the CPU.';

  // arrows: [event, from, to, path d, label x, label y]
  // EDGES: one SVG path per legal event [event, from, to, path data, label x, label y]. The paths match the
  // engine's EVENTS table; the highlighted one is the event just executed.
  const EDGES = [
    ['admit', 'new', 'ready', 'M118 70 L179 70', 148, 58],
    ['dispatch', 'ready', 'running', 'M291 54 L354 54', 322, 41],
    ['timeout', 'running', 'ready', 'M354 88 L291 88', 322, 106],
    ['exit', 'running', 'terminated', 'M466 70 L539 70', 502, 58],
    ['wait', 'running', 'waiting', 'M410 116 C 410 190, 400 215, 378 232', 440, 188],
    ['wake', 'waiting', 'ready', 'M266 232 C 240 210, 235 170, 235 116', 196, 188]
  ];
  // Short names printed on the arrows.
  const EDGE_LABEL = { admit: 'admit', dispatch: 'dispatch', timeout: 'timer', exit: 'exit', wait: 'I/O wait', wake: 'I/O done' };

  // chipPos(): where the idx-th process chip sits inside a state box (up to three per row).
  function chipPos(state, idx, f) {
    const [cx, cy] = NODE[state];
    const per = 3, col = idx % per, row = Math.floor(idx / per);
    const x = cx + (col - (Math.min(per, Math.max(1, countIn(f, state) - row * per)) - 1) / 2) * 34;
    return [x, cy + 2 + row * 32 - (state === 'running' ? 0 : 0)];
  }
  // countIn(): how many processes are in a state in this frame (used to centre a row of chips).
  function countIn(f, state) { return f.procs.filter((p) => p.state === state).length; }
  // orderIn(): processes in a state in display order. Ready and Waiting use the real queue order from the
  // engine, so the chips line up exactly like the queue.
  function orderIn(f, state) {
    if (state === 'ready') return f.ready.slice();
    if (state === 'waiting') return f.waiting.slice();
    return f.procs.filter((p) => p.state === state).map((p) => p.pid);
  }

  // mount(host): build the Process States screen and return { activate, deactivate } for app.js.
  // The diagram, queues and PCB are all driven by frames from the engine; the process chips are SVG groups
  // whose CSS transform changes between frames, so they visibly glide along the arrows.
  function mount(host) {
    // State: number of processes, the event script text, dispatch rule, random-scenario seed / length, and the
    // process chosen in the quick-action panel. Saved to localStorage.
    let state = Object.assign({ n: P.PRESETS[2].n, script: P.PRESETS[2].script, fifo: true, seed: 1, len: 14, pid: 'P1', tab: 'viz' }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    // sim = engine result; pcbPid = process whose PCB is shown (click a chip or tab to change it).
    let sim = null, pcbPid = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'ps-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'ps-title' }, 'Process States'),
      el('p', null, 'A process is never just "running". It moves between states as the OS and hardware events happen. Build an event script, or click events yourself, and watch each process travel.')));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    colMain.appendChild(el('details', { class: 'card about', open: true }, el('summary', null, 'The five-state model'),
      el('dl', null,
        el('dt', null, 'The rule'), el('dd', null, 'One CPU means at most one process is Running. Ready processes wait for the CPU. Waiting processes wait for something else (I/O). A process can only move along an arrow.'),
        el('dt', null, 'Memory hook'), el('dd', null, HOOK),
        el('dt', null, 'Watch out for'), el('dd', null, 'There is no arrow from Waiting straight to Running, or from Ready to Waiting. A process that finishes I/O goes back to Ready and queues for the CPU again.'))));

    const diagCard = el('div', { class: 'card' }), diagSlot = el('div', { class: 'ps-diagram' });
    const playerHost = el('div');
    diagCard.append(el('div', { class: 'card-head' }, el('h3', null, 'State diagram'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), diagSlot, el('div', { style: { height: '12px' } }), playerHost);
    const queueCard = el('div', { class: 'card' }), queueBody = el('div');
    queueCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Queues'), el('span', { class: 'sub' }, 'Front of the queue is on the left')), queueBody);
    const pcbCard = el('div', { class: 'card' }), pcbBody = el('div');
    pcbCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Process Control Block (PCB)'), el('span', { class: 'sub' }, 'What the OS saves for each process')), pcbBody);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const logCard = el('div', { class: 'card' }), logBody = el('ol', { class: 'ps-log' });
    logCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Event log')), logBody);
    colMain.append(diagCard, queueCard, pcbCard, whyCard, logCard);
    // Shared playback bar; each step is one event of the script.
    const player = new NS.Player(playerHost, { label: 'Event', onChange: (i) => draw(i) });

    /* ---------- side panel ---------- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), P.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs; the state changes are computed by the engine.
    presetSel.addEventListener('change', () => {
      const p = P.PRESETS.find((x) => x.id === presetSel.value); if (!p) return;
      state.n = p.n; state.script = p.script; presetNote.textContent = p.note; save(); renderFields(); recompute();
    });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    const quickHost = el('div', { class: 'col', style: { gap: '8px' } });
    colSide.append(
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your scenario')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Try the next event'), el('span', { class: 'sub' }, 'Illegal moves are greyed out. Hover to see why.')), quickHost));

    // Debounced recompute while typing the script.
    const schedule = debounce(() => recompute(), 200);
    let scriptBox = null;
    // renderFields(): the scenario form: number of processes, the event script textarea, dispatch rule, and the
    // random-scenario generator (which always produces legal scripts).
    function renderFields() {
      scriptBox = el('textarea', { id: 'ps-script', rows: 10, spellcheck: 'false', 'aria-describedby': 'ps-script-hint', oninput: (e) => { state.script = e.target.value; save(); schedule(); } });
      scriptBox.value = state.script;
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('label', { for: 'ps-n' }, 'Number of processes (1 to ' + P.LIMITS.maxProcs + ')'),
          el('input', { type: 'number', id: 'ps-n', min: 1, max: P.LIMITS.maxProcs, value: state.n, oninput: (e) => { state.n = e.target.value; save(); schedule(); } })),
        el('div', { class: 'field' }, el('label', { for: 'ps-script' }, 'Event script (one per line: process, then event)'), scriptBox,
          el('p', { class: 'hint', id: 'ps-script-hint' }, 'Events: ' + P.EVENT_IDS.join(', ') + '. Example: P1 dispatch')),
        el('div', { class: 'field' }, el('label', { for: 'ps-fifo' }, 'Dispatch rule'),
          el('select', { id: 'ps-fifo', onchange: (e) => { state.fifo = e.target.value === 'fifo'; save(); recompute(); } },
            el('option', { value: 'fifo', selected: state.fifo }, 'Scheduler picks the front of the ready queue (FIFO)'),
            el('option', { value: 'any', selected: !state.fifo }, 'Scheduler may pick any ready process'))),
        el('div', { class: 'grid2' },
          el('div', { class: 'field' }, el('label', { for: 'ps-len' }, 'Random scenario length'), el('input', { type: 'number', id: 'ps-len', min: 1, max: P.LIMITS.maxScript, value: state.len, oninput: (e) => { state.len = e.target.value; save(); } })),
          el('div', { class: 'field' }, el('label', { for: 'ps-seed' }, 'Seed'), el('input', { type: 'number', id: 'ps-seed', value: state.seed, oninput: (e) => { state.seed = e.target.value; save(); } }))),
        el('div', { class: 'row-inline' },
          el('button', { type: 'button', class: 'btn', onclick: () => {
            const n = clamp(parseInt(state.n, 10) || 1, 1, P.LIMITS.maxProcs), len = clamp(parseInt(state.len, 10) || 10, 1, P.LIMITS.maxScript);
            state.script = P.generate(n, len, parseInt(state.seed, 10) || 1, { fifoDispatch: state.fifo }).map((r) => r.pid + ' ' + r.ev).join('\n');
            state.seed = (parseInt(state.seed, 10) || 1) + 1; save(); renderFields(); recompute();
          } }, 'Generate a random legal scenario'),
          el('button', { type: 'button', class: 'btn', onclick: () => { state.script = ''; save(); renderFields(); recompute(); } }, 'Clear')));
    }

    // renderQuick(): the 'Try the next event' panel. It asks the engine which events are legal for the chosen
    // process in the CURRENT end state; illegal events are disabled with the engine's reason as a tooltip.
    // Clicking a legal one appends it to the script and steps to it.
    function renderQuick() {
      if (!sim) { quickHost.replaceChildren(); return; }
      const pids = sim.final.procs.map((p) => p.pid);
      if (!pids.includes(state.pid)) state.pid = pids[0];
      const sel = el('select', { id: 'ps-qpid', 'aria-label': 'Process', onchange: (e) => { state.pid = e.target.value; renderQuick(); } },
        sim.final.procs.map((p) => el('option', { value: p.pid, selected: p.pid === state.pid }, p.pid + ' (' + P.STATE_LABEL[p.state] + ')')));
      const leg = sim.error ? null : P.legality(sim.final, state.pid, sim.cfg);
      const btns = P.EVENT_IDS.map((e) => {
        const ok = leg && leg[e].ok;
        return el('button', { type: 'button', class: 'btn ps-ev', disabled: !ok, title: leg ? leg[e].reason : 'Fix the script first.', onclick: () => {
          state.script = (state.script.trim() ? state.script.replace(/\s+$/, '') + '\n' : '') + state.pid + ' ' + e; save();
          if (scriptBox) scriptBox.value = state.script; recompute(true);
        } }, P.EVENTS[e].label);
      });
      quickHost.replaceChildren(el('div', { class: 'field' }, el('label', { for: 'ps-qpid' }, 'Process'), sel), el('div', { class: 'ps-evs' }, btns),
        el('p', { class: 'hint' }, sim.error ? 'The script has an illegal step, so the buttons are off until it is fixed.' : 'Clicking adds a line to the script and steps to it.'));
    }

    // recompute(): parse the script, simulate, rebuild the diagram. Parse errors and illegal steps are shown
    // but everything before the problem still animates. `toEnd` jumps to the newest event.
    function recompute(toEnd) {
      const n = Number(state.n);
      const errs = [];
      if (!Number.isInteger(n) || n < 1 || n > P.LIMITS.maxProcs) errs.push('Number of processes must be a whole number from 1 to ' + P.LIMITS.maxProcs + '.');
      const parsed = P.parseScript(state.script);
      errs.push(...parsed.errors);
      if (parsed.rows.length > P.LIMITS.maxScript) errs.push('The script is limited to ' + P.LIMITS.maxScript + ' events.');
      if (errs.length) { errBox.hidden = false; errBox.replaceChildren(...errs.map((m) => el('div', null, m))); return; }
      sim = P.simulate(n, parsed.rows, { fifoDispatch: state.fifo });
      if (sim.error) { errBox.hidden = false; errBox.replaceChildren(el('div', null, sim.error.msg + ' Showing everything before that step.')); } else errBox.hidden = true;
      buildDiagram();
      renderQuick();
      const keep = toEnd ? sim.frames.length - 1 : Math.min(player.pos, sim.frames.length - 1);
      player.setStops(sim.frames.map((_, i) => i), keep);
    }

    /* ---------- diagram ---------- */
    // Handles to the live SVG parts (edges, state boxes, process chips).
    let dg = null;
    // buildDiagram(): draw the five state boxes and six arrows, and create one chip per process (created once,
    // then only moved).
    function buildDiagram() {
      const W = 660, H = 320;
      const root = svg('svg', { class: 'ps-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Five-state process diagram. Process chips sit inside the state they are in.' });
      root.appendChild(svg('defs', null, svg('marker', { id: 'ps-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10z', fill: 'context-stroke' }))));
      const edgeEls = {};
      EDGES.forEach(([e, , , d, lx, ly]) => {
        const path = svg('path', { class: 'ps-edge', d, 'marker-end': 'url(#ps-arrow)' });
        const lab = svg('text', { class: 'ps-elabel', x: lx, y: ly, 'text-anchor': 'middle', text: EDGE_LABEL[e] });
        root.append(path, lab); edgeEls[e] = { path, lab };
      });
      const nodeEls = {};
      P.STATES.forEach((s) => {
        const [cx, cy] = NODE[s];
        const r = svg('rect', { class: 'ps-node ps-n-' + s, x: cx - NW / 2, y: cy - NH / 2, width: NW, height: NH, rx: 14 });
        const t = svg('text', { class: 'ps-ntitle', x: cx, y: cy - NH / 2 + 15, 'text-anchor': 'middle', text: P.STATE_LABEL[s] });
        root.append(r, t); nodeEls[s] = r;
      });
      const chips = {};
      sim.frames[0].procs.forEach((p, i) => {
        const fill = colorFor(i);
        const g = svg('g', { class: 'ps-chip', tabindex: 0, role: 'button', 'aria-label': p.pid, onclick: () => { pcbPid = p.pid; draw(player.pos); }, onkeydown: (ev) => { if (ev.key === 'Enter') { pcbPid = p.pid; draw(player.pos); } } },
          svg('circle', { r: 15, fill, stroke: 'var(--surface)', 'stroke-width': 2 }), svg('text', { class: 'ps-chip-t', 'text-anchor': 'middle', y: 4, fill: textOn(fill), text: p.pid }));
        g.style.transform = 'translate(' + NODE.new[0] + 'px,' + NODE.new[1] + 'px)';
        root.appendChild(g); chips[p.pid] = g;
      });
      diagSlot.replaceChildren(root);
      dg = { edgeEls, nodeEls, chips };
    }

    /* ---------- drawing ---------- */
    // draw(i): show the state after event i. Move every chip to its box, highlight the arrow just taken and
    // the state just entered, redraw the queues, the PCB panel (with a note when a context save / load
    // happened), the explanation and the event log.
    function draw(i) {
      if (!sim || !dg) return;
      const f = sim.frames[i];
      // chips
      P.STATES.forEach((s) => {
        orderIn(f, s).forEach((pid, k) => {
          const [x, y] = chipPos(s, k, f);
          dg.chips[pid].style.transform = 'translate(' + x + 'px,' + (y + 8) + 'px)';
          dg.chips[pid].classList.toggle('is-run', s === 'running');
        });
        dg.nodeEls[s].classList.toggle('is-active', !!f.event && f.to === s);
      });
      Object.keys(dg.edgeEls).forEach((e) => {
        const on = !!f.event && f.event.ev === e;
        dg.edgeEls[e].path.classList.toggle('is-on', on); dg.edgeEls[e].lab.classList.toggle('is-on', on);
      });
      // queues
      // chip(pid): a coloured pill for a process, used in the queue rows.
      const chip = (pid) => { const idx = +pid.slice(1) - 1; const fill = colorFor(idx); return el('span', { class: 'qchip', style: { background: fill, color: textOn(fill) } }, pid); };
      const q = (title, list, empty) => el('div', { class: 'ps-q' }, el('b', null, title), el('div', { class: 'ps-qrow' }, list.length ? list.map((p, k) => el('span', { class: 'qitem' }, chip(p), k < list.length - 1 ? el('i', null, '→') : null)) : el('em', null, empty)));
      queueBody.replaceChildren(
        q('Ready queue (waiting for the CPU)', f.ready, 'empty'),
        el('div', { class: 'ps-q' }, el('b', null, 'CPU (running)'), el('div', { class: 'ps-qrow' }, f.running ? chip(f.running) : el('em', null, 'idle: nothing is running'))),
        q('Waiting (blocked on I/O)', f.waiting, 'empty'));
      // PCB
      const sel = pcbPid && f.procs.find((p) => p.pid === pcbPid) ? pcbPid : (f.event ? f.event.pid : (f.procs[0] && f.procs[0].pid));
      const p = f.procs.find((x) => x.pid === sel);
      const pcbRows = [['Process ID', p.pid], ['State', P.STATE_LABEL[p.state]], ['Program counter', '0x' + p.pc.toString(16)], ['Stack pointer', '0x' + p.regs.SP.toString(16)], ['Register R0', p.regs.R0], ['Register R1', p.regs.R1], ['CPU turns used', p.cpu]];
      const tabs = el('div', { class: 'ps-pcbtabs', role: 'group', 'aria-label': 'Choose a process' }, f.procs.map((x, k) => el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(x.pid === sel), onclick: () => { pcbPid = x.pid; draw(player.pos); } }, x.pid)));
      const ctx = [];
      if (f.info && (f.info.saved || f.info.loaded)) {
        if (f.info.saved) ctx.push(el('div', { class: 'callout' }, 'Context save: the CPU registers of ' + f.info.saved + ' were copied into its PCB, so it can resume exactly here later.'));
        if (f.info.loaded) ctx.push(el('div', { class: 'callout' }, 'Context load: the registers saved in the PCB of ' + f.info.loaded + ' were copied back into the CPU. This swap is a context switch, and it is pure overhead.'));
      }
      pcbBody.replaceChildren(tabs, el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl ps-pcb' }, el('tbody', null, pcbRows.map((r) => el('tr', null, el('th', null, r[0]), el('td', { class: 'mono' }, r[1])))))), ...ctx);
      // why
      const kids = [el('p', { class: 'muted' }, i === 0 ? 'Before any event' : 'Event ' + i + ' of ' + (sim.frames.length - 1)), el('p', null, f.text)];
      if (sim.error && i === sim.frames.length - 1) kids.push(el('div', { class: 'callout callout-bad' }, sim.error.msg));
      whyBody.replaceChildren(...kids);
      // log
      logBody.replaceChildren(...sim.frames.slice(1, i + 1).map((fr, k) => el('li', { class: k === i - 1 ? 'now' : '' }, el('b', null, fr.event.pid), ' ' + P.STATE_LABEL[fr.from] + ' → ' + P.STATE_LABEL[fr.to] + ' (' + P.EVENTS[fr.event.ev].label + ')')));
      if (i === 0) logBody.replaceChildren(el('li', { class: 'muted' }, 'No events yet.'));
    }

    renderFields(); recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.states = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
