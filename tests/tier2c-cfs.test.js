// Tier 2C: CFS. Expected values derived by hand.
const C = require('../js/engines/cfs.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const near = (n, got, want, tol) => { const ok = Math.abs(got - want) <= tol; ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + got + ' want=' + want)); };
const gantt = (r) => r.frames.map((f) => f.running || '.').join('');

// Weight table anchors (from the kernel's prio_to_weight table)
eq('nice 0 = 1024, -5 = 3121, 5 = 335, 19 = 15, -20 = 88761', [C.weightOf(0), C.weightOf(-5), C.weightOf(5), C.weightOf(19), C.weightOf(-20)], [1024, 3121, 335, 15, 88761]);
eq('table has 40 entries, strictly decreasing', [C.WEIGHTS.length, C.WEIGHTS.every((w, i) => !i || w < C.WEIGHTS[i - 1])], [40, true]);
let ok = true; for (let n = -20; n < 19; n++) { const ratio = C.weightOf(n) / C.weightOf(n + 1); if (ratio < 1.2 || ratio > 1.3) ok = false; }
eq('each nice step is about 1.25x', ok, true);

// Two equal tasks, latency 6: slice = round(6*1024/2048) = 3. A runs 0-2 (vr 3), B 3-5 (vr 3), tie -> A ...
let r = C.run({ latency: 6, gran: 1, procs: 'A 0 6\nB 0 6' });
eq('equal tasks alternate in slices of 3: AAABBBAAABBB', gantt(r), 'AAABBBAAABBB');
eq('slice length announced', r.frames[0].slice, 3);
eq('vruntime of A after its first tick is 1024/1024 = 1', r.frames[0].tasks[0].vrAfter, 1);

// nice 0 vs nice 5, latency 6: total weight 1359. A slice = round(6*1024/1359)=round(4.52)=5, B slice = round(6*335/1359)=round(1.48)=1
r = C.run({ latency: 6, gran: 1, procs: 'A 0 20\nB 0 5 5' });
eq('A gets a 5-tick slice, B a 1-tick slice', [r.frames[0].slice, r.frames[5].slice], [5, 1]);
eq('A runs first 5 ticks (tie goes to the earlier task), then B', gantt(r).slice(0, 7), 'AAAAABB');
near('B vruntime per tick = 1024/335 = 3.0567', r.frames[5].tasks[1].vrAfter - r.frames[5].tasks[1].vr, 1024 / 335, 1e-9);

// Long-run CPU share matches the weight ratio
r = C.run({ latency: 6, gran: 1, procs: 'A 0 90\nB 0 90 5' });
const firstHundred = r.frames.slice(0, 100); const aRan = firstHundred.filter((f) => f.running === 'A').length, bRan = firstHundred.filter((f) => f.running === 'B').length;
near('A:B share over 100 ticks is about 1024:335 = 3.06', aRan / bRan, 1024 / 335, 0.45);

// Late arrival starts at min_vruntime
r = C.run({ latency: 6, gran: 1, procs: 'A 0 14\nB 0 14\nC 8 6' });
const cArr = r.frames[8].tasks[2]; const others = r.frames[8].tasks.slice(0, 2);
eq('C joins at the current min_vruntime, not at 0', cArr.vr > 0 && Math.abs(cArr.vr - Math.min(...others.map((x) => x.vr))) < 1e-9, true);

// Min granularity: 4 tasks, latency 8 -> ideal slice 2, but gran 3 forces 3
r = C.run({ latency: 8, gran: 3, procs: 'A 0 6\nB 0 6\nC 0 6\nD 0 6' });
eq('slice is clamped up to the minimum granularity', r.frames[0].slice, 3);
r = C.run({ latency: 8, gran: 1, procs: 'A 0 6\nB 0 6\nC 0 6\nD 0 6' });
eq('without the clamp it is latency/4 = 2', r.frames[0].slice, 2);

// Idle gap
r = C.run({ latency: 6, gran: 1, procs: 'A 2 2' });
eq('idle until arrival', gantt(r), '..AA');

// Errors
eq('nice out of range', C.run({ latency: 6, gran: 1, procs: 'A 0 3 25' }).ok, false);
eq('gran above latency', C.run({ latency: 4, gran: 5, procs: 'A 0 3' }).ok, false);
eq('burst 0', C.run({ latency: 6, gran: 1, procs: 'A 0 0' }).ok, false);
eq('too long', C.run({ latency: 6, gran: 1, procs: 'A 0 999' }).ok, false);

// Random invariants
let seed = 11; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 300; k++) {
  const n = 1 + rnd(5), lines = []; for (let i = 0; i < n; i++) lines.push('T' + i + ' ' + rnd(10) + ' ' + (1 + rnd(10)) + ' ' + (rnd(20) - 5));
  const lat = 2 + rnd(10), cfg = { latency: lat, gran: 1 + rnd(lat), procs: lines.join('\n') };
  const x = C.run(cfg); if (!x.ok) { bad++; console.log('unexpected error', JSON.stringify(cfg), x.errors); continue; }
  const ran = {}; x.frames.forEach((f) => { if (f.running) ran[f.running] = (ran[f.running] || 0) + 1; });
  const okRun = x.procs.every((p) => ran[p.name] === p.burst);
  // vruntime never decreases for a task, and a task is only picked at a slice start if its vruntime is minimal among ready tasks
  let mono = true; const last = {};
  x.frames.forEach((f) => f.tasks.forEach((tk) => { if (last[tk.name] !== undefined && tk.vr < last[tk.name] - 1e-9) mono = false; last[tk.name] = tk.vrAfter; }));
  let minimal = true;
  x.frames.forEach((f) => { if (f.notes.some((s) => /^pick /.test(s))) { const cand = f.tasks.filter((tk) => tk.state === 'run' || tk.state === 'ready'); const me = f.tasks.find((tk) => tk.name === f.running); if (cand.some((tk) => tk.vr < me.vr - 1e-9)) minimal = false; } });
  if (!(okRun && mono && minimal)) { bad++; console.log('invariant broken', JSON.stringify(cfg), okRun, mono, minimal); }
}
eq('300 random configs: bursts honoured, vruntime monotonic, always picks the smallest vruntime', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
