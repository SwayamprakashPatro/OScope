/* Tier 2C: multilevel queue (MLQ) and multilevel feedback queue (MLFQ) scheduling.
   Pure logic, no DOM. run(cfg) -> { ok, errors, frames, procs, ticks, ... }.

   Rules used (stated in the lab too, because textbooks differ):
   MLFQ  1. Every new job enters the top queue (queue 0).
         2. Higher queue always runs first (strict priority); a job in a lower queue is preempted the moment a
            higher queue has a job. A preempted job goes to the TAIL of its own queue and its quantum restarts.
         3. A job that uses its whole quantum is demoted one queue (it looks CPU-bound).
         4. A job that blocks for I/O before its quantum ends keeps its level (it looks interactive).
         5. Every `boost` ticks all jobs jump back to queue 0, so nothing starves.
   MLQ   Each job is permanently assigned to a queue; no demotion, no boost. Strict priority between queues.
   A quantum of 0 means "no time slice": the queue is FCFS and runs the job until it finishes or blocks.
   Time is in whole ticks. At tick t: arrivals and I/O completions join their queue, then the scheduler picks. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_TICKS = 200, MAX_PROCS = 8, MAX_QUEUES = 5;

  // parseProcs: lines "name arrive burst [ioRun ioWait] [qN]"  e.g.  "B 2 8 3 2"  or  "C 0 6 q1"
  function parseProcs(text, mode, nq) {
    const errors = [], procs = [];
    String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, idx) => {
      const tk = line.split(/\s+/), name = tk[0], nums = [];
      let q = null;
      tk.slice(1).forEach((t) => { if (/^q\d+$/i.test(t)) q = +t.slice(1); else nums.push(t); });
      if (nums.some((n) => !/^\d+$/.test(n)) || nums.length < 2 || nums.length === 3 || nums.length > 4) { errors.push('Line ' + (idx + 1) + ': use "name arrive burst [ioRun ioWait] [qN]".'); return; }
      const [arrive, burst, ioRun = 0, ioWait = 0] = nums.map(Number);
      if (burst < 1) errors.push('Line ' + (idx + 1) + ': burst must be at least 1.');
      if ((ioRun === 0) !== (ioWait === 0)) errors.push('Line ' + (idx + 1) + ': ioRun and ioWait must both be above 0 (or both left out).');
      if (procs.some((p) => p.name === name)) errors.push('Line ' + (idx + 1) + ': duplicate name "' + name + '".');
      if (mode === 'mlq' && q === null) q = 0;
      if (q !== null && q >= nq) errors.push('Line ' + (idx + 1) + ': queue q' + q + ' does not exist (queues are q0 to q' + (nq - 1) + ').');
      procs.push({ name, arrive, burst, ioRun, ioWait, q });
    });
    if (!procs.length) errors.push('Enter at least one process.');
    if (procs.length > MAX_PROCS) errors.push('At most ' + MAX_PROCS + ' processes.');
    return { procs, errors };
  }

  function run(cfg) {
    const mode = cfg.mode === 'mlq' ? 'mlq' : 'mlfq', errors = [];
    const quanta = String(cfg.quanta || '').split(/[\s,]+/).filter(Boolean).map((x) => (/^\d+$/.test(x) ? +x : NaN));
    if (!quanta.length || quanta.length > MAX_QUEUES || quanta.some((q) => !(q >= 0 && q <= 50))) errors.push('Queues: give 1 to ' + MAX_QUEUES + ' quanta (0 to 50), e.g. "2 4 8". 0 means run to completion.');
    const boost = +cfg.boost || 0;
    if (!(boost >= 0 && Number.isInteger(boost))) errors.push('Boost period must be a whole number (0 = never).');
    const parsed = parseProcs(cfg.procs, mode, quanta.length || 1);
    errors.push(...parsed.errors);
    if (errors.length) return { ok: false, errors };

    const NQ = quanta.length;
    const P = parsed.procs.map((p, i) => ({ ...p, i, level: mode === 'mlq' ? p.q : 0, rem: p.burst, used: 0, sinceIO: 0, wakeAt: -1, state: 'new', waiting: 0, ioTime: 0, first: -1, finish: -1 }));
    const queues = Array.from({ length: NQ }, () => []);
    const frames = [], blocked = new Set();
    let running = null, t = 0;
    const names = (q) => q.map((p) => p.name);
    const snap = () => queues.map(names);

    while (P.some((p) => p.state !== 'done') && t < MAX_TICKS) {
      const notes = [];
      P.forEach((p) => { if (p.state === 'new' && p.arrive <= t) { p.state = 'ready'; queues[p.level].push(p); notes.push(p.name + ' arrives in q' + p.level); } });
      P.forEach((p) => { if (p.state === 'io' && p.wakeAt <= t) { p.state = 'ready'; blocked.delete(p); queues[p.level].push(p); notes.push(p.name + ' finishes I/O, back in q' + p.level); } });
      if (mode === 'mlfq' && boost > 0 && t > 0 && t % boost === 0) {
        let moved = 0;
        for (let l = 1; l < NQ; l++) while (queues[l].length) { const p = queues[l].shift(); p.level = 0; queues[0].push(p); moved++; }
        if (running && running.level !== 0) { running.level = 0; running.used = 0; moved++; }
        P.forEach((p) => { if (p.state === 'io') p.level = 0; });   // sleeping jobs also return to the top
        notes.push('BOOST: every job returns to q0' + (moved ? '' : ' (nothing was below)'));
      }
      // preemption: a job waiting in a higher queue than the running job takes the CPU
      if (running) {
        const top = queues.findIndex((q) => q.length);
        if (top !== -1 && top < running.level) { notes.push(queues[top][0].name + ' (q' + top + ') preempts ' + running.name + ' (q' + running.level + ')'); running.used = 0; queues[running.level].push(running); running.state = 'ready'; running = null; }
      }
      if (!running) {
        const top = queues.findIndex((q) => q.length);
        if (top !== -1) { running = queues[top].shift(); running.state = 'run'; running.used = 0; notes.push('dispatch ' + running.name + ' from q' + top); }
      }
      // account one tick
      if (running) {
        if (running.first < 0) running.first = t;
        running.rem--; running.used++; running.sinceIO++;
      }
      P.forEach((p) => { if (p.state === 'ready') p.waiting++; if (p.state === 'io') p.ioTime++; });
      frames.push({ t, running: running ? running.name : null, level: running ? running.level : null, rem: running ? running.rem : null, queues: snap(), io: P.filter((p) => p.state === 'io').map((p) => p.name), notes, quantum: running ? quanta[running.level] : null, used: running ? running.used : null });
      // end of tick: what happens to the running job?
      if (running) {
        const r = running; const q = quanta[r.level];
        if (r.rem === 0) { r.state = 'done'; r.finish = t + 1; frames[frames.length - 1].notes.push(r.name + ' finishes'); running = null; }
        else if (r.ioRun > 0 && r.sinceIO === r.ioRun) { r.sinceIO = 0; r.state = 'io'; r.wakeAt = t + 1 + r.ioWait; frames[frames.length - 1].notes.push(r.name + ' blocks for I/O, stays in q' + r.level + ' (gave up the CPU early)'); running = null; }
        else if (q > 0 && r.used >= q) {
          if (mode === 'mlfq' && r.level < NQ - 1) { r.level++; frames[frames.length - 1].notes.push(r.name + ' used its whole quantum: demoted to q' + r.level); }
          else frames[frames.length - 1].notes.push(r.name + ' quantum over' + (mode === 'mlq' ? ': back to the tail of q' + r.level : ' (already in the last queue)'));
          r.state = 'ready'; queues[r.level].push(r); running = null;
        }
      }
      t++;
    }
    if (P.some((p) => p.state !== 'done')) return { ok: false, errors: ['Simulation passed ' + MAX_TICKS + ' ticks. Shorten the bursts or I/O waits.'] };
    const rows = P.map((p) => ({ name: p.name, arrive: p.arrive, burst: p.burst, finish: p.finish, turnaround: p.finish - p.arrive, waiting: p.waiting, response: p.first - p.arrive, ioTime: p.ioTime }));
    const avg = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
    return { ok: true, cfg: { mode, quanta, boost }, frames, procs: rows, ticks: frames.length, avg: { turnaround: avg('turnaround'), waiting: avg('waiting'), response: avg('response') } };
  }

  const PRESETS = [
    { id: 'basic', name: 'MLFQ: CPU-bound vs short job', note: 'A is CPU-bound and sinks; B arrives later with a short burst and gets in quickly because it enters the top queue.', state: { mode: 'mlfq', quanta: '2 4 0', boost: 0, procs: 'A 0 9\nB 3 3' } },
    { id: 'io', name: 'MLFQ: interactive job stays high', note: 'B blocks for I/O every tick, never uses a whole quantum, and so stays in q0.', state: { mode: 'mlfq', quanta: '2 4 0', boost: 0, procs: 'A 0 10\nB 0 4 1 2' } },
    { id: 'starve', name: 'Starvation and the boost', note: 'Short jobs keep arriving and push the long job down. Set Boost to 0 to see it wait; with a boost it gets back to q0.', state: { mode: 'mlfq', quanta: '2 4 0', boost: 12, procs: 'L 0 8\nS1 3 4\nS2 6 4\nS3 9 4' } },
    { id: 'mlq', name: 'MLQ: fixed queues', note: 'System jobs sit in q0, interactive in q1, batch in q2. A lower queue only runs when every queue above it is empty.', state: { mode: 'mlq', quanta: '2 3 0', boost: 0, procs: 'sys 2 4 q0\nui 0 6 q1\nbatch1 0 5 q2\nbatch2 1 3 q2' } }
  ];
  NS.mlfq = { MAX_TICKS, parseProcs, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.mlfq;
})(typeof window !== 'undefined' ? window : globalThis);
