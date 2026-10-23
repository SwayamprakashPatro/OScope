/* Protocol: two-phase commit (2PC). A transaction touches data on several nodes, and either ALL of them must
   commit or ALL must abort. Node A is the coordinator; the others are participants.

   Phase 1 (voting):  A sends PREPARE. Each participant that can commit saves its work and votes YES, and from then on it is
                      PREPARED: it may no longer decide alone. A participant that cannot commit votes NO and aborts at once.
   Phase 2 (decision): if every vote is YES, A sends COMMIT; if any vote is NO (or one is missing at the timeout) A sends ABORT.
                      Participants obey and ACK.

   The famous weakness is BLOCKING: a prepared participant that never hears the decision (coordinator crashed) cannot safely
   commit or abort on its own, because the others may have decided the opposite. It must wait. With "cooperative termination"
   it can ask the other participants, which helps only if one of them already knows the outcome.

   Simplifications: A is the coordinator and always has a durable log (so it remembers its decision and, if it recovers while still
   collecting votes, presumes ABORT). The all-YES run costs 4 x (N - 1) messages. Atomicity is CHECKED from the final states. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), MP = NS.mp || (typeof require !== 'undefined' ? require('./mp.js') : null);
  const P = {
    id: 'twopc', name: 'Two-phase commit', minN: 3, maxN: 6,
    intro: 'A distributed transaction must commit everywhere or nowhere. Node A coordinates: it asks every participant to vote, then announces the decision. Make a participant vote NO, crash a node, and see when 2PC blocks.',
    hook: 'Vote, then decide. Once you vote YES you have handed your freedom to the coordinator.',
    about: { rule: 'Phase 1: A sends PREPARE; each participant votes YES (and becomes prepared) or NO (and aborts). Phase 2: all YES means COMMIT, any NO or missing vote means ABORT. A prepared participant must wait for A\'s decision.', watch: 'If A crashes after participants have voted YES, they are stuck in the "uncertain" state: committing might disagree with a node that aborted, so they block until A returns.' },
    defaults: { n: 3, dmin: 1, dmax: 1, seed: 1, timeout: 6, coop: false, loss: 0 },
    usesLoss: true,
    params: [
      { key: 'timeout', type: 'number', min: 2, max: 60, label: 'Timeout', hint: 'How long A waits for votes, and how long a prepared participant waits for the decision before it starts asking. At least twice the slowest delay.' },
      { key: 'coop', type: 'checkbox', label: 'Cooperative termination (blocked participants also ask each other)' }
    ],
    ops: { begin: [], no: [], crash: [], recover: [] },
    grammar: 'Steps: "TIME A begin" (start the transaction), "TIME NODE no" (this participant will vote NO), crash, recover. Node A is always the coordinator.',
    presets: [
      { id: 'commit', name: 'Everyone votes YES: commit', cfg: { n: 3, dmin: 1, dmax: 1, timeout: 6, coop: false }, text: '1 A begin', note: 'Two phases, 4 x (N-1) messages: PREPARE, VOTE, COMMIT, ACK for each participant.' },
      { id: 'abort', name: 'One participant votes NO: abort', cfg: { n: 4, dmin: 1, dmax: 1, timeout: 6, coop: false }, text: '0 C no\n1 A begin', note: 'One NO is enough. C aborts on its own; A tells the others to abort.' },
      { id: 'part-crash', name: 'A participant crashes before voting', cfg: { n: 3, dmin: 1, dmax: 1, timeout: 5, coop: false }, text: '1 C crash\n1 A begin', note: 'A never gets C\'s vote, times out and aborts the transaction for everyone.' },
      { id: 'block', name: 'The coordinator crashes after PREPARE: blocking', cfg: { n: 3, dmin: 1, dmax: 1, timeout: 5, coop: false }, text: '1 A begin\n2 A crash', note: 'B and C voted YES and now cannot decide. They keep asking A and get no answer: BLOCKED.' },
      { id: 'block-coop', name: 'Blocking, with cooperative termination', cfg: { n: 4, dmin: 1, dmax: 1, timeout: 5, coop: true }, text: '0 D no\n1 A begin\n2 A crash', note: 'D voted NO so it knows the outcome is ABORT. B and C ask around, learn that, and are unblocked. If nobody knew, they would still be stuck.' },
      { id: 'block-all', name: 'Cooperative termination cannot always help', cfg: { n: 3, dmin: 1, dmax: 1, timeout: 5, coop: true }, text: '1 A begin\n2 A crash', note: 'Everybody voted YES, nobody knows the decision, so asking each other changes nothing.' },
      { id: 'recover', name: 'The coordinator comes back', cfg: { n: 3, dmin: 1, dmax: 1, timeout: 5, coop: false }, text: '1 A begin\n2 A crash\n30 A recover', note: 'A recovers before deciding, presumes ABORT and tells everyone. The blocked participants are released.' }
    ],
    validate(cfg, ext) {
      const e = [];
      if (cfg.timeout < 2 * cfg.dmax) e.push('The timeout (' + cfg.timeout + ') must be at least twice the slowest delay (' + 2 * cfg.dmax + ').');
      ext.forEach((x) => { if (x.op === 'begin' && x.node !== 0) e.push('Line ' + x.line + ': only the coordinator A can begin a transaction.'); if (x.op === 'no' && x.node === 0) e.push('Line ' + x.line + ': "no" is a participant\'s vote; A is the coordinator.'); });
      if (!ext.some((x) => x.op === 'begin')) e.push('Add "1 A begin" so the coordinator starts a transaction.');
      return e;
    },
    init(cfg) { return Array.from({ length: cfg.n }, (_, i) => i === 0 ? { role: 'coord', phase: 'idle', votes: {}, acks: 0, decision: null } : { role: 'part', st: 'init', willNo: false, tries: 0, blocked: false }); },
    handle(ctx, ev) {
      const s = ctx.st, nm = ctx.names, N = ctx.n, cfg = ctx.cfg, me = ctx.me;
      const parts = []; for (let j = 1; j < N; j++) parts.push(j);
      const decide = (d) => {
        s.decision = d; s.phase = d; ctx.cancel('votes'); const targets = parts.filter((j) => s.votes[j] !== 'no' || d === 'commit');
        targets.forEach((j) => ctx.send(j, d === 'commit' ? 'COMMIT' : 'ABORT', {})); ctx.note('Decision: ' + d.toUpperCase() + '. Sends it to ' + (targets.length ? targets.map((j) => nm[j]).join(', ') : 'nobody (every participant already aborted)') + '.'); ctx.tag(d.toUpperCase());
      };
      if (s.role === 'coord') {
        if (ev.type === 'ext' && ev.op === 'begin') {
          if (s.phase !== 'idle') { ctx.note('A transaction is already running, so this step is ignored.'); return; }
          s.phase = 'waiting'; parts.forEach((j) => ctx.send(j, 'PREPARE', {})); ctx.timer(cfg.timeout, 'votes'); ctx.note('Phase 1: sends PREPARE to ' + parts.map((j) => nm[j]).join(', ') + ' and waits up to ' + cfg.timeout + ' for every vote.'); ctx.tag('PREPARE');
        } else if (ev.type === 'msg' && (ev.msg.type === 'VOTE-YES' || ev.msg.type === 'VOTE-NO')) {
          if (s.phase !== 'waiting') { ctx.note('A late vote: the decision (' + s.decision + ') is already made.'); return; }
          const j = ev.msg.from, yes = ev.msg.type === 'VOTE-YES'; s.votes[j] = yes ? 'yes' : 'no';
          if (!yes) { ctx.note(nm[j] + ' voted NO, so the transaction cannot commit.'); decide('abort'); }
          else if (parts.every((p) => s.votes[p] === 'yes')) { ctx.note('All ' + parts.length + ' participants voted YES.'); decide('commit'); }
          else ctx.note(nm[j] + ' voted YES (' + parts.filter((p) => s.votes[p]).length + ' of ' + parts.length + ' votes in).');
        } else if (ev.type === 'timer' && ev.tag === 'votes') { if (s.phase === 'waiting') { ctx.note('Timeout: a vote is missing (' + parts.filter((p) => !s.votes[p]).map((p) => nm[p]).join(', ') + '), so the coordinator must abort.'); decide('abort'); } }
        else if (ev.type === 'msg' && ev.msg.type === 'ACK') { s.acks++; ctx.note('ACK ' + s.acks + '.'); }
        else if (ev.type === 'msg' && ev.msg.type === 'QUERY') { if (s.decision) { ctx.send(ev.msg.from, 'DECISION', { d: s.decision }); ctx.note('Tells ' + nm[ev.msg.from] + ' the decision: ' + s.decision + '.'); } else ctx.note('Still collecting votes, so it cannot answer ' + nm[ev.msg.from] + ' yet.'); }
        else if (ev.type === 'recover') {
          if (s.phase === 'waiting') { ctx.note('Recovered while the vote was still open: no decision was logged, so it presumes ABORT.'); decide('abort'); }
          else if (s.decision) { s.decision && parts.forEach((j) => ctx.send(j, s.decision === 'commit' ? 'COMMIT' : 'ABORT', {})); ctx.note('Recovered; resends its logged decision (' + s.decision + ') to everyone.'); }
        }
        return;
      }
      // participant
      const ask = () => { s.tries++; const to = cfg.coop ? [0].concat(parts.filter((j) => j !== me)) : [0]; to.forEach((j) => ctx.send(j, 'QUERY', {})); ctx.note(nm[me] + ' is PREPARED but has heard no decision: it cannot commit or abort alone. It asks ' + to.map((j) => nm[j]).join(', ') + '.'); if (s.tries < 3) ctx.timer(cfg.timeout, 'decision'); else { s.blocked = true; ctx.note(nm[me] + ' stops retrying: it is BLOCKED until a decision reaches it.'); } };
      const learn = (d, src) => { s.st = d === 'commit' ? 'committed' : 'aborted'; s.blocked = false; ctx.cancel('decision'); ctx.note(nm[me] + ' ' + d + 's' + (src ? ' (told by ' + nm[src] + ')' : '') + '.'); ctx.tag(d.toUpperCase()); };
      if (ev.type === 'ext' && ev.op === 'no') { s.willNo = true; ctx.note(nm[me] + ' will vote NO (its local work cannot commit).'); ctx.tag('will vote NO'); }
      else if (ev.type === 'msg' && ev.msg.type === 'PREPARE') {
        if (s.willNo) { s.st = 'aborted'; ctx.send(0, 'VOTE-NO', {}); ctx.note(nm[me] + ' votes NO and aborts immediately: it knows the outcome is ABORT.'); ctx.tag('NO'); }
        else { s.st = 'prepared'; ctx.send(0, 'VOTE-YES', {}); ctx.timer(cfg.timeout * 2, 'decision'); ctx.note(nm[me] + ' saves its work and votes YES. It is now PREPARED: from here on only the coordinator\'s decision can release it.'); ctx.tag('YES'); }
      } else if (ev.type === 'msg' && (ev.msg.type === 'COMMIT' || ev.msg.type === 'ABORT')) { learn(ev.msg.type === 'COMMIT' ? 'commit' : 'abort', null); ctx.send(0, 'ACK', {}); }
      else if (ev.type === 'msg' && ev.msg.type === 'DECISION') { if (s.st === 'prepared') learn(ev.msg.payload.d, ev.msg.from); }
      else if (ev.type === 'msg' && ev.msg.type === 'QUERY') {
        if (s.st === 'committed' || s.st === 'aborted') { ctx.send(ev.msg.from, 'DECISION', { d: s.st === 'committed' ? 'commit' : 'abort' }); ctx.note(nm[me] + ' knows the outcome (' + s.st + ') and tells ' + nm[ev.msg.from] + '.'); }
        else ctx.note(nm[me] + ' does not know the outcome either, so it cannot help ' + nm[ev.msg.from] + '.');
      } else if (ev.type === 'timer' && ev.tag === 'decision') { if (s.st === 'prepared') ask(); }
      else if (ev.type === 'recover') { if (s.st === 'prepared') { s.tries = 0; ctx.note(nm[me] + ' recovers with a logged YES vote and no decision: it must ask.'); ask(); } else ctx.note(nm[me] + ' recovers; its logged state is ' + s.st + '.'); }
    },
    describe(s, i, cfg) {
      if (s.role === 'coord') return { lines: ['coordinator', 'phase: ' + ({ idle: 'idle', waiting: 'collecting votes', commit: 'decided COMMIT', abort: 'decided ABORT' })[s.phase], 'votes: ' + (Object.keys(s.votes).length ? Object.keys(s.votes).map((k) => 'ABCDEF'[k] + '=' + s.votes[k]).join(' ') : 'none')], badge: s.decision ? s.decision.toUpperCase() : '' };
      return { lines: ['participant', 'state: ' + ({ init: 'working', prepared: 'PREPARED (voted YES)', committed: 'COMMITTED', aborted: 'ABORTED' })[s.st] + (s.willNo && s.st === 'init' ? ' (will vote NO)' : '')], badge: s.blocked ? 'BLOCKED' : (s.st === 'committed' ? 'COMMITTED' : s.st === 'aborted' ? 'ABORTED' : '') };
    },
    report(res) {
      const N = res.cfg.n, fin = res.state, outcome = (s) => (s.role === 'coord' ? s.decision : s.st === 'committed' ? 'commit' : s.st === 'aborted' ? 'abort' : null);
      const outs = fin.map(outcome), got = [...new Set(outs.filter(Boolean))];
      const stuck = fin.map((s, i) => (s.role === 'part' && s.st === 'prepared' && !res.down[i] ? i : -1)).filter((i) => i >= 0);
      const byType = {}; res.msgs.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
      const checks = [{ ok: got.length <= 1, text: got.length <= 1 ? 'Atomicity holds: nobody committed while another aborted' + (got.length ? ' (all decided nodes chose ' + got[0].toUpperCase() + ').' : ' (nobody decided).') : 'ATOMICITY VIOLATED: some nodes committed and others aborted.' }];
      checks.push({ ok: stuck.length === 0, text: stuck.length === 0 ? 'Nobody is blocked: every live node reached the outcome or never took part.' : stuck.map((i) => res.names[i]).join(', ') + (stuck.length === 1 ? ' is' : ' are') + ' BLOCKED: prepared (voted YES) but never told the decision. They can neither commit nor abort without risking disagreement.' });
      const undecided = fin.filter((s, i) => !res.down[i] && outcome(s) == null && !(s.role === 'part' && s.st === 'init')).length;
      const metrics = [['Messages sent', res.msgs.length]]; Object.keys(byType).forEach((k) => metrics.push([k + ' messages', byType[k]]));
      if (outs[0] === 'commit' && res.cfg.loss === 0 && !res.events.some((e) => e.kind === 'crash')) { checks.push({ ok: res.msgs.length === 4 * (N - 1), text: 'A clean commit used ' + res.msgs.length + ' messages = 4 x (N - 1) = ' + 4 * (N - 1) + ': PREPARE, VOTE, COMMIT and ACK for every participant.' }); }
      return { metrics, checks, tables: [{ title: 'Where everyone ended up', head: ['Node', 'Role', 'Status', 'Outcome'], rows: res.names.map((nmx, i) => [nmx, i === 0 ? 'coordinator' : 'participant', res.down[i] ? 'down' : 'up', outs[i] ? outs[i].toUpperCase() : (fin[i].role === 'part' && fin[i].st === 'prepared' ? 'UNCERTAIN (prepared)' : 'none')]) }] };
    }
  };
  MP.register(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
