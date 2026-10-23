/* Lab: Leader election. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mp-view.js. Logic: js/engines/mp.js + mp-election.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'election',
    area: 'distributed',
    section: 'agree',
    title: 'Leader election',
    view: 'election',
    level: 'advanced',
    summary: 'The coordinator crashed: how do the survivors agree on a new one? Bully and ring election on your own failure scenario.',
    keywords: ['leader election', 'bully algorithm', 'ring election', 'Chang Roberts', 'coordinator', 'failure detection', 'distributed coordination',
      'election message', 'highest id', 'split brain', 'consensus', 'master election', 'failover'],
    learn: {
      idea: 'Many distributed systems need a single coordinator. When it fails, the remaining nodes must pick a new one that they all agree on, using only messages that can be delayed or lost.',
      hook: 'Highest id alive wins. Bully asks upward ("anyone bigger?"); ring passes the biggest id round.',
      deep: [
        'Bully: the node that notices the failure sends ELECTION to all higher ids. A live higher node replies OK and runs its own election; if nobody replies before the timeout, the node announces itself. Worst case about N-squared messages.',
        'Ring (Chang-Roberts): ELECTION(id) travels round the ring; each node forwards the larger id and swallows smaller ones. The node whose own id returns is the leader and sends COORDINATOR round the ring. About 3N messages in the best case, N-squared worst case.',
        'Both pick the highest-id live node, so every node ends with the same belief; the lab checks exactly that.',
        'The timeout is the hard part in real networks: too short and a slow node is declared dead (two leaders, "split brain"); too long and recovery is slow. These algorithms assume reliable failure detection; production systems use heartbeats and quorum-based consensus (Raft, Paxos, ZooKeeper) instead.',
        'A recovered node must not simply resume as leader: the bully algorithm makes it start a new election.'
      ],
      mistakes: [
        'Setting the bully timeout shorter than a round trip, so a live higher node is skipped.',
        'Assuming only one election runs. Several nodes can notice at once, and the algorithm must still converge.',
        'Thinking the election picks the "best" node. These algorithms only pick the highest id; any other criterion is just another number to compare.',
        'Forgetting that a recovering old leader forces another election.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
