// Tier 3: journaling and crash recovery. Hand-derived crash outcomes plus random-script invariants.
const J = require('../js/engines/journal.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const prep = (script, mode, order) => { const r = J.prepare(script, mode, order || 'data-first'); if (!r.ok) throw new Error(r.errors.join('|')); return r.built; };
const kinds = (b) => J.sweep(b).points.map((p) => p.kind + (p.codes.length ? ':' + p.codes.join('+') : ''));
const S2 = 'create A\nappend A 2';

// ---- parsing
eq('empty script', J.prepare('', 'none').ok, false);
eq('unknown operation', J.parse('format A').errors, ['Line 1: unknown operation "format". Use create, append or delete.']);
eq('append to a missing file', /does not exist/.test(J.parse('append A 1').errors[0]), true);
eq('create twice', /already exists/.test(J.parse('create A\ncreate A').errors[0]), true);
eq('block count limit', /from 1 to 4/.test(J.parse('create A\nappend A 9').errors[0]), true);
eq('out of space is reported (16 blocks used, one more requested)', J.parse('create A\nappend A 4\nappend A 4\nappend A 4\nappend A 4\nappend A 1').errors, ['Line 6: only 0 free blocks left on the 16-block disk.']);
eq('bad file name', J.parse('create 9x').errors.length, 1);
eq('operation limit', J.parse(Array.from({ length: 8 }, (_, i) => 'create F' + i).join('\n')).errors.length, 1);
eq('the plan allocates the lowest free blocks', J.parse('create A\nappend A 2\ncreate B\nappend B 1').plan.filter((p) => p.op === 'append').map((p) => p.blocks), [[0, 1], [2]]);
eq('a deleted file\'s blocks are reused by the next append', J.parse('create A\nappend A 2\ndelete A\ncreate B\nappend B 2').plan.filter((p) => p.op === 'append').map((p) => p.blocks), [[0, 1], [0, 1]]);

// ---- step counts (hand-counted from the protocol)
eq('none: create (2 writes) + append 2 (2 data + bitmap + inode) = 6 steps', prep(S2, 'none').steps.length, 6);
eq('ordered: create = begin + 2 journal + commit + 2 checkpoint + free = 7; append = 2 data + 7 = 9', prep(S2, 'ordered').steps.length, 16);
eq('full: append = begin + 4 journal + commit + 4 checkpoint + free = 11, create = 7', prep(S2, 'full').steps.length, 18);
eq('write order inside ordered mode: data first, then begin', prep(S2, 'ordered').steps.slice(7, 10).map((s) => s.type), ['write', 'write', 'jbegin']);
eq('write order inside writeback: begin, journal, commit, checkpoint, data, free', prep('create A\nappend A 1', 'writeback').steps.slice(7).map((s) => s.type), ['jbegin', 'jblock', 'jblock', 'jcommit', 'write', 'write', 'write', 'jfree']);

// ---- no journal, hand-derived (order data, bitmap, inode, directory)
//   create A: inode(A), directory ; append A 2: D0, D1, bitmap, inode(A)
eq('none/data-first: crash after the inode but before the directory entry leaves an orphan inode', kinds(prep(S2, 'none'))[1], 'corrupt:orphan');
eq('none/data-first: crash after the bitmap but before the inode leaks the blocks', kinds(prep(S2, 'none'))[5], 'corrupt:leak');
eq('none/data-first: all other crash points are consistent', kinds(prep(S2, 'none')), ['clean', 'corrupt:orphan', 'clean', 'old', 'old', 'corrupt:leak', 'clean']);
eq('none/data-first: only 2 of 7 crash points are corrupt', J.sweep(prep(S2, 'none')).bad, 2);
// ---- no journal, metadata first (order directory, inode, bitmap, data)
eq('none/meta-first: directory entry written first -> entry points at an empty inode', kinds(prep(S2, 'none', 'meta-first'))[1], 'corrupt:baddir');
eq('none/meta-first: inode points at blocks the bitmap calls free and that hold no data', kinds(prep(S2, 'none', 'meta-first'))[3], 'corrupt:dangling+garbage');
eq('none/meta-first: after the bitmap the blocks are allocated but the data is still stale', kinds(prep(S2, 'none', 'meta-first'))[4], 'corrupt:garbage');
eq('none/meta-first: the sweep is worse than data-first', J.sweep(prep(S2, 'none', 'meta-first')).bad > J.sweep(prep(S2, 'none')).bad, true);
// ---- full data journaling: all-or-nothing, with the commit as the dividing line
let b = prep(S2, 'full'); const sw = J.sweep(b);
eq('full: no crash point is corrupt', sw.bad, 0);
// steps of the append: 8 begin, 9-10 journal the data, 11-12 journal the metadata, 13 commit; so k<13 old, k>=13 new
eq('full: crash with the commit record not yet written is old, with it written is new', [J.crashAt(b, 12).kind, J.crashAt(b, 13).kind, J.crashAt(b, 14).kind], ['old', 'new', 'new']);
eq('full: replay writes the data too, so the new state has real data', (() => { const c = J.crashAt(b, 13); return [c.post.data[0].file, c.post.data[1].file, c.violations.length]; })(), ['A', 'A', 0]);
eq('full: recovery actions say REPLAY for a committed transaction and DISCARD for an open one', [J.crashAt(b, 13).actions[0].replay, J.crashAt(b, 12).actions[0].replay, /DISCARD/.test(J.crashAt(b, 12).actions[0].text)], [true, false, true]);
eq('full: after replay the journal is empty', J.crashAt(b, 13).post.journal, []);
// ---- ordered mode: metadata structure safe AND no garbage
b = prep(S2, 'ordered');
eq('ordered: no crash point is corrupt', J.sweep(b).bad, 0);
eq('ordered: data written before the commit; a crash between data and commit loses the op (old)', [J.crashAt(b, 9).kind, J.crashAt(b, 10).kind], ['old', 'old']);
eq('ordered: after the commit the new file has its data', (() => { const c = J.crashAt(b, 13); return [c.kind, c.post.data[0].file, c.violations.length]; })(), ['new', 'A', 0]);
// ---- writeback mode: structure safe, data not
b = prep(S2, 'writeback');
eq('writeback: crash after the commit but before the data replays metadata that points at stale blocks', (() => { const c = J.crashAt(b, 11); return [c.kind, c.violations.map((v) => v.code).sort()]; })(), ['corrupt', ['garbage', 'garbage']]);
eq('writeback: the damage is only ever "garbage", never a structural error', J.sweep(b).points.filter((p) => p.kind === 'corrupt').every((p) => p.codes.every((c) => c === 'garbage')), true);
eq('writeback: 4 crash points corrupt', J.sweep(b).bad, 4);
// ---- stale data exposure after delete + reuse
b = prep('create A\nappend A 2\ndelete A\ncreate B\nappend B 2', 'writeback');
eq('reuse in writeback mode: B can read A\'s old data', J.sweep(b).points.some((p) => p.kind === 'corrupt') && (() => { for (let k = 0; k < b.states.length; k++) { const c = J.crashAt(b, k); if (c.violations.some((v) => /data of file A/.test(v.text))) return true; } return false; })(), true);
eq('reuse in ordered mode: never corrupt', J.sweep(prep('create A\nappend A 2\ndelete A\ncreate B\nappend B 2', 'ordered')).bad, 0);

// ---- recovery properties
eq('recovery is idempotent: recovering a recovered disk changes nothing', (() => { const b2 = prep('create A\nappend A 2\ncreate B', 'full'); return b2.states.every((_, k) => { const r1 = J.recover(b2.states[k]), r2 = J.recover(r1.post); return JSON.stringify(r1.post) === JSON.stringify(r2.post); }); })(), true);
eq('with no crash (last step) the disk equals the logical model and is clean, in every mode', J.MODES.map((m) => { const bb = prep('create A\nappend A 3\ncreate B\nappend B 1\ndelete A', m.id); const c = J.crashAt(bb, bb.steps.length); return [c.kind, c.opsSurvived]; }), J.MODES.map(() => ['clean', 5]));
eq('crash at step 0 is always the empty disk', J.MODES.map((m) => J.crashAt(prep(S2, m.id), 0).kind), ['clean', 'clean', 'clean', 'clean']);

// ---- random scripts: the invariants of the protocols
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function randomScript(seed) {
  const R = rng(seed), lines = [], files = new Set(); let n = 0, used = 0;
  for (let i = 0; i < 5; i++) {
    const r = R();
    if (!files.size || r < 0.3) { const f = 'F' + n++; files.add(f); lines.push('create ' + f); }
    else if (r < 0.75 && used < 10) { const f = [...files][Math.floor(R() * files.size)], k = 1 + Math.floor(R() * 3); used += k; lines.push('append ' + f + ' ' + k); }
    else { const f = [...files][Math.floor(R() * files.size)]; files.delete(f); lines.push('delete ' + f); used = 0; /* conservative: blocks were freed */ lines.push('# deleted ' + f); }
  }
  return lines.join('\n');
}
let tested = 0, fullOk = 0, orderedOk = 0, wbOk = 0, noneBad = 0, noneAny = 0, mono = 0, endClean = 0;
for (let seed = 1; seed <= 150; seed++) {
  const sc = randomScript(seed); const r0 = J.parse(sc); if (!r0.ok) continue; tested++;
  const f = prep(sc, 'full'), o = prep(sc, 'ordered'), w = prep(sc, 'writeback');
  if (J.sweep(f).bad === 0) fullOk++; else console.log('FAIL full corrupt for seed', seed, sc);
  if (J.sweep(o).bad === 0) orderedOk++; else console.log('FAIL ordered corrupt for seed', seed, sc);
  if (J.sweep(w).points.every((p) => p.kind !== 'corrupt' || p.codes.every((c) => c === 'garbage')) && J.sweep(w).points.every((p) => p.kind !== 'partial')) wbOk++; else console.log('FAIL writeback structural damage for seed', seed, sc);
  // monotone: in a journaling mode the number of operations that survive never decreases as the crash point moves later
  let prev = 0, ok = true; for (let k = 0; k < f.states.length; k++) { const s = J.crashAt(f, k).opsSurvived; if (s < prev) ok = false; prev = s; } if (ok) mono++;
  if (['full', 'ordered', 'writeback'].every((m) => { const bb = prep(sc, m); return J.crashAt(bb, bb.steps.length).kind === 'clean'; })) endClean++;
  noneAny++; if (J.sweep(prep(sc, 'none', 'meta-first')).bad > 0) noneBad++;
}
eq('random: enough scripts were tested', tested > 100, true);
eq('random: full data journaling is never corrupt at any crash point', fullOk, tested);
eq('random: ordered journaling is never corrupt at any crash point', orderedOk, tested);
eq('random: writeback never breaks structure, only data (garbage)', wbOk, tested);
eq('random: surviving operations never go backwards as the crash moves later (full journal)', mono, tested);
eq('random: finishing without a crash leaves a clean disk in every journaling mode', endClean, tested);
eq('random: the unsafe metadata-first order is corrupt somewhere in every script', noneBad, noneAny);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
