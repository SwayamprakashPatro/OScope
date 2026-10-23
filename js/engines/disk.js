/* Disk scheduling engine: FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK. Pure logic.
   Produces a list of head moves; every number is computed from the request queue. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // ALGOS: teaching text for each policy. `scan: true` marks the sweep-based algorithms, which need an
  // initial head direction.
  const ALGOS = [
    { id: 'fcfs', short: 'FCFS', name: 'First Come, First Served', scan: false,
      rule: 'Serve requests in the order they arrived. The head zig-zags wherever the queue sends it.',
      hook: 'A waiter who serves tables strictly in order of ordering, however far apart they are.',
      watch: 'Fair, but the head can swing wildly back and forth, so total seek distance is large.' },
    { id: 'sstf', short: 'SSTF', name: 'Shortest Seek Time First', scan: false,
      rule: 'From the current head position, always serve the pending request that is closest.',
      hook: 'Always grab the nearest snack. Efficient, but the far-away one may wait forever.',
      watch: 'Starvation: requests far from the busy area can be postponed indefinitely.' },
    { id: 'scan', short: 'SCAN', name: 'SCAN (elevator)', scan: true,
      rule: 'Sweep the head in one direction serving requests on the way, all the way to the disk edge, then reverse.',
      hook: 'An elevator: goes to the top floor, then comes back down, picking up everyone on the way.',
      watch: 'Requests just behind the head wait for a full sweep. It always travels to the very edge.' },
    { id: 'cscan', short: 'C-SCAN', name: 'Circular SCAN', scan: true,
      rule: 'Sweep in one direction to the edge, then jump back to the other edge and sweep again in the same direction.',
      hook: 'A one-way conveyor belt: serve on the way out, then fast-return empty.',
      watch: 'More uniform waiting time than SCAN. Whether the return jump counts as seek distance depends on your textbook.' },
    { id: 'look', short: 'LOOK', name: 'LOOK', scan: true,
      rule: 'Like SCAN, but the head reverses at the last request in its direction instead of going to the edge.',
      hook: 'A smart elevator that turns around at the highest floor anyone pressed.',
      watch: 'Saves the useless trip to the edge. Same starvation behaviour as SCAN for requests behind the head.' },
    { id: 'clook', short: 'C-LOOK', name: 'Circular LOOK', scan: true,
      rule: 'Like C-SCAN, but only travel as far as the last request, then jump to the first request on the other side.',
      hook: 'The conveyor belt that only runs as far as the last parcel.',
      watch: 'Same convention question as C-SCAN: does the return jump count?' }
  ];
  const BY_ID = {};
  ALGOS.forEach((a) => { BY_ID[a.id] = a; });

  // Input caps: number of cylinders and requests.
  const LIMITS = { maxCyl: 1000, maxReq: 30 };

  // parseQueue: '98 183 37' -> [98, 183, 37], the cylinder numbers requested, in arrival order.
  const parseQueue = (t) => String(t).split(/[\s,;]+/).filter(Boolean).map(Number);

  // validate: readable errors for a bad disk size, empty queue, head or requests outside 0..cylinders-1.
  function validate(requests, head, cyl) {
    const errors = [];
    if (!Number.isInteger(cyl) || cyl < 2 || cyl > LIMITS.maxCyl) errors.push('The disk needs 2 to ' + LIMITS.maxCyl + ' cylinders.');
    if (!requests.length) errors.push('Enter at least one request.');
    if (requests.length > LIMITS.maxReq) errors.push('Use at most ' + LIMITS.maxReq + ' requests.');
    if (!Number.isInteger(head) || head < 0 || (Number.isInteger(cyl) && head >= cyl)) errors.push('The head must start on a cylinder from 0 to ' + (cyl - 1) + '.');
    requests.forEach((r, i) => { if (!Number.isInteger(r) || r < 0 || r >= cyl) errors.push('Request ' + (i + 1) + ' must be a cylinder from 0 to ' + (cyl - 1) + '.'); });
    return { ok: !errors.length, errors };
  }

  // simulate: decide the *order* in which requests are served (the only thing the algorithms differ in),
  // recording each head movement as a `move`. Then build one frame per move with the running total.
  // Total seek distance = sum of |from - to| over all counted moves.
  function simulate(requests, head, cyl, algoId, config) {
    // Conventions that differ between textbooks:
    //   direction - initial sweep direction for the SCAN family
    //   countJump - does the C-SCAN / C-LOOK return jump count toward the total?
    //   sstfTie   - equal distances: take the lower or the higher cylinder?
    const cfg = Object.assign({ direction: 'up', countJump: true, sstfTie: 'lower' }, config);
    const last = cyl - 1, up = cfg.direction === 'up';
    // moves: the output of the algorithm, e.g. { from: 53, to: 65, kind: 'service', dist: 12, ... }.
    // kind is 'service' (a request is served), 'edge' (travel to the disk edge), or 'jump' (circular return).
    const moves = [];
    let pos = head;
    const pending = requests.map((c, i) => ({ c, i, done: false }));
    // move(): record a head movement from the current position and update the position.
    const move = (to, kind, why) => { moves.push({ from: pos, to, kind, why, dist: Math.abs(to - pos), counted: !(kind === 'jump' && !cfg.countJump) }); pos = to; };
    // Split the requests around the head: `hi` = at or above it (ascending), `lo` = below it (descending),
    // both already in the order a sweep would meet them.
    const hi = requests.filter((c) => c >= head).sort((a, b) => a - b);
    const lo = requests.filter((c) => c < head).sort((a, b) => b - a);

    // FCFS: simply the arrival order.
    if (algoId === 'fcfs') {
      requests.forEach((c) => move(c, 'service', 'next in the queue'));
    // SSTF: repeatedly pick the pending request nearest to the head (ties per the sstfTie setting).
    } else if (algoId === 'sstf') {
      const rem = requests.slice();
      while (rem.length) {
        let best = 0;
        rem.forEach((c, k) => {
          const d = Math.abs(c - pos), bd = Math.abs(rem[best] - pos);
          if (d < bd || (d === bd && (cfg.sstfTie === 'lower' ? c < rem[best] : c > rem[best]))) best = k;
        });
        const c = rem.splice(best, 1)[0];
        const ds = rem.concat([c]).map((x) => '|' + pos + '−' + x + '| = ' + Math.abs(x - pos));
        move(c, 'service', 'closest pending request. Distances: ' + ds.join(', '));
      }
    // SCAN (elevator): serve everything in the current direction, travel to the disk edge, reverse and
    // serve the rest.
    } else if (algoId === 'scan') {
      const firstGroup = up ? hi : lo; // already in sweep order
      firstGroup.forEach((c) => move(c, 'service', 'on the way ' + (up ? 'up' : 'down')));
      const edge = up ? last : 0;
      if (pos !== edge) move(edge, 'edge', 'SCAN always travels to the disk edge before reversing');
      const back = up ? lo : hi.slice().sort((a, b) => a - b);
      back.forEach((c) => move(c, 'service', 'on the way back'));
    // LOOK: like SCAN but reverse at the last request instead of travelling to the edge.
    } else if (algoId === 'look') {
      const g1 = up ? hi : lo, g2 = up ? lo : hi.slice().sort((a, b) => a - b);
      g1.forEach((c) => move(c, 'service', 'on the way ' + (up ? 'up' : 'down')));
      g2.forEach((c, k) => move(c, 'service', k === 0 ? 'LOOK turns around at the last request and goes back' : 'on the way back'));
    // C-SCAN: serve in one direction to the edge, then jump to the opposite edge and sweep the same way
    // again. Requests are served in only one direction.
    } else if (algoId === 'cscan') {
      const g1 = up ? hi : lo;
      g1.forEach((c) => move(c, 'service', 'on the way ' + (up ? 'up' : 'down')));
      const edge = up ? last : 0, other = up ? 0 : last;
      const g2 = up ? lo.slice().sort((a, b) => a - b) : hi.slice().sort((a, b) => b - a);
      if (pos !== edge) move(edge, 'edge', 'C-SCAN goes to the disk edge');
      if (g2.length) {
        move(other, 'jump', 'jump back to the other edge (no requests are served during the jump)');
        g2.forEach((c) => move(c, 'service', 'sweeping ' + (up ? 'up' : 'down') + ' again'));
      }
    // C-LOOK: like C-SCAN, but the sweep ends at the last request and the jump goes straight to the
    // first request on the other side.
    } else if (algoId === 'clook') {
      const g1 = up ? hi : lo;
      g1.forEach((c) => move(c, 'service', 'on the way ' + (up ? 'up' : 'down')));
      const g2 = up ? lo.slice().sort((a, b) => a - b) : hi.slice().sort((a, b) => b - a);
      g2.forEach((c, k) => move(c, k === 0 ? 'jump' : 'service', k === 0 ? 'jump to the nearest request on the other side (no requests are served during the jump)' : 'sweeping ' + (up ? 'up' : 'down') + ' again'));
    }

    // Build one frame per move: head position, running total, requests still pending, and the working
    // string '|53-65| + |65-67| + ... = total' shown to the student.
    // frames
    const frames = [];
    let total = 0, served = 0;
    const remaining = requests.slice();
    // markServed(c): remove every pending request at cylinder c (duplicates are served together).
    const markServed = (cyl2) => { let n = 0; for (let k = remaining.length - 1; k >= 0; k--) if (remaining[k] === cyl2) { remaining.splice(k, 1); n++; } return n; };
    frames.push({ k: 0, pos: head, total: 0, pending: remaining.slice(), served: 0, text: 'The head starts at cylinder ' + head + ' with ' + requests.length + ' request' + (requests.length === 1 ? '' : 's') + ' waiting.', move: null, working: '' });
    // Moves not counted (the return jump when countJump is off) appear in brackets in the working.
    const terms = [];
    moves.forEach((m, i) => {
      if (m.counted) total += m.dist;
      let got = 0;
      got = markServed(m.to);
      served += got;
      terms.push((m.counted ? '' : '(') + '|' + m.from + '−' + m.to + '|' + (m.counted ? '' : ')'));
      const kindText = { service: 'Serve cylinder ' + m.to, edge: 'Move to the edge, cylinder ' + m.to, jump: 'Jump to cylinder ' + m.to, turn: 'Turn' }[m.kind];
      frames.push({
        k: i + 1, pos: m.to, total, pending: remaining.slice(), served, move: m,
        text: kindText + ': ' + m.why + '. Move ' + m.from + ' → ' + m.to + ' = ' + m.dist + ' cylinders' + (m.counted ? '.' : ' (not counted in the total).') + (got ? '' : ''),
        working: terms.join(' + ') + ' = ' + total
      });
    });
    // Summary numbers: total, average per request, and how many jumps happened.
    const counted = moves.filter((m) => m.counted);
    return { algo: algoId, cfg, head, cyl, moves, frames, total, avg: requests.length ? total / requests.length : 0, jumps: moves.filter((m) => m.kind === 'jump').length, countedMoves: counted.length };
  }

  // simulateAll: run every algorithm on the same queue for the Compare tab.
  function simulateAll(requests, head, cyl, config) {
    const out = {};
    ALGOS.forEach((a) => { out[a.id] = simulate(requests, head, cyl, a.id, config); });
    return out;
  }

  /* ---------- disk geometry: where does the time go? ----------
     Scheduling only reorders requests, so it only changes the SEEK part of a disk access. Each request also
     costs rotational latency (waiting for the sector to come under the head) and transfer time (reading it).
       full rotation  = 60000 / rpm  milliseconds
       rotational latency (average) = half a rotation, because the sector is on average half a turn away
       transfer time  = one rotation / sectors per track   (reading one sector)
       seek time      = cylinders moved x time per cylinder
     The model is deliberately simple (no settle time, linear seek) so every number can be checked by hand. */
  const TIME_DEFAULTS = { rpm: 7200, seekPerCylMs: 0.1, sectors: 200 };
  const TIME_LIMITS = { rpm: [1000, 20000], seekPerCylMs: [0.001, 5], sectors: [1, 2000] };

  // validateTime(p): readable errors for the three geometry inputs.
  function validateTime(p) {
    const errors = [];
    const chk = (k, label, int) => {
      const v = Number(p[k]), [lo, hi] = TIME_LIMITS[k];
      if (p[k] === '' || p[k] == null || !Number.isFinite(v) || v < lo || v > hi || (int && !Number.isInteger(v))) errors.push(label + ' must be ' + (int ? 'a whole number ' : 'a number ') + 'from ' + lo + ' to ' + hi + '.');
    };
    chk('rpm', 'Spindle speed (RPM)', true); chk('seekPerCylMs', 'Seek time per cylinder (ms)', false); chk('sectors', 'Sectors per track', true);
    return { ok: !errors.length, errors };
  }

  // diskTime(totalCyl, nReq, p): the time breakdown for serving nReq requests that need totalCyl cylinders of
  // head movement. All values in milliseconds. `seekShare` is the fraction of the total spent seeking.
  function diskTime(totalCyl, nReq, p) {
    const q = Object.assign({}, TIME_DEFAULTS, p);
    const rotation = 60000 / q.rpm;
    const seekMs = totalCyl * q.seekPerCylMs;
    const rotMs = nReq * (rotation / 2);
    const xferMs = nReq * (rotation / q.sectors);
    const totalMs = seekMs + rotMs + xferMs;
    return { rotationPeriodMs: rotation, avgRotationalMs: rotation / 2, transferPerSectorMs: rotation / q.sectors, seekMs, rotMs, xferMs, totalMs, seekShare: totalMs ? seekMs / totalMs : 0, perRequestMs: nReq ? totalMs / nReq : 0 };
  }

  // Example INPUTS (the classic Galvin queue and some edge cases). Totals are computed by simulate().
  const PRESETS = [
    { id: 'galvin', name: 'Textbook queue (Galvin)', queue: '98 183 37 122 14 124 65 67', head: 53, cyl: 200, direction: 'down', note: 'The classic: head at 53 on a 200-cylinder disk. Try every algorithm. SCAN here moves toward 0 first.' },
    { id: 'up', name: 'Same queue, sweeping up', queue: '98 183 37 122 14 124 65 67', head: 53, cyl: 200, direction: 'up', note: 'Direction matters for SCAN, C-SCAN, LOOK and C-LOOK.' },
    { id: 'starve', name: 'SSTF and the far request', queue: '199 98 102 97 103 96 104', head: 100, cyl: 200, direction: 'up', note: 'The request at 199 arrived first, but SSTF serves it last because neighbours keep being closer.' },
    { id: 'edge', name: 'Head at the edge', queue: '10 40 25 70 5', head: 0, cyl: 100, direction: 'up', note: 'The head starts at cylinder 0. See how each algorithm behaves with nothing behind it.' }
  ];

  NS.disk = { TIME_DEFAULTS, TIME_LIMITS, validateTime, diskTime, ALGOS, BY_ID, LIMITS, PRESETS, parseQueue, validate, simulate, simulateAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.disk;
})(typeof window !== 'undefined' ? window : globalThis);
