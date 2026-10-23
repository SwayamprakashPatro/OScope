/* Protocol: Raft consensus (leader election + log replication), simplified for teaching. Several servers must keep an
   identical, ordered LOG of commands even though servers crash and the network splits.

   Roles:   FOLLOWER (passive) -> CANDIDATE (asking for votes) -> LEADER (the only one who accepts commands).
   Terms:   logical "election numbers". A higher term always wins; seeing one makes any node step down to follower.
   Election: a follower whose random election timer fires first becomes a candidate (term + 1, votes for itself) and sends
            RequestVote. A server gives one vote per term, and only to a candidate whose log is at least as up to date as its own.
            A majority of votes makes a leader, which then sends AppendEntries heartbeats to stop new elections.
   Replication: the leader appends a command to its log and sends AppendEntries(prevIndex, prevTerm, entries). A follower
            accepts only if its log matches at prevIndex/prevTerm (else the leader backs up one entry and retries). An entry is
            COMMITTED once it is stored on a majority AND (the leader's rule) belongs to the leader's current term.

   Left out on purpose: log compaction, membership changes, client sessions, a no-op entry at the start of each leader's term,
   and disk persistence (a crashed node keeps term, vote and log, as if saved). The pure helper functions near the top are
   the Raft rules themselves and are tested against the examples in the Raft paper. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), MP = NS.mp || (typeof require !== 'undefined' ? require('./mp.js') : null);

  /* ---------- the Raft rules as small pure functions (log = array of {term, cmd}; indexes start at 1) ---------- */
  // termAt(log, i): term of the entry at index i (0 for "before the first entry").
  const termAt = (log, i) => (i <= 0 ? 0 : log[i - 1] ? log[i - 1].term : -1);
  // upToDate(cand, log): is the candidate's log at least as up to date as ours? Later last TERM wins; equal terms: longer log wins.
  function upToDate(lastTerm, lastIndex, log) { const mt = termAt(log, log.length); return lastTerm > mt || (lastTerm === mt && lastIndex >= log.length); }
  // applyAppend(log, prevIndex, prevTerm, entries): the follower's consistency check and merge.
  //   Reject if there is no entry at prevIndex with term prevTerm. Otherwise delete any entry that conflicts with a new one
  //   (same index, different term) together with everything after it, then append whatever is missing.
  function applyAppend(log, prevIndex, prevTerm, entries) {
    if (prevIndex > 0 && termAt(log, prevIndex) !== prevTerm) return { ok: false, log };
    let out = log.slice();
    entries.forEach((e, k) => {
      const idx = prevIndex + k; // 0-based position of this entry
      if (idx < out.length) { if (out[idx].term !== e.term) { out = out.slice(0, idx); out.push(e); } } // conflict: drop it and everything after
      else out.push(e);
    });
    return { ok: true, log: out };
  }
  // newCommit(matchIndexes, log, term, commit): highest N > commit stored on a majority whose entry is from the CURRENT term.
  function newCommit(match, log, term, commit) {
    const need = Math.floor(match.length / 2) + 1;
    for (let N = log.length; N > commit; N--) if (log[N - 1].term === term && match.filter((m) => m >= N).length >= need) return N;
    return commit;
  }

  const fmtLog = (s) => s.log.map((e, k) => (k === s.commit ? '| ' : '') + e.term + ':' + e.cmd).join(' ') + (s.commit === s.log.length && s.log.length ? ' |' : '');

  const P = {
    id: 'raft', name: 'Raft consensus', minN: 3, maxN: 5, horizon: true,
    intro: 'Servers must agree on one ordered log despite crashes and network splits. Watch randomized election timers pick a leader, the leader replicate commands, and what happens when the leader crashes or is cut off.',
    hook: 'Timeouts elect, majorities commit. One vote per term; a bigger term always wins.',
    about: { rule: 'A follower whose timer expires becomes a candidate and asks for votes; a majority makes it leader. The leader sends commands in AppendEntries, and an entry is committed once a majority holds it. Everyone follows the highest term they have seen.', watch: 'Only a majority commits, so a leader cut off from the majority can accept commands but never commit them, and those entries are discarded when it rejoins.' },
    defaults: { n: 3, dmin: 1, dmax: 2, seed: 1, hb: 4, etmin: 12, etmax: 24, maxT: 70 },
    params: [
      { key: 'hb', type: 'number', min: 1, max: 20, label: 'Heartbeat interval', hint: 'How often a leader sends AppendEntries.' },
      { key: 'etmin', type: 'number', min: 4, max: 100, label: 'Shortest election timeout', hint: 'Must exceed the heartbeat interval plus a round trip.' },
      { key: 'etmax', type: 'number', min: 4, max: 150, label: 'Longest election timeout', hint: 'Each timer is picked at random in this range (seeded) so servers rarely time out together.' },
      { key: 'maxT', type: 'number', min: 10, max: 300, label: 'Run until time', hint: 'Heartbeats go on forever, so the run stops here.' }
    ],
    ops: { cmd: ['word'], crash: [], recover: [], cut: [], heal: [], _start: [] },
    grammar: 'Steps: "TIME NODE cmd NAME" (a client sends a command to this server; a follower forwards it to the leader it knows), crash, recover, cut (disconnect this server from the network but keep it running), heal.',
    presets: [
      { id: 'basic', name: 'Elect a leader and replicate commands', cfg: { n: 3, seed: 1 }, text: '30 A cmd set-x\n34 B cmd set-y', note: 'Nobody is leader at the start. Whichever timer fires first becomes candidate, wins the vote, and from then on every command is replicated to a majority before it commits.' },
      { id: 'five', name: 'Five servers', cfg: { n: 5, seed: 4 }, text: '30 A cmd a\n32 C cmd b\n40 E cmd c', note: 'A majority is now 3 of 5. Commands sent to followers are forwarded to the leader.' },
      { id: 'split', name: 'Competing candidates (try other seeds)', cfg: { n: 5, seed: 16, etmin: 12, etmax: 15, dmin: 1, dmax: 3 }, text: '45 A cmd x', note: 'Very similar timeouts make several servers candidates at once, so votes split and a new election with a higher term is needed. Change the seed to see different races.' },
      { id: 'crash', name: 'The leader crashes', cfg: { n: 3, seed: 1, maxT: 100 }, text: '30 A cmd before\n40 B crash\n70 A cmd after', note: 'B was the leader. When it stops sending heartbeats a follower times out, wins a new term, and the log keeps growing.' },
      { id: 'cut', name: 'The leader is cut off, then heals', cfg: { n: 3, seed: 1, maxT: 130 }, text: '30 A cmd before\n40 B cut\n45 B cmd lost\n80 B heal\n100 A cmd after', note: 'The old leader keeps accepting commands it can never commit. The majority elects a new leader; when B reconnects it steps down, and the next command overwrites B\'s uncommitted entry.' }
    ],
    validate(cfg) {
      const e = []; if (cfg.etmax < cfg.etmin) e.push('The longest election timeout must not be smaller than the shortest.');
      if (cfg.etmin <= cfg.hb + 2 * cfg.dmax) e.push('The shortest election timeout (' + cfg.etmin + ') must exceed the heartbeat interval plus a round trip (' + (cfg.hb + 2 * cfg.dmax) + '), or followers would time out between heartbeats.');
      return e;
    },
    implicit(cfg) { return Array.from({ length: cfg.n }, (_, i) => ({ t: 0, node: i, op: '_start' })); },
    init(cfg) { return Array.from({ length: cfg.n }, () => ({ role: 'follower', term: 0, votedFor: -1, log: [], commit: 0, leader: -1, votes: 0, next: [], match: [] })); },
    handle(ctx, ev) {
      const s = ctx.st, N = ctx.n, me = ctx.me, nm = ctx.names, cfg = ctx.cfg, maj = Math.floor(N / 2) + 1;
      const others = []; for (let j = 0; j < N; j++) if (j !== me) others.push(j);
      const resetElect = () => { ctx.cancel('elect'); ctx.timer(cfg.etmin + Math.floor(ctx.rand() * (cfg.etmax - cfg.etmin + 1)), 'elect'); };
      const stepDown = (term, why) => { const was = s.role; s.term = term; s.votedFor = -1; s.role = 'follower'; s.votes = 0; s.leader = -1; ctx.cancel('hb'); if (was !== 'follower') ctx.note(nm[me] + ' sees ' + why + ' and steps down to FOLLOWER in term ' + term + '.'); };
      const sendAppend = (j) => { const prev = s.next[j] - 1; ctx.send(j, 'AppendEntries', { term: s.term, prev, prevTerm: termAt(s.log, prev), entries: s.log.slice(prev), commit: s.commit }); };
      const broadcast = () => others.forEach(sendAppend);
      const snapCommit = (before) => { if (s.commit !== before) ctx.ann({ committed: s.log.slice(0, s.commit).map((e) => e.term + ':' + e.cmd) }); };
      const accept = (cmd) => { s.log.push({ term: s.term, cmd }); s.match[me] = s.log.length; ctx.ann({ accepted: cmd }); ctx.note(nm[me] + ' (leader, term ' + s.term + ') appends "' + cmd + '" as entry ' + s.log.length + ' and replicates it.'); broadcast(); };
      const startElection = () => {
        s.role = 'candidate'; s.term++; s.votedFor = me; s.votes = 1; s.leader = -1; resetElect(); ctx.ann({ election: s.term });
        others.forEach((j) => ctx.send(j, 'RequestVote', { term: s.term, lli: s.log.length, llt: termAt(s.log, s.log.length) }));
        ctx.note(nm[me] + '\'s election timer fired with no leader heard: it becomes CANDIDATE for term ' + s.term + ', votes for itself and asks the others (needs ' + maj + ' of ' + N + ').'); ctx.tag('cand t' + s.term);
      };
      const becomeLeader = () => {
        s.role = 'leader'; s.leader = me; ctx.cancel('elect'); s.next = new Array(N).fill(s.log.length + 1); s.match = new Array(N).fill(0); s.match[me] = s.log.length;
        ctx.ann({ leaderTerm: s.term }); ctx.tag('LEADER t' + s.term); ctx.note(nm[me] + ' has a majority of votes: it is LEADER of term ' + s.term + ' and sends heartbeats at once.'); broadcast(); ctx.timer(cfg.hb, 'hb');
      };

      if (ev.type === 'ext' && ev.op === '_start') { resetElect(); return; }
      if (ev.type === 'recover') { s.role = 'follower'; s.votes = 0; s.leader = -1; ctx.note(nm[me] + ' restarts as a follower, keeping its saved term ' + s.term + ', vote and log.'); resetElect(); return; }
      if (ev.type === 'ext' && ev.op === 'cmd') {
        const cmd = ev.args[0];
        if (s.role === 'leader') accept(cmd);
        else if (s.leader >= 0 && s.leader !== me) { ctx.send(s.leader, 'CLIENT', { cmd }); ctx.note(nm[me] + ' is not the leader; it forwards "' + cmd + '" to ' + nm[s.leader] + ', the leader it knows.'); }
        else { ctx.ann({ rejected: cmd }); ctx.note(nm[me] + ' knows no leader right now, so the command "' + cmd + '" is rejected (the client would retry).'); }
        return;
      }
      if (ev.type === 'timer') {
        if (ev.tag === 'elect' && s.role !== 'leader') startElection();
        else if (ev.tag === 'hb' && s.role === 'leader') { broadcast(); ctx.timer(cfg.hb, 'hb'); }
        return;
      }
      if (ev.type !== 'msg') return;
      const m = ev.msg, p = m.payload, from = m.from;
      if (m.type === 'CLIENT') { if (s.role === 'leader') accept(p.cmd); else { ctx.ann({ rejected: p.cmd }); ctx.note(nm[me] + ' is not the leader any more, so the forwarded command "' + p.cmd + '" is dropped.'); } return; }
      if (p.term > s.term) stepDown(p.term, 'term ' + p.term + ' from ' + nm[from]);
      if (m.type === 'RequestVote') {
        const ok = p.term >= s.term && (s.votedFor === -1 || s.votedFor === from) && upToDate(p.llt, p.lli, s.log) && p.term === s.term;
        if (ok) { s.votedFor = from; resetElect(); }
        ctx.send(from, 'VoteReply', { term: s.term, granted: ok });
        ctx.note(nm[me] + (ok ? ' grants its vote for term ' + s.term + ' to ' + nm[from] + '.' : ' refuses ' + nm[from] + ': ' + (p.term < s.term ? 'its term is old' : s.votedFor !== -1 && s.votedFor !== from ? 'it already voted for ' + nm[s.votedFor] + ' this term' : 'the candidate\'s log is not up to date') + '.'));
      } else if (m.type === 'VoteReply') {
        if (s.role === 'candidate' && p.term === s.term && p.granted) { s.votes++; ctx.note(nm[me] + ' now has ' + s.votes + ' of ' + N + ' votes.'); if (s.votes >= maj) becomeLeader(); }
      } else if (m.type === 'AppendEntries') {
        if (p.term < s.term) { ctx.send(from, 'AppendReply', { term: s.term, ok: false, match: 0 }); ctx.note(nm[me] + ' rejects a stale leader (term ' + p.term + ' < ' + s.term + ').'); return; }
        if (s.role !== 'follower') { s.role = 'follower'; s.votes = 0; ctx.cancel('hb'); }
        s.leader = from; resetElect();
        const r = applyAppend(s.log, p.prev, p.prevTerm, p.entries);
        if (!r.ok) { ctx.send(from, 'AppendReply', { term: s.term, ok: false, match: 0 }); ctx.note(nm[me] + ' has no entry ' + p.prev + ' of term ' + p.prevTerm + ': its log does not match, so it refuses and the leader will back up.'); return; }
        const before = s.commit, had = s.log.length; s.log = r.log;
        const last = p.prev + p.entries.length; if (p.commit > s.commit) s.commit = Math.min(p.commit, last);
        ctx.send(from, 'AppendReply', { term: s.term, ok: true, match: last });
        if (p.entries.length) ctx.note(nm[me] + ' appends ' + p.entries.length + ' entr' + (p.entries.length === 1 ? 'y' : 'ies') + ' from ' + nm[from] + (s.log.length < had ? ' (and discards conflicting ones)' : '') + '.'); else ctx.note(nm[me] + ' accepts a heartbeat from leader ' + nm[from] + ' and resets its election timer.');
        snapCommit(before);
      } else if (m.type === 'AppendReply') {
        if (s.role !== 'leader' || p.term !== s.term) return;
        if (p.ok) { s.match[from] = Math.max(s.match[from], p.match); s.next[from] = s.match[from] + 1; const before = s.commit; s.commit = newCommit(s.match, s.log, s.term, s.commit); if (s.commit !== before) { ctx.note('Entry ' + s.commit + ' is stored on a majority: COMMITTED.'); snapCommit(before); } }
        else { s.next[from] = Math.max(1, s.next[from] - 1); ctx.note(nm[me] + ' backs up to entry ' + s.next[from] + ' for ' + nm[from] + ' and retries.'); sendAppend(from); }
      }
    },
    describe(s, i, cfg) {
      const lines = [s.role + ', term ' + s.term, 'voted for ' + (s.votedFor < 0 ? 'nobody' : 'ABCDE'[s.votedFor]), 'log: ' + (s.log.length ? fmtLog(s) : '(empty)')];
      return { lines, badge: s.role === 'leader' ? 'LEADER' : s.role === 'candidate' ? 'CANDIDATE' : '' };
    },
    report(res) {
      const leaders = {}; res.events.forEach((e) => { if (e.ann.leaderTerm) (leaders[e.ann.leaderTerm] = leaders[e.ann.leaderTerm] || []).push(res.names[e.node]); });
      const terms = Object.keys(leaders).map(Number).sort((a, b) => a - b), dup = terms.filter((t) => leaders[t].length > 1);
      const snaps = res.events.filter((e) => e.ann.committed).map((e) => e.ann.committed); let longest = []; snaps.forEach((x) => { if (x.length > longest.length) longest = x; });
      const consistent = snaps.every((x) => x.every((v, k) => v === longest[k]));
      const accepted = res.events.filter((e) => e.ann.accepted).map((e) => e.ann.accepted), rejected = res.events.filter((e) => e.ann.rejected).length;
      const committedCmds = longest.map((x) => x.slice(x.indexOf(':') + 1)), lost = accepted.filter((c) => !committedCmds.includes(c));
      const byType = {}; res.msgs.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
      const liveLeaders = res.state.map((s, i) => (s.role === 'leader' && !res.down[i] && !res.cut[i] ? i : -1)).filter((i) => i >= 0);
      const elections = res.events.filter((e) => e.ann.election).length;
      const metrics = [['Elections started', elections], ['Leaders elected', terms.reduce((a, t) => a + leaders[t].length, 0)], ['Highest term', Math.max(0, ...res.state.map((s) => s.term))], ['Commands accepted', accepted.length], ['Entries committed', longest.length], ['Messages sent', res.msgs.length]];
      ['AppendEntries', 'RequestVote'].forEach((k) => { if (byType[k]) metrics.push([k + ' messages', byType[k]]); });
      const checks = [
        { ok: dup.length === 0, text: dup.length ? 'ELECTION SAFETY VIOLATED: term ' + dup[0] + ' had two leaders (' + leaders[dup[0]].join(', ') + ').' : 'Election safety: at most one leader was elected in every term (' + (terms.length ? terms.map((t) => 'term ' + t + ': ' + leaders[t][0]).join(', ') : 'no leader yet') + ').' },
        { ok: consistent, text: consistent ? 'State-machine safety: every node\'s committed entries are a prefix of one common sequence (' + longest.length + ' committed).' : 'SAFETY VIOLATED: two nodes committed different entries at the same index.' },
        { ok: liveLeaders.length >= 1, text: liveLeaders.length ? 'A working leader exists at the end: ' + liveLeaders.map((i) => res.names[i]).join(', ') + '.' : 'No connected leader at the end of the run (an election may still be in progress, or too few servers are connected).' }
      ];
      if (lost.length) checks.push({ ok: false, text: lost.length + ' accepted command' + (lost.length === 1 ? '' : 's') + ' never committed (' + lost.map((c) => '"' + c + '"').join(', ') + '): accepted by a leader that could not reach a majority, or by one that was replaced first. The client would have to retry.' });
      return { metrics, checks, tables: [{ title: 'Terms and their leaders', head: ['Term', 'Leader'], rows: terms.map((t) => [t, leaders[t].join(', ')]) }, { title: 'Final logs (entries are term:command; | marks the commit point)', head: ['Node', 'Status', 'Role', 'Term', 'Log'], rows: res.state.map((s, i) => [res.names[i], res.down[i] ? 'down' : res.cut[i] ? 'cut off' : 'up', s.role, s.term, s.log.length ? fmtLog(s) : '(empty)']) }], note: rejected ? rejected + ' command' + (rejected === 1 ? ' was' : 's were') + ' rejected because the receiving server knew no leader.' : '' };
    },
    termAt, upToDate, applyAppend, newCommit
  };
  MP.register(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
