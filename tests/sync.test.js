const S = require('../js/engines/sync.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const load = (id) => { const p = S.PRESETS.find((x) => x.id === id); const d = S.parseDecls({ vars: p.vars, sems: p.sems, muts: p.muts, cap: p.cap, expect: p.expect }); const g = S.parseProgram(p.prog, d.decl); return { d, g, p }; };
const explore = (id) => { const { d, g } = load(id); return S.explore(g.threads, d.decl); };
const kinds = (ex) => ex.outcomes.map((o) => o.kind + (o.kind === 'violation' ? ':' + o.label.slice(0, 12) : ''));
S.PRESETS.forEach((p) => { const { d, g } = load(p.id); eq('Preset parses cleanly: ' + p.id, d.errors.concat(g.errors), []); });
// race
let ex = explore('race');
eq('Race: terminates with 2 outcomes (X=2 ok, lost update)', ex.outcomes.length, 2);
eq('Race: a lost update is reachable', ex.outcomes.some((o) => /WRONG RESULT: X ended as 1/.test(o.label)), true);
eq('Race: correct result also reachable', ex.outcomes.some((o) => o.kind === 'done'), true);
{ const { d, g } = load('race'); const r = S.run(g.threads, d.decl, { mode: 'manual', picks: ['T1', 'T2', 'T1', 'T1', 'T2', 'T2'] }); eq('Race: textbook lost-update schedule gives X=1', r.frames[r.frames.length - 1].st.vars.X, 1); eq('Race: reports wrong result', r.term.kind + ':' + r.term.v.kind, 'violation:result'); }
{ const { d, g } = load('race'); const r = S.run(g.threads, d.decl, { mode: 'manual', picks: ['T1', 'T1', 'T1', 'T2', 'T2', 'T2'] }); eq('Race: serial schedule gives X=2', r.term.kind, 'done'); }
ex = explore('mutex'); eq('Mutex fix: exactly one outcome, finished', kinds(ex), ['done']);
eq('Mutex fix: X = 2', /X=2/.test(ex.outcomes[0].label), true);
ex = explore('pc'); eq('Producer-consumer correct: no deadlock/violation', ex.outcomes.every((o) => o.kind === 'done'), true); eq('Producer-consumer: not truncated', ex.truncated, false);
ex = explore('pcbad'); eq('Producer-consumer wrong order: deadlock reachable', ex.outcomes.some((o) => o.kind === 'deadlock'), true);
ex = explore('dp3'); eq('Naive philosophers: deadlock reachable', ex.outcomes.some((o) => o.kind === 'deadlock'), true);
eq('Naive philosophers: can also finish', ex.outcomes.some((o) => o.kind === 'done'), true);
['dp3o', 'dp3r', 'dp3a'].forEach((id) => { const e = explore(id); eq('Philosophers fix ' + id + ': never deadlocks', e.outcomes.every((o) => o.kind === 'done'), true); eq(id + ': not truncated', e.truncated, false); });
ex = explore('rw'); eq('Readers-writers correct: no violation or deadlock', ex.outcomes.every((o) => o.kind === 'done'), true);
ex = explore('rwbad'); eq('Readers-writers broken: exclusion violation reachable', ex.outcomes.some((o) => o.kind === 'violation' && /MUTUAL EXCLUSION/.test(o.label)), true);
// semaphore FIFO + handoff
{ const d = S.parseDecls({ vars: '', sems: 'S=0', muts: '', cap: 0, expect: '' }); const g = S.parseProgram('thread A\n  wait S\nthread B\n  wait S\nthread C\n  signal S\n  signal S', d.decl);
  const r = S.run(g.threads, d.decl, { mode: 'manual', picks: ['A', 'B', 'C', 'C'] });
  eq('Semaphore: waiters wake FIFO and finish', r.term.kind, 'done');
  const f = r.frames; eq('After A,B block: queue is [A,B]', f[2].st.sems.S.q, [0, 1]); eq('First signal wakes A only', f[3].st.threads.map((t) => t.state), ['done', 'blocked', 'ready']); }
// misuse
{ const d = S.parseDecls({ vars: '', sems: '', muts: 'M', cap: 0, expect: '' }); const g = S.parseProgram('thread A\n  unlock M', d.decl); const r = S.run(g.threads, d.decl, { mode: 'rr', quantum: 1 }); eq('Unlock without owning is flagged', r.term.v.kind, 'misuse'); }
// buffer misuse
{ const d = S.parseDecls({ vars: '', sems: '', muts: '', cap: 1, expect: '' }); const g = S.parseProgram('thread A\n  put\n  put', d.decl); eq('Overflow detected', S.run(g.threads, d.decl, { mode: 'rr', quantum: 1 }).term.v.kind, 'overflow'); }
// schedulers
{ const { d, g } = load('race'); const a = S.run(g.threads, d.decl, { mode: 'random', seed: 5 }), b = S.run(g.threads, d.decl, { mode: 'random', seed: 5 }); eq('Random scheduler is reproducible', a.picks, b.picks);
  const rr = S.run(g.threads, d.decl, { mode: 'rr', quantum: 1 }); eq('Round-robin q=1 interleaves T1,T2,...', rr.picks, ['T1', 'T2', 'T1', 'T2', 'T1', 'T2']); eq('Round-robin q=1 loses the update', rr.term.v.kind, 'result');
  const rr3 = S.run(g.threads, d.decl, { mode: 'rr', quantum: 3 }); eq('Round-robin q=3 is serial and correct', rr3.term.kind, 'done');
  const bad = S.run(g.threads, d.decl, { mode: 'manual', picks: ['T1', 'T1', 'T1', 'T1'] }); eq('Manual: running a finished thread is an error', bad.error !== null, true); }
// replay of an explore path reproduces the outcome
{ const { d, g } = load('dp3'); const e = S.explore(g.threads, d.decl); const dl = e.outcomes.find((o) => o.kind === 'deadlock'); const r = S.run(g.threads, d.decl, { mode: 'manual', picks: dl.path }); eq('Replaying the deadlock path deadlocks', r.term && r.term.kind, 'deadlock'); }
// validation
eq('Unknown instruction', S.parseProgram('thread A\n  fly', S.parseDecls({ vars: '', sems: '', muts: '', cap: 0 }).decl).errors.length, 1);
eq('Undeclared variable', S.parseProgram('thread A\n  inc Z', S.parseDecls({ vars: 'X=0', sems: '', muts: '', cap: 0 }).decl).errors.length, 1);
eq('put without buffer', S.parseProgram('thread A\n  put', S.parseDecls({ vars: '', sems: '', muts: '', cap: 0 }).decl).errors.length, 1);
eq('Too many threads', S.parseProgram(Array.from({ length: 7 }, (_, i) => 'thread T' + i + '\n  work').join('\n'), S.parseDecls({ vars: '', sems: '', muts: '', cap: 0 }).decl).errors.length > 0, true);
eq('Name clash across kinds', S.parseDecls({ vars: 'X=0', sems: 'X=1', muts: '', cap: 0 }).errors.length > 0, true);
eq('Trailing if rejected', S.parseProgram('thread A\n  if X == 1', S.parseDecls({ vars: 'X=0', sems: '', muts: '', cap: 0 }).decl).errors.length, 1);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
