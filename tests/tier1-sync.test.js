// Tier 1: test-and-set, compare-and-swap, spinlock (spin), register conditions, livelock, new presets.
const S = require('../js/engines/sync.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const load = (d, prog) => { const pd = S.parseDecls(Object.assign({ vars: '', sems: '', muts: '', cap: 0, expect: '' }, d)); const pp = S.parseProgram(prog, pd.decl); return { decl: pd.decl, prog: pp.threads, errors: pd.errors.concat(pp.errors) }; };
const preset = (id) => { const p = S.PRESETS.find((x) => x.id === id); return load(p, p.prog); };
const outcomes = (m) => S.explore(m.prog, m.decl).outcomes;
const last = (r) => r.frames[r.frames.length - 1].st;

// ---- every new preset parses; each behaves as its lesson says
['tas', 'tasone', 'tasbad', 'cas', 'rdv', 'rdvbad', 'barrier', 'barber', 'pinv'].forEach((id) => eq('preset ' + id + ' parses', preset(id).errors, []));
let o = outcomes(preset('tas'));
eq('spinlock: every interleaving ends with X=2, no violation', o.map((x) => [x.bad, /X=2/.test(x.label)]), [[false, true]]);
o = outcomes(preset('tasone'));
eq('single test-and-set: never a violation', o.some((x) => x.bad), false);
o = outcomes(preset('tasbad'));
eq('check-then-set: mutual exclusion is broken in some interleavings', o.some((x) => x.bad && /MUTUAL EXCLUSION/.test(x.label)), true);
eq('check-then-set: the shortest bad schedule interleaves both loads first', (() => { const b = o.find((x) => x.bad); return b.path.slice(0, 2).join('') === 'T1T2' || b.path.slice(0, 2).join('') === 'T2T1' || b.path.includes('T2'); })(), true);
o = outcomes(preset('cas'));
eq('cas: two possible results, X=1 (one CAS failed) and X=2', o.map((x) => /X=(\d)/.exec(x.label)[1]).sort(), ['1', '2']);
eq('cas: no outcome is flagged bad', o.some((x) => x.bad), false);
o = outcomes(preset('rdv')); eq('rendezvous: bad stays 0 everywhere', o.map((x) => [x.bad, /bad=0/.test(x.label)]), [[false, true]]);
o = outcomes(preset('rdvbad')); eq('rendezvous with both waiting first: deadlock', o.map((x) => x.kind), ['deadlock']);
o = outcomes(preset('barrier')); eq('barrier: nobody passes early in any interleaving', [o.length, o[0].bad, /bad=0/.test(o[0].label), /count=3/.test(o[0].label)], [1, false, true, true]);
o = outcomes(preset('barber')); eq('barber: always finishes with nobody waiting', o.map((x) => [x.bad, /waiting=0/.test(x.label)]), [[false, true]]);
eq('priority inversion preset: High is blocked while Mid runs (manual schedule)', (() => {
  const m = preset('pinv');
  const r = S.run(m.prog, m.decl, { mode: 'manual', picks: ['Low', 'High', 'High', 'Mid', 'Mid', 'Mid', 'Mid'] });
  const st = last(r); const hi = m.prog.findIndex((t) => t.id === 'High');
  return [st.threads[hi].state, st.threads[hi].on, st.threads.filter((t) => t.state === 'done').length];
})(), ['blocked', 'M', 1]);

// ---- spin behaves like a spinlock: stays READY, wastes steps, then acquires
const sp = load({ vars: 'L=0, X=0' }, 'thread A\n  spin L\n  work in cs\n  set L 0\n\nthread B\n  spin L\n  work in cs\n  set L 0');
let r = S.run(sp.prog, sp.decl, { mode: 'manual', picks: ['A', 'B', 'B', 'A', 'A', 'B'] });
eq('spin: first thread acquires (L becomes 1)', [r.frames[1].st.vars.L, r.frames[1].ev.spin || false], [1, false]);
eq('spin: second thread spins, stays ready, pc does not move', [r.frames[2].ev.spin, r.frames[2].st.threads[1].state, r.frames[2].st.threads[1].pc], [true, 'ready', 0]);
eq('spin: repeating the spin changes nothing but still costs a step', [r.frames[3].ev.spin, r.frames[3].st.vars.L, r.frames.length], [true, 1, 7]);
eq('spin: after the holder releases, the spinner acquires', [r.frames[6].st.threads[1].pc, r.frames[6].ev.spin || false], [1, false]);
eq('spin note says the thread is still ready (not blocked)', /SPINS/.test(r.frames[2].ev.note) && /ready/.test(r.frames[2].ev.note), true);
// livelock: the only thread spins on a lock nobody releases
const ll = load({ vars: 'L=1' }, 'thread A\n  spin L\n  work done');
r = S.run(ll.prog, ll.decl, { mode: 'rr', quantum: 1 });
eq('livelock: detected immediately instead of running to the step limit', [r.status, r.term.kind, r.frames.length < 5], ['livelock', 'livelock', true]);
eq('livelock: explorer reports it as a bad outcome', outcomes(ll).map((x) => [x.bad, /LIVELOCK/.test(x.label)]), [[true, true]]);
// a spinner is not a livelock while the holder can still run
const ok = load({ vars: 'L=1' }, 'thread A\n  spin L\n  work x\n\nthread B\n  work holder\n  set L 0');
eq('spin is fine while the lock holder can still run', outcomes(ok).map((x) => x.kind), ['done']);
// spin on a lock held by a thread that is blocked forever: also stuck (livelock, since the spinner stays ready)
const lh = load({ vars: 'L=0', sems: 's=0' }, 'thread A\n  spin L\n  wait s\n\nthread B\n  spin L\n  work x');
eq('holder blocked forever, other spins: livelock', outcomes(lh).map((x) => x.kind).sort(), ['livelock']);

// ---- tas / cas semantics
const t1 = load({ vars: 'L=0' }, 'thread A\n  tas r L\n  tas q L');
r = S.run(t1.prog, t1.decl, { mode: 'manual', picks: ['A', 'A'] });
eq('tas: first returns 0 and sets L=1; second returns 1', [last(r).threads[0].regs, last(r).vars.L], [{ r: 0, q: 1 }, 1]);
const c1 = load({ vars: 'X=5' }, 'thread A\n  load a X\n  add a 1\n  cas ok X 5 a\n  cas bad X 5 7');
r = S.run(c1.prog, c1.decl, { mode: 'manual', picks: ['A', 'A', 'A', 'A'] });
eq('cas: succeeds when X matches (register as new value), fails when it no longer does', [last(r).vars.X, last(r).threads[0].regs.ok, last(r).threads[0].regs.bad], [6, 1, 0]);
eq('cas failure note says it FAILED', /FAILED/.test(r.frames[4].ev.note), true);
const c2 = load({ vars: 'X=0' }, 'thread A\n  cas ok X 0 1');
r = S.run(c2.prog, c2.decl, { mode: 'rr', quantum: 1 }); eq('cas with literal numbers works', [last(r).vars.X, last(r).threads[0].regs.ok], [1, 1]);

// ---- if on registers
const ifr = load({ vars: 'X=0' }, 'thread A\n  tas r X\n  if r == 0\n  set X 7\n  work end');
r = S.run(ifr.prog, ifr.decl, { mode: 'rr', quantum: 1 });
eq('if on a register: r is 0 so the next line runs (X becomes 7)', last(r).vars.X, 7);
const ifr2 = load({ vars: 'X=1' }, 'thread A\n  tas r X\n  if r == 0\n  set X 7\n  work end');
r = S.run(ifr2.prog, ifr2.decl, { mode: 'rr', quantum: 1 });
eq('if on a register: r is 1 so the next line is skipped (X stays 1)', last(r).vars.X, 1);
eq('if on shared variables still works', (() => { const m = load({ vars: 'X=2' }, 'thread A\n  if X == 2\n  set X 9\n  work end'); return last(S.run(m.prog, m.decl, { mode: 'rr', quantum: 1 })).vars.X; })(), 9);

// ---- parse errors are specific
const err = (prog, d) => load(Object.assign({ vars: 'X=0' }, d), prog).errors.join(' | ');
eq('if on an unknown name is an error', /not a declared shared variable or a register/.test(err('thread A\n  if q == 0\n  work x')), true);
eq('if on a register that is only set LATER is an error', /register set earlier/.test(err('thread A\n  if r == 0\n  work x\n  tas r X')), true);
eq('tas on an undeclared variable', /not a declared shared variable/.test(err('thread A\n  tas r Y')), true);
eq('tas with a register that clashes with a variable', /not a valid register/.test(err('thread A\n  tas X X')), true);
eq('cas with a wrong number of operands', /should look like/.test(err('thread A\n  cas ok X 0')), true);
eq('cas with an unknown register as operand', /whole number or a register/.test(err('thread A\n  cas ok X 0 zz')), true);
eq('cas with a register set in another thread is rejected', /whole number or a register/.test(err('thread A\n  load a X\n\nthread B\n  cas ok X a 1')), true);
eq('spin on an undeclared variable', /not a declared shared variable/.test(err('thread A\n  spin Q')), true);
eq('unknown instruction message lists the new ones', /tas cas spin/.test(err('thread A\n  bogus')), true);

// ---- randomised: the spinlock protects the counter under many schedules; the broken lock does not
let badSpin = 0, badCheck = 0; const N = 300; const m1 = preset('tas'), m2 = preset('tasbad');
for (let seed = 1; seed <= N; seed++) {
  const a = S.run(m1.prog, m1.decl, { mode: 'random', seed });
  if (a.status !== 'done' || last(a).vars.X !== 2) badSpin++;
  const b = S.run(m2.prog, m2.decl, { mode: 'random', seed });
  if (b.status === 'violation') badCheck++;
}
eq('spinlock: ' + N + ' random schedules all end with X=2 and no violation', badSpin, 0);
eq('check-then-set: random schedules sometimes break mutual exclusion (' + badCheck + ' of ' + N + ')', badCheck > 0 && badCheck < N, true);
// three threads with the spinlock
const three = load({ vars: 'X=0, L=0', expect: 'X=3' }, ['A', 'B', 'C'].map((n) => 'thread ' + n + '\n  spin L\n  load r X\n  add r 1\n  store X r\n  set L 0').join('\n\n'));
eq('three spinning threads: all interleavings give X=3', S.explore(three.prog, three.decl).outcomes.map((x) => [x.bad, /X=3/.test(x.label)]), [[false, true]]);
// regression: the race still loses updates without a lock
const race = preset('race'); void race;
eq('regression: the original race preset still loses an update', S.explore(load(S.PRESETS[0], S.PRESETS[0].prog).prog, load(S.PRESETS[0], S.PRESETS[0].prog).decl).outcomes.some((x) => x.bad), true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
