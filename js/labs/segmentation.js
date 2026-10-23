/* Lab: Segmentation. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/segmentation-view.js (built with js/views/lab-kit.js). Logic: js/engines/segmentation.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "segmentation",
  "area": "memory",
  "section": "translation",
  "title": "Segmentation",
  "view": "segmentation",
  "level": "core",
  "summary": "Logical addresses as segment and offset, with base and limit checks and per-segment rights.",
  "keywords": [
    "segmentation",
    "segment table",
    "base and limit",
    "segmentation fault",
    "segment fault",
    "logical address",
    "protection",
    "external fragmentation",
    "x86 segments"
  ],
  "learn": {
    "idea": "In segmentation a program is split into named pieces (code, data, stack). An address is a segment number and an offset. The segment table gives each piece a base in physical memory and a limit; offsets at or beyond the limit trap.",
    "hook": "Base is where the room starts, limit is its length: you can walk in, but not through the wall.",
    "deep": [
      "physical = base + offset, valid only if offset < limit.",
      "Each segment can have its own rights (read, write, execute) and can be shared.",
      "Segments have different sizes, so memory fills with holes (external fragmentation), which paging avoids.",
      "Modern x86-64 mostly uses flat segments and relies on paging."
    ],
    "mistakes": [
      "Using offset <= limit. The last valid offset is limit - 1.",
      "Mixing up a limit fault (too far) with a protection fault (wrong access type).",
      "Confusing a segment with a page: segments vary in size and have meaning."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
