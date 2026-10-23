/* Lab: Frame allocation. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/frames-view.js (built with js/views/lab-kit.js). Logic: js/engines/frames.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "frames",
  "area": "memory",
  "section": "alloc",
  "title": "Frame allocation",
  "view": "frames",
  "level": "advanced",
  "summary": "Splitting physical frames among processes: equal, proportional or by priority, with the fault cost of each split.",
  "keywords": [
    "frame allocation",
    "equal allocation",
    "proportional allocation",
    "priority allocation",
    "minimum frames",
    "local replacement",
    "global replacement",
    "allocation of frames"
  ],
  "learn": {
    "idea": "When many processes share physical memory, the OS decides how many frames each gets. Equal, proportional-to-size and priority-weighted splits all behave differently, and every process needs a minimum number of frames to run at all.",
    "hook": "Slicing a pizza: equal slices, slices by hunger, or slices by rank.",
    "deep": [
      "Proportional: s_i / S x m frames. Equal: m / n.",
      "A small process cannot use a big equal share, so frames are wasted.",
      "Fewer frames than a process needs means many page faults.",
      "Global replacement lets processes steal from each other; local replacement keeps each inside its share."
    ],
    "mistakes": [
      "Giving every process the same count and calling it fair.",
      "Ignoring the minimum number of frames.",
      "Thinking more frames always cut faults: beyond the working set they add nothing."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
