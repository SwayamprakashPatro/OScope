/* Tier 2C: server threading models: single thread, thread-per-request and a fixed thread pool. Pure logic, no DOM.
   The same stream of requests (name, arrival tick, work in CPU ticks) is served three different ways on `cores` CPUs.

   single      one thread handles one request at a time, the rest wait in an unbounded queue.
   perrequest  every request gets a brand-new thread (costs `spawn` ticks to create). Nothing limits the thread count.
   pool        `workers` threads are created once and reused. Requests wait in a queue of at most `queueCap`;
               a request that arrives when every worker is busy AND the queue is full is REJECTED.

   CPU model (a deliberate toy): with `a` runnable threads on `cores` cores each gets rate min(1, cores/a), then loses a
   further `overhead` fraction per thread beyond the core count (context switches, cache misses), never below 20%.
   Work is fractional but requests complete on whole ticks (finish time is rounded up). Thread creation delay does not
   use CPU in this model. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_TICKS = 200, MAX_REQ = 12;

  function parse(text) {
    const errors = [], reqs = [];
    String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      const tk = line.split(/\s+/);
      if (tk.length !== 3 || !/^\d+$/.test(tk[1]) || !/^\d+$/.test(tk[2])) { errors.push('Line ' + (i + 1) + ': use "name arrive work".'); return; }
      if (+tk[2] < 1 || +tk[2] > 30) errors.push('Line ' + (i + 1) + ': work must be 1 to 30 ticks.');
      if (reqs.some((r) => r.name === tk[0])) errors.push('Line ' + (i + 1) + ': duplicate name "' + tk[0] + '".');
      reqs.push({ name: tk[0], arrive: +tk[1], work: +tk[2] });
    });
    if (!reqs.length) errors.push('Enter at least one request.'); if (reqs.length > MAX_REQ) errors.push('At most ' + MAX_REQ + ' requests.');
    return { reqs, errors };
  }

  function run(cfg) {
    const model = ['single', 'perrequest', 'pool'].includes(cfg.model) ? cfg.model : 'pool', errors = [];
    const cores = +cfg.cores, workers = +cfg.workers, queueCap = +cfg.queueCap, spawn = +cfg.spawn, over = (+cfg.overhead) / 100;
    if (!(Number.isInteger(cores) && cores >= 1 && cores <= 16)) errors.push('Cores must be a whole number from 1 to 16.');
    if (!(Number.isInteger(workers) && workers >= 1 && workers <= 16)) errors.push('Pool size must be a whole number from 1 to 16.');
    if (!(Number.isInteger(queueCap) && queueCap >= 0 && queueCap <= 20)) errors.push('Queue size must be a whole number from 0 to 20.');
    if (!(Number.isInteger(spawn) && spawn >= 0 && spawn <= 10)) errors.push('Thread creation cost must be a whole number from 0 to 10 ticks.');
    if (!(over >= 0 && over <= 0.5)) errors.push('Overhead per extra thread must be 0 to 50 (%).');
    const parsed = parse(cfg.requests); errors.push(...parsed.errors);
    if (errors.length) return { ok: false, errors };

    const N = model === 'single' ? 1 : workers, CAP = model === 'single' ? Infinity : queueCap;
    const R = parsed.reqs.map((r, i) => ({ ...r, i, rem: r.work, state: 'new', finish: -1, start: -1 }));
    const frames = []; let queue = [], slots = Array(N).fill(null), threads = [], created = 0, peak = 0, t = 0, workDone = 0;
    const rejected = [];
    while (R.some((r) => r.state === 'new' || r.state === 'queued' || r.state === 'spawning' || r.state === 'run') && t < MAX_TICKS) {
      const notes = [];
      if (model !== 'perrequest') slots.forEach((s, k) => { if (!s && queue.length) { const r = queue.shift(); slots[k] = r; r.state = 'run'; r.start = t; notes.push('worker ' + k + ' takes ' + r.name + ' from the queue'); } });
      R.filter((r) => r.state === 'new' && r.arrive <= t).forEach((r) => {
        if (model === 'perrequest') { const th = { r, left: spawn }; threads.push(th); created++; r.state = spawn ? 'spawning' : 'run'; if (!spawn) r.start = t; notes.push(r.name + ' arrives: a NEW thread is created' + (spawn ? ' (' + spawn + ' tick' + (spawn > 1 ? 's' : '') + ')' : '')); }
        else {
          const k = slots.indexOf(null);
          if (k !== -1) { slots[k] = r; r.state = 'run'; r.start = t; notes.push(r.name + ' arrives and worker ' + k + ' is idle: starts at once'); }
          else if (queue.length < CAP) { queue.push(r); r.state = 'queued'; notes.push(r.name + ' arrives, every thread is busy: waits in the queue (' + queue.length + '/' + (CAP === Infinity ? '∞' : CAP) + ')'); }
          else { r.state = 'rejected'; rejected.push(r.name); notes.push(r.name + ' arrives, all workers busy and the queue is FULL: REJECTED'); }
        }
      });
      const spawning = model === 'perrequest' ? threads.filter((th) => th.r.state === 'spawning') : [];
      const active = model === 'perrequest' ? threads.filter((th) => th.r.state === 'run').map((th) => th.r) : slots.filter(Boolean);
      const a = active.length, rate = a ? Math.min(1, cores / a) * Math.max(0.2, 1 - over * Math.max(0, a - cores)) : 0;
      peak = Math.max(peak, model === 'perrequest' ? threads.length : N);
      const nThreads = model === 'perrequest' ? threads.length : N;
      frames.push({ t, active: active.map((r) => ({ name: r.name, rem: r.rem })), queue: queue.map((r) => r.name), spawning: spawning.map((th) => th.r.name), rate, threads: nThreads, slots: model === 'perrequest' ? null : slots.map((s) => (s ? s.name : null)), rejected: rejected.slice(), notes, done: [] });
      active.forEach((r) => { r.rem -= rate; workDone += rate; });
      spawning.forEach((th) => { th.left--; if (th.left === 0) { th.r.state = 'run'; th.r.start = t + 1; } });
      active.forEach((r) => { if (r.rem <= 1e-9) { r.rem = 0; r.state = 'done'; r.finish = t + 1; frames[frames.length - 1].done.push(r.name); frames[frames.length - 1].notes.push(r.name + ' finishes' + (model === 'perrequest' ? ' and its thread exits' : '')); } });
      if (model === 'perrequest') threads = threads.filter((th) => th.r.state !== 'done'); else slots = slots.map((s) => (s && s.state === 'done' ? null : s));
      t++;
    }
    if (R.some((r) => ['new', 'queued', 'spawning', 'run'].includes(r.state))) return { ok: false, errors: ['Simulation passed ' + MAX_TICKS + ' ticks. Reduce the work or add cores.'] };
    const done = R.filter((r) => r.state === 'done'), resp = done.map((r) => r.finish - r.arrive);
    const rows = R.map((r) => ({ name: r.name, arrive: r.arrive, work: r.work, status: r.state === 'done' ? 'done' : 'rejected', start: r.start, finish: r.finish, response: r.state === 'done' ? r.finish - r.arrive : null }));
    const total = frames.length;
    return { ok: true, cfg: { model, cores, workers: N, queueCap: CAP, spawn, overhead: over }, frames, rows,
      metrics: { completed: done.length, rejected: rejected.length, avgResponse: resp.length ? resp.reduce((a, b) => a + b, 0) / resp.length : null, maxResponse: resp.length ? Math.max(...resp) : null, ticks: total, throughput: done.length / total, peakThreads: peak, threadsCreated: model === 'perrequest' ? created : N, coreUse: workDone / (cores * total) } };
  }

  const BURST = 'A 0 4\nB 0 4\nC 0 4\nD 0 4\nE 0 4\nF 0 4\nG 0 4\nH 0 4\nI 0 4\nJ 0 4';
  const PRESETS = [
    { id: 'pool', name: 'Pool vs per-request: a burst', note: 'Ten requests arrive at once on 2 cores. Per-request creates ten threads that fight for 2 cores; try switching the model to compare.', state: { model: 'pool', cores: 2, workers: 2, queueCap: 8, spawn: 1, overhead: 10, requests: BURST } },
    { id: 'reject', name: 'Queue full: requests rejected', note: '2 workers, a queue of 2, and 6 requests at once: the last two are turned away (load shedding) rather than letting latency explode.', state: { model: 'pool', cores: 2, workers: 2, queueCap: 2, spawn: 1, overhead: 10, requests: 'A 0 6\nB 0 6\nC 0 3\nD 0 3\nE 0 3\nF 0 3' } },
    { id: 'single', name: 'Single thread: head-of-line blocking', note: 'One long request makes every short request behind it wait. More threads fix that if you have cores.', state: { model: 'single', cores: 2, workers: 2, queueCap: 8, spawn: 1, overhead: 0, requests: 'long 0 12\ns1 1 2\ns2 2 2\ns3 3 2' } },
    { id: 'spawn', name: 'Thread creation cost', note: 'Many tiny requests: per-request pays the creation cost every time, a pool pays it once.', state: { model: 'perrequest', cores: 4, workers: 4, queueCap: 8, spawn: 2, overhead: 5, requests: 'a 0 1\nb 1 1\nc 2 1\nd 3 1\ne 4 1\nf 5 1' } }
  ];
  NS.threadpool = { MAX_TICKS, parse, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.threadpool;
})(typeof window !== 'undefined' ? window : globalThis);
