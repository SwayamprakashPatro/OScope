/* Lab: Page replacement. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: paging) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "paging",
  "area": "memory",
  "section": "virtual",
  "title": "Page replacement",
  "view": "paging",
  "level": "advanced",
  "summary": "RAM is full and a new page is needed: which page do we evict?",
  "keywords": [
    "FIFO",
    "LRU",
    "Least Recently Used",
    "Optimal",
    "OPT",
    "Belady anomaly",
    "Belady",
    "page fault",
    "page hit",
    "frames",
    "hit ratio",
    "fault rate",
    "reference string",
    "virtual memory",
    "demand paging",
    "Clock",
    "second chance",
    "NRU",
    "Not Recently Used",
    "LFU",
    "MFU",
    "Aging counters",
    "reference bit",
    "use count"
  ],
  "learn": {
    "idea": "RAM holds only some of a program pages. When a needed page is missing (a page fault) the OS must evict one. The replacement rule decides which.",
    "hook": "FIFO evicts the oldest arrival. LRU evicts the page unused the longest. OPT evicts the page needed farthest in the future.",
    "deep": [
      "Hit ratio = hits / references. Fault rate = faults / references.",
      "OPT gives the fewest possible faults but needs the future, so it is only a benchmark.",
      "LRU and OPT never get worse with more frames. FIFO can: that is Belady anomaly.",
      "Real systems approximate LRU with reference bits (the Clock or second-chance algorithm), because exact LRU is costly in hardware.",
      "Clock (second chance) keeps frames on a circle with a hand. A page with reference bit 1 gets the bit cleared and a second chance; the first page with bit 0 is evicted. If every bit is 1 it behaves like FIFO.",
      "LFU evicts the page used the fewest times and MFU the most. LFU keeps old favourites for ever; MFU assumes a heavily used page has finished its job. A reloaded page starts again from a count of 1.",
      "Aging keeps an 8-bit counter per page: after every reference shift it right and put the reference bit on the left. The smallest counter is the least recently used, with only 8 steps of memory. NRU clears all reference bits every few references."
    ],
    "mistakes": [
      "Counting the first loads into empty frames as hits. They are faults.",
      "Forgetting to refresh recency on a hit in LRU.",
      "Assuming more frames always means fewer faults. That fails for FIFO.",
      "Clock: leaving the hand where it was after a replacement. It must move on to the next frame.",
      "Clock: forgetting to clear a bit as the hand passes it; the page would then never lose its second chance.",
      "Comparing Aging counters as decimal numbers by eye: read the 8-bit strings left to right, the left-most 1 matters most."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
