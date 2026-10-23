// Tier 2C: fork/exec/wait/exit. Expected values derived by hand.
const F = require('../js/engines/forkwait.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (script, initReaps) => F.run({ script, initReaps: initReaps || 'yes' });
const st = (f) => f.procs.map((p) => p.pid + ':' + p.name + ':' + p.state + ':' + p.ppid).join(' ');

let r = go('2: fork\n3: exec ls\n2: wait\n3: exit 0');
eq('start: init and shell', st(r.frames[0]), '1:init:running:0 2:shell:running:1');
eq('after fork: child 3 is a copy of the shell', st(r.frames[1]), '1:init:running:0 2:shell:running:1 3:shell:running:2');
eq('after exec: same pid, new program', st(r.frames[2]), '1:init:running:0 2:shell:running:1 3:ls:running:2');
eq('wait before the child exits blocks the parent', st(r.frames[3]), '1:init:running:0 2:shell:blocked:1 3:ls:running:2');
eq('child exit wakes the parent and is reaped at once', st(r.frames[4]), '1:init:running:0 2:shell:running:1');
eq('wake-up event recorded', r.frames[4].events.length, 2);
eq('final: no zombies, nobody blocked', [r.final.zombies, r.final.blocked], [[], []]);

// Zombie: child exits, parent has not waited
r = go('2: fork\n3: exit 7');
eq('exit without a waiting parent leaves a zombie with its code', r.frames[2].procs.find((p) => p.pid === 3), { pid: 3, ppid: 2, name: 'shell', state: 'zombie', code: 7 });
r = go('2: fork\n3: exit 7\n2: wait');
eq('a later wait collects the zombie', st(r.frames[3]), '1:init:running:0 2:shell:running:1');
eq('...and says which code it saw', /code 7/.test(r.frames[3].events[0]), true);
r = go('2: fork\n2: fork\n3: exit 1\n4: exit 2\n2: wait');
eq('wait collects the lowest-pid zombie first (3) and leaves 4', st(r.frames[5]), '1:init:running:0 2:shell:running:1 4:shell:zombie:2');
eq('final zombies list', r.final.zombies, [4]);

// Orphan adopted and reaped by init
r = go('2: fork\n2: exit 0\n3: exec sleep\n3: exit 0');
eq('shell exits: its parent is init, which reaps it at once; the child is re-parented to init', st(r.frames[2]), '1:init:running:0 3:shell:running:1');
eq('init reaps the zombie shell right away', r.frames[2].events.some((e) => /^pid 1 reaped zombie 2/.test(e)), true);
eq('note says orphan', /ORPHAN/.test(r.frames[2].note), true);
eq('orphan then execs and exits; init reaps it too', st(r.frames[4]), '1:init:running:0');

// Buggy init: zombies pile up under init
r = go('2: fork\n2: exit 0\n3: exit 0', 'no');
eq('buggy init leaves the exited shell as a zombie', st(r.frames[2]), '1:init:running:0 2:shell:zombie:1 3:shell:running:1');
eq('and the orphan too once it exits', r.final.zombies, [2, 3]);
r = go('2: fork\n2: exit 0\n3: exit 0\n1: wait', 'no');
eq('init finally calling wait reaps the lowest pid zombie', r.final.zombies, [3]);

// Orphans of a deeper tree all go to init, not to the grandparent
r = go('2: fork\n3: fork\n3: fork\n3: exit 0', 'yes');
eq('children 4 and 5 of pid 3 become children of init; pid 3 (child of shell) is a zombie', st(r.frames[4]), '1:init:running:0 2:shell:running:1 3:shell:zombie:2 4:shell:running:1 5:shell:running:1');

// Errors and no-ops
r = go('2: wait');
eq('wait with no children returns -1', /ECHILD/.test(r.frames[1].note), true);
eq('and changes nothing', st(r.frames[1]), st(r.frames[0]));
r = go('9: fork');
eq('call from a pid that does not exist is ignored', [r.frames[1].ok, /does not exist/.test(r.frames[1].note)], [false, true]);
r = go('2: fork\n3: exit 0\n3: fork');
eq('a zombie cannot make calls', [r.frames[3].ok, /zombie/.test(r.frames[3].note)], [false, true]);
r = go('2: fork\n2: wait\n2: fork');
eq('a blocked process cannot make calls', [r.frames[3].ok, /asleep/.test(r.frames[3].note)], [false, true]);
r = go('2: fork\n3: exit 0\n2: wait\n3: exit 0');
eq('reaped pid is gone for good', r.frames[4].ok, false);
eq('syntax error', F.run({ script: '2 fork' }).ok, false);
eq('exec without name', F.run({ script: '2: exec' }).ok, false);
eq('exit with a non-number', F.run({ script: '2: exit x' }).ok, false);
eq('empty script', F.run({ script: '' }).ok, false);
eq('too many calls', F.run({ script: new Array(61).fill('2: fork').join('\n') }).ok, false);
let big = F.run({ script: new Array(40).fill('2: fork').join('\n') });
eq('process table limit protects the page', big.frames[big.frames.length - 1].ok, false);

// Random invariants: pids unique, every live process (not init) has a live parent, no process is its own ancestor,
// a blocked process always has a live non-zombie child or a pending child, zombies never have a blocked parent waiting
let seed = 3; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 400; k++) {
  const ls = []; for (let i = 0, n = 3 + rnd(25); i < n; i++) ls.push((1 + rnd(8)) + ': ' + ['fork', 'fork', 'wait', 'exit ' + rnd(3), 'exec p' + rnd(3)][rnd(5)]);
  const x = F.run({ script: ls.join('\n'), initReaps: rnd(2) ? 'yes' : 'no' }); if (!x.ok) { bad++; console.log('unexpected', ls); continue; }
  x.frames.forEach((f) => {
    const ids = f.procs.map((p) => p.pid); if (new Set(ids).size !== ids.length) bad++;
    f.procs.forEach((p) => { if (p.pid === 1) return; const par = f.procs.find((q) => q.pid === p.ppid); if (!par) { bad++; console.log('dangling parent', ls); } else { let a = par, n = 0; while (a && a.pid !== 1 && n++ < 50) a = f.procs.find((q) => q.pid === a.ppid); if (n >= 50) bad++; } });
    f.procs.filter((p) => p.state === 'blocked').forEach((p) => { if (!f.procs.some((c) => c.ppid === p.pid && c.state !== 'zombie')) { bad++; console.log('blocked with nothing to wait for', ls); } });
    f.procs.filter((p) => p.state === 'zombie' && p.pid !== 1).forEach((z) => { const par = f.procs.find((q) => q.pid === z.ppid); if (par && par.state === 'blocked') { bad++; console.log('zombie under a waiting parent', ls); } });
  });
}
eq('400 random scripts keep the process table consistent', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
