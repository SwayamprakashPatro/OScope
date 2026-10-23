// Tier 4: distributed mutual exclusion. Timings below are derived by hand from the algorithm rules.
const MP = require('../js/engines/mp.js'); const P = require('../js/engines/mp-mutex.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (cfg, text) => MP.run(P, cfg, text);
const table = (r) => r.report.tables[0].rows; // [order, node, wanted, entered, left, waited]
const metric = (r, k) => (r.report.metrics.find((m) => m[0] === k) || [])[1];
const mutexOk = (r) => r.report.checks[0].ok;

// ---- Ricart-Agrawala by hand: A and B ask at t=1 (equal timestamps -> id breaks the tie), C asks at t=6. delay 1, cs 3.
const tie = go({ algo: 'ra', n: 3, dmin: 1, dmax: 1, cs: 3 }, '1 A want\n1 B want\n6 C want');
eq('RA: entry order A, B, C', table(tie).map((r) => r[1]), ['A', 'B', 'C']);
eq('RA: entry times 3, 7, 11 (each waits for the previous to leave and its deferred reply to travel 1)', table(tie).map((r) => r[3]), [3, 7, 11]);
eq('RA: leave times 6, 10, 14', table(tie).map((r) => r[4]), [6, 10, 14]);
eq('RA: waits 2, 6, 5', table(tie).map((r) => r[5]), [2, 6, 5]);
eq('RA: 3 entries x 2(N-1) = 12 messages', metric(tie, 'Messages sent'), 12);
eq('RA: 6 REQUEST and 6 REPLY', [metric(tie, 'REQUEST messages'), metric(tie, 'REPLY messages')], [6, 6]);
eq('RA: the earlier asker (A) defers its reply to B', tie.frames.some((f) => /A .*DEFERS its reply to B/.test(f.text)), true);
eq('RA: both safety and liveness checks pass', tie.report.checks.every((c) => c.ok), true);
// a later request with a smaller timestamp... a node that asked EARLIER (smaller ts) wins even if the message arrives later
const early = go({ algo: 'ra', n: 3, dmin: 1, dmax: 1, cs: 2 }, '1 C want\n3 A want');
eq('RA: earlier request goes first', table(early).map((r) => r[1]), ['C', 'A']);

// ---- cost: exactly 2(N-1) messages per entry for N = 2..6 (no crashes, no loss)
for (let n = 2; n <= 6; n++) {
  const r = go({ algo: 'ra', n, dmin: 1, dmax: 3, cs: 2, seed: n }, '1 A want\n1 B want\n9 ' + 'ABCDEF'[n - 1] + ' want');
  eq('RA N=' + n + ': messages per entry = 2(N-1) = ' + 2 * (n - 1), metric(r, 'Messages per entry'), (2 * (n - 1)).toFixed(1));
}
// ---- token ring by hand: n=4, delay 1, cs 2: token A->B->C (arrives t=2). C wants at 2, A wants at 5.
const tok = go({ algo: 'token', n: 4, dmin: 1, dmax: 1, cs: 2 }, '2 C want\n5 A want');
eq('token: C enters at 2 (token arrives the instant it asks), A at 6', table(tok).map((r) => [r[1], r[3]]), [['C', 2], ['A', 6]]);
eq('token: 4 hops (A>B, B>C, C>D, D>A)', metric(tok, 'TOKEN messages'), 4);
eq('token: A waited 1', table(tok)[1][5], 1);
const idle = go({ algo: 'token', n: 5, dmin: 1, dmax: 1, cs: 2 }, '1 B want\n20 E want');
eq('token: idle laps are paid for (more than 1 hop per entry)', Number(metric(idle, 'Messages per entry')) > 5, true);
eq('token: the ring order decides, not the request time', go({ algo: 'token', n: 4, dmin: 1, dmax: 1, cs: 2 }, '1 D want\n1 B want').report.tables[0].rows.map((r) => r[1]), ['B', 'D']);

// ---- failure modes show up as liveness failures, never as safety failures
const rc = go({ algo: 'ra', n: 3, dmin: 1, dmax: 1, cs: 3 }, '1 C crash\n2 A want');
eq('RA with a crashed node: A is stuck', [rc.report.checks[0].ok, rc.report.checks[1].ok, metric(rc, 'Entries completed')], [true, false, 0]);
const tc = go({ algo: 'token', n: 4, dmin: 1, dmax: 1, cs: 2 }, '2 C crash\n3 A want');
eq('token lost at a crashed node: nobody enters', [tc.report.checks[0].ok, tc.report.checks[1].ok, metric(tc, 'Entries completed')], [true, false, 0]);
eq('token: the dropped token is visible as a dropped message', tc.msgs.some((m) => m.status === 'dropped'), true);

// ---- safety and liveness over random scenarios (reliable network, no crashes)
let ok = true, msg = '', seed = 3; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 200 && ok; t++) {
  const n = 2 + rnd(5), algo = rnd(2) ? 'ra' : 'token', lines = [];
  for (let i = 0; i < 1 + rnd(8); i++) lines.push((1 + rnd(40)) + ' ' + 'ABCDEF'[rnd(n)] + ' want');
  const r = go({ algo, n, dmin: 1, dmax: 1 + rnd(6), cs: 1 + rnd(6), seed: rnd(10000) }, lines.join('\n'));
  if (!r.ok) { ok = false; msg = 'failed to run ' + r.errors; break; }
  if (!mutexOk(r)) { ok = false; msg = algo + ' violated mutual exclusion ' + JSON.stringify(lines); }
  const li = r.report.checks[1]; if (!li.ok) { ok = false; msg = algo + ' starved ' + JSON.stringify(lines) + JSON.stringify(r.cfg); }
}
eq('200 random scenarios: mutual exclusion holds and every request is served ' + msg, ok, true);
// ---- safety survives crashes and message loss (only progress may suffer)
ok = true; msg = '';
for (let t = 0; t < 200 && ok; t++) {
  const n = 2 + rnd(5), algo = rnd(2) ? 'ra' : 'token', lines = [];
  for (let i = 0; i < 2 + rnd(8); i++) { const k = rnd(8); lines.push((1 + rnd(40)) + ' ' + 'ABCDEF'[rnd(n)] + (k === 0 ? ' crash' : k === 1 ? ' recover' : ' want')); }
  const r = go({ algo, n, dmin: 1, dmax: 1 + rnd(4), cs: 1 + rnd(5), seed: rnd(10000), loss: rnd(3) * 15 }, lines.join('\n'));
  if (!r.ok) { ok = false; msg = 'failed to run ' + r.errors; break; }
  if (!mutexOk(r)) { ok = false; msg = algo + ' violated mutual exclusion under faults ' + JSON.stringify(lines) + JSON.stringify(r.cfg); }
}
eq('200 random scenarios with crashes and 0-30% loss: still never two inside ' + msg, ok, true);
// ---- misc
eq('a second want while waiting is ignored', go({ algo: 'ra', n: 2, dmin: 1, dmax: 1, cs: 2 }, '1 A want\n1 A want').frames.some((f) => f.text.includes('ignored')), true);
eq('a hidden internal step cannot be typed', go({ algo: 'token', n: 2 }, '1 A _start').ok, false);
eq('cs time out of range rejected', go({ algo: 'ra', n: 2, cs: 0 }, '1 A want').ok, false);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
