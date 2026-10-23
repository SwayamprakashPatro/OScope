/* Tier 2A: frame allocation. Splits physical frames among processes (equal, proportional to size, or by priority),
   then replays each process's references with local LRU in its share to show the fault cost of the split. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxProcs: 8, maxRefs: 80 };
  const POLICIES = [{ id: 'equal', name: 'Equal' }, { id: 'proportional', name: 'Proportional to size' }, { id: 'priority', name: 'By priority' }];

  // Largest-remainder split: floor each share, then hand the leftover frames to the biggest fractional parts.
  function split(m, w) {
    const W = w.reduce((a, b) => a + b, 0), exact = w.map((x) => (m * x) / W), a = exact.map(Math.floor);
    let left = m - a.reduce((x, y) => x + y, 0);
    exact.map((e, i) => [e - Math.floor(e), i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]).forEach(([, i]) => { if (left > 0) { a[i]++; left--; } });
    return a;
  }
  function lruFaults(refs, n) {
    if (n <= 0) return refs.length;
    const cache = []; let f = 0;
    refs.forEach((p) => { const at = cache.indexOf(p); if (at >= 0) cache.splice(at, 1); else { f++; if (cache.length >= n) cache.shift(); } cache.push(p); });
    return f;
  }
  function allocate(policy, m, procs, min) {
    const w = procs.map((p) => (policy === 'equal' ? 1 : policy === 'proportional' ? p.size : p.prio));
    const a = split(m, w);
    for (let i = 0; i < a.length; i++) while (a[i] < min) { let j = -1; a.forEach((v, k) => { if (v > min && (j < 0 || v > a[j])) j = k; }); if (j < 0) break; a[j]--; a[i]++; }
    return a;
  }

  function run(cfg, text) {
    const errors = [], m = +cfg.frames, min = +cfg.min, procs = [];
    if (!Number.isInteger(m) || m < 2 || m > 4096) errors.push('Frames must be 2 to 4096.');
    if (!Number.isInteger(min) || min < 1 || min > 16) errors.push('Minimum frames per process must be 1 to 16.');
    if (!POLICIES.some((p) => p.id === cfg.policy)) errors.push('Choose a policy.');
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const [head, tail] = line.split(':'), t = head.trim().split(/\s+/), size = +t[1], prio = t[2] === undefined ? 1 : +t[2];
      const refs = tail === undefined ? [] : tail.split(/[\s,]+/).filter(Boolean).map(Number);
      if (t.length < 2 || t.length > 3 || !(size >= 1) || !(prio >= 1) || refs.some((p) => !Number.isInteger(p) || p < 0)) errors.push('Line ' + (i + 1) + ': write "name size [priority] [: page references]".');
      else if (refs.length > LIMITS.maxRefs) errors.push('Line ' + (i + 1) + ': at most ' + LIMITS.maxRefs + ' references.');
      else procs.push({ name: t[0], size, prio, refs });
    });
    if (procs.length > LIMITS.maxProcs) errors.push('At most ' + LIMITS.maxProcs + ' processes.');
    if (!procs.length && !errors.length) errors.push('Enter at least one process.');
    if (!errors.length && m < procs.length * min) errors.push('Not enough frames: ' + procs.length + ' processes need at least ' + procs.length * min + '.');
    if (errors.length) return { ok: false, errors };
    const evalPolicy = (policy) => {
      const a = allocate(policy, m, procs, min);
      return procs.map((p, i) => { const use = Math.min(a[i], p.size); return { name: p.name, size: p.size, prio: p.prio, alloc: use, spare: a[i] - use, refs: p.refs.length, faults: p.refs.length ? lruFaults(p.refs, use) : null }; });
    };
    const compare = POLICIES.map((p) => { const rows = evalPolicy(p.id); return { id: p.id, name: p.name, spare: rows.reduce((a, r) => a + r.spare, 0), faults: rows.reduce((a, r) => a + (r.faults || 0), 0) }; });
    return { ok: true, cfg: { frames: m, min, policy: cfg.policy }, rows: evalPolicy(cfg.policy), compare, hasRefs: procs.some((p) => p.refs.length) };
  }

  const PRESETS = [
    { id: 'book', name: 'Textbook: 62 frames', note: 'Sizes 10 and 127: proportional gives 5 and 57; equal wastes frames on the small process.', cfg: { frames: 62, min: 2, policy: 'proportional' }, text: 'small 10\nlarge 127' },
    { id: 'faults', name: 'Cost of the split', note: 'The busy process needs 4 frames. Equal gives it 3 and it faults a lot; proportional gives it enough.', cfg: { frames: 8, min: 2, policy: 'equal' }, text: 'busy 20 : 1 2 3 4 1 2 3 4 1 2 3 4 1 2 3 4\nidle 4 : 9 9 9 9 9 9 9 9' },
    { id: 'prio', name: 'Priorities', note: 'A priority-3 process gets three times the weight of a priority-1 one.', cfg: { frames: 8, min: 1, policy: 'priority' }, text: 'rt 30 3\nbg 30 1' }
  ];
  NS.frames = { LIMITS, POLICIES, split, lruFaults, allocate, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.frames;
})(typeof window !== 'undefined' ? window : globalThis);
