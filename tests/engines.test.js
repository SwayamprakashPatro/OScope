/* Run with: node tests/engines.test.js
   Checks the engines against well-known textbook answers (Silberschatz/Galvin style). */
const S = require('../js/engines/scheduling.js');
const G = require('../js/engines/paging.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = Math.abs(got - want) < 0.01;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' got=' + got + ' want=' + want);
}
const rows = (r) => r.map(([arrival, burst, priority]) => ({ arrival, burst, priority }));
const preset = (id) => S.PRESETS.find((p) => p.id === id);
const run = (id, algo, extra) => { const p = preset(id); return S.simulate(S.validate(rows(p.rows), { algo, quantum: p.quantum }).clean, Object.assign({ algo, quantum: p.quantum }, extra)); };

eq('FCFS convoy avg WT (17)', run('convoy', 'fcfs').metrics.avgWT, 17);
eq('SJF avg WT (7)', run('sjf', 'sjf').metrics.avgWT, 7);
eq('SRTF avg WT (6.5)', run('srtf', 'srtf').metrics.avgWT, 6.5);
eq('Priority avg WT (8.2)', run('prio', 'priority_np').metrics.avgWT, 8.2);
eq('RR q=4 avg WT (5.667)', run('rr', 'rr').metrics.avgWT, 17 / 3);
eq('Mixed SJF avg WT (4)', run('mixed', 'sjf').metrics.avgWT, 4);
eq('Mixed SRTF avg WT (3)', run('mixed', 'srtf').metrics.avgWT, 3);
eq('Idle gap: total time (16)', run('idle', 'fcfs').total, 16);
eq('Idle gap: utilization (9 of 16 = 56.25%)', run('idle', 'fcfs').metrics.utilization, 56.25);
eq('Preemptive priority: P2 (pri 1) preempts nothing here; avg WT', run('prio', 'priority_p').metrics.avgWT, 8.2);

const gal = G.PRESETS.find((p) => p.id === 'galvin');
const refs = G.parseRefs(gal.refs).tokens;
eq('FIFO faults (15)', G.simulate(refs, 3, 'fifo').faults, 15);
eq('LRU faults (12)', G.simulate(refs, 3, 'lru').faults, 12);
eq('OPT faults (9)', G.simulate(refs, 3, 'opt').faults, 9);
const bel = G.parseRefs(G.PRESETS.find((p) => p.id === 'belady').refs).tokens;
eq('Belady FIFO 3 frames (9)', G.simulate(bel, 3, 'fifo').faults, 9);
eq('Belady FIFO 4 frames (10)', G.simulate(bel, 4, 'fifo').faults, 10);
eq('Belady anomalies found in FIFO sweep (>=1)', G.anomalies(G.sweep(bel, 'fifo', 7)).length >= 1 ? 1 : 0, 1);
eq('LRU never shows the anomaly', G.anomalies(G.sweep(bel, 'lru', 7)).length, 0);
const loop = G.parseRefs('1 2 3 4 1 2 3 4 1 2 3 4').tokens;
eq('Loop LRU faults (12)', G.simulate(loop, 3, 'lru').faults, 12);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
