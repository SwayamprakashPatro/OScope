// Tier 2C: single / per-request / pool. Expected values derived by hand.
const T = require('../js/engines/threadpool.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const B = { model: 'pool', cores: 2, workers: 2, queueCap: 4, spawn: 0, overhead: 0, requests: 'A 0 3\nB 1 2' };
const go = (o) => T.run(Object.assign({}, B, o));
const resp = (r) => r.rows.map((x) => x.response);

// single thread: A runs 0-3, B waits then runs 3-5 -> responses 3 and 4
let r = go({ model: 'single' });
eq('single: responses 3 and 4 (B waited 2)', resp(r), [3, 4]);
eq('single: B sits in the queue at tick 1', r.frames[1].queue, ['B']);
// pool of 2 workers on 2 cores: both run at rate 1 -> A done at 3, B arrives 1, done at 3
r = go({});
eq('pool 2 workers / 2 cores: responses 3 and 2', resp(r), [3, 2]);
// pool of 2 on ONE core, no overhead: processor sharing. A rem 3: t0 alone ->2; t1..: both at 0.5 each: A 1.5,B 1.5 ; t2: 1,1; t3: .5,.5 ; t4: 0,0 -> both finish at 5
r = go({ cores: 1 });
eq('pool on 1 core shares the CPU: finish at 5 for both, responses 5 and 4', resp(r), [5, 4]);
eq('rate at tick 1 is 1/2', r.frames[1].rate, 0.5);
// per-request, spawn 1, 2 cores: A thread ready after 1 tick, runs ticks 1,2,3 -> finish 4. B arrives 1, ready at 2, runs 2,3,4 -> done at 5 (response 4)
r = go({ model: 'perrequest', spawn: 1 });
eq('per-request with 1 tick to create a thread: responses 4 and 3 (B: arrives 1, thread ready at 2, runs 2-3)', resp(r), [4, 3]);
eq('two threads were created', r.metrics.threadsCreated, 2);
// per-request, spawn 0, behaves like a big pool
r = go({ model: 'perrequest', spawn: 0 });
eq('per-request with free creation: responses 3 and 2', resp(r), [3, 2]);

// Rejection: 1 worker, queue of 1; A,B,C at t=0, each 2 ticks. A takes the worker, B waits, C rejected.
r = go({ workers: 1, queueCap: 1, requests: 'A 0 2\nB 0 2\nC 0 2' });
eq('queue full -> C rejected', [r.rows[2].status, r.metrics.rejected, r.metrics.completed], ['rejected', 1, 2]);
eq('A and B finish at 2 and 4', [r.rows[0].finish, r.rows[1].finish], [2, 4]);
eq('rejection is announced', r.frames[0].notes.some((x) => /C arrives.*REJECTED/.test(x)), true);
// queue size 0: a request that finds every worker busy is rejected at once
r = go({ workers: 1, queueCap: 0, requests: 'A 0 3\nB 1 1' });
eq('queue size 0: B rejected', r.rows[1].status, 'rejected');
// a worker taking from the queue makes room for later arrivals
r = go({ workers: 1, queueCap: 1, requests: 'A 0 1\nB 0 1\nC 1 1' });
eq('after A finishes B starts, so C finds a free queue slot', [r.rows[2].status, r.rows[2].finish], ['done', 3]);

// Overload: 10 requests of 4 ticks, 2 cores. Pool (2 workers) finishes all with avg response lower than per-request with overhead.
const burst = Array.from({ length: 10 }, (_, i) => 'R' + i + ' 0 4').join('\n');
const pool = T.run({ model: 'pool', cores: 2, workers: 2, queueCap: 20, spawn: 1, overhead: 10, requests: burst });
const per = T.run({ model: 'perrequest', cores: 2, workers: 2, queueCap: 20, spawn: 1, overhead: 10, requests: burst });
eq('pool: 10 done, 0 rejected', [pool.metrics.completed, pool.metrics.rejected], [10, 0]);
eq('pool of 2 on 2 cores: five waves of 2 requests -> finishes at 4,8,12,16,20', [pool.rows[0].finish, pool.rows[2].finish, pool.rows[9].finish], [4, 8, 20]);
eq('per-request creates 10 threads; peak 10', [per.metrics.threadsCreated, per.metrics.peakThreads], [10, 10]);
eq('per-request is slower overall under overhead (10 threads on 2 cores)', per.metrics.ticks > pool.metrics.ticks, true);
eq('pool average response = (4+4+8+8+12+12+16+16+20+20)/10 = 12', pool.metrics.avgResponse, 12);
// 10 threads on 2 cores: rate = 0.2 * max(0.2, 1-0.1*8) = 0.04 per thread -> 4 work takes 100 ticks, started at tick 1
eq('per-request with 10 threads on 2 cores crawls: average response about 101', Math.round(per.metrics.avgResponse), 101);
eq('pool has constant thread count', pool.frames.every((f) => f.threads === 2), true);
eq('core use never exceeds 100%', pool.metrics.coreUse <= 1.0000001 && per.metrics.coreUse <= 1.0000001, true);

// Errors
eq('cores 0', go({ cores: 0 }).ok, false); eq('overhead 80', go({ overhead: 80 }).ok, false); eq('bad line', go({ requests: 'A 1' }).ok, false);
eq('duplicate name', go({ requests: 'A 0 1\nA 1 1' }).ok, false); eq('work 0', go({ requests: 'A 0 0' }).ok, false);
eq('too many ticks', go({ cores: 1, queueCap: 20, workers: 4, requests: Array.from({ length: 12 }, (_, i) => 'R' + i + ' 0 30').join('\n') }).ok, false);

// Random invariants
let seed = 17; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 300; k++) {
  const n = 1 + rnd(8), L = []; for (let i = 0; i < n; i++) L.push('Q' + i + ' ' + rnd(10) + ' ' + (1 + rnd(6)));
  const cfg = { model: ['single', 'perrequest', 'pool'][rnd(3)], cores: 1 + rnd(4), workers: 1 + rnd(4), queueCap: rnd(5), spawn: rnd(3), overhead: rnd(3) * 10, requests: L.join('\n') };
  const x = T.run(cfg); if (!x.ok) { bad++; console.log('unexpected', JSON.stringify(cfg), x.errors); continue; }
  const m = x.metrics;
  if (m.completed + m.rejected !== n) bad++;
  x.rows.forEach((row) => { if (row.status === 'done' && (row.finish < row.arrive + Math.ceil(row.work / 1) * 0 + 1 || row.start < row.arrive || row.finish <= row.start)) bad++; if (row.status === 'done' && row.finish - row.start < 1) bad++; });
  if (m.coreUse > 1.0000001) bad++;
  x.frames.forEach((f) => { if (x.cfg.model !== 'perrequest' && f.active.length > x.cfg.workers) bad++; if (x.cfg.model === 'single' && f.active.length > 1) bad++; if (f.rate < 0 || f.rate > 1) bad++; });
  if (x.cfg.model !== 'pool' && m.rejected) bad++;
  // with one request, no overhead possible: response >= work (+ spawn for per-request)
  if (n === 1 && x.rows[0].status === 'done' && x.rows[0].response < x.rows[0].work + (cfg.model === 'perrequest' ? cfg.spawn : 0)) bad++;
}
eq('300 random configs: every request done or rejected, never more workers than allowed, rates in [0,1], core use <= 100%', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
