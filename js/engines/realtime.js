/* Tier 2C: real-time scheduling of periodic tasks: EDF and RMS. Pure logic, no DOM.
   A task is (C, T, D): it needs C ticks of CPU in every period T and each job must finish within D ticks of its
   release (D defaults to T). All tasks release their first job at time 0. Preemptive, one CPU.
   EDF  (earliest deadline first): run the ready job whose absolute deadline is soonest. Dynamic priority.
   RMS  (rate monotonic): run the ready job of the task with the shortest period. Fixed priority.
   A job that is still unfinished at its deadline is marked MISSED, but it keeps running to completion (late), so you
   can watch the damage spread. Ties go to the task listed first. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_TASKS = 6, MAX_HORIZON = 200;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a), lcm = (a, b) => (a / gcd(a, b)) * b;

  function parse(text) {
    const errors = [], tasks = [];
    String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      const tk = line.split(/\s+/);
      if (tk.length < 3 || tk.length > 4 || tk.slice(1).some((x) => !/^\d+$/.test(x))) { errors.push('Line ' + (i + 1) + ': use "name C T [D]" (C = run time, T = period, D = deadline).'); return; }
      const [C, T, D = +tk[2]] = tk.slice(1).map(Number);
      if (C < 1) errors.push('Line ' + (i + 1) + ': C must be at least 1.');
      if (T < 1) errors.push('Line ' + (i + 1) + ': T must be at least 1.');
      if (D < 1) errors.push('Line ' + (i + 1) + ': D must be at least 1.');
      if (D > T) errors.push('Line ' + (i + 1) + ': this lab needs D <= T (deadline no later than the next release).');
      if (C > D) errors.push('Line ' + (i + 1) + ': C > D, so the task can never meet its deadline even on an idle CPU.');
      if (tasks.some((x) => x.name === tk[0])) errors.push('Line ' + (i + 1) + ': duplicate name "' + tk[0] + '".');
      tasks.push({ name: tk[0], C, T, D });
    });
    if (!tasks.length) errors.push('Enter at least one task.');
    if (tasks.length > MAX_TASKS) errors.push('At most ' + MAX_TASKS + ' tasks.');
    return { tasks, errors };
  }

  function run(cfg) {
    const algo = cfg.algo === 'rms' ? 'rms' : 'edf', errors = [];
    const parsed = parse(cfg.tasks); errors.push(...parsed.errors);
    const tasks = parsed.tasks;
    let hyper = null, horizon = +cfg.horizon;
    if (!errors.length) {
      hyper = tasks.reduce((a, x) => lcm(a, x.T), 1);
      if (!cfg.horizon && cfg.horizon !== 0) horizon = Math.min(hyper, MAX_HORIZON);
      if (!(Number.isInteger(horizon) && horizon >= 1 && horizon <= MAX_HORIZON)) errors.push('Horizon must be a whole number from 1 to ' + MAX_HORIZON + ' ticks (leave blank for the hyperperiod).');
    }
    if (errors.length) return { ok: false, errors };

    const n = tasks.length, U = tasks.reduce((a, x) => a + x.C / x.T, 0);
    const bound = n * (Math.pow(2, 1 / n) - 1), allDEqT = tasks.every((x) => x.D === x.T);
    const jobs = [], frames = []; let active = [];
    for (let t = 0; t < horizon; t++) {
      const notes = [];
      tasks.forEach((tk, i) => { if (t % tk.T === 0) { const j = { task: i, k: t / tk.T, release: t, deadline: t + tk.D, rem: tk.C, finish: -1, missed: false }; jobs.push(j); active.push(j); notes.push(tk.name + ' releases job ' + j.k + ' (deadline ' + j.deadline + ')'); } });
      active.forEach((j) => { if (!j.missed && t >= j.deadline) { j.missed = true; notes.push('DEADLINE MISSED: ' + tasks[j.task].name + ' job ' + j.k + ' (deadline ' + j.deadline + ')'); } });
      const key = (j) => (algo === 'edf' ? [j.deadline, j.task, j.release] : [tasks[j.task].T, j.task, j.release]);
      const cmp = (a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
      const sorted = active.slice().sort(cmp), pick = sorted[0] || null;
      frames.push({ t, running: pick ? tasks[pick.task].name : null, job: pick ? pick.k : null, ready: sorted.slice(1).map((j) => tasks[j.task].name + '#' + j.k), notes, deadlineOfRunning: pick ? pick.deadline : null });
      if (pick) { pick.rem--; if (pick.rem === 0) { pick.finish = t + 1; active = active.filter((j) => j !== pick); if (pick.finish > pick.deadline) { pick.missed = true; } frames[frames.length - 1].notes.push(tasks[pick.task].name + ' job ' + pick.k + ' completes at ' + (t + 1) + (pick.finish > pick.deadline ? ' (late)' : ' (on time)')); } }
    }
    // a job whose deadline falls beyond the horizon and is unfinished is "not judged"
    jobs.forEach((j) => { j.judged = j.finish >= 0 || j.deadline <= horizon; if (!j.judged) j.missed = false; j.response = j.finish >= 0 ? j.finish - j.release : null; });
    const missed = jobs.filter((j) => j.missed);
    const verdictTest = algo === 'edf' ? (allDEqT ? (U <= 1 + 1e-12 ? 'EDF guarantees every deadline (U <= 1, D = T).' : 'U > 1: no scheduler can meet every deadline.') : 'D < T: the simple U <= 1 test does not apply here; only the simulation tells you.')
      : (!allDEqT ? 'D < T: the Liu-Layland bound does not apply here; only the simulation tells you.' : U <= bound + 1e-12 ? 'U is within the Liu-Layland bound, so RMS guarantees every deadline.' : U > 1 + 1e-12 ? 'U > 1: no scheduler can meet every deadline.' : 'U is above the bound but not above 1: RMS may or may not succeed (the bound is sufficient, not necessary). Check the simulation.');
    return { ok: true, cfg: { algo, horizon }, tasks, frames, jobs, U, bound, hyper, missed, verdictTest, allDEqT, busy: frames.filter((f) => f.running).length };
  }

  const PRESETS = [
    { id: 'edf', name: 'EDF succeeds at U = 1', note: 'Utilisation is exactly 100% and EDF still meets every deadline.', state: { algo: 'edf', horizon: '', tasks: 'T1 2 5\nT2 4 10\nT3 2 10' } },
    { id: 'rms-fail', name: 'RMS misses, EDF does not', note: 'U = 0.97 is above the RMS bound (0.83). Switch between RMS and EDF: RMS drops a deadline, EDF meets all of them.', state: { algo: 'rms', horizon: '', tasks: 'T1 2 5\nT2 4 7' } },
    { id: 'harmonic', name: 'RMS passes above the bound', note: 'Periods 2, 4, 8 are multiples of each other (harmonic). U = 1.0 is far above the bound 0.78, yet RMS works: the bound is only sufficient.', state: { algo: 'rms', horizon: '', tasks: 'T1 1 2\nT2 1 4\nT3 2 8' } },
    { id: 'over', name: 'Overload (U > 1)', note: 'More work than CPU. Whatever you pick, deadlines are missed; EDF misses cascade ("domino effect").', state: { algo: 'edf', horizon: '', tasks: 'T1 3 4\nT2 3 6' } }
  ];
  NS.realtime = { MAX_HORIZON, parse, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.realtime;
})(typeof window !== 'undefined' ? window : globalThis);
