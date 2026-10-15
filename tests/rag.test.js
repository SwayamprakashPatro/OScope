const G = require('../js/engines/rag.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const run = (id) => { const p = G.PRESETS.find((x) => x.id === id); const r = G.parse(p.procs, p.res, p.edges); return { r, out: r.ok ? G.reduce(r.model) : null }; };
let c = run('circular'); eq('Circular preset parses', c.r.ok, true); eq('Circular: deadlocked P1,P2', c.out.deadlocked, ['P1', 'P2']); eq('Circular: has a cycle of 4', c.out.cycle.length, 4);
c = run('nodead'); eq('Multi-instance: cycle exists', !!c.out.cycle, true); eq('Multi-instance: NO deadlock', c.out.deadlocked, []);
eq('Reduction order P2, P1, P3', c.out.frames.filter((f) => f.kind === 'reduce').map((f) => f.p), ['P2', 'P1', 'P3']);
c = run('three'); eq('Three-cycle deadlocked', c.out.deadlocked, ['P1', 'P2', 'P3']);
c = run('chain'); eq('Chain: no cycle', c.out.cycle, null); eq('Chain: no deadlock', c.out.deadlocked, []);
eq('Chain reduction order', c.out.frames.filter((f) => f.kind === 'reduce').map((f) => f.p), ['P1', 'P2']);
// deadlock subset: P3 is innocent
let r = G.parse('P1,P2,P3', 'R1,R2', 'R1->P1\nP1->R2\nR2->P2\nP2->R1\nP3->R1');
eq('Subset deadlock: P3 also stuck (waits on R1)', G.reduce(r.model).deadlocked, ['P1', 'P2', 'P3']);
r = G.parse('P1,P2,P3', 'R1,R2,R3', 'R1->P1\nP1->R2\nR2->P2\nP2->R1\nR3->P3');
eq('Subset deadlock: bystander P3 finishes', G.reduce(r.model).deadlocked, ['P1', 'P2']);
eq('Wait-for graph of circular', G.waitFor(run('circular').r.model).map((x) => x.from + '>' + x.to), ['P1>P2', 'P2>P1']);
// validation
eq('Unknown node', G.parse('P1', 'R1', 'P1 -> R9').ok, false);
eq('Same-kind edge', G.parse('P1,P2', 'R1', 'P1 -> P2').ok, false);
eq('Over-assigned resource', G.parse('P1,P2', 'R1', 'R1 -> P1\nR1 -> P2').ok, false);
eq('Duplicate names', G.parse('P1,P1', 'R1', '').ok, false);
eq('Instance cap', G.parse('P1', 'R1=9', '').ok, false);
eq('Bad edge syntax', G.parse('P1', 'R1', 'P1 R1').ok, false);
eq('Empty edge list is fine', G.parse('P1', 'R1', '').ok, true);
eq('Single-instance: cycle iff deadlock (random)', (() => { let ok = true; for (let s = 1; s < 300; s++) { let x = s * 7919 % 10007; const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; const edges = []; const used = {}; for (let k = 0; k < 6; k++) { const p = 'P' + (1 + Math.floor(rnd() * 3)), q = 'R' + (1 + Math.floor(rnd() * 3)); if (rnd() < 0.5) { if (!edges.includes(p + '->' + q)) edges.push(p + '->' + q); } else if (!used[q]) { used[q] = 1; edges.push(q + '->' + p); } } const pr = G.parse('P1,P2,P3', 'R1,R2,R3', edges.join('\n')); if (!pr.ok) continue; const o = G.reduce(pr.model); if (!!o.cycle !== (o.deadlocked.length > 0)) ok = false; } return ok; })(), true);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
