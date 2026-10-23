/* Lab: CFS (Linux fair scheduler). Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/cfs-view.js. Logic: js/engines/cfs.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "cfs",
    "area": "processes",
    "section": "scheduling",
    "title": "CFS (Linux)",
    "view": "cfs",
    "level": "advanced",
    "summary": "Linux's Completely Fair Scheduler: always run the task with the smallest virtual runtime; nice values change weights and slices.",
    "keywords": ["CFS (Linux fair scheduler)", 
      "cfs",
      "completely fair scheduler",
      "vruntime",
      "virtual runtime",
      "nice",
      "nice value",
      "weight",
      "linux scheduler",
      "red black tree",
      "fair share",
      "target latency",
      "minimum granularity",
      "sched latency"
    ],
    "learn": {
      "idea": "CFS gives every task a virtual runtime that grows while the task runs, more slowly for heavier (lower nice) tasks. The scheduler always picks the task with the smallest virtual runtime, so over time each task gets CPU in proportion to its weight.",
      "hook": "Smallest vruntime runs next.",
      "deep": [
        "vruntime = real run time x 1024 / weight, so a heavy task's clock runs slowly and it stays \"behind\", which gets it picked more often.",
        "Each nice step changes the weight by about 25% (nice 0 = 1024, nice 5 = 335, nice -5 = 3121).",
        "Time slice = target latency x weight / total weight, clamped below by the minimum granularity so slices never get silly short.",
        "New tasks start at the current minimum vruntime: no starvation for them, no free catch-up for them.",
        "The kernel keeps runnable tasks in a red-black tree ordered by vruntime and takes the leftmost one, which is O(log n)."
      ],
      "mistakes": [
        "Thinking nice sets a strict priority: it only sets a share.",
        "Believing CFS uses fixed time slices: the slice shrinks as more tasks are runnable.",
        "Forgetting the minimum granularity, which bounds context-switch overhead."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
