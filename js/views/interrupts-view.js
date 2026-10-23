/* Interrupts and system calls view: user/kernel mode timeline, the kernel stack at the chosen tick (nested handlers
   pile up), pending interrupts, and latency per interrupt. Everything comes from NS.interrupts.run. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, PV = NS.pv, X = NS.interrupts, P = X.PRESETS[0];
  const letter = (r) => (/^user: compute/.test(r) ? 'c' : /^idle/.test(r) ? '' : /^syscall/.test(r) ? 'S' : /^page fault/.test(r) ? 'F' : r[0].toUpperCase());
  const arrow = (r) => (/: enter$/.test(r) ? '↓' : /: return$/.test(r) ? '↑' : '');
  K.reg('interrupts', {
    key: 'interrupts', title: 'Interrupts and system calls', statsTitle: 'Costs and latency', visualTitle: 'User mode and kernel mode', label: 'Tick',
    intro: 'The CPU runs your program in user mode. It enters the kernel in exactly three ways: a system call the program asks for, an exception the program causes (a page fault), or a hardware interrupt from a device. Every entry costs a mode switch. Place interrupts in time and watch priority, masking and nesting.',
    defaults: P.state,
    presets: X.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'program', label: 'User program', type: 'area', rows: 6, hint: 'One instruction per line: compute N, syscall NAME [kernel ticks], fault. Syscalls: read, write, open, close, getpid, fork, exit.' },
      { key: 'irqs', label: 'Hardware interrupts', type: 'area', rows: 4, hint: 'One per line: "time device". Devices: timer (vector 32, most urgent), disk and nic (46, 43), keyboard (33, least urgent).' },
      { key: 'nested', label: 'Interrupts enabled in the kernel?', type: 'select', options: [['yes', 'Yes (can nest)'], ['no', 'No (wait for user mode)']] }],
    about: [['System call', 'A deliberate trap. The CPU saves the user PC, switches to kernel mode and the kernel stack, and looks the call number up in the syscall table (read = 0, write = 1, getpid = 39, fork = 57, exit = 60 on Linux x86-64).'], ['Exception', 'A trap caused by the program itself, such as a page fault (vector 14). The faulting instruction is retried afterwards.'], ['Interrupt', 'A signal from hardware. It is taken between instructions, looked up in the interrupt table by vector number, handled by an interrupt service routine (ISR), then the CPU returns with iret.'], ['Priority and masking', 'While state is being saved or restored the CPU cannot be interrupted. In a handler it may be, but only by something more urgent.'], ['Memory hook', 'Trap in, table lookup, handle, return out. Syscall = I ask, exception = I tripped, interrupt = someone knocked.']],
    compute: (s) => PV.withStart(X.run({ program: s.program, irqs: s.irqs, nested: s.nested })),
    draw: (f, i, sim) => {
      const T = sim.ticksFrames, now = i - 1, cur = f.start ? null : f;
      const raise = {}; sim.latencies.forEach((l) => { raise[l.raised] = l.dev; });
      const rows = [{ label: 'IRQ line', cell: (t) => (raise[t] ? { cls: 'cost', text: raise[t][0].toUpperCase(), title: raise[t] + ' interrupt raised' } : null) },
        { label: 'CPU mode', cell: (t) => { const fr = T[t]; if (!fr) return null; return { cls: fr.mode, text: fr.mode === 'user' ? 'U' : fr.mode === 'kernel' ? 'K' : '–', title: fr.running }; } },
        { label: 'Running', cell: (t) => { const fr = T[t]; if (!fr) return null; return { cls: fr.mode, text: letter(fr.running) + arrow(fr.running), title: fr.running }; } }];
      const stackBox = cur ? el('div', null, el('div', { class: 'pv-stack' }, el('div', { class: 'pv-st base' }, 'user program'), cur.stack.slice().reverse().map((s) => el('div', { class: 'pv-st' }, s))), el('p', { class: 'pv-act' }, el('b', null, cur.running + ': '), cur.action),
        el('div', { class: 'pv-qs' }, el('div', { class: 'pv-q' }, el('b', null, 'Pending IRQs'), cur.pending.length ? cur.pending.map((n) => PV.badge('warn', n)) : PV.empty()))) : null;
      return { visual: [PV.timeline({ ticks: T.length, now, rows, aria: 'Timeline: IRQ arrivals, CPU mode and what runs each tick' }), PV.legend([['user', 'U = user mode'], ['kernel', 'K = kernel mode'], ['', 'c compute, S syscall, F fault, T/K/N/D device ISR'], ['', '↓ entering the kernel, ↑ returning'], ['cost', 'letter on the IRQ line = interrupt raised']]),
        stackBox ? el('div', null, el('h4', null, 'Stack of what is running (top = running now)'), stackBox) : null],
        why: cur ? [cur.notes.length ? el('ul', { class: 'fv-steps' }, cur.notes.map((n) => el('li', null, n))) : el('p', { class: 'hint' }, 'No new events this tick.')] : [el('p', { class: 'hint' }, 'Step through to see the CPU cross into the kernel and back.')] };
    },
    stats: (f, sim) => [K.metrics([['Total ticks', sim.ticks], ['User', sim.stats.user], ['Kernel', sim.stats.kernel], ['Idle', sim.stats.idle], ['Mode switches', sim.stats.switches], ['Deepest nesting', sim.stats.maxDepth]]),
      sim.latencies.length ? K.table(['Interrupt', 'Raised', 'Taken', 'Latency', 'Finished'], sim.latencies.map((l) => [l.dev, l.raised, l.taken, l.latency, l.done])) : el('p', { class: 'hint' }, 'No hardware interrupts in this run. Add some above and compare latency with kernel interrupts on and off.'),
      el('p', { class: 'hint' }, 'Honest limits: one tick is one instruction and one phase; handler lengths are teaching figures, not measurements; no interrupt controller details (masking per line, EOI), no context switch to another process, and an exit syscall simply ends the program.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
