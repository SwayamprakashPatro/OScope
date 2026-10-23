/* Process state engine: the five-state model driven by an event script. Pure logic.
   States: new, ready, running, waiting, terminated. One CPU, so at most one process is running. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // The five states of the classic process model.
  const STATES = ['new', 'ready', 'running', 'waiting', 'terminated'];
  const STATE_LABEL = { new: 'New', ready: 'Ready', running: 'Running', waiting: 'Waiting', terminated: 'Terminated' };
  // EVENTS: the only legal transitions (the arrows of the diagram). `from` and `to` are states, and `cause`
  // is the plain-language reason shown in the Why panel. Anything not listed here is illegal, e.g. there is
  // no event that takes Waiting straight to Running or Ready to Waiting.
  const EVENTS = {
    admit: { from: 'new', to: 'ready', label: 'Admit', cause: 'The OS finishes creating the process (memory set up, PCB filled in) and places it in the ready queue.' },
    dispatch: { from: 'ready', to: 'running', label: 'Dispatch', cause: 'The scheduler picks this process and the dispatcher gives it the CPU (a context switch loads its saved state).' },
    timeout: { from: 'running', to: 'ready', label: 'Timer interrupt', cause: 'The timer interrupt fires: the time slice is used up, so the OS takes the CPU back (preemption) and the process rejoins the ready queue.' },
    wait: { from: 'running', to: 'waiting', label: 'I/O or event wait', cause: 'The process asked for something slow, such as a disk read or keyboard input, so it blocks until that finishes.' },
    wake: { from: 'waiting', to: 'ready', label: 'I/O or event complete', cause: 'The awaited I/O finished (interrupt from the device), so the process can run again and joins the ready queue.' },
    exit: { from: 'running', to: 'terminated', label: 'Exit', cause: 'The process finished (or was killed). The OS releases its resources.' }
  };
  // Event names in a stable order (used for buttons and validation).
  const EVENT_IDS = Object.keys(EVENTS);
  // Caps: processes and script length.
  const LIMITS = { maxProcs: 6, maxScript: 60 };

  // mulberry32: small seeded random number generator, so 'random scenario, seed 7' is reproducible.
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // fresh(n): n new processes P1..Pn, all in the New state, each with its own starting program counter.
  const fresh = (n) => Array.from({ length: n }, (_, i) => ({ pid: 'P' + (i + 1), state: 'new', pc: 0x1000 + i * 0x100, cpu: 0, slices: 0 }));
  // clone(state): deep-ish copy so each frame owns its data and stepping backwards is safe.
  const clone = (st) => ({ procs: st.procs.map((p) => Object.assign({}, p)), ready: st.ready.slice(), waiting: st.waiting.slice(), running: st.running });

  // regsOf(p): stand-in CPU register values (PC, SP, R0, R1) derived from the process's progress.
  // They are only there to make the PCB save / restore visible; no real code runs.
  function regsOf(p) {
    // deterministic stand-in register values so the save/restore is visible
    const h = (p.pc * 31 + p.cpu * 7 + (p.pid.charCodeAt(1) || 0) * 101) >>> 0;
    return { PC: p.pc, SP: 0x7000 - (p.pid.charCodeAt(1) % 10) * 0x100 - (p.cpu % 4) * 8, R0: h % 256, R1: (h >> 3) % 256 };
  }

  // Which events are possible right now for process pid? reason explains why not.
  // legality(state, pid): for every event, is it legal for this process right now, and if not, why?
  // Two kinds of rule: (1) the process must be in the event's `from` state; (2) dispatch additionally
  // needs a free CPU (only one process may run) and, in FIFO mode, the process must be at the front of
  // the ready queue. The reasons feed the tooltips on the greyed-out buttons.
  function legality(st, pid, cfg) {
    const p = st.procs.find((x) => x.pid === pid);
    const out = {};
    EVENT_IDS.forEach((e) => {
      const ev = EVENTS[e];
      if (p.state !== ev.from) { out[e] = { ok: false, reason: pid + ' is ' + STATE_LABEL[p.state] + ', but ' + ev.label + ' needs a ' + STATE_LABEL[ev.from] + ' process.' }; return; }
      if (e === 'dispatch') {
        if (st.running) { out[e] = { ok: false, reason: 'The CPU is busy running ' + st.running + '. Only one process can run at a time.' }; return; }
        if (cfg.fifoDispatch && st.ready[0] !== pid) { out[e] = { ok: false, reason: pid + ' is not at the front of the ready queue (' + st.ready[0] + ' is). The scheduler picks the front process.' }; return; }
      }
      out[e] = { ok: true, reason: ev.cause };
    });
    return out;
  }

  // apply(state, pid, event): perform one transition and return the new state, or { error } if illegal.
  // Also updates the ready / waiting queues and reports which PCB was saved or loaded.
  function apply(st, pid, e, cfg) {
    const leg = legality(st, pid, cfg)[e];
    if (!leg.ok) return { error: leg.reason };
    const next = clone(st);
    const p = next.procs.find((x) => x.pid === pid);
    const ev = EVENTS[e];
    const info = { saved: null, loaded: null };
    if (e === 'admit') next.ready.push(pid);
    if (e === 'dispatch') { next.ready.splice(next.ready.indexOf(pid), 1); next.running = pid; info.loaded = pid; }
    // Leaving the CPU triggers a context SAVE: the process has made progress (PC advances, CPU turns used
    // grows) and its registers are stored in its PCB.
    if (e === 'timeout' || e === 'wait' || e === 'exit') {
      p.pc += 12; p.cpu += 1; p.slices += 1; next.running = null; info.saved = pid;
      if (e === 'timeout') next.ready.push(pid);
      if (e === 'wait') next.waiting.push(pid);
    }
    if (e === 'wake') { next.waiting.splice(next.waiting.indexOf(pid), 1); next.ready.push(pid); }
    p.state = ev.to;
    return { state: next, info };
  }

  // parseScript: turn lines like 'P1 dispatch' into { pid, ev } rows, with a line-numbered error for
  // anything malformed or any unknown event name.
  function parseScript(text) {
    const rows = []; const errors = [];
    String(text).split(/\n+/).forEach((line, i) => {
      const t = line.trim(); if (!t) return;
      const m = t.match(/^(p\d+)\s+([a-z]+)$/i);
      if (!m) { errors.push('Line ' + (i + 1) + ': write "P1 admit" (process, then event).'); return; }
      const e = m[2].toLowerCase();
      if (!EVENTS[e]) errors.push('Line ' + (i + 1) + ': unknown event "' + m[2] + '". Use: ' + EVENT_IDS.join(', ') + '.');
      else rows.push({ pid: m[1].toUpperCase(), ev: e });
    });
    return { rows, errors };
  }

  // simulate: replay the script one event at a time from 'all processes New'. One frame per event, with
  // the states, queues, PCB values and an explanation. If an event is illegal the run stops *before* it
  // and reports the error, so you see everything that happened up to the mistake.
  function simulate(nProcs, script, config) {
    const cfg = Object.assign({ fifoDispatch: true }, config);
    let st = { procs: fresh(nProcs), ready: [], waiting: [], running: null };
    const frames = [];
    // snap: record a frame from the current state.
    const snap = (extra) => frames.push(Object.assign({ procs: st.procs.map((p) => Object.assign({}, p, { regs: regsOf(p) })), ready: st.ready.slice(), waiting: st.waiting.slice(), running: st.running }, extra));
    snap({ i: -1, text: 'All ' + nProcs + ' process' + (nProcs === 1 ? ' is' : 'es are') + ' in the New state. Press Step to run the first event.', event: null });
    let error = null;
    for (let i = 0; i < script.length; i++) {
      const row = script[i];
      if (!st.procs.find((p) => p.pid === row.pid)) { error = { index: i, msg: 'Step ' + (i + 1) + ': there is no process ' + row.pid + '.' }; break; }
      const res = apply(st, row.pid, row.ev, cfg);
      if (res.error) { error = { index: i, msg: 'Step ' + (i + 1) + ' (' + row.pid + ' ' + row.ev + ') is not allowed: ' + res.error }; break; }
      const before = st.procs.find((p) => p.pid === row.pid).state;
      st = res.state;
      const ev = EVENTS[row.ev];
      snap({ i, event: row, from: before, to: ev.to, info: res.info, text: row.pid + ': ' + STATE_LABEL[before] + ' → ' + STATE_LABEL[ev.to] + '. ' + ev.cause });
    }
    return { cfg, frames, error, final: st };
  }

  // Random but always-legal scenario
  // generate: build a random but always-legal scenario. At every step it lists the events that are legal
  // right now (using legality()), weights them (dispatch and wake are likelier than exit), and picks one.
  function generate(nProcs, length, seed, config) {
    const cfg = Object.assign({ fifoDispatch: true }, config);
    const rnd = mulberry32(seed | 0);
    let st = { procs: fresh(nProcs), ready: [], waiting: [], running: null };
    const script = [];
    while (script.length < length) {
      const options = [];
      st.procs.forEach((p) => {
        const leg = legality(st, p.pid, cfg);
        EVENT_IDS.forEach((e) => {
          if (!leg[e].ok) return;
          const w = { admit: 3, dispatch: 5, timeout: 2, wait: 2, wake: 4, exit: 1 }[e];
          for (let k = 0; k < w; k++) options.push({ pid: p.pid, ev: e });
        });
      });
      if (!options.length) break;
      const pick = options[Math.floor(rnd() * options.length)];
      script.push(pick);
      st = apply(st, pick.pid, pick.ev, cfg).state;
    }
    return script;
  }

  // Example scripts: CPU-bound, I/O-bound, and a three-process ready-queue scenario.
  const PRESETS = [
    { id: 'cpu', name: 'A CPU-bound process', n: 1, script: 'P1 admit\nP1 dispatch\nP1 timeout\nP1 dispatch\nP1 timeout\nP1 dispatch\nP1 exit', note: 'It never waits for I/O. It just keeps being preempted by the timer until it finishes.' },
    { id: 'io', name: 'An I/O-bound process', n: 1, script: 'P1 admit\nP1 dispatch\nP1 wait\nP1 wake\nP1 dispatch\nP1 wait\nP1 wake\nP1 dispatch\nP1 exit', note: 'It runs briefly, then blocks for I/O again and again.' },
    { id: 'queue', name: 'Ready queue contention', n: 3, script: 'P1 admit\nP2 admit\nP3 admit\nP1 dispatch\nP1 timeout\nP2 dispatch\nP2 wait\nP3 dispatch\nP3 exit\nP2 wake\nP1 dispatch\nP1 exit\nP2 dispatch\nP2 exit', note: 'Three processes share one CPU. Watch the order of the ready queue change.' }
  ];

  NS.procstate = { STATES, STATE_LABEL, EVENTS, EVENT_IDS, LIMITS, PRESETS, legality, apply, parseScript, simulate, generate, regsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.procstate;
})(typeof window !== 'undefined' ? window : globalThis);
