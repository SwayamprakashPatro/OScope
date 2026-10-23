// Tier 4: MSI / MESI cache coherence. State sequences and counts derived by hand from the protocol tables.
const M = require('../js/engines/mesi.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (cfg, text) => M.run(cfg, text);
const col = (r, cpu, a) => r.frames.map((f) => f.caches[cpu][a].s + (f.caches[cpu][a].v == null ? '' : f.caches[cpu][a].v));
const memv = (r, a) => r.frames.map((f) => f.mem[a]);

// ---- one line, MESI, 2 CPUs: read, write, remote read, remote write, read again
const s1 = 'P0 read A\nP0 write A 5\nP1 read A\nP1 write A 7\nP0 read A';
const r = go({ proto: 'mesi', cpus: 2, lines: 1 }, s1);
eq('P0 states: I, E (alone), M (silent write), S (downgraded), I (invalidated), S (re-read)', col(r, 0, 0), ['I', 'E0', 'M5', 'S5', 'I', 'S7']);
eq('P1 states: I, I, I, S (flush supplied 5), M (upgrade), S', col(r, 1, 0), ['I', 'I', 'I', 'S5', 'M7', 'S7']);
eq('memory: stale 0 until the flush (5), then the second flush (7)', memv(r, 0), [0, 0, 0, 5, 5, 7]);
eq('counts: 3 BusRd + 1 BusUpgr = 4 bus transactions', [r.stats.BusRd, r.stats.BusUpgr, r.stats.BusRdX, r.stats.bus], [3, 1, 0, 4]);
eq('counts: 2 write-backs, 2 cache-to-cache transfers, 1 invalidation, 1 memory read', [r.stats.writebacks, r.stats.c2c, r.stats.invalidations, r.stats.memReads], [2, 2, 1, 1]);
eq('counts: 2 hits (the E->M write and the S write), 3 misses', [r.stats.hits, r.stats.misses], [2, 3]);
eq('the last read is the one coherence miss; the first two misses are cold', [r.stats.coherence, r.stats.cold], [1, 2]);
eq('the silent E->M write generated no bus traffic', r.frames[2].bus, []);
// ---- the same script under MSI needs one extra bus transaction (the BusUpgr on the first write)
const m = go({ proto: 'msi', cpus: 2, lines: 1 }, s1);
eq('MSI: alone and clean is still just Shared', col(m, 0, 0).slice(0, 2), ['I', 'S0']);
eq('MSI: the first write now needs a BusUpgr (no free E->M)', m.frames[2].bus.length, 1);
eq('MSI: 3 BusRd + 2 BusUpgr = 5 transactions, one more than MESI', [m.stats.bus, r.stats.bus], [5, 4]);
// ---- write misses (BusRdX)
const w = go({ proto: 'mesi', cpus: 2, lines: 1 }, 'P0 write A 3\nP1 write A 4');
eq('write miss: P0 Modified with no other copy', col(w, 0, 0)[1], 'M3');
eq('write miss: P1\'s BusRdX flushes P0\'s value to memory and invalidates it', [col(w, 0, 0)[2], col(w, 1, 0)[2], memv(w, 0)[2]], ['I', 'M4', 3]);
eq('write miss counts: 2 BusRdX, 1 write-back, 1 cache-to-cache, 1 invalidation', [w.stats.BusRdX, w.stats.writebacks, w.stats.c2c, w.stats.invalidations], [2, 1, 1, 1]);
// ---- read sharing
const rs = go({ proto: 'mesi', cpus: 3, lines: 1 }, 'init A 42\nP0 read A\nP1 read A\nP2 read A\nP0 read A');
eq('read sharing: E, then S for everyone', [col(rs, 0, 0)[1], col(rs, 0, 0)[2], col(rs, 1, 0)[2], col(rs, 2, 0)[3]], ['E42', 'S42', 'S42', 'S42']);
eq('read sharing: the final re-read hits (3 bus transactions for 4 reads)', [rs.stats.bus, rs.stats.hits], [3, 1]);
eq('read sharing: E to S transfer is cache-to-cache without a write-back', [rs.stats.c2c, rs.stats.writebacks], [1, 0]);
// ---- ping-pong
const pp = go({ proto: 'mesi', cpus: 2, lines: 1 }, 'P0 write A 1\nP1 write A 2\nP0 write A 3\nP1 write A 4');
eq('ping-pong: every write is a miss and a bus transaction', [pp.stats.misses, pp.stats.bus, pp.stats.hits], [4, 4, 0]);
eq('ping-pong: all but the first two are coherence misses', pp.stats.coherence, 2);
// ---- independent lines do not interfere
const two = go({ proto: 'mesi', cpus: 2, lines: 2 }, 'P0 write A 1\nP1 write B 1\nP0 write A 2\nP1 write B 2');
eq('separate lines: after the first write each CPU keeps hitting', [two.stats.misses, two.stats.hits, two.stats.invalidations], [2, 2, 0]);
// ---- init and read values
eq('init sets memory', go({ proto: 'mesi', cpus: 2, lines: 2 }, 'init B 9\nP0 read B').frames[1].caches[0][1].v, 9);
eq('a read returns the last value written (nothing flagged)', [r.badReads.length, r.violations.length], [0, 0]);
// ---- validation
const bad = (t, c) => go(c || { cpus: 2, lines: 1 }, t);
eq('empty script rejected', bad('').ok, false);
eq('unknown CPU', bad('P5 read A').errors[0].includes('not a CPU'), true);
eq('unknown line', bad('P0 read C').errors[0].includes('not a line'), true);
eq('write needs a value', bad('P0 write A').errors[0].includes('needs the value'), true);
eq('read takes no value', bad('P0 read A 3').errors[0].includes('no value'), true);
eq('init after an operation rejected', bad('P0 read A\ninit A 3').errors[0].includes('before the first'), true);
eq('bad verb', bad('P0 jump A').errors[0].includes('read or write'), true);
eq('cpus out of range', go({ cpus: 7, lines: 1 }, 'P0 read A').ok, false);
eq('unknown protocol', go({ proto: 'moesi', cpus: 2, lines: 1 }, 'P0 read A').ok, false);
eq('too many ops', go({ cpus: 2, lines: 1 }, 'P0 read A\n'.repeat(101)).ok, false);
eq('value limit', bad('P0 write A 10000').ok, false);
eq('comments and blank lines are fine', bad('# hi\n\nP0 read A # ok').ok, true);

// ---- random scripts: the invariants must hold at every step, for both protocols; MESI never needs MORE bus transactions than MSI
let ok = true, msg = '', seed = 31; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 500 && ok; t++) {
  const cpus = 2 + rnd(3), lines = 1 + rnd(4), rows = [];
  for (let i = 0; i < 1 + rnd(40); i++) rows.push('P' + rnd(cpus) + (rnd(2) ? ' read ' : ' write ') + 'ABCD'[rnd(lines)]);
  const text = rows.map((x) => (x.includes('write') ? x + ' ' + rnd(100) : x)).join('\n');
  const a = go({ proto: 'mesi', cpus, lines }, text), b = go({ proto: 'msi', cpus, lines }, text);
  if (!a.ok || !b.ok) { ok = false; msg = 'run failed ' + (a.errors || b.errors); break; }
  for (const x of [a, b]) {
    if (x.violations.length || x.badReads.length) { ok = false; msg = x.cfg.proto + ' ' + x.violations.concat(x.badReads)[0] + '\n' + text; }
    const s = x.stats; if (s.hits + s.misses !== s.ops) { ok = false; msg = 'hits + misses != ops'; }
    if (s.cold + s.coherence !== s.misses) { ok = false; msg = 'cold + coherence != misses'; }
    if (s.bus !== s.misses + s.BusUpgr) { ok = false; msg = 'bus transactions != misses + upgrades'; }
    if (s.BusRdX + s.BusRd !== s.misses) { ok = false; msg = 'a miss is a BusRd or a BusRdX'; }
  }
  if (a.stats.bus > b.stats.bus) { ok = false; msg = 'MESI used more bus transactions than MSI\n' + text; }
  if (b.frames.some((f) => f.caches.some((c) => c.some((l) => l.s === 'E')))) { ok = false; msg = 'MSI must never produce E'; }
}
eq('500 random scripts, both protocols: single writer, equal copies, reads see the last write, tallies add up, MESI <= MSI traffic ' + msg, ok, true);
// final consistency: dirty data is not lost -- the last value written to each line is held by memory or by a Modified copy
ok = true; msg = '';
for (let t = 0; t < 300 && ok; t++) {
  const cpus = 2 + rnd(3), lines = 1 + rnd(4), rows = []; for (let i = 0; i < 2 + rnd(30); i++) rows.push('P' + rnd(cpus) + (rnd(2) ? ' read ' : ' write ') + 'ABCD'[rnd(lines)]);
  const text = rows.map((x, i) => (x.includes('write') ? x + ' ' + (i + 1) : x)).join('\n'), res = go({ proto: rnd(2) ? 'mesi' : 'msi', cpus, lines }, text), fin = res.frames[res.frames.length - 1], lastW = {};
  res.ops.forEach((o) => { if (o.op === 'write') lastW[o.addr] = o.value; });
  Object.keys(lastW).forEach((a) => { const holder = fin.caches.some((c) => c[a].s === 'M' && c[a].v === lastW[a]) || fin.mem[a] === lastW[a]; if (!holder) { ok = false; msg = 'lost write to ' + a + '\n' + text; } });
}
eq('300 more: the last written value of every line is never lost (in memory or a Modified copy) ' + msg, ok, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
