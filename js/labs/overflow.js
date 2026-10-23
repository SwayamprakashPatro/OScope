/* Lab: Buffer overflow & stack smashing. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: overflow) and the logic by js/engines/overflow.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'overflow',
    area: 'system',
    section: 'protect',
    title: "Buffer overflow",
    view: 'overflow',
    level: 'advanced',
    summary: 'What happens when input is longer than its buffer, and how canaries, NX, ASLR and bounds checks each defend (an abstract toy model).',
    keywords: ["Buffer overflow & stack smashing", 
      'buffer overflow', 'stack smashing', 'stack frame', 'call stack', 'return address', 'saved frame pointer', 'stack canary',
      'NX', 'DEP', 'W^X', 'ASLR', 'address space layout randomization', 'strcpy', 'strncpy', 'bounds checking', 'segmentation fault',
      'memory safety', 'stack overflow', 'control-flow hijack', 'return-to-libc', 'ROP', 'return oriented programming', 'privilege escalation',
      'memory corruption', 'secure coding'
    ],
    learn: {
      idea: 'A function keeps its local variables, the caller\'s saved registers and its return address together in one stack frame. If the function copies more bytes into a buffer than it holds, the extra bytes spill over the neighbours, and whoever controls the input controls what lands there.',
      hook: 'Buffers fill upward, the return address sits above them. Fill too much and you write over where the function goes next. (Defences: Canary, No-execute, Randomize, Check.)',
      deep: [
        'The stack grows toward lower addresses, but a copy walks toward higher ones, so a long string runs from the buffer through any neighbouring local variables, the canary, the saved frame pointer and then the return address.',
        'Overwriting a neighbouring variable (like an "is admin" flag) already changes behaviour without touching any code. Overwriting the return address changes where the function goes when it returns.',
        'Stack canary: a secret value placed between the buffer and the saved registers and checked before return. A linear overflow has to cross it, so the check fails and the program aborts before the corrupted return address is used. It does not stop overwriting the neighbouring variables below it, or an attacker who can read or guess the canary.',
        'NX / DEP (no-execute): memory that is writable is not executable. Injected data on the stack can no longer be run as code, but the attacker can still return into code that already exists (return-to-function, return-to-libc, ROP).',
        'ASLR: the program and its libraries are loaded at random addresses, so a hard-coded target address misses. It is defeated if any address leaks, and on small address spaces by guessing.',
        'The real fix is not to write out of bounds: bounded copies, checked lengths, or memory-safe languages. Defences like canaries, NX and ASLR only make a remaining bug harder to exploit.'
      ],
      mistakes: [
        'Thinking strncpy is always safe. It can leave the buffer unterminated when the input fills it, and it hides the real bug if the length passed is wrong.',
        'Believing a canary stops every overflow. Data below the canary (here the auth flag) can still be corrupted.',
        'Believing NX removes the problem: returning into existing code needs no injected instructions.',
        'Treating ASLR as a security fix. It is a mitigation that depends on addresses staying secret.',
        'Confusing stack overflow (running out of stack by deep recursion) with a stack buffer overflow (writing past a buffer).'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
