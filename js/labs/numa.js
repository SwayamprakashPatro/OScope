/* Lab: NUMA & load balancing. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/numa-view.js. Logic: js/engines/concepts.js (where there is any calculation). */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "numa",
  "area": "memory",
  "section": "caches",
  "title": "NUMA & load balancing",
  "view": "numa",
  "level": "advanced",
  "summary": "Memory is local to a node: how thread placement and page placement change latency, and what the balancer trades off.",
  "keywords": [
    "numa",
    "non uniform memory access",
    "load balancing",
    "scheduler",
    "affinity",
    "first touch",
    "interleave",
    "remote memory",
    "local memory",
    "socket",
    "node",
    "automatic numa balancing",
    "cpu affinity",
    "migration"
  ],
  "learn": {
    "idea": "In a NUMA machine each socket has its own memory. Local accesses are fast and remote ones are slower, so where a thread runs and where its pages live both matter.",
    "hook": "Run the thread where the data is, or move the data to the thread. Local is a short walk, remote is a trip across town.",
    "deep": [
      "Average latency is the local share times local cost plus the remote share times remote cost.",
      "The scheduler wants even load across nodes, but spreading threads evenly can put them far from their memory. Balancing is always a trade between the two.",
      "First-touch allocation places a page on the node of the thread that first writes it, so initialising data on one thread can make everyone else remote.",
      "Interleaving spreads pages across nodes for predictable average speed; affinity pins threads to keep pages local.",
      "Migrating a thread is cheap compared to migrating its pages, but pages left behind stay remote until moved."
    ],
    "mistakes": [
      "Assuming all memory is equally fast on a multi-socket machine.",
      "Balancing load without looking at where the data is.",
      "Pinning every thread to one node and leaving other sockets idle."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
