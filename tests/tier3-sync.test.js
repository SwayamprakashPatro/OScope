// Tier 3: loops and jumps in the sync machine (Peterson, Dekker, bakery), stuck-forever detection,
// monitors and condition variables (Mesa and Hoare).
const S = require('../js/engines/sync.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const load = (d, prog) => { const pd = S.parseDecls(Object.assign({ vars: '', sems: '', muts: '', conds: '', cap: 0, expect: '' }, d)); const pp = S.parseProgram(prog, pd.decl); return { decl: pd.decl, prog: pp.threads, errors: pd.errors.concat(pp.errors) }; };
const preset = (id, over) => { const p = Object.assign({}, S.PRESETS.find((x) => x.id === id), over || {}); return load(p, p.prog); };
const outcomes = (m) => S.explore(m.prog, m.decl);
const kinds = (r) => r.outcomes.map((o) => (o.bad ? 'bad:' : 'ok:') + o.kind).sort();

// ---- parsing: labels, goto, if-chains, variable comparisons
const ids = ['peterson', 'peterbad', 'alternate', 'dekker', 'bakery', 'bakerybad', 'moncorrect', 'monif', 'monlost', 'monlostfix', 'monbcast'];
ids.forEach((id) => eq('preset ' + id + ' parses', preset(id).errors, []));
eq('goto to a missing label is a line-numbered error', load({ vars: 'X=0' }, 'thread A\n  goto nowhere').errors, ['Line 2: thread A has no label called nowhere.']);
eq('duplicate label is an error', load({ vars: 'X=0' }, 'thread A\n a:\n  work x\n a:\n  work y').errors.length, 1);
eq('an if with nothing after it is an error', load({ vars: 'X=0' }, 'thread A\n  if X == 0').errors.length, 1);
eq('an if-chain with nothing after it is an error', load({ vars: 'X=0' }, 'thread A\n  if X == 0\n  if X < 3').errors.length, 1);
eq('if may compare against another shared variable', load({ vars: 'X=0, Y=1' }, 'thread A\n  if X < Y\n  work yes').errors, []);
eq('if against an unknown name is an error', load({ vars: 'X=0' }, 'thread A\n  if X < Z\n  work yes').errors.length, 1);
eq('labels cost no step: a label at the end ends the round', (() => { const m = load({ vars: 'X=0' }, 'thread A\n  goto end\n  set X 1\n end:'); const r = S.run(m.prog, m.decl, { mode: 'rr', quantum: 1 }); const f = r.frames[r.frames.length - 1].st; return [r.status, f.vars.X, r.frames.length - 1]; })(), ['done', 0, 1]);

// ---- if-chains behave as AND, false skips the guarded line (hand-traced)
(() => {
  const run = (x, y) => { const m = load({ vars: 'X=' + x + ', Y=' + y + ', R=0' }, 'thread A\n  if X == 1\n  if Y == 1\n  set R 5\n  set R R2'.replace('\n  set R R2', '')); const r = S.run(m.prog, m.decl, { mode: 'rr', quantum: 1 }); return r.frames[r.frames.length - 1].st.vars.R; };
  eq('chain true,true runs the guarded line', run(1, 1), 5);
  eq('chain true,false skips it', run(1, 0), 0);
  eq('chain false (first) skips it without reading the second', run(0, 1), 0);
})();
eq('backwards goto makes a loop and is marked as one', (() => { const m = load({ vars: 'X=0' }, 'thread A\n top:\n  inc X\n  if X < 3\n  goto top\n  work done'); const r = S.run(m.prog, m.decl, { mode: 'rr', quantum: 1 }); return [r.frames[r.frames.length - 1].st.vars.X, r.frames.some((f) => f.ev && f.ev.loop)]; })(), [3, true]);

// ---- Peterson, Dekker, bakery: mutual exclusion proved over every interleaving
let r = outcomes(preset('peterson'));
eq('Peterson: no bad outcome, X is always 4', [r.outcomes.some((o) => o.bad), r.outcomes.every((o) => /X=4/.test(o.label)), r.truncated, r.trapped], [false, true, false, 0]);
r = outcomes(preset('dekker'));
eq('Dekker: no bad outcome, X is always 2', [r.outcomes.some((o) => o.bad), r.outcomes.every((o) => /X=2/.test(o.label)), r.trapped], [false, true, 0]);
r = outcomes(preset('bakery'));
eq('Bakery: no bad outcome, X is always 2', [r.outcomes.some((o) => o.bad), r.outcomes.every((o) => /X=2/.test(o.label)), r.trapped], [false, true, 0]);
r = outcomes(preset('bakerybad'));
eq('Bakery without the choosing flag: mutual exclusion breaks', r.outcomes.some((o) => o.bad && /MUTUAL EXCLUSION/.test(o.label)), true);
// Peterson with the turn handshake deleted is broken in a different way: both can enter or both can stick.
const noturn = S.PRESETS.find((x) => x.id === 'peterson').prog.replace(/\s*set turn \d[^\n]*/g, '');
r = outcomes(load({ vars: 'f0=0, f1=0, turn=0, X=0', expect: '' }, noturn));
eq('Peterson without "set turn" is not correct (a bad outcome exists)', r.outcomes.some((o) => o.bad), true);
// Peterson with the flag raised AFTER the turn is the classic ordering bug: mutual exclusion breaks.
const swapped = 'thread P0\n  set turn 1\n  set f0 1\n w:\n  if f1 == 1\n  if turn == 1\n  goto w\n  enter cs\n  work x\n  leave cs\n  set f0 0\n\nthread P1\n  set turn 0\n  set f1 1\n w:\n  if f0 == 1\n  if turn == 0\n  goto w\n  enter cs\n  work x\n  leave cs\n  set f1 0';
r = outcomes(load({ vars: 'f0=0, f1=0, turn=0' }, swapped));
eq('Peterson with turn set BEFORE the flag breaks mutual exclusion', r.outcomes.some((o) => o.bad && /MUTUAL EXCLUSION/.test(o.label)), true);

// ---- stuck forever (livelock / progress)
r = outcomes(preset('peterbad'));
eq('flags only: a STUCK FOREVER outcome exists and some schedules still finish', [kinds(r)], [['bad:stuck', 'ok:done']]);
eq('stuck outcome names where each thread is looping', /P0 is at "if f1 == 1"/.test(r.outcomes[0].label) || /wait/.test(r.outcomes[0].label) || /goto wait/.test(r.outcomes[0].label), true);
eq('stuck-state example schedule really reaches a stuck state', (() => {
  const m = preset('peterbad'); const path = r.outcomes.find((o) => o.kind === 'stuck').path;
  const run = S.run(m.prog, m.decl, { mode: 'manual', picks: path });
  const st = run.frames[run.frames.length - 1].st; return [st.threads[0].state, st.threads[1].state, st.vars.f0, st.vars.f1];
})(), ['ready', 'ready', 1, 1]);
r = outcomes(preset('alternate'));
eq('strict alternation: safe but P0 is stuck forever once P1 has finished', [r.outcomes.some((o) => o.kind === 'violation'), r.outcomes.some((o) => o.kind === 'stuck')], [false, true]);
eq('correct programs report zero trapped states', ['peterson', 'dekker', 'bakery', 'moncorrect'].map((id) => outcomes(preset(id)).trapped), [0, 0, 0, 0]);
eq('stuck detection is skipped (not wrong) when the search is truncated', S.explore(preset('peterson').prog, preset('peterson').decl, 20).trapped, 0);

// ---- monitors: Mesa
r = outcomes(preset('moncorrect'));
eq('monitor bounded buffer with while loops: always finishes, buffer empty', [r.outcomes.length, r.outcomes[0].bad, /count=0/.test(r.outcomes[0].label)], [1, false, true]);
eq('the same program also works under Hoare rules', (() => { const x = outcomes(preset('moncorrect', { mon: 'hoare' })); return [x.outcomes.some((o) => o.bad), x.trapped]; })(), [false, 0]);
r = outcomes(preset('monif'));
eq('if instead of while under Mesa: a consumer takes from an EMPTY buffer', r.outcomes.some((o) => o.bad && /EMPTY/.test(o.label)), true);
r = outcomes(preset('monif', { mon: 'hoare' }));
eq('if instead of while under Hoare: correct, no bad outcome', r.outcomes.some((o) => o.bad), false);
r = outcomes(preset('monlost'));
eq('signal before wait is lost: deadlock exists and so does a lucky finish', kinds(r), ['bad:deadlock', 'ok:done']);
eq('lost-wakeup fixed by a flag: never deadlocks', kinds(outcomes(preset('monlostfix'))), ['ok:done']);
eq('broadcast wakes everyone: finishes', kinds(outcomes(preset('monbcast'))), ['ok:done']);
eq('csignal instead of cbroadcast strands a waiter (deadlock)', (() => { const p = S.PRESETS.find((x) => x.id === 'monbcast'); return kinds(outcomes(load(p, p.prog.replace('cbroadcast', 'csignal')))); })(), ['bad:deadlock', 'ok:done']);

// ---- monitor mechanics, traced by hand
(() => {
  const m = load({ vars: 'ready=0', muts: 'M', conds: 'go' }, 'thread W\n  lock M\n  cwait go M\n  unlock M\n\nthread S\n  lock M\n  csignal go\n  unlock M');
  // W locks, W waits (releases M, sleeps), S locks, S signals (Mesa: W moves to M's queue), S unlocks (hands M to W), W unlocks.
  const run = S.run(m.prog, m.decl, { mode: 'manual', picks: ['W', 'W', 'S', 'S'] });
  const f = run.frames;
  eq('cwait releases the lock and blocks the thread on the condition', [f[2].st.muts.M.owner, f[2].st.threads[0].state, f[2].st.threads[0].on, f[2].st.conds.go.q.length], [null, 'blocked', 'go', 1]);
  eq('Mesa signal: sleeper moves to the monitor queue, signaller still owns M', [f[4].st.muts.M.owner, f[4].st.muts.M.q, f[4].st.conds.go.q.length, f[4].st.threads[0].on], [1, [0], 0, 'M']);
  const run2 = S.run(m.prog, m.decl, { mode: 'manual', picks: ['W', 'W', 'S', 'S', 'S', 'W'] });
  eq('Mesa: unlock hands M to the woken thread, which then finishes', [run2.frames[5].st.muts.M.owner, run2.frames[5].st.threads[0].state, run2.status], [0, 'ready', 'done']);
  const h = load({ muts: 'M', conds: 'go', mon: 'hoare' }, 'thread W\n  lock M\n  cwait go M\n  unlock M\n\nthread S\n  lock M\n  csignal go\n  unlock M');
  const rh = S.run(h.prog, h.decl, { mode: 'manual', picks: ['W', 'W', 'S', 'S'] });
  eq('Hoare signal: sleeper gets M immediately, signaller waits on the urgent queue', [rh.frames[4].st.muts.M.owner, rh.frames[4].st.muts.M.urg, rh.frames[4].st.threads[1].state, rh.frames[4].st.threads[0].state], [0, [1], 'blocked', 'ready']);
  const rh2 = S.run(h.prog, h.decl, { mode: 'manual', picks: ['W', 'W', 'S', 'S', 'W', 'S'] });
  eq('Hoare: when the sleeper unlocks, the signaller resumes and finishes', [rh2.status, rh2.frames[5].st.muts.M.owner], ['done', 1]);
  const lost = S.run(load({ muts: 'M', conds: 'go' }, 'thread S\n  lock M\n  csignal go\n  unlock M').prog, load({ muts: 'M', conds: 'go' }, 'x').decl, { mode: 'rr', quantum: 1 });
  eq('a signal with no sleeper is lost and marked', lost.frames.some((x) => x.ev && x.ev.lost), true);
  const bad = load({ muts: 'M', conds: 'go' }, 'thread W\n  cwait go M');
  eq('cwait without holding the monitor lock is a misuse violation', S.run(bad.prog, bad.decl, { mode: 'rr', quantum: 1 }).term.v.kind, 'misuse');
})();

// ---- randomized: Peterson/Dekker/bakery never break exclusion under random schedules, many seeds
['peterson', 'dekker', 'bakery'].forEach((id) => {
  const m = preset(id); let broken = 0, done = 0;
  for (let seed = 1; seed <= 300; seed++) { const run = S.run(m.prog, m.decl, { mode: 'random', seed }); if (run.term && run.term.kind === 'violation') broken++; if (run.term && run.term.kind === 'done') done++; }
  eq(id + ': 300 random schedules, no violation, all finish', [broken, done], [0, 300]);
});
// ---- the older behaviour is unchanged: single if still skips exactly one line
eq('single if behaves as before', (() => { const m = load({ vars: 'X=0, Y=0' }, 'thread A\n  if X == 1\n  set Y 7\n  set X 2'); const r2 = S.run(m.prog, m.decl, { mode: 'rr', quantum: 1 }); const f = r2.frames[r2.frames.length - 1].st.vars; return [f.X, f.Y]; })(), [2, 0]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
