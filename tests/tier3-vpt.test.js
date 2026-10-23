// Tier 3: shadow vs nested page tables. Walk costs hand-derived from the (g+1)(h+1)-1 formula.
const V = require('../js/engines/vpt.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const ev = (t) => V.parseEvents(t).events;
const go = (cfg, t) => V.run(cfg, ev(t));
const base = { g: 4, h: 4, tlb: true, tlbSize: 4, exitCost: 100 };

// ---- walk cost formula (translation only, data access not included)
eq('native walk = g', [1, 2, 3, 4, 5].map((g) => V.walkRefs('native', g, 4)), [1, 2, 3, 4, 5]);
eq('shadow walk = g (host depth irrelevant)', V.walkRefs('shadow', 3, 5), 3);
eq('nested 1x1 = 3', V.walkRefs('nested', 1, 1), 3);
eq('nested 2x2 = 8', V.walkRefs('nested', 2, 2), 8);
eq('nested 3x3 = 15', V.walkRefs('nested', 3, 3), 15);
eq('nested 4x4 = 24', V.walkRefs('nested', 4, 4), 24);
eq('nested 4x5 = 29', V.walkRefs('nested', 4, 5), 29);
eq('nested is not symmetric-looking but is: 3x5 = 5x3 = 23', [V.walkRefs('nested', 3, 5), V.walkRefs('nested', 5, 3)], [23, 23]);
eq('sweep matches formula', V.sweep(3), [[3, 5, 7], [5, 8, 11], [7, 11, 15]]);

// ---- grid structure
for (const [g, h] of [[1, 1], [2, 3], [4, 4], [5, 2]]) {
  const grid = V.nestedGrid(g, h);
  eq('grid ' + g + 'x' + h + ' has one cell per reference', grid.length, V.walkRefs('nested', g, h));
  eq('grid ' + g + 'x' + h + ' host cells = (g+1)h, guest cells = g', [grid.filter((c) => c.kind === 'host').length, grid.filter((c) => c.kind === 'guest').length], [(g + 1) * h, g]);
  eq('grid ' + g + 'x' + h + ' numbers run 1..n', grid.map((c) => c.n), grid.map((_, i) => i + 1));
}

// ---- cold access with no TLB
eq('native, no TLB: 4 levels -> 5 refs per access', go({ method: 'native', g: 4, tlb: false }, 'access A').totals.refs, 5);
eq('nested 4x4, no TLB: 24 + 1 data = 25', go({ method: 'nested', g: 4, h: 4, tlb: false }, 'access A').totals.refs, 25);
eq('nested 1x1 first access = 3 + 1', go({ method: 'nested', g: 1, h: 1, tlb: false }, 'access A').totals.refs, 4);
eq('shadow first access = faulting build + retry', go({ method: 'shadow', g: 4, h: 4 }, 'access A').totals, Object.assign({}, go({ method: 'shadow', g: 4, h: 4 }, 'access A').totals, { refs: 4 + 4 + 4 + 1, exits: 1 }));
eq('shadow second touch of a flushed page needs no exit', go({ method: 'shadow', g: 4, h: 4, tlb: false }, 'access A x 2').totals.exits, 1);

// ---- TLB behaviour
const hits = go(Object.assign({}, base, { method: 'native' }), 'access A x 3');
eq('TLB: miss then two hits', hits.frames.slice(1).map((f) => f.outcome), ['walk', 'tlb-hit', 'tlb-hit']);
eq('TLB hit costs 1 reference', hits.frames[2].refs, 1);
eq('hit total = 5 + 1 + 1', hits.totals.refs, 7);
eq('hit rate 2/3', Math.round(hits.totals.hitRate * 1000), 667);
const lru = go(Object.assign({}, base, { method: 'native', tlbSize: 2 }), 'access A\naccess B\naccess C\naccess A');
eq('LRU: A evicted by C in a 2-entry TLB', lru.frames.slice(1).map((f) => f.outcome), ['walk', 'walk', 'walk', 'walk']);
eq('LRU: TLB holds most recent first', lru.frames[4].tlb, ['A', 'C']);
const keepB = go(Object.assign({}, base, { method: 'native', tlbSize: 2 }), 'access A\naccess B\naccess A\naccess C\naccess A');
eq('LRU: touching A keeps it over B', keepB.frames.slice(1).map((f) => f.outcome), ['walk', 'walk', 'tlb-hit', 'walk', 'tlb-hit']);
eq('switch flushes the TLB', go(Object.assign({}, base, { method: 'native' }), 'access A\nswitch\naccess A').frames.map((f) => f.outcome), [undefined, 'walk', 'flush', 'walk']);
eq('map invalidates only that page', go(Object.assign({}, base, { method: 'native' }), 'access A\naccess B\nmap A').frames[3].tlb, ['B']);

// ---- exits: the whole point of the comparison
const churn = 'map A\naccess A\nmap A\naccess A';
eq('nested: guest page-table edits cause no exits', go(Object.assign({}, base, { method: 'nested' }), churn).totals.exits, 0);
eq('native: no exits', go(Object.assign({}, base, { method: 'native' }), churn).totals.exits, 0);
eq('shadow: each edit exits, plus one rebuild per edit-then-access', go(Object.assign({}, base, { method: 'shadow' }), churn).totals.exits, 4);
eq('shadow: context switch exits', go(Object.assign({}, base, { method: 'shadow' }), 'switch x 3').totals.exits, 3);
eq('nested: context switch no exit', go(Object.assign({}, base, { method: 'nested' }), 'switch x 3').totals.exits, 0);
eq('cost = refs + exits * exitCost', go(Object.assign({}, base, { method: 'shadow', exitCost: 250 }), 'switch').totals.cost, 1 + 250);
eq('exit cost 0 makes shadow edits cheap', go(Object.assign({}, base, { method: 'shadow', exitCost: 0 }), 'map A').totals.cost, 1);

// ---- the headline trade-off, derived from the model
const steady = (m) => go(Object.assign({}, base, { method: m }), 'access A\naccess B\naccess A x 20\naccess B x 20').totals.cost;
const scan = 'access P1\naccess P2\naccess P3\naccess P4\naccess P5\naccess P6\naccess P7\naccess P8\n'.repeat(3);
const scanCost = (m, x) => go(Object.assign({}, base, { method: m, exitCost: x }), scan).totals.cost;
eq('first-touch faults: with zero exit cost shadow stays below nested at no exit cost', scanCost('shadow', 0) < scanCost('nested', 0), true);
eq('with a huge exit cost shadow loses its first-touch edge', scanCost('shadow', 5000) > scanCost('nested', 5000), true);
eq('steady working set: all three within one miss-cost of each other (nested walk is paid only twice)', steady('nested') - steady('native') < 2 * 21, true);
eq('compare returns all three methods', V.compare(base, ev('access A')).map((r) => r.method), ['native', 'shadow', 'nested']);
eq('compare uses the same events (accesses equal)', new Set(V.compare(base, ev('access A\naccess B')).map((r) => r.totals.accesses)).size, 1);

// ---- parsing and validation
eq('parse: ops and repeat', ev('access A x 2\nmap B\nswitch').map((e) => e.op + (e.page || '')), ['accessA', 'accessA', 'mapB', 'switch']);
eq('parse: comments and blank lines ignored', ev('# hi\n\naccess A # now').length, 1);
eq('parse: case-insensitive op', ev('ACCESS a')[0].op, 'access');
eq('parse: access needs a page', V.parseEvents('access').ok, false);
eq('parse: switch rejects a page', V.parseEvents('switch A').ok, false);
eq('parse: nonsense line reports its number', V.parseEvents('access A\nfoo').errors[0].startsWith('Line 2'), true);
eq('parse: repeat over limit rejected', V.parseEvents('access A x 51').ok, false);
eq('parse: empty input rejected', V.parseEvents('   ').ok, false);
eq('parse: event cap', V.parseEvents('access A x 50\n'.repeat(5)).ok, false);
eq('cfg: levels out of range rejected', V.run({ g: 6 }, ev('access A')).ok, false);
eq('cfg: fractional levels rejected', V.run({ g: 2.5 }, ev('access A')).ok, false);
eq('cfg: unknown method rejected', V.run({ method: 'xyz' }, ev('access A')).ok, false);
eq('cfg: non-numeric TLB size rejected', V.run({ tlbSize: 'big' }, ev('access A')).ok, false);

// ---- invariants over random scripts
let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let okInv = true, msg = '';
for (let t = 0; t < 200 && okInv; t++) {
  const g = 1 + rnd(5), h = 1 + rnd(5), tlb = rnd(2) === 0, size = 1 + rnd(6);
  const lines = []; for (let i = 0; i < 1 + rnd(30); i++) { const k = rnd(6); lines.push(k < 4 ? 'access ' + 'ABCDEFG'[rnd(7)] : k === 4 ? 'map ' + 'ABCDEFG'[rnd(7)] : 'switch'); }
  const events = ev(lines.join('\n'));
  const res = V.compare({ g, h, tlb, tlbSize: size, exitCost: 100 }, events);
  const [n, s, d] = res.map((r) => r.totals);
  const sumRefs = (m) => V.run({ g, h, tlb, tlbSize: size, exitCost: 100, method: m }, events).frames.reduce((a, f) => a + f.refs, 0);
  if (sumRefs('nested') !== d.refs || sumRefs('shadow') !== s.refs) { okInv = false; msg = 'frame refs do not add to totals'; }
  if (n.exits !== 0 || d.exits !== 0) { okInv = false; msg = 'native/nested must never exit'; }
  if (d.refs < n.refs) { okInv = false; msg = 'nested cheaper than native g=' + g + ' h=' + h; }
  if (n.hits !== d.hits || n.hits !== s.hits) { okInv = false; msg = 'TLB behaviour must not depend on the method'; }
  if (n.accesses !== n.hits + n.misses) { okInv = false; msg = 'hits + misses != accesses'; }
  if (!tlb && n.hits !== 0) { okInv = false; msg = 'hits with no TLB'; }
}
eq('invariants over 200 random scripts ' + msg, okInv, true);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
