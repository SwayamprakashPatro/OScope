/* Lab: Polling, interrupts and DMA. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/iomodes-view.js. Logic: js/engines/iomodes.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "iomodes",
    "area": "storage",
    "section": "io",
    "title": "Polling, interrupts & DMA",
    "view": "iomodes",
    "level": "advanced",
    "summary": "Three ways to move data from a device: busy-wait polling, interrupt-driven I/O and DMA, with CPU cost, finish time and break-even points.",
    "keywords": ["Polling, interrupts and DMA", 
      "polling",
      "interrupt driven io",
      "interrupt driven",
      "dma",
      "direct memory access",
      "programmed io",
      "busy waiting",
      "io methods",
      "device driver",
      "cpu overhead",
      "io completion",
      "dma controller",
      "spinning"
    ],
    "learn": {
      "idea": "To read data from a device, the CPU can poll the status register in a loop, start the device and take an interrupt for each word, or program a DMA controller to move the whole block while the CPU does other work.",
      "hook": "Poll = keep checking the oven. Interrupt = a beep per tray. DMA = a helper loads the batch and calls you once.",
      "deep": [
        "Polling wastes the CPU while the device works, but has no interrupt overhead, so it can win for very fast devices.",
        "Per word, interrupts cost overhead + copy; they beat polling only when the interrupt overhead is smaller than the device wait.",
        "DMA removes the per-word copy and interrupt: one setup, one completion interrupt, the CPU is free in between.",
        "DMA setup is not free, so for tiny transfers programmed I/O can be cheaper.",
        "Modern fast devices (NICs, NVMe) mix the ideas: interrupt coalescing, or switching to polling under heavy load."
      ],
      "mistakes": [
        "Assuming interrupts are always cheaper than polling.",
        "Forgetting that interrupt-driven I/O can finish later than polling: it trades latency for free CPU.",
        "Thinking DMA means the CPU is idle: it is free for other work, and the bus is shared."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
