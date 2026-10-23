/* Lab: Buddy system. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/buddy-view.js (built with js/views/lab-kit.js). Logic: js/engines/buddy.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "buddy",
  "area": "memory",
  "section": "alloc",
  "title": "Buddy system",
  "view": "buddy",
  "level": "advanced",
  "summary": "Power-of-two allocation: split on alloc, merge buddies on free, with internal and external fragmentation.",
  "keywords": [
    "buddy system",
    "buddy allocator",
    "power of two",
    "split and merge",
    "coalescing",
    "internal fragmentation",
    "external fragmentation",
    "kernel allocator",
    "slab",
    "memory allocation"
  ],
  "learn": {
    "idea": "The buddy system gives out memory in power-of-two blocks. To allocate, round up and split a larger free block in halves until it fits. To free, merge the block with its buddy if the buddy is free, and repeat.",
    "hook": "Halve to allocate, glue back to free. The buddy of a block is its address with the size bit flipped.",
    "deep": [
      "Finding a buddy is one XOR (start ^ size), so merging is cheap.",
      "Rounding up to a power of two wastes space inside blocks (internal fragmentation): a 33-unit request takes 64.",
      "Free memory can still be unusable: two free halves that are not buddies cannot merge (external fragmentation).",
      "Linux uses a buddy allocator for physical pages and layers a slab allocator on top for small objects."
    ],
    "mistakes": [
      "Thinking any two adjacent free blocks merge. Only true buddies do.",
      "Forgetting the round-up: the block is bigger than the request.",
      "Assuming the system never fragments because blocks are aligned."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
