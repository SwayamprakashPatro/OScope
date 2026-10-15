const T = require('../js/engines/translation.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const base = { addrBits: 8, pageSize: 32, numFrames: 8, pageTable: [2, 5, 1, 7, null, 3, 0, 4], addrs: [], tlbSize: 2, tlbPolicy: 'fifo', tMem: 100, tTlb: 10 };
const run = (o) => T.simulate(Object.assign({}, base, o));
eq('Parse hex/bin/dec', [T.parseAddr('0x1F'), T.parseAddr('0b101'), T.parseAddr('42'), T.parseAddr('zz')].map((x) => Number.isNaN(x) ? 'NaN' : x), [31, 5, 42, 'NaN']);
eq('Derived bits: 8-bit address, 32-byte page → 5 offset, 3 page', [T.derive(base).offsetBits, T.derive(base).pageBits], [5, 3]);
// address 40: page 1, offset 8 → frame 5 → 5*32+8 = 168
let s = run({ addrs: [40] });
eq('40 → page 1 offset 8 → phys 168', [s.rows[0].page, s.rows[0].offset, s.rows[0].phys], [1, 8, 168]);
s = run({ addrs: [130] });
eq('130 → page 4 invalid → fault', [s.rows[0].page, s.rows[0].fault, s.rows[0].phys], [4, true, null]);
// TLB size 2 FIFO: pages 0,1,0,2,0 → miss,miss,hit(0),miss(evict 0 – oldest),miss
s = run({ addrs: [0, 32, 1, 64, 2] });
eq('FIFO TLB hits [miss,miss,hit,miss,miss]', s.rows.map((r) => r.tlbHit), [false, false, true, false, false]);
// LRU: 0,1,0,2,0 → after hit on 0, LRU order is 1,0; insert 2 evicts 1; then 0 hits
s = run({ addrs: [0, 32, 1, 64, 2], tlbPolicy: 'lru' });
eq('LRU TLB hits [miss,miss,hit,miss,hit]', s.rows.map((r) => r.tlbHit), [false, false, true, false, true]);
eq('Hit ratio 2/5 LRU', s.hitRatio, 0.4);
// EAT: h=0.8, tlb 10, mem 100 → 0.8*110 + 0.2*210 = 130
eq('EAT arithmetic', T.eat(0.8, 10, 100), 130);
eq('No TLB EAT = 2*mem', run({ tlbSize: 0, addrs: [0, 32] }).eat, 200);
eq('Validation: page size not a power of 2', T.validate(Object.assign({}, base, { pageSize: 30, addrs: [1] })).ok, false);
eq('Validation: address outside space', T.validate(Object.assign({}, base, { addrs: [256] })).ok, false);
eq('Validation: two pages same frame', T.validate(Object.assign({}, base, { pageTable: [1, 1, 2, 3, null, 4, 5, 6], addrs: [1] })).ok, false);
eq('Validation ok', T.validate(Object.assign({}, base, { addrs: [1, 40] })).ok, true);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
