/* Lab: CPU scheduling. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: scheduling) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "scheduling",
  "area": "processes",
  "section": "scheduling",
  "title": "CPU scheduling",
  "view": "scheduling",
  "level": "core",
  "summary": "Many processes want one CPU: who runs next, and for how long?",
  "keywords": [
    "FCFS",
    "First Come First Served",
    "SJF",
    "Shortest Job First",
    "SRTF",
    "Shortest Remaining Time First",
    "Round Robin",
    "RR",
    "time quantum",
    "Priority scheduling",
    "preemptive",
    "non-preemptive",
    "Gantt chart",
    "waiting time",
    "turnaround time",
    "response time",
    "convoy effect",
    "CPU scheduler",
    "Aging",
    "Priority aging",
    "starvation",
    "Lottery scheduling",
    "tickets",
    "proportional share"
  ],
  "learn": {
    "idea": "Many processes want one CPU. The scheduler decides who runs next and for how long. Each rule trades average waiting time against fairness and responsiveness.",
    "hook": "FCFS is a queue at a shop. SJF is the express lane. Round Robin gives everyone a turn on a timer.",
    "deep": [
      "Turnaround = completion - arrival. Waiting = turnaround - burst. Response = first run - arrival.",
      "SJF gives the smallest average waiting time of any non-preemptive rule, but it needs the burst length in advance and can starve long jobs.",
      "SRTF is the preemptive form of SJF and gives the smallest average waiting time overall, at the price of more context switches.",
      "Round Robin with quantum q and n ready processes: nobody waits more than (n - 1) x q for their next turn. A huge q behaves like FCFS; a tiny q wastes time on context switches.",
      "Priority scheduling can starve low-priority jobs. Aging (slowly raising the priority of waiting jobs) fixes that.",
      "Convoy effect: one long job at the front of an FCFS queue makes every short job behind it wait. SJF, SRTF and Round Robin avoid it.",
      "Aging: after a process has waited N ticks its priority improves by one step. It keeps the boost while it runs and loses it if it is preempted. Starvation disappears without giving up priorities.",
      "Lottery scheduling: each process holds tickets and every quantum a random ticket is drawn. Over many draws the CPU share approaches the ticket share, and nobody starves. In a short run it can look unfair."
    ],
    "mistakes": [
      "Starting the clock at 0 when the first process arrives later: the CPU is idle until then.",
      "Mixing up turnaround time and waiting time.",
      "Ignoring the tie-break rule when two processes have the same burst or priority (the usual rule is arrival order).",
      "Round Robin conventions differ between textbooks when a new arrival and a preempted process join the queue at the same instant. Check your course rule.",
      "Expecting an exact split from lottery scheduling in a short run. It is random: only the long-run average follows the tickets.",
      "Choosing a tiny aging step: low-priority jobs then overtake urgent ones almost at once and the priorities mean nothing."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
