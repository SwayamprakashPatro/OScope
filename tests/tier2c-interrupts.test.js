// Tier 2C: interrupts, exceptions, system calls. Expected values derived by hand.
const X = require('../js/engines/interrupts.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const go = (program, irqs, nested) => X.run({ program, irqs: irqs || '', nested: nested === undefined ? 'yes' : nested });
const modes = (r) => r.frames.map((f) => f.mode[0]).join('');   // u / k / i

// Syscall: compute 2 (t0,t1) + trap(t2) + body(t3) + return(t4)
let r = go('compute 2\nsyscall getpid');
eq('5 ticks: uukkk', modes(r), 'uukkk');
eq('user 2, kernel 3, mode switches 2', [r.stats.user, r.stats.kernel, r.stats.switches], [2, 3, 2]);
eq('syscall count', r.stats.syscalls, 1);
eq('trap/body/return phases named', r.frames.slice(2).map((f) => f.running.replace(/^syscall getpid: /, '').replace(/ \(.*/, '')), ['enter', 'handler', 'return']);
eq('stack while in the handler', r.frames[3].stack, ['syscall getpid (body)']);
eq('stack empty in user mode', r.frames[0].stack, []);

// Timer interrupt at t=1 during compute 2 then a syscall: t0 u, t1-t3 ISR (enter, body, return), t4 u, t5-t7 syscall -> 8 ticks
r = go('compute 2\nsyscall getpid', '1 timer');
eq('timer at t=1: ukkkukkk', modes(r), 'ukkkukkk');
eq('latency 0', r.latencies, [{ dev: 'timer', raised: 1, taken: 1, latency: 0, done: 4 }]);
eq('user compute resumes where it stopped: 2 user ticks in total', r.stats.user, 2);
eq('mode switches: 2 for the ISR + 2 for the syscall', r.stats.switches, 4);

// Interrupt during the syscall body (t=3). Interrupts disabled in kernel: waits until return -> taken at t=5, latency 2.
r = go('compute 2\nsyscall getpid', '3 disk', 'no');
eq('masked: disk waits for the syscall to finish', [r.latencies[0].taken, r.latencies[0].latency], [5, 2]);
eq('masked: pending list shows disk at tick 3', r.frames[3].pending, ['disk']);
// Enabled: the syscall is in its body at t=3 so the disk interrupt is taken at once; the syscall resumes afterwards.
r = go('compute 2\nsyscall getpid', '3 disk', 'yes');
eq('enabled: taken at t=3, latency 0', [r.latencies[0].taken, r.latencies[0].latency], [3, 0]);
eq('enabled: nested depth 2', r.stats.maxDepth, 2);
eq('enabled: syscall handler resumes after the disk ISR (disk ISR is 2 ticks + 2 mode ticks = 4)', r.ticks, 5 + 4);
// Interrupt during the RETURN tick (t=4, state is being restored): cannot be taken, waits until user mode -> taken at 5
r = go('compute 2\nsyscall getpid', '4 disk', 'yes');
eq('not interruptible while restoring state: taken at 5, latency 1', [r.latencies[0].taken, r.latencies[0].latency], [5, 1]);
// Interrupt raised exactly when the CPU is about to trap (t=2): it is in user mode, so the interrupt goes first
r = go('compute 2\nsyscall getpid', '2 disk', 'yes');
eq('interrupt at the trap instruction is taken first (user mode): latency 0, syscall runs after', [r.latencies[0].taken, r.latencies[0].latency, modes(r)], [2, 0, 'uukkkkkkk']);

// Priority nesting: keyboard at 1 (prio 3), timer at 2 (prio 1)
r = go('compute 10', '1 keyboard\n2 timer', 'yes');
eq('timer interrupts the keyboard ISR', [r.latencies.map((l) => l.dev), r.stats.maxDepth], [['timer', 'keyboard'], 2]);
eq('timer latency 0; keyboard finishes later than the timer', [r.latencies[0].latency, r.latencies[0].done < r.latencies[1].done], [0, true]);
eq('keyboard timeline: enter t1, [timer t2-t4], body t5, return t6 -> done 7', r.latencies[1].done, 7);
r = go('compute 10', '1 keyboard\n2 timer', 'no');
eq('without nesting the timer waits until keyboard returns: taken at 4, latency 2', [r.latencies[0].dev, r.latencies[0].taken, r.latencies[0].latency], ['keyboard', 1, 0]);
eq('...second is the timer, taken at 4', [r.latencies[1].dev, r.latencies[1].taken, r.latencies[1].latency], ['timer', 4, 2]);
r = go('compute 10', '1 timer\n2 keyboard', 'yes');
eq('a LOWER priority interrupt does not preempt a higher one (keyboard waits for the timer)', [r.latencies[0].dev, r.latencies[1].dev, r.latencies[1].latency], ['timer', 'keyboard', 2]);
r = go('compute 10', '2 keyboard\n2 timer', 'no');
eq('simultaneous interrupts: higher priority (timer) first', r.latencies.map((l) => l.dev), ['timer', 'keyboard']);
// equal priority nic and disk (both 2): earlier arrival first, no preemption
r = go('compute 10', '1 disk\n2 nic', 'yes');
eq('equal priority does not preempt', r.latencies.map((l) => l.dev), ['disk', 'nic']);

// Page fault: compute 1 (t0), fault enter t1, body t2-t4, return t5, compute again? no: second item compute 1 at t6 -> 7 ticks
r = go('compute 1\nfault\ncompute 1');
eq('fault timeline: ukkkkku', modes(r), 'ukkkkku');
eq('exception counted, not a syscall', [r.stats.exceptions, r.stats.syscalls], [1, 0]);
// exit syscall ends the program
r = go('syscall exit\ncompute 5');
eq('exit never returns: 3 ticks, compute never runs', [r.ticks, r.stats.user], [3, 0]);
// interrupt after the program: idle until it arrives
r = go('compute 1', '5 timer');
eq('idle ticks until the late interrupt', [modes(r), r.stats.idle], ['uiiiikkk', 4]);
// kernel override time
r = go('syscall read 6');
eq('syscall kernel time override: 1 + 6 + 1 = 8', r.ticks, 8);
eq('default read = 3 ticks of work', go('syscall read').ticks, 5);
eq('syscall numbers follow Linux x86-64: read 0, write 1, getpid 39, fork 57, exit 60', [X.SYSCALLS.read.no, X.SYSCALLS.write.no, X.SYSCALLS.getpid.no, X.SYSCALLS.fork.no, X.SYSCALLS.exit.no], [0, 1, 39, 57, 60]);
eq('vectors: timer 32, keyboard 33, disk 46, page fault 14', [X.DEVICES.timer.vec, X.DEVICES.keyboard.vec, X.DEVICES.disk.vec, X.FAULT.vec], [32, 33, 46, 14]);

// Errors
eq('unknown syscall', go('syscall frobnicate').ok, false); eq('unknown device', go('compute 1', '1 modem').ok, false);
eq('bad line', go('jump 4').ok, false); eq('empty program', go('').ok, false); eq('compute 0', go('compute 0').ok, false);
eq('too many ticks', go('compute 40\ncompute 40\ncompute 40\ncompute 40\ncompute 40\ncompute 40\ncompute 40\ncompute 40').ok, false);

// Random invariants
let seed = 23; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0; const devs = Object.keys(X.DEVICES), sysn = Object.keys(X.SYSCALLS).filter((s) => s !== 'exit');
for (let k = 0; k < 400; k++) {
  const P = []; for (let i = 0, n = 1 + rnd(6); i < n; i++) { const o = rnd(4); P.push(o === 0 ? 'syscall ' + sysn[rnd(sysn.length)] : o === 1 ? 'fault' : 'compute ' + (1 + rnd(5))); }
  const I = []; for (let i = 0, n = rnd(6); i < n; i++) I.push(rnd(30) + ' ' + devs[rnd(devs.length)]);
  const nested = rnd(2) ? 'yes' : 'no', x = go(P.join('\n'), I.join('\n'), nested); if (!x.ok) { bad++; console.log('unexpected', P, I, x.errors); continue; }
  const exp = P.reduce((a, l) => a + (/^compute/.test(l) ? +l.split(' ')[1] : 0), 0);
  if (x.stats.user !== exp) { bad++; console.log('user work not conserved', P, I); }          // every compute tick runs exactly once
  if (x.stats.user + x.stats.kernel + x.stats.idle !== x.ticks) bad++;
  if (x.stats.interrupts !== I.length || x.latencies.length !== I.length) { bad++; console.log('lost an interrupt', P, I); }
  if (x.latencies.some((l) => l.latency < 0 || l.taken < l.raised)) bad++;
  if (nested === 'no' && x.stats.maxDepth > 1) bad++;       // no nesting when kernel interrupts are disabled
  if (x.stats.switches % 2) bad++;                           // every entry from user mode has a matching return
  x.frames.forEach((f) => { if ((f.mode === 'user') !== (f.stack.length === 0 && f.mode !== 'idle')) bad++; });
}
eq('400 random programs: user work conserved, every interrupt served once, no nesting when disabled, switches in pairs', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
