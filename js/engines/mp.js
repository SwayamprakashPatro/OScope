/* Message-passing simulator: the shared engine under every Tier 4 distributed-systems lab. Pure logic, no DOM.

   A distributed system here is a handful of NODES (A, B, C...) that share no memory. They only send messages, and a
   message takes a while to arrive. The simulator is a "discrete-event" loop: it keeps a queue of things that will
   happen (a scenario step you typed, a message arriving, a timer firing), always takes the earliest one, lets the
   protocol react to it, and records what happened. Nothing is scripted except YOUR scenario: delays come from a
   seeded random generator, so the same seed always replays the same run.

   A PROTOCOL (clocks, mutex, election, two-phase commit, Raft...) is a plain object that plugs into this loop:
     id, name, hook, about, params[], defaults, ops{}, presets[],
     init(cfg)            -> one state object per node
     handle(ctx, ev)      -> react to {type:'ext'|'msg'|'timer'|'recover', ...}
     describe(state,i,cfg)-> {lines[], badge} shown on the node card
     report(result)       -> {metrics[], checks[], tables[], pair?} computed from the finished run
   The loop never inspects protocol internals, so every protocol is checked the same way. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxNodes: 6, maxEvents: 3000, maxTime: 2000, maxLines: 120 };
  const NAMES = 'ABCDEF'.split('');
  const protocols = {};

  // rng(seed): small seeded generator (mulberry32). Same seed gives the same delays and timeouts, every time.
  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // parseScenario(text, names, ops): one step per line, written "TIME NODE OP [ARGS]", for example "3 A send B".
  // `ops` says which verbs a protocol understands and what arguments each takes: 'node', 'int', 'word', 'int?' (optional).
  function parseScenario(text, names, ops) {
    const errors = [], ext = [], lines = String(text || '').split(/\r?\n/);
    if (lines.length > LIMITS.maxLines) errors.push('The scenario is too long (' + lines.length + ' lines; the limit is ' + LIMITS.maxLines + ').');
    lines.slice(0, LIMITS.maxLines).forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const tok = line.split(/\s+/), where = 'Line ' + (i + 1) + ': ';
      if (!/^\d+$/.test(tok[0])) { errors.push(where + 'start with the time as a whole number, e.g. "3 A send B".'); return; }
      const t = +tok[0]; if (t > LIMITS.maxTime) { errors.push(where + 'time ' + t + ' is beyond the limit of ' + LIMITS.maxTime + '.'); return; }
      const node = names.findIndex((nm) => nm.toLowerCase() === (tok[1] || '').toLowerCase());
      if (node < 0) { errors.push(where + '"' + (tok[1] || '') + '" is not a node. Nodes are ' + names.join(', ') + '.'); return; }
      const op = (tok[2] || '').toLowerCase(), spec = op.startsWith('_') ? null : ops[op];
      if (!spec) { errors.push(where + 'unknown step "' + (tok[2] || '') + '". Use one of: ' + Object.keys(ops).filter((k) => !k.startsWith('_')).join(', ') + '.'); return; }
      const args = []; let bad = false, k = 3;
      for (const a of spec) {
        const optional = a.endsWith('?'), kind = a.replace('?', ''), v = tok[k];
        if (v == null) { if (!optional) { errors.push(where + '"' + op + '" needs a ' + kind + ' (e.g. ' + (kind === 'node' ? names[0] : kind === 'int' ? '2' : 'x') + ').'); bad = true; } break; }
        k++;
        if (kind === 'node') { const idx = names.findIndex((nm) => nm.toLowerCase() === v.toLowerCase()); if (idx < 0) { errors.push(where + '"' + v + '" is not a node.'); bad = true; break; } if (idx === node && op === 'send') { errors.push(where + 'a node cannot send a message to itself.'); bad = true; break; } args.push(idx); }
        else if (kind === 'int') { if (!/^\d+$/.test(v)) { errors.push(where + '"' + v + '" must be a whole number.'); bad = true; break; } args.push(+v); }
        else args.push(v);
      }
      if (!bad && tok.length > k) { errors.push(where + 'unexpected extra text "' + tok.slice(k).join(' ') + '".'); bad = true; }
      if (!bad) ext.push({ t, node, op, args, line: i + 1 });
    });
    if (!errors.length && !ext.length) errors.push('Type at least one step, for example "1 A local".');
    return { ok: !errors.length, errors, ext };
  }

  function register(p) { protocols[p.id] = p; }

  // run(protocol, cfg, text): play the scenario to the end. Returns every event, message and frame of the run.
  function run(protocol, cfgIn, text) {
    const cfg = Object.assign({ n: 3, dmin: 1, dmax: 3, seed: 1, loss: 0, maxT: 400 }, protocol.defaults, cfgIn || {});
    const errors = [], int = (k, lo, hi, lab) => { const v = Number(cfg[k]); if (!Number.isInteger(v) || v < lo || v > hi) errors.push(lab + ' must be a whole number from ' + lo + ' to ' + hi + '.'); cfg[k] = v; };
    const lo = protocol.minN || 2, hi = Math.min(protocol.maxN || LIMITS.maxNodes, LIMITS.maxNodes);
    int('n', lo, hi, 'Number of nodes'); int('dmin', 1, 30, 'Fastest message delay'); int('dmax', 1, 30, 'Slowest message delay'); int('seed', 0, 2147483647, 'Seed'); int('loss', 0, 60, 'Message loss %'); int('maxT', 10, LIMITS.maxTime, 'Time limit');
    if (!errors.length && cfg.dmin > cfg.dmax) errors.push('The fastest delay cannot be larger than the slowest.');
    for (const p of protocol.params || []) if (p.type === 'number') int(p.key, p.min, p.max, p.label);
    if (errors.length) return { ok: false, errors };
    const names = NAMES.slice(0, cfg.n), parsed = parseScenario(text, names, protocol.ops);
    if (!parsed.ok) return { ok: false, errors: parsed.errors };
    if (protocol.validate) { const v = protocol.validate(cfg, parsed.ext, names); if (v && v.length) return { ok: false, errors: v }; }

    const rand = rng(cfg.seed), state = protocol.init(cfg), down = new Array(cfg.n).fill(false), cut = new Array(cfg.n).fill(false);
    const queue = [], events = [], msgs = [], frames = [], counters = new Array(cfg.n).fill(0);
    let seq = 0, processed = 0, truncated = false;
    const push = (it) => { it.seq = seq++; let lo2 = 0, hi2 = queue.length; while (lo2 < hi2) { const m = (lo2 + hi2) >> 1; if (queue[m].t < it.t || (queue[m].t === it.t && queue[m].seq < it.seq)) lo2 = m + 1; else hi2 = m; } queue.splice(lo2, 0, it); return it; };
    parsed.ext.forEach((e) => push({ t: e.t, type: 'ext', node: e.node, op: e.op, args: e.args }));
    // implicit steps the protocol itself needs (for example, handing the token to the first node). Not shown in the scenario.
    (protocol.implicit ? protocol.implicit(cfg) : []).forEach((e) => push({ t: e.t, type: 'ext', node: e.node, op: e.op, args: e.args || [], implicit: true }));

    const snapStates = () => state.map((s, i) => Object.assign({ down: down[i], cut: cut[i] }, protocol.describe(s, i, cfg, { down: down[i], cut: cut[i], names })));
    const inflight = (fi) => msgs.filter((m) => m.sendFrame <= fi && (m.recvFrame == null || m.recvFrame > fi)).map((m) => ({ id: m.id, from: m.from, to: m.to, type: m.type }));
    frames.push({ i: 0, t: 0, kind: 'start', text: protocol.startText ? protocol.startText(cfg, names) : 'Start: every node is idle. Press Next to run the first step.', states: snapStates(), inflight: [], event: -1 });

    while (queue.length) {
      const it = queue.shift();
      if (it.t > cfg.maxT) { truncated = true; break; }
      if (++processed > LIMITS.maxEvents) { truncated = true; break; }
      if (it.type === 'timer' && (it.cancelled || down[it.node])) continue;
      const me = it.node, notes = [], fi = frames.length;
      const ev = { id: events.length, t: it.t, node: me, kind: it.type === 'ext' ? it.op : it.type, label: '', tag: '', frame: fi, ann: {} };
      const msg = it.type === 'msg' ? msgs[it.mid] : null;
      let text = '';
      if (it.type === 'msg') {
        ev.msg = msg.id;
        if (it.lost || down[me] || cut[me] || cut[msg.from]) {
          msg.status = it.lost ? 'lost' : 'dropped'; msg.recvT = it.t; msg.recvFrame = fi; msg.recvEvent = ev.id; ev.kind = 'drop';
          text = 't=' + it.t + ': ' + (it.lost ? 'the network loses' : down[me] ? names[me] + ' is down, so it drops' : 'the partition cuts off ' + names[cut[me] ? me : msg.from] + ', so the network drops') + ' the ' + msg.type + ' message from ' + names[msg.from] + '.';
          events.push(ev); frames.push({ i: fi, t: it.t, kind: 'drop', text, states: snapStates(), inflight: inflight(fi), event: ev.id, node: me }); continue;
        }
        msg.status = 'delivered'; msg.recvT = it.t; msg.recvFrame = fi; msg.recvEvent = ev.id;
        text = 't=' + it.t + ': ' + names[me] + ' receives ' + msg.type + ' from ' + names[msg.from] + '.';
      } else if (it.type === 'ext') text = it.implicit ? 't=' + it.t + ': the system starts up at ' + names[me] + '.' : 't=' + it.t + ': ' + names[me] + ' ' + it.op + (it.args.length ? ' ' + it.args.map((a, k) => (typeof a === 'number' && protocol.ops[it.op][k] === 'node' ? names[a] : a)).join(' ') : '') + '.';
      else text = 't=' + it.t + ': ' + names[me] + '\'s timer "' + it.tag + '" fires.';
      counters[me]++; ev.label = names[me] + counters[me];

      const ctx = {
        me, t: it.t, n: cfg.n, names, cfg, st: state[me], states: state, rand, down: (i) => down[i],
        send(to, type, payload, o) {
          const delay = o && o.delay ? o.delay : cfg.dmin + Math.floor(rand() * (cfg.dmax - cfg.dmin + 1));
          const m = { id: msgs.length, from: me, to, type, payload: payload || {}, sendT: it.t, sendEvent: ev.id, sendFrame: fi, recvT: null, recvFrame: null, recvEvent: null, status: 'inflight', delay };
          msgs.push(m);
          const lost = cfg.loss > 0 && rand() * 100 < cfg.loss;
          push({ t: it.t + delay, type: 'msg', node: to, mid: m.id, lost });
          return m;
        },
        pendingExt(op) { return queue.filter((q) => q.type === 'ext' && !q.implicit && (!op || q.op === op)).length; },
        timer(delay, tag) { push({ t: it.t + delay, type: 'timer', node: me, tag }); },
        cancel(tag) { queue.forEach((q) => { if (q.type === 'timer' && q.node === me && q.tag === tag) q.cancelled = true; }); },
        note(s) { notes.push(s); }, tag(s) { ev.tag = s; }, ann(o) { Object.assign(ev.ann, o); }, relabel(s) { ev.label = s; }
      };
      if (it.type === 'ext' && it.op === 'crash') {
        down[me] = true; queue.forEach((q) => { if (q.type === 'timer' && q.node === me) q.cancelled = true; });
        notes.push(names[me] + ' crashes: it stops, forgets nothing it saved, and drops every message sent to it.'); ev.kind = 'crash';
        if (protocol.onCrash) protocol.onCrash(ctx);
      } else if (it.type === 'ext' && (it.op === 'cut' || it.op === 'heal')) {
        cut[me] = it.op === 'cut'; ev.kind = it.op;
        notes.push(it.op === 'cut' ? names[me] + ' is cut off from the network: it keeps running, but no message gets in or out.' : names[me] + ' is reconnected to the network.');
      } else if (it.type === 'ext' && it.op === 'recover') {
        if (!down[me]) notes.push(names[me] + ' was not down, so nothing changes.'); else { down[me] = false; ev.kind = 'recover'; notes.push(names[me] + ' comes back up.'); if (protocol.handle) protocol.handle(ctx, { type: 'recover' }); }
      } else if (it.type === 'ext' && down[me]) notes.push(names[me] + ' is down, so this step is ignored.');
      else protocol.handle(ctx, it.type === 'ext' ? { type: 'ext', op: it.op, args: it.args } : it.type === 'msg' ? { type: 'msg', msg: Object.assign({}, msg, { payload: clone(msg.payload) }) } : { type: 'timer', tag: it.tag });
      events.push(ev);
      frames.push({ i: fi, t: it.t, kind: ev.kind, text: [text].concat(notes).join(' '), notes, states: snapStates(), inflight: inflight(fi), event: ev.id, node: me });
    }
    const res = { ok: true, cfg, names, events, msgs, frames, state: clone(state), down: down.slice(), cut: cut.slice(), truncated, ext: parsed.ext, protocol: protocol.id };
    res.report = protocol.report ? protocol.report(res) : { metrics: [], checks: [], tables: [] };
    if (truncated && !protocol.horizon) res.report.checks.push({ ok: false, text: 'The run hit the time or event limit before everything settled, so later behaviour is not shown.' });
    return res;
  }

  const api = { LIMITS, NAMES, rng, clone, parseScenario, register, protocols, run };
  NS.mp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
