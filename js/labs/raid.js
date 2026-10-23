/* Lab: RAID. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/raid-view.js (built with js/views/lab-kit.js). Logic: js/engines/raid.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "raid",
  "area": "storage",
  "section": "io",
  "title": "RAID",
  "view": "raid",
  "level": "advanced",
  "summary": "RAID 0, 1, 5, 6 and 10: stripe layouts, capacity, speed, failure tolerance and XOR rebuild.",
  "keywords": [
    "raid",
    "raid 0",
    "raid 1",
    "raid 5",
    "raid 6",
    "raid 10",
    "striping",
    "mirroring",
    "parity",
    "xor",
    "disk array",
    "redundancy",
    "rebuild",
    "fault tolerance",
    "small write penalty",
    "hot spare"
  ],
  "learn": {
    "idea": "RAID turns several disks into one volume. Striping spreads blocks for speed, mirroring keeps copies for safety, and parity stores the XOR of data so that any one lost block can be recomputed from the rest.",
    "hook": "Stripe for speed, mirror for safety, parity for cheap safety.",
    "deep": [
      "RAID 5 usable capacity is (N-1) disks; parity rotates so no single disk is a bottleneck.",
      "A small write in RAID 5 costs 4 I/Os (read old data and parity, write new data and parity); RAID 6 costs 6.",
      "RAID 10 survives one failure per mirrored pair, but two failures in the same pair lose data.",
      "Long rebuilds on big disks are risky: a second failure or an unreadable sector during rebuild can lose the array.",
      "RAID is not a backup: it does not protect against deletion, corruption copied to every disk, or fire."
    ],
    "mistakes": [
      "Thinking RAID replaces backups.",
      "Believing RAID 10 survives any two failures.",
      "Forgetting that rebuilding stresses the surviving disks."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
