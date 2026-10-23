// Tier 2A part 2: working set, frame allocation, cache mapping, EAT. Expected values derived by hand.
const W = require('../js/engines/workingset.js'), F = require('../js/engines/frames.js'), K = require('../js/engines/cachemap.js'), H = require('../js/engines/hierarchy.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const near = (n, got, want, tol = 1e-9) => { const ok = Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + got + ' want=' + want)); };

// ---- working set: window 3, string 1 2 1 3 4
let r = W.run({ delta: 3, frames: 8 }, 'A: 1 2 1 3 4');
eq('ws ok', r.ok, true);
eq('WS sizes over time 1,2,2,3,3', r.frames.slice(1).map((f) => f.per[0].size), [1, 2, 2, 3, 3]);
eq('WS at t=4 is {1,2,3}', r.frames[4].per[0].ws, [1, 2, 3]);
eq('WS at t=5 is {1,3,4}', r.frames[5].per[0].ws, [1, 3, 4]);
eq('faults under the WS model: t1 t2 t4 t5 = 4', r.stats.faults, [4]);
eq('fault flags', r.frames.slice(1).map((f) => f.per[0].fault), [true, true, false, true, true]);
r = W.run({ delta: 2, frames: 3 }, 'A: 1 2 3 4\nB: 5 6 7 8');
eq('two processes: demand 2 each = 4 from t=2', r.frames.slice(1).map((f) => f.demand), [2, 4, 4, 4]);
eq('demand 4 > 3 frames is thrashing from t=2', [r.stats.firstThrash, r.stats.thrashSteps], [2, 3]);
eq('shorter process stops contributing', W.run({ delta: 2, frames: 9 }, 'A: 1 2 3\nB: 4').frames[3].per[1].size, 0);
eq('bad line rejected', W.run({ delta: 2, frames: 3 }, 'A 1 2').ok, false);
eq('bad window rejected', W.run({ delta: 0, frames: 3 }, 'A: 1').ok, false);
for (let t = 0; t < 200; t++) { // random: WS never larger than window or distinct pages; demand = sum
  const d = 1 + Math.floor(Math.random() * 6), s = Array.from({ length: 20 }, () => Math.floor(Math.random() * 8)).join(' '), rr = W.run({ delta: d, frames: 5 }, 'A: ' + s);
  const ok = rr.frames.every((f) => f.per[0].size <= d && f.demand === f.per[0].size);
  ok ? pass++ : (fail++, console.log('FAIL ws random'));
}

// ---- frame allocation
eq('split 62 by 10:127 = 5,57 (largest remainder)', F.split(62, [10, 127]), [5, 57]);
eq('split 93 equally over 5 = 19,19,19,18,18', F.split(93, [1, 1, 1, 1, 1]), [19, 19, 19, 18, 18]);
eq('priority 3:1 of 8 = 6,2', F.split(8, [3, 1]), [6, 2]);
eq('split always sums to m', F.split(37, [3, 5, 7]).reduce((a, b) => a + b, 0), 37);
r = F.run({ frames: 62, min: 2, policy: 'proportional' }, 'small 10\nlarge 127');
eq('proportional allocation', r.rows.map((x) => x.alloc), [5, 57]);
r = F.run({ frames: 93, min: 2, policy: 'equal' }, 'a 10\nb 200\nc 200');
eq('equal over 3 = 31 each, small process caps at its size 10 with 21 spare', r.rows.map((x) => [x.alloc, x.spare]), [[10, 21], [31, 0], [31, 0]]);
r = F.run({ frames: 10, min: 2, policy: 'proportional' }, 'p1 1\np2 100');
eq('minimum enforced (but p1 only has 1 page: capped)', r.rows.map((x) => [x.alloc, x.spare]), [[1, 1], [8, 0]]);
eq('LRU: 1 2 3 1 2 4 with 3 frames = 4 faults', F.lruFaults([1, 2, 3, 1, 2, 4], 3), 4);
eq('LRU with 0 frames = every reference', F.lruFaults([1, 1, 1], 0), 3);
r = F.run({ frames: 8, min: 2, policy: 'equal' }, 'busy 20 : 1 2 3 4 1 2 3 4\nidle 4 : 9 9 9 9');
eq('equal: busy gets 4 frames and faults only on first 4', [r.rows[0].alloc, r.rows[0].faults, r.rows[1].faults], [4, 4, 1]);
r = F.run({ frames: 6, min: 2, policy: 'equal' }, 'busy 20 : 1 2 3 4 1 2 3 4\nidle 4 : 9 9 9 9');
eq('equal with 6 frames: busy has 3, LRU on a cycle of 4 faults every time', [r.rows[0].alloc, r.rows[0].faults], [3, 8]);
eq('compare lists all 3 policies', r.compare.map((c) => c.id), ['equal', 'proportional', 'priority']);
eq('too few frames rejected', F.run({ frames: 3, min: 2, policy: 'equal' }, 'a 5\nb 5').ok, false);
eq('bad line rejected', F.run({ frames: 8, min: 2, policy: 'equal' }, 'a').ok, false);
for (let t = 0; t < 300; t++) { const n = 1 + Math.floor(Math.random() * 6), w = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 50)), m = n + Math.floor(Math.random() * 100); const a = F.split(m, w); (a.reduce((x, y) => x + y, 0) === m && a.every((v) => v >= 0)) ? pass++ : (fail++, console.log('FAIL split random')); }

// ---- cache mapping
const base = { size: 64, block: 16, ways: '1', repl: 'LRU', abits: 8, hitTime: 1, penalty: 20 };
r = K.run(base, '0x00 0x40 0x00 0x40');
eq('cache ok, 4 sets, bits 4 tag + 2 index + 2... ', [r.cfg.sets, r.bits], [4, { tag: 2, index: 2, offset: 4 }]);
eq('direct: cold, cold, conflict, conflict', r.frames.slice(1).map((f) => f.kind), ['cold', 'cold', 'conflict', 'conflict']);
eq('0x40 → block 4, set 0, tag 1', [r.frames[2].block, r.frames[2].idx, r.frames[2].tag], [4, 0, 1]);
eq('second miss evicts block 0', r.frames[2].evicted, 0);
r = K.run(Object.assign({}, base, { ways: '2' }), '0x00 0x40 0x00 0x40');
eq('2-way: miss, miss, hit, hit', r.frames.slice(1).map((f) => f.kind), ['cold', 'cold', 'hit', 'hit']);
eq('2-way has 2 sets', r.cfg.sets, 2);
r = K.run(Object.assign({}, base, { ways: 'full' }), '0x00 0x10 0x20 0x30 0x40 0x00');
eq('full assoc: 5 blocks through 4: block 0 comes back as capacity miss', r.frames[6].kind, 'capacity');
eq('full assoc has 1 set and 0 index bits', [r.cfg.sets, r.bits.index], [1, 0]);
r = K.run(base, '0x00 0x01 0x02 0x03 0x10');
eq('spatial locality: miss, hit, hit, hit, miss', r.frames.slice(1).map((f) => f.hit), [false, true, true, true, false]);
eq('offset of 0x03', r.frames[4].off, 3);
eq('stats: 3 hits, 2 misses, hit rate 0.6', [r.stats.hits, r.stats.misses, r.stats.hitRate], [3, 2, 0.6]);
near('AMAT = 1 + 0.4 * 20 = 9', r.stats.amat, 9);
r = K.run(Object.assign({}, base, { ways: '2', repl: 'FIFO' }), '0x00 0x40 0x80 0x00');   // blocks 0,4,8 all map to set 0; 2 ways
eq('FIFO evicts the oldest even if used: block 0 is gone, so the last access misses', [r.frames[3].evicted, r.frames[4].hit], [0, false]);
r = K.run(Object.assign({}, base, { ways: '2', repl: 'LRU' }), '0x00 0x40 0x00 0x80 0x00');   // touching 0 keeps it; 0x80 evicts block 4
eq('LRU keeps the recently used block 0', [r.frames[4].evicted, r.frames[5].hit], [4, true]);
eq('misses = cold + capacity + conflict', (() => { const s = K.run(base, '0x00 0x40 0x10 0x50 0x00 0x80 0x20').stats; return s.misses === s.cold + s.capacity + s.conflict; })(), true);
eq('address out of range rejected', K.run(base, '0x100').ok, false);
eq('non power of two block rejected', K.run(Object.assign({}, base, { block: 12 }), '0x0').ok, false);
eq('too many ways rejected', K.run(Object.assign({}, base, { ways: '8' }), '0x0').ok, false);
for (let t = 0; t < 300; t++) { const ways = ['1', '2', '4', 'full'][t % 4], txt = Array.from({ length: 30 }, () => Math.floor(Math.random() * 256)).join(' '); const s = K.run(Object.assign({}, base, { ways }), txt); (s.ok && s.stats.hits + s.stats.misses === 30 && s.stats.misses === s.stats.cold + s.stats.capacity + s.stats.conflict && (ways !== 'full' || s.stats.conflict === 0)) ? pass++ : (fail++, console.log('FAIL cache random', ways, txt)); }

// ---- EAT
const lv = H.eatLevels([{ name: 'L1', hit: 0.9, time: 1 }, { name: 'L2', hit: 0.95, time: 10 }, { name: 'RAM', hit: 1, time: 100 }]);
near('three-level EAT = 2.5', lv.eat, 2.5);
eq('reach probabilities 1, 0.1, 0.005', lv.rows.map((x) => +x.reach.toFixed(6)), [1, 0.1, 0.005]);
near('served fractions sum to 1', lv.rows.reduce((a, x) => a + x.served, 0), 1);
const pp = { alpha: 0.8, tlb: 20, mem: 100, levels: 1, p: 0, fault: 8e6 };
near('paging, 1 level, 80% TLB = 140', H.eatPaging(pp).eat, 140);
near('2 levels = 160', H.eatPaging(Object.assign({}, pp, { levels: 2 })).eat, 160);
near('hit time = 120, miss time = 220 (1 level)', H.eatPaging(pp).missT, 220);
near('with p = 1e-6: 0.999999*140 + 8', H.eatPaging(Object.assign({}, pp, { p: 1e-6 })).eat, 147.99986, 1e-9);
near('max fault rate for 10% slowdown = 14 / (8e6 - 140)', H.maxFaultRate(pp, 1.1), 14 / (8e6 - 140));
near('TLB hit ratio 1 → tlb + mem = 120', H.eatPaging(Object.assign({}, pp, { alpha: 1 })).eat, 120);
r = H.run({ alpha: 0.8, tlb: 20, mem: 100, ptlevels: 1, pfault: 0, faultTime: 8e6 }, 'L1 0.9 1\nL2 0.95 10\nRAM 1 100');
eq('run ok and EAT 2.5', [r.ok, +r.levels.eat.toFixed(9)], [true, 2.5]);
eq('sensitivity rows cover alpha 0..1', [r.sens[0].alpha, r.sens[6].alpha], [0, 1]);
eq('sensitivity at alpha 0 = 20 + 100 + 100 = 220', r.sens[0].eat, 220);
eq('hit ratio above 1 rejected', H.run({ alpha: 0.8, tlb: 20, mem: 100, ptlevels: 1, pfault: 0, faultTime: 8e6 }, 'L1 1.5 1\nL2 1 10').ok, false);
eq('single level rejected', H.run({ alpha: 0.8, tlb: 20, mem: 100, ptlevels: 1, pfault: 0, faultTime: 8e6 }, 'L1 1 1').ok, false);
eq('bad TLB ratio rejected', H.run({ alpha: 2, tlb: 20, mem: 100, ptlevels: 1, pfault: 0, faultTime: 8e6 }, 'L1 0.9 1\nL2 1 10').ok, false);
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
