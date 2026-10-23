/* Lab: Distributed mutual exclusion. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mp-view.js. Logic: js/engines/mp.js + mp-mutex.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'mutex',
    area: 'distributed',
    section: 'agree',
    title: "Distributed mutex",
    view: 'mutex',
    level: 'advanced',
    summary: 'No shared memory, no lock: how do nodes agree who enters the critical section? Ricart-Agrawala and token ring, with crashes.',
    keywords: ["Distributed mutual exclusion", 'distributed mutual exclusion', 'ricart agrawala', 'ricart-agrawala', 'token ring', 'token passing', 'permission based', 'token based',
      'critical section', 'lamport timestamp', 'message complexity', 'distributed lock', 'deferred reply', 'lost token', 'Suzuki Kasami', 'Maekawa'],
    learn: {
      idea: 'Locks and semaphores need shared memory. Across machines the only tool is messages, so mutual exclusion becomes an agreement problem: either everyone grants permission, or there is exactly one token and only its holder may enter.',
      hook: 'Permission or token. Ask-everyone costs 2(N-1) messages; the token costs a walk around the ring.',
      deep: [
        'Ricart-Agrawala: send REQUEST(timestamp) to all, wait for N-1 REPLYs. A node defers its reply if it is inside, or if it asked first (smaller timestamp; node id breaks ties). Leaving sends all deferred replies. Total order of requests comes from Lamport clocks.',
        'Cost: 2(N-1) messages per entry no matter how quiet the system is. Entry delay is about one round trip.',
        'Token ring: a single token circulates. Entry costs between 0 and N-1 messages, depending on where the token is, but the token travels even when nobody wants it. Waiting is bounded by one lap, so the ring is fair.',
        'Both are SAFE under any timing (never two inside). Neither is FAULT-TOLERANT: one crashed node starves Ricart-Agrawala (its reply never comes) and a lost token stops the ring. Real systems add failure detectors, timeouts, token regeneration or use consensus (Raft, Paxos) or a lock service instead.',
        'Safety and liveness are different properties. The lab checks safety from the recorded entry/exit times, and reports starvation separately.'
      ],
      mistakes: [
        'Believing the algorithm "does not work" when a node crashes. Safety still holds; it is progress (liveness) that is lost.',
        'Replying to a request while you are inside the critical section.',
        'Forgetting the tie-break: two requests with equal timestamps need the node id to be ordered.',
        'Thinking the token ring is cheap. Idle circulation costs messages even with no demand.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
