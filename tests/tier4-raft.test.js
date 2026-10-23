// Tier 4: Raft. Part 1 tests the pure rules against the examples in the Raft paper (Figure 7, Figure 8, the vote rule).
// Part 2 runs whole clusters and checks the safety properties on many random failure scenarios.
const MP = require('../js/engines/mp.js'); const R = require('../js/engines/mp-raft.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const L = (...terms) => terms.map((t, i) => ({ term: t, cmd: 'c' + (i + 1) }));
const terms = (log) => log.map((e) => e.term);

// ---- termAt / vote rule
eq('termAt index 0 is 0, past the end is -1', [R.termAt(L(1, 1, 2), 0), R.termAt(L(1, 1, 2), 3), R.termAt(L(1, 1, 2), 4)], [0, 2, -1]);
eq('vote rule: a later last term wins even with a shorter log', R.upToDate(3, 1, L(1, 1, 2, 2)), true);
eq('vote rule: an earlier last term loses even with a longer log', R.upToDate(2, 9, L(1, 3)), false);
eq('vote rule: equal last term, longer or equal log wins', [R.upToDate(2, 3, L(1, 2, 2)), R.upToDate(2, 2, L(1, 2, 2))], [true, false]);
eq('vote rule: an empty log is up to date for an empty voter', R.upToDate(0, 0, []), true);

// ---- applyAppend (follower side)
eq('append: matching prev, new entries appended', terms(R.applyAppend(L(1, 1), 2, 1, [{ term: 2, cmd: 'x' }]).log), [1, 1, 2]);
eq('append: no entry at prevIndex -> reject', R.applyAppend(L(1), 3, 1, []).ok, false);
eq('append: entry at prevIndex has another term -> reject', R.applyAppend(L(1, 2), 2, 3, []).ok, false);
eq('append: prevIndex 0 always matches', R.applyAppend([], 0, 0, L(1, 1)).ok, true);
eq('append: a conflicting entry deletes it and everything after', terms(R.applyAppend(L(1, 1, 2, 2, 2), 2, 1, [{ term: 3, cmd: 'n' }]).log), [1, 1, 3]);
eq('append: an old duplicate message does not truncate a longer matching log', terms(R.applyAppend(L(1, 1, 1, 2), 1, 1, L(1, 1).slice(0, 1)).log), [1, 1, 1, 2]);
eq('append: heartbeat (no entries) leaves the log alone', terms(R.applyAppend(L(1, 1, 2), 3, 2, []).log), [1, 1, 2]);

// ---- Figure 7: whatever state a follower is in, the leader's back-up loop makes its log identical to the leader's
// Leader log (terms by index): 1 1 1 4 4 5 5 6 6 6, then the new leader appends entry 11 in term 8.
const leader10 = L(1, 1, 1, 4, 4, 5, 5, 6, 6, 6), leader = L(1, 1, 1, 4, 4, 5, 5, 6, 6, 6, 8);
const figure7 = { a: [1, 1, 1, 4, 4, 5, 5, 6, 6], b: [1, 1, 1, 4], c: [1, 1, 1, 4, 4, 5, 5, 6, 6, 6, 6], d: [1, 1, 1, 4, 4, 5, 5, 6, 6, 6, 7, 7], e: [1, 1, 1, 4, 4, 4, 4], f: [1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 3] };
const sync = (follower, lead) => { let f = L(...follower), next = lead.length + 1, tries = 0; for (;;) { tries++; const prev = next - 1, r = R.applyAppend(f, prev, R.termAt(lead, prev), lead.slice(prev)); if (r.ok) return { log: f = r.log, tries }; next--; } };
const backoff = {};
for (const k of Object.keys(figure7)) {
  const r = sync(figure7[k], leader); backoff[k] = r.tries;
  eq('Figure 7 (' + k + '): follower log ends identical to the leader\'s', terms(r.log), terms(leader));
}
// hand count: the leader tries prevIndex = 11, 10, 9 ... until the follower's entry at prevIndex has the leader's term
//   a: fails at 11,10, matches at 9 (3 tries)   b: fails 11..5, matches at 4 (8)   c: fails at 11 (6 vs 8), matches at 10 (2)
//   d: fails at 11 (7 vs 8), matches at 10 (2)  e: fails 11..6, matches at 5 (7)   f: fails 11..4, matches at 3 (9)
eq('Figure 7: attempts needed for (a)-(f), counted by hand', backoff, { a: 3, b: 8, c: 2, d: 2, e: 7, f: 9 });
// with only a heartbeat (no new entry) a follower keeps its extra, uncommitted entries: Raft never truncates without a conflict
eq('Figure 7 (c) after a heartbeat only: the extra entry 11 is still there', terms(sync(figure7.c, leader10).log), [1, 1, 1, 4, 4, 5, 5, 6, 6, 6, 6]);
eq('Figure 7 (d) after a heartbeat only: both extra entries are still there', terms(sync(figure7.d, leader10).log), [1, 1, 1, 4, 4, 5, 5, 6, 6, 6, 7, 7]);

// ---- commit rule, including the Figure 8 hazard
eq('commit: majority replicated an entry of the current term -> committed', R.newCommit([3, 3, 1], L(1, 2, 2), 2, 0), 3);
eq('commit: only 1 of 3 has entry 3 -> stays at 2', R.newCommit([3, 2, 2], L(1, 2, 2), 2, 0), 2);
eq('commit: an OLD-term entry on a majority is NOT committed by counting (Figure 8)', R.newCommit([2, 2, 1], L(1, 2), 4, 1), 1);
eq('commit: once a current-term entry reaches a majority, the old ones before it commit too', R.newCommit([3, 3, 1], L(1, 2, 4), 4, 1), 3);
eq('commit never moves backwards', R.newCommit([1, 1, 1], L(1, 1, 1), 1, 3), 3);

// ---- whole clusters
const run = (cfg, text) => MP.run(R, cfg, text);
const chk = (r) => r.report.checks.map((c) => c.ok);
const basic = run({ n: 3, seed: 1 }, '30 A cmd set-x\n34 B cmd set-y');
eq('cluster: a leader is elected (term 1) and the commands commit', [basic.report.tables[0].rows.length, basic.report.metrics.find((m) => m[0] === 'Entries committed')[1]], [1, 2]);
eq('cluster: the first three checks pass', chk(basic).slice(0, 3), [true, true, true]);
eq('cluster: every node ends with the same log', new Set(basic.state.map((s) => JSON.stringify(s.log))).size, 1);
eq('cluster: same seed, same run', JSON.stringify(run({ n: 3, seed: 1 }, '30 A cmd set-x\n34 B cmd set-y').report.metrics), JSON.stringify(basic.report.metrics));
eq('cluster: only the leader ever sends AppendEntries', new Set(basic.msgs.filter((m) => m.type === 'AppendEntries').map((m) => m.from)).size, 1);
const crash = run({ n: 3, seed: 1, maxT: 100 }, '30 A cmd before\n40 B crash\n70 A cmd after');
eq('crash: B (term-1 leader) is replaced by a new leader in a later term', crash.report.tables[0].rows.map((r) => r[0]), [1, 2]);
eq('crash: both commands commit with only 2 of 3 servers up', crash.report.metrics.find((m) => m[0] === 'Entries committed')[1], 2);
const cut = run({ n: 3, seed: 1, maxT: 130 }, '30 A cmd before\n40 B cut\n45 B cmd lost\n80 B heal\n100 A cmd after');
eq('partition: the cut-off leader\'s entry is lost, and flagged', cut.report.checks[3].ok === false && /"lost"/.test(cut.report.checks[3].text), true);
eq('partition: after healing and one more command, B has stepped down and its stale entry is overwritten, so all logs match', [cut.state[1].role, new Set(cut.state.map((s) => JSON.stringify(s.log))).size], ['follower', 1]);
eq('partition: safety holds throughout', chk(cut).slice(0, 3), [true, true, true]);
eq('a lone server in a 3-cluster can never win (needs 2 votes)', run({ n: 3, seed: 1, maxT: 100 }, '1 B cut\n1 C cut\n40 A cmd x').report.tables[0].rows.length, 0);
eq('minority cannot commit: command accepted by nobody (no leader)', run({ n: 3, seed: 1, maxT: 100 }, '1 B cut\n1 C cut\n40 A cmd x').report.metrics.find((m) => m[0] === 'Entries committed')[1], 0);
eq('a follower forwards a command to the leader it knows', basic.msgs.some((m) => m.type === 'CLIENT'), true);
eq('commands sent before any leader exists are rejected', run({ n: 3, seed: 1 }, '1 A cmd early').report.note.includes('rejected'), true);
// ---- validation
eq('election timeout must exceed heartbeat + round trip', run({ n: 3, hb: 6, etmin: 8, dmax: 2 }, '1 A cmd x').ok, false);
eq('etmax < etmin rejected', run({ n: 3, etmin: 20, etmax: 15 }, '1 A cmd x').ok, false);
eq('n = 6 rejected', run({ n: 6 }, '1 A cmd x').ok, false);
eq('a hidden internal step cannot be typed', run({ n: 3 }, '1 A _start').ok, false);

// ---- random clusters with crashes, recoveries, partitions: the safety properties must never fail
let ok = true, msg = '', seed = 77; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let multiLeaderRuns = 0, lostRuns = 0;
for (let t = 0; t < 300 && ok; t++) {
  const n = 3 + rnd(3), lines = [];
  for (let i = 0; i < 3 + rnd(9); i++) { const k = rnd(7), node = 'ABCDE'[rnd(n)]; lines.push((5 + rnd(120)) + ' ' + node + (k === 0 ? ' crash' : k === 1 ? ' recover' : k === 2 ? ' cut' : k === 3 ? ' heal' : ' cmd c' + i)); }
  const dmax = 1 + rnd(3), hb = 2 + rnd(5), etmin = hb + 2 * dmax + 1 + rnd(8), cfg = { n, seed: rnd(100000), dmin: 1, dmax, hb, etmin, etmax: etmin + rnd(15), maxT: 150, loss: 0 };
  const r = run(cfg, lines.join('\n'));
  if (!r.ok) { ok = false; msg = 'run failed ' + r.errors + JSON.stringify(cfg); break; }
  if (!r.report.checks[0].ok || !r.report.checks[1].ok) { ok = false; msg = 'SAFETY FAILED ' + r.report.checks.filter((c) => !c.ok).map((c) => c.text).join(' | ') + JSON.stringify(cfg) + JSON.stringify(lines); }
  if (r.report.tables[0].rows.length > 1) multiLeaderRuns++; if (r.report.checks[3]) lostRuns++;
}
eq('300 random clusters (crash, recover, partition, commands): election safety and state-machine safety never fail ' + msg, ok, true);
eq('the random runs really exercised re-election (>40 runs with 2+ terms) and lost uncommitted entries (>5 runs)', [multiLeaderRuns > 40, lostRuns > 5], [true, true]);
// quiescent cluster with no faults: all logs converge to the leader's
ok = true; msg = '';
for (let t = 0; t < 100 && ok; t++) {
  const n = 3 + rnd(3), lines = []; for (let i = 0; i < 1 + rnd(5); i++) lines.push((40 + rnd(30)) + ' ' + 'ABCDE'[rnd(n)] + ' cmd k' + i);
  const r = run({ n, seed: rnd(100000), dmin: 1, dmax: 2, hb: 4, etmin: 12, etmax: 24, maxT: 140 }, lines.join('\n'));
  const logs = new Set(r.state.map((s) => JSON.stringify(s.log)));
  if (logs.size !== 1 || !r.report.checks.slice(0, 3).every((c) => c.ok)) { ok = false; msg = JSON.stringify(lines) + JSON.stringify(r.state.map((s) => s.log.length)) + r.report.checks.map((c) => c.text).join('|'); }
}
eq('100 fault-free clusters: all servers converge to identical logs ' + msg, ok, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
