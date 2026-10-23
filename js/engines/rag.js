/* Resource-allocation graph engine: parse, cycle search, graph reduction (stepped), wait-for graph. Pure logic.
   Edges: request  P -> R  (process waits for one instance)   assignment  R -> P  (one instance held by P). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  // Caps on processes, resources, instances per resource and edges.
  const LIMITS = { maxProcs: 8, maxRes: 6, maxInst: 4, maxEdges: 30 };

  // names(text): split 'P1, P2 P3' into upper-case names.
  const names = (t) => String(t).split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

  // parse: turn the three text boxes into a model { procs, res: [{ id, k }], edges: [{ type, p, r }] }.
  // A line 'P1 -> R1' is a REQUEST edge, 'R1 -> P1' an ASSIGNMENT edge (one held instance).
  // Everything is validated with a specific message: unknown names, edges between two processes,
  // duplicate requests, or more assignments than a resource has instances.
  function parse(procText, resText, edgeText) {
    const errors = [];
    const procs = names(procText);
    const res = [];
    String(resText).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).forEach((tok) => {
      const m = tok.match(/^([A-Za-z][A-Za-z0-9_]*)(?:[=:x×](\d+))?$/);
      if (!m) { errors.push('Resource "' + tok + '" is not valid. Write R1 or R1=2 (the number is how many identical instances).'); return; }
      const k = m[2] ? parseInt(m[2], 10) : 1;
      if (k < 1 || k > LIMITS.maxInst) errors.push('Resource ' + m[1].toUpperCase() + ' must have 1 to ' + LIMITS.maxInst + ' instances.');
      res.push({ id: m[1].toUpperCase(), k });
    });
    if (!procs.length) errors.push('Add at least one process, for example: P1, P2.');
    if (!res.length) errors.push('Add at least one resource, for example: R1, R2.');
    if (procs.length > LIMITS.maxProcs) errors.push('At most ' + LIMITS.maxProcs + ' processes.');
    if (res.length > LIMITS.maxRes) errors.push('At most ' + LIMITS.maxRes + ' resources.');
    const all = procs.concat(res.map((r) => r.id));
    all.forEach((n, i) => { if (all.indexOf(n) !== i) errors.push('The name ' + n + ' is used twice. Names must be unique.'); });
    // Name checks used to decide the type of each edge from which end is a process.
    const isP = (n) => procs.includes(n), isR = (n) => res.some((r) => r.id === n);
    const edges = [];
    const lines = String(edgeText).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > LIMITS.maxEdges) errors.push('At most ' + LIMITS.maxEdges + ' edges.');
    lines.forEach((line, i) => {
      const m = line.match(/^([A-Za-z0-9_]+)\s*(?:->|=>|→)\s*([A-Za-z0-9_]+)$/);
      const at = 'Edge ' + (i + 1) + ' ("' + line + '"): ';
      if (!m) { errors.push(at + 'write it as "P1 -> R1" (P1 requests R1) or "R1 -> P1" (R1 is assigned to P1).'); return; }
      const a = m[1].toUpperCase(), b = m[2].toUpperCase();
      if (!isP(a) && !isR(a)) { errors.push(at + a + ' is not a declared process or resource.'); return; }
      if (!isP(b) && !isR(b)) { errors.push(at + b + ' is not a declared process or resource.'); return; }
      if (isP(a) && isR(b)) edges.push({ type: 'req', p: a, r: b });
      else if (isR(a) && isP(b)) edges.push({ type: 'asg', p: b, r: a });
      else errors.push(at + 'an edge must connect a process and a resource, not two of the same kind.');
    });
    const seenReq = {};
    edges.forEach((e) => { if (e.type === 'req') { const k = e.p + e.r; if (seenReq[k]) errors.push(e.p + ' -> ' + e.r + ' appears twice. One request edge is enough.'); seenReq[k] = true; } });
    res.forEach((r) => {
      const n = edges.filter((e) => e.type === 'asg' && e.r === r.id).length;
      if (n > r.k) errors.push(r.id + ' has ' + r.k + ' instance' + (r.k > 1 ? 's' : '') + ' but is assigned ' + n + ' times. Raise its instance count or remove an assignment.');
    });
    return { ok: !errors.length, errors, model: { procs, res, edges } };
  }

  // heldOf(p) / reqOf(p): the assignment and request edges of process p.
  const heldOf = (m, p) => m.edges.filter((e) => e.type === 'asg' && e.p === p);
  const reqOf = (m, p) => m.edges.filter((e) => e.type === 'req' && e.p === p);

  /* Find one directed cycle through nodes (as names) or null. Edge direction: P->R for requests, R->P for assignments. */
  // findCycle: depth-first search for one directed cycle in the graph (requests point P->R, assignments
  // R->P). Returns the nodes of a cycle, or null. Colours: 1 = on the current DFS path, 2 = finished.
  function findCycle(m) {
    // Adjacency lists in edge direction.
    const adj = {};
    m.procs.forEach((p) => { adj[p] = []; }); m.res.forEach((r) => { adj[r.id] = []; });
    m.edges.forEach((e) => { if (e.type === 'req') adj[e.p].push(e.r); else adj[e.r].push(e.p); });
    const color = {}, stack = []; let found = null;
    const nodes = m.procs.concat(m.res.map((r) => r.id));
    (function () {
      function dfs(u) {
        color[u] = 1; stack.push(u);
        for (const v of adj[u]) {
          if (found) return;
          if (color[v] === 1) { found = stack.slice(stack.indexOf(v)); return; }
          if (!color[v]) dfs(v);
        }
        stack.pop(); color[u] = 2;
      }
      for (const n of nodes) { if (found) break; if (!color[n]) dfs(n); }
    })();
    return found;
  }

  /* Graph reduction: repeatedly remove a process that can get everything it requests, releasing what it holds. */
  // reduce: GRAPH REDUCTION, the real deadlock test (it works for multiple instances, where a cycle alone
  // proves nothing). Repeat: find a process whose every request can be satisfied by the currently free
  // instances; let it finish and release everything it holds (its edges vanish). Processes that can never
  // be removed are deadlocked. Frames record each removal for the Player.
  function reduce(m) {
    // Free instances per resource = instances - currently assigned.
    const avail = {}; m.res.forEach((r) => { avail[r.id] = r.k - m.edges.filter((e) => e.type === 'asg' && e.r === r.id).length; });
    const done = []; const frames = [];
    const snapAvail = () => Object.assign({}, avail);
    const cyc = findCycle(m);
    frames.push({ kind: 'start', avail: snapAvail(), done: [], cycle: null, text: 'The graph as you drew it. Free instances: ' + m.res.map((r) => r.id + '=' + avail[r.id]).join(', ') + '. A request edge points from a process to a resource, an assignment edge from a resource to the process that holds it.' });
    frames.push({ kind: 'cycle', avail: snapAvail(), done: [], cycle: cyc, text: cyc ? 'Cycle search: found the cycle ' + cyc.concat(cyc[0]).join(' → ') + '. A cycle is necessary for deadlock, but with multi-instance resources it is not always sufficient, so we reduce the graph to find out.' : 'Cycle search: no cycle anywhere. With no cycle there can be no deadlock.' });
    for (;;) {
      const live = m.procs.filter((p) => !done.includes(p));
      let pick = null, detail = null;
      for (const p of live) {
        // How many of each resource this process is waiting for.
        const need = {}; reqOf(m, p).forEach((e) => { need[e.r] = (need[e.r] || 0) + 1; });
        const bad = Object.keys(need).filter((r) => need[r] > avail[r]);
        if (!bad.length) { pick = p; detail = need; break; }
      }
      if (!pick) break;
      const rel = {}; heldOf(m, pick).forEach((e) => { rel[e.r] = (rel[e.r] || 0) + 1; });
      Object.keys(rel).forEach((r) => { avail[r] += rel[r]; });
      done.push(pick);
      const reqTxt = Object.keys(detail).length ? 'Everything it requests (' + Object.keys(detail).map((r) => r + '×' + detail[r]).join(', ') + ') is free' : 'It requests nothing';
      const relTxt = Object.keys(rel).length ? 'it finishes and releases ' + Object.keys(rel).map((r) => r + '×' + rel[r]).join(', ') : 'it finishes and holds nothing to release';
      frames.push({ kind: 'reduce', p: pick, avail: snapAvail(), done: done.slice(), cycle: cyc, text: pick + ': ' + reqTxt + ', so ' + relTxt + '. Its edges disappear from the graph. Free now: ' + m.res.map((r) => r.id + '=' + avail[r.id]).join(', ') + '.' });
    }
    // Whoever is left after no more reductions are possible is deadlocked.
    const stuck = m.procs.filter((p) => !done.includes(p));
    frames.push({ kind: 'end', avail: snapAvail(), done: done.slice(), cycle: cyc, deadlocked: stuck,
      text: stuck.length ? 'No remaining process can get everything it requests. ' + stuck.join(', ') + ' are DEADLOCKED: each waits for something only another stuck process can release.' : 'Every process could be removed, so NO deadlock. ' + (cyc ? 'There was a cycle, but spare instances let the graph reduce completely.' : '') });
    return { cycle: cyc, deadlocked: stuck, frames };
  }

  /* Wait-for graph: P -> Q when P requests a resource that Q holds (all holders of that resource). */
  // waitFor: the wait-for graph, P -> Q when P requests a resource that Q holds. It is the same deadlock
  // story with resources removed.
  function waitFor(m) {
    const out = [];
    m.edges.filter((e) => e.type === 'req').forEach((q) => {
      m.edges.filter((a) => a.type === 'asg' && a.r === q.r && a.p !== q.p).forEach((a) => { if (!out.some((x) => x.from === q.p && x.to === a.p)) out.push({ from: q.p, to: a.p, via: q.r }); });
    });
    return out;
  }

  /* Deadlock RECOVERY. Detection says WHO is stuck; recovery decides what to sacrifice.
     recover(model, { strategy, policy }) repeats: find the deadlocked set (graph reduction), choose a victim,
     break the deadlock for that victim, and check again, until nobody is deadlocked.
       strategy 'abort-all'  terminate every deadlocked process at once (simple, expensive)
       strategy 'abort-one'  terminate one victim at a time, re-checking after each (cheaper, slower)
       strategy 'preempt'    take ONE held resource instance away from a victim and let it ask for it again
                             (the victim is rolled back; nobody is terminated, but it can starve)
       policy   'fewest'  victim holds the fewest resources (least work to lose)   'most'  holds the most
                (frees the most)   'first'  lowest process number
     Ties always go to the process listed first. Returns the steps taken and the repaired graph. */
  function recover(m, opts) {
    const o = Object.assign({ strategy: 'abort-one', policy: 'fewest' }, opts);
    const copy = (x) => ({ procs: x.procs.slice(), res: x.res.map((r) => Object.assign({}, r)), edges: x.edges.map((e) => Object.assign({}, e)) });
    let cur = copy(m);
    const out = { strategy: o.strategy, policy: o.policy, initial: [], steps: [], aborted: [], preemptions: 0, final: cur, needed: false };
    let r = reduce(cur);
    out.initial = r.deadlocked.slice();
    if (!out.initial.length) return out;
    out.needed = true;
    const held = (mm, p) => heldOf(mm, p).length;
    const abort = (p, why) => {
      const rel = heldOf(cur, p).map((e) => e.r);
      cur = { procs: cur.procs.filter((x) => x !== p), res: cur.res, edges: cur.edges.filter((e) => e.p !== p) };
      out.aborted.push(p);
      return { action: 'abort', victim: p, released: rel, why };
    };
    const policyWhy = { fewest: 'it holds the fewest resources, so the least work is lost', most: 'it holds the most resources, so taking it from this victim frees the most', first: 'it comes first in the process list' };
    // helpful(stuck): processes whose termination or rollback can actually unblock someone: they hold an
    // instance that another stuck process is waiting for. (A process that is merely stuck behind the circle
    // holds nothing anyone needs, so killing it would waste work without freeing anything.)
    const helpful = (stuck) => {
      const h = stuck.filter((p) => heldOf(cur, p).some((a) => cur.edges.some((e) => e.type === 'req' && e.r === a.r && e.p !== p && stuck.includes(e.p))));
      return h.length ? h : stuck;
    };
    // pickVictim(cands): choose by policy; ties go to the earlier process in the list.
    const pickVictim = (cands) => {
      const order = (p) => cur.procs.indexOf(p);
      const sorted = cands.slice().sort((a, b) => {
        if (o.policy === 'fewest' && held(cur, a) !== held(cur, b)) return held(cur, a) - held(cur, b);
        if (o.policy === 'most' && held(cur, a) !== held(cur, b)) return held(cur, b) - held(cur, a);
        return order(a) - order(b);
      });
      return sorted[0];
    };
    if (o.strategy === 'abort-all') {
      const before = r.deadlocked.slice();
      const parts = before.map((p) => abort(p, 'all deadlocked processes are terminated'));
      out.steps.push({ action: 'abort-all', victims: before, released: parts.reduce((a, b) => a.concat(b.released), []), deadlockedBefore: before, deadlockedAfter: reduce(cur).deadlocked,
        text: 'Terminate every deadlocked process (' + before.join(', ') + '). All their resources are released, so nobody is left waiting in a circle. This always works but throws away the most work.' });
    } else {
      let guard = cur.procs.length + cur.edges.length + 3;
      while (guard-- > 0) {
        r = reduce(cur);
        if (!r.deadlocked.length) break;
        const stuck = r.deadlocked.slice();
        if (o.strategy === 'preempt') {
          // Only a process that holds an instance another stuck process is waiting for can help by giving it up.
          const useful = helpful(stuck).filter((p) => heldOf(cur, p).some((a) => cur.edges.some((e) => e.type === 'req' && e.r === a.r && e.p !== p && stuck.includes(e.p))));
          if (useful.length) {
            const v = pickVictim(useful);
            const edge = heldOf(cur, v).find((a) => cur.edges.some((e) => e.type === 'req' && e.r === a.r && e.p !== v && stuck.includes(e.p)));
            cur = { procs: cur.procs, res: cur.res, edges: cur.edges.filter((e) => e !== edge).concat(cur.edges.some((e) => e.type === 'req' && e.p === v && e.r === edge.r) ? [] : [{ type: 'req', p: v, r: edge.r }]) };
            out.preemptions++;
            out.steps.push({ action: 'preempt', victim: v, resource: edge.r, deadlockedBefore: stuck, deadlockedAfter: reduce(cur).deadlocked,
              text: 'Deadlocked: ' + stuck.join(', ') + '. Victim ' + v + ' (' + policyWhy[o.policy] + '). One instance of ' + edge.r + ' is taken away from ' + v + ' and ' + v + ' is rolled back to a point before it used it; it now has to request ' + edge.r + ' again.' });
            continue;
          }
        }
        // abort-one (and the fallback when no preemption can help)
        const v = pickVictim(helpful(stuck));
        const step = abort(v);
        out.steps.push(Object.assign(step, { deadlockedBefore: stuck, deadlockedAfter: reduce(cur).deadlocked,
          text: 'Deadlocked: ' + stuck.join(', ') + '. Victim ' + v + ' (' + policyWhy[o.policy] + '). It is terminated' + (step.released.length ? ' and releases ' + step.released.join(', ') : ' (it held nothing)') + '.' }));
      }
    }
    out.final = cur;
    out.stillDeadlocked = reduce(cur).deadlocked;
    return out;
  }

  // Example graphs: circular wait, a cycle that is NOT a deadlock (spare instance), a 3-cycle, a safe chain.
  const PRESETS = [
    { id: 'circular', name: 'Classic circular wait (deadlock)', procs: 'P1, P2', res: 'R1, R2', edges: 'R1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1', note: 'Each process holds one resource and wants the other\'s. Single-instance resources, so the cycle means deadlock.' },
    { id: 'nodead', name: 'A cycle but NO deadlock', procs: 'P1, P2, P3', res: 'R1=2, R2', edges: 'P1 -> R1\nR1 -> P3\nR1 -> P2\nP3 -> R2\nR2 -> P1', note: 'There is a cycle P1 → R1 → P3 → R2 → P1, yet P2 holds the spare instance of R1 and will finish, so the graph reduces.' },
    { id: 'three', name: 'Three-process cycle (deadlock)', procs: 'P1, P2, P3', res: 'R1, R2, R3', edges: 'R1 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R3\nR3 -> P3\nP3 -> R1', note: 'A longer circular wait. Every process is stuck.' },
    { id: 'uneven', name: 'Deadlock where the victim choice matters', procs: 'P1, P2, P3', res: 'R1, R2, R3', edges: 'R1 -> P1\nR3 -> P1\nP1 -> R2\nR2 -> P2\nP2 -> R1\nP3 -> R3', note: 'P1 holds two resources, P2 only one, and P3 is not in the circle but is stuck behind P1. Try the recovery strategies and policies and compare how much work each one throws away.' },
    { id: 'chain', name: 'Waiting chain (safe)', procs: 'P1, P2', res: 'R1, R2', edges: 'R1 -> P1\nP2 -> R1\nP1 -> R2', note: 'P2 waits for P1, but P1 can get R2, finish, and release R1. No cycle, no deadlock.' }
  ];

  NS.rag = { LIMITS, PRESETS, parse, findCycle, reduce, waitFor, recover, heldOf, reqOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.rag;
})(typeof window !== 'undefined' ? window : globalThis);
