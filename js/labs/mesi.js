/* Lab: Cache coherence (MESI). Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mesi-view.js. Logic: js/engines/mesi.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'mesi',
    area: 'memory',
    section: 'caches',
    title: 'Cache coherence (MESI)',
    view: 'mesi',
    level: 'advanced',
    summary: 'Several CPUs, several private caches, one memory: how snooping keeps every copy consistent (MSI and MESI) and what sharing costs.',
    keywords: ['cache coherence', 'MESI', 'MSI', 'snooping', 'bus snooping', 'cache line', 'false sharing', 'invalidate', 'write invalidate', 'write back',
      'modified exclusive shared invalid', 'multiprocessor', 'multicore', 'cache line bouncing', 'coherence miss', 'BusRd', 'BusRdX', 'BusUpgr', 'memory consistency', 'MOESI', 'directory protocol'],
    learn: {
      idea: 'Every core has a private cache, so the same memory line can sit in several caches. If one core writes, the others must not keep reading the old value. Snooping coherence solves this: each cache watches the shared bus and keeps each line in a state (Modified, Exclusive, Shared or Invalid) that says what it may do without asking.',
      hook: 'MESI: Modified (mine, dirty), Exclusive (mine, clean), Shared (shared, clean), Invalid (not usable). Writes need the line Exclusive or Modified.',
      deep: [
        'Reads: a hit in M, E or S costs no bus traffic. A miss puts BusRd on the bus; if another cache holds the line Modified it supplies the data and writes it back, and both end up Shared.',
        'Writes: a line in M or E is written with no bus traffic (E silently becomes M). A line in S must first broadcast an invalidate (BusUpgr); a missing line uses BusRdX (read and invalidate). Afterwards the writer holds the only valid copy.',
        'The Exclusive state exists for data only one core touches: it lets the first write skip the invalidate broadcast that MSI needs. The lab counts the saved transactions.',
        'Coherence misses are misses caused by another core\'s write. Two cores writing the same line take turns owning it, so the line "ping-pongs" and every write becomes a bus transaction. False sharing is the same thing caused by two unrelated variables that happen to sit on one cache line.',
        'Coherence guarantees a single order of writes to one location. It does not by itself order accesses to different locations; that is the job of the memory consistency model and of fences and atomics.',
        'Real machines add more (MOESI, MESIF, directories for many cores, transient states for races). This lab uses one atomic bus transaction at a time and no evictions.'
      ],
      mistakes: [
        'Thinking coherence makes shared data safe. You still need locks or atomics for compound operations.',
        'Thinking a write always goes to memory. In a write-back cache memory stays stale until the Modified line is flushed.',
        'Believing readers slow each other down. Many readers share a line for free; it is writes that invalidate.',
        'Putting hot per-thread counters next to each other: they share a cache line and ping-pong (false sharing).'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
