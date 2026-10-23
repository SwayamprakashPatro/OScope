// Tier 1: deadlock recovery (abort all / abort one / preempt) with victim policies.
const G = require('../js/engines/rag.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const model = (id) => { const p = G.PRESETS.find((x) => x.id === id); return G.parse(p.procs, p.res, p.edges).model; };

let c = model('circular');
let r = G.recover(c, { strategy: 'abort-one', policy: 'fewest' });
eq('circular: initially P1, P2 deadlocked', r.initial, ['P1', 'P2']);
eq('abort-one fewest: tie goes to P1, one victim is enough', [r.aborted, r.final.procs, r.stillDeadlocked], [['P1'], ['P2'], []]);
eq('abort-one: step records what was released', [r.steps.length, r.steps[0].released, r.steps[0].deadlockedAfter], [1, ['R1'], []]);
r = G.recover(c, { strategy: 'abort-all' });
eq('abort-all terminates both', [r.aborted, r.final.procs, r.stillDeadlocked, r.steps[0].action], [['P1', 'P2'], [], [], 'abort-all']);
r = G.recover(c, { strategy: 'preempt', policy: 'first' });
eq('preempt: nobody terminated, one rollback', [r.aborted, r.preemptions, r.stillDeadlocked, r.final.procs], [[], 1, [], ['P1', 'P2']]);
eq('preempt: victim must request the resource again', r.final.edges.some((e) => e.type === 'req' && e.p === 'P1' && e.r === 'R1') && !r.final.edges.some((e) => e.type === 'asg' && e.p === 'P1' && e.r === 'R1'), true);
eq('preempt: step names the resource', [r.steps[0].action, r.steps[0].victim, r.steps[0].resource], ['preempt', 'P1', 'R1']);
eq('original model is not modified', [c.procs, c.edges.length], [['P1', 'P2'], 4]);

// uneven holdings: P1 holds R1+R3 (requests R2), P2 holds R2 (requests R1), P3 requests R3 (waits, not in the circle)
let u = model('uneven');
eq('uneven: P3 is stuck behind the circle, so it is reported too', G.reduce(u).deadlocked, ['P1', 'P2', 'P3']);
eq('uneven: the cycle itself is P1, P2 only', G.findCycle(u).filter((n) => n[0] === 'P').sort(), ['P1', 'P2']);
eq('policy fewest picks P2 (holds 1)', G.recover(u, { strategy: 'abort-one', policy: 'fewest' }).aborted, ['P2']);
eq('policy most picks P1 (holds 2)', G.recover(u, { strategy: 'abort-one', policy: 'most' }).aborted, ['P1']);
eq('policy first picks P1', G.recover(u, { strategy: 'abort-one', policy: 'first' }).aborted, ['P1']);
eq('abort-one and preempt keep P3 alive (it was only waiting)', ['abort-one', 'preempt'].map((st) => G.recover(u, { strategy: st }).final.procs.includes('P3')), [true, true]);
eq('abort-all also kills the bystander P3 (cost 3 against 1)', [G.recover(u, { strategy: 'abort-all' }).aborted.length, G.recover(u, { strategy: 'abort-one' }).aborted.length], [3, 1]);
eq('a process that holds nothing is never chosen as victim while a helpful one exists', G.recover(u, { strategy: 'abort-one', policy: 'fewest' }).aborted.includes('P3'), false);
eq('aborting P1 frees R3, so P3 is no longer blocked', G.recover(u, { strategy: 'abort-one', policy: 'most' }).stillDeadlocked, []);

// no deadlock: nothing to do
['nodead', 'chain'].forEach((id) => { const x = G.recover(model(id), { strategy: 'abort-one' }); eq(id + ': no recovery needed', [x.needed, x.steps.length, x.aborted], [false, 0, []]); });
let t = G.recover(model('three'), { strategy: 'abort-one', policy: 'fewest' });
eq('three-cycle: one victim breaks it', [t.aborted.length, t.stillDeadlocked], [1, []]);

// random graphs: every strategy x policy ends deadlock-free, never aborts an innocent process, never loops
let seed = 99; const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
let bad = 0, deadlocks = 0, cases = 0;
for (let k = 0; k < 400; k++) {
  const np = 2 + rnd(3), nr = 1 + rnd(3);
  const procs = Array.from({ length: np }, (_, i) => 'P' + (i + 1)), res = Array.from({ length: nr }, (_, i) => ({ n: 'R' + (i + 1), k: rnd(4) ? 1 : 2 }));
  const edges = [], used = {}; const seenReq = {};
  res.forEach((rr) => { used[rr.n] = 0; });
  // First hand out instances (so processes hold things), then add requests (so some wait in circles).
  res.forEach((rr) => { for (let u = 0; u < rr.k; u++) if (rnd(5)) { edges.push(rr.n + ' -> ' + procs[rnd(np)]); used[rr.n]++; } });
  for (let e = 0; e < 2 + rnd(np * 2); e++) { const p = procs[rnd(np)], rr = res[rnd(nr)]; if (!seenReq[p + rr.n]) { seenReq[p + rr.n] = true; edges.push(p + ' -> ' + rr.n); } }
  const parsed = G.parse(procs.join(','), res.map((x) => x.n + '=' + x.k).join(','), edges.join('\n'));
  if (!parsed.ok) continue; cases++;
  const base = G.reduce(parsed.model).deadlocked; if (base.length) deadlocks++;
  ['abort-all', 'abort-one', 'preempt'].forEach((st) => ['fewest', 'most', 'first'].forEach((po) => {
    const x = G.recover(parsed.model, { strategy: st, policy: po });
    if (x.stillDeadlocked && x.stillDeadlocked.length) bad++;
    if (x.needed !== (base.length > 0)) bad++;
    if (x.aborted.some((p) => !base.includes(p))) bad++;           // only members of the first deadlock may be aborted
    if (x.needed && st === 'abort-one' && x.aborted.length > base.length) bad++;
    if (!x.needed && x.steps.length) bad++;
  }));
}
eq('random graphs (' + cases + ' valid, ' + deadlocks + ' deadlocked): recovery always succeeds and aborts only deadlocked processes', bad, 0);
eq('random test actually exercised deadlocks', deadlocks > 60, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
