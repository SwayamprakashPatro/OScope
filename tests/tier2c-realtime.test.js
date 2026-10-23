// Tier 2C: EDF and RMS. Expected values derived by hand.
const R = require('../js/engines/realtime.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const near = (n, got, want) => { const ok = Math.abs(got - want) < 1e-9; ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + got + ' want=' + want)); };
const gantt = (r) => r.frames.map((f) => (f.running ? f.running.slice(1) : '.')).join('');

// Utilisation and bounds
let r = R.run({ algo: 'rms', tasks: 'T1 1 4\nT2 2 6\nT3 3 8' });
near('U = 1/4 + 2/6 + 3/8', r.U, 0.25 + 1 / 3 + 0.375);
near('Liu-Layland bound for n=3 is 3(2^(1/3)-1)', r.bound, 3 * (Math.pow(2, 1 / 3) - 1));
eq('hyperperiod = lcm(4,6,8) = 24', r.hyper, 24);
near('bound for n=1 is 1', R.run({ algo: 'rms', tasks: 'A 1 3' }).bound, 1);
near('bound for n=2 is 0.8284...', R.run({ algo: 'rms', tasks: 'A 1 3\nB 1 5' }).bound, 2 * (Math.SQRT2 - 1));

// RMS failure (hand trace): T1 C2 T5, T2 C4 T7. T1 [0,2],[5,7],[10,12]. T2 [2,5] (3 done) then T1 preempts; T2 resumes at 7 and
// finishes at 8, but its deadline is 7 -> missed. Second T2 job released at 7 (deadline 14) runs 8..12? T1 job at 10 runs [10,12].
r = R.run({ algo: 'rms', tasks: 'T1 2 5\nT2 4 7', horizon: 14 });
eq('RMS: T2 job 0 finishes at 8, one tick late', r.jobs.find((j) => j.task === 1 && j.k === 0).finish, 8);
eq('RMS: T2 job 0 is MISSED', r.jobs.find((j) => j.task === 1 && j.k === 0).missed, true);
eq('RMS: T1 jobs all on time', r.jobs.filter((j) => j.task === 0).every((j) => !j.missed), true);
eq('first 8 ticks: 11222112', gantt(r).slice(0, 8), '11222112');
eq('the miss is announced at tick 7', r.frames[7].notes.some((x) => /DEADLINE MISSED: T2 job 0/.test(x)), true);
// Same set under EDF: U = 0.971 <= 1 so every deadline is met
r = R.run({ algo: 'edf', tasks: 'T1 2 5\nT2 4 7', horizon: 35 });
eq('EDF meets all deadlines at U = 0.971', r.missed.length, 0);
eq('EDF verdict cites U <= 1', /guarantees/.test(r.verdictTest), true);

// Harmonic set, U = 1.0, RMS works (hand trace in the notes: T3 gets the free slots [3,4] and [7,8]).
r = R.run({ algo: 'rms', tasks: 'T1 1 2\nT2 1 4\nT3 2 8' });
eq('harmonic RMS: no misses', r.missed.length, 0);
eq('harmonic RMS gantt over one hyperperiod: 12131213', gantt(r), '12131213');
eq('CPU is 100% busy', r.busy, 8);
eq('verdict explains the bound is only sufficient', /sufficient|above the bound/.test(r.verdictTest), true);

// EDF at U = 1 (T1 2/5, T2 4/10, T3 2/10): U = 0.4+0.4+0.2 = 1
r = R.run({ algo: 'edf', tasks: 'T1 2 5\nT2 4 10\nT3 2 10' });
near('U = 1', r.U, 1);
eq('EDF: no misses at U = 1', r.missed.length, 0);
eq('EDF busy every tick of the hyperperiod', r.busy, 10);

// Overload
r = R.run({ algo: 'edf', tasks: 'T1 3 4\nT2 3 6' });
eq('U = 0.75 + 0.5 = 1.25 > 1 so something is missed', r.missed.length > 0, true);
eq('verdict says no scheduler can', /no scheduler/.test(r.verdictTest), true);

// EDF is not tied to the period: a task with a short deadline goes first
r = R.run({ algo: 'edf', tasks: 'T1 2 10 3\nT2 2 6 6', horizon: 6 });
eq('EDF runs the closest deadline (T1, D=3) before T2 (D=6)', gantt(r).slice(0, 4), '1122');
// RMS puts B (period 6) before A (period 10) even though A's deadline is sooner
r = R.run({ algo: 'rms', tasks: 'T1 2 10 3\nT2 2 6 6', horizon: 6 });
eq('RMS runs the shorter period (T2) first', gantt(r).slice(0, 4), '2211');
eq('so T1 misses its deadline of 3', r.jobs.find((j) => j.task === 0 && j.k === 0).missed, true);

// Errors
eq('C > D rejected', R.run({ algo: 'edf', tasks: 'A 5 4' }).ok, false);
eq('D > T rejected', R.run({ algo: 'edf', tasks: 'A 1 4 6' }).ok, false);
eq('bad line rejected', R.run({ algo: 'edf', tasks: 'A one two' }).ok, false);
eq('horizon too big rejected', R.run({ algo: 'edf', tasks: 'A 1 4', horizon: 999 }).ok, false);

// Random invariants: EDF never misses when U <= 1 and D = T; work conserved; deadlines reported consistently
let seed = 5; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0, checked = 0;
for (let k = 0; k < 400; k++) {
  const n = 1 + rnd(4), ls = []; for (let i = 0; i < n; i++) { const T = 2 + rnd(9); ls.push('T' + i + ' ' + (1 + rnd(T)) + ' ' + T); }
  const cfgE = { algo: 'edf', tasks: ls.join('\n') }, e = R.run(cfgE);
  if (!e.ok) { bad++; console.log('unexpected', cfgE, e.errors); continue; }
  checked++;
  if (e.U <= 1 + 1e-12 && e.hyper <= 200 && e.missed.length) { bad++; console.log('EDF missed at U<=1', JSON.stringify(cfgE)); }
  const m = R.run({ algo: 'rms', tasks: cfgE.tasks });
  if (m.ok && m.U <= m.bound && m.missed.length) { bad++; console.log('RMS missed within the bound', JSON.stringify(cfgE)); }
  if (m.ok && m.missed.length === 0 && e.U <= 1 + 1e-12 && e.missed.length) { bad++; console.log('RMS ok but EDF not', JSON.stringify(cfgE)); }
  // every completed job received exactly C ticks of CPU
  [e, m].forEach((x) => { if (!x.ok) return; const got = {}; x.frames.forEach((f) => { if (f.running) { const key = f.running + '#' + f.job; got[key] = (got[key] || 0) + 1; } }); x.jobs.forEach((j) => { if (j.finish >= 0 && got[x.tasks[j.task].name + '#' + j.k] !== x.tasks[j.task].C) { bad++; console.log('work not conserved', cfgE.tasks); } }); });
}
eq('400 random task sets: EDF never misses at U<=1, RMS never misses within the bound, work is conserved', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
