/* Lab: Memory allocation. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: allocation) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "allocation",
  "area": "memory",
  "section": "alloc",
  "title": "Memory allocation",
  "view": "allocation",
  "level": "core",
  "summary": "Programs need contiguous memory. Which free hole should each one get?",
  "keywords": [
    "first fit",
    "best fit",
    "worst fit",
    "next fit",
    "external fragmentation",
    "internal fragmentation",
    "fragmentation",
    "compaction",
    "hole",
    "contiguous allocation",
    "dynamic partitioning",
    "free list"
  ],
  "learn": {
    "idea": "Programs need one contiguous block of memory. As they come and go, free memory breaks into holes, and a fit rule decides which hole to use.",
    "hook": "First: first hole that fits. Best: tightest fit. Worst: biggest hole. Next: first fit, but resume where you stopped.",
    "deep": [
      "External fragmentation: enough free memory in total, but not in one piece. Internal fragmentation: space wasted inside an allocated block.",
      "Best Fit leaves tiny unusable slivers. Worst Fit destroys large holes quickly. In studies, First and Best Fit usually use memory better than Worst Fit.",
      "Knuth 50-percent rule: with first fit, for every N allocated blocks about N/2 more are lost to fragmentation, roughly a third of memory.",
      "Compaction slides blocks together to merge holes, but needs relocation and costs time."
    ],
    "mistakes": [
      "Forgetting to merge adjacent free holes after a free.",
      "Best Fit means the smallest hole that is big enough, not the smallest hole.",
      "Next Fit resumes from the last placement, not from the start of memory."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
