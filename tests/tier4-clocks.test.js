// Tier 4: message-passing core + Lamport/vector clocks. Clock values below are derived by hand from the rules.
const MP = require('../js/engines/mp.js'); const P = require('../js/engines/mp-clocks.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (cfg, text) => MP.run(P, cfg, text);
const stamps = (r) => r.events.filter((e) => e.ann.V).map((e) => e.label + ' L' + e.ann.L + ' ' + e.ann.V.join(''));

// ---- hand-derived chain A->B->C->D (delay 1): see comments in the lab
const chain = go({ n: 4, dmin: 1, dmax: 1 }, '1 A send B\n3 B send C\n5 C send D\n8 D local');
eq('chain: every stamp', stamps(chain), ['A1 L1 1000', 'B1 L2 1100', 'B2 L3 1200', 'C1 L4 1210', 'C2 L5 1220', 'D1 L6 1221', 'D2 L7 1222']);
eq('chain: nothing is concurrent along the causal chain', chain.report.metrics.find((m) => m[0] === 'Concurrent pairs')[1], 0);
// ---- crossing messages: both sends happen "at the same time"
const cross = go({ n: 2, dmin: 3, dmax: 3 }, '1 A send B\n1 B send A\n5 A local\n5 B local');
eq('crossing sends are concurrent (vectors 10 and 01 are incomparable)', P.relation({ V: [1, 0] }, { V: [0, 1] }), 'concurrent');
eq('crossing: after receiving, A = [2,1] and B = [1,2]', stamps(cross).filter((s) => s.startsWith('A2') || s.startsWith('B2')).sort(), ['A2 L2 21', 'B2 L2 12']);
// ---- Lamport rule: max(own, msg) + 1
const jump = go({ n: 2, dmin: 1, dmax: 1 }, '1 A local\n2 A local\n3 A local\n4 A send B\n9 B local');
eq('Lamport jumps to max+1 on receive (A sent L=4, B had 0 -> 5)', stamps(jump).find((s) => s.startsWith('B1')), 'B1 L5 41');
eq('a later local event on B continues from there', stamps(jump).find((s) => s.startsWith('B2')), 'B2 L6 42');
// ---- concurrency vs Lamport
const conc = go({ n: 2, dmin: 1, dmax: 1 }, '1 A local\n2 A local\n3 A local\n1 B local\n9 B local');
const cm = Object.fromEntries(conc.report.metrics);
eq('no messages: every cross-node pair is concurrent (3 x 2 = 6)', cm['Concurrent pairs'], 6);
eq('Lamport orders concurrent pairs whose numbers differ (A2,A3 vs B1(1)... counted from the run)', cm['Concurrent pairs Lamport still orders'], 4);
const pr = conc.report.pair;
const a3 = pr.events.find((e) => e.text.startsWith('A3')).id, b1 = pr.events.find((e) => e.text.startsWith('B1')).id;
eq('pair compare names concurrency', pr.compare(a3, b1)[0].includes('CONCURRENT'), true);
eq('pair compare shows the false Lamport ordering', pr.compare(a3, b1)[2].includes('false ordering'), true);
// ---- ground truth cross-check on random scenarios
let ok = true, msg = '', seed = 5; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 150 && ok; t++) {
  const n = 2 + rnd(4), lines = []; for (let i = 0; i < 4 + rnd(14); i++) { const a = 'ABCDE'[rnd(n)]; let b = 'ABCDE'[rnd(n)]; if (b === a) b = 'ABCDE'[(('ABCDE'.indexOf(a)) + 1) % n]; lines.push((1 + rnd(30)) + ' ' + a + (rnd(3) ? ' send ' + b : ' local')); }
  const r = go({ n, dmin: 1, dmax: 1 + rnd(5), seed: rnd(1000) }, lines.join('\n'));
  if (!r.ok) { ok = false; msg = 'run failed ' + r.errors; break; }
  r.report.checks.forEach((c) => { if (!c.ok) { ok = false; msg = c.text; } });
  const ev = r.events.filter((e) => e.ann.V);
  ev.forEach((e) => { if (e.ann.V[e.node] < 1) { ok = false; msg = 'own slot must be >= 1'; } });
  r.frames.forEach((f, i) => { if (i && f.t < r.frames[i - 1].t) { ok = false; msg = 'time went backwards'; } });
}
eq('150 random scenarios: vectors match graph truth, Lamport never contradicts causality ' + msg, ok, true);
// ---- core: determinism, loss, crash, parsing
const a = go({ n: 3, dmin: 1, dmax: 6, seed: 4 }, '1 A send B\n2 B send C\n3 C send A'), b = go({ n: 3, dmin: 1, dmax: 6, seed: 4 }, '1 A send B\n2 B send C\n3 C send A'), c = go({ n: 3, dmin: 1, dmax: 6, seed: 5 }, '1 A send B\n2 B send C\n3 C send A');
eq('same seed, same delays', a.msgs.map((m) => m.delay), b.msgs.map((m) => m.delay));
eq('different seed changes the delays (seeds 4 and 5 give [6,2,2] and [5,5,2])', [a.msgs.map((m) => m.delay), c.msgs.map((m) => m.delay)], [[6, 2, 2], [5, 5, 2]]);
const down = go({ n: 2, dmin: 1, dmax: 1 }, '1 B crash\n2 A send B\n5 B recover\n6 A send B');
eq('a message to a crashed node is dropped', down.msgs.map((m) => m.status), ['dropped', 'delivered']);
eq('a crashed node ignores scenario steps', go({ n: 2 }, '1 B crash\n2 B local').frames[2].text.includes('ignored'), true);
eq('explicit delay overrides the random one', go({ n: 2, dmin: 1, dmax: 1 }, '1 A send B 7').msgs[0].delay, 7);
eq('in-flight messages are tracked between frames', go({ n: 2, dmin: 3, dmax: 3 }, '1 A send B').frames[1].inflight.length, 1);
eq('and gone after delivery', go({ n: 2, dmin: 3, dmax: 3 }, '1 A send B').frames[2].inflight.length, 0);
const lossy = go({ n: 2, dmin: 1, dmax: 1, loss: 60, seed: 2 }, Array.from({ length: 40 }, (_, i) => (i + 1) + ' A send B').join('\n'));
eq('loss: some messages are lost, some delivered', [lossy.msgs.some((m) => m.status === 'lost'), lossy.msgs.some((m) => m.status === 'delivered')], [true, true]);
// ---- parsing errors
const bad = (t, cfg) => go(cfg || { n: 3 }, t);
eq('parse: empty scenario rejected', bad('   ').ok, false);
eq('parse: time must be a number', bad('x A local').errors[0].startsWith('Line 1'), true);
eq('parse: unknown node', bad('1 Z local').errors[0].includes('not a node'), true);
eq('parse: unknown step', bad('1 A dance').errors[0].includes('unknown step'), true);
eq('parse: send needs a target', bad('1 A send').errors[0].includes('needs a node'), true);
eq('parse: cannot send to self', bad('1 A send A').errors[0].includes('itself'), true);
eq('parse: extra words rejected', bad('1 A local now').errors[0].includes('unexpected'), true);
eq('parse: comments and blank lines allowed', bad('# hi\n\n1 A local # ok').ok, true);
eq('parse: node outside the chosen n rejected', bad('1 D local', { n: 3 }).ok, false);
eq('cfg: n out of range rejected', go({ n: 9 }, '1 A local').ok, false);
eq('cfg: dmin > dmax rejected', go({ n: 2, dmin: 5, dmax: 2 }, '1 A local').ok, false);
const lim = go({ n: 2, dmin: 30, dmax: 30, maxT: 10 }, '1 A send B\n2 B send A');
eq('cfg: time limit hit is flagged as truncated, with a failing check', [lim.truncated, lim.report.checks.some((c) => !c.ok)], [true, true]);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
