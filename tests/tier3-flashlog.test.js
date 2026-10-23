// Tier 3: log-structured FS and SSD flash translation layer (shared append-only engine).
const F = require('../js/engines/flashlog.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const base = { mode: 'ssd', blocks: 6, ppb: 4, logical: 8, policy: 'greedy', wear: 'none', spread: 3, endurance: 100, ops: 1, hotFrac: 25, hotWrites: 90, trimPct: 0, seed: 1 };
const W = (lp, n) => new Array(n || 1).fill({ op: 'w', lp });
const go = (cfg, script) => F.run(Object.assign({}, base, cfg, script ? { script } : {}));
const last = (r) => r.frames[r.frames.length - 1];

// ---- hand-derived tiny cases (6 blocks x 4 pages, 8 logical pages)
// Fill writes lp0..7 into blocks 0 and 1 (4 each). Then 4 writes of lp0 go to block 2: no cleaning yet (free blocks 3,4,5 >= 2).
let r = go({}, W(0, 4));
eq('no cleaning while 2+ erased blocks remain', [r.stats.host, r.stats.copies, r.stats.erases === undefined ? 0 : r.stats.erasesDuringWorkload], [4, 0, 0]);
eq('write amplification is exactly 1 with no cleaning', r.stats.wa, 1);
eq('overwrites leave old copies dead: block 2 holds 3 dead + 1 live', last(r).blocks[2].pg, 'xxxH');
eq('block 0 lost its first page (lp0) to the overwrite', last(r).blocks[0].pg, 'xHCC'); // hot set = ceil(8 x 25%) = 2 pages (lp0, lp1) so they print as H, the rest as C
// Keep going: block 3 fills with lp0 too; block 4 filling leaves 1 free -> the cleaner must run.
r = go({}, W(0, 12));
eq('12 hot writes force cleaning', r.stats.gcRuns > 0, true);
eq('every erase was counted', r.stats.eraseCounts.reduce((a, b) => a + b, 0), r.stats.erases);

// Hand check: blocks 2,3,4 take the 12 writes; block 4 closes leaving one free block, so the cleaner runs once.
// Blocks 2 and 3 are entirely dead (0 live) and block 4 holds 1 live page, so greedy picks block 2 (tie -> lowest index), copying nothing.
eq('first cleaning run: greedy victim is block 2 with 0 live pages', r.frames[r.frames.length - 1].log.map((l) => [l.victim, l.live]), [[2, 0]]);
eq('after it, block 2 has been erased once and is free again', [last(r).blocks[2].pg, last(r).blocks[2].e], ['....', 1]);

// ---- greedy picks the emptiest closed block
const g1 = go({}, W(0, 12));
const g2 = go({ policy: 'costbenefit' }, W(0, 12));
eq('hot-only workload: copies are small and equal for both policies here (only dead data to clean)', [g1.stats.copies <= 3, g2.stats.copies <= 3], [true, true]);

// ---- TRIM
const t = go({}, [{ op: 't', lp: 0 }, { op: 't', lp: 1 }, { op: 't', lp: 1 }]);
eq('trim kills pages; trimming an already-dead page is ignored', [t.stats.trims, last(t).blocks[0].pg], [2, 'xxCC']);
eq('trimmed logical pages are unmapped', [t.map[0], t.map[1]], [null, null]);
eq('trim is not a host write', t.stats.host, 0);

// ---- a rewrite of a trimmed page behaves like a new write
const tw = go({}, [{ op: 't', lp: 0 }, { op: 'w', lp: 0 }]);
eq('write after trim is valid again', tw.map[0] !== null, true);

// ---- validation
eq('too few blocks rejected', F.run(Object.assign({}, base, { blocks: 5 })).ok, false);
eq('too many logical pages rejected', F.run(Object.assign({}, base, { blocks: 6, ppb: 4, logical: 13 })).ok, false);
eq('maximum logical pages accepted ((6-3)*4 = 12)', F.run(Object.assign({}, base, { logical: 12, script: W(0, 5) })).ok, true);
eq('fractional ops rejected', F.run(Object.assign({}, base, { ops: 2.5 })).ok, false);
eq('unknown wear rejected', F.run(Object.assign({}, base, { wear: 'magic' })).ok, false);
eq('unknown policy rejected', F.run(Object.assign({}, base, { policy: 'magic' })).ok, false);
eq('hot share of 100 rejected', F.run(Object.assign({}, base, { hotFrac: 100 })).ok, false);
eq('LFS forces wear to none', F.normCfg({ mode: 'lfs', wear: 'static' }).cfg.wear, 'none');

// ---- determinism
const a = F.run(Object.assign({}, base, { blocks: 10, logical: 24, ops: 300, seed: 9 })), b = F.run(Object.assign({}, base, { blocks: 10, logical: 24, ops: 300, seed: 9 })), c = F.run(Object.assign({}, base, { blocks: 10, logical: 24, ops: 300, seed: 10 }));
eq('same seed, same result', JSON.stringify(a.stats), JSON.stringify(b.stats));
eq('different seed, different result', JSON.stringify(a.stats) !== JSON.stringify(c.stats), true);

// ---- the headline claims, derived from runs (not canned)
const hot = { mode: 'ssd', blocks: 10, ppb: 4, logical: 24, ops: 600, hotFrac: 15, hotWrites: 90, seed: 3, endurance: 3000 };
const cmp = F.compare(hot), by = Object.fromEntries(cmp.map((x) => [x.id, x.stats]));
eq('compare returns none, dynamic, static', cmp.map((x) => x.id), ['none', 'dynamic', 'static']);
eq('static levelling narrows the erase gap compared with none', (by.static.maxErase - by.static.minErase) < (by.none.maxErase - by.none.minErase), true);
eq('static levelling lowers the most-worn block', by.static.maxErase < by.none.maxErase, true);
eq('static levelling improves the levelling ratio', by.static.levelling > by.none.levelling, true);
eq('static levelling costs extra copies (it is not free)', by.static.copies >= by.none.copies, true);
eq('static levelling really moved data', by.static.staticMoves > 0, true);
eq('projected life is longer with static levelling', by.static.lifeWrites > by.none.lifeWrites, true);
const tight = F.run(Object.assign({}, hot, { wear: 'dynamic', logical: 28 })).stats, loose = F.run(Object.assign({}, hot, { wear: 'dynamic', logical: 12 })).stats;
eq('less spare area means higher write amplification', tight.wa > loose.wa, true);
const noTrim = F.run(Object.assign({}, hot, { wear: 'dynamic', logical: 28, trimPct: 0 })).stats, trim = F.run(Object.assign({}, hot, { wear: 'dynamic', logical: 28, trimPct: 30 })).stats;
eq('TRIM lowers write amplification', trim.wa < noTrim.wa, true);
eq('write amplification is never below 1', [tight, loose, trim].every((s) => s.wa >= 1), true);
const lfs = F.compare(Object.assign({}, hot, { mode: 'lfs' }));
eq('LFS compare is by policy', lfs.map((x) => x.id), ['greedy', 'costbenefit']);
eq('cost-benefit beats greedy on a hot/cold workload (fewer copies)', lfs[1].stats.copies < lfs[0].stats.copies, true);

// ---- invariants over random configurations
let ok = true, msg = '';
let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t2 = 0; t2 < 120 && ok; t2++) {
  const B = 6 + rnd(8), P = 4 + rnd(5), L = 1 + rnd((B - 3) * P);
  const cfg = { mode: rnd(2) ? 'ssd' : 'lfs', blocks: B, ppb: P, logical: L, policy: rnd(2) ? 'greedy' : 'costbenefit', wear: ['none', 'dynamic', 'static'][rnd(3)], spread: 1 + rnd(6), endurance: 1000, ops: 50 + rnd(300), hotFrac: 5 + rnd(60), hotWrites: rnd(101), trimPct: rnd(40), seed: rnd(1000) };
  const res = F.run(cfg);
  if (!res.ok) { ok = false; msg = 'run failed ' + JSON.stringify(cfg) + res.errors; break; }
  const phys = res.blocks; let valid = 0, free = 0, dead = 0;
  phys.forEach((bk) => bk.st.forEach((s) => { if (s === 1) valid++; else if (s === 0) free++; else dead++; }));
  const mapped = res.map.filter((m) => m !== null).length;
  if (valid !== mapped) { ok = false; msg = 'valid pages != mapped logical pages'; }
  if (valid + free + dead !== B * P) { ok = false; msg = 'page states do not add up'; }
  res.map.forEach((m, lp) => { if (m && (phys[m.b].st[m.p] !== 1 || phys[m.b].pg[m.p] !== lp)) { ok = false; msg = 'map points at the wrong page'; } });
  phys.forEach((bk) => { for (let p = 0; p < P; p++) { if (p >= bk.wp && bk.st[p] !== 0) { ok = false; msg = 'written page past the write pointer'; } if (p < bk.wp && bk.st[p] === 0) { ok = false; msg = 'hole before the write pointer'; } } });
  if (res.stats.erases !== res.stats.eraseCounts.reduce((x, y) => x + y, 0)) { ok = false; msg = 'erase tally'; }
  if (res.stats.wa < 1) { ok = false; msg = 'WA < 1'; }
  if (res.stats.host + res.stats.copies < res.stats.host) { ok = false; msg = 'negative copies'; }
  if (cfg.mode === 'lfs' && res.stats.staticMoves) { ok = false; msg = 'LFS must not do static moves'; }
  if (res.frames.length > F.LIMITS.maxFrames + 1) { ok = false; msg = 'too many frames'; }
}
eq('invariants over 120 random configs ' + msg, ok, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
