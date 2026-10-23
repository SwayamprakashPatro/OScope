/* Lab: Process states. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: states) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "states",
  "area": "processes",
  "section": "lifecycle",
  "title": "Process states",
  "view": "states",
  "level": "core",
  "summary": "What states does a process move through, and what triggers each move?",
  "keywords": [
    "process state diagram",
    "five-state model",
    "PCB",
    "process control block",
    "context switch",
    "ready queue",
    "waiting queue",
    "blocked",
    "dispatch",
    "preemption",
    "timeout",
    "I/O wait",
    "new",
    "terminated",
    "running",
    "ready"
  ],
  "learn": {
    "idea": "A process is not simply running or not running. It moves between states as the scheduler and I/O events act on it, and only a Ready process can be given the CPU.",
    "hook": "Ready, Run, Wait. Only Running owns the CPU; only Ready can be chosen; Waiting needs an event first.",
    "deep": [
      "The five states: New, Ready, Running, Waiting (Blocked) and Terminated.",
      "Legal moves: admit (New to Ready), dispatch (Ready to Running), timeout (Running to Ready), wait for I/O or an event (Running to Waiting), event done (Waiting to Ready), exit (Running to Terminated).",
      "A process never goes from Waiting straight to Running. When its event finishes it becomes Ready and must be chosen again.",
      "A context switch saves the old process registers and program counter into its PCB and loads the new one from its PCB. It is pure overhead."
    ],
    "mistakes": [
      "Drawing a Waiting to Running arrow.",
      "Confusing Ready with Waiting: Ready has everything except the CPU; Waiting is missing an event.",
      "Thinking a process only leaves Running by finishing. A timer can preempt it, and I/O can block it."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
