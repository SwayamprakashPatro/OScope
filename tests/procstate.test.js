const S = require('../js/engines/procstate.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const run = (n, text, cfg) => S.simulate(n, S.parseScript(text).rows, cfg);
const q = S.PRESETS.find((p) => p.id === 'queue');
let r = run(q.n, q.script);
const last = r.frames[r.frames.length - 1];
eq('Queue scenario has no error', r.error, null);
eq('Queue scenario final states', last.procs.map((p) => p.state), ['terminated', 'terminated', 'terminated']);
// after "P1 timeout" (frame index 5): ready should be [P2,P3,P1]
eq('After timeout P1 goes to the BACK of the queue', r.frames[5].ready, ['P2', 'P3', 'P1']);
eq('After P2 waits, waiting queue = [P2]', r.frames[7].waiting, ['P2']);
eq('Wake puts P2 behind P1', r.frames[10].ready, ['P1', 'P2']);
eq('Illegal: dispatch while another runs', run(2, 'P1 admit\nP2 admit\nP1 dispatch\nP2 dispatch').error.index, 3);
eq('Illegal: dispatch not at front (FIFO)', run(2, 'P1 admit\nP2 admit\nP2 dispatch').error.index, 2);
eq('Allowed when FIFO dispatch is off', run(2, 'P1 admit\nP2 admit\nP2 dispatch', { fifoDispatch: false }).error, null);
eq('Illegal: wake a ready process', run(1, 'P1 admit\nP1 wake').error.index, 1);
eq('Illegal: exit before running', run(1, 'P1 admit\nP1 exit').error.index, 1);
eq('Frames stop before the error', run(1, 'P1 exit').frames.length, 1);
eq('Parse errors', S.parseScript('P1 admit\nhello\nP2 jump').errors.length, 2);
// invariants over generated scenarios
let okInv = true, okLegal = true;
for (let seed = 1; seed <= 200; seed++) {
  const sc = S.generate(3, 40, seed);
  const res = S.simulate(3, sc);
  if (res.error) okLegal = false;
  res.frames.forEach((f) => { if (f.procs.filter((p) => p.state === 'running').length > 1) okInv = false; if (f.running && f.procs.find((p) => p.pid === f.running).state !== 'running') okInv = false; });
}
eq('Generated scenarios are always legal (200 seeds)', okLegal, true);
eq('At most one running process in any frame', okInv, true);
eq('Generator is reproducible', JSON.stringify(S.generate(3, 20, 7)), JSON.stringify(S.generate(3, 20, 7)));
eq('PC advances after a run slice', r.frames[5].procs[0].pc - r.frames[0].procs[0].pc, 12);
console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
