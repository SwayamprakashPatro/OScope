/* Tier 2C: Linux CFS (Completely Fair Scheduler), simplified. Pure logic, no DOM.
   Idea: every task has a virtual runtime (vruntime) that grows while it runs, slower for heavy (high-priority) tasks.
   The scheduler always runs the task with the SMALLEST vruntime, so every task gets CPU in proportion to its weight.

   Simplifications (also stated in the lab): one CPU, whole-tick time, a red-black tree is replaced by "pick the
   minimum", no wake-up preemption (a task runs to the end of its slice), no cgroups, no sleeping tasks. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_TICKS = 200, MAX_PROCS = 8;
  // The kernel's nice -> weight table (prio_to_weight). nice 0 = 1024; each nice step changes the weight by about 1.25x.
  const WEIGHTS = [88761, 71755, 56483, 46273, 36291, 29154, 23254, 18705, 14949, 11916, 9548, 7620, 6100, 4904, 3906, 3121, 2501, 1991, 1586, 1277,
    1024, 820, 655, 526, 423, 335, 272, 215, 172, 137, 110, 87, 70, 56, 45, 36, 29, 23, 18, 15];
  const weightOf = (nice) => WEIGHTS[nice + 20];

  function parse(text) {
    const errors = [], procs = [];
    String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      const tk = line.split(/\s+/);
      if (tk.length < 3 || tk.length > 4 || !/^\d+$/.test(tk[1]) || !/^\d+$/.test(tk[2]) || (tk[3] !== undefined && !/^-?\d+$/.test(tk[3]))) { errors.push('Line ' + (i + 1) + ': use "name arrive burst [nice]".'); return; }
      const nice = tk[3] === undefined ? 0 : +tk[3];
      if (+tk[2] < 1) errors.push('Line ' + (i + 1) + ': burst must be at least 1.');
      if (nice < -20 || nice > 19) errors.push('Line ' + (i + 1) + ': nice must be -20 to 19.');
      if (procs.some((p) => p.name === tk[0])) errors.push('Line ' + (i + 1) + ': duplicate name "' + tk[0] + '".');
      procs.push({ name: tk[0], arrive: +tk[1], burst: +tk[2], nice });
    });
    if (!procs.length) errors.push('Enter at least one task.');
    if (procs.length > MAX_PROCS) errors.push('At most ' + MAX_PROCS + ' tasks.');
    return { procs, errors };
  }

  function run(cfg) {
    const latency = +cfg.latency, gran = +cfg.gran, errors = [];
    if (!(Number.isInteger(latency) && latency >= 1 && latency <= 100)) errors.push('Target latency must be a whole number from 1 to 100 ticks.');
    if (!(Number.isInteger(gran) && gran >= 1 && gran <= latency)) errors.push('Minimum granularity must be a whole number from 1 up to the target latency.');
    const parsed = parse(cfg.procs); errors.push(...parsed.errors);
    if (errors.length) return { ok: false, errors };

    const P = parsed.procs.map((p, i) => ({ ...p, i, w: weightOf(p.nice), vr: 0, rem: p.burst, state: 'new', ran: 0, finish: -1, first: -1, wait: 0 }));
    let minVr = 0, running = null, sliceLeft = 0, slice = 0, t = 0;
    const frames = [];
    while (P.some((p) => p.state !== 'done') && t < MAX_TICKS) {
      const notes = [];
      // arrivals: a new task starts at min_vruntime so it neither starves the others nor is starved itself
      P.forEach((p) => { if (p.state === 'new' && p.arrive <= t) { p.state = 'ready'; p.vr = minVr; notes.push(p.name + ' arrives with vruntime = min_vruntime = ' + minVr.toFixed(1)); } });
      if (!running) {
        const ready = P.filter((p) => p.state === 'ready');
        if (ready.length) {
          running = ready.reduce((a, b) => (b.vr < a.vr - 1e-9 ? b : a));   // smallest vruntime; ties go to the earlier task
          const totalW = ready.reduce((a, p) => a + p.w, 0);
          slice = Math.max(gran, Math.round(latency * running.w / totalW)); sliceLeft = slice; running.state = 'run';
          notes.push('pick ' + running.name + ' (smallest vruntime ' + running.vr.toFixed(1) + '); slice = max(' + gran + ', ' + latency + ' x ' + running.w + '/' + totalW + ') = ' + slice + ' ticks');
        }
      }
      const before = P.map((p) => ({ name: p.name, vr: p.vr, state: p.state, rem: p.rem }));
      if (running) {
        if (running.first < 0) running.first = t;
        running.rem--; running.ran++; sliceLeft--; running.vr += 1024 / running.w;
      }
      P.forEach((p) => { if (p.state === 'ready') p.wait++; });
      const live = P.filter((p) => p.state === 'ready' || p.state === 'run');
      if (live.length) minVr = Math.max(minVr, Math.min(...live.map((p) => p.vr)));
      frames.push({ t, running: running ? running.name : null, slice: running ? slice : null, sliceLeft: running ? sliceLeft : null, tasks: P.map((p, k) => ({ name: p.name, vr: before[k].vr, vrAfter: p.vr, state: before[k].state, weight: p.w, nice: p.nice, rem: before[k].rem })), minVr, notes });
      if (running) {
        if (running.rem === 0) { running.state = 'done'; running.finish = t + 1; frames[frames.length - 1].notes.push(running.name + ' finishes'); running = null; }
        else if (sliceLeft === 0) { running.state = 'ready'; frames[frames.length - 1].notes.push(running.name + ' slice over; vruntime now ' + running.vr.toFixed(1)); running = null; }
      }
      t++;
    }
    if (P.some((p) => p.state !== 'done')) return { ok: false, errors: ['Simulation passed ' + MAX_TICKS + ' ticks. Shorten the bursts.'] };
    const totalW = P.reduce((a, p) => a + p.w, 0);
    const rows = P.map((p) => ({ name: p.name, nice: p.nice, weight: p.w, burst: p.burst, arrive: p.arrive, finish: p.finish, turnaround: p.finish - p.arrive, waiting: p.wait, response: p.first - p.arrive, fairShare: p.w / totalW }));
    return { ok: true, cfg: { latency, gran }, frames, procs: rows, ticks: frames.length, weights: WEIGHTS };
  }

  const PRESETS = [
    { id: 'equal', name: 'Equal tasks share evenly', note: 'Same weight, so they take turns with equal slices and vruntimes stay level.', state: { latency: 6, gran: 1, procs: 'A 0 9\nB 0 9\nC 0 9' } },
    { id: 'nice', name: 'Nice values change the share', note: 'B is "nice 5" (weight 335 against 1024). Its vruntime grows about 3x faster, so it gets about a third of A\'s CPU.', state: { latency: 6, gran: 1, procs: 'A 0 16 0\nB 0 16 5' } },
    { id: 'late', name: 'A late arrival', note: 'C arrives while A and B have a high vruntime. It starts at min_vruntime, not 0, so it cannot hog the CPU for a long catch-up.', state: { latency: 6, gran: 1, procs: 'A 0 14\nB 0 14\nC 8 6' } },
    { id: 'gran', name: 'Minimum granularity', note: 'With 4 tasks the ideal slice is 8/4 = 2 ticks, but the minimum granularity of 3 stops slices getting too short.', state: { latency: 8, gran: 3, procs: 'A 0 9\nB 0 9\nC 0 9\nD 0 9' } }
  ];
  NS.cfs = { MAX_TICKS, WEIGHTS, weightOf, parse, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.cfs;
})(typeof window !== 'undefined' ? window : globalThis);
