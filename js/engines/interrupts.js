/* Tier 2C: interrupts, exceptions and system calls. Pure logic, no DOM.
   One CPU runs a user program (a list of instructions). Three things can pull it into the kernel:
     syscall   the program asks the OS for a service (trap instruction, e.g. "syscall" / "int 0x80")
     exception the program itself faults (page fault, vector 14)
     interrupt a device raises a hardware interrupt at a time you choose (timer, keyboard, disk, nic)
   Entering the kernel always costs a mode switch: save the user state, switch to kernel mode, jump through a table
   (the syscall table or the interrupt descriptor table). Leaving costs another (iret / sysret). Each phase is one tick.
   While the CPU saves or restores state it is not interruptible. In the body of a handler it may be, depending on the
   "interrupts enabled in the kernel" switch, and only by a HIGHER-priority device (lower number = higher priority).
   Interrupts are checked at the start of every tick. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_TICKS = 300;
  // Linux x86-64 system call numbers; "k" = ticks the kernel handler runs (a teaching figure).
  const SYSCALLS = { read: { no: 0, k: 3 }, write: { no: 1, k: 2 }, open: { no: 2, k: 3 }, close: { no: 3, k: 1 }, getpid: { no: 39, k: 1 }, fork: { no: 57, k: 4 }, exit: { no: 60, k: 1 } };
  // IRQ lines as the PC places them behind the interrupt table: vector = 32 + IRQ. Lower prio number = more urgent.
  const DEVICES = { timer: { vec: 32, prio: 1, isr: 1 }, keyboard: { vec: 33, prio: 3, isr: 1 }, nic: { vec: 43, prio: 2, isr: 1 }, disk: { vec: 46, prio: 2, isr: 2 } };
  const FAULT = { vec: 14, k: 3 };

  function parse(program, irqs) {
    const errors = [], items = [], events = [];
    String(program || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      let m;
      if ((m = /^compute\s+(\d+)$/i.exec(line))) { if (+m[1] < 1 || +m[1] > 40) errors.push('Program line ' + (i + 1) + ': compute 1 to 40 ticks.'); else items.push({ op: 'compute', n: +m[1] }); }
      else if ((m = /^syscall\s+(\w+)(?:\s+(\d+))?$/i.exec(line))) {
        const nm = m[1].toLowerCase(); if (!SYSCALLS[nm]) errors.push('Program line ' + (i + 1) + ': unknown syscall "' + m[1] + '". Known: ' + Object.keys(SYSCALLS).join(', ') + '.');
        else if (m[2] !== undefined && (+m[2] < 1 || +m[2] > 20)) errors.push('Program line ' + (i + 1) + ': kernel time must be 1 to 20 ticks.');
        else items.push({ op: 'syscall', name: nm, k: m[2] !== undefined ? +m[2] : SYSCALLS[nm].k });
      } else if (/^fault$/i.test(line)) items.push({ op: 'fault' });
      else errors.push('Program line ' + (i + 1) + ': use "compute N", "syscall NAME [ticks]" or "fault".');
    });
    if (!items.length) errors.push('Enter at least one instruction.'); if (items.length > 20) errors.push('At most 20 instructions.');
    String(irqs || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      const m = /^(\d+)\s+(\w+)$/.exec(line);
      if (!m || !DEVICES[m[2].toLowerCase()]) errors.push('Interrupt line ' + (i + 1) + ': use "time device" with device one of ' + Object.keys(DEVICES).join(', ') + '.');
      else if (+m[1] > 150) errors.push('Interrupt line ' + (i + 1) + ': time must be 0 to 150.');
      else events.push({ at: +m[1], dev: m[2].toLowerCase() });
    });
    if (events.length > 12) errors.push('At most 12 interrupts.');
    return { items, events: events.sort((a, b) => a.at - b.at), errors };
  }

  function run(cfg) {
    const parsed = parse(cfg.program, cfg.irqs); if (parsed.errors.length) return { ok: false, errors: parsed.errors };
    const nested = cfg.nested === true || cfg.nested === 'yes';
    const { items } = parsed; const future = parsed.events.map((e, i) => ({ ...e, id: i, ...DEVICES[e.dev], taken: -1, done: -1 }));
    const stack = [], frames = []; let pending = [], pc = 0, left = items[0].n || 0, t = 0, ended = false;
    const lat = [];
    const label = (e) => (e.type === 'syscall' ? 'syscall ' + e.name : e.type === 'exc' ? 'page fault' : e.dev + ' IRQ');
    const stats = { user: 0, kernel: 0, idle: 0, switches: 0, syscalls: 0, interrupts: 0, exceptions: 0, maxDepth: 0 };

    while (t < MAX_TICKS && (!ended || pending.length || future.some((e) => e.taken < 0) || stack.length)) {
      const notes = [];
      future.forEach((e) => { if (e.taken < 0 && e.at === t) { pending.push(e); notes.push(e.dev + ' raises its interrupt line (vector ' + e.vec + ')'); } });
      pending.sort((a, b) => a.prio - b.prio || a.at - b.at || a.id - b.id);
      if (pending.length) {
        const top = stack[stack.length - 1];
        const can = !top || (nested && top.phase === 'body' && (top.type !== 'isr' || pending[0].prio < top.prio));
        if (can) {
          const e = pending.shift(); e.taken = t; stack.push({ type: 'isr', dev: e.dev, vec: e.vec, prio: e.prio, phase: 'enter', left: 1, body: e.isr, irq: e });
          stats.interrupts++; if (!top) stats.switches++;
          notes.push('CPU takes the ' + e.dev + ' interrupt' + (top ? ' (nested inside ' + label(top) + ' because its priority ' + e.prio + ' beats ' + (top.type === 'isr' ? top.prio : 'a plain handler') + ')' : '') + '; it waited ' + (t - e.at) + ' tick' + (t - e.at === 1 ? '' : 's'));
        } else if (top) notes.push('interrupt(s) pending (' + pending.map((e) => e.dev).join(', ') + ') but the CPU ' + (top.phase !== 'body' ? 'is saving/restoring state and cannot be interrupted' : nested ? 'is running an equal or higher priority handler' : 'has interrupts disabled in the kernel') + ': they wait');
      }
      stats.maxDepth = Math.max(stats.maxDepth, stack.length);
      let action = '', mode = stack.length ? 'kernel' : (ended ? 'idle' : 'user'), running = '';
      if (!stack.length && !ended) {
        const it = items[pc];
        if (it.op === 'compute') { running = 'user: compute (' + (it.n - left + 1) + ' of ' + it.n + ')'; action = 'The program runs ordinary instructions in user mode.'; left--; if (left === 0) { pc++; if (pc >= items.length) { ended = true; } else left = items[pc].n || 0; } }
        else {
          const e = it.op === 'syscall' ? { type: 'syscall', name: it.name, vec: 128, prio: 99, phase: 'enter', left: 1, body: it.k, item: it } : { type: 'exc', vec: FAULT.vec, prio: 99, phase: 'enter', left: 1, body: FAULT.k, item: it };
          stack.push(e); stats.switches++; if (e.type === 'syscall') stats.syscalls++; else stats.exceptions++;
          stats.maxDepth = Math.max(stats.maxDepth, stack.length); mode = 'kernel';
          notes.push(it.op === 'syscall' ? 'program executes the trap instruction for ' + it.name + '() (number ' + SYSCALLS[it.name].no + ')' : 'program touches a page that is not in memory: the MMU raises exception 14');
        }
      } else if (!stack.length && ended) { running = 'idle'; action = 'The program has finished; the CPU idles until an interrupt arrives.'; }
      const stackNow = stack.map((e) => label(e) + ' (' + e.phase + ')').reverse();   // what is on the stack DURING this tick
      if (stack.length && !running) {
        const e = stack[stack.length - 1];
        if (e.phase === 'enter') { running = label(e) + ': enter'; action = e.type === 'syscall' ? 'Hardware saves the user PC and flags, switches to kernel mode and the kernel stack, and looks up the call number in the syscall table.' : e.type === 'exc' ? 'The CPU saves the faulting instruction\'s address, switches to kernel mode and jumps through interrupt table entry 14.' : 'The CPU finishes the current instruction, saves PC and flags, switches to kernel mode and jumps through interrupt table entry ' + e.vec + ' to the ' + e.dev + ' handler.'; e.left--; if (e.left === 0) { e.phase = 'body'; e.left = e.body; } }
        else if (e.phase === 'body') { const doneTicks = e.body - e.left + 1; running = label(e) + ': handler (' + doneTicks + ' of ' + e.body + ')'; action = e.type === 'syscall' ? 'The kernel does the work of ' + e.name + '() on behalf of the program.' : e.type === 'exc' ? 'The kernel finds the page on disk and loads it into a free frame, then fixes the page table.' : 'The interrupt service routine (ISR) services the ' + e.dev + ' and acknowledges it.'; e.left--; if (e.left === 0) { e.phase = 'exit'; e.left = 1; } }
        else { running = label(e) + ': return'; action = e.type === 'syscall' ? 'sysret / iret: restore the saved PC and flags and drop back to ' + (stack.length > 1 ? 'the interrupted handler' : 'user mode') + '.' : 'iret: restore the saved state and resume what was interrupted' + (stack.length > 1 ? ' (a handler, still in kernel mode)' : ' (user mode)') + '.'; e.left--;
          if (e.left === 0) { stack.pop(); if (!stack.length) stats.switches++;
            if (e.type === 'isr') { e.irq.done = t + 1; lat.push({ dev: e.dev, raised: e.irq.at, taken: e.irq.taken, latency: e.irq.taken - e.irq.at, done: t + 1 }); }
            else if (e.type === 'syscall' && e.name === 'exit') { ended = true; notes.push('exit() never returns: the process is gone'); }
            else if (e.type === 'syscall' || e.type === 'exc') { pc++; if (pc >= items.length) ended = true; else left = items[pc].n || 0; if (e.type === 'exc') notes.push('the faulting instruction is retried and now succeeds'); } } }
      }
      if (mode === 'user') stats.user++; else if (mode === 'kernel') stats.kernel++; else stats.idle++;
      frames.push({ t, mode, running, action, stack: stackNow, pending: pending.map((e) => e.dev), notes });
      t++;
    }
    if (t >= MAX_TICKS) return { ok: false, errors: ['Simulation passed ' + MAX_TICKS + ' ticks. Shorten the program.'] };
    return { ok: true, cfg: { nested }, frames, stats, latencies: lat, ticks: frames.length, items, tables: { SYSCALLS, DEVICES, FAULT } };
  }

  const PRESETS = [
    { id: 'syscall', name: 'One system call', note: 'getpid costs 1 tick of real work but 2 ticks of mode switching: that overhead is why syscalls are not free.', state: { program: 'compute 2\nsyscall getpid\ncompute 2', irqs: '', nested: 'yes' } },
    { id: 'timer', name: 'A timer interrupt mid-program', note: 'The timer fires while the program computes. The CPU saves the program, runs the ISR, and resumes where it left off.', state: { program: 'compute 6', irqs: '2 timer', nested: 'yes' } },
    { id: 'nested', name: 'Priority: timer beats keyboard', note: 'The keyboard handler is interrupted by the more urgent timer, then resumes. Switch "interrupts enabled in the kernel" to no to see the timer wait.', state: { program: 'compute 10', irqs: '1 keyboard\n2 timer', nested: 'yes' } },
    { id: 'masked', name: 'Interrupt during a syscall', note: 'The disk interrupt arrives while read() runs. With kernel interrupts disabled it waits until the syscall returns; with them enabled it is served at once (latency 0).', state: { program: 'compute 1\nsyscall read\ncompute 2', irqs: '3 disk', nested: 'no' } },
    { id: 'fault', name: 'Page fault (an exception)', note: 'The program itself causes the trap. After the kernel loads the page, the same instruction runs again.', state: { program: 'compute 2\nfault\ncompute 2', irqs: '', nested: 'yes' } }
  ];
  NS.interrupts = { MAX_TICKS, SYSCALLS, DEVICES, FAULT, parse, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.interrupts;
})(typeof window !== 'undefined' ? window : globalThis);
