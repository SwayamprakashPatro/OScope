const A = require('../js/engines/allocation.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const mk = (arr) => arr.map(([op, name, size]) => ({ op, name, size }));
const lay = A.parseLayout('100 500 200 300 600');
const ops = mk([['alloc', 'P1', 212], ['alloc', 'P2', 417], ['alloc', 'P3', 112], ['alloc', 'P4', 426]]);
const run = (algo, o, l, split) => A.simulate(l || lay, o || ops, { algo, split: split !== false });
const at = (s) => ['P1', 'P2', 'P3', 'P4'].map((n) => s.placed[n]);
// Galvin: addresses are 0,100,600,800,1100 for blocks 100,500,200,300,600
eq('First fit: P1 in 500-block (addr 100), P2 in 600-block (addr 1100), P3 in leftover 288 (addr 312), P4 fails', at(run('first')), [100, 1100, 312, null]);
eq('Best fit: 300-block(800), 500-block(100), 200-block(600), 600-block(1100)', at(run('best')), [800, 100, 600, 1100]);
eq('Worst fit: 600-block, 500-block, leftover 388 (addr 1312), P4 fails', at(run('worst')), [1100, 100, 1312, null]);
const f = run('first').frames.filter((x) => x.phase === 'result' && x.ok === false)[0];
eq('P4 failure kind (free total 1,000? no: external fragmentation)', f.kind, 'external');
// Fixed mode, internal fragmentation
const fx = A.simulate(A.parseLayout('300 600 350 200 750 125'), mk([['alloc', 'P1', 115], ['alloc', 'P2', 500], ['alloc', 'P3', 358], ['alloc', 'P4', 200], ['alloc', 'P5', 375]]), { algo: 'first', split: false });
eq('Fixed first fit internal fragmentation = 185+100+392+150', fx.stats.internal, 827);
eq('Fixed first fit: P5 fails: only 325 free in total (<375)', fx.frames[fx.frames.length - 1].kind, 'no-space');
// Free + merge, compaction
const fr = A.simulate([1000], mk([['alloc', 'A', 200], ['alloc', 'B', 300], ['alloc', 'C', 100], ['alloc', 'D', 250], ['free', 'A'], ['free', 'C'], ['alloc', 'E', 300]]), { algo: 'first', split: true });
eq('E fails with external fragmentation', fr.frames[fr.frames.length - 1].kind, 'external');
eq('Three holes of 200,100,150 before E', fr.stats.holes, 3);
const fc = A.simulate([1000], mk([['alloc', 'A', 200], ['alloc', 'B', 300], ['alloc', 'C', 100], ['free', 'A'], ['free', 'C'], ['compact'], ['alloc', 'E', 300]]), { algo: 'first', split: true });
eq('After compaction E is placed (addr 300)', fc.placed.E, 300);
eq('After compaction one hole', fc.stats.holes, 1);
const mg = A.simulate([100], mk([['alloc', 'A', 30], ['alloc', 'B', 30], ['free', 'A'], ['free', 'B']]), { algo: 'first', split: true });
eq('Adjacent frees merge back to one 100 hole', mg.final, [{ start: 0, size: 100, pid: null, req: 0 }]);
// Next fit: layout 200; A,B,C 30 each (0,30,60); free A; D 20 -> next fit continues after C (at 90), first fit reuses addr 0
const nf = (algo) => A.simulate([200], mk([['alloc', 'A', 30], ['alloc', 'B', 30], ['alloc', 'C', 30], ['free', 'A'], ['alloc', 'D', 20]]), { algo, split: true });
eq('First fit puts D at 0', nf('first').placed.D, 0);
eq('Next fit puts D at 90', nf('next').placed.D, 90);
eq('Validation: duplicate name', A.validate([100], mk([['alloc', 'A', 5], ['alloc', 'A', 6]]), { split: true }).ok, false);
eq('Validation: free of unknown', A.validate([100], mk([['free', 'Z']]), { split: true }).ok, false);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
