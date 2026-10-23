/* Tier 2A: CPU cache mapping. Splits each address into tag / set index / block offset and replays accesses on a
   direct-mapped, set-associative or fully-associative cache. Classifies every miss as compulsory, capacity or conflict. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxAccesses: 60 };
  const isP2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  const log2 = (n) => Math.round(Math.log2(n));

  function run(cfg, text) {
    const errors = [], size = +cfg.size, block = +cfg.block, abits = +cfg.abits, repl = cfg.repl, hitT = +cfg.hitTime, penalty = +cfg.penalty;
    if (!isP2(size) || size < 16 || size > 65536) errors.push('Cache size must be a power of 2 from 16 to 65536 bytes.');
    if (!isP2(block) || block > size) errors.push('Block size must be a power of 2 and no larger than the cache.');
    if (!Number.isInteger(abits) || abits < 6 || abits > 32) errors.push('Address bits must be 6 to 32.');
    if (!['LRU', 'FIFO'].includes(repl)) errors.push('Replacement must be LRU or FIFO.');
    if (!(hitT >= 0) || !(penalty >= 0)) errors.push('Hit time and miss penalty must be 0 or more.');
    const nBlocks = errors.length ? 0 : size / block, ways = cfg.ways === 'full' ? nBlocks : +cfg.ways;
    if (!errors.length && (!isP2(ways) || ways > nBlocks)) errors.push('Ways must be a power of 2 no larger than ' + nBlocks + ' (the number of blocks), or "full".');
    const acc = [];
    String(text || '').split(/[\n,\s]+/).filter(Boolean).forEach((s) => { const a = /^0x/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? +s : NaN; if (!(a >= 0) || a >= Math.pow(2, abits || 0)) errors.push('"' + s + '" is not an address within ' + abits + ' bits.'); else acc.push(a); });
    if (!acc.length && !errors.length) errors.push('Enter at least one address.');
    if (acc.length > LIMITS.maxAccesses) errors.push('At most ' + LIMITS.maxAccesses + ' accesses.');
    if (errors.length) return { ok: false, errors };

    const sets = nBlocks / ways, offB = log2(block), idxB = log2(sets), tagB = abits - offB - idxB;
    if (tagB < 0) return { ok: false, errors: ['Address bits are too few for this cache geometry (needs at least ' + (offB + idxB) + ').'] };
    const cache = Array.from({ length: sets }, () => Array.from({ length: ways }, () => null)), shadow = [], seen = new Set();
    const st = { hits: 0, misses: 0, cold: 0, capacity: 0, conflict: 0 };
    const snap = () => cache.map((s) => s.map((w) => (w ? { block: w.block, tag: w.tag } : null)));
    const frames = [{ i: 0, text: 'Cache empty: ' + sets + ' set' + (sets > 1 ? 's' : '') + ' of ' + ways + ' way' + (ways > 1 ? 's' : '') + ', ' + block + '-byte blocks. Address = ' + tagB + ' tag + ' + idxB + ' index + ' + offB + ' offset bits.', sets: snap(), stats: Object.assign({}, st) }];
    acc.forEach((a, k) => {
      const blk = Math.floor(a / block), off = a % block, idx = blk % sets, tag = Math.floor(blk / sets), set = cache[idx];
      const at = set.findIndex((w) => w && w.block === blk), shAt = shadow.indexOf(blk); let kind, evicted = null, way = at;
      if (at >= 0) { kind = 'hit'; st.hits++; if (repl === 'LRU') set[at].t = k; }
      else {
        st.misses++;
        kind = !seen.has(blk) ? 'cold' : shAt >= 0 ? 'conflict' : 'capacity'; st[kind]++;
        let v = set.findIndex((w) => !w);
        if (v < 0) { v = 0; set.forEach((w, j) => { if (w.t < set[v].t) v = j; }); evicted = set[v].block; }
        set[v] = { block: blk, tag, t: k }; way = v;
      }
      seen.add(blk); if (shAt >= 0) shadow.splice(shAt, 1); shadow.push(blk); if (shadow.length > nBlocks) shadow.shift();   // shadow = fully-associative LRU of the same size
      frames.push({ i: k + 1, addr: a, block: blk, tag, idx, off, hit: kind === 'hit', kind, way, evicted, sets: snap(), stats: Object.assign({}, st),
        text: '0x' + a.toString(16) + ' → block ' + blk + ': tag ' + tag + ', set ' + idx + ', offset ' + off + '. ' + (kind === 'hit' ? 'Hit: the block is already in set ' + idx + '.' : 'Miss (' + { cold: 'compulsory: first time this block is used', capacity: 'capacity: the cache is too small to have kept it, even fully associative', conflict: 'conflict: a fully associative cache of the same size would have kept it, but the set mapping evicted it' }[kind] + '). Loaded into way ' + way + (evicted !== null ? ', evicting block ' + evicted + ' (' + repl + ')' : '') + '.') });
    });
    const n = acc.length, missRate = st.misses / n;
    return { ok: true, cfg: { size, block, ways, sets, repl, abits }, bits: { tag: tagB, index: idxB, offset: offB }, frames, stats: Object.assign({}, st, { n, hitRate: st.hits / n, missRate, amat: hitT + missRate * penalty }) };
  }

  const PRESETS = [
    { id: 'conflict', name: 'Conflict misses', note: 'Direct-mapped: 0x00 and 0x40 fight for set 0 although the cache is nearly empty. Change ways to 2 and they coexist.', cfg: { size: 64, block: 16, ways: '1', repl: 'LRU', abits: 8, hitTime: 1, penalty: 20 }, text: '0x00 0x40 0x00 0x40 0x00 0x40' },
    { id: 'spatial', name: 'Spatial locality', note: 'Walking through consecutive bytes: one miss per block, then hits.', cfg: { size: 64, block: 16, ways: '1', repl: 'LRU', abits: 8, hitTime: 1, penalty: 20 }, text: '0x00 0x01 0x02 0x03 0x10 0x11 0x12 0x13 0x20 0x21' },
    { id: 'capacity', name: 'Capacity misses', note: 'Five blocks cycle through a four-block cache: even full associativity cannot help.', cfg: { size: 64, block: 16, ways: 'full', repl: 'LRU', abits: 8, hitTime: 1, penalty: 20 }, text: '0x00 0x10 0x20 0x30 0x40 0x00 0x10 0x20 0x30 0x40' },
    { id: 'assoc', name: '2-way set associative', note: 'The same pattern as the conflict preset, but two ways per set remove the conflicts.', cfg: { size: 64, block: 16, ways: '2', repl: 'LRU', abits: 8, hitTime: 1, penalty: 20 }, text: '0x00 0x40 0x00 0x40 0x00 0x40' }
  ];
  NS.cachemap = { LIMITS, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.cachemap;
})(typeof window !== 'undefined' ? window : globalThis);
