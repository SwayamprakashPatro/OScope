// Tier 1: priority with aging, lottery scheduling.
const S = require('../js/engines/scheduling.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const rows = (a) => a.map(([arrival, burst, priority]) => ({ arrival, burst, priority }));
const run = (r, cfg) => { const v = S.validate(r, cfg); if (!v.ok) return { v }; return { v, sim: S.simulate(v.clean, cfg) }; };

// ---- aging: P1 priority 1 burst 10, P2 priority 3 burst 2, both at 0, boost every 2 ticks of waiting.
// Hand trace: P2 waits 6 ticks -> boost 3 -> effective 0, beats P1 (1) at t=6 and preempts it.
const R = rows([[0, 10, 1], [0, 2, 3]]);
let a = run(R, { algo: 'priority_aging', agingEvery: 2 });
eq('aging: P2 overtakes P1 at t=6', a.sim.ticks.slice(0, 12), ['P1', 'P1', 'P1', 'P1', 'P1', 'P1', 'P2', 'P2', 'P1', 'P1', 'P1', 'P1']);
eq('aging: completion times', a.sim.per.map((r) => r.ct), [12, 8]);
eq('aging: preempt event recorded at t=6', a.sim.frames[6].events.some((e) => e.type === 'preempt' && e.pid === 'P1' && e.by === 'P2'), true);
eq('aging: frame exposes effective priorities', [a.sim.frames[0].eff, a.sim.frames[6].eff], [{ P1: 1, P2: 3 }, { P1: 1, P2: 0 }]);
eq('aging: explanation mentions the boost', /aged 3/.test(a.sim.frames[6].decision.text), true);
let plain = run(R, { algo: 'priority_p' });
eq('plain preemptive priority: P2 waits until P1 is done', [plain.sim.per.map((r) => r.ct), plain.sim.frames[0].eff], [[10, 12], null]);
// without any waiting boost needed, aging equals plain priority
let same = run(rows([[0, 4, 1], [0, 3, 2]]), { algo: 'priority_aging', agingEvery: 50 });
eq('large aging step behaves like plain priority', same.sim.ticks, run(rows([[0, 4, 1], [0, 3, 2]]), { algo: 'priority_p' }).sim.ticks);
// higher-number-is-higher-priority direction
let hi = run(rows([[0, 10, 5], [0, 2, 3]]), { algo: 'priority_aging', agingEvery: 2, lowerIsHigher: false });
eq('aging works when a higher number means higher priority', hi.sim.ticks.slice(4, 10), ['P1', 'P1', 'P2', 'P2', 'P1', 'P1']);
// preempted process restarts its waiting count (does not keep an unfair advantage)
let reset = run(rows([[0, 10, 1], [0, 2, 3], [0, 10, 2]]), { algo: 'priority_aging', agingEvery: 2 });
eq('aging: every process finishes', reset.sim.per.every((r) => Number.isFinite(r.ct)), true);
eq('aging: validation rejects step 0', run(R, { algo: 'priority_aging', agingEvery: 0 }).v.ok, false);
eq('aging: validation rejects non-integer step', run(R, { algo: 'priority_aging', agingEvery: 1.5 }).v.ok, false);
eq('aging: priority column is required', run(rows([[0, 3, '']]), { algo: 'priority_aging', agingEvery: 2 }).v.ok, false);

// ---- lottery
const T = rows([[0, 8, 3], [0, 8, 1]]);
let l1 = run(T, { algo: 'lottery', quantum: 1, seed: 7 }), l2 = run(T, { algo: 'lottery', quantum: 1, seed: 7 }), l3 = run(T, { algo: 'lottery', quantum: 1, seed: 8 });
eq('lottery: same seed, same schedule', l1.sim.ticks, l2.sim.ticks);
eq('lottery: different seed, different schedule', JSON.stringify(l1.sim.ticks) !== JSON.stringify(l3.sim.ticks), true);
eq('lottery: all processes finish', l1.sim.per.every((r) => Number.isFinite(r.ct)), true);
eq('lottery: total busy time equals total burst', l1.sim.ticks.filter(Boolean).length, 16);
const dr = l1.sim.frames.find((f) => f.decision && f.decision.draw && f.decision.draw.number != null);
eq('lottery: draw recorded with blocks', [dr.decision.draw.total, dr.decision.draw.blocks.map((b) => [b.pid, b.lo, b.hi])], [4, [['P1', 0, 2], ['P2', 3, 3]]]);
eq('lottery: the drawn number really falls in the winner block', (() => { const d = dr.decision.draw; const w = d.blocks.find((b) => b.pid === dr.decision.chosen); return d.number >= w.lo && d.number <= w.hi; })(), true);
eq('lottery: explanation names the ticket', /Ticket #\d/.test(dr.decision.text), true);
// statistics: with 3:1 tickets the first draw is won by P1 about 75% of the time
let wins = 0; const N = 4000;
for (let seed = 1; seed <= N; seed++) wins += S.simulate(S.validate(T, { algo: 'lottery', quantum: 1 }).clean, { algo: 'lottery', quantum: 1, seed }).ticks[0] === 'P1' ? 1 : 0;
eq('lottery: first draw is won ~75% of the time by the 3-ticket process (' + (wins / N).toFixed(3) + ')', Math.abs(wins / N - 0.75) < 0.03, true);
// a long run gives CPU in proportion to tickets while both are still ready (first 8 ticks of many seeds)
let p1 = 0; for (let seed = 1; seed <= 500; seed++) { const s = S.simulate(S.validate(rows([[0, 40, 3], [0, 40, 1]]), { algo: 'lottery', quantum: 1 }).clean, { algo: 'lottery', quantum: 1, seed }); p1 += s.ticks.slice(0, 20).filter((x) => x === 'P1').length; }
eq('lottery: ~75% of the first 20 ticks go to the 3-ticket process (' + (p1 / 10000).toFixed(3) + ')', Math.abs(p1 / 10000 - 0.75) < 0.02, true);
eq('lottery: single process needs no draw', run(rows([[0, 3, 2]]), { algo: 'lottery', quantum: 2, seed: 1 }).sim.frames[0].decision.draw.number, null);
eq('lottery: quantum is respected (runs in slices of 2)', (() => { const s = run(rows([[0, 4, 1], [0, 4, 1]]), { algo: 'lottery', quantum: 2, seed: 3 }).sim.ticks; for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return false; return true; })(), true);
eq('lottery: tickets must be >= 1', run(rows([[0, 3, 0]]), { algo: 'lottery', quantum: 1 }).v.ok, false);
eq('lottery: seed must be an integer', run(T, { algo: 'lottery', quantum: 1, seed: 1.5 }).v.ok, false);
eq('lottery: quantum validated like round robin', run(T, { algo: 'lottery', quantum: 0 }).v.ok, false);
eq('lottery: negative tickets in the compare tab cannot crash a run', S.simulate(rows([[0, 2, -5], [0, 2, 0]]), { algo: 'lottery', quantum: 1, seed: 1 }).per.length, 2);
eq('compare tab excludes the random lottery', Object.keys(S.simulateAll(S.validate(R, { algo: 'priority_np' }).clean, { quantum: 2, agingEvery: 3 })).includes('lottery'), false);
eq('compare tab includes aging', Object.keys(S.simulateAll(S.validate(R, { algo: 'priority_np' }).clean, { quantum: 2, agingEvery: 3 })).includes('priority_aging'), true);
eq('usesPriorityColumn', ['priority_np', 'priority_aging', 'lottery', 'rr', 'fcfs'].map(S.usesPriorityColumn), [true, true, true, false, false]);
// unchanged algorithms still behave (regression): textbook FCFS
eq('regression: FCFS unaffected', run(rows([[0, 5, 0], [1, 3, 0], [2, 8, 0]]), { algo: 'fcfs' }).sim.per.map((r) => r.ct), [5, 8, 16]);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
