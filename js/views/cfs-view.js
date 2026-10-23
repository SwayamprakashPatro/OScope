/* CFS view: timeline of who runs, vruntime bars (the scheduler picks the SHORTEST bar), and the weight/fair-share table. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, PV = NS.pv, P = NS.cfs.PRESETS[0];
  K.reg('cfs', {
    key: 'cfs', title: 'CFS: the Completely Fair Scheduler', statsTitle: 'Weights and fair share', visualTitle: 'Who runs, and each task\'s virtual runtime', label: 'Tick',
    intro: 'Linux does not use fixed priorities and queues. Every task keeps a virtual runtime that grows while it runs, more slowly for important (low nice) tasks. The scheduler always runs the task with the smallest virtual runtime, so CPU time ends up proportional to weight.',
    defaults: P.state,
    presets: NS.cfs.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'latency', label: 'Target latency (ticks)', type: 'number', min: 1, max: 100, half: true, hint: 'Every runnable task should get a turn within about this time.' }, { key: 'gran', label: 'Minimum granularity', type: 'number', min: 1, max: 100, half: true, hint: 'A slice is never shorter than this.' },
      { key: 'procs', label: 'Tasks', type: 'area', rows: 6, hint: 'One per line: name arrive burst [nice]. nice runs from -20 (most important) to 19 (least); the default is 0.' }],
    about: [['vruntime', 'Virtual runtime = real time run x (1024 / weight). A heavy task\'s clock runs slowly, so it stays "behind" and gets picked more often.'], ['Weight', 'Comes from nice: nice 0 = 1024, and each nice step changes it by about 25%.'], ['Time slice', 'slice = target latency x weight / total weight of runnable tasks, but never below the minimum granularity.'], ['Newcomers', 'A new task starts at the current minimum vruntime, so it neither starves nor monopolises the CPU.'], ['Memory hook', 'Smallest vruntime goes next. The kernel keeps tasks in a red-black tree and takes the leftmost one; this lab just picks the minimum.']],
    compute: (s) => PV.withStart(NS.cfs.run({ latency: +s.latency, gran: +s.gran, procs: s.procs })),
    draw: (f, i, sim) => {
      const T = sim.ticksFrames, now = i - 1, cur = f.start ? null : f;
      const rows = sim.procs.map((p, k) => ({ label: p.name, cell: (t) => { const fr = T[t]; if (!fr) return null; if (fr.running === p.name) return { cls: 'run', bg: colorFor(k), text: String(fr.tasks[k].rem), title: p.name + ' runs at tick ' + t + ' (' + fr.tasks[k].rem + ' ticks left before this tick)' }; const st = fr.tasks[k].state; return st === 'ready' ? { cls: 'wait', text: '' } : null; } }));
      let bars = null;
      if (cur) { const max = Math.max(1, ...cur.tasks.map((x) => x.vrAfter), cur.minVr); bars = el('div', { class: 'pv-bars', role: 'img', 'aria-label': 'Virtual runtime of each task' }, cur.tasks.map((x, k) => el('div', { class: 'pv-bar' + (x.name === cur.running ? ' on' : '') }, el('span', null, x.name), el('div', { class: 'track' }, el('div', { class: 'fill', style: { width: (100 * x.vrAfter / max) + '%', background: colorFor(k), opacity: x.state === 'new' || x.state === 'done' ? 0.25 : 1 } }), el('div', { class: 'min', style: { left: Math.min(99.5, 100 * cur.minVr / max) + '%' }, title: 'min_vruntime' })), el('span', null, PV.f1(x.vrAfter))))); }
      return { visual: [PV.timeline({ ticks: T.length, now, rows, aria: 'Timeline: a coloured block means the task runs; the number is how much work it still had to do' }), PV.legend([['', 'solid = running (number = work left)'], ['wait', 'dashed = ready, waiting']]), bars, bars ? el('p', { class: 'hint' }, 'Bars show virtual runtime after this tick; the black marker is min_vruntime.') : null],
        why: cur ? [cur.notes.length ? el('ul', { class: 'fv-steps' }, cur.notes.map((n) => el('li', null, n))) : el('p', { class: 'hint' }, cur.running ? cur.running + ' is inside its slice (' + cur.sliceLeft + ' ticks left after this one).' : 'Idle: no task is runnable.')] : [el('p', { class: 'hint' }, 'Step through and watch which bar is shortest when a new slice starts.')] };
    },
    stats: (f, sim) => {
      const upto = f.start ? [] : sim.ticksFrames.slice(0, f.t + 1), total = upto.filter((x) => x.running).length;
      return [K.table(['Task', 'Nice', 'Weight', 'Fair share', 'CPU so far', 'Finish', 'Turnaround', 'Waiting'], sim.procs.map((p) => { const ran = upto.filter((x) => x.running === p.name).length; return [p.name, p.nice, p.weight, (100 * p.fairShare).toFixed(0) + '%', total ? ran + ' ticks (' + (100 * ran / total).toFixed(0) + '%)' : '0', p.finish, p.turnaround, p.waiting]; })),
        el('p', { class: 'hint' }, 'Fair share assumes every task is runnable the whole time; with different arrival times and lengths the actual share drifts. Honest limits: one CPU, whole ticks, no sleeping tasks, no wake-up preemption, no groups. Real CFS slice rounding differs a little.')];
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
