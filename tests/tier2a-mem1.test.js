// Tier 2A part 1: buddy, page tables, segmentation, copy-on-write. Expected values derived by hand.
const B = require('../js/engines/buddy.js'), P = require('../js/engines/ptables.js'), S = require('../js/engines/segmentation.js'), C = require('../js/engines/cow.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const blocks = (f) => f.blocks.map((b) => b.start + ':' + b.size + (b.state === 'used' ? b.id : 'f'));

// ---- buddy: 64 total, min 4
let r = B.run({ total: 64, min: 4 }, 'alloc A 10\nalloc B 20\nalloc C 5\nfree A\nfree C');
eq('buddy ok', r.ok, true);
eq('after A(10→16): 16 A, 16 free, 32 free', blocks(r.frames[1]), ['0:16A', '16:16f', '32:32f']);
eq('after B(20→32)', blocks(r.frames[2]), ['0:16A', '16:16f', '32:32B']);
eq('after C(5→8)', blocks(r.frames[3]), ['0:16A', '16:8C', '24:8f', '32:32B']);
eq('free A: buddy 16@16 is split, no merge', blocks(r.frames[4]), ['0:16f', '16:8C', '24:8f', '32:32B']);
eq('free C: merges 8+8, then 16+16, stops at B', blocks(r.frames[5]), ['0:32f', '32:32B']);
eq('internal fragmentation after B only = 12', r.frames[5].stats.internal, 12);
eq('internal after A,B,C = 6+12+3', r.frames[3].stats.internal, 21);
eq('largest free after final = 32', r.frames[5].stats.largestFree, 32);
r = B.run({ total: 64, min: 4 }, 'alloc A 16\nalloc B 16\nalloc C 16\nalloc D 16\nfree A\nfree C\nalloc E 32');
eq('external fragmentation: 32 free but not a block', [r.frames[7].ok, r.frames[7].stats.free], [false, 32]);
eq('failed alloc leaves layout unchanged', blocks(r.frames[7]), blocks(r.frames[6]));
eq('too big request fails', B.run({ total: 64, min: 4 }, 'alloc A 65').frames[1].ok, false);
eq('free of unknown fails', B.run({ total: 64, min: 4 }, 'free X').frames[1].ok, false);
eq('duplicate name fails', B.run({ total: 64, min: 4 }, 'alloc A 4\nalloc A 4').frames[2].ok, false);
eq('non power of two total rejected', B.run({ total: 60, min: 4 }, 'alloc A 4').ok, false);
eq('bad line rejected', B.run({ total: 64, min: 4 }, 'grab A').ok, false);
eq('min size rounds: alloc 1 with min 4 uses 4', B.run({ total: 16, min: 4 }, 'alloc A 1').frames[1].blocks[0].size, 4);
for (let t = 0; t < 300; t++) { // random: blocks always tile memory, buddies aligned, all freed => one block
  const total = 64, names = []; let txt = '';
  for (let i = 0; i < 20; i++) { if (names.length && Math.random() < 0.45) { txt += 'free ' + names.splice(Math.floor(Math.random() * names.length), 1)[0] + '\n'; } else { const n = 'n' + i; names.push(n); txt += 'alloc ' + n + ' ' + (1 + Math.floor(Math.random() * 20)) + '\n'; } }
  const rr = B.run({ total, min: 2 }, txt); let ok = rr.ok;
  rr.frames.forEach((f) => { let at = 0; f.blocks.forEach((b) => { if (b.start !== at || b.start % b.size !== 0) ok = false; at += b.size; }); if (at !== total) ok = false; if (f.stats.used + f.stats.free !== total) ok = false; });
  const rest = names.map((n) => 'free ' + n).join('\n'); if (rest) { const r2 = B.run({ total, min: 2 }, txt + rest + '\n'); const last = r2.frames[r2.frames.length - 1]; if (last.blocks.length !== 1 || last.blocks[0].size !== total) ok = false; }
  if (!ok) { fail++; console.log('FAIL buddy random', txt); } else pass++;
}

// ---- page tables
eq('split 20 bits in 2 levels', P.splitBits(20, 2), [10, 10]);
eq('split 22 bits in 3 levels: top gets the remainder', P.splitBits(22, 3), [6, 8, 8]);
eq('split 36 bits in 4 levels', P.splitBits(36, 4), [9, 9, 9, 9]);
eq('split 20 in 1 level', P.splitBits(20, 1), [20]);
r = P.run({ vbits: 32, page: 4096, levels: 2, entry: 4, frames: 8 }, '0x00000000\n0x00001000\n0x00400000\n0xFFFFF000');
eq('page tables ok', r.ok, true);
eq('final: 1 root + 3 second-level = 4 tables', r.frames[4].stats.nodes, 4);
eq('multi-level bytes = 4 x 4096', r.frames[4].stats.bytes, 16384);
eq('flat table = 2^20 x 4', r.frames[4].stats.single, 4194304);
eq('first access creates both levels', r.frames[1].created, [1, 2]);
eq('second access (neighbour page) creates nothing', r.frames[2].created, []);
eq('0x00400000 splits as 1 / 0', r.frames[3].idx, [1, 0]);
eq('0xFFFFF000 splits as 1023 / 1023', r.frames[4].idx, [1023, 1023]);
eq('offset of 0x1234 is 0x234 = 564', P.run({ vbits: 32, page: 4096, levels: 2, entry: 4, frames: 8 }, '0x1234').frames[1].offset, 564);
eq('inverted table size = 8 frames x 8 bytes', r.frames[4].stats.inverted, 64);
eq('each new page takes the next frame', r.frames.slice(1).map((f) => f.frame), [0, 1, 2, 3]);
r = P.run({ vbits: 32, page: 4096, levels: 2, entry: 4, frames: 8 }, '0x1000\n0x1000');
eq('repeat access reuses the frame and creates nothing', [r.frames[2].isNew, r.frames[2].frame, r.frames[2].created], [false, 0, []]);
r = P.run({ vbits: 32, page: 4096, levels: 2, entry: 4, frames: 8 }, 'A 0x1000\nB 0x1000');
eq('two processes: separate trees = 4 tables', r.frames[2].stats.nodes, 4);
eq('same page number, different process → different frames', [r.frames[1].frame, r.frames[2].frame], [0, 1]);
r = P.run({ vbits: 48, page: 4096, levels: 4, entry: 8, frames: 8 }, '0x7FFFFFFFF000');
eq('48-bit 4-level: top index is 255 (address is 47 bits), others 511', r.frames[1].idx, [255, 511, 511, 511]);
eq('48-bit flat table = 2^36 x 8', r.frames[1].stats.single, Math.pow(2, 39));
r = P.run({ vbits: 16, page: 1024, levels: 1, entry: 2, frames: 2 }, '0x0\n0x400\n0x800');
eq('inverted table runs out of frames', r.frames[3].error, true);
eq('address beyond bits rejected', P.run({ vbits: 16, page: 1024, levels: 1, entry: 2, frames: 2 }, '0x10000').ok, false);
eq('non-power-of-two page rejected', P.run({ vbits: 32, page: 1000, levels: 2, entry: 4, frames: 8 }, '0x0').ok, false);
eq('too many levels rejected', P.run({ vbits: 14, page: 4096, levels: 4, entry: 4, frames: 8 }, '0x0').ok, false);
for (let t = 0; t < 200; t++) { // random: multi-level bytes never below one root, never above flat when levels=1 equal
  const lv = 1 + Math.floor(Math.random() * 4), txt = Array.from({ length: 10 }, () => '0x' + Math.floor(Math.random() * 0xFFFFFFFF).toString(16)).join('\n');
  const rr = P.run({ vbits: 32, page: 4096, levels: lv, entry: 4, frames: 64 }, txt); let ok = rr.ok && rr.bits.reduce((a, b) => a + b, 0) === 20;
  if (lv === 1) ok = ok && rr.frames[10].stats.bytes === rr.frames[10].stats.single;
  if (ok && rr.frames[10].stats.nodes < lv) ok = false;
  if (!ok) { fail++; console.log('FAIL ptable random', lv); } else pass++;
}

// ---- segmentation
const segs = 'code 1000 400 rx\ndata 2000 200 rw\nstack 3000 300 rw';
r = S.run({ phys: 4096 }, segs, 'code 0 x\ncode 399 x\ncode 400 x\ndata 50 w\ncode 10 w\nheap 0 r');
eq('seg ok', r.ok, true);
eq('code:0 → 1000', r.frames[1].phys, 1000);
eq('code:399 → 1399', r.frames[2].phys, 1399);
eq('code:400 is a limit fault', r.frames[3].result, 'fault-limit');
eq('data:50 → 2050', r.frames[4].phys, 2050);
eq('write to code is a protection fault', r.frames[5].result, 'fault-prot');
eq('unknown segment', r.frames[6].result, 'fault-seg');
eq('no overlap warnings', r.warnings, []);
eq('overlap detected', S.run({ phys: 4096 }, 'a 1000 500\nb 1300 500', 'a 0').warnings.length, 1);
eq('segment past end of memory warns', S.run({ phys: 1000 }, 'a 900 200', 'a 0').warnings.length, 1);
eq('hex base and limit', S.run({ phys: 4096 }, 'a 0x100 0x10', 'a 0xF').frames[1].phys, 271);
eq('bad segment line rejected', S.run({ phys: 4096 }, 'a 1', 'a 0').ok, false);
eq('duplicate segment rejected', S.run({ phys: 4096 }, 'a 1 2\na 3 4', 'a 0').ok, false);
eq('bad access rejected', S.run({ phys: 4096 }, 'a 1 2', 'a zz').ok, false);

// ---- copy on write
r = C.run({ frames: 12 }, 'start P0 3\nfork P0 P1\nread P1 0\nwrite P1 1\nwrite P0 1\nwrite P0 2');
eq('cow ok', r.ok, true);
eq('start uses frames 0,1,2', r.frames[1].procs[0].pages.map((p) => p.frame), [0, 1, 2]);
eq('fork: refs 2,2,2 and no extra frames', [r.frames[2].ref.slice(0, 3), r.frames[2].stats.used], [[2, 2, 2], 3]);
eq('fork: eager copy would need 6 frames', r.frames[2].stats.eager, 6);
eq('fork marks both read-only', r.frames[2].procs.map((p) => p.pages.every((e) => e.ro)), [true, true]);
eq('eager total stays 6 after one copy (4 used - 1 copy + 3)', r.frames[4].stats.eager, 6);
eq('after the forked child exits, eager baseline drops back to 4', C.run({ frames: 12 }, 'start P0 4\nfork P0 P1\nexit P1').frames[3].stats.eager, 4);
eq('read causes no copy', r.frames[3].stats.copies, 0);
eq('write by P1 copies page 1 into frame 3', [r.frames[4].procs[1].pages[1].frame, r.frames[4].stats.copies, r.frames[4].stats.used], [3, 1, 4]);
eq('old frame 1 now has one user', r.frames[4].ref[1], 1);
eq('P0 writing the now-unshared page needs no copy', [r.frames[5].stats.copies, r.frames[5].stats.cowFaults, r.frames[5].procs[0].pages[1].ro], [1, 2, false]);
eq('P0 write to page 2 (still shared) copies', r.frames[6].stats.copies, 2);
r = C.run({ frames: 12 }, 'start P0 4\nfork P0 P1\nexit P1\nwrite P0 0');
eq('exit releases references', r.frames[3].ref.slice(0, 4), [1, 1, 1, 1]);
eq('write after child exit copies nothing', r.frames[4].stats.copies, 0);
eq('out of frames at start', C.run({ frames: 2 }, 'start P0 3').frames[1].ok, false);
eq('cow into full memory fails cleanly', C.run({ frames: 2 }, 'start P0 2\nfork P0 P1\nwrite P1 0').frames[3].ok, false);
eq('unknown process', C.run({ frames: 4 }, 'read X 0').frames[1].ok, false);
eq('page out of range', C.run({ frames: 4 }, 'start P 2\nread P 5').frames[2].ok, false);
eq('bad line rejected', C.run({ frames: 4 }, 'spawn P').ok, false);
for (let t = 0; t < 300; t++) { // random: refcount of each frame = number of mappings; used frames never exceed total
  const names = ['P0'], ops = ['start P0 4']; let n = 1;
  for (let i = 0; i < 20; i++) { const x = Math.random(); if (x < 0.2 && n < 4) { const c = 'P' + n++; ops.push('fork ' + names[Math.floor(Math.random() * names.length)] + ' ' + c); names.push(c); } else ops.push((Math.random() < 0.5 ? 'write ' : 'read ') + names[Math.floor(Math.random() * names.length)] + ' ' + Math.floor(Math.random() * 4)); }
  const rr = C.run({ frames: 32 }, ops.join('\n')); let ok = rr.ok;
  rr.frames.forEach((f) => { const cnt = new Array(32).fill(0); f.procs.forEach((p) => p.pages.forEach((e) => cnt[e.frame]++)); if (JSON.stringify(cnt) !== JSON.stringify(f.ref)) ok = false; if (f.stats.used > 32) ok = false; });
  if (!ok) { fail++; console.log('FAIL cow random', ops.join(';')); } else pass++;
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
