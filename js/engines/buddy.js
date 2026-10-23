/* Tier 2A: buddy system allocator. Memory is split in halves ("buddies") until a block just fits the request;
   freeing merges a block with its buddy when both are free. Pure logic: input in, frames out. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxOps: 40 };
  const isP2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

  function parse(text, errors) {
    const ops = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      let m;
      if ((m = /^alloc\s+(\S+)\s+(\d+)$/i.exec(line))) { if (+m[2] < 1) errors.push('Line ' + (i + 1) + ': size must be at least 1.'); else ops.push({ op: 'alloc', id: m[1], size: +m[2] }); }
      else if ((m = /^free\s+(\S+)$/i.exec(line))) ops.push({ op: 'free', id: m[1] });
      else errors.push('Line ' + (i + 1) + ': write "alloc NAME SIZE" or "free NAME".');
    });
    if (ops.length > LIMITS.maxOps) errors.push('At most ' + LIMITS.maxOps + ' operations.');
    return ops;
  }

  function run(cfg, text) {
    const errors = [], total = +cfg.total, min = +cfg.min;
    if (!isP2(total) || total < 8 || total > 4096) errors.push('Total memory must be a power of 2 from 8 to 4096.');
    if (!isP2(min) || min > total) errors.push('Smallest block must be a power of 2 and no larger than the total.');
    const ops = parse(text, errors);
    if (!ops.length && !errors.length) errors.push('Enter at least one operation.');
    if (errors.length) return { ok: false, errors };

    const free = new Map([[total, [0]]]);          // block size -> sorted list of free start addresses
    const used = new Map();                          // name -> { start, size, req }
    const lst = (s) => { if (!free.has(s)) free.set(s, []); return free.get(s); };
    const snap = (i, op, t, ok) => {
      const blocks = [];
      free.forEach((starts, size) => starts.forEach((start) => blocks.push({ start, size, state: 'free' })));
      used.forEach((u, id) => blocks.push({ start: u.start, size: u.size, state: 'used', id, req: u.req }));
      blocks.sort((a, b) => a.start - b.start);
      const lists = {}; for (let s = min; s <= total; s *= 2) lists[s] = (free.get(s) || []).slice();
      const usedSum = [...used.values()].reduce((a, u) => a + u.size, 0), req = [...used.values()].reduce((a, u) => a + u.req, 0);
      const freeSum = total - usedSum, largest = blocks.filter((b) => b.state === 'free').reduce((a, b) => Math.max(a, b.size), 0);
      return { i, op, text: t, ok, blocks, lists, stats: { total, used: usedSum, free: freeSum, internal: usedSum - req, largestFree: largest } };
    };
    const frames = [snap(0, null, 'All ' + total + ' units are one free block.', true)];

    ops.forEach((op, k) => {
      if (op.op === 'alloc') {
        if (used.has(op.id)) { frames.push(snap(k + 1, op, op.id + ' is already allocated; free it first.', false)); return; }
        let s = min; while (s < op.size) s *= 2;       // round the request up to a power of two
        if (s > total) { frames.push(snap(k + 1, op, 'alloc ' + op.id + ' ' + op.size + ': needs a ' + s + ' block but memory is only ' + total + '.', false)); return; }
        let from = 0; for (let c = s; c <= total; c *= 2) if (lst(c).length) { from = c; break; }
        if (!from) {
          const freeNow = total - [...used.values()].reduce((a, u) => a + u.size, 0);
          frames.push(snap(k + 1, op, 'alloc ' + op.id + ' ' + op.size + ': needs a ' + s + ' block, none free.' + (freeNow >= s ? ' ' + freeNow + ' units are free in total but split into smaller pieces that are not buddies: external fragmentation.' : ' Only ' + freeNow + ' units are free.'), false)); return;
        }
        let list = lst(from); list.sort((a, b) => a - b); let start = list.shift(), c = from; const steps = [];
        while (c > s) { c /= 2; lst(c).push(start + c); lst(c).sort((a, b) => a - b); steps.push('split ' + (c * 2) + '@' + start + ' into ' + c + '@' + start + ' and ' + c + '@' + (start + c)); }
        used.set(op.id, { start, size: s, req: op.size });
        frames.push(snap(k + 1, op, 'alloc ' + op.id + ' ' + op.size + ': round up to ' + s + (s === op.size ? ' (exact fit)' : '') + '. Smallest free block that fits: ' + from + '@' + (steps.length ? start : start) + '. ' + (steps.length ? steps.join('; ') + '. ' : 'No split needed. ') + op.id + ' gets ' + s + '@' + start + ', wasting ' + (s - op.size) + ' inside the block (internal fragmentation).', true));
      } else {
        const u = used.get(op.id);
        if (!u) { frames.push(snap(k + 1, op, 'free ' + op.id + ': nothing with that name is allocated.', false)); return; }
        used.delete(op.id); let start = u.start, size = u.size; const steps = [];
        while (size < total) {
          const buddy = start ^ size, l = lst(size), at = l.indexOf(buddy);
          if (at < 0) { steps.push('buddy ' + size + '@' + buddy + ' is not a free block of the same size, stop'); break; }
          l.splice(at, 1); steps.push('merge with free buddy ' + size + '@' + buddy + ' into ' + (size * 2) + '@' + Math.min(start, buddy)); start = Math.min(start, buddy); size *= 2;
        }
        lst(size).push(start); lst(size).sort((a, b) => a - b);
        frames.push(snap(k + 1, op, 'free ' + op.id + ' (' + u.size + '@' + u.start + '): ' + steps.join('; ') + (size === total ? '; memory is one block again' : '') + '. Free block: ' + size + '@' + start + '.', true));
      }
    });
    return { ok: true, cfg: { total, min }, frames };
  }

  const PRESETS = [
    { id: 'basic', name: 'Split and merge', note: 'A, B and C leave memory split; freeing C merges all the way up to a 32 block.', cfg: { total: 64, min: 4 }, text: 'alloc A 10\nalloc B 20\nalloc C 5\nfree A\nfree C' },
    { id: 'frag', name: 'Fragmentation', note: 'Plenty of free memory in total, but no single block big enough.', cfg: { total: 64, min: 4 }, text: 'alloc A 16\nalloc B 16\nalloc C 16\nalloc D 16\nfree A\nfree C\nalloc E 32' },
    { id: 'waste', name: 'Internal waste', note: 'Requests just over a power of two waste almost half the block.', cfg: { total: 128, min: 8 }, text: 'alloc A 33\nalloc B 17\nalloc C 9' }
  ];
  NS.buddy = { LIMITS, run, parse, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.buddy;
})(typeof window !== 'undefined' ? window : globalThis);
