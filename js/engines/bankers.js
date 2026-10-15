/* Banker's algorithm engine: Need, safety algorithm (stepped), resource-request algorithm, safe-sequence count. Pure logic. */
(function (root) {
  "use strict";
  const NS = (root.OSViz = root.OSViz || {});
  // Caps on matrix size and values.
  const LIMITS = { maxProcs: 8, maxRes: 5, maxVal: 99 };

  // Small vector helpers: element-wise sum, difference, 'every element <=', and a '(1, 2, 3)' formatter.
  const sum = (a, b) => a.map((x, i) => x + b[i]);
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const leq = (a, b) => a.every((x, i) => x <= b[i]);
  const vec = (v) => "(" + v.join(", ") + ")";

  // validate: whole numbers in range, Max >= Allocation for every process/resource (a process cannot hold
  // more than it declared it would ever need), and, in 'Total' mode, allocation must not exceed the total.
  function validate(inp) {
    const errors = [];
    const { alloc, max } = inp;
    const n = alloc.length;
    const m = n ? alloc[0].length : 0;
    if (n < 1 || n > LIMITS.maxProcs)
      errors.push("Use 1 to " + LIMITS.maxProcs + " processes.");
    if (m < 1 || m > LIMITS.maxRes)
      errors.push("Use 1 to " + LIMITS.maxRes + " resource types.");
    const all = [].concat(...alloc, ...max, inp.avail || [], inp.total || []);
    if (all.some((x) => !Number.isInteger(x) || x < 0 || x > LIMITS.maxVal))
      errors.push(
        "Every number must be a whole number from 0 to " + LIMITS.maxVal + ".",
      );
    if (errors.length) return { ok: false, errors };
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++)
        if (max[i][j] < alloc[i][j])
          errors.push(
            "P" +
              i +
              " holds more of resource " +
              String.fromCharCode(65 + j) +
              " (" +
              alloc[i][j] +
              ") than its Max (" +
              max[i][j] +
              "). Max must be at least Allocation.",
          );
    if (inp.mode === "total") {
      const used = alloc.reduce((a, r) => sum(a, r), new Array(m).fill(0));
      for (let j = 0; j < m; j++)
        if (used[j] > inp.total[j])
          errors.push(
            "Resource " +
              String.fromCharCode(65 + j) +
              ": processes hold " +
              used[j] +
              " but the system only has " +
              inp.total[j] +
              ".",
          );
    }
    return { ok: !errors.length, errors };
  }

  // availOf: Available is either typed in directly, or computed as Total - (sum of all Allocation rows).
  function availOf(inp) {
    if (inp.mode === "total") {
      const m = inp.alloc[0].length;
      const used = inp.alloc.reduce((a, r) => sum(a, r), new Array(m).fill(0));
      return sub(inp.total, used);
    }
    return inp.avail.slice();
  }
  // needOf: Need = Max - Allocation, per process and resource (what each process may still ask for).
  const needOf = (alloc, max) => max.map((r, i) => sub(r, alloc[i]));

  /* Safety algorithm. pick: 'cyclic' (lowest-index candidate, the textbook scan). */
  // safety(...): the Safety Algorithm.
  //   1. Work = Available; Finish[i] = false for every process.
  //   2. Find an unfinished i with Need[i] <= Work. If none, stop.
  //   3. Pretend i runs to completion and returns its resources: Work += Allocation[i]; Finish[i] = true.
  //   4. Repeat. If every Finish[i] is true the state is SAFE (the order found is a safe sequence);
  //      otherwise the unfinished processes are stuck and the state is UNSAFE.
  // Each pass appends frames so the Player can show the check, the choice and the release.
  function safety(alloc, need, avail, pick) {
    const n = alloc.length;
    const finish = new Array(n).fill(false);
    // work/finish/seq = the algorithm's state; `last` remembers the previous pick for the cyclic scan.
    let work = avail.slice();
    const seq = [];
    const frames = [];
    let last = -1;
    frames.push({
      kind: "start",
      work: work.slice(),
      finish: finish.slice(),
      seq: [],
      text:
        "Start: Work = Available = " +
        vec(work) +
        ". Finish is false for everyone. Look for a process whose Need ≤ Work.",
    });
    for (;;) {
      // Candidates: every unfinished process whose Need fits within Work.
      const cands = [];
      const checks = [];
      for (let i = 0; i < n; i++)
        if (!finish[i]) {
          const ok = leq(need[i], work);
          checks.push({ i, ok });
          if (ok) cands.push(i);
        }
      if (!cands.length) break;
      // Which candidate runs next depends on the scan convention (it changes the ORDER, never safe/unsafe):
      //   highest - take the highest index    lowest - always restart at P0
      //   cyclic  - keep scanning after the last pick and wrap around (what most textbooks do)
      let i;
      if (pick === "highest") i = cands[cands.length - 1];
      else if (pick === "lowest") i = cands[0];
      else {
        i = cands.find((c) => c > last);
        if (i === undefined) i = cands[0];
      } // cyclic: keep scanning after the last pick, then wrap
      last = i;
      const pickName =
        pick === "highest"
          ? "highest index"
          : pick === "lowest"
            ? "lowest index"
            : "next in the scan";
      const before = work.slice();
      frames.push({
        kind: "check",
        work: work.slice(),
        finish: finish.slice(),
        seq: seq.slice(),
        checks,
        cands,
        chosen: i,
        text:
          "Checking Need ≤ Work for each unfinished process. " +
          cands.map((c) => "P" + c).join(", ") +
          " can finish. Pick P" +
          i +
          " (" +
          pickName +
          "): Need " +
          vec(need[i]) +
          " ≤ Work " +
          vec(work) +
          ".",
      });
      // Process i finishes and releases its Allocation back into Work.
      work = sum(work, alloc[i]);
      finish[i] = true;
      seq.push(i);
      frames.push({
        kind: "finish",
        work: work.slice(),
        finish: finish.slice(),
        seq: seq.slice(),
        done: i,
        text:
          "P" +
          i +
          " runs to completion and releases everything it holds. Work = " +
          vec(before) +
          " + " +
          vec(alloc[i]) +
          " = " +
          vec(work) +
          ".",
      });
    }
    // Safe if everyone finished; otherwise `stuck` lists the processes that never could.
    const safe = finish.every(Boolean);
    const stuck = finish.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
    frames.push({
      kind: "end",
      work: work.slice(),
      finish: finish.slice(),
      seq: seq.slice(),
      safe,
      stuck,
      text: safe
        ? "Everyone can finish, so the state is SAFE. Safe sequence: <" +
          seq.map((i) => "P" + i).join(", ") +
          ">."
        : "No unfinished process has Need ≤ Work " +
          vec(work) +
          ". " +
          stuck.map((i) => "P" + i).join(", ") +
          " cannot be guaranteed to finish, so the state is UNSAFE.",
    });
    return { safe, sequence: seq, stuck, frames };
  }

  /* Count every distinct safe sequence (cap to keep it fast). */
  // countSequences: depth-first search over every order in which processes could finish, counting the
  // complete orders (capped, with a flag if the cap is hit). It shows that a safe state usually has
  // many safe sequences, and an unsafe one has none.
  function countSequences(alloc, need, avail, cap) {
    cap = cap || 20000;
    const n = alloc.length;
    let count = 0,
      truncated = false;
    const samples = [];
    const done = new Array(n).fill(false);
    (function rec(work, depth, seq) {
      if (truncated) return;
      if (depth === n) {
        count++;
        if (samples.length < 6) samples.push(seq.slice());
        if (count >= cap) truncated = true;
        return;
      }
      for (let i = 0; i < n; i++)
        if (!done[i] && leq(need[i], work)) {
          done[i] = true;
          seq.push(i);
          rec(sum(work, alloc[i]), depth + 1, seq);
          seq.pop();
          done[i] = false;
        }
    })(avail.slice(), 0, []);
    return { count, truncated, samples };
  }

  /* Resource-request algorithm for process p. */
  // request(...): the Resource-Request Algorithm for process p asking for `req`:
  //   1. Request <= Need? If not, the process exceeded its declared maximum: error.
  //   2. Request <= Available? If not, the process must wait.
  //   3. Pretend to grant it (Available -= Request, Allocation += Request, Need -= Request).
  //   4. Run the safety algorithm on that pretend state. Safe -> grant; unsafe -> deny and roll back.
  function request(inp, p, req, pick) {
    const avail = availOf(inp);
    const need = needOf(inp.alloc, inp.max);
    const m = avail.length;
    const steps = [];
    const letter = (j) => String.fromCharCode(65 + j);
    if (req.length !== m || req.some((x) => !Number.isInteger(x) || x < 0))
      return {
        error: "Enter " + m + " whole numbers (0 or more), one per resource.",
      };
    // Check 1: has the process asked for more than its remaining Need?
    steps.push({
      id: "need",
      ok: leq(req, need[p]),
      text:
        "Step 1. Is Request ≤ Need? " +
        vec(req) +
        " ≤ " +
        vec(need[p]) +
        (leq(req, need[p]) ? " → yes." : " → NO."),
    });
    if (!leq(req, need[p]))
      return {
        outcome: "error",
        steps,
        text:
          "Denied: P" +
          p +
          " asked for more than it declared in Max (it exceeds its maximum claim). This is an error, not just a wait.",
      };
    // Check 2: is that much actually free right now?
    steps.push({
      id: "avail",
      ok: leq(req, avail),
      text:
        "Step 2. Is Request ≤ Available? " +
        vec(req) +
        " ≤ " +
        vec(avail) +
        (leq(req, avail) ? " → yes." : " → NO."),
    });
    if (!leq(req, avail))
      return {
        outcome: "wait",
        steps,
        text:
          "P" + p + " must WAIT: the resources are not available right now.",
      };
    // Build the pretend state after granting.
    const nAvail = sub(avail, req);
    const nAlloc = inp.alloc.map((r, i) => (i === p ? sum(r, req) : r.slice()));
    const nNeed = need.map((r, i) => (i === p ? sub(r, req) : r.slice()));
    steps.push({
      id: "pretend",
      ok: true,
      text:
        "Step 3. Pretend to grant it. Available = " +
        vec(avail) +
        " − " +
        vec(req) +
        " = " +
        vec(nAvail) +
        ". P" +
        p +
        " Allocation becomes " +
        vec(nAlloc[p]) +
        " and its Need becomes " +
        vec(nNeed[p]) +
        ".",
    });
    // Check 4: is the pretend state safe?
    const s = safety(nAlloc, nNeed, nAvail, pick);
    steps.push({
      id: "safe",
      ok: s.safe,
      text:
        "Step 4. Run the safety algorithm on the pretend state → " +
        (s.safe
          ? "SAFE <" + s.sequence.map((i) => "P" + i).join(", ") + ">"
          : "UNSAFE") +
        ".",
    });
    return {
      outcome: s.safe ? "grant" : "deny",
      steps,
      safety: s,
      pretend: { alloc: nAlloc, need: nNeed, avail: nAvail },
      text: s.safe
        ? "GRANTED: the request leaves the system in a safe state."
        : "DENIED (P" +
          p +
          " must wait): granting it now would leave the system unsafe, so the OS rolls the pretend allocation back.",
    };
  }

  // Convert a preset into the input shape the functions expect.
  const toInp = (p) => ({
    alloc: p.alloc,
    max: p.max,
    avail: p.avail,
    total: p.total,
    mode: p.mode,
  });
  // Example INPUTS: the Silberschatz 5x3 textbook system, an unsafe state, a single-resource case.
  const PRESETS = [
    {
      id: "classic",
      name: "Textbook example (5 processes, 3 resources)",
      mode: "avail",
      avail: [3, 3, 2],
      alloc: [
        [0, 1, 0],
        [2, 0, 0],
        [3, 0, 2],
        [2, 1, 1],
        [0, 0, 2],
      ],
      max: [
        [7, 5, 3],
        [3, 2, 2],
        [9, 0, 2],
        [2, 2, 2],
        [4, 3, 3],
      ],
      pick: "cyclic",
      req: { p: 1, v: [1, 0, 2] },
      note: "Safe, with <P1, P3, P4, P0, P2>. Try the request P1 (1,0,2): granted. Then P4 (3,3,0) must wait, and P0 (0,2,0) is denied because it would be unsafe.",
    },
    {
      id: "unsafe",
      name: "An unsafe state",
      mode: "avail",
      avail: [1, 0, 0],
      alloc: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      max: [
        [2, 1, 0],
        [0, 2, 1],
        [1, 0, 2],
      ],
      pick: "cyclic",
      req: { p: 0, v: [1, 0, 0] },
      note: "Unsafe does not mean deadlocked yet. It means the OS can no longer guarantee that everyone finishes.",
    },
    {
      id: "tight",
      name: "Single resource, three processes",
      mode: "total",
      total: [10],
      avail: [0],
      alloc: [[2], [3], [2]],
      max: [[9], [4], [7]],
      pick: "cyclic",
      req: { p: 1, v: [1] },
      note: "Silberschatz-style single-resource example: 10 units, 3 held by P1... Safe with <P1, P0, P2>.",
    },
  ];

  NS.bankers = {
    LIMITS,
    PRESETS,
    validate,
    availOf,
    needOf,
    safety,
    countSequences,
    request,
    toInp,
    leq,
    sum,
    sub,
    vec,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = NS.bankers;
})(typeof window !== "undefined" ? window : globalThis);
