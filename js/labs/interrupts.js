/* Lab: Interrupts and system calls. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/interrupts-view.js. Logic: js/engines/interrupts.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "interrupts",
    "area": "system",
    "section": "kernel",
    "title": "Interrupts & syscalls",
    "view": "interrupts",
    "level": "advanced",
    "summary": "How the CPU enters the kernel: system calls, page-fault exceptions and hardware interrupts, with mode switches, priorities, masking and nesting.",
    "keywords": ["Interrupts and system calls", 
      "interrupt",
      "interrupts",
      "system call",
      "syscall",
      "trap",
      "exception",
      "user mode",
      "kernel mode",
      "mode switch",
      "isr",
      "interrupt service routine",
      "interrupt vector",
      "idt",
      "interrupt latency",
      "nested interrupt",
      "interrupt priority",
      "page fault",
      "iret"
    ],
    "learn": {
      "idea": "A program runs in user mode and cannot touch hardware. To get help it traps into the kernel: a system call it asks for, an exception it causes, or a hardware interrupt from a device. The CPU saves state, switches to kernel mode, jumps through a table to a handler, and returns afterwards.",
      "hook": "Trap in, table lookup, handle, return out. Syscall = I ask, exception = I tripped, interrupt = someone knocked.",
      "deep": [
        "A system call number selects an entry in the syscall table (on Linux x86-64: read 0, write 1, getpid 39, fork 57, exit 60).",
        "Hardware interrupts are looked up in the interrupt descriptor table by vector number (timer 32, keyboard 33 on a PC).",
        "Each mode switch has a real cost, which is why batching syscalls (or avoiding them) speeds programs up.",
        "While state is saved or restored the CPU cannot be interrupted. In a handler, a more urgent interrupt can nest on top.",
        "Interrupt latency is the time from the device raising the line to the ISR starting; masking interrupts increases it."
      ],
      "mistakes": [
        "Thinking a syscall is an ordinary function call: it changes privilege level.",
        "Treating a page fault as an error: it is a normal exception the kernel fixes, then the instruction is retried.",
        "Forgetting that long handlers with interrupts masked delay everything else."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
