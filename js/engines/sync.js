/* Synchronization engine: a tiny concurrent machine. Threads run small programs against shared variables,
   semaphores, mutexes and a bounded buffer. A scheduler picks which runnable thread executes the next instruction.
   Everything (races, deadlocks, violations) emerges from the interleaving; nothing is scripted. Pure logic. */
(function (root) {
  "use strict";
  const NS = (root.OSViz = root.OSViz || {});
  // Caps: threads, instructions per thread, repeat count, steps in one run, states in the explorer.
  const LIMITS = {
    maxThreads: 6,
    maxInstr: 40,
    maxRounds: 5,
    maxSteps: 400,
    maxStates: 30000,
    maxNames: 12,
  };
  // Regions a thread can 'enter': cs (exclusive critical section), read (shared) and write (exclusive).
  const TAGS = ["cs", "read", "write"];
  // Comparison operators allowed in `if X == 1`.
  const CMP = {
    "==": (a, b) => a === b,
    "!=": (a, b) => a !== b,
    ">": (a, b) => a > b,
    "<": (a, b) => a < b,
    ">=": (a, b) => a >= b,
    "<=": (a, b) => a <= b,
  };

  // Seeded random generator so the Random scheduler is reproducible.
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- parsing ---------- */
  // parseDecls: read the declaration boxes (variables, semaphores, mutexes, buffer size, expected result)
  // and return readable errors: bad syntax, duplicate or clashing names, negative semaphores.
  function parseDecls(d) {
    const errors = [];
    const list = (txt, kind, withVal) => {
      const out = {};
      String(txt || "")
        .split(/[\s,;]+/)
        .filter(Boolean)
        .forEach((tok) => {
          const m = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(-?\d+))?$/);
          if (!m) {
            errors.push(
              kind +
                ' "' +
                tok +
                '" is not valid.' +
                (withVal
                  ? " Write NAME=value, for example X=0."
                  : " Write a name, for example M."),
            );
            return;
          }
          if (!withVal && m[2] != null) {
            errors.push(kind + ' "' + tok + '" should be just a name.');
            return;
          }
          const name = m[1];
          if (out[name] != null)
            errors.push(kind + " " + name + " is declared twice.");
          out[name] = withVal ? (m[2] != null ? parseInt(m[2], 10) : 0) : true;
        });
      if (Object.keys(out).length > LIMITS.maxNames)
        errors.push("At most " + LIMITS.maxNames + " " + kind + "s.");
      return out;
    };
    const vars = list(d.vars, "Variable", true),
      sems = list(d.sems, "Semaphore", true),
      muts = list(d.muts, "Mutex", false);
    Object.keys(sems).forEach((s) => {
      if (sems[s] < 0) errors.push("Semaphore " + s + " cannot start below 0.");
    });
    const cap = d.cap === "" || d.cap == null ? 0 : Number(d.cap);
    if (!Number.isInteger(cap) || cap < 0 || cap > 9)
      errors.push(
        "Buffer size must be a whole number from 0 to 9 (0 means no buffer).",
      );
    const expect = {};
    String(d.expect || "")
      .split(/[\s,;]+/)
      .filter(Boolean)
      .forEach((tok) => {
        const m = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)=(-?\d+)$/);
        if (!m)
          errors.push('Expected result "' + tok + '" is not valid. Write X=2.');
        else if (!(m[1] in vars))
          errors.push(
            "Expected result mentions " +
              m[1] +
              ", which is not a declared variable.",
          );
        else expect[m[1]] = parseInt(m[2], 10);
      });
    const names = Object.keys(vars).concat(
      Object.keys(sems),
      Object.keys(muts),
    );
    names.forEach((n, i) => {
      if (names.indexOf(n) !== i)
        errors.push("The name " + n + " is used for more than one thing.");
    });
    return { errors, decl: { vars, sems, muts, cap, expect } };
  }

  // parseProgram: turn the program text into threads. 'thread T1 x3' starts a thread (x3 = repeat its
  // program 3 times); the lines after it are its instructions. Every instruction is checked against the
  // declarations (is X a declared variable? is S a semaphore?) and bad lines get a line-numbered error.
  function parseProgram(text, decl) {
    const errors = [];
    const threads = [];
    let cur = null;
    String(text)
      .split("\n")
      .forEach((raw, ln) => {
        const line = raw.replace(/#.*$/, "").trim();
        if (!line) return;
        const at = "Line " + (ln + 1) + ": ";
        const tm = line.match(
          /^thread\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+x(\d+))?$/i,
        );
        if (tm) {
          if (threads.some((t) => t.id === tm[1]))
            errors.push(at + "thread " + tm[1] + " is defined twice.");
          const rounds = tm[2] ? parseInt(tm[2], 10) : 1;
          if (rounds < 1 || rounds > LIMITS.maxRounds)
            errors.push(
              at +
                "repeat count must be 1 to " +
                LIMITS.maxRounds +
                ' (write "thread ' +
                tm[1] +
                ' x3").',
            );
          cur = { id: tm[1], rounds, code: [], lines: [] };
          threads.push(cur);
          return;
        }
        if (!cur) {
          errors.push(at + 'start with a line like "thread T1".');
          return;
        }
        const w = line.split(/\s+/);
        const op = w[0].toLowerCase();
        // Arity check: an instruction must have exactly the expected number of operands.
        const need = (n, usage) => {
          if (w.length !== n + 1) {
            errors.push(at + '"' + line + '" should look like: ' + usage);
            return false;
          }
          return true;
        };
        const isVar = (n) => n in decl.vars,
          reg = (n) =>
            /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) &&
            !(n in decl.vars) &&
            !(n in decl.sems) &&
            !(n in decl.muts);
        const num = (s) => /^-?\d+$/.test(s);
        // Decode one instruction. The instruction set is deliberately tiny, so that races are visible:
        //   load r X / add r k / store X r   non-atomic read-modify-write through a private register
        //   inc X / dec X / set X k          atomic updates of a shared variable
        //   wait S / signal S                counting semaphore (P and V)
        //   lock M / unlock M                mutex
        //   put / get                        bounded buffer (violations if full / empty)
        //   enter / leave cs|read|write      mark a critical region so mutual exclusion can be checked
        //   if X == k                        the NEXT line runs only if the condition holds
        //   work label                       a step with no effect (thinking, eating, ...)
        let ins = null;
        if (op === "load") {
          if (need(2, "load r X")) {
            if (!reg(w[1]))
              errors.push(
                at +
                  w[1] +
                  " is not a valid register name (it clashes with a shared name).",
              );
            else if (!isVar(w[2]))
              errors.push(at + w[2] + " is not a declared shared variable.");
            else ins = { op, r: w[1], x: w[2] };
          }
        } else if (op === "add") {
          if (need(2, "add r 1")) {
            if (!reg(w[1]))
              errors.push(at + w[1] + " is not a valid register name.");
            else if (!num(w[2]))
              errors.push(at + '"' + w[2] + '" must be a whole number.');
            else ins = { op, r: w[1], k: parseInt(w[2], 10) };
          }
        } else if (op === "store") {
          if (need(2, "store X r")) {
            if (!isVar(w[1]))
              errors.push(at + w[1] + " is not a declared shared variable.");
            else if (!reg(w[2]))
              errors.push(at + w[2] + " is not a valid register name.");
            else ins = { op, x: w[1], r: w[2] };
          }
        } else if (op === "set") {
          if (need(2, "set X 5")) {
            if (!isVar(w[1]))
              errors.push(at + w[1] + " is not a declared shared variable.");
            else if (!num(w[2]))
              errors.push(at + '"' + w[2] + '" must be a whole number.');
            else ins = { op, x: w[1], k: parseInt(w[2], 10) };
          }
        } else if (op === "inc" || op === "dec") {
          if (need(1, op + " X")) {
            if (!isVar(w[1]))
              errors.push(at + w[1] + " is not a declared shared variable.");
            else ins = { op, x: w[1] };
          }
        } else if (op === "wait" || op === "signal") {
          if (need(1, op + " S")) {
            if (!(w[1] in decl.sems))
              errors.push(at + w[1] + " is not a declared semaphore.");
            else ins = { op, s: w[1] };
          }
        } else if (op === "lock" || op === "unlock") {
          if (need(1, op + " M")) {
            if (!(w[1] in decl.muts))
              errors.push(at + w[1] + " is not a declared mutex.");
            else ins = { op, m: w[1] };
          }
        } else if (op === "put" || op === "get") {
          if (need(0, op)) {
            if (!decl.cap)
              errors.push(
                at +
                  '"' +
                  op +
                  '" needs a buffer. Set the buffer size above 0.',
              );
            else ins = { op };
          }
        } else if (op === "enter" || op === "leave") {
          if (need(1, op + " cs  (or read / write)")) {
            if (!TAGS.includes(w[1].toLowerCase()))
              errors.push(at + "region must be cs, read or write.");
            else ins = { op, tag: w[1].toLowerCase() };
          }
        } else if (op === "if") {
          if (need(3, "if X == 1  (then the NEXT line runs only if true)")) {
            if (!isVar(w[1]))
              errors.push(at + w[1] + " is not a declared shared variable.");
            else if (!CMP[w[2]])
              errors.push(at + "comparison must be one of == != > < >= <=.");
            else if (!num(w[3]))
              errors.push(at + '"' + w[3] + '" must be a whole number.');
            else ins = { op, x: w[1], cmp: w[2], k: parseInt(w[3], 10) };
          }
        } else if (op === "work")
          ins = { op, label: w.slice(1).join(" ") || "work" };
        else
          errors.push(
            at +
              'unknown instruction "' +
              w[0] +
              '". Use: load add store set inc dec wait signal lock unlock put get enter leave if work.',
          );
        if (ins) {
          ins.text = line;
          cur.code.push(ins);
        } else cur.code.push({ op: "work", label: "?", text: line });
      });
    if (!threads.length)
      errors.push('Add at least one thread, for example "thread T1".');
    if (threads.length > LIMITS.maxThreads)
      errors.push("At most " + LIMITS.maxThreads + " threads.");
    threads.forEach((t) => {
      if (!t.code.length)
        errors.push("Thread " + t.id + " has no instructions.");
      if (t.code.length > LIMITS.maxInstr)
        errors.push(
          "Thread " +
            t.id +
            " is longer than " +
            LIMITS.maxInstr +
            " instructions.",
        );
      if (t.code.length && t.code[t.code.length - 1].op === "if")
        errors.push(
          "Thread " + t.id + ': an "if" needs an instruction after it.',
        );
    });
    return { errors, threads };
  }

  /* ---------- machine ---------- */
  // initial: the starting machine state: every thread at instruction 0 and ready, shared variables and
  // semaphores at their declared values, mutexes free, buffer empty, nobody in any region.
  function initial(prog, decl) {
    const sems = {};
    Object.keys(decl.sems).forEach((s) => {
      sems[s] = { v: decl.sems[s], q: [] };
    });
    const muts = {};
    Object.keys(decl.muts).forEach((m) => {
      muts[m] = { owner: null, q: [] };
    });
    return {
      threads: prog.map((t) => ({
        pc: 0,
        regs: {},
        state: "ready",
        on: null,
        left: t.rounds,
      })),
      vars: Object.assign({}, decl.vars),
      sems,
      muts,
      buf: { count: 0, cap: decl.cap },
      occ: { cs: [], read: [], write: [] },
      violation: null,
    };
  }
  // clone: every step works on a copy, so frames never change after they are created.
  const clone = (s) => JSON.parse(JSON.stringify(s));

  // normalize: after a thread's pc moves past its last instruction, start its next repeat or mark it done.
  function normalize(th, len) {
    if (th.pc >= len) {
      th.left -= 1;
      if (th.left > 0) th.pc = 0;
      else {
        th.state = "done";
        th.on = null;
      }
    }
  }
  // runnable(state): indices of threads that can execute right now (blocked and finished threads cannot).
  const runnable = (st) =>
    st.threads
      .map((t, i) => (t.state === "ready" ? i : -1))
      .filter((i) => i >= 0);

  // violate: record the first correctness failure (broken exclusion, overflow, misuse, ...).
  function violate(ns, ti, prog, kind, msg) {
    ns.violation = { kind, msg, thread: prog[ti].id };
  }

  // step: execute ONE instruction of thread ti and return { state, ev }. This is the whole machine.
  // The scheduler (or you) chooses ti; everything else - races, blocking, deadlock - follows from the
  // instructions. Blocking instructions leave pc where it is and queue the thread.
  function step(prog, st, ti) {
    const ns = clone(st);
    const th = ns.threads[ti];
    const T = prog[ti];
    const ins = T.code[th.pc];
    const id = T.id;
    const len = T.code.length;
    const ev = { ti, id, pc: th.pc, text: ins.text, note: "", blocked: false };
    // wake(tj): unblock a waiting thread. The permit / lock is handed over directly, so the woken thread
    // moves *past* its wait/lock instruction (this keeps semaphore queues FIFO and avoids lost wake-ups).
    const wake = (tj, why) => {
      const t2 = ns.threads[tj];
      t2.state = "ready";
      t2.on = null;
      t2.pc += 1;
      normalize(t2, prog[tj].code.length);
      return prog[tj].id + " " + why;
    };
    // advance = how far pc moves after this instruction (0 when blocked, 2 when an `if` skips a line).
    let advance = 1;
    switch (ins.op) {
      // load/add/store: the classic non-atomic update. Another thread can run between these three steps.
      case "load":
        th.regs[ins.r] = ns.vars[ins.x];
        ev.note =
          "Copy " +
          ins.x +
          " (" +
          ns.vars[ins.x] +
          ") into private register " +
          ins.r +
          ".";
        break;
      case "add":
        th.regs[ins.r] = (th.regs[ins.r] || 0) + ins.k;
        ev.note =
          ins.r + " becomes " + th.regs[ins.r] + " (private to " + id + ").";
        break;
      case "store":
        ns.vars[ins.x] = th.regs[ins.r] || 0;
        ev.note =
          "Write register " +
          ins.r +
          " (" +
          (th.regs[ins.r] || 0) +
          ") to shared " +
          ins.x +
          ".";
        break;
      case "set":
        ns.vars[ins.x] = ins.k;
        ev.note = ins.x + " = " + ins.k + ".";
        break;
      case "inc":
        ns.vars[ins.x] += 1;
        ev.note = "Atomic: " + ins.x + " becomes " + ns.vars[ins.x] + ".";
        break;
      case "dec":
        ns.vars[ins.x] -= 1;
        ev.note = "Atomic: " + ins.x + " becomes " + ns.vars[ins.x] + ".";
        break;
      // wait (P): if the semaphore is positive take one; otherwise block and join its FIFO queue.
      case "wait": {
        const s = ns.sems[ins.s];
        if (s.v > 0) {
          s.v -= 1;
          ev.note =
            ins.s + " > 0, so decrement it to " + s.v + " and continue.";
        } else {
          th.state = "blocked";
          th.on = ins.s;
          s.q.push(ti);
          advance = 0;
          ev.blocked = true;
          ev.note =
            ins.s +
            " is 0, so " +
            id +
            " BLOCKS and joins the queue of " +
            ins.s +
            ".";
        }
        break;
      }
      // signal (V): if someone is queued wake the first (handing it the permit); else increase the value.
      case "signal": {
        const s = ns.sems[ins.s];
        if (s.q.length) {
          const tj = s.q.shift();
          ev.note =
            "Signal " +
            ins.s +
            ": " +
            wake(
              tj,
              "is woken and passes its wait (permit handed over, value stays " +
                s.v +
                ").",
            );
        } else {
          s.v += 1;
          ev.note =
            "Nobody waiting, so " + ins.s + " increases to " + s.v + ".";
        }
        break;
      }
      // lock: acquire a free mutex; block if another thread owns it. Locking twice yourself is a misuse.
      case "lock": {
        const m = ns.muts[ins.m];
        if (m.owner == null) {
          m.owner = ti;
          ev.note = id + " acquires " + ins.m + ".";
        } else if (m.owner === ti) {
          violate(
            ns,
            ti,
            prog,
            "misuse",
            id +
              " tried to lock " +
              ins.m +
              " that it already holds (a plain mutex deadlocks itself).",
          );
          ev.note = ns.violation.msg;
        } else {
          th.state = "blocked";
          th.on = ins.m;
          m.q.push(ti);
          advance = 0;
          ev.blocked = true;
          ev.note =
            ins.m +
            " is held by " +
            prog[m.owner].id +
            ", so " +
            id +
            " BLOCKS.";
        }
        break;
      }
      // unlock: only the owner may unlock. If threads are queued, ownership passes to the first.
      case "unlock": {
        const m = ns.muts[ins.m];
        if (m.owner !== ti) {
          violate(
            ns,
            ti,
            prog,
            "misuse",
            id + " unlocked " + ins.m + " without owning it.",
          );
          ev.note = ns.violation.msg;
        } else if (m.q.length) {
          const tj = m.q.shift();
          m.owner = tj;
          ev.note =
            id +
            " releases " +
            ins.m +
            ", which is handed to " +
            wake(tj, "and it now holds the lock.");
        } else {
          m.owner = null;
          ev.note = id + " releases " + ins.m + ".";
        }
        break;
      }
      // put/get: the bounded buffer. Putting into a full buffer or getting from an empty one is a violation,
      // which is exactly the bug the empty/full semaphores exist to prevent.
      case "put":
        if (ns.buf.count >= ns.buf.cap) {
          violate(
            ns,
            ti,
            prog,
            "overflow",
            id +
              " put an item into a FULL buffer (" +
              ns.buf.cap +
              "). Items would be overwritten.",
          );
          ev.note = ns.violation.msg;
        } else {
          ns.buf.count += 1;
          ev.note =
            "Buffer now holds " + ns.buf.count + " of " + ns.buf.cap + ".";
        }
        break;
      case "get":
        if (ns.buf.count <= 0) {
          violate(
            ns,
            ti,
            prog,
            "underflow",
            id + " took an item from an EMPTY buffer.",
          );
          ev.note = ns.violation.msg;
        } else {
          ns.buf.count -= 1;
          ev.note =
            "Buffer now holds " + ns.buf.count + " of " + ns.buf.cap + ".";
        }
        break;
      // enter: join a region and check mutual exclusion. Exclusive regions (cs, write) must be empty;
      // readers may share but never with a writer.
      case "enter": {
        const o = ns.occ;
        const excl = ins.tag !== "read";
        const others = o.cs.concat(o.write, o.read).filter((x) => x !== ti);
        const bad = excl ? others.length > 0 : o.cs.length + o.write.length > 0;
        o[ins.tag].push(ti);
        if (bad) {
          violate(
            ns,
            ti,
            prog,
            "exclusion",
            "MUTUAL EXCLUSION BROKEN: " +
              id +
              " entered the " +
              ins.tag +
              " region while " +
              others.map((x) => prog[x].id).join(", ") +
              " " +
              (others.length > 1 ? "were" : "was") +
              " inside.",
          );
          ev.note = ns.violation.msg;
        } else ev.note = id + " is now inside the " + ins.tag + " region.";
        break;
      }
      // leave: exit the region.
      case "leave":
        ns.occ[ins.tag] = ns.occ[ins.tag].filter((x) => x !== ti);
        ev.note = id + " leaves the " + ins.tag + " region.";
        break;
      // if: evaluate the condition; when false, skip the next instruction (advance by 2).
      case "if": {
        const ok = CMP[ins.cmp](ns.vars[ins.x], ins.k);
        advance = ok ? 1 : 2;
        ev.note =
          ins.x +
          " is " +
          ns.vars[ins.x] +
          ", so the condition is " +
          (ok ? "TRUE: run the next line." : "FALSE: skip the next line.");
        break;
      }
      default:
        ev.note = (ins.label || "work") + ".";
        break;
    }
    // Move on unless the thread blocked (advance 0) or was already moved by a wake-up.
    if (advance && th.state === "ready") {
      th.pc += advance;
      normalize(th, len);
    }
    return { state: ns, ev };
  }

  /* terminal classification */
  // classify: is this state final? Returns null while some thread can still run, else:
  //   violation - a rule was broken (or finished with the wrong result for `expect`)
  //   done      - every thread finished normally
  //   deadlock  - nobody can run but some threads are still blocked (waits are listed)
  function classify(prog, st, decl) {
    if (st.violation) return { kind: "violation", v: st.violation };
    const run = runnable(st);
    if (run.length) return null;
    if (st.threads.every((t) => t.state === "done")) {
      const wrong = Object.keys(decl.expect).filter(
        (k) => st.vars[k] !== decl.expect[k],
      );
      if (wrong.length)
        return {
          kind: "violation",
          v: {
            kind: "result",
            msg:
              "WRONG RESULT: " +
              wrong
                .map(
                  (k) =>
                    k +
                    " ended as " +
                    st.vars[k] +
                    " but should be " +
                    decl.expect[k],
                )
                .join("; ") +
              ".",
            thread: null,
          },
        };
      return { kind: "done" };
    }
    const waits = st.threads
      .map((t, i) =>
        t.state === "blocked"
          ? {
              id: prog[i].id,
              on: t.on,
              holder:
                st.muts[t.on] && st.muts[t.on].owner != null
                  ? prog[st.muts[t.on].owner].id
                  : null,
            }
          : null,
      )
      .filter(Boolean);
    return { kind: "deadlock", waits };
  }

  /* ---------- running ---------- */
  // run: execute one schedule from the start and record a frame per instruction. The scheduler is:
  //   manual - the list of thread picks you made    random - uniform among runnable threads (seeded)
  //   rr     - round-robin with a time slice (quantum) measured in instructions
  function run(prog, decl, sched) {
    let st = initial(prog, decl);
    const frames = [];
    const snap = (extra) => frames.push(Object.assign({ st }, extra));
    snap({
      ev: null,
      text: "Start. Every thread is at its first instruction. Pick which thread runs next.",
    });
    let term = classify(prog, st, decl),
      error = null;
    // State for the schedulers: seeded RNG, round-robin `cur` thread and slice counter, and the picks made.
    const rnd = mulberry32(sched.seed | 0 || 1);
    let cur = -1,
      used = 0;
    const picks = [];
    let manualIdx = 0;
    while (!term && frames.length - 1 < LIMITS.maxSteps) {
      const rs = runnable(st);
      let ti;
      // Manual: replay your picks; a pick of a blocked or finished thread is reported as an error.
      if (sched.mode === "manual") {
        if (manualIdx >= sched.picks.length) break;
        ti = prog.findIndex((t) => t.id === sched.picks[manualIdx]);
        if (ti < 0) {
          error = "There is no thread called " + sched.picks[manualIdx] + ".";
          break;
        }
        if (!rs.includes(ti)) {
          error =
            "Pick " +
            (manualIdx + 1) +
            ": " +
            prog[ti].id +
            " cannot run now (it is " +
            (st.threads[ti].state === "blocked"
              ? "blocked on " + st.threads[ti].on
              : "finished") +
            "). Remaining picks were ignored.";
          break;
        }
        manualIdx++;
        // Round-robin: keep running the current thread until its slice is used or it cannot run, then move to
        // the next runnable thread in order.
      } else if (sched.mode === "rr") {
        const q = Math.max(1, sched.quantum | 0 || 1);
        if (cur < 0 || !rs.includes(cur) || used >= q) {
          let nxt = -1;
          for (let k = 1; k <= prog.length; k++) {
            const c = (cur + k + prog.length) % prog.length;
            if (rs.includes(c)) {
              nxt = c;
              break;
            }
          }
          cur = nxt;
          used = 0;
        }
        ti = cur;
        used++;
      } else ti = rs[Math.floor(rnd() * rs.length)];
      picks.push(prog[ti].id);
      const r = step(prog, st, ti);
      st = r.state;
      snap({
        ev: r.ev,
        text: r.ev.id + ' runs "' + r.ev.text + '". ' + r.ev.note,
      });
      term = classify(prog, st, decl);
    }
    const status = term
      ? term.kind
      : error
        ? "error"
        : frames.length - 1 >= LIMITS.maxSteps
          ? "limit"
          : "running";
    return { frames, term, status, error, picks, prog, decl };
  }

  /* ---------- exhaustive exploration (BFS so example schedules are shortest) ---------- */
  // keyOf: a string identifying a machine state, so the explorer can recognise states it has seen.
  function keyOf(st) {
    return JSON.stringify([
      st.threads.map((t) => [t.pc, t.state, t.left, t.regs]),
      st.vars,
      Object.keys(st.sems).map((k) => [st.sems[k].v, st.sems[k].q]),
      Object.keys(st.muts).map((k) => [st.muts[k].owner, st.muts[k].q]),
      st.buf.count,
      st.occ.cs,
      st.occ.read,
      st.occ.write,
    ]);
  }
  // explore: breadth-first search over EVERY interleaving. From each state it tries running each runnable
  // thread. Identical states are merged (so the search is far smaller than all orderings), and breadth-first
  // order means the example schedule stored for each outcome is the shortest one. Terminal states are
  // grouped into distinct outcomes: finished (with the final values), deadlock, or a violation.
  function explore(prog, decl, cap) {
    cap = cap || LIMITS.maxStates;
    const start = initial(prog, decl);
    const seen = new Map();
    const outcomes = new Map();
    const queue = [{ st: start, path: [] }];
    seen.set(keyOf(start), true);
    let truncated = false,
      head = 0,
      count = 1;
    while (head < queue.length) {
      const { st, path } = queue[head++];
      const term = classify(prog, st, decl);
      if (term) {
        let key,
          label,
          bad = false;
        if (term.kind === "violation") {
          key = "V:" + term.v.kind + ":" + term.v.msg;
          label = term.v.msg;
          bad = true;
        } else if (term.kind === "deadlock") {
          key = "D";
          label =
            "DEADLOCK: " +
            term.waits
              .map(
                (w) =>
                  w.id +
                  " waits on " +
                  w.on +
                  (w.holder ? " (held by " + w.holder + ")" : ""),
              )
              .join("; ");
          bad = true;
        } else {
          key = "F:" + JSON.stringify(st.vars) + st.buf.count;
          label =
            "Finished normally. Shared values: " +
            (Object.keys(st.vars)
              .map((k) => k + "=" + st.vars[k])
              .join(", ") || "none") +
            (st.buf.cap ? "; buffer holds " + st.buf.count : "") +
            ".";
        }
        if (!outcomes.has(key))
          outcomes.set(key, { label, bad, kind: term.kind, path, hits: 0 });
        outcomes.get(key).hits++;
        continue;
      }
      for (const ti of runnable(st)) {
        const r = step(prog, st, ti);
        const k = keyOf(r.state);
        if (seen.has(k)) continue;
        if (count >= cap) {
          truncated = true;
          continue;
        }
        seen.set(k, true);
        count++;
        queue.push({ st: r.state, path: path.concat(prog[ti].id) });
      }
    }
    const list = Array.from(outcomes.values()).sort(
      (a, b) => b.bad - a.bad || a.path.length - b.path.length,
    );
    return { states: count, truncated, outcomes: list };
  }

  /* ---------- presets (just editable text) ---------- */
  // philosophers(n, variant): generate the program text for n dining philosophers. Variants change only
  // how forks are acquired: naive (left then right: can deadlock), ordered (lower-numbered fork first),
  // room (at most n-1 may try, via a semaphore), asym (odd philosophers reach right first).
  function philosophers(n, variant) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = "F" + i,
        b = "F" + ((i + 1) % n);
      let first = a,
        second = b;
      if (variant === "ordered") {
        const lo = Math.min(i, (i + 1) % n);
        first = "F" + lo;
        second = "F" + Math.max(i, (i + 1) % n);
      }
      if (variant === "asym" && i % 2 === 1) {
        first = b;
        second = a;
      }
      out.push("thread PH" + i);
      if (variant === "room") out.push("  wait room");
      out.push(
        "  work think",
        "  lock " + first,
        "  lock " + second,
        "  work eat",
        "  unlock " + second,
        "  unlock " + first,
      );
      if (variant === "room") out.push("  signal room");
    }
    return out.join("\n");
  }
  const forks = (n) => Array.from({ length: n }, (_, i) => "F" + i).join(", ");
  // Example programs. They are ordinary editable text: change any line and re-run.
  const PRESETS = [
    {
      id: "race",
      name: "Race condition: two threads add 1 to X",
      vars: "X=0",
      sems: "",
      muts: "",
      cap: 0,
      expect: "X=2",
      prog: "thread T1\n  load r X\n  add r 1\n  store X r\n\nthread T2\n  load r X\n  add r 1\n  store X r",
      note: "X++ is really three steps. If both threads load before either stores, one update is lost. Use Explore to see every possible result.",
    },
    {
      id: "mutex",
      name: "Race fixed with a mutex",
      vars: "X=0",
      sems: "",
      muts: "M",
      cap: 0,
      expect: "X=2",
      prog: "thread T1\n  lock M\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  unlock M\n\nthread T2\n  lock M\n  enter cs\n  load r X\n  add r 1\n  store X r\n  leave cs\n  unlock M",
      note: "The mutex makes the read-modify-write one indivisible unit. Explore now shows a single outcome.",
    },
    {
      id: "pc",
      name: "Producer–consumer (bounded buffer, correct)",
      vars: "",
      sems: "empty=2, full=0",
      muts: "M",
      cap: 2,
      expect: "",
      prog: "thread Producer x3\n  wait empty\n  lock M\n  put\n  unlock M\n  signal full\n\nthread Consumer x3\n  wait full\n  lock M\n  get\n  unlock M\n  signal empty",
      note: "empty counts free slots, full counts items. Wait on the counting semaphore first, then take the mutex.",
    },
    {
      id: "pcbad",
      name: "Producer–consumer with the wrong order (deadlock)",
      vars: "",
      sems: "empty=1, full=0",
      muts: "M",
      cap: 1,
      expect: "",
      prog: "thread Producer x2\n  lock M\n  wait empty\n  put\n  signal full\n  unlock M\n\nthread Consumer x2\n  wait full\n  lock M\n  get\n  unlock M\n  signal empty",
      note: "The producer holds the mutex while waiting for a free slot, so the consumer can never take the mutex to free one. Explore finds the deadlock.",
    },
    {
      id: "dp3",
      name: "Dining philosophers: naive (can deadlock)",
      vars: "",
      sems: "",
      muts: forks(3),
      cap: 0,
      expect: "",
      prog: philosophers(3, "naive"),
      note: "Everyone grabs the left fork, then wants the right. If all grab left first, nobody can eat.",
    },
    {
      id: "dp3o",
      name: "Dining philosophers: ordered forks",
      vars: "",
      sems: "",
      muts: forks(3),
      cap: 0,
      expect: "",
      prog: philosophers(3, "ordered"),
      note: "Always pick up the lower-numbered fork first. This breaks the circular-wait condition.",
    },
    {
      id: "dp3r",
      name: "Dining philosophers: at most N−1 seated",
      vars: "",
      sems: "room=2",
      muts: forks(3),
      cap: 0,
      expect: "",
      prog: philosophers(3, "room"),
      note: "Only two of three may try to eat at once, so someone always gets both forks.",
    },
    {
      id: "dp3a",
      name: "Dining philosophers: asymmetric",
      vars: "",
      sems: "",
      muts: forks(3),
      cap: 0,
      expect: "",
      prog: philosophers(3, "asym"),
      note: "Odd philosophers pick up the right fork first. Not everyone reaches for the same side, so the cycle cannot form.",
    },
    {
      id: "rw",
      name: "Readers–writers (readers preferred)",
      vars: "rc=0",
      sems: "wrt=1",
      muts: "M",
      cap: 0,
      expect: "",
      prog: "thread R1\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread R2\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread W\n  wait wrt\n  enter write\n  leave write\n  signal wrt",
      note: "The first reader locks writers out, the last reader lets them in. Many readers can overlap. Because readers keep priority, a steady stream of readers can starve the writer.",
    },
    {
      id: "rwbad",
      name: "Readers–writers: writer forgets to wait (broken)",
      vars: "rc=0",
      sems: "wrt=1",
      muts: "M",
      cap: 0,
      expect: "",
      prog: "thread R1\n  lock M\n  inc rc\n  if rc == 1\n  wait wrt\n  unlock M\n  enter read\n  leave read\n  lock M\n  dec rc\n  if rc == 0\n  signal wrt\n  unlock M\n\nthread W\n  enter write\n  leave write",
      note: "Without wait/signal around its write, the writer can overlap a reader. Explore finds the violation.",
    },
  ];

  NS.sync = {
    LIMITS,
    PRESETS,
    parseDecls,
    parseProgram,
    initial,
    step,
    run,
    explore,
    runnable,
    classify,
    philosophers,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = NS.sync;
})(typeof window !== "undefined" ? window : globalThis);
