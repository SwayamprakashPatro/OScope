/* Lab: Log-structured file system & SSD wear levelling. Description for the sidebar, search and the "Go deeper" card.
   The screen is built by js/views (view key: flashlog) and the logic by js/engines/flashlog.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'flashlog',
    area: 'storage',
    section: 'fs',
    title: "Log-structured FS & SSD",
    view: 'flashlog',
    level: 'advanced',
    summary: 'Why overwrite-by-appending creates garbage, how cleaning costs write amplification, and how wear levelling spreads erases across flash.',
    keywords: ["Log-structured FS & SSD wear levelling", 
      'log-structured file system', 'LFS', 'segment cleaning', 'garbage collection', 'SSD', 'flash translation layer', 'FTL',
      'wear levelling', 'wear leveling', 'dynamic wear levelling', 'static wear levelling', 'write amplification', 'erase block',
      'TRIM', 'over-provisioning', 'flash memory', 'NAND', 'cost-benefit cleaning', 'greedy cleaning', 'copy-on-write', 'program erase cycles', 'endurance'
    ],
    learn: {
      idea: 'Some storage can only be written into empty space and only erased in big chunks. So "overwriting" a page means writing the new copy somewhere new and marking the old one dead. A log-structured file system does this on purpose; an SSD has no choice. Dead pages pile up, and a cleaner copies the survivors out so a whole chunk can be erased.',
      hook: 'Append, Dead, Clean, Erase. Every copy the cleaner makes is an extra write: Write Amplification = (host + copies) / host.',
      deep: [
        'The log head is the only place that is written, so writes are fast and sequential. The cost moves to the cleaner, which must find a victim segment, copy its live pages to the head and free it.',
        'Write amplification is driven by how full the victim still is. The emptier the victims, the cheaper the cleaning, which is why spare area (over-provisioning) and TRIM (telling the drive which pages are dead) lower it.',
        'Greedy cleaning picks the emptiest segment. Cost-benefit weighs age too: a young segment that is still being rewritten will empty by itself, so leave it, and clean the old, stable one.',
        'Flash cells survive a limited number of erases. If hot data keeps landing on the same few blocks while blocks of cold data are never erased, the busy ones die early and the drive fails with most of its life unused.',
        'Dynamic wear levelling sends new writes to the least-worn free block. Static wear levelling also relocates cold data off barely-worn blocks, so they can take hot writes. It costs extra copies, so it trades write amplification for an even lifetime.',
        'This lab uses tiny devices and a random seeded workload; real drives use far larger blocks, parallel chips and caching, and vendors do not publish their exact algorithms.'
      ],
      mistakes: [
        'Thinking an SSD overwrites a page in place. It cannot: it writes elsewhere and remaps.',
        'Thinking deleting a file frees SSD space for the drive immediately. Without TRIM the drive does not know those pages are dead.',
        'Believing wear levelling is free. It moves data, which wears the flash too.',
        'Reading write amplification as a flaw only. It is the price of fast sequential writes and can be kept low with spare space.',
        'Assuming the greedy cleaner is always best: on hot/cold mixes cost-benefit often does fewer copies.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
