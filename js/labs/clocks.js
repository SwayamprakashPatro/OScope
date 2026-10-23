/* Lab: Lamport & vector clocks. Description for the sidebar, search and the "Go deeper" card.
   The screen is the shared distributed view (js/views/mp-view.js); the logic is js/engines/mp.js + mp-clocks.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'clocks',
    area: 'distributed',
    section: 'time',
    title: "Lamport & vector clocks",
    view: 'clocks',
    level: 'advanced',
    summary: 'Without a shared clock, how do nodes agree what happened before what? Compare Lamport and vector clocks on your own message scenario.',
    keywords: ['lamport clock', 'logical clock', 'vector clock', 'happened before', 'happens-before', 'causality', 'causal order', 'concurrent events',
      'distributed systems', 'message passing', 'clock synchronization', 'event ordering', 'total order', 'partial order', 'space-time diagram'],
    learn: {
      idea: 'Computers in a distributed system have no shared clock and messages take unpredictable time, so wall-clock time cannot say which event came first. Logical clocks instead track cause and effect: an event can only be influenced by events that came before it along some chain of messages.',
      hook: 'Lamport: one counter, bump and take the max. Vector: one counter per node, and it can say "concurrent".',
      deep: [
        'The happened-before relation (a → b): a comes before b on the same node, or a is the send of a message whose receive is b, or there is a chain of those. If neither a → b nor b → a, the events are concurrent.',
        'Lamport clock: bump before each event; on receive set L = max(own, message) + 1. This guarantees a → b implies L(a) < L(b). The reverse is false: L(a) < L(b) may just be coincidence.',
        'Vector clock: one counter per node. Compare two vectors element by element: V(a) ≤ V(b) everywhere (and not equal) exactly when a → b. If neither is ≤ the other, the events are concurrent.',
        'The price of the extra power is size: a vector has one number per node, which is why real systems prune or compress them (version vectors, dotted version vectors).',
        'Lamport clocks plus node ids give a total order consistent with causality, which is what the Ricart-Agrawala mutual exclusion lab uses to break ties.'
      ],
      mistakes: [
        'Reading L(a) < L(b) as "a caused b". Only the vector clock proves it.',
        'Forgetting to bump the clock on a local event, or on the receive.',
        'Treating concurrent as "simultaneous". It only means neither could have influenced the other.',
        'Assuming wall-clock timestamps order events across machines. Clocks drift.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
