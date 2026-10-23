/* Lab: Address translation. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: translation) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "translation",
  "area": "memory",
  "section": "translation",
  "title": "Address translation",
  "view": "translation",
  "level": "advanced",
  "summary": "How does a virtual address become a physical address?",
  "keywords": [
    "paging",
    "page table",
    "TLB",
    "translation lookaside buffer",
    "virtual address",
    "physical address",
    "logical address",
    "MMU",
    "page number",
    "offset",
    "frame number",
    "effective access time",
    "EAT",
    "page size"
  ],
  "learn": {
    "idea": "Programs use virtual addresses. The MMU splits each address into a page number and an offset, finds the frame in the page table (or the TLB) and builds the physical address.",
    "hook": "The page number picks the row; the offset is copied unchanged. Physical = frame x page size + offset.",
    "deep": [
      "Offset bits = log2(page size). The remaining high bits are the page number.",
      "The TLB is a small cache of page-table entries. On a TLB hit the translation is nearly free; on a miss it costs an extra memory access for the page-table lookup.",
      "An invalid page-table entry causes a page fault (the OS must bring the page in). A protection violation is a different kind of fault.",
      "Smaller pages waste less memory inside the last page but make the page table bigger."
    ],
    "mistakes": [
      "Translating the offset. It never changes.",
      "Forgetting that a TLB miss adds a page-table memory access.",
      "Mixing units (bytes against KB) when counting address bits."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
