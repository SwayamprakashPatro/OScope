/* Real-time view: one row per periodic task with release (↑) and deadline (⚑) markers, runs coloured, misses in red;
   plus utilisation, the schedulability test and the per-job table. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, PV = NS.pv, P = NS.realtime.PRESETS[0];
  K.reg('realtime', {
    key: 'realtime', title: 'Real-time scheduling: EDF and RMS', statsTitle: 'Schedulability', visualTitle: 'Periodic tasks and deadlines', label: 'Tick',
    chips: { key: 'algo', label: 'Algorithm', options: [['edf', 'EDF (earliest deadline first)'], ['rms', 'RMS (rate monotonic)']] },
    intro: 'Real-time tasks repeat every period T and must finish before a deadline. RMS gives the shortest period the highest fixed priority. EDF always runs the job whose deadline is nearest. Check the utilisation test, then watch the simulation to see if it really holds.',
    defaults: P.state,
    presets: NS.realtime.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'tasks', label: 'Tasks', type: 'area', rows: 6, hint: 'One per line: name C T [D]. C = run time per period, T = period, D = deadline (default T). Every task releases its first job at time 0.' }, { key: 'horizon', label: 'Ticks to simulate (blank = one hyperperiod, max 200)', type: 'number', min: 1, max: 200 }],
    about: [['Utilisation', 'U = sum of C/T. It is the fraction of the CPU the tasks need. Above 1 nothing can work.'], ['EDF', 'Dynamic priority. With D = T, EDF meets every deadline exactly when U <= 1.'], ['RMS', 'Fixed priority by period. Guaranteed if U <= n(2^(1/n) - 1), about 0.69 for many tasks. The bound is sufficient, not necessary.'], ['Missed deadline', 'A job still unfinished at its deadline. Here it keeps running late, so you can see the damage spread.'], ['Memory hook', 'EDF = "earliest deadline, first"; RMS = "rapid repeaters rule".']],
    compute: (s) => PV.withStart(NS.realtime.run({ algo: s.algo, tasks: s.tasks, horizon: s.horizon === '' || s.horizon == null ? undefined : +s.horizon })),
    draw: (f, i, sim) => {
      const T = sim.ticksFrames, now = i - 1, H = T.length, cur = f.start ? null : f;
      const rows = sim.tasks.map((tk, k) => ({ label: tk.name + ' (' + tk.C + '/' + tk.T + (tk.D !== tk.T ? '/' + tk.D : '') + ')', cell: (t) => {
        const fr = T[t]; const rel = t % tk.T === 0, jobStart = Math.floor(t / tk.T) * tk.T;
        const miss = sim.jobs.some((j) => j.task === k && j.missed && j.deadline === t);
        const dlHere = (t - jobStart) === tk.D ? true : false;
        const running = fr && fr.running === tk.name;
        const c = running ? { cls: 'run', bg: colorFor(k), text: String(fr.job), title: tk.name + ' job ' + fr.job + ' runs' } : (fr && fr.ready.some((r) => r.startsWith(tk.name + '#')) ? { cls: 'wait', text: '' } : {});
        const m = (rel ? '↑' : '') + (dlHere ? (miss ? '✗' : '⚑') : ''); if (m) { c.cls = (c.cls || '') + ' mark'; c.m = m; }
        return Object.assign(c, { title: (c.title || '') + (rel ? ' release' : '') + (dlHere ? ' deadline' : '') });
      } }));
      const tl = PV.timeline({ ticks: H, now, rows, aria: 'Timeline of periodic tasks with release arrows and deadline flags' });
      return { visual: [tl, PV.legend([['', '↑ job released'], ['', '⚑ deadline'], ['wait', 'dashed = ready, not running'], ['', 'number in a block = job index']])],
        why: cur ? [cur.notes.length ? el('ul', { class: 'fv-steps' }, cur.notes.map((n) => el('li', { class: /MISSED|late/.test(n) ? 'mv-bad' : '' }, n))) : el('p', { class: 'hint' }, cur.running ? cur.running + ' job ' + cur.job + ' runs (ready behind it: ' + (cur.ready.join(', ') || 'none') + ').' : 'The CPU is idle.')] : [el('p', { class: 'hint' }, 'Step through to see which job the scheduler chooses at each tick.')] };
    },
    stats: (f, sim) => [K.metrics([['Utilisation', sim.U.toFixed(3)], ['RMS bound (n=' + sim.tasks.length + ')', sim.bound.toFixed(3)], ['Hyperperiod', sim.hyper], ['Missed deadlines', sim.missed.length]]),
      el('p', { class: sim.missed.length ? 'mv-bad' : 'mv-ok' }, sim.missed.length ? 'The simulation shows ' + sim.missed.length + ' missed deadline' + (sim.missed.length > 1 ? 's' : '') + '.' : 'The simulation shows no missed deadlines in these ' + sim.ticksFrames.length + ' ticks.'), el('p', { class: 'hint' }, 'Test: ' + sim.verdictTest),
      K.table(['Task', 'Job', 'Released', 'Deadline', 'Finished', 'Result'], sim.jobs.filter((j) => j.judged).map((j) => [sim.tasks[j.task].name, j.k, j.release, j.deadline, j.finish < 0 ? 'not done' : j.finish, j.missed ? 'MISSED' : 'on time'])),
      el('p', { class: 'hint' }, 'Honest limits: one CPU, preemption is free, tasks never block, all start at time 0, deadlines no later than the period, and a late job keeps running instead of being dropped.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
