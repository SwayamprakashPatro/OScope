/* Lab: Raft consensus. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/mp-view.js. Logic: js/engines/mp.js + mp-raft.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'raft',
    area: 'distributed',
    section: 'agree',
    title: 'Raft consensus',
    view: 'raft',
    level: 'advanced',
    summary: 'How servers elect a leader and keep one identical log despite crashes and network partitions (a simplified Raft).',
    keywords: ['raft', 'consensus', 'paxos', 'replicated log', 'leader election', 'term', 'append entries', 'request vote', 'heartbeat', 'quorum', 'majority',
      'log replication', 'state machine replication', 'network partition', 'split brain', 'distributed consensus', 'etcd', 'fault tolerance', 'commit index'],
    learn: {
      idea: 'To keep several servers in agreement, Raft makes them all follow one leader. The leader decides the order of commands and copies them to the others; a command counts as committed only when a majority has it, so any majority that survives still holds every committed command.',
      hook: 'Timeouts elect, majorities commit. One vote per term; the bigger term always wins.',
      deep: [
        'Terms are logical clock ticks for elections. Every message carries one; a server that sees a bigger term updates itself and becomes a follower. A stale leader is therefore dethroned the moment it talks to anyone who has moved on.',
        'Election: a follower that hears no heartbeat before its randomized timeout becomes a candidate for term+1, votes for itself and requests votes. Each server votes once per term and only for a candidate whose log is at least as up to date. A majority of votes wins. Random timeouts make simultaneous candidates (split votes) rare, and when it happens the next, higher term resolves it.',
        'Replication: the leader sends AppendEntries(prevIndex, prevTerm, entries). The follower accepts only if its log contains that previous entry; otherwise the leader backs up one index and retries. This guarantees that if two logs agree on one entry they agree on everything before it (the Log Matching property).',
        'Commit: an entry is committed when stored on a majority, and the leader may only count replicas for entries of its CURRENT term (the Figure 8 rule), so an old-term entry cannot be committed and then overwritten.',
        'Partitions: a leader cut off from the majority can still accept commands but can never commit them. The majority elects a new leader; when the old one reconnects it steps down and its uncommitted entries are overwritten. Safety is never at risk, only availability (the minority cannot make progress).',
        'This lab omits log compaction, membership changes, disk persistence and the leader no-op entry; messages are not lost unless you turn loss on elsewhere.'
      ],
      mistakes: [
        'Thinking an entry is committed when the leader writes it. It needs a majority.',
        'Believing Raft needs all servers alive. It needs a majority: 2 of 3, 3 of 5.',
        'Expecting two leaders to be impossible at the same instant. They can briefly coexist in different terms; only one can have a majority and commit.',
        'Setting the election timeout close to the heartbeat interval, so followers keep timing out between heartbeats.',
        'Confusing Raft with a database: it only guarantees an agreed order of commands.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
