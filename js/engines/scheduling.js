/* CPU scheduling engine.
   Pure logic, no DOM. Nothing is hardcoded: every answer is produced by running the
   simulation one clock tick at a time and recording a "frame" for each tick. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // ALGOS: the catalogue of algorithms. This is *teaching text* (rule, memory hook, pitfall) plus a
  // `preemptive` flag. It holds no results: every number the UI shows is computed by simulate().
  const ALGOS = [
    {
      id: 'fcfs', short: 'FCFS', name: 'First Come, First Served', preemptive: false,
      rule: 'The CPU goes to the process that has been in the ready queue the longest. Once it starts, it runs until it finishes.',
      hook: 'A ticket counter: first in line is first served. No cutting in, no pausing.',
      watch: 'Convoy effect: one long job at the front makes every short job behind it wait.'
    },
    {
      id: 'sjf', short: 'SJF', name: 'Shortest Job First', preemptive: false,
      rule: 'Among the ready processes, pick the one with the smallest burst time. It then runs to completion.',
      hook: 'The express checkout lane: one item goes before a full trolley, so the average wait drops.',
      watch: 'Long jobs can starve if short jobs keep arriving. Real systems only have an estimate of the burst time.'
    },
    {
      id: 'srtf', short: 'SRTF', name: 'Shortest Remaining Time First', preemptive: true,
      rule: 'At every tick, run the process with the least time remaining. A new arrival with less remaining time takes the CPU.',
      hook: 'SJF with a stopwatch: the line is re-checked every tick, and the shortest remaining job always wins.',
      watch: 'More context switches than SJF, and long jobs can still starve.'
    },
    {
      id: 'priority_np', short: 'Priority', name: 'Priority (non-preemptive)', preemptive: false,
      rule: 'Pick the ready process with the best priority. It runs to completion, even if a better one arrives meanwhile.',
      hook: 'A VIP queue where nobody is thrown out mid-service: the VIP waits for the current guest to finish.',
      watch: 'Low-priority processes can starve. Aging (slowly raising the priority of waiting jobs) is the usual fix.'
    },
    {
      id: 'priority_p', short: 'Priority (P)', name: 'Priority (preemptive)', preemptive: true,
      rule: 'Always run the best-priority ready process. A newly arrived process with a better priority takes the CPU at once.',
      hook: 'An ambulance on the road: everyone pulls over the moment it arrives.',
      watch: 'Starvation of low-priority work, and extra context switches.'
    },
    {
      id: 'priority_aging', short: 'Priority + aging', name: 'Priority with aging (preemptive)', preemptive: true,
      rule: 'Like preemptive priority, but every N ticks a process spends waiting in the ready queue its priority improves by one step. It keeps the boost while it runs; if it is preempted it falls back to its original priority.',
      hook: 'A queue at the bank where the longer you have waited, the closer to the front you are moved. Nobody waits forever.',
      watch: 'N is a trade-off: a small N behaves almost like FCFS, a large N behaves like plain priority. Only the waiting time counts, not how important the job is.'
    },
    {
      id: 'rr', short: 'Round Robin', name: 'Round Robin', preemptive: true,
      rule: 'Each process runs for at most one time quantum, then moves to the back of the queue. Everyone gets regular turns.',
      hook: 'Passing one game controller around: each player gets a fixed timer, then hands it on.',
      watch: 'A huge quantum behaves like FCFS. A tiny quantum wastes time on context switches.'
    },
    {
      id: 'lottery', short: 'Lottery', name: 'Lottery scheduling', preemptive: true,
      rule: 'Every process holds tickets (the Tickets column). At the start of each time quantum a random ticket is drawn from all ready processes, and the owner runs for one quantum.',
      hook: 'A raffle: more tickets means better odds, but nobody has zero chance, so nobody starves.',
      watch: 'The result is random: short runs can look unfair, and only over many draws does the share of CPU time approach the share of tickets. Same seed, same result.'
    }
  ];
  // BY_ID: look an algorithm up by its id ('fcfs', 'rr', ...).
  const BY_ID = {};
  ALGOS.forEach((a) => { BY_ID[a.id] = a; });

  // Input caps so a typo (burst = 1000000) can never freeze the browser.
  const LIMITS = { maxProcs: 12, maxArrival: 100, maxBurst: 50, maxPriority: 99, maxQuantum: 50, maxAging: 50, maxTicks: 800 };

  // usesPriorityColumn(algo): does this algorithm read the Priority column? The two priority rules, aging
  // and the lottery do; for the lottery the same column holds the number of tickets.
  const usesPriorityColumn = (algo) => /^priority/.test(algo) || algo === 'lottery';
  // Algorithms that run in fixed time slices (a new decision only when a quantum ends).
  const isSliced = (algo) => algo === 'rr' || algo === 'lottery';
  // Compare tab: the lottery is one random run, so it is not comparable with the deterministic rules.
  const COMPARE_ALGOS = ALGOS.filter((a) => a.id !== 'lottery');

  /* ---------- validation ---------- */
  // validate(rows, cfg): turn the raw table (strings from <input>s) into clean numbers, or a list of
  // readable errors that say which row and field is wrong. Returns { ok, errors, clean }.
  function validate(rows, cfg) {
    const errors = [];
    const clean = [];
    if (!rows.length) errors.push({ row: -1, field: 'rows', msg: 'Add at least one process.' });
    if (rows.length > LIMITS.maxProcs) errors.push({ row: -1, field: 'rows', msg: 'Use at most ' + LIMITS.maxProcs + ' processes.' });
    // A value counts as a whole number only if it is non-empty and an integer ('' would otherwise become 0).
    const isInt = (v) => v !== '' && v != null && Number.isInteger(+v);
    rows.forEach((r, i) => {
      const label = 'P' + (i + 1);
      if (!isInt(r.arrival) || +r.arrival < 0 || +r.arrival > LIMITS.maxArrival)
        errors.push({ row: i, field: 'arrival', msg: label + ': arrival must be a whole number from 0 to ' + LIMITS.maxArrival + '.' });
      if (!isInt(r.burst) || +r.burst < 1 || +r.burst > LIMITS.maxBurst)
        errors.push({ row: i, field: 'burst', msg: label + ': burst must be a whole number from 1 to ' + LIMITS.maxBurst + '.' });
      // Priority is only required (and checked) for the two priority algorithms.
      const needsPriority = cfg && /^priority/.test(cfg.algo);
      // The lottery reads the same column as a ticket count, which must be at least 1.
      if (cfg && cfg.algo === 'lottery' && (!isInt(r.priority) || +r.priority < 1 || +r.priority > LIMITS.maxPriority))
        errors.push({ row: i, field: 'priority', msg: label + ': tickets must be a whole number from 1 to ' + LIMITS.maxPriority + '.' });
      if (needsPriority && (!isInt(r.priority) || Math.abs(+r.priority) > LIMITS.maxPriority))
        errors.push({ row: i, field: 'priority', msg: label + ': priority must be a whole number (−' + LIMITS.maxPriority + ' to ' + LIMITS.maxPriority + ').' });
      clean.push({ pid: label, arrival: +r.arrival, burst: +r.burst, priority: isInt(r.priority) ? +r.priority : 0 });
    });
    if (cfg && cfg.algo === 'priority_aging' && (!isInt(cfg.agingEvery) || +cfg.agingEvery < 1 || +cfg.agingEvery > LIMITS.maxAging))
      errors.push({ row: -1, field: 'agingEvery', msg: 'Aging step must be a whole number from 1 to ' + LIMITS.maxAging + ' ticks.' });
    if (cfg && cfg.algo === 'lottery' && cfg.seed != null && cfg.seed !== '' && !isInt(cfg.seed))
      errors.push({ row: -1, field: 'seed', msg: 'Seed must be a whole number.' });
    if (cfg && isSliced(cfg.algo)) {
      if (!isInt(cfg.quantum) || +cfg.quantum < 1 || +cfg.quantum > LIMITS.maxQuantum)
        errors.push({ row: -1, field: 'quantum', msg: 'Time quantum must be a whole number from 1 to ' + LIMITS.maxQuantum + '.' });
    }
    if (!errors.length) {
      // Reject problems whose timeline (last arrival + all bursts) exceeds the tick limit.
      const total = Math.max.apply(null, clean.map((p) => p.arrival)) + clean.reduce((s, p) => s + p.burst, 0);
      if (total > LIMITS.maxTicks) errors.push({ row: -1, field: 'rows', msg: 'This problem is too long to animate. Shorten the bursts or arrivals.' });
    }
    return { ok: errors.length === 0, errors, clean };
  }

  /* ---------- simulation ---------- */
  // simulate(rows, config): the scheduler itself.
  // It advances a clock one tick at a time. Each tick it (1) admits arrivals, (2) handles Round Robin
  // quantum expiry, (3) lets the algorithm choose who runs, (4) runs that process for one tick.
  // Before running it records a *frame* (clock, running process, queue, remaining times, events, and
  // the reasoning behind the decision). The Player then replays these frames, forwards and backwards.
  function simulate(rows, config) {
    // Defaults for the convention switches textbooks disagree on:
    //   lowerIsHigher  - is priority 1 better than priority 5?
    //   tieBreak       - on equal keys use earliest arrival, or lowest process number
    //   rrArrivalsFirst- in Round Robin, does a process arriving at the instant a quantum ends
    //                    queue before the preempted process? (both conventions are common)
    const cfg = Object.assign({ algo: 'fcfs', quantum: 2, lowerIsHigher: true, tieBreak: 'arrival', rrArrivalsFirst: true, agingEvery: 3, seed: 1 }, config);
    const algo = BY_ID[cfg.algo];
    const procs = rows.map((r, i) => ({
      pid: r.pid || 'P' + (i + 1), idx: i, arrival: +r.arrival, burst: +r.burst,
      priority: r.priority == null ? 0 : +r.priority
    }));
    const P = {};
    procs.forEach((p) => { P[p.pid] = p; });
    const quantum = Math.max(1, Math.floor(+cfg.quantum) || 1);
    const sliced = isSliced(cfg.algo);

    // Aging: waited[pid] counts the ticks a process has spent in the ready queue since it last had the
    // CPU (or since it arrived). Every `every` ticks of waiting improves its priority by one step. The boost is
    // kept while the process runs and is lost only when it is preempted (see the preempt branch).
    const aging = cfg.algo === 'priority_aging';
    const every = Math.max(1, Math.floor(+cfg.agingEvery) || 3);
    const waited = {};
    procs.forEach((p) => { waited[p.pid] = 0; });
    const boostOf = (pid) => (aging ? Math.floor(waited[pid] / every) : 0);
    // effPrio: base priority moved toward 'better' by the boost (better = lower when lowerIsHigher).
    const effPrio = (pid) => (cfg.lowerIsHigher ? P[pid].priority - boostOf(pid) : P[pid].priority + boostOf(pid));

    // Lottery: a seeded random generator (mulberry32) so the same seed always gives the same draws.
    // tickets(pid) uses the Priority column, at least 1 so a bad value can never remove a process.
    const rng = (function (seed) {
      let a = (Math.floor(+seed) || 0) >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })(cfg.seed);
    const tickets = (pid) => Math.max(1, P[pid].priority);

    // Bookkeeping per process id: time left, first time it got the CPU (for response time), finish time.
    const remaining = {}, firstStart = {}, completion = {};
    procs.forEach((p) => { remaining[p.pid] = p.burst; });

    // queue = the ready queue (process ids). running = process on the CPU. sliceUsed = ticks used of the
    // current Round Robin quantum. lastRan / switches count context switches (CPU changes hands).
    // pending = events to report at the *next* frame (e.g. 'finish', which happens at the end of a tick).
    let queue = [];
    let running = null, sliceUsed = 0, lastRan = null, switches = 0;
    const done = [];
    const ticks = [];
    const frames = [];
    let pending = [];
    let t = 0;
    let prevIdle = false;

    // SJF, SRTF and Priority choose by a key; FCFS and RR just use queue order.
    const isSorted = cfg.algo === 'sjf' || cfg.algo === 'srtf' || /^priority/.test(cfg.algo);
    // keyOf(pid): the number to minimise. SJF/SRTF: remaining time. Priority: the priority number,
    // negated when a higher number means higher priority, so that 'smaller is better' always holds.
    const keyOf = (pid) => {
      if (cfg.algo === 'sjf' || cfg.algo === 'srtf') return remaining[pid];
      const e = effPrio(pid); // equals the base priority unless aging is on
      return cfg.lowerIsHigher ? e : -e;
    };
    // valueOf(pid): the number to *show* in the explanation (SJF shows the original burst; SRTF the remaining time).
    const valueOf = (pid) => {
      if (cfg.algo === 'sjf') return P[pid].burst;
      if (cfg.algo === 'srtf') return remaining[pid];
      return effPrio(pid);
    };
    // compare(a, b): sort order for candidates. Smaller key first. On a tie: a preemptive algorithm keeps
    // the process already running (avoids a pointless switch), then the configured tie-break applies.
    const compare = (a, b, preferRunning) => {
      const ka = keyOf(a), kb = keyOf(b);
      if (ka !== kb) return ka - kb;
      if (preferRunning) { if (a === running) return -1; if (b === running) return 1; }
      if (cfg.tieBreak === 'arrival' && P[a].arrival !== P[b].arrival) return P[a].arrival - P[b].arrival;
      return P[a].idx - P[b].idx;
    };
    // tieReason: plain-language explanation of which tie-break rule decided, for the 'Why' panel.
    const tieReason = (a, b, preferRunning) => {
      if (preferRunning && (a === running || b === running)) return 'the running process keeps the CPU on a tie';
      if (cfg.tieBreak === 'arrival' && P[a].arrival !== P[b].arrival) return 'the earlier arrival goes first';
      return 'the lower process number goes first';
    };
    // Name of the quantity being compared, used in the explanation text.
    const metricLabel = { sjf: 'burst time', srtf: 'remaining time', priority_np: 'priority number', priority_p: 'priority number', priority_aging: 'effective priority' }[cfg.algo];

    // The queue as the student sees it: sorted by the algorithm's key when it uses one.
    const displayQueue = () => (isSorted ? queue.slice().sort((a, b) => compare(a, b, false)) : queue.slice());

    // decide(cands): choose the next process from the candidates and describe why.
    // Returns { chosen, decision } where decision lists every candidate with its compared value,
    // any tie that had to be broken, and a sentence for the explanation panel.
    function decide(cands, preempting) {
      // returns { chosen, decision }
      let sorted;
      if (isSorted) sorted = cands.slice().sort((a, b) => compare(a, b, algo.preemptive));
      else sorted = cands.slice();
      let chosen = sorted[0];
      // Lottery: give every candidate a block of consecutive ticket numbers, draw one number in
      // [0, total) and the block it falls in wins. With a single candidate there is nothing to draw.
      let draw = null;
      if (cfg.algo === 'lottery') {
        let lo = 0;
        const blocks = sorted.map((pid) => { const b = { pid, lo, hi: lo + tickets(pid) - 1 }; lo += tickets(pid); return b; });
        if (blocks.length > 1) {
          const number = Math.floor(rng() * lo);
          chosen = blocks.find((b) => number >= b.lo && number <= b.hi).pid;
          draw = { number, total: lo, blocks };
        } else draw = { number: null, total: lo, blocks };
      }
      const d = {
        algo: cfg.algo, chosen, metric: isSorted ? metricLabel : (cfg.algo === 'rr' ? 'queue' : (cfg.algo === 'lottery' ? 'tickets' : 'arrival')),
        candidates: sorted.map((pid) => ({
          pid,
          value: cfg.algo === 'lottery' ? tickets(pid) : (isSorted ? valueOf(pid) : (cfg.algo === 'rr' ? null : P[pid].arrival)),
          // extra detail for the explanation: the aging boost, or the ticket numbers owned
          note: aging && boostOf(pid) ? '(base ' + P[pid].priority + ', aged ' + boostOf(pid) + ')' : (draw ? '(#' + draw.blocks.find((b) => b.pid === pid).lo + (tickets(pid) > 1 ? '-' + draw.blocks.find((b) => b.pid === pid).hi : '') + ')' : '')
        })),
        draw, tie: null, text: ''
      };
      if (isSorted && sorted.length > 1 && keyOf(sorted[0]) === keyOf(sorted[1]) && chosen === sorted[0])
        d.tie = tieReason(sorted[0], sorted[1], algo.preemptive);
      d.text = describe(d, cfg, running);
      return { chosen, decision: d };
    }

    // Main loop: one iteration = one clock tick, until everyone has finished (or the safety cap is hit).
    while (done.length < procs.length && t < LIMITS.maxTicks) {
      const events = pending; pending = [];

      // Step 1: processes whose arrival time equals the clock join the ready queue.
      // 1. arrivals
      const arrivals = procs.filter((p) => p.arrival === t).map((p) => p.pid);
      arrivals.forEach((pid) => events.push({ type: 'arrive', pid }));

      // Step 2 (Round Robin only): if the running process used its whole quantum, take it off the CPU and
      // send it to the back of the queue. The order relative to simultaneous arrivals follows rrArrivalsFirst.
      // 2. Round Robin: quantum expired?
      let expired = null;
      if (sliced && running && sliceUsed >= quantum) {
        expired = running; running = null; sliceUsed = 0;
        events.push({ type: 'quantum', pid: expired, quantum });
      }
      if (expired) {
        if (cfg.rrArrivalsFirst) { queue.push.apply(queue, arrivals); queue.push(expired); }
        else { queue.push(expired); queue.push.apply(queue, arrivals); }
      } else queue.push.apply(queue, arrivals);

      // Step 3: pick who runs. Non-preemptive algorithms only choose when the CPU is free.
      // Preemptive ones re-examine every tick, with the running process competing as a candidate.
      // 3. pick who runs
      let decision = null;
      // Round Robin is preemptive by quantum only, so it must not re-pick in the middle of a slice.
      const canPick = !running || (algo.preemptive && !sliced);
      if (canPick) {
        const cands = queue.slice();
        if (running && algo.preemptive) cands.push(running);
        if (cands.length) {
          const res = decide(cands, !!running);
          decision = res.decision;
          if (res.chosen !== running) {
            if (running) {
              events.push({ type: 'preempt', pid: running, by: res.chosen });
              queue.push(running);
              sliceUsed = 0;
              waited[running] = 0; // aging restarts from the base priority
            }
            queue.splice(queue.indexOf(res.chosen), 1);
            if (lastRan !== null && lastRan !== res.chosen) switches++;
            running = res.chosen;
            if (firstStart[running] === undefined) firstStart[running] = t;
            if (expired && res.chosen === expired) events.push({ type: 'continue', pid: running, won: cfg.algo === 'lottery' });
            else events.push({ type: 'dispatch', pid: running });
          } else {
            // preemptive algorithm, current process stays on the CPU
            decision.kept = true;
          }
        }
      } else {
        decision = { algo: cfg.algo, kept: true, chosen: running, candidates: [], metric: null, tie: null };
        decision.text = sliced
          ? running + ' is still inside its time slice (' + sliceUsed + ' of ' + quantum + ' used), so it keeps the CPU.'
          : running + ' is already running, and ' + algo.short + ' does not preempt, so it keeps the CPU until it finishes.';
      }

      // Nothing running and nothing ready: the CPU is idle. Report the idle event once per gap.
      if (!running && !queue.length) {
        if (!prevIdle) events.push({ type: 'idle' });
        prevIdle = true;
      } else prevIdle = false;

      frames.push({
        // Record the frame for this tick BEFORE executing it, so the view can show the decision, then the result.
        t, running,
        slice: running ? sliceUsed : 0,
        queue: displayQueue(),
        notArrived: procs.filter((p) => p.arrival > t).sort((a, b) => a.arrival - b.arrival || a.idx - b.idx).map((p) => p.pid),
        done: done.slice(),
        remaining: Object.assign({}, remaining),
        // effective priorities at this tick (aging only), so views and tests can see the boosts
        eff: aging ? Object.fromEntries(procs.map((p) => [p.pid, effPrio(p.pid)])) : null,
        events, decision
      });

      // Step 4: execute one tick. Reduce remaining time; if it hits zero the process completes
      // (completion time is the end of this tick, t + 1).
      // 4. run one tick
      if (running) {
        ticks.push(running);
        remaining[running]--; sliceUsed++; lastRan = running;
        if (remaining[running] === 0) {
          completion[running] = t + 1;
          done.push(running);
          pending.push({ type: 'finish', pid: running, time: t + 1 });
          running = null; sliceUsed = 0;
        }
      } else ticks.push(null);
      // Aging: everyone still in the ready queue has now waited one more tick.
      if (aging) queue.forEach((pid) => { waited[pid]++; });
      t++;
    }

    frames.push({
      t, running: null, slice: 0, queue: [], notArrived: [], done: done.slice(),
      remaining: Object.assign({}, remaining), events: pending, decision: null
    });

    // Metrics from the textbook formulas:
    //   turnaround = completion - arrival    waiting = turnaround - burst    response = first start - arrival
    // CPU utilisation = busy ticks / total ticks; throughput = processes / total time.
    // metrics
    const per = procs.map((p) => {
      const ct = completion[p.pid];
      const tat = ct - p.arrival;
      return { pid: p.pid, arrival: p.arrival, burst: p.burst, priority: p.priority, ct, tat, wt: tat - p.burst, rt: firstStart[p.pid] - p.arrival, start: firstStart[p.pid] };
    });
    const n = per.length;
    const avg = (k) => per.reduce((s, r) => s + r[k], 0) / n;
    const total = ticks.length;
    const busy = ticks.filter((x) => x !== null).length;
    return {
      cfg, procs, ticks, frames, per, total,
      metrics: {
        avgWT: avg('wt'), avgTAT: avg('tat'), avgRT: avg('rt'),
        utilization: total ? (busy / total) * 100 : 0,
        throughput: total ? n / total : 0,
        switches
      }
    };
  }

  // describe(d): build the plain-language sentence for a decision (what was compared and why the winner won).
  function describe(d, cfg, running) {
    const list = d.candidates.map((c) => c.pid + (c.value == null ? '' : ' = ' + c.value) + (c.note ? ' ' + c.note : '')).join(', ');
    const only = d.candidates.length === 1;
    let s;
    if (d.metric === 'arrival') {
      s = only ? d.chosen + ' is the only process in the ready queue, so it runs.'
        : 'Ready queue, longest-waiting first: ' + d.candidates.map((c) => c.pid + ' (arrived ' + c.value + ')').join(', ') + '. ' + d.chosen + ' has waited longest, so it runs.';
    } else if (d.metric === 'queue') {
      s = only ? d.chosen + ' is the only process in the ready queue, so it runs.'
        : 'Queue, front first: ' + d.candidates.map((c) => c.pid).join(', ') + '. ' + d.chosen + ' is at the front, so it runs.';
    } else if (d.metric === 'tickets') {
      s = only ? d.chosen + ' is the only process in the ready queue, so it runs without a draw.'
        : 'Tickets: ' + list + ' (' + d.draw.total + ' in total). Ticket #' + d.draw.number + ' is drawn, and it belongs to ' + d.chosen + ', so ' + d.chosen + ' runs this quantum.';
    } else if (d.metric === 'priority number' || d.metric === 'effective priority') {
      const dir = cfg.lowerIsHigher ? 'a lower number means higher priority' : 'a higher number means higher priority';
      s = (only ? d.chosen + ' is the only candidate.' : (d.metric === 'effective priority' ? 'Effective priorities after aging' : 'Priority numbers') + ' (' + dir + '): ' + list + '. ' + d.chosen + ' has the best priority.');
    } else {
      s = only ? d.chosen + ' is the only candidate.' : 'Comparing ' + d.metric + ': ' + list + '. ' + d.chosen + ' has the smallest.';
    }
    if (d.tie) s += ' Tie on ' + d.metric + ': ' + d.tie + '.';
    if (running && d.chosen === running && !only) s += ' It is already running, so nothing changes.';
    return s;
  }

  // mergeTicks(ticks, upto): collapse the per-tick timeline ['P1','P1','P2',...] into Gantt segments
  // [{ pid, start, end }], optionally only up to tick `upto`.
  function mergeTicks(ticks, upto) {
    const segs = [];
    const n = Math.min(upto == null ? ticks.length : upto, ticks.length);
    for (let i = 0; i < n; i++) {
      const last = segs[segs.length - 1];
      if (last && last.pid === ticks[i]) last.end = i + 1;
      else segs.push({ pid: ticks[i], start: i, end: i + 1 });
    }
    return segs;
  }

  // simulateAll(rows, config): run every algorithm on the same problem for the Compare tab.
  function simulateAll(rows, config) {
    const out = {};
    COMPARE_ALGOS.forEach((a) => { out[a.id] = simulate(rows, Object.assign({}, config, { algo: a.id })); });
    return out;
  }

  /* ---------- classic textbook problems (answers are NOT stored; the engine computes them) ---------- */
  // Classic textbook INPUTS ([arrival, burst, priority] per process). Answers are never stored here;
  // the engine computes them, and tests/engines.test.js checks them against known results.
  const PRESETS = [
    { id: 'convoy', name: 'Convoy effect (FCFS)', algo: 'fcfs', quantum: 4,
      note: 'One long job first, two tiny ones behind it. Watch the short jobs wait.',
      rows: [[0, 24, 3], [0, 3, 1], [0, 3, 2]] },
    { id: 'sjf', name: 'Shortest job first', algo: 'sjf', quantum: 4,
      note: 'Four jobs arriving together. SJF puts the shortest first.',
      rows: [[0, 6, 2], [0, 8, 1], [0, 7, 3], [0, 3, 4]] },
    { id: 'srtf', name: 'Preemption (SRTF)', algo: 'srtf', quantum: 4,
      note: 'Late arrivals with short remaining time interrupt the running job.',
      rows: [[0, 8, 3], [1, 4, 1], [2, 9, 4], [3, 5, 2]] },
    { id: 'prio', name: 'Priority scheduling', algo: 'priority_np', quantum: 4,
      note: 'Lower number = higher priority. Burst time does not matter here.',
      rows: [[0, 10, 3], [0, 1, 1], [0, 2, 4], [0, 1, 5], [0, 5, 2]] },
    { id: 'rr', name: 'Round Robin, quantum 4', algo: 'rr', quantum: 4,
      note: 'Everyone gets a turn of at most 4 units, then goes to the back.',
      rows: [[0, 24, 1], [0, 3, 2], [0, 3, 3]] },
    { id: 'mixed', name: 'Mixed arrivals', algo: 'srtf', quantum: 3,
      note: 'Staggered arrivals: good for comparing all algorithms.',
      rows: [[0, 7, 3], [2, 4, 1], [4, 1, 2], [5, 4, 4]] },
    { id: 'idle', name: 'CPU idle gap', algo: 'fcfs', quantum: 2,
      note: 'Nothing is ready between time 3 and 10, so the CPU sits idle.',
      rows: [[0, 3, 1], [10, 2, 2], [11, 4, 3]] },
    { id: 'aging', name: 'Starvation fixed by aging', algo: 'priority_aging', quantum: 4, agingEvery: 2,
      note: 'P2 has a worse priority than P1. Without aging it waits for P1 to finish; with aging it overtakes P1 at time 6.',
      rows: [[0, 10, 1], [0, 2, 3]] },
    { id: 'lottery', name: 'Lottery: 3 tickets against 1', algo: 'lottery', quantum: 1, seed: 7,
      note: 'The Tickets column holds each process\'s tickets. P1 should get about three quarters of the CPU. Change the seed to see other draws.',
      rows: [[0, 8, 3], [0, 8, 1]] }
  ];

  NS.scheduling = { usesPriorityColumn, isSliced, COMPARE_ALGOS, ALGOS, BY_ID, LIMITS, PRESETS, validate, simulate, simulateAll, mergeTicks };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.scheduling;
})(typeof window !== 'undefined' ? window : globalThis);
