/* Lab: Copy-on-write. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/cow-view.js (built with js/views/lab-kit.js). Logic: js/engines/cow.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "cow",
  "area": "memory",
  "section": "virtual",
  "title": "Copy-on-write",
  "view": "cow",
  "level": "advanced",
  "summary": "fork shares frames and copies a page only when someone writes: counts frames used and copies made.",
  "keywords": [
    "copy on write",
    "cow",
    "fork copy on write",
    "shared pages",
    "page fault",
    "read only",
    "reference count",
    "vfork",
    "exec",
    "lazy copy"
  ],
  "learn": {
    "idea": "With copy-on-write, fork copies only the page table. Parent and child share all frames, marked read-only. The first write to a shared page faults, the OS copies just that page, and the writer continues on its private copy.",
    "hook": "Share the notebook until someone wants to write, then photocopy only that page.",
    "deep": [
      "A frame has a reference count: how many page tables point to it.",
      "Writing a shared page: copy it, drop one reference, map the copy writable.",
      "If the writer is the last user, the OS just clears the read-only flag: no copy.",
      "Because children often call exec right after fork, almost nothing is ever copied."
    ],
    "mistakes": [
      "Thinking fork copies memory immediately.",
      "Thinking a read triggers a copy. Only writes do.",
      "Forgetting that the parent's pages become read-only too."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
