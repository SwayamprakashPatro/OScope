/* Lab: File allocation methods. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/fileloc-view.js (built with js/views/lab-kit.js). Logic: js/engines/fileloc.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "fileloc",
  "area": "storage",
  "section": "fs",
  "title": "File allocation",
  "view": "fileloc",
  "level": "advanced",
  "summary": "Contiguous, linked, indexed, FAT and Unix inode allocation: where blocks go and how many disk reads it takes to reach one.",
  "keywords": ["File allocation methods", 
    "file allocation",
    "contiguous allocation",
    "linked allocation",
    "indexed allocation",
    "fat",
    "file allocation table",
    "inode",
    "unix inode",
    "direct pointers",
    "indirect block",
    "file system",
    "disk blocks",
    "external fragmentation",
    "file system layout"
  ],
  "learn": {
    "idea": "A file system must choose which disk blocks hold a file. Contiguous, linked, indexed, FAT and inode allocation trade off fragmentation, growth, metadata overhead, and the cost of reaching a block in the middle of the file.",
    "hook": "Contiguous = book on a shelf. Linked = treasure hunt. Indexed = table of contents. FAT = the clues on one cheat sheet. Inode = a few folders on the desk, more in the drawer, the rest in the basement.",
    "deep": [
      "Contiguous is fastest but cannot grow in place and leaves holes (external fragmentation).",
      "Linked has no fragmentation but block k costs k+1 reads and a single bad pointer loses the tail of the file.",
      "Indexed gives direct access at the cost of an index block per file; one block holds limited pointers.",
      "FAT keeps all next-pointers in one table that must stay in memory to be fast.",
      "The inode combines a few direct pointers with single and double indirect blocks, so small files are cheap and large files still work."
    ],
    "mistakes": [
      "Thinking linked allocation allows fast random access. It does not.",
      "Forgetting that index and indirect blocks use disk space too.",
      "Mixing up FAT (the table of next pointers) with the FAT file system family."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
