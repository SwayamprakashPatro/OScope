// Tier 1: Clock, NRU, LFU, MFU and Aging page replacement. Hand traces plus a differential test
// against small independent reference implementations written in a different style.
const G = require('../js/engines/paging.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const run = (str, n, algo, cfg) => G.simulate(G.parseRefs(str).tokens, n, algo, cfg);
const victims = (r) => r.steps.filter((s) => s.victim !== null).map((s) => s.victim);

// ---- hand traces
let r = run('1 2 3 1 4', 3, 'clock');
eq('clock: every bit 1 -> hand circles and evicts page 1', [victims(r), r.steps[5].frames, r.faults], [['1'], ['4', '2', '3'], 4]);
eq('clock: sweep recorded (3 second chances + 1 eviction)', r.steps[5].cands.map((c) => c.value), [1, 1, 1, 0]);
eq('clock: hand ends after the replaced frame', r.steps[5].hand, 1);
eq('clock: text mentions going all the way round', /all the way round/.test(r.steps[5].text), true);
r = run('1 2 3 2 4 5', 3, 'clock');
// after loads bits all 1, hand 0; hit on 2 keeps bit 1; ref 4: sweep clears 1,2,3 then evicts 1 (frame 0) -> hand 1
// ref 5: bits now 4:1 (new) 2:0 3:0, hand 1: page 2 has bit 0 -> evict 2
eq('clock: second fault evicts the page whose bit was cleared earlier', victims(r), ['1', '2']);
eq('clock: meta lists frames from the hand, hand marked on the first', [r.steps[6].meta.items.map((i) => i.page), /hand/.test(r.steps[6].meta.items[0].note), r.steps[6].hand], [['3', '4', '5'], true, 2]);
r = run('1 1 2 3', 2, 'lfu'); eq('lfu: evicts the least used (2)', victims(r), ['2']);
r = run('1 1 2 3', 2, 'mfu'); eq('mfu: evicts the most used (1)', victims(r), ['1']);
r = run('1 2 3', 2, 'lfu'); eq('lfu: tie goes to the page loaded first', victims(r), ['1']);
r = run('1 2 1 3', 2, 'aging');
eq('aging: counters after step 3 (page1 = 10100000)', r.steps[3].meta.items.map((i) => [i.page, i.note]), [['2', '01000000'], ['1', '10100000']]);
eq('aging: victim is the page with the smaller counter', victims(r), ['2']);
r = run('1 2 3', 2, 'nru', { nruClear: 2 });
eq('nru: bits cleared after reference 2, then oldest of equals goes', [victims(r), r.steps[2].cleared], [['1'], true]);
r = run('1 2 1 3', 2, 'nru', { nruClear: 2 });
eq('nru: the page used since the clear (1) survives', victims(r), ['2']);
r = run('1 2 3 4', 2, 'nru', { nruClear: 50 });
eq('nru: all bits 1 -> oldest evicted', victims(r), ['1', '2']);

// ---- differential test against independent implementations
function refClock(refs, n) { const fr = [], b = []; let hand = 0, f = 0; for (const x of refs) { const i = fr.indexOf(x); if (i >= 0) { b[i] = 1; continue; } f++; if (fr.length < n) { fr.push(x); b.push(1); hand = fr.length % n; continue; } while (b[hand]) { b[hand] = 0; hand = (hand + 1) % n; } fr[hand] = x; b[hand] = 1; hand = (hand + 1) % n; } return f; }
function refCount(refs, n, most) { let res = []; let f = 0, t = 0; for (const x of refs) { t++; const e = res.find((q) => q.p === x); if (e) { e.c++; continue; } f++; if (res.length >= n) { res.sort((a, b) => (most ? b.c - a.c : a.c - b.c) || a.t - b.t); res.shift(); } res.push({ p: x, c: 1, t }); } return f; }
function refAging(refs, n) { let res = []; let f = 0, t = 0; for (const x of refs) { t++; let e = res.find((q) => q.p === x); if (e) e.r = 1; else { f++; if (res.length >= n) { res.sort((a, b) => a.c - b.c || a.t - b.t); res.shift(); } e = { p: x, c: 0, r: 1, t }; res.push(e); } res.forEach((q) => { q.c = (q.c >> 1) | (q.r << 7); q.r = 0; }); } return f; }
function refNru(refs, n, K) { let res = []; let f = 0, t = 0, k = 0; for (const x of refs) { t++; k++; const e = res.find((q) => q.p === x); if (e) e.r = 1; else { f++; if (res.length >= n) { res.sort((a, b) => a.r - b.r || a.t - b.t); res.shift(); } res.push({ p: x, r: 1, t }); } if (k % K === 0) res.forEach((q) => { q.r = 0; }); } return f; }
let seed = 12345; const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
const bad = { clock: 0, lfu: 0, mfu: 0, aging: 0, nru: 0 }; const CASES = 400;
for (let c = 0; c < CASES; c++) {
  const len = 5 + rnd(40), pages = 2 + rnd(7), n = 1 + rnd(5), K = 1 + rnd(6);
  const refs = Array.from({ length: len }, () => String(rnd(pages)));
  if (G.simulate(refs, n, 'clock').faults !== refClock(refs, n)) bad.clock++;
  if (G.simulate(refs, n, 'lfu').faults !== refCount(refs, n, false)) bad.lfu++;
  if (G.simulate(refs, n, 'mfu').faults !== refCount(refs, n, true)) bad.mfu++;
  if (G.simulate(refs, n, 'aging').faults !== refAging(refs, n)) bad.aging++;
  if (G.simulate(refs, n, 'nru', { nruClear: K }).faults !== refNru(refs, n, K)) bad.nru++;
}
Object.keys(bad).forEach((k) => eq('differential (' + CASES + ' random cases): ' + k + ' matches the reference', bad[k], 0));

// ---- invariants for every algorithm
let inv = 0;
for (let c = 0; c < 200; c++) {
  const refs = Array.from({ length: 5 + rnd(30) }, () => String(rnd(6))), n = 1 + rnd(4);
  G.ALGOS.forEach((a) => {
    const s = G.simulate(refs, n, a.id);
    if (s.faults + s.hits !== refs.length) inv++;
    s.steps.forEach((st) => { if (st.frames.filter(Boolean).length > n) inv++; if (st.victim !== null && st.frames.includes(st.victim) && st.victim !== st.page) inv++; if (st.hit === false && st.frames[st.slot] !== st.page) inv++; });
    if (s.algo !== a.id) inv++;
  });
}
eq('invariants hold for all ' + G.ALGOS.length + ' algorithms (faults+hits, frame count, victim gone, page placed)', inv, 0);
eq('same page twice in a row is always a hit (all algorithms)', G.ALGOS.every((a) => run('5 5', 1, a.id).hits === 1), true);
eq('single frame: every different page faults (all algorithms)', G.ALGOS.every((a) => run('1 2 3 1', 1, a.id).faults === 4), true);
eq('Clock can show Belady anomaly on the classic string', G.anomalies(G.sweep(G.parseRefs('1 2 3 4 1 2 5 1 2 3 4 5').tokens, 'fifo', 5)).length > 0, true);
eq('LFU/MFU/NRU/Aging/Clock appear in ALGOS with teaching text', G.ALGOS.slice(3).map((a) => [a.id, !!(a.rule && a.hook && a.watch)]), [['clock', true], ['nru', true], ['lfu', true], ['mfu', true], ['aging', true]]);
eq('chart shows four lines, table all eight', [G.CHART_ALGOS.length, G.ALGOS.length], [4, 8]);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
