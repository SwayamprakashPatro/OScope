/* Lab: Disk scheduling. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: disk) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "disk",
  "area": "storage",
  "section": "io",
  "title": "Disk scheduling",
  "view": "disk",
  "level": "core",
  "summary": "In what order should the disk head serve its queued requests?",
  "keywords": [
    "FCFS",
    "SSTF",
    "Shortest Seek Time First",
    "SCAN",
    "elevator algorithm",
    "C-SCAN",
    "LOOK",
    "C-LOOK",
    "seek time",
    "head movement",
    "cylinder",
    "track",
    "disk head",
    "total seek distance",
    "rotational latency",
    "rotation time",
    "RPM",
    "disk geometry",
    "transfer time",
    "disk access time",
    "seek vs rotation"
  ],
  "learn": {
    "idea": "A hard disk head moves across cylinders, and seek time dominates the cost. The order in which queued requests are served changes the total head movement.",
    "hook": "FCFS: fair but wasteful. SSTF: greedy. SCAN: an elevator sweeping up then down. C-SCAN: sweeps one way and jumps back. LOOK: an elevator that turns at the last request.",
    "deep": [
      "Total seek distance = the sum of the distances between successive head positions.",
      "SSTF is greedy and can starve requests far from the head.",
      "SCAN bounds the waiting time, but requests just behind the head wait a whole sweep. C-SCAN gives a more uniform wait.",
      "LOOK and C-LOOK turn around at the last request instead of travelling to the disk edge.",
      "These rules matter for spinning disks. SSDs have no head, so seek order barely matters.",
      "One disk access = seek time + rotational latency + transfer time. At 7200 RPM a rotation takes 60000 / 7200 = 8.33 ms, so the average rotational latency is half of that, 4.17 ms.",
      "Scheduling only reorders requests, so it only reduces the seek part. Rotation and transfer are paid by every request in any order, which is why a fast seek makes rotation the main cost."
    ],
    "mistakes": [
      "Running SCAN or C-SCAN to the physical edge when the question means LOOK.",
      "Starting in the wrong direction. The initial direction changes the answer.",
      "Textbooks differ on whether the C-SCAN return jump counts as seek distance. Check your course.",
      "Using a full rotation instead of half for the average rotational latency.",
      "Charging the transfer time of a whole track when only one sector is read."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
