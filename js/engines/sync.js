/* Synchronization engine: a tiny concurrent machine. Threads run small programs against shared variables,
   semaphores, mutexes and a bounded buffer. A scheduler picks which runnable thread executes the next instruction.
   Everything (races, deadlocks, violations) emerges from the interleaving; nothing is scripted. Pure logic.

   Tier 3 additions: labels and `goto` (so a thread can loop and busy-wait), `if` chains and variable-to-variable
   comparisons (Peterson, Dekker, bakery), and monitors: condition variables with `cwait`, `csignal` and
   `cbroadcast` under Mesa (signaller continues) or Hoare (signaller hands the monitor over) semantics.
   The explorer also reports threads that can loop FOREVER (a state from which no schedule can ever finish). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  // Caps: threads, instructions per thread, repeat count, steps in one run, states in the explorer.
  const LIMITS = { maxThreads: 6, maxInstr: 40, maxRounds: 5, maxSteps: 400, maxStates: 30000, maxNames: 12 };
  // Regions a thread can 'enter': cs (exclusive critical section), read (shared) and write (exclusive).
  const TAGS = ['cs', 'read', 'write'];
  // Comparison operators allowed in `if X == 1`.
  const CMP = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };

  // Seeded random generator so the Random scheduler is reproducible.
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------- parsing ---------- */
  // parseDecls: read the declaration boxes (variables, semaphores, mutexes, buffer size, expected result)
  // and return readable errors: bad syntax, duplicate or clashing names, negative semaphores.
  function parseDecls(d) {
    const errors = [];
    const list = (txt, kind, withVal) => {
      const out = {};
      String(txt || '').split(/[\s,;]+/).filter(Boolean).forEach((tok) => {
        const m = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(-?\d+))?$/);
        if (!m) { errors.push(kind + ' "' + tok + '" is not valid.' + (withVal ? ' Write NAME=value, for example X=0.' : ' Write a name, for example M.')); return; }
        if (!withVal && m[2] != null) { errors.push(kind + ' "' + tok + '" should be just a name.'); return; }
        const name = m[1];
        if (out[name] != null) errors.push(kind + ' ' + name + ' is declared twice.');
        out[name] = withVal ? (m[2] != null ? parseInt(m[2], 10) : 0) : true;
      });
      if (Object.keys(out).length > LIMITS.maxNames) errors.push('At most ' + LIMITS.maxNames + ' ' + kind + 's.');
      return out;
    };
    const vars = list(d.vars, 'Variable', true), sems = list(d.sems, 'Semaphore', true), muts = list(d.muts, 'Mutex', false);
    const conds = list(d.conds, 'Condition variable', false);
    // 'mesa' (default): a signalled thread must re-acquire the monitor lock, the signaller keeps running.
    // 'hoare': the monitor is handed straight to the signalled thread and the signaller waits its turn.
    const hoare = d.mon === 'hoare';
    Object.keys(sems).forEach((s) => { if (sems[s] < 0) errors.push('Semaphore ' + s + ' cannot start below 0.'); });
    const cap = d.cap === '' || d.cap == null ? 0 : Number(d.cap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 9) errors.push('Buffer size must be a whole number from 0 to 9 (0 means no buffer).');
    const expect = {};
    String(d.expect || '').split(/[\s,;]+/).filter(Boolean).forEach((tok) => {
      const m = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+)$/);
      if (!m) errors.push('Expected result "' + tok + '" is not valid. Write X=2.'); else if (!(m[1] in vars)) errors.push('Expected result mentions ' + m[1] + ', which is not a declared variable.'); else expect[m[1]] = parseInt(m[2], 10);
    });
    const names = Object.keys(vars).concat(Object.keys(sems), Object.keys(muts), Object.keys(conds));
    names.forEach((n, i) => { if (names.indexOf(n) !== i) errors.push('The name ' + n + ' is used for more than one thing.'); });
    return { errors, decl: { vars, sems, muts, conds, hoare, cap, expect } };
  }

  // parseProgram: turn the program text into threads. 'thread T1 x3' starts a thread (x3 = repeat its
  // program 3 times); the lines after it are its instructions. Every instruction is checked against the
  // declarations (is X a declared variable? is S a semaphore?) and bad lines get a line-numbered error.
  function parseProgram(text, decl) {
    const errors = []; const threads = [];
    let cur = null;
    String(text).split('\n').forEach((raw, ln) => {
      const line = raw.replace(/#.*$/, '').trim(); if (!line) return;
      const at = 'Line ' + (ln + 1) + ': ';
      const tm = line.match(/^thread\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+x(\d+))?$/i);
      if (tm) {
        if (threads.some((t) => t.id === tm[1])) errors.push(at + 'thread ' + tm[1] + ' is defined twice.');
        const rounds = tm[2] ? parseInt(tm[2], 10) : 1;
        if (rounds < 1 || rounds > LIMITS.maxRounds) errors.push(at + 'repeat count must be 1 to ' + LIMITS.maxRounds + ' (write "thread ' + tm[1] + ' x3").');
        cur = { id: tm[1], rounds, code: [], lines: [], regsSeen: new Set(), labels: {} }; threads.push(cur); return;
      }
      if (!cur) { errors.push(at + 'start with a line like "thread T1".'); return; }
      // A label ("again:") names the position of the NEXT instruction, so `goto again` can jump back to it.
      // A label is not an instruction: it costs no step.
      const lm = line.match(/^([A-Za-z_][A-Za-z0-9_]*):$/);
      if (lm) { if (lm[1] in cur.labels) errors.push(at + 'label ' + lm[1] + ' is defined twice in thread ' + cur.id + '.'); else cur.labels[lm[1]] = cur.code.length; return; }
      const w = line.split(/\s+/); const op = w[0].toLowerCase();
      // Arity check: an instruction must have exactly the expected number of operands.
      const need = (n, usage) => { if (w.length !== n + 1) { errors.push(at + '"' + line + '" should look like: ' + usage); return false; } return true; };
      const isVar = (n) => n in decl.vars, reg = (n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !(n in decl.vars) && !(n in decl.sems) && !(n in decl.muts);
      const num = (s) => /^-?\d+$/.test(s);
      // Decode one instruction. The instruction set is deliberately tiny, so that races are visible:
      //   load r X / add r k / store X r   non-atomic read-modify-write through a private register
      //   inc X / dec X / set X k          atomic updates of a shared variable
      //   wait S / signal S                counting semaphore (P and V)
      //   lock M / unlock M                mutex
      //   put / get                        bounded buffer (violations if full / empty)
      //   enter / leave cs|read|write      mark a critical region so mutual exclusion can be checked
      //   tas r X                          test-and-set: ATOMICALLY r = X and X = 1 (one indivisible step)
      //   cas ok X old new                 compare-and-swap: ATOMICALLY, if X == old then X = new and ok = 1, else ok = 0
      //                                    (old and new are numbers or registers)
      //   spin X                           spinlock acquire: if X is 0 take it (X = 1), otherwise stay here and
      //                                    burn the step (the thread is NOT blocked: it keeps using the CPU)
      //   if X == k                        the NEXT line runs only if the condition holds (X is a shared
      //                                    variable or a register this thread has already set)
      //   NAME:  /  goto NAME              a label, and a jump to it (a goto is one step, so a loop burns steps)
      //   if A == B  [if C < D ...]        a chain of ifs forms one AND-condition: the next ordinary line runs only
      //                                    if EVERY if in the chain holds (A is a variable or register, B a number,
      //                                    variable or register); otherwise the whole guarded line is skipped
      //   cwait C M                        monitor: atomically release M and sleep on condition variable C
      //   csignal C / cbroadcast C         wake one / all sleepers of C (Mesa or Hoare rules, set in the declarations)
      //   work label                       a step with no effect (thinking, eating, ...)
      let ins = null;
      if (op === 'load') { if (need(2, 'load r X') ) { if (!reg(w[1])) errors.push(at + w[1] + ' is not a valid register name (it clashes with a shared name).'); else if (!isVar(w[2])) errors.push(at + w[2] + ' is not a declared shared variable.'); else ins = { op, r: w[1], x: w[2] }; } }
      else if (op === 'add') { if (need(2, 'add r 1')) { if (!reg(w[1])) errors.push(at + w[1] + ' is not a valid register name.'); else if (!num(w[2])) errors.push(at + '"' + w[2] + '" must be a whole number.'); else ins = { op, r: w[1], k: parseInt(w[2], 10) }; } }
      else if (op === 'store') { if (need(2, 'store X r')) { if (!isVar(w[1])) errors.push(at + w[1] + ' is not a declared shared variable.'); else if (!reg(w[2])) errors.push(at + w[2] + ' is not a valid register name.'); else ins = { op, x: w[1], r: w[2] }; } }
      else if (op === 'set') { if (need(2, 'set X 5')) { if (!isVar(w[1])) errors.push(at + w[1] + ' is not a declared shared variable.'); else if (!num(w[2])) errors.push(at + '"' + w[2] + '" must be a whole number.'); else ins = { op, x: w[1], k: parseInt(w[2], 10) }; } }
      else if (op === 'inc' || op === 'dec') { if (need(1, op + ' X')) { if (!isVar(w[1])) errors.push(at + w[1] + ' is not a declared shared variable.'); else ins = { op, x: w[1] }; } }
      else if (op === 'wait' || op === 'signal') { if (need(1, op + ' S')) { if (!(w[1] in decl.sems)) errors.push(at + w[1] + ' is not a declared semaphore.'); else ins = { op, s: w[1] }; } }
      else if (op === 'lock' || op === 'unlock') { if (need(1, op + ' M')) { if (!(w[1] in decl.muts)) errors.push(at + w[1] + ' is not a declared mutex.'); else ins = { op, m: w[1] }; } }
      else if (op === 'put' || op === 'get') { if (need(0, op)) { if (!decl.cap) errors.push(at + '"' + op + '" needs a buffer. Set the buffer size above 0.'); else ins = { op }; } }
      else if (op === 'enter' || op === 'leave') { if (need(1, op + ' cs  (or read / write)')) { if (!TAGS.includes(w[1].toLowerCase())) errors.push(at + 'region must be cs, read or write.'); else ins = { op, tag: w[1].toLowerCase() }; } }
      else if (op === 'tas') { if (need(2, 'tas r X')) { if (!reg(w[1])) errors.push(at + w[1] + ' is not a valid register name.'); else if (!isVar(w[2])) errors.push(at + w[2] + ' is not a declared shared variable.'); else ins = { op, r: w[1], x: w[2] }; } }
      else if (op === 'cas') { if (need(4, 'cas ok X 0 1  (old and new can be numbers or registers)')) {
        const operand = (t) => num(t) ? { k: parseInt(t, 10) } : (reg(t) && cur.regsSeen.has(t) ? { r: t } : null);
        const o1 = operand(w[3]), o2 = operand(w[4]);
        if (!reg(w[1])) errors.push(at + w[1] + ' is not a valid register name.');
        else if (!isVar(w[2])) errors.push(at + w[2] + ' is not a declared shared variable.');
        else if (!o1) errors.push(at + '"' + w[3] + '" must be a whole number or a register set earlier in this thread.');
        else if (!o2) errors.push(at + '"' + w[4] + '" must be a whole number or a register set earlier in this thread.');
        else ins = { op, r: w[1], x: w[2], old: o1, nw: o2 };
      } }
      else if (op === 'spin') { if (need(1, 'spin L  (acquire a spinlock held in shared variable L)')) { if (!isVar(w[1])) errors.push(at + w[1] + ' is not a declared shared variable.'); else ins = { op, x: w[1] }; } }
      else if (op === 'if') { if (need(3, 'if X == 1  (then the NEXT line runs only if true; the right side may be a number, a variable or a register)')) {
        const known = (n) => isVar(n) || (reg(n) && cur.regsSeen.has(n));
        if (!known(w[1])) errors.push(at + w[1] + ' is not a declared shared variable or a register set earlier in this thread.');
        else if (!CMP[w[2]]) errors.push(at + 'comparison must be one of == != > < >= <=.');
        else if (!num(w[3]) && !known(w[3])) errors.push(at + '"' + w[3] + '" must be a whole number, a declared shared variable or a register set earlier in this thread.');
        else ins = { op, x: w[1], cmp: w[2], reg: !isVar(w[1]), rhs: num(w[3]) ? { k: parseInt(w[3], 10) } : (isVar(w[3]) ? { v: w[3] } : { r: w[3] }), k: num(w[3]) ? parseInt(w[3], 10) : undefined };
      } }
      else if (op === 'goto') { if (need(1, 'goto label')) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(w[1])) errors.push(at + '"' + w[1] + '" is not a valid label name.'); else ins = { op, label: w[1] }; } }
      else if (op === 'cwait') { if (need(2, 'cwait C M  (sleep on condition C, releasing mutex M)')) { if (!(w[1] in decl.conds)) errors.push(at + w[1] + ' is not a declared condition variable.'); else if (!(w[2] in decl.muts)) errors.push(at + w[2] + ' is not a declared mutex.'); else ins = { op, c: w[1], m: w[2] }; } }
      else if (op === 'csignal' || op === 'cbroadcast') { if (need(1, op + ' C')) { if (!(w[1] in decl.conds)) errors.push(at + w[1] + ' is not a declared condition variable.'); else ins = { op, c: w[1] }; } }
      else if (op === 'work') ins = { op, label: w.slice(1).join(' ') || 'work' };
      else errors.push(at + 'unknown instruction "' + w[0] + '". Use: load add store set inc dec tas cas spin wait signal lock unlock put get enter leave if goto cwait csignal cbroadcast work.');
      // Remember which registers this thread has written, so a later `if r == 0` can be checked.
      if (ins && (ins.op === 'load' || ins.op === 'add' || ins.op === 'tas' || ins.op === 'cas')) cur.regsSeen.add(ins.r);
      if (ins) { ins.text = line; ins.ln = ln + 1; cur.code.push(ins); }
      else cur.code.push({ op: 'work', label: '?', text: line });
    });
    if (!threads.length) errors.push('Add at least one thread, for example "thread T1".');
    if (threads.length > LIMITS.maxThreads) errors.push('At most ' + LIMITS.maxThreads + ' threads.');
    threads.forEach((t) => {
      if (!t.code.length) errors.push('Thread ' + t.id + ' has no instructions.');
      if (t.code.length > LIMITS.maxInstr) errors.push('Thread ' + t.id + ' is longer than ' + LIMITS.maxInstr + ' instructions.');
      // Resolve jumps: a goto needs a label of this thread; an if-chain needs an ordinary instruction after it,
      // and when the chain is false execution skips that guarded instruction (skip = index just after it).
      t.code.forEach((c, i) => {
        if (c.op === 'goto') { if (c.label in t.labels) c.target = t.labels[c.label]; else errors.push('Line ' + c.ln + ': thread ' + t.id + ' has no label called ' + c.label + '.'); }
        if (c.op === 'if') { let j = i + 1; while (j < t.code.length && t.code[j].op === 'if') j++; if (j >= t.code.length) { if (i === 0 || t.code[i - 1].op !== 'if') errors.push('Line ' + c.ln + ': an "if" needs an instruction after it.'); } else c.skip = j + 1; }
      });
    });
    return { errors, threads };
  }

  /* ---------- machine ---------- */
  // initial: the starting machine state: every thread at instruction 0 and ready, shared variables and
  // semaphores at their declared values, mutexes free, buffer empty, nobody in any region.
  function initial(prog, decl) {
    const sems = {}; Object.keys(decl.sems).forEach((s) => { sems[s] = { v: decl.sems[s], q: [] }; });
    // A mutex has an entry queue (q) and, for Hoare monitors, an urgent queue (urg) of signallers that stepped aside.
    const muts = {}; Object.keys(decl.muts).forEach((m) => { muts[m] = { owner: null, q: [], urg: [] }; });
    const conds = {}; Object.keys(decl.conds || {}).forEach((c) => { conds[c] = { q: [] }; });   // sleepers: { ti, m }
    return {
      threads: prog.map((t) => ({ pc: 0, regs: {}, state: 'ready', on: null, left: t.rounds })),
      vars: Object.assign({}, decl.vars), sems, muts, conds, hoare: !!decl.hoare, buf: { count: 0, cap: decl.cap },
      occ: { cs: [], read: [], write: [] }, violation: null
    };
  }
  // clone: every step works on a copy, so frames never change after they are created.
  const clone = (s) => JSON.parse(JSON.stringify(s));

  // normalize: after a thread's pc moves past its last instruction, start its next repeat or mark it done.
  function normalize(th, len) { if (th.pc >= len) { th.left -= 1; if (th.left > 0) th.pc = 0; else { th.state = 'done'; th.on = null; } } }
  // runnable(state): indices of threads that can execute right now (blocked and finished threads cannot).
  const runnable = (st) => st.threads.map((t, i) => (t.state === 'ready' ? i : -1)).filter((i) => i >= 0);

  // violate: record the first correctness failure (broken exclusion, overflow, misuse, ...).
  function violate(ns, ti, prog, kind, msg) { ns.violation = { kind, msg, thread: prog[ti].id }; }

  // step: execute ONE instruction of thread ti and return { state, ev }. This is the whole machine.
  // The scheduler (or you) chooses ti; everything else - races, blocking, deadlock - follows from the
  // instructions. Blocking instructions leave pc where it is and queue the thread.
  function step(prog, st, ti) {
    const ns = clone(st); const th = ns.threads[ti]; const T = prog[ti]; const ins = T.code[th.pc]; const id = T.id; const len = T.code.length;
    const ev = { ti, id, pc: th.pc, text: ins.text, note: '', blocked: false };
    // wake(tj): unblock a waiting thread. The permit / lock is handed over directly, so the woken thread
    // moves *past* its wait/lock instruction (this keeps semaphore queues FIFO and avoids lost wake-ups).
    const wake = (tj, why) => { const t2 = ns.threads[tj]; t2.state = 'ready'; t2.on = null; t2.pc += 1; normalize(t2, prog[tj].code.length); return prog[tj].id + ' ' + why; };
    // advance = how far pc moves after this instruction (0 when blocked, 2 when an `if` skips a line).
    let advance = 1;
    // release(M): the owner gives up M. Signallers parked on the urgent queue (Hoare) go before the ordinary
    // entry queue; if nobody is waiting M becomes free. Returns the text describing who got it (or '').
    const release = (mname) => {
      const m = ns.muts[mname]; const tj = m.urg.length ? m.urg.shift() : (m.q.length ? m.q.shift() : null);
      if (tj == null) { m.owner = null; return ''; }
      m.owner = tj; return wake(tj, 'and it now holds the lock.');
    };
    switch (ins.op) {
      // load/add/store: the classic non-atomic update. Another thread can run between these three steps.
      case 'load': th.regs[ins.r] = ns.vars[ins.x]; ev.note = 'Copy ' + ins.x + ' (' + ns.vars[ins.x] + ') into private register ' + ins.r + '.'; break;
      case 'add': th.regs[ins.r] = (th.regs[ins.r] || 0) + ins.k; ev.note = ins.r + ' becomes ' + th.regs[ins.r] + ' (private to ' + id + ').'; break;
      case 'store': ns.vars[ins.x] = th.regs[ins.r] || 0; ev.note = 'Write register ' + ins.r + ' (' + (th.regs[ins.r] || 0) + ') to shared ' + ins.x + '.'; break;
      // tas: read the old value into r and set the variable to 1 in ONE indivisible step. No other thread can
      // slip in between the read and the write, which is exactly what makes a lock out of it.
      case 'tas': { const old = ns.vars[ins.x]; th.regs[ins.r] = old; ns.vars[ins.x] = 1; ev.note = 'Atomic: r ' + ins.r + ' = ' + old + ' (the OLD value of ' + ins.x + '), and ' + ins.x + ' is set to 1 in the same step.' + (old === 0 ? ' It was free, so ' + id + ' now owns it.' : ' It was already 1, so someone else owns it.'); break; }
      // cas: if X still equals what the thread expected, replace it; otherwise change nothing and report failure.
      case 'cas': {
        const val = (o) => (o.r != null ? (th.regs[o.r] || 0) : o.k);
        const expected = val(ins.old), wanted = val(ins.nw);
        if (ns.vars[ins.x] === expected) { ns.vars[ins.x] = wanted; th.regs[ins.r] = 1; ev.note = 'Atomic: ' + ins.x + ' is ' + expected + ' as expected, so it becomes ' + wanted + ' and ' + ins.r + ' = 1 (success).'; }
        else { th.regs[ins.r] = 0; ev.note = 'Atomic: ' + ins.x + ' is ' + ns.vars[ins.x] + ', not the expected ' + expected + ', so nothing changes and ' + ins.r + ' = 0 (FAILED: someone else got there first; real code would retry).'; }
        break;
      }
      // spin: busy-wait lock. Free -> take it. Taken -> stay on this instruction; the thread stays READY and
      // keeps being scheduled, wasting CPU, which is the difference between spinning and blocking.
      case 'spin':
        if (ns.vars[ins.x] === 0) { ns.vars[ins.x] = 1; ev.note = ins.x + ' was 0 (free), so ' + id + ' takes it (atomically sets it to 1) and continues.'; }
        else { advance = 0; ev.spin = true; ev.note = ins.x + ' is 1 (held), so ' + id + ' SPINS: it wasted this step and is still ready to run.'; }
        break;
      case 'set': ns.vars[ins.x] = ins.k; ev.note = ins.x + ' = ' + ins.k + '.'; break;
      case 'inc': ns.vars[ins.x] += 1; ev.note = 'Atomic: ' + ins.x + ' becomes ' + ns.vars[ins.x] + '.'; break;
      case 'dec': ns.vars[ins.x] -= 1; ev.note = 'Atomic: ' + ins.x + ' becomes ' + ns.vars[ins.x] + '.'; break;
      // wait (P): if the semaphore is positive take one; otherwise block and join its FIFO queue.
      case 'wait': {
        const s = ns.sems[ins.s];
        if (s.v > 0) { s.v -= 1; ev.note = ins.s + ' > 0, so decrement it to ' + s.v + ' and continue.'; }
        else { th.state = 'blocked'; th.on = ins.s; s.q.push(ti); advance = 0; ev.blocked = true; ev.note = ins.s + ' is 0, so ' + id + ' BLOCKS and joins the queue of ' + ins.s + '.'; }
        break;
      }
      // signal (V): if someone is queued wake the first (handing it the permit); else increase the value.
      case 'signal': {
        const s = ns.sems[ins.s];
        if (s.q.length) { const tj = s.q.shift(); ev.note = 'Signal ' + ins.s + ': ' + wake(tj, 'is woken and passes its wait (permit handed over, value stays ' + s.v + ').'); }
        else { s.v += 1; ev.note = 'Nobody waiting, so ' + ins.s + ' increases to ' + s.v + '.'; }
        break;
      }
      // lock: acquire a free mutex; block if another thread owns it. Locking twice yourself is a misuse.
      case 'lock': {
        const m = ns.muts[ins.m];
        if (m.owner == null) { m.owner = ti; ev.note = id + ' acquires ' + ins.m + '.'; }
        else if (m.owner === ti) { violate(ns, ti, prog, 'misuse', id + ' tried to lock ' + ins.m + ' that it already holds (a plain mutex deadlocks itself).'); ev.note = ns.violation.msg; }
        else { th.state = 'blocked'; th.on = ins.m; m.q.push(ti); advance = 0; ev.blocked = true; ev.note = ins.m + ' is held by ' + prog[m.owner].id + ', so ' + id + ' BLOCKS.'; }
        break;
      }
      // unlock: only the owner may unlock. If threads are queued, ownership passes to the first.
      case 'unlock': {
        const m = ns.muts[ins.m];
        if (m.owner !== ti) { violate(ns, ti, prog, 'misuse', id + ' unlocked ' + ins.m + ' without owning it.'); ev.note = ns.violation.msg; }
        else { const who = release(ins.m); ev.note = id + ' releases ' + ins.m + (who ? ', which is handed to ' + who : '.'); }
        break;
      }
      // put/get: the bounded buffer. Putting into a full buffer or getting from an empty one is a violation,
      // which is exactly the bug the empty/full semaphores exist to prevent.
      case 'put': if (ns.buf.count >= ns.buf.cap) { violate(ns, ti, prog, 'overflow', id + ' put an item into a FULL buffer (' + ns.buf.cap + '). Items would be overwritten.'); ev.note = ns.violation.msg; } else { ns.buf.count += 1; ev.note = 'Buffer now holds ' + ns.buf.count + ' of ' + ns.buf.cap + '.'; } break;
      case 'get': if (ns.buf.count <= 0) { violate(ns, ti, prog, 'underflow', id + ' took an item from an EMPTY buffer.'); ev.note = ns.violation.msg; } else { ns.buf.count -= 1; ev.note = 'Buffer now holds ' + ns.buf.count + ' of ' + ns.buf.cap + '.'; } break;
      // enter: join a region and check mutual exclusion. Exclusive regions (cs, write) must be empty;
      // readers may share but never with a writer.
      case 'enter': {
        const o = ns.occ; const excl = ins.tag !== 'read';
        const others = o.cs.concat(o.write, o.read).filter((x) => x !== ti);
        const bad = excl ? others.length > 0 : (o.cs.length + o.write.length) > 0;
        o[ins.tag].push(ti);
        if (bad) { violate(ns, ti, prog, 'exclusion', 'MUTUAL EXCLUSION BROKEN: ' + id + ' entered the ' + ins.tag + ' region while ' + others.map((x) => prog[x].id).join(', ') + ' ' + (others.length > 1 ? 'were' : 'was') + ' inside.'); ev.note = ns.violation.msg; }
        else ev.note = id + ' is now inside the ' + ins.tag + ' region.';
        break;
      }
      // leave: exit the region.
      case 'leave': ns.occ[ins.tag] = ns.occ[ins.tag].filter((x) => x !== ti); ev.note = id + ' leaves the ' + ins.tag + ' region.'; break;
      // if: evaluate the condition. True: go on to the next line (another if of the chain, or the guarded line).
      // False: the whole chain fails, so jump past the guarded line (ins.skip).
      case 'if': {
        const cur = ins.reg ? (th.regs[ins.x] || 0) : ns.vars[ins.x];
        const rhs = ins.rhs.k != null ? ins.rhs.k : (ins.rhs.v != null ? ns.vars[ins.rhs.v] : (th.regs[ins.rhs.r] || 0));
        const rname = ins.rhs.k != null ? String(rhs) : (ins.rhs.v || ins.rhs.r) + ' (' + rhs + ')';
        const ok = CMP[ins.cmp](cur, rhs); advance = ok ? 1 : ins.skip - th.pc;
        ev.note = (ins.reg ? 'Register ' : '') + ins.x + ' is ' + cur + (ins.rhs.k != null ? '' : ', compared with ' + rname) + ', so the condition ' + ins.x + ' ' + ins.cmp + ' ' + rhs + ' is ' + (ok ? 'TRUE: continue to the next line.' : 'FALSE: skip the guarded line.');
        break;
      }
      // goto: jump to a label. Jumping backwards makes a loop, and every pass costs steps (busy waiting).
      case 'goto': advance = ins.target - th.pc; ev.loop = ins.target <= th.pc; ev.note = 'Jump to ' + ins.label + (ev.loop ? ' (back up: this thread is looping, and still READY, so it burns CPU while it waits).' : '.'); break;
      // cwait: the monitor operation. ATOMICALLY release the monitor lock M and sleep on condition C, so a
      // signal cannot slip in between "decide to sleep" and "asleep" (that gap is the lost-wake-up bug).
      case 'cwait': {
        const m = ns.muts[ins.m];
        if (m.owner !== ti) { violate(ns, ti, prog, 'misuse', id + ' called cwait on ' + ins.c + ' without holding ' + ins.m + '. A monitor wait must be made inside the monitor.'); ev.note = ns.violation.msg; break; }
        th.state = 'blocked'; th.on = ins.c; ns.conds[ins.c].q.push({ ti, m: ins.m }); advance = 0; ev.blocked = true;
        const who = release(ins.m);
        ev.note = id + ' atomically releases ' + ins.m + ' and sleeps on ' + ins.c + '.' + (who ? ' ' + ins.m + ' goes to ' + who : '');
        break;
      }
      // csignal: wake the first sleeper. Mesa: it only becomes ready to RE-ACQUIRE the monitor, the signaller keeps
      // the lock and runs on, so the condition may be false again by the time the sleeper runs (hence `while`, not
      // `if`). Hoare: the monitor is handed straight to the sleeper, the signaller waits on the urgent queue, so the
      // condition is guaranteed true when the sleeper resumes.
      case 'csignal': {
        const c = ns.conds[ins.c];
        if (!c.q.length) { ev.lost = true; ev.note = 'Nobody is sleeping on ' + ins.c + ', so this signal is LOST. A condition variable has no memory: a thread that waits later sleeps until the NEXT signal.'; break; }
        const w = c.q.shift(), m = ns.muts[w.m], t2 = ns.threads[w.ti];
        if (ns.hoare) {
          if (m.owner !== ti) { violate(ns, ti, prog, 'misuse', id + ' signalled ' + ins.c + ' without holding ' + w.m + '. A Hoare signal hands the monitor over, so it must be held.'); ev.note = ns.violation.msg; break; }
          m.owner = w.ti; t2.state = 'ready'; t2.on = null; t2.pc += 1; normalize(t2, prog[w.ti].code.length);
          th.state = 'blocked'; th.on = w.m; m.urg.push(ti); advance = 0; ev.blocked = true;
          ev.note = 'Hoare signal: ' + prog[w.ti].id + ' wakes and gets ' + w.m + ' AT ONCE; ' + id + ' steps aside onto the urgent queue until the monitor is free again.';
        } else if (m.owner == null) { ev.note = 'Mesa signal: ' + wake(w.ti, 'wakes and takes the free ' + w.m + '.'); m.owner = w.ti; }
        else { t2.on = w.m; m.q.push(w.ti); ev.note = 'Mesa signal: ' + prog[w.ti].id + ' wakes but must first re-acquire ' + w.m + ', so it joins the monitor queue. ' + id + ' keeps running, so the condition may change before ' + prog[w.ti].id + ' runs.'; }
        break;
      }
      // cbroadcast: wake EVERY sleeper (they all move to the monitor entry queue and re-check their condition).
      case 'cbroadcast': {
        const c = ns.conds[ins.c]; const all = c.q.splice(0, c.q.length);
        if (!all.length) { ev.lost = true; ev.note = 'Nobody is sleeping on ' + ins.c + ', so this broadcast is LOST.'; break; }
        all.forEach((w) => { const m = ns.muts[w.m]; ns.threads[w.ti].on = w.m; if (m.owner == null) { m.owner = w.ti; wake(w.ti, ''); } else m.q.push(w.ti); });
        ev.note = 'Broadcast: all ' + all.length + ' sleeper(s) of ' + ins.c + ' (' + all.map((w) => prog[w.ti].id).join(', ') + ') wake up and queue to re-acquire the monitor. Each must re-check its own condition.';
        break;
      }
      default: ev.note = (ins.label || 'work') + '.'; break;
    }
    // Move on unless the thread blocked (advance 0) or was already moved by a wake-up.
    if (advance && th.state === 'ready') { th.pc += advance; normalize(th, len); }
    return { state: ns, ev };
  }

  /* terminal classification */
  // classify: is this state final? Returns null while some thread can still run, else:
  //   violation - a rule was broken (or finished with the wrong result for `expect`)
  //   done      - every thread finished normally
  //   deadlock  - nobody can run but some threads are still blocked (waits are listed)
  function classify(prog, st, decl) {
    if (st.violation) return { kind: 'violation', v: st.violation };
    const run = runnable(st);
    // Livelock: every thread that could still run is spinning on a lock that is held, and nobody else can
    // release it, so nothing will ever change (spinning threads stay READY, so this is not a deadlock).
    const spinning = (i) => { const ins = prog[i].code[st.threads[i].pc]; return ins && ins.op === 'spin' && st.vars[ins.x] !== 0; };
    if (run.length && run.every(spinning)) {
      const waits = run.map((i) => ({ id: prog[i].id, on: prog[i].code[st.threads[i].pc].x }));
      return { kind: 'livelock', waits, v: { kind: 'livelock', thread: null, msg: 'LIVELOCK: ' + waits.map((w) => w.id + ' spins on ' + w.on).join('; ') + '. Every thread that can still run is busy-waiting for a lock that nobody can release, so the CPU is burned and nothing changes.' } };
    }
    if (run.length) return null;
    if (st.threads.every((t) => t.state === 'done')) {
      const wrong = Object.keys(decl.expect).filter((k) => st.vars[k] !== decl.expect[k]);
      if (wrong.length) return { kind: 'violation', v: { kind: 'result', msg: 'WRONG RESULT: ' + wrong.map((k) => k + ' ended as ' + st.vars[k] + ' but should be ' + decl.expect[k]).join('; ') + '.', thread: null } };
      return { kind: 'done' };
    }
    const waits = st.threads.map((t, i) => (t.state === 'blocked' ? { id: prog[i].id, on: t.on, holder: st.muts[t.on] && st.muts[t.on].owner != null ? prog[st.muts[t.on].owner].id : null } : null)).filter(Boolean);
    return { kind: 'deadlock', waits };
  }

  /* ---------- running ---------- */
  // run: execute one schedule from the start and record a frame per instruction. The scheduler is:
  //   manual - the list of thread picks you made    random - uniform among runnable threads (seeded)
  //   rr     - round-robin with a time slice (quantum) measured in instructions
  function run(prog, decl, sched) {
    let st = initial(prog, decl); const frames = [];
    const snap = (extra) => frames.push(Object.assign({ st }, extra));
    snap({ ev: null, text: 'Start. Every thread is at its first instruction. Pick which thread runs next.' });
    let term = classify(prog, st, decl), error = null;
    // State for the schedulers: seeded RNG, round-robin `cur` thread and slice counter, and the picks made.
    const rnd = mulberry32((sched.seed | 0) || 1); let cur = -1, used = 0;
    const picks = []; let manualIdx = 0;
    while (!term && frames.length - 1 < LIMITS.maxSteps) {
      const rs = runnable(st); let ti;
      // Manual: replay your picks; a pick of a blocked or finished thread is reported as an error.
      if (sched.mode === 'manual') {
        if (manualIdx >= sched.picks.length) break;
        ti = prog.findIndex((t) => t.id === sched.picks[manualIdx]);
        if (ti < 0) { error = 'There is no thread called ' + sched.picks[manualIdx] + '.'; break; }
        if (!rs.includes(ti)) { error = 'Pick ' + (manualIdx + 1) + ': ' + prog[ti].id + ' cannot run now (it is ' + (st.threads[ti].state === 'blocked' ? 'blocked on ' + st.threads[ti].on : 'finished') + '). Remaining picks were ignored.'; break; }
        manualIdx++;
      // Round-robin: keep running the current thread until its slice is used or it cannot run, then move to
      // the next runnable thread in order.
      } else if (sched.mode === 'rr') {
        const q = Math.max(1, sched.quantum | 0 || 1);
        if (cur < 0 || !rs.includes(cur) || used >= q) { let nxt = -1; for (let k = 1; k <= prog.length; k++) { const c = (cur + k + prog.length) % prog.length; if (rs.includes(c)) { nxt = c; break; } } cur = nxt; used = 0; }
        ti = cur; used++;
      } else ti = rs[Math.floor(rnd() * rs.length)];
      picks.push(prog[ti].id);
      const r = step(prog, st, ti); st = r.state;
      snap({ ev: r.ev, text: r.ev.id + ' runs "' + r.ev.text + '". ' + r.ev.note });
      term = classify(prog, st, decl);
    }
    const status = term ? term.kind : (error ? 'error' : (frames.length - 1 >= LIMITS.maxSteps ? 'limit' : 'running'));
    return { frames, term, status, error, picks, prog, decl };
  }

  /* ---------- exhaustive exploration (BFS so example schedules are shortest) ---------- */
  // keyOf: a string identifying a machine state, so the explorer can recognise states it has seen.
  function keyOf(st) { return JSON.stringify([st.threads.map((t) => [t.pc, t.state, t.left, t.regs]), st.vars, Object.keys(st.sems).map((k) => [st.sems[k].v, st.sems[k].q]), Object.keys(st.muts).map((k) => [st.muts[k].owner, st.muts[k].q, st.muts[k].urg]), Object.keys(st.conds).map((k) => st.conds[k].q), st.buf.count, st.occ.cs, st.occ.read, st.occ.write]); }
  // explore: breadth-first search over EVERY interleaving. From each state it tries running each runnable
  // thread. Identical states are merged (so the search is far smaller than all orderings), and breadth-first
  // order means the example schedule stored for each outcome is the shortest one. Terminal states are
  // grouped into distinct outcomes: finished (with the final values), deadlock, or a violation.
  function explore(prog, decl, cap) {
    cap = cap || LIMITS.maxStates;
    const start = initial(prog, decl); const seen = new Map(); const outcomes = new Map();
    // Every state gets a number (its position in `queue`); edges[i] lists the states reachable in one step.
    // The edges let us find states from which NO schedule can ever finish (endless loops, see below).
    const queue = [{ st: start, path: [] }]; seen.set(keyOf(start), 0); let truncated = false, head = 0, count = 1;
    const edges = [], terminal = [];
    while (head < queue.length) {
      const id = head; const { st, path } = queue[head++]; edges[id] = [];
      const term = classify(prog, st, decl);
      if (term) {
        terminal[id] = true;
        let key, label, bad = false;
        if (term.kind === 'violation') { key = 'V:' + term.v.kind + ':' + term.v.msg; label = term.v.msg; bad = true; }
        else if (term.kind === 'livelock') { key = 'L'; label = term.v.msg; bad = true; }
        else if (term.kind === 'deadlock') { key = 'D'; label = 'DEADLOCK: ' + term.waits.map((w) => w.id + ' waits on ' + w.on + (w.holder ? ' (held by ' + w.holder + ')' : '')).join('; '); bad = true; }
        else { key = 'F:' + JSON.stringify(st.vars) + st.buf.count; label = 'Finished normally. Shared values: ' + (Object.keys(st.vars).map((k) => k + '=' + st.vars[k]).join(', ') || 'none') + (st.buf.cap ? '; buffer holds ' + st.buf.count : '') + '.'; }
        if (!outcomes.has(key)) outcomes.set(key, { label, bad, kind: term.kind, path, hits: 0 });
        outcomes.get(key).hits++;
        continue;
      }
      for (const ti of runnable(st)) {
        const r = step(prog, st, ti); const k = keyOf(r.state);
        if (seen.has(k)) { edges[id].push(seen.get(k)); continue; }
        if (count >= cap) { truncated = true; continue; }
        seen.set(k, count); edges[id].push(count); count++;
        queue.push({ st: r.state, path: path.concat(prog[ti].id) });
      }
    }
    // Endless loops. A program with loops can wander forever without any thread being "blocked": both
    // Peterson-style threads spinning at their wait loops, say. A state is TRAPPED when no schedule at all leads
    // from it to a final state. We find them by walking the edges backwards from every final state: whatever is
    // not reached can never finish. (Only trusted when the search was not cut off.)
    let trapped = 0, firstTrapped = -1;
    if (!truncated) {
      const rev = queue.map(() => []);
      edges.forEach((out, i) => out.forEach((j) => rev[j].push(i)));
      const ok = new Array(queue.length).fill(false), stack = [];
      terminal.forEach((t, i) => { if (t) { ok[i] = true; stack.push(i); } });
      while (stack.length) { const i = stack.pop(); rev[i].forEach((j) => { if (!ok[j]) { ok[j] = true; stack.push(j); } }); }
      ok.forEach((v, i) => { if (!v) { trapped++; if (firstTrapped < 0) firstTrapped = i; } });
    }
    if (trapped) {
      const q = queue[firstTrapped];
      const where = runnable(q.st).map((i) => prog[i].id + ' is at "' + (prog[i].code[q.st.threads[i].pc] || {}).text + '"').join('; ');
      outcomes.set('T', { label: 'STUCK FOREVER (endless loop): after this schedule no sequence of steps can ever finish the program. ' + where + '. Nobody is blocked, so this is not a deadlock: the threads keep running and make no progress.', bad: true, kind: 'stuck', path: q.path, hits: trapped });
    }
    const list = Array.from(outcomes.values()).sort((a, b) => (b.bad - a.bad) || a.path.length - b.path.length);
    return { states: count, truncated, trapped, outcomes: list };
  }

  /* ---------- presets (just editable text) ---------- */
  // philosophers(n, variant): generate the program text for n dining philosophers. Variants change only
  // how forks are acquired: naive (left then right: can deadlock), ordered (lower-numbered fork first),
  // room (at most n-1 may try, via a semaphore), asym (odd philosophers reach right first).
  function philosophers(n, variant) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = 'F' + i, b = 'F' + ((i + 1) % n);
      let first = a, second = b;
      if (variant === 'ordered') { const lo = Math.min(i, (i + 1) % n); first = 'F' + lo; second = 'F' + Math.max(i, (i + 1) % n); }
      if (variant === 'asym' && i % 2 === 1) { first = b; second = a; }
      out.push('thread PH' + i);
      if (variant === 'room') out.push('  wait room');
      out.push('  work think', '  lock ' + first, '  lock ' + second, '  work eat', '  unlock ' + second, '  unlock ' + first);
      if (variant === 'room') out.push('  signal room');
    }
    return out.join('\n');
  }
  const forks = (n) => Array.from({ length: n }, (_, i) => 'F' + i).join(', ');
  // Example programs. They are ordinary editable text: change any line and re-run.
  const PRESETS = [
    { id: 'race', name: 'Race condition: two threads add 1 to X', vars: 'X=0', sems: '', muts: '', cap: 0, expect: 'X=2',
      prog: 'thread T1\n  load r X\n  add r 1\n  store X r\n\nthread T2\n  load r X\n  add r 1\n  store X r',
      note: 'X++ is really three steps. If both threads load before either stores, one update is lost. Use Explore to see every possible result.' },
    { id: 'mutex', name: 'Race fixed with a mutex', vars: 'X=0', sems: '', muts: 'M', cap: 0, expect: 'X=2',
      prog: 'thread T1\n  lock M\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  unlock M\n\nthread T2\n  lock M\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  unlock M',
      note: 'The mutex makes the read-modify-write one indivisible unit. Explore now shows a single outcome.' },
    { id: 'pc', name: 'Producer–consumer (bounded buffer, correct)', vars: '', sems: 'empty=2, full=0', muts: 'M', cap: 2, expect: '',
      prog: 'thread Producer x3\n  wait empty\n  lock M\n  put\n  unlock M\n  signal full\n\nthread Consumer x3\n  wait full\n  lock M\n  get\n  unlock M\n  signal empty',
      note: 'empty counts free slots, full counts items. Wait on the counting semaphore first, then take the mutex.' },
    { id: 'pcbad', name: 'Producer–consumer with the wrong order (deadlock)', vars: '', sems: 'empty=1, full=0', muts: 'M', cap: 1, expect: '',
      prog: 'thread Producer x2\n  lock M\n  wait empty\n  put\n  signal full\n  unlock M\n\nthread Consumer x2\n  wait full\n  lock M\n  get\n  unlock M\n  signal empty',
      note: 'The producer holds the mutex while waiting for a free slot, so the consumer can never take the mutex to free one. Explore finds the deadlock.' },
    { id: 'dp3', name: 'Dining philosophers: naive (can deadlock)', vars: '', sems: '', muts: forks(3), cap: 0, expect: '', prog: philosophers(3, 'naive'),
      note: 'Everyone grabs the left fork, then wants the right. If all grab left first, nobody can eat.' },
    { id: 'dp3o', name: 'Dining philosophers: ordered forks', vars: '', sems: '', muts: forks(3), cap: 0, expect: '', prog: philosophers(3, 'ordered'),
      note: 'Always pick up the lower-numbered fork first. This breaks the circular-wait condition.' },
    { id: 'dp3r', name: 'Dining philosophers: at most N−1 seated', vars: '', sems: 'room=2', muts: forks(3), cap: 0, expect: '', prog: philosophers(3, 'room'),
      note: 'Only two of three may try to eat at once, so someone always gets both forks.' },
    { id: 'dp3a', name: 'Dining philosophers: asymmetric', vars: '', sems: '', muts: forks(3), cap: 0, expect: '', prog: philosophers(3, 'asym'),
      note: 'Odd philosophers pick up the right fork first. Not everyone reaches for the same side, so the cycle cannot form.' },
    { id: 'rw', name: 'Readers–writers (readers preferred)', vars: 'rc=0', sems: 'wrt=1', muts: 'M', cap: 0, expect: '',
      prog: 'thread R1\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread R2\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread W\n  wait wrt\n  enter write\n  leave write\n  signal wrt',
      note: 'The first reader locks writers out, the last reader lets them in. Many readers can overlap. Because readers keep priority, a steady stream of readers can starve the writer.' },
    { id: 'rwbad', name: 'Readers–writers: writer forgets to wait (broken)', vars: 'rc=0', sems: 'wrt=1', muts: 'M', cap: 0, expect: '',
      prog: 'thread R1\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread W\n  enter write\n  leave write',
      note: 'Without wait/signal around its write, the writer can overlap a reader. Explore finds the violation.' },
    { id: 'tas', name: 'Test-and-set spinlock protects X++', vars: 'X=0, L=0', sems: '', muts: '', cap: 0, expect: 'X=2',
      prog: 'thread T1\n  spin L          # acquire: test-and-set, keep trying while L is 1\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set L 0         # release\n\nthread T2\n  spin L          # acquire: test-and-set, keep trying while L is 1\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set L 0         # release',
      note: 'spin L is an atomic test-and-set in a loop. While T1 holds L, T2 keeps spinning: it stays READY and burns steps, unlike a blocked thread. Explore proves X is always 2.' },
    { id: 'tasone', name: 'Test-and-set, one attempt (no spinning)', vars: 'L=0', sems: '', muts: '', cap: 0, expect: '',
      prog: 'thread T1\n  tas r L         # atomically: r = L and L = 1\n  if r == 0       # r was 0: the lock was free and is now ours\n  enter cs\n  work critical section\n  leave cs\n\nthread T2\n  tas r L         # atomically: r = L and L = 1\n  if r == 0       # r was 0: the lock was free and is now ours\n  enter cs\n  work critical section\n  leave cs',
      note: 'tas reads the old value and writes 1 in ONE step, so exactly one thread sees 0 and enters. The other skips the critical section. Explore finds no violation.' },
    { id: 'tasbad', name: 'Check-then-set lock (not atomic, broken)', vars: 'L=0', sems: '', muts: '', cap: 0, expect: '',
      prog: 'thread T1\n  load r L        # step 1: look at the lock\n  if r == 0       # step 2: it looks free ...\n  enter cs\n  set L 1         # step 3: ... so take it (too late!)\n  work critical section\n  leave cs\n\nthread T2\n  load r L        # step 1: look at the lock\n  if r == 0       # step 2: it looks free ...\n  enter cs\n  set L 1         # step 3: ... so take it (too late!)\n  work critical section\n  leave cs',
      note: 'The same idea with the check and the set as two separate steps. Both threads can read L = 0 before either sets it, so both enter. Explore finds the broken mutual exclusion: this is why test-and-set must be a single atomic instruction.' },
    { id: 'cas', name: 'Compare-and-swap: a failed update is detected', vars: 'X=0', sems: '', muts: '', cap: 0, expect: '',
      prog: 'thread T1\n  load a X\n  load b X\n  add b 1\n  cas ok X a b     # ok = 1 only if X is still what we read\n\nthread T2\n  load a X\n  load b X\n  add b 1\n  cas ok X a b     # ok = 1 only if X is still what we read',
      note: 'cas only writes if X still equals what the thread read. If the other thread got in first, the CAS fails and ok = 0, so the update is NOT silently lost (compare the race example). Real code retries in a loop; this machine has no loops, so X = 1 here means one thread saw ok = 0.' },
    { id: 'rdv', name: 'Rendezvous: neither passes before both arrive', vars: 'X=0, bad=0', sems: 'a=0, b=0', muts: '', cap: 0, expect: 'bad=0',
      prog: 'thread T1\n  work part 1\n  inc X\n  signal a\n  wait b\n  if X < 2\n  set bad 1\n  work part 2\n\nthread T2\n  work part 1\n  inc X\n  signal b\n  wait a\n  if X < 2\n  set bad 1\n  work part 2',
      note: 'Each thread signals its own semaphore, then waits for the other\'s. After the meeting X must be 2; if either thread could pass early, bad would become 1.' },
    { id: 'rdvbad', name: 'Rendezvous with both waiting first (deadlock)', vars: '', sems: 'a=0, b=0', muts: '', cap: 0, expect: '',
      prog: 'thread T1\n  wait b\n  signal a\n  work part 2\n\nthread T2\n  wait a\n  signal b\n  work part 2',
      note: 'Both threads wait before signalling, so each waits for a signal that only the other could send. Explore finds the deadlock. Signal first, then wait.' },
    { id: 'barrier', name: 'Barrier for three threads (turnstile)', vars: 'count=0, bad=0', sems: 'turn=0', muts: 'M', cap: 0, expect: 'bad=0',
      prog: 'thread T1\n  work arrive\n  lock M\n  inc count\n  unlock M\n  if count == 3\n  signal turn      # the last one in opens the turnstile\n  wait turn\n  signal turn      # each thread lets the next one through\n  if count < 3\n  set bad 1        # would mean someone passed too early\n  work after the barrier\n\nthread T2\n  work arrive\n  lock M\n  inc count\n  unlock M\n  if count == 3\n  signal turn      # the last one in opens the turnstile\n  wait turn\n  signal turn      # each thread lets the next one through\n  if count < 3\n  set bad 1        # would mean someone passed too early\n  work after the barrier\n\nthread T3\n  work arrive\n  lock M\n  inc count\n  unlock M\n  if count == 3\n  signal turn      # the last one in opens the turnstile\n  wait turn\n  signal turn      # each thread lets the next one through\n  if count < 3\n  set bad 1        # would mean someone passed too early\n  work after the barrier',
      note: 'Everyone counts in; the last arrival opens the turnstile and each thread lets the next one through. bad stays 0 in every interleaving, so nobody passes early.' },
    { id: 'barber', name: 'Sleeping barber (two customers, no balking)', vars: 'waiting=0', sems: 'cust=0, barb=0', muts: 'M', cap: 0, expect: 'waiting=0',
      prog: 'thread Barber x2\n  wait cust\n  lock M\n  dec waiting\n  unlock M\n  signal barb\n  work cut hair\n\nthread C1\n  lock M\n  inc waiting\n  unlock M\n  signal cust\n  wait barb\n  work get a haircut\n\nthread C2\n  lock M\n  inc waiting\n  unlock M\n  signal cust\n  wait barb\n  work get a haircut',
      note: 'The barber sleeps on the cust semaphore until a customer signals. Each customer then waits on barb for a haircut. The barber repeats his routine twice (x2). Customers never leave without a cut here, because this machine cannot skip several lines at once.' },
    { id: 'pinv', name: 'Priority inversion (use the Manual scheduler)', vars: '', sems: '', muts: 'M', cap: 0, expect: '',
      prog: 'thread Low\n  lock M\n  work low: using the shared resource\n  work low: still using it\n  unlock M\n\nthread Mid\n  work mid: busy 1\n  work mid: busy 2\n  work mid: busy 3\n  work mid: busy 4\n\nthread High\n  work high: starts\n  lock M\n  work high: uses the resource\n  unlock M',
      note: 'Low, Mid and High are priorities in your head (this machine has no priorities). Pick Low until it has locked M, then High until it blocks, then keep picking Mid: the high-priority thread is stuck behind a medium one that never touches the lock. Priority inheritance would let Low run at High\'s priority until it unlocks.' },
    { id: 'peterson', name: 'Peterson: two threads, software-only mutual exclusion', vars: 'f0=0, f1=0, turn=0, X=0', sems: '', muts: '', cap: 0, expect: 'X=4',
      prog: 'thread P0 x2\n  set f0 1          # I want in\n  set turn 1        # ...but you go first if you also want in\n wait:\n  if f1 == 1        # both conditions must hold to keep waiting\n  if turn == 1\n  goto wait\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set f0 0          # I am done' + '\n\n' + 'thread P1 x2\n  set f1 1          # I want in\n  set turn 0        # ...but you go first if you also want in\n wait:\n  if f0 == 1        # both conditions must hold to keep waiting\n  if turn == 0\n  goto wait\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set f1 0          # I am done',
      note: 'Each thread raises its flag, then politely gives the other the turn. A thread waits only while the other wants in AND it is the other\'s turn. Explore proves mutual exclusion holds in every interleaving, using nothing but ordinary reads and writes. Try deleting a "set turn" line to see what breaks.' },
    { id: 'peterbad', name: 'Flags only, no turn variable (stuck forever)', vars: 'f0=0, f1=0, X=0', sems: '', muts: '', cap: 0, expect: '',
      prog: 'thread P0 x1\n  set f0 1          # I want in\n wait:\n  if f1 == 1        # both conditions must hold to keep waiting\n  goto wait\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set f0 0          # I am done' + '\n\n' + 'thread P1 x1\n  set f1 1          # I want in\n wait:\n  if f0 == 1        # both conditions must hold to keep waiting\n  goto wait\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set f1 0          # I am done',
      note: 'Without the turn variable both threads can raise their flags and then each waits for the other\'s flag to drop. Nobody is blocked, both keep looping, and nothing ever happens. Explore reports the STUCK FOREVER outcome (this is livelock, not deadlock).' },
    { id: 'alternate', name: 'Strict alternation (safe, but no progress)', vars: 'turn=0, X=0', sems: '', muts: '', cap: 0, expect: '',
      prog: 'thread P0 x3\n  wait0:\n  if turn == 1\n  goto wait0\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set turn 1\n\nthread P1 x1\n  wait1:\n  if turn == 0\n  goto wait1\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set turn 0',
      note: 'Threads simply take turns. Mutual exclusion holds, but P0 wants to enter three times and P1 only once: after P1 is gone, P0 waits for a turn that will never come. Progress is violated: nobody else is in the critical section, yet P0 cannot enter. Explore reports STUCK FOREVER.' },
    { id: 'dekker', name: 'Dekker: the first correct software solution', vars: 'f0=0, f1=0, turn=0, X=0', sems: '', muts: '', cap: 0, expect: 'X=2',
      prog: 'thread P0\n  set f0 1\n again:\n  if f1 == 0\n  goto crit        # the other does not want in: go\n  if turn == 0\n  goto again       # it is my turn: keep my flag up and wait\n  set f0 0          # not my turn: back off ...\n backoff:\n  if turn == 1\n  goto backoff\n  set f0 1          # ... until it is, then try again\n  goto again\n crit:\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set turn 1        # hand the turn over\n  set f0 0' + '\n\n' + 'thread P1\n  set f1 1\n again:\n  if f0 == 0\n  goto crit        # the other does not want in: go\n  if turn == 1\n  goto again       # it is my turn: keep my flag up and wait\n  set f1 0          # not my turn: back off ...\n backoff:\n  if turn == 0\n  goto backoff\n  set f1 1          # ... until it is, then try again\n  goto again\n crit:\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set turn 0        # hand the turn over\n  set f1 0',
      note: 'Like Peterson, but a thread that finds the other wanting in and the turn not its own backs off (lowers its flag) so the other can proceed. Explore checks all interleavings.' },
    { id: 'bakery', name: 'Lamport bakery (two threads)', vars: 'c0=0, c1=0, n0=0, n1=0, X=0', sems: '', muts: '', cap: 0, expect: 'X=2',
      prog: "thread P0\n  set c0 1          # I am choosing a ticket\n  load m n1\n  add m 1\n  store n0 m      # my ticket = the other's ticket + 1\n  set c0 0\n w1:\n  if c1 == 1        # wait while the other is choosing\n  goto w1\n w2:\n  if n1 != 0        # wait while the other holds a smaller ticket\n  if n1 < n0\n  goto w2\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set n0 0         # hand the ticket back" + '\n\n' + "thread P1\n  set c1 1          # I am choosing a ticket\n  load m n0\n  add m 1\n  store n1 m      # my ticket = the other's ticket + 1\n  set c1 0\n w1:\n  if c0 == 1        # wait while the other is choosing\n  goto w1\n w2:\n  if n0 != 0        # wait while the other holds a smaller ticket\n  if n0 <= n1\n  goto w2\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set n1 0         # hand the ticket back",
      note: 'Take a ticket one higher than the other\'s, then wait while the other holds a smaller ticket (ties go to the lower thread id). The choosing flag stops a thread from comparing against a ticket that is still being picked.' },
    { id: 'bakerybad', name: 'Bakery without the choosing flag (broken)', vars: 'n0=0, n1=0, X=0', sems: '', muts: '', cap: 0, expect: '',
      prog: "thread P0\n  load m n1\n  add m 1\n  store n0 m      # my ticket = the other's ticket + 1\n w2:\n  if n1 != 0        # wait while the other holds a smaller ticket\n  if n1 < n0\n  goto w2\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set n0 0         # hand the ticket back" + '\n\n' + "thread P1\n  load m n0\n  add m 1\n  store n1 m      # my ticket = the other's ticket + 1\n w2:\n  if n0 != 0        # wait while the other holds a smaller ticket\n  if n0 <= n1\n  goto w2\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  set n1 0         # hand the ticket back",
      note: 'Without the choosing flag, P1 can read n0 while P0 is still between reading n1 and writing its own ticket. P1 sees "no ticket" and walks in, then P0 gets an equal ticket and also walks in. Explore finds the broken mutual exclusion.' },
    { id: 'moncorrect', name: 'Monitor: bounded buffer with while loops (correct)', vars: 'count=0', sems: '', muts: 'M', conds: 'notFull, notEmpty', mon: 'mesa', cap: 2, expect: 'count=0',
      prog: 'thread Producer x3\n  lock M\n chk:\n  if count < 2\n  goto ok            # room: go on\n  cwait notFull M   # full: sleep (this releases M)\n  goto chk          # woken: CHECK AGAIN (a while loop)\n ok:\n  put\n  inc count\n  csignal notEmpty\n  unlock M' + '\n\n' + 'thread Consumer x3\n  lock M\n chk:\n  if count > 0\n  goto ok            # an item: go on\n  cwait notEmpty M  # empty: sleep (this releases M)\n  goto chk          # woken: CHECK AGAIN (a while loop)\n ok:\n  get\n  dec count\n  csignal notFull\n  unlock M',
      note: 'The monitor lock M guards the buffer. A thread that cannot proceed sleeps on a condition variable (cwait releases M atomically). Under Mesa rules a woken thread must re-check its condition, hence "chk: ... goto chk". Explore shows no bad ending.' },
    { id: 'monif', name: 'Monitor with if instead of while (breaks under Mesa)', vars: 'count=0', sems: '', muts: 'M', conds: 'notFull, notEmpty', mon: 'mesa', cap: 2, expect: '',
      prog: 'thread Producer x2\n  lock M\n  put\n  inc count\n  csignal notEmpty\n  unlock M\n\nthread C1\n  lock M\n  if count == 0\n  cwait notEmpty M   # only checked ONCE\n  get\n  dec count\n  unlock M\n\nthread C2\n  lock M\n  if count == 0\n  cwait notEmpty M   # only checked ONCE\n  get\n  dec count\n  unlock M',
      note: 'Under Mesa rules the signaller keeps running, so another consumer can take the item before the sleeper wakes; the sleeper then takes from an EMPTY buffer. Explore finds the underflow. Switch "Signal rules" to Hoare (the sleeper gets the monitor immediately) and it becomes correct, which is exactly why Hoare allows if but Mesa needs while.' },
    { id: 'monlost', name: 'Signal sent before anyone waits (lost wake-up)', vars: '', sems: '', muts: 'M', conds: 'go', mon: 'mesa', cap: 0, expect: '',
      prog: 'thread Waiter\n  lock M\n  cwait go M          # sleeps no matter what\n  unlock M\n\nthread Signaller\n  lock M\n  csignal go          # nobody asleep yet: this is thrown away\n  unlock M',
      note: 'Condition variables have no memory. If the signal comes first it is lost and the waiter sleeps forever. Explore finds the deadlock. The fix is a shared flag the waiter checks first (next example).' },
    { id: 'monlostfix', name: 'Lost wake-up fixed with a flag', vars: 'ready=0', sems: '', muts: 'M', conds: 'go', mon: 'mesa', cap: 0, expect: 'ready=1',
      prog: 'thread Waiter\n  lock M\n chk:\n  if ready == 1\n  goto ok\n  cwait go M\n  goto chk\n ok:\n  unlock M\n\nthread Signaller\n  lock M\n  set ready 1         # change the state FIRST ...\n  csignal go          # ... then signal\n  unlock M',
      note: 'The state lives in a variable, the condition variable only wakes sleepers. Whichever thread runs first, the waiter either sees ready = 1 or is woken by the signal.' },
    { id: 'monbcast', name: 'Broadcast: open a gate for three waiters', vars: 'open=0', sems: '', muts: 'M', conds: 'gate', mon: 'mesa', cap: 0, expect: 'open=1',
      prog: 'thread W1\n  lock M\n chk:\n  if open == 1\n  goto ok\n  cwait gate M\n  goto chk\n ok:\n  unlock M\n\nthread W2\n  lock M\n chk:\n  if open == 1\n  goto ok\n  cwait gate M\n  goto chk\n ok:\n  unlock M\n\nthread Opener\n  lock M\n  set open 1\n  cbroadcast gate\n  unlock M',
      note: 'cbroadcast wakes every sleeper. Change it to csignal and Explore shows a deadlock: only one waiter is woken, the other sleeps forever.' }
  ];

  NS.sync = { LIMITS, PRESETS, parseDecls, parseProgram, initial, step, run, explore, runnable, classify, philosophers };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.sync;
})(typeof window !== 'undefined' ? window : globalThis);
