// Tier 5: access matrix, cgroup shares, NUMA helpers. Expected values worked out by hand.
const C = require('../js/engines/concepts.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const near = (n, got, want) => eq(n, Math.abs(got - want) < 1e-6, true) || (Math.abs(got - want) < 1e-6 || console.log('   got ' + got + ' want ' + want));

// ---- access matrix
const p = C.parseMatrix('alice report rw\nbob report r\nalice log x\nbob log -\nalice report x # merged, sorted rwx');
eq('parse ok', p.ok, true);
eq('subjects in first-seen order', p.matrix.subjects, ['alice', 'bob']);
eq('objects in first-seen order', p.matrix.objects, ['report', 'log']);
eq('rights merged and ordered r,w,x', C.rightsOf(p.matrix, 'alice', 'report'), 'rwx');
eq('dash means none', C.rightsOf(p.matrix, 'bob', 'log'), '');
eq('missing cell is none', C.rightsOf(p.matrix, 'bob', 'nothing'), '');
eq('ACL of report lists both users', C.aclOf(p.matrix)[0], { object: 'report', entries: [{ subject: 'alice', rights: 'rwx' }, { subject: 'bob', rights: 'r' }] });
eq('ACL of log lists only alice', C.aclOf(p.matrix)[1].entries, [{ subject: 'alice', rights: 'x' }]);
eq('capabilities of bob: just report r', C.capsOf(p.matrix)[1].caps, [{ object: 'report', rights: 'r' }]);
eq('check allowed', C.check(p.matrix, 'bob', 'report', 'r'), true);
eq('check denied', C.check(p.matrix, 'bob', 'report', 'w'), false);
eq('ACL and capability views agree on every cell', p.matrix.subjects.every((s) => p.matrix.objects.every((o) => ['r', 'w', 'x'].every((r) => C.check(p.matrix, s, o, r) === (C.aclOf(p.matrix).find((a) => a.object === o).entries.some((e) => e.subject === s && e.rights.includes(r))) && C.check(p.matrix, s, o, r) === (C.capsOf(p.matrix).find((c) => c.subject === s).caps.some((c) => c.object === o && c.rights.includes(r)))))), true);
eq('revoke cost on report: 1 ACL edit, scan all 2 subjects for capabilities', C.revokeCost(p.matrix, 'report'), { aclEdits: 1, capSearches: 2, holders: ['alice', 'bob'] });
eq('bad rights rejected', C.parseMatrix('a b rz').ok, false);
eq('bad field count rejected', C.parseMatrix('a').ok, false);
eq('empty rejected', C.parseMatrix('').ok, false);
eq('too many subjects rejected', C.parseMatrix('a o r\nb o r\nc o r\nd o r\ne o r\nf o r\ng o r').ok, false);

// ---- cgroup cpu shares (capacity 4 cores)
let g = C.cpuShares([{ name: 'A', weight: 1024, demand: 4 }, { name: 'B', weight: 512, demand: 4 }], 4);
near('weights 2:1 split 4 cores into 2.667', g[0].got, 8 / 3); near('and 1.333', g[1].got, 4 / 3);
g = C.cpuShares([{ name: 'A', weight: 1024, demand: 4 }, { name: 'B', weight: 512, demand: 0.5 }], 4);
near('small demand is satisfied fully (0.5)', g[1].got, 0.5); near('and the rest goes to the other (3.5)', g[0].got, 3.5);
g = C.cpuShares([{ name: 'A', weight: 2, demand: 1 }, { name: 'B', weight: 1, demand: 4 }, { name: 'C', weight: 1, demand: 4 }], 4);
eq('three groups, redistribution', g.map((x) => +x.got.toFixed(6)), [1, 1.5, 1.5]);
g = C.cpuShares([{ name: 'A', weight: 1, demand: 1 }, { name: 'B', weight: 1, demand: 1 }], 4);
eq('spare capacity: everyone gets only what they want', g.map((x) => x.got), [1, 1]);
g = C.cpuShares([{ name: 'A', weight: 1, demand: 3 }], 0);
eq('zero capacity gives nothing', g[0].got, 0);
for (let t = 0; t < 300; t++) { // random: never above demand, never above capacity, work-conserving
  const n = 1 + Math.floor(Math.random() * 5), cap = 1 + Math.floor(Math.random() * 8);
  const gs = Array.from({ length: n }, (_, i) => ({ name: 'g' + i, weight: 1 + Math.floor(Math.random() * 1000), demand: Math.random() * 6 }));
  const r = C.cpuShares(gs, cap), sum = r.reduce((a, x) => a + x.got, 0), want = Math.min(cap, gs.reduce((a, x) => a + x.demand, 0));
  if (r.some((x) => x.got > x.demand + 1e-9) || Math.abs(sum - want) > 1e-6) { fail++; console.log('FAIL random cpu shares', JSON.stringify(gs), cap); } else pass++;
}
eq('memory over limit means OOM kill in the group', C.memCheck(512, 600), { over: true, oomKill: true, headroom: -88 });
eq('memory at limit is fine', C.memCheck(512, 512).oomKill, false);

// ---- NUMA
const cfg = { nodes: 2, local: 80, remote: 140 };
near('75% local, 25% remote = 95', C.numaAvg(cfg, { node: 0, pages: [6, 2] }), 95);
near('all local = local latency', C.numaAvg(cfg, { node: 1, pages: [0, 9] }), 80);
near('all remote = remote latency', C.numaAvg(cfg, { node: 0, pages: [0, 9] }), 140);
eq('no pages = 0, not NaN', C.numaAvg(cfg, { node: 0, pages: [0, 0] }), 0);
const th = [{ name: 'T1', node: 0, pages: [0, 10] }, { name: 'T2', node: 0, pages: [0, 10] }, { name: 'T3', node: 1, pages: [10, 0] }, { name: 'T4', node: 1, pages: [10, 0] }];
const rep = C.numaReport(cfg, th);
eq('worst case mean latency 140', rep.mean, 140); eq('load 2 and 2', rep.load, [2, 2]);
const bal = C.numaBalance(cfg, th);
eq('balancer swaps everyone to their pages', bal.map((t) => t.node), [1, 1, 0, 0]);
eq('mean after balancing 80', C.numaReport(cfg, bal).mean, 80);
eq('original threads not modified', th.map((t) => t.node), [0, 0, 1, 1]);
const cr = C.numaBalance(cfg, [{ name: 'a', node: 0, pages: [0, 9] }, { name: 'b', node: 0, pages: [0, 9] }, { name: 'c', node: 0, pages: [0, 9] }, { name: 'd', node: 0, pages: [0, 9] }]);
eq('load limit: everyone wants node 1 but only 2 fit', cr.map((t) => t.node).sort(), [0, 0, 1, 1]);
for (let t = 0; t < 300; t++) { // random: balancer respects the load cap and never makes the total worse
  const nodes = 2 + Math.floor(Math.random() * 3), n = 1 + Math.floor(Math.random() * 8), c = { nodes, local: 80, remote: 140 };
  const ths = Array.from({ length: n }, (_, i) => ({ name: 't' + i, node: Math.floor(Math.random() * nodes), pages: Array.from({ length: nodes }, () => Math.floor(Math.random() * 10)) }));
  const b = C.numaBalance(c, ths), load = Array(nodes).fill(0); b.forEach((x) => load[x.node]++);
  if (Math.max(...load) > Math.ceil(n / nodes)) { fail++; console.log('FAIL cap exceeded', JSON.stringify(ths)); } else pass++;
}
const np = C.parseNuma('a 0 5 5\nb 1 0 9', 2);
eq('parse numa ok', np.ok && np.threads.length, 2);
eq('wrong field count rejected', C.parseNuma('a 0 5', 2).ok, false);
eq('node out of range rejected', C.parseNuma('a 5 1 1', 2).ok, false);
eq('negative pages rejected', C.parseNuma('a 0 -1 1', 2).ok, false);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
