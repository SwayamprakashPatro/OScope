/* Append-only log engine shared by two ideas: the LOG-STRUCTURED FILE SYSTEM (LFS) and the SSD's flash translation
   layer (FTL). Pure logic, no DOM.

   Both obey the same physical rule: you can only write into EMPTY space, and you can only empty a whole segment
   (LFS) or erase block (SSD) at once. So "overwrite" is really "write the new copy at the head of the log and mark
   the old copy dead". Dead pages pile up, and a cleaner / garbage collector must pick a victim segment, copy its
   still-live pages to the head, and erase it. Every copy is an EXTRA write, so:

       write amplification (WA) = (host writes + cleaner copies) / host writes

   Where they differ:
     LFS  segments are reused freely; the cost to watch is cleaning (WA). Cost-benefit cleaning weighs age too.
     SSD  each erase wears the flash out (limited program/erase cycles), so we also track erase counts and offer
          WEAR LEVELLING: none, dynamic (write to the least-worn free block), static (also move cold data off
          barely-worn blocks so they can share the load).

   Space bookkeeping: `blocks` are segments/erase blocks of `ppb` pages; `logical` is how many logical pages the host
   can address. The gap between logical and physical capacity is the spare area (over-provisioning) that gives the
   cleaner room to work. Everything shown is computed from the workload; nothing is canned. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { minBlocks: 6, maxBlocks: 16, minPpb: 4, maxPpb: 8, maxOps: 5000, maxFrames: 150, maxEndurance: 1000000, maxSpread: 50 };

  const MODES = [
    { id: 'lfs', name: 'Log-structured file system', short: 'LFS', unit: 'segment', page: 'block', hook: 'Never overwrite in place: append, then clean.' },
    { id: 'ssd', name: 'SSD flash translation layer', short: 'SSD', unit: 'erase block', page: 'page', hook: 'Flash can be written once, erased only in big blocks, and wears out.' }
  ];
  const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m]));
  const POLICIES = [
    { id: 'greedy', name: 'Greedy', rule: 'Clean the segment with the FEWEST live pages (least copying right now).' },
    { id: 'costbenefit', name: 'Cost-benefit', rule: 'Clean the segment with the best (1 - utilisation) x age / (1 + utilisation): old, mostly-dead segments first.' }
  ];
  const WEARS = [
    { id: 'none', name: 'No wear levelling', rule: 'New data goes to the first free block, so the same blocks are erased again and again.' },
    { id: 'dynamic', name: 'Dynamic', rule: 'New data goes to the least-erased free block. Blocks full of cold data never get erased, so they never share the wear.' },
    { id: 'static', name: 'Static', rule: 'Dynamic, plus: when the wear gap grows too big, the least-worn block\'s cold data is moved onto a worn block so the young block can take hot writes.' }
  ];

  function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function normCfg(c0) {
    const c = Object.assign({ mode: 'ssd', blocks: 8, ppb: 4, logical: 16, policy: 'greedy', wear: 'none', spread: 3, endurance: 3000, ops: 400, hotFrac: 20, hotWrites: 90, trimPct: 0, seed: 1, script: null }, c0 || {});
    const errors = [], int = (k, lo, hi, lab) => { const v = Number(c[k]); if (!Number.isInteger(v) || v < lo || v > hi) errors.push(lab + ' must be a whole number from ' + lo + ' to ' + hi + '.'); c[k] = v; };
    if (!MODE_BY_ID[c.mode]) errors.push('Unknown mode "' + c.mode + '".');
    if (!POLICIES.some((p) => p.id === c.policy)) errors.push('Unknown cleaning policy "' + c.policy + '".');
    if (!WEARS.some((w) => w.id === c.wear)) errors.push('Unknown wear-levelling choice "' + c.wear + '".');
    int('blocks', LIMITS.minBlocks, LIMITS.maxBlocks, 'Blocks'); int('ppb', LIMITS.minPpb, LIMITS.maxPpb, 'Pages per block');
    int('spread', 1, LIMITS.maxSpread, 'Wear-gap threshold'); int('endurance', 1, LIMITS.maxEndurance, 'Endurance'); int('ops', 1, LIMITS.maxOps, 'Operations');
    int('hotFrac', 1, 99, 'Hot data share'); int('hotWrites', 0, 100, 'Writes to hot data'); int('trimPct', 0, 50, 'Trim share'); int('seed', 0, 2147483647, 'Seed');
    if (!errors.length) {
      const maxL = (c.blocks - 3) * c.ppb;
      int('logical', 1, maxL, 'Logical pages (at most (blocks - 3) x pages per block = ' + maxL + ', to leave the cleaner room)');
    }
    if (c.mode === 'lfs') c.wear = 'none';
    return { cfg: c, errors };
  }

  function run(cfgIn) {
    const { cfg, errors } = normCfg(cfgIn);
    if (errors.length) return { ok: false, errors };
    const B = cfg.blocks, P = cfg.ppb, L = cfg.logical;
    const blocks = Array.from({ length: B }, () => ({ pg: new Array(P).fill(-1), st: new Array(P).fill(0), erase: 0, wp: 0, mtime: 0 })); // st: 0 free, 1 valid, 2 invalid
    const map = new Array(L).fill(null);
    let head = -1, now = 0;
    const S = { host: 0, copies: 0, erases: 0, trims: 0, gcRuns: 0, staticMoves: 0 };
    const hotCount = Math.max(1, Math.min(L - 1, Math.ceil(L * cfg.hotFrac / 100)));
    let log = [];
    const freeBlocks = () => { const f = []; for (let i = 0; i < B; i++) if (i !== head && blocks[i].wp === 0) f.push(i); return f; };
    const erases = () => blocks.map((b) => b.erase);
    const spread = () => { const e = erases(); return Math.max(...e) - Math.min(...e); };

    // allocFree(how): take an erased block as the new head. 'first' = lowest index, 'low' = least worn, 'high' = most worn.
    function allocFree(how) {
      const f = freeBlocks(); if (!f.length) throw new Error('out of free blocks');
      let pick = f[0];
      for (const i of f) if ((how === 'low' && blocks[i].erase < blocks[pick].erase) || (how === 'high' && blocks[i].erase > blocks[pick].erase)) pick = i;
      return pick;
    }
    const hostHow = () => (cfg.wear === 'none' ? 'first' : 'low');
    function program(lp, how, kind) {
      if (head === -1 || blocks[head].wp === P) head = allocFree(how);
      const b = blocks[head], p = b.wp++;
      b.pg[p] = lp; b.st[p] = 1; b.mtime = now; map[lp] = { b: head, p };
      if (b.wp === P) { /* block full: it becomes a closed block */ const full = head; head = -1; return full; }
      return -1;
    }
    function invalidate(lp) { const m = map[lp]; if (!m) return false; blocks[m.b].st[m.p] = 2; map[lp] = null; return true; }
    const validCount = (i) => blocks[i].st.filter((s) => s === 1).length;
    const closedCandidates = () => { const r = []; for (let i = 0; i < B; i++) if (i !== head && blocks[i].wp === P) r.push(i); return r; };

    function pickVictim() {
      const cands = closedCandidates(); if (!cands.length) return -1;
      if (cfg.wear === 'static' && spread() > cfg.spread) {
        let cold = cands[0]; for (const i of cands) if (blocks[i].erase < blocks[cold].erase) cold = i;
        if (blocks[cold].erase < Math.max(...erases())) return { v: cold, why: 'static wear levelling: least-worn block (cold data) moved' };
      }
      let best = cands[0], bestScore = -Infinity;
      for (const i of cands) {
        const u = validCount(i) / P; let score;
        if (cfg.policy === 'greedy') score = -u;
        else score = (1 - u) * Math.max(1, now - blocks[i].mtime) / (1 + u);
        if (score > bestScore + 1e-12 || (Math.abs(score - bestScore) <= 1e-12 && validCount(i) < validCount(best))) { best = i; bestScore = score; }
      }
      return { v: best, why: cfg.policy === 'greedy' ? 'greedy: fewest live pages' : 'cost-benefit: best (1-u) x age / (1+u)' };
    }
    // gcOnce(): copy the victim's live pages to the head of the log, erase it, record what happened.
    function gcOnce() {
      const pv = pickVictim(); if (pv === -1) throw new Error('nothing to clean');
      const v = pv.v, vb = blocks[v], live = []; for (let p = 0; p < P; p++) if (vb.st[p] === 1) live.push(vb.pg[p]);
      if (live.length === P && !(cfg.wear === 'static' && pv.why.startsWith('static'))) throw new Error('every candidate block is full of live data');
      const isStatic = pv.why.startsWith('static'); if (isStatic) S.staticMoves++;
      S.gcRuns++;
      for (const lp of live) { invalidate(lp); program(lp, isStatic ? 'high' : hostHow(), 'gc'); S.copies++; }
      vb.pg.fill(-1); vb.st.fill(0); vb.wp = 0; vb.erase++; S.erases++;
      log.push({ victim: v, live: live.length, why: pv.why });
    }
    // afterClose(): the cleaner runs when fewer than 2 erased blocks remain, keeping room to copy into.
    function afterClose() { let guard = 0; while (freeBlocks().length < 2) { gcOnce(); if (++guard > B * 4) throw new Error('the cleaner could not free space'); } }
    function hostWrite(lp) {
      const had = invalidate(lp); now++; S.host++;
      const closed = program(lp, hostHow(), 'host'); if (closed !== -1) afterClose();
      return had;
    }

    // snapshot(i, op): compact picture of every block for the player.
    const snap = (i, op) => ({ i, op, blocks: blocks.map((b, k) => ({ e: b.erase, head: k === head, pg: b.pg.map((lp, p) => (b.st[p] === 0 ? '.' : b.st[p] === 2 ? 'x' : lp < hotCount ? 'H' : 'C')).join('') })), stats: stats(), log: log.slice() });
    function stats() {
      const e = erases(), mx = Math.max(...e), mn = Math.min(...e), sum = e.reduce((a, b) => a + b, 0);
      return { host: S.host, copies: S.copies, erases: S.erases, trims: S.trims, gcRuns: S.gcRuns, staticMoves: S.staticMoves, wa: S.host ? (S.host + S.copies) / S.host : 1, maxErase: mx, minErase: mn, meanErase: sum / B, levelling: mx ? (sum / B) / mx : 1, wornPct: 100 * mx / cfg.endurance, eraseCounts: e };
    }

    try {
      // Phase 1 (fill): write every logical page once, so most of the device holds cold data. Counters restart after.
      for (let lp = 0; lp < L; lp++) hostWrite(lp);
      S.host = 0; S.copies = 0; S.gcRuns = 0; S.staticMoves = 0; S.trims = 0; log = [];
      const erasedAtFill = S.erases;
      const frames = [Object.assign(snap(0, { kind: 'start', text: 'After filling the device with ' + L + ' logical pages, all written once (most of it will now stay cold).' }), { text: 'After filling the device with ' + L + ' logical pages, all written once (most of it will now stay cold).' })];
      // Phase 2 (workload): a seeded mix of hot and cold writes (and trims).
      const rand = rng(cfg.seed), script = cfg.script, n = script ? script.length : cfg.ops;
      const stride = Math.max(1, Math.ceil(n / LIMITS.maxFrames));
      const pick = () => (rand() * 100 < cfg.hotWrites ? Math.floor(rand() * hotCount) : hotCount + Math.floor(rand() * (L - hotCount)));
      for (let k = 1; k <= n; k++) {
        let op;
        if (script) op = script[k - 1];
        else op = (cfg.trimPct && rand() * 100 < cfg.trimPct) ? { op: 't', lp: pick() } : { op: 'w', lp: pick() };
        if (op.op === 't') { if (invalidate(op.lp)) S.trims++; }
        else hostWrite(op.lp);
        if (k % stride === 0 || k === n) {
          const f = snap(k, op); f.text = 'After operation ' + k + ' of ' + n + (log.length ? ': the cleaner ran ' + log.length + ' time' + (log.length === 1 ? '' : 's') + ' since the previous picture.' : '.'); frames.push(f); log = [];
        }
      }
      const st = stats();
      st.lifeWrites = st.maxErase ? Math.round(S.host * cfg.endurance / st.maxErase) : null;
      st.idealLifeWrites = st.meanErase ? Math.round(S.host * cfg.endurance / st.meanErase) : null;
      st.erasesDuringWorkload = S.erases - erasedAtFill;
      return { ok: true, cfg, frames, stats: st, hotCount, map: map.slice(), blocks: blocks.map((b) => ({ pg: b.pg.slice(), st: b.st.slice(), erase: b.erase, wp: b.wp })) };
    } catch (e) { return { ok: false, errors: ['The simulation stopped: ' + e.message + '. Try more blocks or fewer logical pages.'] }; }
  }

  // compare(cfg): the same workload under each wear-levelling choice (SSD) or each cleaning policy (LFS).
  function compare(cfg) {
    const out = [];
    if ((cfg.mode || 'ssd') === 'lfs') POLICIES.forEach((p) => { const r = run(Object.assign({}, cfg, { policy: p.id })); out.push({ id: p.id, name: p.name, stats: r.ok ? r.stats : null }); });
    else WEARS.forEach((w) => { const r = run(Object.assign({}, cfg, { wear: w.id })); out.push({ id: w.id, name: w.name, stats: r.ok ? r.stats : null }); });
    return out;
  }

  const PRESETS = [
    { id: 'ssd-hot', name: 'SSD: hot and cold data, no levelling', cfg: { mode: 'ssd', blocks: 10, ppb: 4, logical: 24, policy: 'greedy', wear: 'none', spread: 3, endurance: 3000, ops: 600, hotFrac: 15, hotWrites: 90, trimPct: 0, seed: 3 }, note: 'Most writes hit a small hot set. With no wear levelling a few blocks take nearly all the erases while others stay untouched.' },
    { id: 'ssd-static', name: 'SSD: the same, with static levelling', cfg: { mode: 'ssd', blocks: 10, ppb: 4, logical: 24, policy: 'greedy', wear: 'static', spread: 3, endurance: 3000, ops: 600, hotFrac: 15, hotWrites: 90, trimPct: 0, seed: 3 }, note: 'Same workload, same seed. Static levelling spends a few extra copies to even the wear, so the busiest block is erased far less.' },
    { id: 'ssd-full', name: 'SSD: nearly full (little spare area)', cfg: { mode: 'ssd', blocks: 10, ppb: 4, logical: 28, policy: 'greedy', wear: 'dynamic', spread: 3, endurance: 3000, ops: 600, hotFrac: 20, hotWrites: 80, trimPct: 0, seed: 5 }, note: 'With 28 of 40 pages in use the cleaner finds few dead pages per victim, so write amplification climbs.' },
    { id: 'ssd-trim', name: 'SSD: with TRIM', cfg: { mode: 'ssd', blocks: 10, ppb: 4, logical: 28, policy: 'greedy', wear: 'dynamic', spread: 3, endurance: 3000, ops: 600, hotFrac: 20, hotWrites: 80, trimPct: 25, seed: 5 }, note: 'TRIM tells the drive which pages the OS no longer needs, so the cleaner has less live data to copy.' },
    { id: 'lfs-greedy', name: 'LFS: greedy cleaner', cfg: { mode: 'lfs', blocks: 10, ppb: 4, logical: 24, policy: 'greedy', wear: 'none', spread: 3, endurance: 3000, ops: 600, hotFrac: 15, hotWrites: 90, trimPct: 0, seed: 3 }, note: 'Greedy always cleans the emptiest segment, even if it is still being rewritten.' },
    { id: 'lfs-cb', name: 'LFS: cost-benefit cleaner', cfg: { mode: 'lfs', blocks: 10, ppb: 4, logical: 24, policy: 'costbenefit', wear: 'none', spread: 3, endurance: 3000, ops: 600, hotFrac: 15, hotWrites: 90, trimPct: 0, seed: 3 }, note: 'Cost-benefit leaves hot segments alone a little longer: their data is about to die anyway.' }
  ];

  const api = { LIMITS, MODES, MODE_BY_ID, POLICIES, WEARS, PRESETS, normCfg, run, compare, rng };
  NS.flashlog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
