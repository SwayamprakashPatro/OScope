/* Lab: Memory hierarchy & EAT. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/hierarchy-view.js (built with js/views/lab-kit.js). Logic: js/engines/hierarchy.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "hierarchy",
  "area": "memory",
  "section": "caches",
  "title": "Memory hierarchy & EAT",
  "view": "hierarchy",
  "level": "advanced",
  "summary": "Effective access time across cache levels, and across TLB, page-table walk and page faults.",
  "keywords": [
    "memory hierarchy",
    "effective access time",
    "eat",
    "amat",
    "average memory access time",
    "tlb hit ratio",
    "page fault rate",
    "locality",
    "cache levels",
    "paging performance"
  ],
  "learn": {
    "idea": "Memory is organised as small fast levels in front of big slow ones. The effective access time is the average cost of an access, weighted by how often each level is the one that has the data.",
    "hook": "Your desk, your shelf, the library, the other city: the average trip depends on how often the desk has it.",
    "deep": [
      "EAT = h1 t1 + (1-h1)[h2 (t1+t2) + (1-h2)(...)], with times accumulating on the way down.",
      "TLB miss costs a page-table walk: one memory read per level plus the data access.",
      "A page fault costs millions of times more than a memory access, so p must be tiny: a fault rate of 1 in 10^6 can still cost as much as everything else.",
      "Use \"max fault rate for X% slowdown\" to see how little paging a system can tolerate."
    ],
    "mistakes": [
      "Averaging times without weighting by hit ratio.",
      "Forgetting the extra memory read for the data after the page walk.",
      "Ignoring page faults because they are rare: they are huge."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
