/* MLQ / MLFQ view: a per-process timeline (which queue each process waits in, when it runs, when it is blocked on I/O),
   the queues at the chosen tick, and the finishing statistics. All numbers come from NS.mlfq.run. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, PV = NS.pv, P = NS.mlfq.PRESETS[0];
  K.reg('mlfq', {
    key: 'mlfq', title: 'Multilevel queues', statsTitle: 'Results per process', visualTitle: 'Timeline', label: 'Tick',
    chips: { key: 'mode', label: 'Scheduler type', options: [['mlfq', 'Feedback queues (MLFQ)'], ['mlq', 'Fixed queues (MLQ)']] },
    intro: 'Several ready queues, each with its own time slice. A higher queue always goes first. In MLFQ the scheduler learns: jobs that hog the CPU sink to lower queues, jobs that wait for I/O stay on top. In MLQ a job lives in one queue forever.',
    defaults: P.state,
    presets: NS.mlfq.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'quanta', label: 'Time slice per queue (top first)', type: 'text', hint: 'For example "2 4 8". A slice of 0 means no time limit (run until done or blocked).', half: true }, { key: 'boost', label: 'Boost every N ticks (MLFQ)', type: 'number', min: 0, hint: '0 = never boost.', half: true },
      { key: 'procs', label: 'Processes', type: 'area', rows: 6, hint: 'One per line: name arrive burst [ioRun ioWait] [qN]. "B 2 8 3 2" = runs 3 ticks, then waits 2 ticks for I/O, repeating. "qN" fixes the queue (MLQ).' }],
    about: [['Rule 1', 'A higher queue always runs before a lower one. A job in a lower queue is preempted when a higher queue gets a job.'], ['Rule 2 (MLFQ)', 'New jobs start in the top queue. Using a whole time slice means "CPU-bound": move one queue down.'], ['Rule 3 (MLFQ)', 'Blocking for I/O before the slice ends means "interactive": stay at the same level.'], ['Rule 4 (MLFQ)', 'Every N ticks everyone returns to the top queue (the boost), so long jobs do not starve.'], ['MLQ', 'No movement between queues. Each queue can have its own policy, for example round robin for interactive jobs and FCFS for batch.'], ['Memory hook', 'Short and sleepy stays up, long and greedy sinks, and the boost lifts everyone.']],
    compute: (s) => PV.withStart(NS.mlfq.run({ mode: s.mode, quanta: s.quanta, boost: +s.boost || 0, procs: s.procs })),
    draw: (f, i, sim) => {
      const names = sim.procs.map((p) => p.name), T = sim.ticksFrames, now = i - 1;
      const rows = sim.procs.map((p, k) => ({ label: p.name, cell: (t) => {
        const fr = T[t]; if (!fr) return null;
        if (fr.running === p.name) return { cls: 'run', bg: colorFor(k), text: 'q' + fr.level, title: p.name + ' runs in q' + fr.level + ' at tick ' + t };
        const qi = fr.queues.findIndex((q) => q.includes(p.name)); if (qi >= 0) return { cls: 'wait', text: 'q' + qi, title: p.name + ' waits in q' + qi };
        if (fr.io.includes(p.name)) return { cls: 'io', text: 'I/O', title: p.name + ' is blocked on I/O' };
        return null; } }));
      const cur = f.start ? null : f;
      const qbox = cur ? el('div', { class: 'pv-qs' }, el('div', { class: 'pv-q cpu' }, el('b', null, 'CPU'), cur.running ? [PV.chip(cur.running, names.indexOf(cur.running)), el('small', null, 'queue q' + cur.level + (cur.quantum ? ', slice ' + cur.used + ' of ' + cur.quantum : ', no slice limit') + ', ' + cur.rem + ' left')] : PV.empty()),
        cur.queues.map((q, l) => el('div', { class: 'pv-q' }, el('b', null, 'Queue ' + l), el('small', null, sim.cfg.quanta[l] ? 'slice ' + sim.cfg.quanta[l] : 'no limit'), q.length ? q.map((n) => PV.chip(n, names.indexOf(n))) : PV.empty())),
        el('div', { class: 'pv-q' }, el('b', null, 'Blocked (I/O)'), cur.io.length ? cur.io.map((n) => PV.chip(n, names.indexOf(n))) : PV.empty())) : null;
      return { visual: [PV.timeline({ ticks: T.length, now, rows, aria: 'Timeline: a coloured block means the process runs that tick; a dashed block means it waits in a queue' }), PV.legend([['', 'solid = running (label shows its queue)'], ['wait', 'dashed = waiting in that queue'], ['io', 'hatched = blocked on I/O']]), qbox],
        why: cur ? [cur.notes.length ? el('ul', { class: 'fv-steps' }, cur.notes.map((n) => el('li', null, n))) : el('p', { class: 'hint' }, cur.running ? cur.running + ' keeps running.' : 'The CPU is idle: nothing is ready.')] : [el('p', { class: 'hint' }, 'Press play or step to run the scheduler one tick at a time.')] };
    },
    stats: (f, sim) => [K.table(['Process', 'Arrives', 'Burst', 'Finish', 'Turnaround', 'Waiting', 'Response', 'I/O time'], sim.procs.map((p) => [p.name, p.arrive, p.burst, p.finish, p.turnaround, p.waiting, p.response, p.ioTime])),
      K.metrics([['Avg turnaround', PV.f1(sim.avg.turnaround)], ['Avg waiting', PV.f1(sim.avg.waiting)], ['Avg response', PV.f1(sim.avg.response)], ['Total ticks', sim.ticks]]),
      el('p', { class: 'hint' }, 'Waiting = ticks spent ready but not running (not counting I/O). Response = first run minus arrival. Honest limits: whole-tick time; a preempted job restarts its quantum; a job that blocks right at the end of its slice keeps its level, which is the classic way to "game" MLFQ.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
