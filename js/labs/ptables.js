/* Lab: Multi-level & inverted page tables. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/ptables-view.js (built with js/views/lab-kit.js). Logic: js/engines/ptables.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "ptables",
  "area": "memory",
  "section": "translation",
  "title": "Multi-level page tables",
  "view": "ptables",
  "level": "advanced",
  "summary": "Why one flat page table is too big, how a tree of tables fixes it, and the inverted table alternative.",
  "keywords": ["Multi-level & inverted page tables", 
    "multilevel page table",
    "two level paging",
    "hierarchical paging",
    "inverted page table",
    "page table size",
    "hashed page table",
    "sparse address space",
    "page table walk",
    "vpn",
    "tlb miss"
  ],
  "learn": {
    "idea": "A flat page table needs one entry per virtual page, even for pages never used. A multi-level table splits the page number into indices and only creates the lower tables that are actually needed. An inverted table has one entry per physical frame and is found by hashing.",
    "hook": "Multi-level = a book index: only print the chapters you wrote. Inverted = a seating chart by seat, not by guest.",
    "deep": [
      "Bits: split the page number among the levels; the offset bits are untouched.",
      "A translation reads one table per level, so a TLB miss costs more memory references as levels are added.",
      "Sparse programs win big: a few scattered pages need only a handful of tables.",
      "An inverted table's size depends on RAM, not address space, but each lookup walks a hash chain and shared pages need extra bookkeeping."
    ],
    "mistakes": [
      "Thinking each level holds the whole table. Lower-level tables exist only where needed.",
      "Counting the data page as a page-table read.",
      "Assuming more levels are always better: they save space but slow a TLB miss."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
