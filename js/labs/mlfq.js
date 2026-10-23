/* Lab: Multilevel queues (MLQ / MLFQ). Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mlfq-view.js. Logic: js/engines/mlfq.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "mlfq",
    "area": "processes",
    "section": "scheduling",
    "title": "MLQ & MLFQ",
    "view": "mlfq",
    "level": "advanced",
    "summary": "Several priority queues with their own time slices; MLFQ moves jobs between them by watching their behaviour, with a priority boost against starvation.",
    "keywords": ["Multilevel queues (MLQ / MLFQ)", 
      "mlfq",
      "mlq",
      "multilevel queue",
      "multilevel feedback queue",
      "feedback queue",
      "queue demotion",
      "priority boost",
      "time slice",
      "quantum",
      "starvation",
      "gaming the scheduler",
      "interactive jobs",
      "cpu bound"
    ],
    "learn": {
      "idea": "Instead of one ready queue, keep several, each with its own time slice. A higher queue always runs first. MLFQ learns each job: using up the whole slice means it is CPU-bound, so it sinks; giving up the CPU early for I/O means it is interactive, so it stays high.",
      "hook": "Short and sleepy stays up, long and greedy sinks, the boost lifts everyone.",
      "deep": [
        "MLFQ approximates shortest-job-first without knowing job lengths: new jobs start on top, so short ones finish before they sink.",
        "Without a periodic boost, a stream of short jobs can starve a long one forever.",
        "A job that blocks just before its slice ends keeps its level, so a clever program can game the scheduler. Real systems track total time used at a level instead.",
        "MLQ is the fixed version: each class of job (system, interactive, batch) lives in its own queue with its own policy.",
        "Tuning knobs: number of queues, slice per queue (usually longer lower down) and the boost period."
      ],
      "mistakes": [
        "Thinking MLQ and MLFQ are the same: MLQ never moves a job between queues.",
        "Forgetting that a lower queue runs only when every queue above is empty.",
        "Expecting the boost to be optional: without it starvation is real."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
