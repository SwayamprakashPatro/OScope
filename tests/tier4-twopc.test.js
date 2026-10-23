// Tier 4: two-phase commit. Message counts and outcomes derived by hand from the protocol.
const MP = require('../js/engines/mp.js'); const P = require('../js/engines/mp-twopc.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (cfg, text) => MP.run(P, cfg, text);
const base = { n: 3, dmin: 1, dmax: 1, timeout: 6, coop: false };
const metric = (r, k) => (r.report.metrics.find((m) => m[0] === k) || [])[1];
const outs = (r) => r.report.tables[0].rows.map((x) => x[3]);

// ---- all YES: PREPARE x2, VOTE-YES x2, COMMIT x2, ACK x2 = 8 = 4(N-1)
const c = go(base, '1 A begin');
eq('commit: everyone commits', outs(c), ['COMMIT', 'COMMIT', 'COMMIT']);
eq('commit: 4(N-1) = 8 messages', [metric(c, 'Messages sent'), metric(c, 'PREPARE messages'), metric(c, 'VOTE-YES messages'), metric(c, 'COMMIT messages'), metric(c, 'ACK messages')], [8, 2, 2, 2, 2]);
eq('commit: decision taken at t=3 (PREPARE at 2, votes arrive at 3)', c.events.find((e) => e.tag === 'COMMIT').t, 3);
for (const n of [3, 4, 5, 6]) eq('commit with N=' + n + ' costs 4(N-1) = ' + 4 * (n - 1), metric(go(Object.assign({}, base, { n }), '1 A begin'), 'Messages sent'), 4 * (n - 1));
eq('commit: all three checks pass (atomic, not blocked, cost)', c.report.checks.map((k) => k.ok), [true, true, true]);
// ---- one NO among 4 nodes: PREPARE 3, votes 3, ABORT to the two YES voters only, 2 ACK = 10
const a = go(Object.assign({}, base, { n: 4 }), '0 C no\n1 A begin');
eq('abort: everyone aborts', outs(a), ['ABORT', 'ABORT', 'ABORT', 'ABORT']);
eq('abort: 10 messages (the NO voter is not sent an ABORT)', [metric(a, 'Messages sent'), metric(a, 'ABORT messages'), metric(a, 'VOTE-NO messages')], [10, 2, 1]);
eq('abort: the NO voter aborts immediately, before the decision', a.frames.some((f) => /C votes NO and aborts immediately/.test(f.text)), true);
// ---- participant crash before voting: A times out at t=1+timeout and aborts
const pc = go(Object.assign({}, base, { timeout: 5 }), '1 C crash\n1 A begin');
eq('participant crash: coordinator times out and aborts', [outs(pc)[0], outs(pc)[1]], ['ABORT', 'ABORT']);
eq('participant crash: the timeout decision is at t = 1 + 5 = 6', pc.events.find((e) => e.tag === 'ABORT').t, 6);
eq('participant crash: atomicity holds', pc.report.checks[0].ok, true);
// ---- the blocking problem
const bk = go(Object.assign({}, base, { timeout: 5 }), '1 A begin\n2 A crash');
eq('blocking: B and C are prepared and stuck', [outs(bk)[1], outs(bk)[2]], ['UNCERTAIN (prepared)', 'UNCERTAIN (prepared)']);
eq('blocking: reported as a failed check naming both', [bk.report.checks[1].ok, bk.report.checks[1].text.startsWith('B, C are BLOCKED')], [false, true]);
eq('blocking: atomicity is still safe (nobody decided anything)', bk.report.checks[0].ok, true);
eq('blocking: they stop retrying after 3 asks', bk.msgs.filter((m) => m.type === 'QUERY' && m.from === 1).length, 3);
// cooperative termination helps only when someone knows
const coop = go({ n: 4, dmin: 1, dmax: 1, timeout: 5, coop: true }, '0 D no\n1 A begin\n2 A crash');
eq('coop: D voted NO so it knows ABORT and unblocks B and C', [outs(coop)[1], outs(coop)[2], outs(coop)[3]], ['ABORT', 'ABORT', 'ABORT']);
eq('coop: no one blocked', coop.report.checks[1].ok, true);
const coopNone = go({ n: 3, dmin: 1, dmax: 1, timeout: 5, coop: true }, '1 A begin\n2 A crash');
eq('coop: if everyone only voted YES nobody can help, still blocked', coopNone.report.checks[1].ok, false);
// recovery releases them
const rec = go(Object.assign({}, base, { timeout: 5 }), '1 A begin\n2 A crash\n30 A recover');
eq('recover: coordinator presumes abort and releases everyone', outs(rec), ['ABORT', 'ABORT', 'ABORT']);
// a participant that voted YES then crashes learns the decision when it recovers
const pr = go(base, '1 A begin\n3 C crash\n12 C recover');
eq('participant recovery: C asks, is told COMMIT', outs(pr), ['COMMIT', 'COMMIT', 'COMMIT']);
// ---- validation
eq('begin must be on A', go(base, '1 B begin').ok, false);
eq('A cannot vote no', go(base, '0 A no\n1 A begin').ok, false);
eq('a transaction must be started', go(base, '1 B no').ok, false);
eq('timeout shorter than a round trip rejected', go({ n: 3, dmin: 1, dmax: 4, timeout: 5 }, '1 A begin').ok, false);
eq('n=2 rejected (needs a coordinator and two participants)', go({ n: 2 }, '1 A begin').ok, false);
eq('a second begin is ignored', go(base, '1 A begin\n2 A begin').frames.some((f) => f.text.includes('already running')), true);

// ---- random: atomicity must hold whatever crashes and loss do
let ok = true, msg = '', seed = 21; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 400 && ok; t++) {
  const n = 3 + rnd(4), lines = ['1 A begin'];
  for (let i = 0; i < rnd(5); i++) { const k = rnd(4), node = 'ABCDEF'[rnd(n)]; lines.push(rnd(25) + ' ' + node + (k === 0 ? ' crash' : k === 1 ? ' recover' : (node === 'A' ? ' crash' : ' no'))); }
  const dmax = 1 + rnd(3), r = go({ n, dmin: 1, dmax, timeout: 2 * dmax + rnd(6), coop: !!rnd(2), loss: rnd(3) * 15, seed: rnd(9999) }, lines.join('\n'));
  if (!r.ok) { ok = false; msg = 'run failed ' + r.errors; break; }
  if (!r.report.checks[0].ok) { ok = false; msg = 'atomicity violated ' + JSON.stringify(lines) + JSON.stringify(r.cfg); }
}
eq('400 random runs with crashes, recoveries, NO votes and loss: atomicity never violated ' + msg, ok, true);
// a failure-free run always decides, and commits exactly when nobody votes NO
ok = true; msg = '';
for (let t = 0; t < 200 && ok; t++) {
  const n = 3 + rnd(4), noVoters = [...Array(n - 1).keys()].filter(() => rnd(3) === 0).map((i) => 'ABCDEF'[i + 1]), lines = noVoters.map((x) => '0 ' + x + ' no').concat(['1 A begin']);
  const r = go({ n, dmin: 1, dmax: 1 + rnd(3), timeout: 8, seed: rnd(9999) }, lines.join('\n')), want = noVoters.length ? 'ABORT' : 'COMMIT';
  if (!outs(r).every((o) => o === want)) { ok = false; msg = JSON.stringify(lines) + outs(r) + ' want ' + want; }
}
eq('200 failure-free runs: commit iff nobody votes NO, everyone agrees ' + msg, ok, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
