/* Lab: Banker’s algorithm. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: bankers) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "bankers",
  "area": "concurrency",
  "section": "deadlock",
  "title": "Banker’s algorithm",
  "view": "bankers",
  "level": "core",
  "summary": "Is it safe to grant this request without risking deadlock?",
  "keywords": [
    "Banker algorithm",
    "safe state",
    "unsafe state",
    "safety algorithm",
    "need matrix",
    "available vector",
    "allocation matrix",
    "max matrix",
    "resource request",
    "safe sequence",
    "deadlock avoidance"
  ],
  "learn": {
    "idea": "Before granting a request, the OS checks that the system would still be in a safe state: one where some order lets every process finish.",
    "hook": "Need = Max - Allocation. Safe means a finishing order exists. Unsafe is a warning, not yet a deadlock.",
    "deep": [
      "Safety algorithm: Work = Available. Repeatedly find an unfinished process with Need <= Work, pretend it finishes, and add its Allocation to Work.",
      "Request algorithm: check Request <= Need, then Request <= Available, pretend to grant, run the safety check, and roll back if it is unsafe.",
      "The safety check costs O(m x n^2) for n processes and m resource types.",
      "It needs every process maximum claim in advance, which real systems rarely know, so it is mainly a teaching model."
    ],
    "mistakes": [
      "Computing Need as Max - Available instead of Max - Allocation.",
      "Calling an unsafe state a deadlock. Unsafe only means deadlock is possible.",
      "Thinking the safe sequence is unique. Any valid order is correct.",
      "Adding back only part of a finished process allocation to Work. Add all of it."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
