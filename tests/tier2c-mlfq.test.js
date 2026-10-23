// Tier 2C: MLQ / MLFQ. Expected values derived by hand (see comments).
const M = require('../js/engines/mlfq.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const gantt = (r) => r.frames.map((f) => f.running || '.').join('');
const row = (r, n) => r.procs.find((p) => p.name === n);

// Hand trace, quanta [2,4], A(0,5) B(1,3): A runs 0-1 (quantum, demoted q1), B runs 2-3 (demoted q1, 1 left),
// then A runs 4-6 (finishes at 7), B runs 7 (finishes at 8).
let r = M.run({ mode: 'mlfq', quanta: '2 4', boost: 0, procs: 'A 0 5\nB 1 3' });
eq('gantt AABBAAAB', gantt(r), 'AABBAAAB');
eq('A finish/turnaround/waiting/response', [row(r, 'A').finish, row(r, 'A').turnaround, row(r, 'A').waiting, row(r, 'A').response], [7, 7, 2, 0]);
eq('B finish/turnaround/waiting/response', [row(r, 'B').finish, row(r, 'B').turnaround, row(r, 'B').waiting, row(r, 'B').response], [8, 7, 4, 1]);
eq('tick 2 shows A already demoted into q1', r.frames[2].queues, [[], ['A']]);

// Preemption: A 0 6 (q0 quantum 3), B arrives at 1 in q0 -> same level, no preemption until A's quantum ends.
// Quanta [3,0]: A runs 0-2 (demoted), B runs 3-5 ... B(1,2) finishes at 5 (2 ticks 3-4 -> finish 5), A runs 5-7.
r = M.run({ mode: 'mlfq', quanta: '3 0', boost: 0, procs: 'A 0 6\nB 1 2' });
eq('same-level arrival does not preempt: AAABBAAA', gantt(r), 'AAABBAAA');
// Higher-queue preemption: A demoted to q1 then B arrives in q0 and preempts. Quanta [1,5]: A(0,4): t0 A (demote), t1 B arrives(q0) runs..
r = M.run({ mode: 'mlfq', quanta: '1 5', boost: 0, procs: 'A 0 4\nB 2 1' });
// t0 A (used 1 -> demoted q1). t1: only A in q1 runs (used 1). t2: B arrives in q0, preempts A. B runs t2 (done at 3). A resumes t3,t4.
eq('arrival in q0 preempts a q1 job: AABAA', gantt(r), 'AABAA');
eq('preemption is announced', r.frames[2].notes.some((x) => /B \(q0\) preempts A \(q1\)/.test(x)), true);

// I/O keeps the level: B runs 1 tick then blocks 2 ticks, quantum 2 so never demoted.
r = M.run({ mode: 'mlfq', quanta: '2 4 0', boost: 0, procs: 'B 0 3 1 2' });
// t0 B, blocked t1,t2 (idle), t3 B, blocked, t4,t5 idle, t6 B done at 7.
eq('I/O job gantt B..B..B', gantt(r), 'B..B..B');
eq('I/O job was never demoted', r.frames.filter((f) => f.running).map((f) => f.level), [0, 0, 0]);
eq('time blocked is counted separately', row(r, 'B').ioTime, 4);
eq('blocked job is not "waiting" in the ready sense', row(r, 'B').waiting, 0);

// Boost: L(0,8) and a stream of short jobs. With quanta [1,2,0], boost every 4.
r = M.run({ mode: 'mlfq', quanta: '1 2 0', boost: 4, procs: 'L 0 6' });
// L alone: t0 q0 (demote q1), t1,t2 (used 2 -> demote q2), t3 q2 runs (no quantum), t4 boost -> q0 and keeps running: used reset.
eq('levels over time for a lone job: 0,1,1,2 then boosted to 0', r.frames.map((f) => f.level).slice(0, 5), [0, 1, 1, 2, 0]);
eq('boost is announced at tick 4', r.frames[4].notes.some((x) => /BOOST/.test(x)), true);

// MLQ: strict priority between fixed queues, no demotion. quanta [2,0]. P in q1 from 0 (len 4); S in q0 arrives 1 (len 2).
r = M.run({ mode: 'mlq', quanta: '2 0', boost: 0, procs: 'P 0 4 q1\nS 1 2 q0' });
eq('MLQ: q0 job preempts q1 job, then q1 resumes: PSSPPP', gantt(r), 'PSSPPP');
eq('MLQ never changes a level', [...new Set(r.frames.filter((f) => f.running === 'P').map((f) => f.level))], [1]);
// MLQ round robin inside a queue: two jobs in q0, quantum 2: X(0,3) Y(0,3) -> XXYYXY
r = M.run({ mode: 'mlq', quanta: '2', boost: 0, procs: 'X 0 3 q0\nY 0 3 q0' });
eq('RR inside one MLQ queue: XXYYXY', gantt(r), 'XXYYXY');

// Idle gap and errors
r = M.run({ mode: 'mlfq', quanta: '2 0', boost: 0, procs: 'A 3 2' });
eq('idle until arrival: ...AA', gantt(r), '...AA');
eq('burst 0 rejected', M.run({ mode: 'mlfq', quanta: '2', boost: 0, procs: 'A 0 0' }).ok, false);
eq('bad queue index rejected', M.run({ mode: 'mlq', quanta: '2 3', boost: 0, procs: 'A 0 3 q5' }).ok, false);
eq('half an I/O pair rejected', M.run({ mode: 'mlfq', quanta: '2', boost: 0, procs: 'A 0 3 2 0' }).ok, false);
eq('too many ticks rejected', M.run({ mode: 'mlfq', quanta: '2', boost: 0, procs: 'A 0 500' }).ok, false);
eq('duplicate names rejected', M.run({ mode: 'mlfq', quanta: '2', boost: 0, procs: 'A 0 2\nA 1 2' }).ok, false);

// Random invariants
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 300; k++) {
  const n = 1 + rnd(5), lines = [];
  for (let i = 0; i < n; i++) lines.push('J' + i + ' ' + rnd(8) + ' ' + (1 + rnd(8)) + (rnd(3) === 0 ? ' ' + (1 + rnd(3)) + ' ' + (1 + rnd(3)) : '') + (rnd(2) ? ' q' + rnd(3) : ''));
  const mode = rnd(2) ? 'mlfq' : 'mlq', cfg = { mode, quanta: [1 + rnd(3), 1 + rnd(4), rnd(2) * 5].join(' '), boost: rnd(2) * (4 + rnd(8)), procs: lines.join('\n') };
  const x = M.run(cfg); if (!x.ok) { bad++; console.log('unexpected error', JSON.stringify(cfg), x.errors); continue; }
  const ran = {}; x.frames.forEach((f) => { if (f.running) ran[f.running] = (ran[f.running] || 0) + 1; });
  const okRun = x.procs.every((p) => ran[p.name] === p.burst);
  const okStrict = x.frames.every((f) => f.running === null || f.queues.slice(0, f.level).every((q) => q.length === 0));
  const okTime = x.procs.every((p) => p.turnaround >= p.burst && p.waiting + p.burst + p.ioTime >= 0 && p.finish > p.arrive);
  const okSum = x.procs.every((p) => p.turnaround === p.burst + p.waiting + p.ioTime);
  if (!(okRun && okStrict && okTime && okSum)) { bad++; console.log('invariant broken', JSON.stringify(cfg), okRun, okStrict, okTime, okSum); }
}
eq('300 random configs: every job runs exactly its burst, strict priority holds, accounting sane', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
