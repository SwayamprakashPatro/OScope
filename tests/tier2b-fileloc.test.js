// Tier 2B: file allocation. Layouts and read costs derived by hand.
const F = require('../js/engines/fileloc.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const B = { method: 'contiguous', blocks: 16, blockKB: 1, ptrs: 4, direct: 3 };
const go = (o, t) => F.run(Object.assign({}, B, o), t);
const owners = (f) => f.disk.map((b) => (b ? b.owner + (b.kind === 'meta' ? '*' : '') : '.')).join('');

// ---- contiguous
let r = go({}, 'create A 4\ncreate B 3\ncreate C 4\ndelete B\ncreate D 8\nread A 3');
eq('contiguous layout A,B,C', owners(r.frames[3]), 'AAAABBBCCCC.....');
eq('delete B leaves a hole', owners(r.frames[4]), 'AAAA...CCCC.....');
eq('create D 8 fails: 8 free in total (16 - 4 - 4) but longest run 5', [r.frames[5].ok, r.frames[5].stats.free, r.frames[5].stats.longestFree], [false, 8, 5]);
eq('reading block 3 costs 1 disk read', r.frames[6].read.cost.disk, 1);
eq('contiguous has no metadata blocks', r.frames[3].stats.meta, 0);
r = go({}, 'create A 4\ncreate B 3\ncreate C 4\ndelete B\ncreate D 5');
eq('first fit puts D in the first hole that fits (the 5-run at 11)', owners(r.frames[5]), 'AAAA...CCCCDDDDD');
r = go({}, 'create A 3\ncreate B 3\nappend A 2');
eq('append blocked by neighbour', r.frames[3].ok, false);
r = go({}, 'create A 3\nappend A 2');
eq('append extends in place when free', [r.frames[2].ok, owners(r.frames[2]).slice(0, 6)], [true, 'AAAAA.']);
r = go({ blockKB: 4 }, 'create A 10');
eq('10 KB with 4 KB blocks = 3 blocks, 2 KB wasted', [r.frames[1].files[0].data.length, r.frames[1].stats.waste], [3, 2]);

// ---- linked
r = go({ method: 'linked' }, 'create A 4\ncreate B 3\ncreate C 4\ndelete B\ncreate D 8\nread A 3');
eq('linked D succeeds using the hole and the tail', [r.frames[5].ok, r.frames[5].files.find((f) => f.name === 'D').data], [true, [4, 5, 6, 11, 12, 13, 14, 15]]);
eq('linked read of block 3 = 4 disk reads', r.frames[6].read.cost.disk, 4);
eq('linked read of block 0 = 1', go({ method: 'linked' }, 'create A 3\nread A 0').frames[2].read.cost.disk, 1);

// ---- FAT
r = go({ method: 'fat' }, 'create A 3\ncreate B 2');
eq('FAT chain A: 0→1→2→EOF', r.frames[2].fat.slice(0, 5), [1, 2, 'EOF', 4, 'EOF']);
eq('FAT read of block 2 = 1 disk read (table cached)', go({ method: 'fat' }, 'create A 3\nread A 2').frames[2].read.cost.disk, 1);
r = go({ method: 'fat' }, 'create A 3\ndelete A');
eq('FAT entries cleared on delete', r.frames[2].fat.slice(0, 3), [null, null, null]);

// ---- indexed
r = go({ method: 'indexed' }, 'create A 4');
eq('indexed: index block 0, data 1-4', owners(r.frames[1]), 'A*AAAA...........');
eq('indexed read = 2 disk reads', go({ method: 'indexed' }, 'create A 4\nread A 2').frames[2].read.cost.disk, 2);
eq('indexed: file larger than one index block rejected', go({ method: 'indexed' }, 'create A 5').frames[1].ok, false);
r = go({ method: 'indexed' }, 'create A 3\nappend A 1');
eq('indexed append adds one data block, no new index', [r.frames[2].stats.used, r.frames[2].stats.meta], [5, 1]);

// ---- inode (D=3, P=4)
eq('meta blocks: 3 blocks → just the inode', F.meta('inode', 3, 4, 3), 1);
eq('meta blocks: 5 blocks → inode + indirect', F.meta('inode', 5, 4, 3), 2);
eq('meta blocks: 12 blocks → inode + indirect + double + 2 second-level', F.meta('inode', 12, 4, 3), 5);
eq('too big for inode', F.meta('inode', 3 + 4 + 16 + 1, 4, 3), null);
r = go({ method: 'inode', blocks: 32 }, 'create A 5');
eq('inode: file of 5 uses 7 blocks (inode, indirect, 5 data)', [r.frames[1].stats.used, r.frames[1].stats.meta], [7, 2]);
r = go({ method: 'inode', blocks: 32 }, 'create A 12\nread A 0\nread A 3\nread A 6\nread A 11');
eq('inode read costs 2 (direct), 3 (indirect), 3 (last indirect = block 6), 4 (double indirect)', r.frames.slice(2).map((f) => f.read.cost.disk), [2, 3, 3, 4]);
eq('inode file of 12 uses 17 blocks', r.frames[1].stats.used, 17);
r = go({ method: 'inode', blocks: 32 }, 'create A 3\nappend A 2');
eq('inode append crossing the direct limit adds an indirect block', [r.frames[2].stats.used, r.frames[2].stats.meta], [7, 2]);

// ---- errors and general
eq('read past the end', go({}, 'create A 2\nread A 5').frames[2].ok, false);
eq('delete of missing', go({}, 'delete X').frames[1].ok, false);
eq('duplicate create', go({}, 'create A 2\ncreate A 2').frames[2].ok, false);
eq('not enough space', go({ method: 'linked' }, 'create A 20').frames[1].ok, false);
eq('bad line', go({}, 'make A').ok, false);
eq('bad method', go({ method: 'zzz' }, 'create A 1').ok, false);
for (let t = 0; t < 400; t++) { // random: no block has two owners; used + free = total; deleting everything empties the disk
  const method = ['contiguous', 'linked', 'indexed', 'fat', 'inode'][t % 5], names = [], lines = [];
  for (let i = 0; i < 14; i++) { const x = Math.random(); if (names.length && x < 0.3) lines.push('delete ' + names.splice(Math.floor(Math.random() * names.length), 1)[0]); else if (names.length && x < 0.45) lines.push('append ' + names[0] + ' ' + (1 + Math.floor(Math.random() * 3))); else { const n = 'f' + i; names.push(n); lines.push('create ' + n + ' ' + (1 + Math.floor(Math.random() * 6))); } }
  const rr = go({ method, blocks: 32 }, lines.join('\n')); let ok = rr.ok;
  rr.frames.forEach((f) => { const seen = new Set(); f.files.forEach((fl) => fl.data.concat(fl.meta).forEach((b) => { if (seen.has(b)) ok = false; seen.add(b); if (!f.disk[b] || f.disk[b].owner !== fl.name) ok = false; })); if (seen.size !== f.stats.used || f.stats.used + f.stats.free !== 32) ok = false; });
  const r2 = go({ method, blocks: 32 }, lines.concat(names.map((n) => 'delete ' + n)).join('\n')); if (r2.frames[r2.frames.length - 1].stats.used !== 0) ok = false;
  if (!ok) { fail++; console.log('FAIL random', method, lines.join(';')); } else pass++;
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
