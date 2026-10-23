// Tier 4: leader election (bully and ring). Message counts and timings derived by hand.
const MP = require('../js/engines/mp.js'); const P = require('../js/engines/mp-election.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (cfg, text) => MP.run(P, cfg, text);
const metric = (r, k) => (r.report.metrics.find((m) => m[0] === k) || [])[1];
const beliefs = (r) => r.report.tables[0].rows.map((x) => x[2]);
const B = { algo: 'bully', n: 4, dmin: 1, dmax: 1, timeout: 4 }, R = { algo: 'ring', n: 4, dmin: 1, dmax: 1 };

// ---- bully by hand (n=4, delay 1, timeout 4): D crashes, B notices at t=2
// t2 B -> ELECTION to C and D. t3 C gets it: OK to B, starts own election (ELECTION to D); D drops both.
// t4 B gets OK (gives up). t7 C's timer fires with no OK: C wins, COORDINATOR to A, B, D(dropped). t8 A and B accept.
const b = go(B, '1 D crash\n2 B start');
eq('bully: final beliefs A,B,C -> C; D is down', beliefs(b), ['C', 'C', 'C', 'D']);
eq('bully: 3 ELECTION + 1 OK + 3 COORDINATOR = 7 messages', [metric(b, 'ELECTION messages'), metric(b, 'OK messages'), metric(b, 'COORDINATOR messages'), metric(b, 'Messages sent')], [3, 1, 3, 7]);
eq('bully: two elections ran (B started, C was bullied into one)', metric(b, 'Elections started'), 2);
eq('bully: messages to the dead node are dropped (3 of them)', b.msgs.filter((m) => m.status === 'dropped').length, 3);
eq('bully: C announces at t=7', b.events.find((e) => e.tag === 'LEADER').t, 7);
eq('bully: both checks pass', b.report.checks.map((c) => c.ok), [true, true]);
// the top node needs no election messages
const top = go(B, '1 D start');
eq('bully: the highest node starting just announces (3 COORDINATOR, no ELECTION)', [metric(top, 'ELECTION messages') || 0, metric(top, 'COORDINATOR messages')], [0, 3]);
// recovering old leader takes over
const back = go(B, '1 D crash\n2 B start\n20 D recover');
eq('bully: recovered D takes leadership back', beliefs(back), ['D', 'D', 'D', 'D']);
// storm
const storm = go({ algo: 'bully', n: 5, dmin: 1, dmax: 2, timeout: 6, seed: 3 }, '1 E crash\n3 A start\n3 B start\n3 C start');
eq('bully: simultaneous starts still agree on D', beliefs(storm), ['D', 'D', 'D', 'D', 'E']);
eq('bully: more starters cost more messages than a single starter', metric(storm, 'Messages sent') > metric(go({ algo: 'bully', n: 5, dmin: 1, dmax: 2, timeout: 6, seed: 3 }, '1 E crash\n3 C start'), 'Messages sent'), true);
// ---- ring by hand (n=4, delay 1): D crashes, A starts at t=2. ELECTION: A>B>C>A>B>C (5), COORDINATOR: C>A>B (2)
const r = go(R, '1 D crash\n2 A start');
eq('ring: final beliefs', beliefs(r), ['C', 'C', 'C', 'D']);
eq('ring: 5 ELECTION + 2 COORDINATOR = 7 messages', [metric(r, 'ELECTION messages'), metric(r, 'COORDINATOR messages')], [5, 2]);
eq('ring: the id carried grows as it passes bigger nodes', r.msgs.filter((m) => m.type === 'ELECTION').map((m) => m.payload.id), [0, 1, 2, 2, 2]);
const rtop = go(R, '1 D crash\n2 C start');
eq('ring: starting at the biggest live node needs one lap (3 ELECTION) plus the announcement (2)', [metric(rtop, 'ELECTION messages'), metric(rtop, 'COORDINATOR messages')], [3, 2]);
const rtwo = go({ algo: 'ring', n: 5, dmin: 1, dmax: 2, seed: 2 }, '1 E crash\n3 A start\n3 C start');
eq('ring: two starters, one winner (D)', beliefs(rtwo), ['D', 'D', 'D', 'D', 'E']);
// ---- validation
eq('bully timeout shorter than a round trip is rejected', go({ algo: 'bully', n: 4, dmin: 1, dmax: 4, timeout: 5 }, '1 A start').ok, false);
eq('the same timeout is fine for the ring (not used)', go({ algo: 'ring', n: 4, dmin: 1, dmax: 4, timeout: 5 }, '1 A start').ok, true);
eq('n below 3 rejected', go({ algo: 'bully', n: 2 }, '1 A start').ok, false);
eq('a node already in an election ignores a second start', go(B, '1 D crash\n2 B start\n2 B start').frames.some((f) => f.text.includes('Already running')), true);

// ---- random: agree on the highest live node (crashes happen first, then starts and recoveries)
let ok = true, msg = '', seed = 9; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 300 && ok; t++) {
  const n = 3 + rnd(4), algo = rnd(2) ? 'bully' : 'ring', dmax = 1 + rnd(4), lines = [], dead = new Set();
  for (let i = 0; i < rnd(n); i++) { const d = rnd(n); dead.add(d); lines.push('1 ' + 'ABCDEF'[d] + ' crash'); }
  if (dead.size === n) { dead.delete(0); lines.pop(); }
  const alive = [...Array(n).keys()].filter((i) => !dead.has(i)); if (!alive.length) continue;
  for (let i = 0; i < 1 + rnd(3); i++) lines.push((5 + rnd(10)) + ' ' + 'ABCDEF'[alive[rnd(alive.length)]] + ' start');
  const res = go({ algo, n, dmin: 1, dmax, timeout: 2 * dmax + rnd(5), seed: rnd(9999) }, lines.join('\n'));
  if (!res.ok) { ok = false; msg = 'run failed ' + res.errors; break; }
  if (!res.report.checks.every((c) => c.ok)) { ok = false; msg = algo + ' failed ' + JSON.stringify(lines) + JSON.stringify(res.cfg) + JSON.stringify(res.report.checks); }
}
eq('300 random scenarios: all live nodes agree on the highest live id ' + msg, ok, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
