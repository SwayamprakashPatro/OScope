/* Garbage-collection engine: three collectors run on the same little program. Pure logic, no DOM.

   The "program" (the mutator) is a list of one-line operations typed by the user:
     new A [size]   allocate object A (1 to 3 heap cells, default 1)
     root A         a root variable (stack / global) now points at A
     unroot A       that root variable stops pointing at A
     ref A B        A gets a pointer to B
     unref A B      A's pointer to B is removed
     gc             run a collection here

   The same script is replayed under three collectors:
     ms  mark-and-sweep   (stop the world, trace from the roots, free what was not reached)
     rc  reference counting (a count per object, freed the moment it reaches 0, cycles leak)
     cp  copying / Cheney semispace (copy live objects breadth-first into the other half, then flip)

   Every run returns a list of frames the Player can step through. Each frame is a full snapshot (objects,
   roots, heap cells, worklist, statistics) plus a plain-language `text` saying why it happened. Nothing is
   stored as an answer: every number is produced by replaying the script. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // Limits keep the simulation tiny so it can never hang the browser.
  const LIMITS = { maxObjects: 12, maxStatements: 40, maxLineLength: 80, minHeap: 4, maxHeap: 16, maxSize: 3, cellBytes: 16 };

  // The three collectors: short rule, memory hook and the classic trap, shown on the "about" card.
  const ALGOS = [
    { id: 'ms', short: 'Mark-and-sweep', name: 'Mark-and-sweep (tracing)',
      rule: 'Pause the program ("stop the world"). MARK: start from the roots and follow every pointer, colouring each object you reach. SWEEP: walk the whole heap and free every object that was not coloured. Then let the program continue.',
      hook: 'Mark what you can reach, sweep away the rest. Tri-colour: white = not seen yet, grey = seen but its pointers are not followed yet, black = done.',
      watch: 'The pause costs time proportional to the live objects (mark) plus the whole heap (sweep), and the freed cells are scattered, so the heap becomes fragmented.' },
    { id: 'rc', short: 'Reference counting', name: 'Reference counting',
      rule: 'Every object stores how many pointers (roots and other objects) point at it. A new pointer adds one, a removed pointer subtracts one. When the count reaches 0 the object is freed at once, and the pointers it held are released too (a cascade).',
      hook: 'Count the arrows pointing in. Zero arrows in means nobody needs you. But two objects pointing at each other keep each other at 1 forever.',
      watch: 'A cycle (A points to B, B points to A) stays at count 1 even when nothing outside can reach it: a memory leak. Languages that count references add a cycle detector or weak pointers.' },
    { id: 'cp', short: 'Copying (Cheney)', name: 'Copying collector (Cheney semispace)',
      rule: 'The heap is two equal halves. The program allocates in one half (from-space) just by moving a pointer. To collect, copy every object reachable from the roots, breadth-first, into the empty half (to-space), leaving a forwarding pointer in the old copy. A scan pointer chases a free pointer until they meet. Then the halves swap.',
      hook: 'Move the survivors, abandon the rest. Scan chases free; when scan catches free, you are done.',
      watch: 'Only half the memory is usable at a time, but the cost depends on live data only, and survivors end up packed side by side with no holes (compaction).' }
  ];
  const BY_ID = {}; ALGOS.forEach((a) => { BY_ID[a.id] = a; });

  /* ---------------------------------------------------------------- parsing */

  const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // parse(text): turn the script into a list of operations and report every mistake with its line number.
  // It tracks (ignoring any collection) which objects exist, which pointers exist and which roots exist,
  // so typos, duplicate names and removing something that was never added are caught before any run.
  function parse(text) {
    const errors = [], ops = [], created = {}, names = [];
    const edges = new Set(), roots = new Set();
    const raw = String(text == null ? '' : text).split(/\r?\n/);
    for (let i = 0; i < raw.length; i++) {
      const ln = i + 1;
      const body = raw[i].replace(/#.*$/, '').trim();           // '#' starts a comment
      if (!body) continue;
      if (body.length > LIMITS.maxLineLength) { errors.push('Line ' + ln + ': too long (at most ' + LIMITS.maxLineLength + ' characters).'); continue; }
      if (ops.length >= LIMITS.maxStatements) { errors.push('At most ' + LIMITS.maxStatements + ' operations; remove some lines from line ' + ln + ' on.'); break; }
      const tok = body.split(/\s+/), cmd = tok[0].toLowerCase(), args = tok.slice(1).map((t) => t.toUpperCase());
      const need = (n, usage) => { if (args.length !== n) { errors.push('Line ' + ln + ': "' + cmd + '" needs ' + plural(n, 'name') + ', for example "' + usage + '".'); return false; } return true; };
      const goodName = (n) => { if (!NAME_RE.test(n)) { errors.push('Line ' + ln + ': "' + n + '" is not a valid object name. Use a letter followed by letters or digits, like A or Node2.'); return false; } return true; };
      const known = (n) => { if (!goodName(n)) return false; if (!(n in created)) { errors.push('Line ' + ln + ': unknown object ' + n + '. Create it first with "new ' + n + '".'); return false; } return true; };
      const op = { line: ln, text: body.replace(/\s+/g, ' '), op: cmd };
      if (cmd === 'new') {
        if (args.length < 1 || args.length > 2) { errors.push('Line ' + ln + ': "new" needs a name and an optional size, for example "new A" or "new A 2".'); continue; }
        if (!goodName(args[0])) continue;
        let size = 1;
        if (args.length === 2) {
          if (!/^\d+$/.test(args[1]) || +args[1] < 1 || +args[1] > LIMITS.maxSize) { errors.push('Line ' + ln + ': the size of ' + args[0] + ' must be a whole number from 1 to ' + LIMITS.maxSize + ' cells.'); continue; }
          size = +args[1];
        }
        if (args[0] in created) { errors.push('Line ' + ln + ': ' + args[0] + ' was already created on line ' + created[args[0]] + '. Give every object its own name.'); continue; }
        if (names.length >= LIMITS.maxObjects) { errors.push('At most ' + LIMITS.maxObjects + ' objects (line ' + ln + ' would be number ' + (names.length + 1) + ').'); continue; }
        created[args[0]] = ln; names.push(args[0]);
        op.a = args[0]; op.size = size;
      } else if (cmd === 'root') {
        if (!need(1, 'root A') || !known(args[0])) continue;
        if (roots.has(args[0])) { errors.push('Line ' + ln + ': ' + args[0] + ' is already a root.'); continue; }
        roots.add(args[0]); op.a = args[0];
      } else if (cmd === 'unroot') {
        if (!need(1, 'unroot A') || !known(args[0])) continue;
        if (!roots.has(args[0])) { errors.push('Line ' + ln + ': ' + args[0] + ' is not a root, so there is nothing to unroot.'); continue; }
        roots.delete(args[0]); op.a = args[0];
      } else if (cmd === 'ref') {
        if (!need(2, 'ref A B') || !known(args[0]) || !known(args[1])) continue;
        if (edges.has(args[0] + '>' + args[1])) { errors.push('Line ' + ln + ': ' + args[0] + ' already points to ' + args[1] + '.'); continue; }
        edges.add(args[0] + '>' + args[1]); op.a = args[0]; op.b = args[1];
      } else if (cmd === 'unref') {
        if (!need(2, 'unref A B') || !known(args[0]) || !known(args[1])) continue;
        if (!edges.has(args[0] + '>' + args[1])) { errors.push('Line ' + ln + ': ' + args[0] + ' does not point to ' + args[1] + ', so there is nothing to unref.'); continue; }
        edges.delete(args[0] + '>' + args[1]); op.a = args[0]; op.b = args[1];
      } else if (cmd === 'gc') {
        if (args.length) { errors.push('Line ' + ln + ': "gc" takes no names.'); continue; }
      } else {
        errors.push('Line ' + ln + ': unknown command "' + tok[0] + '". Use new, root, unroot, ref, unref or gc.');
        continue;
      }
      ops.push(op);
    }
    if (!ops.length && !errors.length) errors.push('Write at least one operation, for example: new A');
    return { ok: errors.length === 0, errors, ops, names };
  }

  /* ---------------------------------------------------------- shared helpers */

  // reach(roots, objs): independent-of-colour reachability. Breadth-first search from the roots following
  // pointers, only through objects that are still allocated. Returns a Set of names.
  function reach(roots, objs) {
    const seen = new Set(), q = [];
    roots.forEach((r) => { if (objs[r] && objs[r].alive && !seen.has(r)) { seen.add(r); q.push(r); } });
    while (q.length) {
      const o = objs[q.shift()];
      o.refs.forEach((c) => { if (objs[c] && objs[c].alive && !seen.has(c)) { seen.add(c); q.push(c); } });
    }
    return seen;
  }

  // newState: everything one run needs: objects, roots, heap cells, frames and running statistics.
  function newState(algo, opts) {
    const s = {
      algo, H: opts.heap, S: Math.floor(opts.heap / 2), autoGc: opts.autoGc, cb: opts.cellBytes,
      objs: {}, order: [], roots: [], frames: [], freeOrder: [],
      cells: null, spaces: null, cur: 0, free: 0, scan: 0, gcFrom: null,
      worklist: null, focus: null, edge: null, freedNow: [], freedCells: [],
      stw: false, cascading: false, line: 0, opText: '', pause: 0,
      stats: { freedObjects: 0, bytesReclaimed: 0, visited: 0, swept: 0, moved: 0, gcRuns: 0, maxPause: 0, allocated: 0 }
    };
    if (algo === 'cp') s.spaces = [new Array(s.S).fill(null), new Array(s.S).fill(null)];
    else s.cells = new Array(s.H).fill(null);
    return s;
  }

  // statusOf: what is the truth about an object right now?  live = reachable from a root;
  // leaked = unreachable but its reference count is above 0 (so counting can never free it);
  // unclaimed = count 0 and never pointed at; garbage = unreachable, waiting for the next collection.
  function statusOf(s, o, reachSet) {
    if (!o.alive) return 'freed';
    if (reachSet.has(o.name)) return 'live';
    if (s.algo === 'rc' && !s.cascading) return o.rc > 0 ? 'leaked' : 'unclaimed';
    return 'garbage';
  }

  // fragmentation numbers for the current heap: free cells and the largest free block that could be allocated.
  function fragOf(s) {
    if (s.algo === 'cp') { const f = s.S - s.free; return { freeCells: f, largestFree: f, total: s.S }; }
    let free = 0, best = 0, run = 0;
    s.cells.forEach((c) => { if (c) run = 0; else { free++; run++; if (run > best) best = run; } });
    return { freeCells: free, largestFree: best, total: s.H };
  }

  // summary(s): the statistics shown in the results tiles (cumulative up to this moment).
  function summary(s) {
    const r = reach(s.roots, s.objs), st = Object.assign({}, s.stats), fr = fragOf(s);
    let leaked = 0, waiting = 0, alive = 0;
    s.order.forEach((n) => { const o = s.objs[n]; if (!o.alive) return; alive++; const k = statusOf(s, o, r); if (k === 'leaked') leaked++; if (k === 'leaked' || k === 'garbage' || k === 'unclaimed') waiting++; });
    st.leaked = leaked; st.garbageWaiting = waiting; st.alive = alive;
    st.work = st.visited + st.swept; st.freeCells = fr.freeCells; st.largestFree = fr.largestFree;
    st.fragmentation = fr.freeCells ? 1 - fr.largestFree / fr.freeCells : 0;   // 0 = one block, near 1 = many tiny holes
    return st;
  }

  // emit: push one frame (a full snapshot). The one-shot fields (focus, edge, freedNow...) are cleared
  // afterwards so they only highlight the frame they were set for.
  function emit(s, kind, text, extra) {
    const r = reach(s.roots, s.objs);
    const objs = s.order.map((n) => {
      const o = s.objs[n];
      return { name: n, size: o.size, addr: o.addr, space: o.space, refs: o.refs.slice(), rc: s.algo === 'rc' ? o.rc : null, color: o.color, alive: o.alive, status: statusOf(s, o, r), copied: !!o.copied };
    });
    let heap;
    if (s.algo === 'cp') {
      heap = { kind: 'cp', semi: s.S, scan: s.gcFrom == null ? null : s.scan, free: s.free,
        spaces: [0, 1].map((i) => ({ id: i, role: s.gcFrom == null ? (i === s.cur ? 'active' : 'idle') : (i === s.gcFrom ? 'from' : 'to'), cells: s.spaces[i].map((c) => (c ? { n: c.n, i: c.i, fwd: c.fwd } : null)) })) };
    } else heap = { kind: 'single', size: s.H, cells: s.cells.map((c) => (c ? { n: c.n, i: c.i } : null)) };
    s.frames.push(Object.assign({
      kind, text, line: s.line, op: s.opText, stw: s.stw, objs, roots: s.roots.slice(), heap,
      worklist: s.worklist ? s.worklist.slice() : null, focus: s.focus, edge: s.edge, freedNow: s.freedNow.slice(), freedCells: s.freedCells.slice(),
      stats: summary(s), cascading: s.cascading
    }, extra || {}));
    s.focus = null; s.edge = null; s.freedNow = []; s.freedCells = [];
  }

  // firstFit: find the lowest address where `size` consecutive free cells exist, or -1.
  function firstFit(cells, size) {
    let run = 0;
    for (let i = 0; i < cells.length; i++) {
      run = cells[i] ? 0 : run + 1;
      if (run === size) return i - size + 1;
    }
    return -1;
  }
  const place = (cells, addr, o) => { for (let k = 0; k < o.size; k++) cells[addr + k] = { n: o.name, i: k, fwd: null }; };
  const clearCells = (s, cells, addr, size, note) => { for (let k = 0; k < size; k++) cells[addr + k] = null; if (note !== false) for (let k = 0; k < size; k++) s.freedCells.push(addr + k); };

  // freeObject: give an object's cells back and record it in the statistics.
  function freeObject(s, o) {
    if (s.algo !== 'cp') clearCells(s, s.cells, o.addr, o.size);
    o.alive = false; o.color = null;
    s.stats.freedObjects++; s.stats.bytesReclaimed += o.size * s.cb;
    s.freeOrder.push(o.name); s.freedNow.push(o.name);
  }

  const bytes = (s, cells) => cells * s.cb + ' bytes (' + plural(cells, 'cell') + ')';
  const fragText = (s) => { const f = fragOf(s); return f.freeCells ? 'Free cells: ' + f.freeCells + ', largest free block: ' + f.largestFree + (f.freeCells > f.largestFree ? ' (the free space is split into holes: fragmentation)' : ' (one block)') + '.' : 'The heap has no free cells.'; };

  /* ------------------------------------------------------------ mark-and-sweep */

  // collectMS: one stop-the-world collection. MARK with an explicit worklist (a stack: the top is index 0),
  // using tri-colour marking, then SWEEP the heap in address order.
  function collectMS(s, why) {
    s.stw = true; s.stats.gcRuns++;
    let pause = 0;
    const alive = s.order.filter((n) => s.objs[n].alive);
    alive.forEach((n) => { s.objs[n].color = 'white'; });
    s.worklist = [];
    s.roots.forEach((r) => { s.objs[r].color = 'grey'; s.worklist.push(r); });
    emit(s, 'gc-start', (why ? why + ' ' : '') + 'STOP THE WORLD: the program is paused so the pointers cannot change while we trace them. All ' + plural(alive.length, 'object') + ' start white (not seen). ' +
      (s.roots.length ? 'Each root target is coloured grey and put on the worklist: ' + s.roots.join(', ') + '.' : 'There are no roots, so nothing will be reached.'));
    // MARK: pop an object, look at its pointers, turn white children grey and push them, then blacken it.
    while (s.worklist.length) {
      const name = s.worklist.shift(), o = s.objs[name];
      pause++; s.stats.visited++;
      const fresh = [], skipped = [];
      o.refs.forEach((c) => { const co = s.objs[c]; if (co.color === 'white') { co.color = 'grey'; fresh.push(c); } else skipped.push(c + ' (' + (co.color === 'grey' ? 'already grey' : 'already black') + ')'); });
      o.color = 'black';
      s.worklist = fresh.concat(s.worklist);
      s.focus = name;
      emit(s, 'mark', 'Pop ' + name + ' from the worklist (visit ' + pause + '). ' +
        (o.refs.length ? name + ' points to ' + o.refs.join(', ') + ': ' + (fresh.length ? fresh.join(', ') + (fresh.length === 1 ? ' is white, so it turns grey and goes on the worklist' : ' are white, so they turn grey and go on the worklist') : 'nothing new') + (skipped.length ? '; skipped ' + skipped.join(', ') : '') + '. ' : name + ' has no pointers. ') +
        name + ' is now black: it and everything it points to has been seen.');
    }
    const whites = alive.filter((n) => s.objs[n].color === 'white');
    emit(s, 'mark-end', 'The worklist is empty, so marking is finished. Black = reachable from a root. ' +
      (whites.length ? 'Still white (unreachable garbage): ' + whites.join(', ') + '.' : 'No object is white: everything allocated is reachable, so there is nothing to free.'));
    // SWEEP: walk the heap from address 0 upwards. White objects are freed; black ones are reset to white for next time.
    const byAddr = alive.slice().sort((a, b) => s.objs[a].addr - s.objs[b].addr);
    byAddr.forEach((n) => {
      const o = s.objs[n]; pause++; s.stats.swept++;
      s.focus = n;
      if (o.color === 'white') {
        freeObject(s, o);
        emit(s, 'sweep', 'Sweep address ' + o.addr + ': ' + n + ' is white, so nobody can reach it. Free it and give back ' + bytes(s, o.size) + '.');
      } else {
        o.color = 'white';
        emit(s, 'sweep', 'Sweep address ' + o.addr + ': ' + n + ' is black (reachable), so it stays where it is. Its colour is reset to white for the next collection.');
      }
    });
    s.maxPauseUpdate(pause);
    s.stw = false; s.worklist = null;
    const freed = whites.length;
    emit(s, 'gc-end', 'The world resumes: the program runs again. This collection freed ' + plural(freed, 'object') + (freed ? ' (' + whites.join(', ') + ')' : '') + ' and visited ' + plural(pause, 'object') + ' (marked ' + (pause - byAddr.length) + ', swept ' + byAddr.length + '). Survivors did not move. ' + fragText(s));
  }

  /* ---------------------------------------------------------- reference counting */

  // release: ONE pointer to `name` has just disappeared. Lower its count; at 0 free it and release
  // everything it pointed to (the cascade, depth-first). Every step is its own frame.
  function release(s, name, lead) {
    const o = s.objs[name];
    o.rc--; s.pause++; s.stats.visited++;
    s.focus = name;
    if (o.rc > 0) {
      emit(s, 'dec', lead + ' ' + name + '\'s count drops to ' + o.rc + '. It is still above 0, so ' + name + ' stays alive.' +
        (!reach(s.roots, s.objs).has(name) ? ' (But no root can reach ' + name + ' any more: it may be part of a leaked cycle.)' : ''));
      return;
    }
    freeObject(s, o);
    emit(s, 'free', lead + ' ' + name + '\'s count drops to 0: nothing points at it, so free it now (' + bytes(s, o.size) + ').' +
      (o.refs.length ? ' Its own pointers die with it, so release ' + o.refs.join(', ') + '.' : ' It points at nothing, so the cascade stops here.'));
    o.refs.forEach((c) => release(s, c, name + ' is gone, so its pointer to ' + c + ' is released:'));
  }

  // dropPointer: wrapper that starts a cascade and records the pause (work done inside one operation).
  function dropPointer(s, name, lead) {
    s.cascading = true; s.pause = 0;
    release(s, name, lead);
    s.cascading = false;
    s.maxPauseUpdate(s.pause);
  }

  // leakReport: for reference counting, find objects that are unreachable yet still counted, and run a
  // trial mark from the roots (without freeing anything) to show that tracing would reclaim them.
  function leakReport(s) {
    const r = reach(s.roots, s.objs);
    const leaked = [], unclaimed = [];
    s.order.forEach((n) => { const o = s.objs[n]; if (!o.alive || r.has(n)) return; (o.rc > 0 ? leaked : unclaimed).push(n); });
    return { leaked, unclaimed, trialVisited: r.size, wouldReclaim: leaked.concat(unclaimed) };
  }

  /* ----------------------------------------------------------------- copying */

  // collectCP: Cheney's algorithm. Copy the roots' objects into to-space, then let `scan` walk through
  // to-space: for every pointer in the scanned object, copy the target if it has no forwarding pointer yet
  // (otherwise just learn its new address). Because the queue is the to-space itself, the order is breadth-first.
  function collectCP(s, why) {
    s.stw = true; s.stats.gcRuns++;
    const from = s.cur, to = 1 - from;
    s.gcFrom = from; s.spaces[to] = new Array(s.S).fill(null); s.free = 0; s.scan = 0;
    let pause = 0;
    const alive = s.order.filter((n) => s.objs[n].alive);
    alive.forEach((n) => { s.objs[n].copied = false; });
    emit(s, 'gc-start', (why ? why + ' ' : '') + 'STOP THE WORLD. Space ' + from + ' is the from-space (where everything lives now); space ' + to + ' is the empty to-space. Both the scan pointer and the free pointer start at address 0 of the to-space.');
    // copy one object: put it at the free pointer, leave a forwarding pointer behind in the old cell.
    const copy = (n) => {
      const o = s.objs[n], oldAddr = o.addr, newAddr = s.free;
      place(s.spaces[to], newAddr, o);
      s.spaces[from][oldAddr].fwd = newAddr;
      o.addr = newAddr; o.space = to; o.copied = true; o.oldAddr = oldAddr;
      s.free += o.size; pause++; s.stats.visited++; s.stats.moved++;
      return { oldAddr, newAddr };
    };
    s.roots.forEach((n) => {
      const o = s.objs[n];
      if (o.copied) return;
      const m = copy(n); s.focus = n;
      emit(s, 'copy-root', 'Root ' + n + ' is reachable, so copy it from address ' + m.oldAddr + ' (space ' + from + ') to address ' + m.newAddr + ' (space ' + to + '). In the old cell leave a forwarding pointer "→ ' + m.newAddr + '" so anyone else who finds the old copy knows where it went. The free pointer moves to ' + s.free + '.');
    });
    // scan loop: scan walks the copied objects in order; free grows as more objects are copied.
    while (s.scan < s.free) {
      const n = s.spaces[to][s.scan].n, o = s.objs[n];
      if (!o.refs.length) {
        s.focus = n;
        const at = s.scan; s.scan += o.size;
        emit(s, 'scan', 'Scan ' + n + ' (address ' + at + '): it has no pointers, so there is nothing to follow. The scan pointer moves to ' + s.scan + '.');
        continue;
      }
      o.refs.forEach((c, idx) => {
        const co = s.objs[c]; s.focus = n; s.edge = [n, c];
        const last = idx === o.refs.length - 1;
        if (co.copied) {
          if (last) s.scan += o.size;
          emit(s, 'fwd', 'Scan ' + n + ': it points to ' + c + ', which already has a forwarding pointer (it now lives at address ' + co.addr + ' in space ' + to + '). Just update ' + n + '\'s pointer to the new address; no second copy is made.' + (last ? ' ' + n + ' is finished, so scan moves to ' + s.scan + '.' : ''));
        } else {
          const m = copy(c);
          if (last) s.scan += o.size;
          emit(s, 'copy', 'Scan ' + n + ': it points to ' + c + ', which has not been copied. Copy ' + c + ' from address ' + m.oldAddr + ' to address ' + m.newAddr + ', leave a forwarding pointer, and point ' + n + ' at the new copy. Free moves to ' + s.free + '.' + (last ? ' ' + n + ' is finished, so scan moves to ' + s.scan + '.' : ''));
        }
      });
    }
    // everything still not copied is garbage: it never needs to be looked at, only abandoned with the old space.
    const dead = alive.filter((n) => !s.objs[n].copied);
    s.focus = null;
    emit(s, 'cp-done', 'Scan has caught up with free (both at ' + s.free + '), so every reachable object has been copied. ' + (dead.length ? 'Left behind in the from-space are ' + dead.join(', ') + ': unreachable, never touched, and nobody paid anything to find them.' : 'Nothing was left behind: every object was reachable.') + ' Now flip the roles of the two spaces.');
    dead.forEach((n) => { const o = s.objs[n]; o.alive = false; o.color = null; s.stats.freedObjects++; s.stats.bytesReclaimed += o.size * s.cb; s.freeOrder.push(n); s.freedNow.push(n); });
    s.spaces[from] = new Array(s.S).fill(null);
    s.cur = to; s.gcFrom = null; s.stw = false;
    s.maxPauseUpdate(pause);
    emit(s, 'gc-end', 'Flip: space ' + to + ' is now the active heap and space ' + from + ' is empty. The world resumes. Copied ' + plural(pause, 'object') + ' (' + (dead.length ? 'freed ' + dead.join(', ') : 'freed none') + '). The survivors sit side by side from address 0, with new allocation continuing at address ' + s.free + ': no holes (compaction).');
  }

  /* ---------------------------------------------------------------- the runner */

  // allocate: place a new object, trying a collection first when the heap is full (if auto-GC is on).
  // Returns an error message, or null on success.
  function allocate(s, op) {
    const size = op.size;
    const tryPlace = () => {
      if (s.algo === 'cp') {
        if (size > s.S) return -2;
        return s.free + size <= s.S ? s.free : -1;
      }
      return firstFit(s.cells, size);
    };
    let addr = tryPlace();
    if (addr === -2) return 'Object ' + op.a + ' needs ' + plural(size, 'cell') + ' but each semispace has only ' + s.S + '. Make the heap bigger or the object smaller.';
    if (addr < 0 && s.algo !== 'rc' && s.autoGc) {
      s.focus = null;
      const why = 'The heap is full: there is no room for ' + op.a + ' (' + plural(size, 'cell') + '), so the allocator calls the collector first.';
      if (s.algo === 'ms') collectMS(s, why); else collectCP(s, why);
      addr = tryPlace();
    }
    if (addr < 0) {
      const f = fragOf(s);
      let msg = 'Out of memory at "' + op.text + '": no room for ' + op.a + ' (' + plural(size, 'cell') + ').';
      if (s.algo === 'rc') {
        // Counting frees an object only when a pointer to it is dropped. Say which of the two reasons applies.
        const rep = leakReport(s);
        msg += (rep.leaked.length ? ' ' + rep.leaked.join(', ') + ' form a cycle that counting can never free.' : '') +
          (rep.unclaimed.length ? ' ' + rep.unclaimed.join(', ') + ' were created but never pointed at, so their count is 0 and no pointer was ever dropped to trigger a free (give an object a root and later "unroot" it).' : '') +
          (!rep.leaked.length && !rep.unclaimed.length ? ' Everything left is still reachable.' : '');
      }
      else if (!s.autoGc) msg += ' Automatic collection is off; add a "gc" line before this one or turn it on.';
      else msg += ' Even after a collection everything left is reachable.';
      if (s.algo !== 'cp' && f.freeCells >= size) msg = 'Out of memory at "' + op.text + '": ' + f.freeCells + ' cells are free but the largest free block is only ' + f.largestFree + ', and ' + op.a + ' needs ' + size + ' in a row. That is external fragmentation: enough space in total, but split into holes.';
      return msg;
    }
    const o = { name: op.a, size, refs: [], rc: 0, addr, space: s.algo === 'cp' ? s.cur : 0, alive: true, color: null, copied: false };
    s.objs[op.a] = o; s.order.push(op.a);
    place(s.algo === 'cp' ? s.spaces[s.cur] : s.cells, addr, o);
    if (s.algo === 'cp') s.free = addr + size;
    s.stats.allocated++;
    s.focus = op.a;
    emit(s, 'alloc', 'Allocate ' + op.a + ' (' + plural(size, 'cell') + ') at address ' + addr + (s.algo === 'cp' ? ' of space ' + s.cur + ': allocation is just moving the free pointer to ' + s.free + '.' : ' (first free block that fits).') +
      (s.algo === 'rc' ? ' Its count starts at 0: nothing points at it yet.' : '') + ' No root points at ' + op.a + ' yet, so a collection right now would treat it as garbage.');
    return null;
  }

  // dead: message for touching an object that has already been freed (a dangling pointer).
  function deadMessage(s, name, op) {
    const o = s.objs[name];
    if (o && o.alive) return null;
    return 'Use after free at "' + op.text + '": ' + name + ' was already freed by this collector, so the program holds a dangling pointer to memory that may be reused. (Another collector may not have freed it yet.)';
  }

  // step: apply one script line. Returns an error message or null.
  function step(s, op) {
    s.line = op.line; s.opText = op.text;
    if (op.op === 'new') return allocate(s, op);
    if (op.op === 'gc') {
      if (s.algo === 'ms') collectMS(s, 'You asked for a collection ("gc").');
      else if (s.algo === 'cp') collectCP(s, 'You asked for a collection ("gc").');
      else {
        const rep = leakReport(s);
        emit(s, 'gc-note', 'Reference counting has no collection pass: objects are freed the moment their count hits 0, so "gc" has nothing to do. ' +
          (rep.leaked.length ? 'But ' + rep.leaked.join(', ') + ' ' + (rep.leaked.length === 1 ? 'is' : 'are') + ' unreachable and still counted (a cycle): a mark phase from the roots would not touch ' + (rep.leaked.length === 1 ? 'it' : 'them') + ', so mark-and-sweep would free ' + (rep.leaked.length === 1 ? 'it' : 'them') + '.' : 'No leaks right now.'), rep);
      }
      return null;
    }
    const names = [op.a, op.b].filter(Boolean);
    for (const n of names) { const m = deadMessage(s, n, op); if (m) return m; }
    const A = s.objs[op.a], B = op.b ? s.objs[op.b] : null;
    if (op.op === 'root') {
      s.roots.push(op.a); s.focus = op.a;
      if (s.algo === 'rc') A.rc++;
      emit(s, 'root', 'Root variable now points at ' + op.a + '.' + (s.algo === 'rc' ? ' A root pointer counts too, so ' + op.a + '\'s count goes up to ' + A.rc + '.' : ' Roots are where tracing starts: everything reachable from a root is live.'));
    } else if (op.op === 'ref') {
      A.refs.push(op.b); s.edge = [op.a, op.b]; s.focus = op.b;
      if (s.algo === 'rc') B.rc++;
      emit(s, 'ref', op.a + ' now points to ' + op.b + '.' + (s.algo === 'rc' ? ' One more pointer to ' + op.b + ', so its count goes up to ' + B.rc + '.' : '') + (op.a === op.b ? ' (An object pointing at itself is a one-object cycle.)' : ''));
    } else if (op.op === 'unref') {
      A.refs = A.refs.filter((x) => x !== op.b); s.edge = [op.a, op.b]; s.focus = op.b;
      if (s.algo === 'rc') dropPointer(s, op.b, op.a + ' no longer points to ' + op.b + '.');
      else emit(s, 'unref', op.a + ' no longer points to ' + op.b + '.' + (reach(s.roots, s.objs).has(op.b) ? '' : ' If nothing else leads to ' + op.b + ', it is now garbage, but the collector will not notice until the next collection.'));
    } else if (op.op === 'unroot') {
      s.roots = s.roots.filter((x) => x !== op.a); s.focus = op.a;
      if (s.algo === 'rc') dropPointer(s, op.a, 'The root variable no longer points at ' + op.a + '.');
      else emit(s, 'unroot', 'The root variable no longer points at ' + op.a + '.' + (reach(s.roots, s.objs).has(op.a) ? ' Other pointers still lead to it, so it stays reachable.' : ' If nothing else leads to it, ' + op.a + ' is now garbage, but nothing is freed until the next collection.'));
    }
    return null;
  }

  // simulate(ops, algo, opts): replay the script under one collector. Returns { frames, stats, error, freeOrder }.
  // A mistake that only shows up while running (use after free, heap full) stops that run with a message,
  // but the other collectors still run.
  function simulate(ops, algo, opts) {
    const s = newState(algo, opts);
    s.maxPauseUpdate = (p) => { if (p > s.stats.maxPause) s.stats.maxPause = p; };
    emit(s, 'start', BY_ID[algo].name + ' on a heap of ' + (algo === 'cp' ? opts.heap + ' cells split into two semispaces of ' + s.S + ' cells (only one is usable at a time)' : opts.heap + ' cells') + '. Press next to run the script line by line.');
    let error = null;
    for (const op of ops) {
      const msg = step(s, op);
      if (msg) { error = { line: op.line, message: msg }; s.line = op.line; s.opText = op.text; emit(s, 'error', msg); break; }
    }
    if (!error) {
      s.line = 0; s.opText = '';
      const f = fragOf(s), st = summary(s);
      let text = 'Script finished. ' + plural(st.freedObjects, 'object') + ' freed (' + st.bytesReclaimed + ' bytes), ' + plural(st.alive, 'object') + ' still allocated. ';
      const extra = {};
      if (algo === 'rc') {
        const rep = leakReport(s); Object.assign(extra, rep);
        text += rep.leaked.length ? 'LEAK: ' + rep.leaked.join(', ') + ' ' + (rep.leaked.length === 1 ? 'is' : 'are') + ' unreachable but still counted (they point at each other, or are held only by such objects). A trial mark from the roots visits just ' + plural(rep.trialVisited, 'object') + ' and never reaches ' + (rep.leaked.length === 1 ? 'it' : 'them') + ', so mark-and-sweep would reclaim ' + (rep.leaked.length === 1 ? 'it' : 'them') + '.' : 'No leaks: every object that is unreachable was freed.';
        if (rep.unclaimed.length) text += ' ' + rep.unclaimed.join(', ') + ' still has count 0 because nothing ever pointed at it (a real program would free it when its creating expression ends).';
      } else if (st.garbageWaiting) text += plural(st.garbageWaiting, 'unreachable object') + ' ' + (st.garbageWaiting === 1 ? 'is' : 'are') + ' still waiting for the next collection (floating garbage, not a leak: the next "gc" will take ' + (st.garbageWaiting === 1 ? 'it' : 'them') + ').';
      else text += 'Nothing unreachable is waiting.';
      text += ' ' + (algo === 'cp' ? 'Free pointer at ' + s.free + '.' : fragText(s));
      emit(s, 'end', text, extra);
      void f;
    }
    const last = s.frames[s.frames.length - 1];
    return { algo, frames: s.frames, stats: last.stats, error, freeOrder: s.freeOrder.slice() };
  }

  // normalise options: heap size is clamped to the allowed range by validation, not silently.
  function checkOptions(o) {
    const errors = [], out = { heap: +(o && o.heap != null ? o.heap : 16), autoGc: !(o && o.autoGc === false), cellBytes: LIMITS.cellBytes };
    if (!Number.isInteger(out.heap) || out.heap < LIMITS.minHeap || out.heap > LIMITS.maxHeap) errors.push('Heap capacity must be a whole number from ' + LIMITS.minHeap + ' to ' + LIMITS.maxHeap + ' cells.');
    return { out, errors };
  }

  // run(text, opts): parse the script and replay it under all three collectors.
  // Static mistakes (typos, unknown names...) return { ok:false, errors }. Otherwise { ok:true, runs:{ms,rc,cp}, warnings }
  // where a warning says a collector's run stopped early (use after free, out of memory).
  function run(text, opts) {
    const p = parse(text), c = checkOptions(opts);
    const errors = p.errors.concat(c.errors);
    if (errors.length) return { ok: false, errors };
    const runs = {}, warnings = [];
    ALGOS.forEach((a) => {
      runs[a.id] = simulate(p.ops, a.id, c.out);
      if (runs[a.id].error) warnings.push(a.short + ' stopped at line ' + runs[a.id].error.line + ': ' + runs[a.id].error.message);
    });
    return { ok: true, errors: [], warnings, ops: p.ops, names: p.names, runs, opts: c.out };
  }

  // Example scripts. These are only INPUTS: loading one fills the editor, and every result is computed.
  const PRESETS = [
    { id: 'chain', name: 'Linear chain A → B → C', heap: 8,
      script: 'new A\nnew B\nnew C\nroot A\nref A B\nref B C\nunroot A\ngc',
      note: 'Drop the only root and the whole chain becomes garbage. Reference counting frees A, then B, then C as a cascade.' },
    { id: 'shared', name: 'Shared object', heap: 8,
      script: 'new A\nnew B\nnew C\nref A C\nref B C\nroot A\nroot B\nunroot A\ngc\nunroot B\ngc',
      note: 'C is pointed at by both A and B. After A goes, C survives (count 2 → 1). Only when B goes too is C freed.' },
    { id: 'cycle', name: 'Cycle (reference counting leaks)', heap: 8,
      script: 'new A\nnew B\nnew C\nref A B\nref B A\nroot A\nroot C\nunroot A\ngc',
      note: 'A and B point at each other, so each keeps count 1 after the root is dropped. Compare the three collectors.' },
    { id: 'garbage', name: 'Big garbage subgraph (fragmentation)', heap: 16,
      script: 'new A\nroot A\nnew B\nroot B\nnew C\nnew D\nref B C\nref B D\nref C D\nnew E\nroot E\nnew F\nroot F\nnew G\nref F G\nnew H\nroot H\nref A H\nunroot B\nunroot F\ngc',
      note: 'Two garbage clumps sit between survivors. Mark-and-sweep leaves holes; the copying collector packs A, E, H together.' }
  ];

  const api = { LIMITS, ALGOS, BY_ID, PRESETS, parse, run, simulate, reach };
  NS.gc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
