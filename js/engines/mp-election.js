/* Protocol: leader election. Many distributed systems need exactly one coordinator. When the current one fails,
   the survivors must agree on a new one using only messages. Both algorithms here elect the node with the HIGHEST id
   that is still alive (ids are the order A < B < C ...):

   Bully:  a node that notices the leader is gone sends ELECTION to every higher node. Any live higher node answers OK
           ("back off, I am bigger") and runs its own election. A node that hears no OK before the timeout wins and
           tells everybody with COORDINATOR. A recovering node starts an election, "bullying" its way back.
   Ring (Chang-Roberts): nodes form a ring A -> B -> C -> ... An ELECTION message carries the largest id seen so far and
           goes round; a node forwards it if the id is bigger than its own, swallows it if smaller. When a node receives
           its OWN id back it has beaten everyone and sends COORDINATOR once round the ring.

   Simplification: in the ring a node is assumed to know its successor is down and skips to the next live one (a failure
   detector); the lab does not model detecting failures.  Agreement is CHECKED at the end from the nodes' own beliefs. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), MP = NS.mp || (typeof require !== 'undefined' ? require('./mp.js') : null);
  const OPTIONS = [
    { id: 'bully', name: 'Bully algorithm', short: 'Bully', hook: 'The biggest node alive bullies everyone else into backing down.',
      about: { rule: 'Whoever notices the leader is gone sends ELECTION to all higher ids. A higher node replies OK and takes over the election. If nobody answers before the timeout, the sender is the biggest alive node and announces itself with COORDINATOR.', watch: 'Many nodes can start at once, so messages can pile up (up to about N-squared). The timeout must exceed a round trip or a live node is wrongly skipped.' } },
    { id: 'ring', name: 'Ring election (Chang-Roberts)', short: 'Ring', hook: 'Pass the biggest id round the ring; whoever sees its own id come back is the leader.',
      about: { rule: 'Send ELECTION(my id) to the next node. Each node forwards the larger of the id it receives and its own (dropping smaller ones). The node that gets its own id back has the largest id. It then sends COORDINATOR once around the ring.', watch: 'Needs the ring order and a working way to skip dead nodes. Cheap when one node starts (about 3N messages), costly if the starter has the lowest id.' } }
  ];

  const P = {
    id: 'election', name: 'Leader election', minN: 3, maxN: 6,
    intro: 'The coordinator has failed. Crash nodes, tell some node to notice, and watch the survivors agree on a new leader using only messages. Compare the bully and the ring algorithms.',
    hook: 'Highest id alive wins. Bully asks upward; ring passes the biggest id round.',
    about: OPTIONS[0].about,
    defaults: { n: 4, dmin: 1, dmax: 1, seed: 1, algo: 'bully', timeout: 6, loss: 0 },
    params: [
      { key: 'algo', type: 'select', chips: true, label: 'Algorithm', options: OPTIONS },
      { key: 'timeout', type: 'number', min: 2, max: 60, label: 'Bully timeout (how long to wait for an OK)', hint: 'Must be at least twice the slowest message delay (a round trip).' }
    ],
    ops: { start: [], crash: [], recover: [] },
    grammar: 'Steps: "TIME NODE start" (this node notices the leader is gone and starts an election), crash, recover. At the start everyone believes the highest node is the leader.',
    presets: [
      { id: 'bully-basic', name: 'Bully: the leader crashes', cfg: { algo: 'bully', n: 4, dmin: 1, dmax: 1, timeout: 4 }, text: '1 D crash\n2 B start', note: 'B notices D is gone. C answers OK, runs its own election, hears nothing from D, and announces itself.' },
      { id: 'bully-storm', name: 'Bully: three nodes notice at once', cfg: { algo: 'bully', n: 5, dmin: 1, dmax: 2, timeout: 6, seed: 3 }, text: '1 E crash\n3 A start\n3 B start\n3 C start', note: 'Everyone starts an election, so messages multiply. Count them in the results.' },
      { id: 'bully-return', name: 'Bully: the old leader recovers', cfg: { algo: 'bully', n: 4, dmin: 1, dmax: 1, timeout: 4 }, text: '1 D crash\n2 B start\n20 D recover', note: 'D returns, starts an election, and being the highest it takes the leadership back.' },
      { id: 'ring-basic', name: 'Ring: the leader crashes', cfg: { algo: 'ring', n: 4, dmin: 1, dmax: 1 }, text: '1 D crash\n2 A start', note: 'A\'s id travels round the ring, growing as it meets bigger ids, until C sees its own id return.' },
      { id: 'ring-two', name: 'Ring: two nodes start together', cfg: { algo: 'ring', n: 5, dmin: 1, dmax: 2, seed: 2 }, text: '1 E crash\n3 A start\n3 C start', note: 'Two ELECTION messages circulate; the smaller one is swallowed as soon as it meets a bigger id.' }
    ],
    validate(cfg) { return cfg.algo === 'bully' && cfg.timeout < 2 * cfg.dmax ? ['The bully timeout (' + cfg.timeout + ') must be at least twice the slowest delay (' + 2 * cfg.dmax + '), or a live node could be skipped just because its reply was slow.'] : []; },
    init(cfg) { return Array.from({ length: cfg.n }, () => ({ leader: cfg.n - 1, el: false, gotOk: false, part: false, starts: 0 })); },
    handle(ctx, ev) {
      const s = ctx.st, N = ctx.n, me = ctx.me, nm = ctx.names, ring = ctx.cfg.algo === 'ring';
      const nextAlive = () => { for (let k = 1; k < N; k++) { const j = (me + k) % N; if (!ctx.down(j)) return j; } return me; };
      const higher = []; for (let j = me + 1; j < N; j++) higher.push(j);
      const win = () => { s.leader = me; s.el = false; s.part = false; ctx.note(nm[me] + ' has the highest id of all that answered: it is the LEADER and announces it.'); ctx.tag('LEADER'); if (ring) { const nx = nextAlive(); if (nx !== me) ctx.send(nx, 'COORDINATOR', { id: me }); } else for (let j = 0; j < N; j++) if (j !== me) ctx.send(j, 'COORDINATOR', { id: me }); };
      const startBully = () => {
        s.el = true; s.gotOk = false; s.starts++;
        if (!higher.length) { win(); return; }
        higher.forEach((j) => ctx.send(j, 'ELECTION', {}));
        ctx.timer(ctx.cfg.timeout, 'ok'); ctx.note('Sends ELECTION to every higher node (' + higher.map((j) => nm[j]).join(', ') + ') and waits ' + ctx.cfg.timeout + ' for an OK.'); ctx.tag('elect');
      };
      const startRing = () => {
        s.starts++; s.el = true; s.part = true; const nx = nextAlive();
        if (nx === me) { win(); return; }
        ctx.send(nx, 'ELECTION', { id: me }); ctx.note('Sends ELECTION(' + nm[me] + ') to the next live node, ' + nm[nx] + '.'); ctx.tag('elect');
      };
      if (ev.type === 'ext' && ev.op === 'start' || ev.type === 'recover') {
        if (ev.type === 'recover') { s.leader = -1; s.el = false; s.part = false; }
        if (ring) startRing(); else if (s.el) ctx.note('Already running an election.'); else startBully();
        return;
      }
      if (ev.type === 'timer') {
        if (ev.tag === 'ok' && s.el && !s.gotOk) win();
        else if (ev.tag === 'coord' && s.el) { ctx.note('No COORDINATOR arrived in time, so ' + nm[me] + ' starts the election again.'); startBully(); }
        return;
      }
      if (ev.type !== 'msg') return;
      const m = ev.msg, from = m.from;
      if (m.type === 'ELECTION' && !ring) { ctx.send(from, 'OK', {}); ctx.note(nm[me] + ' is higher than ' + nm[from] + ': replies OK ("back off")' + (s.el ? ' (already running its own election).' : ' and starts its own election.')); if (!s.el) startBully(); }
      else if (m.type === 'OK') { if (s.el && !s.gotOk) { s.gotOk = true; ctx.timer(ctx.cfg.timeout * 2, 'coord'); ctx.note('A higher node is alive, so ' + nm[me] + ' gives up and waits for its COORDINATOR announcement.'); } }
      else if (m.type === 'ELECTION' && ring) {
        const c = m.payload.id;
        if (c === me) { ctx.note('Its own id came back all the way round: nobody is bigger.'); win(); }
        else if (c > me) { s.el = true; s.part = true; ctx.send(nextAlive(), 'ELECTION', { id: c }); ctx.note(nm[c] + ' > ' + nm[me] + ': forwards ELECTION(' + nm[c] + ').'); }
        else if (!s.part) { s.el = true; s.part = true; ctx.send(nextAlive(), 'ELECTION', { id: me }); ctx.note(nm[c] + ' < ' + nm[me] + ': replaces it with its own id and forwards ELECTION(' + nm[me] + ').'); }
        else ctx.note(nm[c] + ' < ' + nm[me] + ' and ' + nm[me] + ' already took part: the message is swallowed.');
      } else if (m.type === 'COORDINATOR') {
        const c = m.payload.id; s.leader = c; s.el = false; s.part = false; s.gotOk = false; ctx.cancel('ok'); ctx.cancel('coord');
        ctx.note(nm[me] + ' accepts ' + nm[c] + ' as the leader.'); ctx.tag('→ ' + nm[c]);
        if (ring) { const nx = nextAlive(); if (nx !== c && nx !== me) ctx.send(nx, 'COORDINATOR', { id: c }); }
      }
    },
    describe(s, i, cfg) {
      const nmz = 'ABCDEF';
      return { lines: ['believes leader: ' + (s.leader < 0 ? 'none yet' : nmz[s.leader]), s.el ? 'in an election' + (s.gotOk ? ' (a higher node answered)' : '') : 'not electing'], badge: s.leader === i ? 'LEADER' : '' };
    },
    report(res) {
      const N = res.cfg.n, alive = [], crashedAt = {};
      res.state.forEach((s, i) => { if (!res.down[i]) alive.push(i); });
      const best = alive.length ? Math.max(...alive) : -1, beliefs = alive.map((i) => res.state[i].leader), uniq = [...new Set(beliefs)];
      const agree = uniq.length === 1, right = agree && uniq[0] === best;
      const byType = {}; res.msgs.forEach((m) => { byType[m.type] = (byType[m.type] || 0) + 1; });
      const starts = res.state.reduce((a, s) => a + s.starts, 0);
      const metrics = [['Elections started', starts], ['Messages sent', res.msgs.length]];
      Object.keys(byType).forEach((k) => metrics.push([k + ' messages', byType[k]]));
      const checks = [
        { ok: agree, text: agree ? 'Agreement: every live node believes ' + (uniq[0] >= 0 ? res.names[uniq[0]] : 'nobody') + ' is the leader.' : 'DISAGREEMENT: live nodes hold different beliefs (' + alive.map((i, k) => res.names[i] + '→' + (beliefs[k] < 0 ? 'none' : res.names[beliefs[k]])).join(', ') + ').' },
        { ok: right, text: right ? 'The leader is ' + res.names[best] + ', the highest-id node that is still alive.' : 'The agreed leader is not the highest live node' + (best >= 0 ? ' (' + res.names[best] + ')' : '') + (alive.length && agree && !res.down[uniq[0]] === false ? ', and it is down' : '') + '.' }
      ];
      return { metrics, checks, tables: [{ title: 'Final beliefs', head: ['Node', 'Status', 'Believes leader is'], rows: res.names.map((nmx, i) => [nmx, res.down[i] ? 'down' : 'alive', res.state[i].leader < 0 ? 'none yet' : res.names[res.state[i].leader]]) }] };
    }
  };
  MP.register(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
