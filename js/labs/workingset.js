/* Lab: Working set & thrashing. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/workingset-view.js (built with js/views/lab-kit.js). Logic: js/engines/workingset.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "workingset",
  "area": "memory",
  "section": "virtual",
  "title": "Working set & thrashing",
  "view": "workingset",
  "level": "advanced",
  "summary": "The pages a process uses in its last D references, and what happens when all working sets do not fit.",
  "keywords": [
    "working set",
    "thrashing",
    "locality",
    "working set model",
    "page fault frequency",
    "suspend process",
    "degree of multiprogramming",
    "denning",
    "wss"
  ],
  "learn": {
    "idea": "A working set is the set of distinct pages a process touched in its last D references. If the sum of all working sets is bigger than physical memory, processes fault constantly and little useful work gets done: thrashing.",
    "hook": "Too many people at a desk that fits four: everyone spends the day swapping papers.",
    "deep": [
      "WS(t, D) is measured over a sliding window; D is a tuning choice.",
      "Locality of reference is why a small set of pages is usually enough.",
      "Fix: suspend a process so the rest fit, instead of letting everyone fault.",
      "Low CPU use can trick the scheduler into admitting more processes, making thrashing worse."
    ],
    "mistakes": [
      "Thinking thrashing is a bug in one program. It is a system-level overload.",
      "Adding more processes to raise CPU use when it is already caused by paging.",
      "Choosing D too small (misses real locality) or too large (counts stale pages)."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
