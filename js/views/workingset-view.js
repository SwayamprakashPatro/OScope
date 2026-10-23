/* Working set view: each process's reference string with the current window marked, the working-set size over time,
   and total demand against the available frames (thrashing when demand is higher). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, P = NS.workingset.PRESETS[1];
  K.reg('workingset', {
    key: 'workingset', title: 'Working set & thrashing', visualTitle: 'Locality in the last D references', label: 'Time', statsTitle: 'Memory pressure',
    intro: 'A process runs well when the pages it is actively using (its working set) fit in memory. If the working sets of all running processes add up to more than the frames, every process keeps faulting: thrashing.',
    defaults: Object.assign({}, P.cfg, { text: P.text }),
    presets: NS.workingset.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'delta', label: 'Window D (references)', type: 'number', min: 1, max: 20, half: true }, { key: 'frames', label: 'Physical frames', type: 'number', min: 1, max: 256, half: true },
      { key: 'text', label: 'Processes: name: page page page ...', type: 'area', rows: 6, hint: 'Each process line is its page reference string. Time moves one reference per step for all processes together.' }],
    about: [['Working set', 'WS(t, D) = the distinct pages referenced in the last D references. It is a measurable version of "what the process is using right now".'], ['Rule', 'Keep a process running only if its whole working set fits. If total demand is above the frames, suspend a process and give its frames to the others.'], ['Thrashing', 'When memory is too small for the working sets, processes fault constantly, the CPU waits for the disk, the OS sees low CPU use and starts more processes, which makes it worse.'], ['Memory hook', 'Too many people at a desk that fits four: everyone spends the day swapping papers.']],
    compute: (s) => NS.workingset.run({ delta: +s.delta, frames: +s.frames }, s.text),
    draw: (f, i, sim) => {
      const D = sim.cfg.delta, rows = sim.procs.map((p, k) => el('div', null, el('b', { class: 'pill', style: { background: colorFor(k), color: NS.util.textOn(colorFor(k)) } }, p.name), ' ', el('span', { class: 'muted' }, i ? 'WS = {' + f.per[k].ws.join(', ') + '}, size ' + f.per[k].size : ''),
        el('div', { class: 'mv-strip' }, p.refs.map((pg, t) => { const n = t + 1; return el('div', { class: 'mv-ref' + (i && n <= i && n > i - D ? ' win' : '') + (n === i ? ' now' : '') + (n > i ? ' future' : '') + (n <= i && f.per[k] && false ? '' : '') }, String(pg)); }))));
      const total = Math.max(sim.cfg.frames, f.demand, 1), seg = f.per.map((x, k) => el('i', { style: { width: (100 * x.size / total) + '%', background: colorFor(k) }, title: x.name + ': ' + x.size }));
      const bar = el('div', { class: 'mv-demand' + (f.thrash ? ' over' : ''), role: 'img', 'aria-label': 'Demand versus frames' }, seg, el('div', { class: 'mv-cap', style: { left: 'calc(' + (100 * sim.cfg.frames / total) + '% - 1px)' } }));
      return { visual: [rows, el('p', null, el('b', null, 'Total demand ' + f.demand + ' vs ' + sim.cfg.frames + ' frames'), f.thrash ? el('span', { class: 'mv-bad' }, '  thrashing') : el('span', { class: 'mv-ok' }, i ? '  fits' : '')), bar, el('div', { class: 'mv-scale' }, el('span', null, '0'), el('span', null, 'black line = frames available'), el('span', null, String(total)))], why: el('p', null, f.text) };
    },
    stats: (f, sim) => [K.metrics([['Window', sim.cfg.delta], ['Peak demand', sim.stats.peak], ['Frames', sim.cfg.frames], ['Steps over capacity', sim.stats.thrashSteps + ' / ' + sim.stats.steps], ['First thrashing time', sim.stats.firstThrash === null ? 'never' : sim.stats.firstThrash]]),
      K.table(['Process', 'Faults under the working-set rule'], sim.procs.map((p, k) => [p.name, sim.stats.faults[k]])), el('p', { class: 'hint' }, 'A reference faults if its page was not among the pages touched in the previous D references. Honest limit: this models the working-set rule, not a particular OS, and treats the processes as running in lockstep.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
