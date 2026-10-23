/* Tier 2A: working-set model and thrashing. WS(t) = distinct pages a process touched in its last D references.
   If the sum of all working sets exceeds the frames, the system cannot keep them all resident: thrashing. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxProcs: 5, maxLen: 60 };

  function run(cfg, text) {
    const errors = [], delta = +cfg.delta, total = +cfg.frames, procs = [];
    if (!Number.isInteger(delta) || delta < 1 || delta > 20) errors.push('Window must be 1 to 20 references.');
    if (!Number.isInteger(total) || total < 1 || total > 256) errors.push('Frames must be 1 to 256.');
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const m = /^(\S+?):\s*(.+)$/.exec(line);
      if (!m) { errors.push('Line ' + (i + 1) + ': write "name: page page page ...".'); return; }
      const refs = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
      if (!refs.length || refs.some((p) => !Number.isInteger(p) || p < 0)) errors.push('Line ' + (i + 1) + ': pages must be whole numbers, 0 or more.');
      else if (refs.length > LIMITS.maxLen) errors.push('Line ' + (i + 1) + ': at most ' + LIMITS.maxLen + ' references.');
      else procs.push({ name: m[1], refs });
    });
    if (procs.length > LIMITS.maxProcs) errors.push('At most ' + LIMITS.maxProcs + ' processes.');
    if (!procs.length && !errors.length) errors.push('Enter at least one process.');
    if (errors.length) return { ok: false, errors };

    const T = Math.max(...procs.map((p) => p.refs.length)), faults = procs.map(() => 0), frames = [];
    frames.push({ t: 0, text: 'Time 0: nothing referenced yet. Window = last ' + delta + ' references, ' + total + ' frames.', per: procs.map((p) => ({ name: p.name, page: null, ws: [], size: 0, fault: false })), demand: 0, thrash: false });
    let firstThrash = null, peak = 0;
    for (let t = 1; t <= T; t++) {
      const per = procs.map((p, k) => {
        if (t > p.refs.length) return { name: p.name, page: null, ws: [], size: 0, fault: false, done: true };
        const win = p.refs.slice(Math.max(0, t - delta), t), ws = [...new Set(win)].sort((a, b) => a - b);
        const before = new Set(p.refs.slice(Math.max(0, t - 1 - delta), t - 1));   // pages resident just before this reference
        const fault = !before.has(p.refs[t - 1]); if (fault) faults[k]++;
        return { name: p.name, page: p.refs[t - 1], ws, size: ws.length, fault };
      });
      const demand = per.reduce((a, x) => a + x.size, 0), thrash = demand > total; peak = Math.max(peak, demand); if (thrash && firstThrash === null) firstThrash = t;
      const big = per.reduce((a, x) => (x.size > a.size ? x : a), { size: -1 });
      frames.push({ t, per, demand, thrash, text: 'Time ' + t + ': ' + per.filter((x) => !x.done).map((x) => x.name + ' touches page ' + x.page + (x.fault ? ' (fault)' : '') + ', WS = {' + x.ws.join(', ') + '}').join('; ') + '. Total demand ' + demand + ' vs ' + total + ' frames' + (thrash ? ': demand is higher than memory, so thrashing. Suspend a process (' + big.name + ' has the largest working set, ' + big.size + ') to free its frames.' : ': fits.') });
    }
    return { ok: true, cfg: { delta, frames: total }, procs, frames, stats: { faults, firstThrash, peak, thrashSteps: frames.filter((f) => f.thrash).length, steps: T } };
  }

  const PRESETS = [
    { id: 'fits', name: 'Fits in memory', note: 'Two well-behaved processes: demand stays within the frames.', cfg: { delta: 4, frames: 8 }, text: 'A: 1 2 1 2 3 1 2 1 2 3\nB: 7 8 7 8 7 9 7 8 7 8' },
    { id: 'thrash', name: 'Thrashing', note: 'B starts scanning many pages: total demand passes the 6 frames, so the OS should suspend one process.', cfg: { delta: 4, frames: 6 }, text: 'A: 1 2 1 2 1 2 1 2 1 2\nB: 7 8 9 10 11 12 13 14 15 16' },
    { id: 'phase', name: 'Phase change', note: 'One process moves to a new locality: working set grows during the change, then settles.', cfg: { delta: 3, frames: 4 }, text: 'A: 1 2 1 2 1 2 5 6 7 5 6 7 5 6 7' }
  ];
  NS.workingset = { LIMITS, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.workingset;
})(typeof window !== 'undefined' ? window : globalThis);
