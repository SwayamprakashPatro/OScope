/* Tier 5 concept helpers (pure, no DOM): the small calculations behind the four concept cards.
   - access matrix -> ACL view and capability view, plus an access check
   - cgroup CPU shares (weighted fair split) and memory limit (OOM check)
   - NUMA: average access latency per thread, and a simple page/thread rebalancing suggestion */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const RIGHTS = ['r', 'w', 'x'];
  const L = { maxSubjects: 6, maxObjects: 6, maxNodes: 4, maxThreads: 8 };

  // Matrix: { subjects:[names], objects:[names], cell: { 'subject|object': 'rw' } }.
  // Parse text lines like "alice file1 rw" into a matrix. Names are taken from the input, nothing is preset.
  function parseMatrix(text) {
    const errors = [], subjects = [], objects = [], cell = {};
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/);
      if (t.length < 2 || t.length > 3) { errors.push('Line ' + (i + 1) + ': write "subject object rights", for example "alice report rw" (rights may be left out for none).'); return; }
      const [s, o, r = ''] = t;
      if (!/^[rwx-]*$/.test(r)) { errors.push('Line ' + (i + 1) + ': rights may only use r, w, x (or -), got "' + r + '".'); return; }
      if (!subjects.includes(s)) subjects.push(s);
      if (!objects.includes(o)) objects.push(o);
      const have = new Set((cell[s + '|' + o] || '').split(''));
      r.split('').forEach((c) => { if (c !== '-') have.add(c); });
      cell[s + '|' + o] = RIGHTS.filter((c) => have.has(c)).join('');
    });
    if (subjects.length > L.maxSubjects) errors.push('At most ' + L.maxSubjects + ' subjects.');
    if (objects.length > L.maxObjects) errors.push('At most ' + L.maxObjects + ' objects.');
    if (!subjects.length && !errors.length) errors.push('Enter at least one line.');
    return { ok: !errors.length, errors, matrix: { subjects, objects, cell } };
  }
  const rightsOf = (m, s, o) => m.cell[s + '|' + o] || '';
  // ACL = one column of the matrix: for each object, who may do what.
  function aclOf(m) { return m.objects.map((o) => ({ object: o, entries: m.subjects.map((s) => ({ subject: s, rights: rightsOf(m, s, o) })).filter((e) => e.rights) })); }
  // Capability list = one row of the matrix: for each subject, what it holds.
  function capsOf(m) { return m.subjects.map((s) => ({ subject: s, caps: m.objects.map((o) => ({ object: o, rights: rightsOf(m, s, o) })).filter((e) => e.rights) })); }
  function check(m, s, o, r) { return rightsOf(m, s, o).includes(r); }
  // Revoking is the classic difference: ACL = edit one object's list; capabilities = must find every holder.
  function revokeCost(m, o) {
    const holders = m.subjects.filter((s) => rightsOf(m, s, o));
    return { aclEdits: holders.length ? 1 : 0, capSearches: m.subjects.length, holders };
  }

  // cgroup CPU: weighted max-min fair share. demands in cores wanted; capacity in cores.
  // Repeatedly split what is left by weight among groups that still want more.
  function cpuShares(groups, capacity) {
    const out = groups.map((g) => ({ name: g.name, weight: g.weight, demand: g.demand, got: 0 }));
    let left = capacity, active = out.filter((g) => g.demand > 0 && g.weight > 0);
    while (left > 1e-9 && active.length) {
      const W = active.reduce((a, g) => a + g.weight, 0); let used = 0, done = [];
      active.forEach((g) => { const give = Math.min(left * g.weight / W, g.demand - g.got); g.got += give; used += give; if (g.demand - g.got < 1e-9) done.push(g); });
      left -= used; if (!done.length) break; active = active.filter((g) => !done.includes(g));
    }
    return out;
  }
  // cgroup memory: a group whose use goes over its limit gets an OOM kill inside the group only.
  function memCheck(limit, use) { return { over: use > limit, oomKill: use > limit, headroom: limit - use }; }

  // NUMA: nodes with local and remote latency. A thread runs on a node and touches pages spread over nodes
  // (fractions that sum to 1). Average latency = local share * local + remote share * remote.
  function numaAvg(cfg, th) {
    const tot = th.pages.reduce((a, b) => a + b, 0); if (!tot) return 0;
    return th.pages.reduce((a, p, n) => a + (p / tot) * (n === th.node ? cfg.local : cfg.remote), 0);
  }
  function numaReport(cfg, threads) {
    const per = threads.map((t) => ({ name: t.name, node: t.node, avg: numaAvg(cfg, t), remoteShare: 1 - (t.pages[t.node] || 0) / (t.pages.reduce((a, b) => a + b, 0) || 1) }));
    const load = Array.from({ length: cfg.nodes }, (_, n) => threads.filter((t) => t.node === n).length);
    return { per, load, mean: per.length ? per.reduce((a, p) => a + p.avg, 0) / per.length : 0, spread: Math.max(...load) - Math.min(...load) };
  }
  // Suggest moves: send each thread to the node holding most of its pages, but never let a node hold more than
  // ceil(threads/nodes) threads (the load-balance limit). Threads with the most to gain choose first.
  function numaBalance(cfg, threads) {
    const cap = Math.ceil(threads.length / cfg.nodes), load = Array(cfg.nodes).fill(0), out = threads.map((t) => Object.assign({}, t));
    const order = out.map((t, i) => i).sort((a, b) => numaAvg(cfg, out[b]) - numaAvg(cfg, out[a]));
    order.forEach((i) => {
      const t = out[i], pref = t.pages.map((p, n) => [p, n]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      const pick = pref.find(([, n]) => load[n] < cap); t.node = pick ? pick[1] : load.indexOf(Math.min(...load)); load[t.node]++;
    });
    return out;
  }
  function parseNuma(text, nodes) {
    const errors = [], threads = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/);
      if (t.length !== 2 + nodes) { errors.push('Line ' + (i + 1) + ': write "name node pages-on-node0 ... pages-on-node' + (nodes - 1) + '" (' + (2 + nodes) + ' fields).'); return; }
      const node = +t[1], pages = t.slice(2).map(Number);
      if (!Number.isInteger(node) || node < 0 || node >= nodes) { errors.push('Line ' + (i + 1) + ': node must be 0 to ' + (nodes - 1) + '.'); return; }
      if (pages.some((p) => !Number.isFinite(p) || p < 0)) { errors.push('Line ' + (i + 1) + ': page counts must be numbers, 0 or more.'); return; }
      threads.push({ name: t[0], node, pages });
    });
    if (threads.length > L.maxThreads) errors.push('At most ' + L.maxThreads + ' threads.');
    if (!threads.length && !errors.length) errors.push('Enter at least one thread.');
    return { ok: !errors.length, errors, threads };
  }

  NS.concepts = { L, parseMatrix, rightsOf, aclOf, capsOf, check, revokeCost, cpuShares, memCheck, numaAvg, numaReport, numaBalance, parseNuma };
  if (typeof module !== 'undefined') module.exports = NS.concepts;
})(typeof window !== 'undefined' ? window : globalThis);
