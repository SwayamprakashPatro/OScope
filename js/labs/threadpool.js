/* Lab: Thread pools and threading models. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/threadpool-view.js. Logic: js/engines/threadpool.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "threadpool",
    "area": "processes",
    "section": "comm",
    "title": "Thread pools",
    "view": "threadpool",
    "level": "advanced",
    "summary": "Serve the same requests with one thread, a thread per request or a fixed pool, and compare latency, throughput and overload behaviour.",
    "keywords": ["Thread pools and threading models", 
      "thread pool",
      "threadpool",
      "thread per request",
      "worker threads",
      "threading model",
      "single threaded",
      "queue size",
      "load shedding",
      "rejection",
      "throughput",
      "latency",
      "thread creation cost",
      "multithreading",
      "server",
      "thrashing threads"
    ],
    "learn": {
      "idea": "A server can handle requests one at a time, create a new thread for each, or reuse a fixed pool of worker threads fed by a queue. The choice sets latency under light load and survival under a burst.",
      "hook": "Pool = taxis at a rank: a fixed fleet, a queue of riders, a rule for when the queue is too long.",
      "deep": [
        "One thread suffers head-of-line blocking: one slow request delays everything behind it, and other cores sit idle.",
        "Thread-per-request is simple and fast for light load, but unbounded: a burst creates thousands of threads and memory and context switching collapse the machine.",
        "A pool reuses threads (no creation cost per request), caps concurrency, and uses a bounded queue to absorb bursts.",
        "When the queue is full, rejecting new work (load shedding) keeps latency of accepted work reasonable.",
        "Sizing: about one thread per core for CPU-bound work; more for work that spends time waiting on I/O."
      ],
      "mistakes": [
        "Assuming more threads is always faster: past the core count they just fight for the CPU.",
        "Using an unbounded queue: it hides overload until memory runs out.",
        "Forgetting thread creation and teardown cost for very short requests."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
