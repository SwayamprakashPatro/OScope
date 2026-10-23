/* Protocol: distributed mutual exclusion. Several nodes want a critical section but share no memory and no lock;
   they only exchange messages. Two classic answers:

   Ricart-Agrawala (permission based): to enter, ask EVERYONE (REQUEST with a Lamport timestamp) and wait for every
     REPLY. Someone who is in the section, or who asked earlier (smaller (timestamp, id)), holds back its reply until
     it is done. Cost: 2 x (N - 1) messages per entry. Any crashed node blocks everyone, since its reply never comes.
   Token ring (token based): one TOKEN travels around a ring; only its holder may enter. Cost: between 0 and N - 1
     messages per entry, but the token keeps circulating even when nobody wants it, and if it is lost nobody can enter.

   Safety (never two nodes inside at once) is CHECKED from the recorded intervals, not assumed. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), MP = NS.mp || (typeof require !== 'undefined' ? require('./mp.js') : null);
  const OPTIONS = [
    { id: 'ra', name: 'Ricart-Agrawala (permission)', short: 'Ricart-Agrawala', hook: 'Ask everyone; the one with the older ticket goes first. 2(N-1) messages.',
      about: { rule: 'To enter, send a REQUEST (with your Lamport timestamp) to every other node and wait for N-1 REPLYs. A node replies at once unless it is in the section, or it asked earlier: then it defers the reply until it leaves.', watch: 'Every node must answer. A single crashed node means nobody can ever finish collecting replies.' } },
    { id: 'token', name: 'Token ring', short: 'Token ring', hook: 'Only the token holder may enter. Pass it on if you do not need it.',
      about: { rule: 'A single TOKEN circulates around the ring A, B, C... A node that wants the section waits for the token, uses it, then passes it on. A node that does not want it passes it straight on.', watch: 'The token circulates even when nobody wants it, and if it is lost (a crash while holding it, or a drop) nobody can ever enter again.' } }
  ];

  const less = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const P = {
    id: 'mutex', name: 'Distributed mutual exclusion', minN: 2, maxN: 6,
    intro: 'Nodes want a critical section but share no lock. Choose an algorithm, type who wants in and when, and watch the messages that decide who goes first. Crash a node to see each algorithm\'s weak spot.',
    hook: 'Permission or token: either ask everyone, or own the only token.',
    about: OPTIONS[0].about,
    defaults: { n: 3, dmin: 1, dmax: 3, seed: 1, algo: 'ra', cs: 3, loss: 0 },
    usesLoss: true,
    params: [
      { key: 'algo', type: 'select', chips: true, label: 'Algorithm', options: OPTIONS },
      { key: 'cs', type: 'number', min: 1, max: 30, label: 'Time spent inside the critical section', hint: 'How long a node holds the section before leaving.' }
    ],
    ops: { want: [], crash: [], recover: [], _start: [] },
    grammar: 'Steps: "TIME NODE want" (the node wants the critical section), crash, recover.',
    presets: [
      { id: 'ra-tie', name: 'Ricart-Agrawala: two ask at once', cfg: { algo: 'ra', n: 3, dmin: 1, dmax: 1, cs: 3 }, text: '1 A want\n1 B want\n6 C want', note: 'A and B request in the same instant with the same timestamp, so the node id breaks the tie. C asks later and waits its turn.' },
      { id: 'ra-many', name: 'Ricart-Agrawala: four nodes, random delays', cfg: { algo: 'ra', n: 4, dmin: 1, dmax: 4, cs: 2, seed: 7 }, text: '1 A want\n2 B want\n3 C want\n4 D want', note: 'Every entry costs 2(N-1) = 6 messages here, however busy the system is.' },
      { id: 'ra-crash', name: 'Ricart-Agrawala: a crashed node blocks everyone', cfg: { algo: 'ra', n: 3, dmin: 1, dmax: 1, cs: 3 }, text: '1 C crash\n2 A want', note: 'C never replies, so A waits forever. This is the algorithm\'s well-known weakness.' },
      { id: 'tok-basic', name: 'Token ring: two requests', cfg: { algo: 'token', n: 4, dmin: 1, dmax: 1, cs: 2 }, text: '2 C want\n5 A want', note: 'Watch the token travel A, B, C... and stop at whoever wants it. Most hops carry nobody\'s request.' },
      { id: 'tok-idle', name: 'Token ring: a late request pays for idle laps', cfg: { algo: 'token', n: 5, dmin: 1, dmax: 1, cs: 2 }, text: '1 B want\n20 E want', note: 'Between the two requests the token keeps circulating for nothing, which is the price of this design.' },
      { id: 'tok-crash', name: 'Token ring: the token is lost', cfg: { algo: 'token', n: 4, dmin: 1, dmax: 1, cs: 2 }, text: '2 C crash\n3 A want', note: 'The token reaches the crashed node and is dropped. Nobody can ever enter again.' }
    ],
    implicit(cfg) { return cfg.algo === 'token' ? [{ t: 0, node: 0, op: '_start' }] : []; },
    init(cfg) { return Array.from({ length: cfg.n }, (_, i) => ({ st: 'idle', L: 0, reqTs: 0, replies: 0, deferred: [], tok: false, log: [], req: null })); },
    handle(ctx, ev) {
      const s = ctx.st, cfg = ctx.cfg, N = ctx.n, nm = ctx.names;
      if (cfg.algo === 'ra') {
        if (ev.type === 'ext' && ev.op === 'want') {
          if (s.st !== 'idle') { ctx.note(nm[ctx.me] + ' already wants or holds the section, so this step is ignored.'); return; }
          s.L++; s.reqTs = s.L; s.st = 'wanted'; s.replies = 0; s.req = { want: ctx.t };
          for (let j = 0; j < N; j++) if (j !== ctx.me) ctx.send(j, 'REQUEST', { ts: s.reqTs });
          ctx.note('Asks everyone for permission with timestamp ' + s.reqTs + ' and waits for ' + (N - 1) + ' replies.'); ctx.tag('ts ' + s.reqTs);
        } else if (ev.type === 'msg' && ev.msg.type === 'REQUEST') {
          const j = ev.msg.from, ts = ev.msg.payload.ts; s.L = Math.max(s.L, ts) + 1;
          const defer = s.st === 'cs' || (s.st === 'wanted' && less([s.reqTs, ctx.me], [ts, j]));
          if (defer) { s.deferred.push(j); ctx.note(nm[ctx.me] + ' ' + (s.st === 'cs' ? 'is inside the section' : 'asked earlier (ts ' + s.reqTs + ' vs ' + ts + (s.reqTs === ts ? ', tie broken by node id' : '') + ')') + ', so it DEFERS its reply to ' + nm[j] + '.'); }
          else { ctx.send(j, 'REPLY', {}); ctx.note(nm[ctx.me] + ' ' + (s.st === 'wanted' ? 'asked later (ts ' + s.reqTs + ' vs ' + ts + '), so it lets ' + nm[j] + ' go first and replies' : 'is not interested, so it replies') + ' at once.'); }
        } else if (ev.type === 'msg' && ev.msg.type === 'REPLY') {
          if (s.st !== 'wanted') return;
          s.replies++; ctx.note('Reply ' + s.replies + ' of ' + (N - 1) + '.');
          if (s.replies === N - 1) { s.st = 'cs'; s.req.enter = ctx.t; ctx.timer(cfg.cs, 'exit'); ctx.note('Has every reply: ENTERS the critical section until t=' + (ctx.t + cfg.cs) + '.'); ctx.tag('IN'); }
        } else if (ev.type === 'timer' && ev.tag === 'exit') {
          s.st = 'idle'; s.req.exit = ctx.t; s.log.push(s.req); s.req = null;
          s.deferred.forEach((j) => ctx.send(j, 'REPLY', {})); ctx.note('Leaves the section' + (s.deferred.length ? ' and sends the deferred replies to ' + s.deferred.map((j) => nm[j]).join(', ') + '.' : '.')); s.deferred = []; ctx.tag('OUT');
        }
      } else {
        const next = (ctx.me + 1) % N;
        const pass = () => {
          if (ctx.pendingExt('want') === 0 && !ctx.states.some((x) => x.st === 'wanted')) { s.tok = true; ctx.note('Nobody wants the section any more, so the token stays here. (The lab stops the circulation to keep the diagram readable; a real ring would keep passing it.)'); return; }
          s.tok = false; ctx.send(next, 'TOKEN', {}); ctx.note('Passes the token to ' + nm[next] + '.');
        };
        if (ev.type === 'ext' && ev.op === '_start') { s.tok = true; ctx.note(nm[ctx.me] + ' starts with the token.'); pass(); }
        else if (ev.type === 'ext' && ev.op === 'want') {
          if (s.st !== 'idle') { ctx.note('Already waiting or inside, so this step is ignored.'); return; }
          s.st = 'wanted'; s.req = { want: ctx.t }; ctx.note(nm[ctx.me] + ' wants the section and waits for the token.'); ctx.tag('wants');
          if (s.tok) { s.st = 'cs'; s.req.enter = ctx.t; ctx.timer(cfg.cs, 'exit'); ctx.note('It already holds the idle token: enters immediately.'); }
        } else if (ev.type === 'msg' && ev.msg.type === 'TOKEN') {
          s.tok = true;
          if (s.st === 'wanted') { s.st = 'cs'; s.req.enter = ctx.t; ctx.timer(cfg.cs, 'exit'); ctx.note('Token arrives and ' + nm[ctx.me] + ' wants it: ENTERS until t=' + (ctx.t + cfg.cs) + '.'); ctx.tag('IN'); }
          else { ctx.note('Token arrives; ' + nm[ctx.me] + ' does not need it.'); pass(); }
        } else if (ev.type === 'timer' && ev.tag === 'exit') {
          s.st = 'idle'; s.req.exit = ctx.t; s.log.push(s.req); s.req = null; ctx.note('Leaves the section.'); ctx.tag('OUT'); pass();
        }
      }
    },
    describe(s, i, cfg) {
      const ra = cfg.algo === 'ra', st = s.st === 'cs' ? 'INSIDE the critical section' : s.st === 'wanted' ? 'WAITING' : 'idle';
      const lines = [st];
      if (ra) { lines.push('Lamport L = ' + s.L); if (s.st === 'wanted') lines.push('request ts ' + s.reqTs + ', replies ' + s.replies + '/' + (cfg.n - 1)); if (s.deferred.length) lines.push('deferred: ' + s.deferred.map((j) => 'ABCDEF'[j]).join(', ')); }
      else lines.push(s.tok ? 'holds the token' : 'no token');
      return { lines, badge: s.st === 'cs' ? 'IN CS' : (!ra && s.tok ? 'TOKEN' : '') };
    },
    report(res) {
      const cfg = res.cfg, N = cfg.n, entries = [];
      res.state.forEach((s, i) => s.log.forEach((r) => entries.push({ node: i, want: r.want, enter: r.enter, exit: r.exit })));
      // a request that was entered but never left (run ended inside the section) still counts for safety
      res.state.forEach((s, i) => { if (s.req && s.req.enter != null) entries.push({ node: i, want: s.req.want, enter: s.req.enter, exit: null }); });
      entries.sort((a, b) => a.enter - b.enter || a.node - b.node);
      let overlap = null;
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) { const a = entries[i], b = entries[j]; if (b.enter < (a.exit == null ? Infinity : a.exit) && a.enter < (b.exit == null ? Infinity : b.exit)) overlap = [a, b]; }
      const asked = res.ext.filter((e) => e.op === 'want').length;
      const served = entries.length, unserved = res.state.filter((s) => s.st === 'wanted').length;
      const byType = {}; res.msgs.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
      const total = res.msgs.length, waits = entries.map((e) => e.enter - e.want);
      const checks = [{ ok: !overlap, text: overlap ? 'MUTUAL EXCLUSION VIOLATED: ' + res.names[overlap[0].node] + ' and ' + res.names[overlap[1].node] + ' were inside together.' : 'Mutual exclusion holds: no two nodes were ever inside the critical section at the same time (' + served + ' entr' + (served === 1 ? 'y' : 'ies') + ' checked).' }];
      checks.push({ ok: unserved === 0, text: unserved === 0 ? 'Every request that was made was served.' : unserved + ' request' + (unserved === 1 ? ' is' : 's are') + ' still waiting at the end, so nobody can make progress (a liveness failure, not a safety one).' });
      if (cfg.algo === 'ra' && served && unserved === 0 && cfg.loss === 0 && !res.state.some((s, i) => res.events.some((e) => e.node === i && e.kind === 'crash'))) { const per = (byType.REQUEST + byType.REPLY) / served; checks.push({ ok: per === 2 * (N - 1), text: 'Messages per entry = ' + per + (per === 2 * (N - 1) ? ', exactly the 2 x (N - 1) = ' + 2 * (N - 1) + ' that Ricart-Agrawala is known to cost.' : ' (expected 2 x (N - 1) = ' + 2 * (N - 1) + ').') }); }
      const metrics = [['Requests made', asked], ['Entries completed', served], ['Messages sent', total], ['Messages per entry', served ? (total / served).toFixed(1) : '–'], ['Longest wait', waits.length ? Math.max(...waits) : '–']];
      Object.keys(byType).forEach((k) => metrics.push([k + ' messages', byType[k]]));
      return { metrics, checks, tables: [{ title: 'Who entered, and when', head: ['Order', 'Node', 'Wanted at', 'Entered at', 'Left at', 'Waited'], rows: entries.map((e, k) => [k + 1, res.names[e.node], e.want, e.enter, e.exit == null ? '(still inside)' : e.exit, e.enter - e.want]) }] };
    },
    startText(cfg) { return cfg.algo === 'token' ? 'Start: the token begins at A and will start circulating. Press Next.' : 'Start: every node is idle. Press Next to run the first step.'; }
  };
  MP.register(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
