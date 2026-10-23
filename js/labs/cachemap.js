/* Lab: Cache mapping. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/cachemap-view.js (built with js/views/lab-kit.js). Logic: js/engines/cachemap.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "cachemap",
  "area": "memory",
  "section": "caches",
  "title": "Cache mapping",
  "view": "cachemap",
  "level": "advanced",
  "summary": "Direct-mapped, set-associative and fully associative caches: tag, index, offset and the three kinds of miss.",
  "keywords": [
    "cache mapping",
    "direct mapped",
    "set associative",
    "fully associative",
    "tag index offset",
    "cache miss",
    "conflict miss",
    "capacity miss",
    "compulsory miss",
    "cache line",
    "amat",
    
    "cache block"
  ],
  "learn": {
    "idea": "A CPU cache stores blocks of memory. The address is split into tag, set index and block offset. The index selects a set; the block may sit in any way of that set. More ways reduce conflicts but cost more hardware.",
    "hook": "Parking: assigned spot (direct), a row of spots (set), any spot (full lot).",
    "deep": [
      "offset bits = log2(block size); index bits = log2(number of sets).",
      "Compulsory miss: first use. Capacity miss: the cache is too small. Conflict miss: the mapping evicted a block a bigger-associativity cache would have kept.",
      "Average access time = hit time + miss rate x miss penalty.",
      "Spatial locality means one miss loads a whole block, giving hits on the neighbours."
    ],
    "mistakes": [
      "Thinking a direct-mapped cache is full when one set is busy.",
      "Mixing up tag and index bits.",
      "Believing more associativity always helps: it does not fix capacity misses."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
