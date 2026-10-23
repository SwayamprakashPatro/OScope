/* Tier 2A: multi-level versus inverted page tables. For each virtual address, shows the index at every level,
   which tables had to be created, memory references per translation, and the memory each design needs. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxAccesses: 40, maxFrames: 4096 };
  const isP2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  const log2 = (n) => Math.round(Math.log2(n));

  // Split the page-number bits across the levels: lower levels get ceil(bits/levels), the top level gets the rest.
  function splitBits(vpnBits, levels) {
    const each = Math.ceil(vpnBits / levels), out = [];
    let left = vpnBits;
    for (let l = levels - 1; l >= 0; l--) { const b = l === 0 ? left : Math.min(each, left - l); out[l] = b; left -= b; }
    return out;
  }

  function parseAddr(s) { try { return /^0x/i.test(s) ? BigInt(s) : /^\d+$/.test(s) ? BigInt(s) : null; } catch (e) { return null; } }

  function run(cfg, text) {
    const errors = [], vbits = +cfg.vbits, page = +cfg.page, levels = +cfg.levels, entry = +cfg.entry, N = +cfg.frames;
    if (!Number.isInteger(vbits) || vbits < 12 || vbits > 48) errors.push('Virtual address bits must be 12 to 48.');
    if (!isP2(page) || page < 64) errors.push('Page size must be a power of 2, at least 64 bytes.');
    else if (log2(page) >= vbits) errors.push('Page size must be smaller than the address space.');
    if (![1, 2, 3, 4].includes(levels)) errors.push('Levels must be 1 to 4.');
    if (![2, 4, 8].includes(entry)) errors.push('Entry size must be 2, 4 or 8 bytes.');
    if (!Number.isInteger(N) || N < 2 || N > LIMITS.maxFrames) errors.push('Physical frames must be 2 to ' + LIMITS.maxFrames + '.');
    if (errors.length) return { ok: false, errors };
    const off = log2(page), vpnBits = vbits - off;
    if (levels > vpnBits) return { ok: false, errors: ['Too many levels for ' + vpnBits + ' page-number bits.'] };
    const bits = splitBits(vpnBits, levels), max = 1n << BigInt(vbits), acc = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/), pid = t.length === 2 ? t[0] : 'P', a = parseAddr(t[t.length - 1]);
      if (t.length > 2 || a === null) errors.push('Line ' + (i + 1) + ': write "address" or "process address", decimal or 0x hex.');
      else if (a >= max) errors.push('Line ' + (i + 1) + ': address is beyond ' + vbits + ' bits.');
      else acc.push({ pid, a });
    });
    if (!acc.length && !errors.length) errors.push('Enter at least one address.');
    if (acc.length > LIMITS.maxAccesses) errors.push('At most ' + LIMITS.maxAccesses + ' addresses.');
    if (errors.length) return { ok: false, errors };

    const nodeBytes = bits.map((b) => Math.pow(2, b) * entry), invEntry = entry * 2;   // inverted entry also holds process id + page number
    const nodes = new Set(), pids = [], buckets = Array.from({ length: N }, () => []); let nextFrame = 0, bytes = 0;
    const frames = [{ i: 0, text: 'No pages touched yet. Multi-level: no tables. Inverted: one fixed table of ' + N + ' entries.', stats: { nodes: 0, bytes: 0, inverted: N * invEntry, single: Math.pow(2, vpnBits) * entry, mapped: 0 }, bits }];
    let failed = false;
    acc.forEach((x, k) => {
      if (failed) return;
      const vpn = x.a >> BigInt(off), offset = Number(x.a & BigInt(page - 1)), idx = [];
      let rest = vpn; for (let l = levels - 1; l >= 0; l--) { idx[l] = Number(rest & ((1n << BigInt(bits[l])) - 1n)); rest >>= BigInt(bits[l]); }
      if (!pids.includes(x.pid)) pids.push(x.pid);
      const created = []; let path = x.pid;
      for (let l = 0; l < levels; l++) { const key = path; if (!nodes.has(key)) { nodes.add(key); created.push(l + 1); bytes += nodeBytes[l]; } path += '/' + idx[l]; }
      // inverted table: hash (page number + 31 * process number) to a bucket, then walk the chain comparing tags
      const b = Number((vpn + BigInt(31 * pids.indexOf(x.pid))) % BigInt(N)), chain = buckets[b], at = chain.findIndex((e) => e.pid === x.pid && e.vpn === vpn);
      let steps, frame, isNew = false;
      if (at >= 0) { steps = at + 1; frame = chain[at].frame; }
      else { if (nextFrame >= N) { failed = true; frames.push({ i: k + 1, addr: x.a, pid: x.pid, text: 'Physical memory is full (' + N + ' frames); the inverted table has no free entry. Stopping here.', error: true, stats: Object.assign({}, frames[frames.length - 1].stats), bits }); return; }
        steps = chain.length + 1; frame = nextFrame++; chain.push({ pid: x.pid, vpn, frame }); isNew = true; }
      const mapped = nextFrame;
      frames.push({ i: k + 1, pid: x.pid, addr: Number(x.a), vpn: Number(vpn), offset, idx, bits, created, bucket: b, steps, frame, isNew, refs: levels,
        text: x.pid + ' touches 0x' + x.a.toString(16) + ': page ' + vpn + ', offset ' + offset + '. Multi-level: indices ' + idx.join(' / ') + ' = ' + levels + ' table read' + (levels > 1 ? 's' : '') + (created.length ? ', created level ' + created.join(', ') + ' table' + (created.length > 1 ? 's' : '') + '.' : ', all tables already exist.') + ' Inverted: hash bucket ' + b + ', ' + steps + ' entr' + (steps === 1 ? 'y' : 'ies') + ' compared, ' + (isNew ? 'new' : 'existing') + ' frame ' + frame + '.',
        stats: { nodes: nodes.size, bytes, inverted: N * invEntry, single: Math.pow(2, vpnBits) * entry, mapped } });
    });
    const longest = Math.max(0, ...buckets.map((c) => c.length));
    return { ok: true, cfg: { vbits, page, levels, entry, frames: N }, bits, offsetBits: off, frames, nodeBytes, invEntry, longestChain: longest };
  }

  const PRESETS = [
    { id: 'sparse', name: 'Sparse program (32-bit)', note: 'Four touched pages far apart: the 2-level tree needs only 4 tables (16 KiB); a flat table would need 4 MiB.', cfg: { vbits: 32, page: 4096, levels: 2, entry: 4, frames: 16 }, text: '0x00000000\n0x00001000\n0x00400000\n0xFFFFF000' },
    { id: 'dense', name: 'Dense program', note: 'Neighbouring pages share their tables, so the tree stays small.', cfg: { vbits: 32, page: 4096, levels: 2, entry: 4, frames: 16 }, text: '0x1000\n0x2000\n0x3000\n0x4000\n0x5000' },
    { id: 'wide', name: '48-bit, 4 levels', note: 'A 64-bit style address space: flat table would be 512 GiB, the tree stays tiny.', cfg: { vbits: 48, page: 4096, levels: 4, entry: 8, frames: 16 }, text: '0x400000\n0x7FFFFFFFF000\n0x7FFFFFFFE000' },
    { id: 'two', name: 'Two processes', note: 'Each process needs its own tree; the inverted table is shared and fixed in size.', cfg: { vbits: 32, page: 4096, levels: 2, entry: 4, frames: 16 }, text: 'A 0x1000\nB 0x1000\nA 0x2000\nB 0x400000' }
  ];
  NS.ptables = { LIMITS, run, splitBits, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.ptables;
})(typeof window !== 'undefined' ? window : globalThis);
