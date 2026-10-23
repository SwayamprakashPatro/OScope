/* Protocol: Lamport and vector clocks. Nodes have no shared clock, so each keeps a counter and attaches it to
   every message; the receiver adjusts its own counter so the order of cause and effect is never contradicted.

   Lamport clock  L:  before an event L = L + 1; on receive L = max(L, message.L) + 1.
   Vector clock   V:  one slot per node. Before an event V[me] += 1; on receive take the element-wise max with the
                      message's vector, then V[me] += 1.
   Rule of thumb: Lamport gives "a happened before b  =>  L(a) < L(b)" but NOT the reverse. Vector clocks give "if and only if",
   so they can tell that two events are concurrent (neither could have caused the other). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), MP = NS.mp || (typeof require !== 'undefined' ? require('./mp.js') : null);

  const leq = (a, b) => a.every((x, i) => x <= b[i]);
  // relation(a, b): compare two events by their vector clocks.
  function relation(a, b) {
    if (a === b) return 'same';
    const ab = leq(a.V, b.V), ba = leq(b.V, a.V);
    if (ab && ba) return 'same';
    return ab ? 'before' : ba ? 'after' : 'concurrent';
  }
  // truth(events, msgs): ground truth "happened before" by following process order and message edges (a graph
  // search that does NOT use the clocks), so the clocks can be checked against it.
  function truth(evs, msgs) {
    const idx = new Map(evs.map((e, i) => [e.id, i])), adj = evs.map(() => []);
    const lastOn = {};
    evs.forEach((e, i) => { if (lastOn[e.node] != null) adj[lastOn[e.node]].push(i); lastOn[e.node] = i; });
    msgs.forEach((m) => { if (m.status === 'delivered' && idx.has(m.sendEvent) && idx.has(m.recvEvent)) adj[idx.get(m.sendEvent)].push(idx.get(m.recvEvent)); });
    const reach = evs.map(() => new Set());
    for (let s = 0; s < evs.length; s++) { const st = [s], seen = new Set(); while (st.length) { const u = st.pop(); for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); st.push(v); } } reach[s] = seen; }
    return { idx, reach };
  }

  const P = {
    id: 'clocks', name: 'Lamport & vector clocks', minN: 2, maxN: 5,
    intro: 'Nodes share no clock, only messages. Type a scenario of local events and messages, then watch each node stamp its events with a Lamport clock and a vector clock, and see which events are really concurrent.',
    hook: 'Lamport: one number, order only one way. Vector: one number per node, order both ways, and it spots concurrency.',
    about: { rule: 'Every event bumps its own node\'s clock. A message carries the sender\'s clock; the receiver takes the larger and bumps again, so an effect always gets a bigger stamp than its cause.', watch: 'L(a) < L(b) does NOT mean a caused b: the events may be concurrent. Only the vector clock can tell.' },
    defaults: { n: 3, dmin: 2, dmax: 2, seed: 1 },
    params: [],
    ops: { local: [], send: ['node', 'int?'], crash: [], recover: [] },
    grammar: 'Steps: "TIME NODE local" (internal event), "TIME NODE send OTHER [delay]" (send a message, optionally with your own delay), crash, recover.',
    presets: [
      { id: 'basic', name: 'Three nodes, a few messages', cfg: { n: 3, dmin: 2, dmax: 2 }, text: '1 A local\n2 A send B\n3 C local\n5 B send C\n7 C send A\n9 B local', note: 'Compare the Lamport numbers with the vectors. C\'s first event (t=3) is concurrent with A\'s events: no message connects them yet.' },
      { id: 'concurrent', name: 'Concurrent events look ordered under Lamport', cfg: { n: 2, dmin: 1, dmax: 1 }, text: '1 A local\n2 A local\n3 A local\n1 B local\n9 B local', note: 'A3 and B1 never exchange a message, yet Lamport still gives them different numbers. Pick them in the comparison box.' },
      { id: 'race', name: 'Crossing messages', cfg: { n: 2, dmin: 3, dmax: 3 }, text: '1 A send B\n1 B send A\n5 A local\n5 B local', note: 'Both nodes send at the same moment. Neither send caused the other, so the vectors are incomparable.' },
      { id: 'chain', name: 'A causal chain across four nodes', cfg: { n: 4, dmin: 1, dmax: 1 }, text: '1 A send B\n3 B send C\n5 C send D\n8 D local', note: 'Every event is caused by the one before it, so the vectors grow strictly and nothing is concurrent along the chain.' }
    ],
    init(cfg) { return Array.from({ length: cfg.n }, () => ({ L: 0, V: new Array(cfg.n).fill(0) })); },
    handle(ctx, ev) {
      const s = ctx.st;
      if (ev.type === 'msg') { const m = ev.msg.payload, before = s.L; s.L = Math.max(before, m.L) + 1; s.V = s.V.map((x, i) => Math.max(x, m.V[i])); s.V[ctx.me]++; ctx.note('L = max(own ' + before + ', message ' + m.L + ') + 1 = ' + s.L + '. Vector = element-wise max with ' + JSON.stringify(m.V) + ', then own slot +1 = ' + JSON.stringify(s.V) + '.'); }
      else if (ev.type === 'ext') {
        s.L++; s.V[ctx.me]++;
        if (ev.op === 'send') { ctx.send(ev.args[0], 'msg', { L: s.L, V: s.V.slice() }, ev.args[1] ? { delay: ev.args[1] } : null); ctx.note('Sends its clock along: L = ' + s.L + ', vector ' + JSON.stringify(s.V) + '.'); }
        else ctx.note('Internal event: L = ' + s.L + ', vector ' + JSON.stringify(s.V) + '.');
      } else return;
      ctx.ann({ L: s.L, V: s.V.slice() }); ctx.tag(s.L + ' ' + JSON.stringify(s.V).replace(/,/g, ''));
    },
    describe(s) { return { lines: ['Lamport clock L = ' + s.L, 'Vector clock ' + JSON.stringify(s.V).replace(/,/g, ', ')] }; },
    report(res) {
      const evs = res.events.filter((e) => e.ann && e.ann.V).map((e) => ({ id: e.id, node: e.node, label: e.label, t: e.t, L: e.ann.L, V: e.ann.V }));
      let ordered = 0, conc = 0, lamportWrong = 0, same = 0, bad = 0;
      const T = truth(evs, res.msgs);
      for (let i = 0; i < evs.length; i++) for (let j = i + 1; j < evs.length; j++) {
        const r = relation(evs[i], evs[j]);
        const gtAB = T.reach[i].has(j), gtBA = T.reach[j].has(i);
        const gt = gtAB ? 'before' : gtBA ? 'after' : 'concurrent';
        if (r !== gt) bad++;
        if (r === 'concurrent') { conc++; if (evs[i].L !== evs[j].L) lamportWrong++; } else ordered++;
      }
      const pairs = evs.length * (evs.length - 1) / 2, byId = new Map(evs.map((e) => [e.id, e]));
      let lamOk = true; res.msgs.forEach((m) => { if (m.status === 'delivered' && byId.has(m.sendEvent) && byId.has(m.recvEvent) && !(byId.get(m.recvEvent).L > byId.get(m.sendEvent).L)) lamOk = false; });
      const lastL = {}; evs.forEach((e) => { if (lastL[e.node] != null && e.L <= lastL[e.node]) lamOk = false; lastL[e.node] = e.L; });
      const rows = evs.map((e) => [e.label, res.names[e.node], String(e.t), String(e.L), JSON.stringify(e.V).replace(/,/g, ', ')]);
      return {
        metrics: [['Events', evs.length], ['Event pairs', pairs], ['Causally ordered pairs', ordered], ['Concurrent pairs', conc], ['Concurrent pairs Lamport still orders', lamportWrong]],
        checks: [{ ok: bad === 0, text: 'Vector clocks agree with the true cause-and-effect graph for all ' + pairs + ' pairs (' + (bad === 0 ? 'no disagreement' : bad + ' disagreements') + ').' }, { ok: lamOk, text: 'Lamport clocks never put an effect before its cause: every delivered message has a larger stamp on arrival than on sending, and each node\'s stamps only grow.' }],
        tables: [{ title: 'Every event and its clocks', head: ['Event', 'Node', 'Time', 'Lamport', 'Vector'], rows }],
        pair: { events: evs.map((e) => ({ id: e.id, text: e.label + ' at t=' + e.t })), compare(a, b) {
          const x = evs.find((e) => e.id === a), y = evs.find((e) => e.id === b); if (!x || !y) return null;
          const r = relation(x, y), nm = (e) => e.label;
          const rel = r === 'same' ? nm(x) + ' and ' + nm(y) + ' are the same event.' : r === 'before' ? nm(x) + ' happened before ' + nm(y) + ' (' + nm(x) + ' could have influenced ' + nm(y) + ').' : r === 'after' ? nm(y) + ' happened before ' + nm(x) + '.' : nm(x) + ' and ' + nm(y) + ' are CONCURRENT: neither could have caused the other.';
          const lam = 'Lamport says L(' + nm(x) + ') = ' + x.L + ' and L(' + nm(y) + ') = ' + y.L + (x.L === y.L ? ': equal, so it cannot order them.' : ': so it would order ' + (x.L < y.L ? nm(x) + ' first' : nm(y) + ' first') + (r === 'concurrent' ? ', even though they are concurrent (a false ordering).' : '.'));
          return [rel, 'Vectors: ' + JSON.stringify(x.V) + ' and ' + JSON.stringify(y.V) + (r === 'concurrent' ? ': neither is ≤ the other.' : '.'), lam];
        } }
      };
    },
    relation, truth
  };
  MP.register(P);
  if (typeof module !== 'undefined' && module.exports) module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
