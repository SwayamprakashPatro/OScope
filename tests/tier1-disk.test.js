// Tier 1: disk geometry (seek vs rotational latency vs transfer).
const D = require('../js/engines/disk.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const close = (a, b) => Math.abs(a - b) < 1e-9;
const t = D.diskTime(640, 8, { rpm: 7200, seekPerCylMs: 0.1, sectors: 200 });
eq('7200 RPM: one rotation = 8.333 ms', close(t.rotationPeriodMs, 60000 / 7200), true);
eq('average rotational latency is half a rotation (4.167 ms)', close(t.avgRotationalMs, 30000 / 7200), true);
eq('transfer of one sector = rotation / 200', close(t.transferPerSectorMs, (60000 / 7200) / 200), true);
eq('seek = 640 cylinders x 0.1 ms = 64 ms', close(t.seekMs, 64), true);
eq('rotation total = 8 requests x 4.1667 ms', close(t.rotMs, 8 * 30000 / 7200), true);
eq('total = seek + rotation + transfer', close(t.totalMs, t.seekMs + t.rotMs + t.xferMs), true);
eq('seek share between 0 and 1 and equals seek/total', close(t.seekShare, t.seekMs / t.totalMs) && t.seekShare > 0 && t.seekShare < 1, true);
eq('per-request time = total / requests', close(t.perRequestMs, t.totalMs / 8), true);
// scheduling only changes the seek part
const Q = D.parseQueue('98 183 37 122 14 124 65 67');
const f = D.diskTime(D.simulate(Q, 53, 200, 'fcfs', {}).total, Q.length), s = D.diskTime(D.simulate(Q, 53, 200, 'sstf', {}).total, Q.length);
eq('FCFS vs SSTF: only the seek part differs', [close(f.rotMs, s.rotMs), close(f.xferMs, s.xferMs), f.seekMs > s.seekMs], [true, true, true]);
eq('FCFS 640 cyl vs SSTF 236 cyl at 0.1 ms: seek 64 vs 23.6', [close(f.seekMs, 64), close(s.seekMs, 23.6)], [true, true]);
eq('zero movement: all time is rotation + transfer', D.diskTime(0, 3).seekShare, 0);
eq('zero requests does not divide by zero', [D.diskTime(0, 0).totalMs, D.diskTime(0, 0).perRequestMs, D.diskTime(0, 0).seekShare], [0, 0, 0]);
eq('doubling the RPM halves rotational time', close(D.diskTime(0, 5, { rpm: 14400 }).rotMs * 2, D.diskTime(0, 5, { rpm: 7200 }).rotMs), true);
eq('defaults are used when a field is missing', close(D.diskTime(10, 1, {}).seekMs, 1), true);
// validation
eq('defaults are valid', D.validateTime(D.TIME_DEFAULTS).ok, true);
eq('rpm 0 rejected', D.validateTime({ rpm: 0, seekPerCylMs: 0.1, sectors: 200 }).ok, false);
eq('rpm must be whole', D.validateTime({ rpm: 7200.5, seekPerCylMs: 0.1, sectors: 200 }).ok, false);
eq('empty seek rejected', D.validateTime({ rpm: 7200, seekPerCylMs: '', sectors: 200 }).ok, false);
eq('sectors 0 rejected', D.validateTime({ rpm: 7200, seekPerCylMs: 0.1, sectors: 0 }).ok, false);
eq('non-number rejected', D.validateTime({ rpm: 'abc', seekPerCylMs: 0.1, sectors: 200 }).ok, false);
eq('three problems -> three messages', D.validateTime({ rpm: 0, seekPerCylMs: 0, sectors: 0 }).errors.length, 3);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
