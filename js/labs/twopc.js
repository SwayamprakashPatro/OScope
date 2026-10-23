/* Lab: Two-phase commit. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mp-view.js. Logic: js/engines/mp.js + mp-twopc.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'twopc',
    area: 'distributed',
    section: 'agree',
    title: 'Two-phase commit',
    view: 'twopc',
    level: 'advanced',
    summary: 'Commit on every node or none: voting, the decision, and why a coordinator crash can block everyone.',
    keywords: ['two phase commit', '2PC', 'distributed transaction', 'atomic commit', 'coordinator', 'participant', 'prepare', 'vote', 'commit abort',
      'blocking protocol', 'three phase commit', '3PC', 'cooperative termination', 'uncertain state', 'atomicity', 'XA transaction', 'presumed abort'],
    learn: {
      idea: 'A transaction that changes data on several machines must either commit on all or abort on all. Two-phase commit gets there by first asking everyone whether they CAN commit (vote), and only then telling everyone the decision.',
      hook: 'Vote, then decide. A YES vote is a promise you cannot take back, so you must wait for the verdict.',
      deep: [
        'Phase 1: the coordinator sends PREPARE. A participant that can commit saves everything it needs (so it survives a crash) and votes YES; it can no longer abort by itself. A participant that cannot commit votes NO and aborts immediately.',
        'Phase 2: all YES means the coordinator logs COMMIT and sends it; any NO, or a vote missing at the timeout, means ABORT. Participants obey and acknowledge.',
        'Cost with N-1 participants and no failures: 4(N-1) messages (PREPARE, VOTE, decision, ACK).',
        'Safety: no two nodes ever reach different outcomes. Liveness is the problem: a prepared participant that loses contact with the coordinator is in the uncertain window. If it commits and another node aborted, atomicity is broken; so it must wait. This is why 2PC is called a blocking protocol.',
        'Cooperative termination lets prepared participants ask each other. It only helps if someone already knows the outcome (voted NO, or received the decision).',
        'Three-phase commit and consensus-based commit (Paxos Commit, Raft-replicated coordinators) reduce or remove the blocking, at higher cost or with stronger assumptions.'
      ],
      mistakes: [
        'Thinking a YES vote means "I will probably commit". It means "I promise I can commit if told to".',
        'Letting a prepared participant time out and abort on its own.',
        'Assuming 2PC tolerates coordinator failure. It stays safe but may stall.',
        'Forgetting that a coordinator that recovers before deciding must not assume COMMIT.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
