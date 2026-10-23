/* Tier 2B: file allocation methods. Replays create / append / delete / read on a small disk using contiguous, linked,
   indexed, FAT or Unix-inode allocation and reports where blocks go, the metadata overhead and the cost of reading. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxOps: 30 };
  const METHODS = [
    { id: 'contiguous', name: 'Contiguous', short: 'Contiguous', about: { rule: 'Each file occupies one run of neighbouring blocks. The directory stores the start block and the length.', watch: 'Fast sequential and direct access, but files cannot grow in place and free space splits into holes (external fragmentation).' }, hook: 'A book on a shelf: all pages together, so it needs a gap as long as the book.' },
    { id: 'linked', name: 'Linked', short: 'Linked', about: { rule: 'Blocks can be anywhere. Each block holds a pointer to the next one; the directory stores the first block.', watch: 'No external fragmentation, but reaching block k means following k pointers (k extra disk reads), and one damaged pointer loses the rest of the file.' }, hook: 'A treasure hunt: every clue tells you where the next one is.' },
    { id: 'indexed', name: 'Indexed', short: 'Indexed', about: { rule: 'One index block lists the file\'s data blocks. Any block is found by looking up the index.', watch: 'Direct access without fragmentation, but an index block per file is overhead, and one index block holds only a limited number of pointers.' }, hook: 'A table of contents: look up the page, jump straight to it.' },
    { id: 'fat', name: 'FAT', short: 'FAT', about: { rule: 'The "next block" pointers are collected in one table (the file allocation table) with an entry per disk block. The chain for a file is followed in this table.', watch: 'Chain walking happens in the table, which is usually cached in RAM, so only the final data read touches the disk. The whole table must stay in memory to be fast.' }, hook: 'Linked allocation with the clues copied onto one cheat sheet.' },
    { id: 'inode', name: 'Unix inode', short: 'inode', about: { rule: 'An inode holds file attributes, a few direct block pointers, then a single indirect and a double indirect block for larger files.', watch: 'Small files (the majority) cost one inode and are read in two accesses; big files cost extra indirect blocks and one or two extra reads.' }, hook: 'A filing cabinet: a few folders on the desk, more in the drawer, the rest in the basement.' }
  ];

  // How many metadata blocks does a file of n data blocks need?
  function meta(method, n, P, D) {
    if (method === 'indexed') return n > P ? null : 1;
    if (method === 'inode') {
      if (n > D + P + P * P) return null;
      let m = 1; if (n > D) m++;
      if (n > D + P) m += 1 + Math.ceil((n - D - P) / P);
      return m;
    }
    return 0;
  }
  // Disk reads needed to read data block k (0-based) of a file.
  function readCost(method, k, P, D) {
    if (method === 'contiguous') return { disk: 1, path: 'start + ' + k + ' (computed)' };
    if (method === 'linked') return { disk: k + 1, path: 'follow ' + k + ' pointer' + (k === 1 ? '' : 's') + ', then the data block' };
    if (method === 'fat') return { disk: 1, path: k + ' lookup' + (k === 1 ? '' : 's') + ' in the cached FAT, then 1 disk read' };
    if (method === 'indexed') return { disk: 2, path: 'index block, then the data block' };
    if (k < D) return { disk: 2, path: 'inode, then the data block (direct pointer)' };
    if (k < D + P) return { disk: 3, path: 'inode, indirect block, data block' };
    return { disk: 4, path: 'inode, double-indirect block, second-level block, data block' };
  }

  function run(cfg, text) {
    const errors = [], N = +cfg.blocks, bs = +cfg.blockKB, P = +cfg.ptrs, D = +cfg.direct, method = cfg.method;
    if (!METHODS.some((m) => m.id === method)) errors.push('Choose a method.');
    if (!Number.isInteger(N) || N < 8 || N > 64) errors.push('Disk blocks must be 8 to 64.');
    if (!(bs >= 1) || !Number.isInteger(bs) || bs > 64) errors.push('Block size must be a whole number of KB, 1 to 64.');
    if (!Number.isInteger(P) || P < 2 || P > 64) errors.push('Pointers per block must be 2 to 64.');
    if (!Number.isInteger(D) || D < 1 || D > 12) errors.push('Direct pointers must be 1 to 12.');
    const ops = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return; let m;
      if ((m = /^(create|append)\s+(\S+)\s+(\d+)$/i.exec(line)) && +m[3] > 0) ops.push({ op: m[1].toLowerCase(), f: m[2], kb: +m[3] });
      else if ((m = /^delete\s+(\S+)$/i.exec(line))) ops.push({ op: 'delete', f: m[1] });
      else if ((m = /^read\s+(\S+)\s+(\d+)$/i.exec(line))) ops.push({ op: 'read', f: m[1], k: +m[2] });
      else errors.push('Line ' + (i + 1) + ': use "create NAME size-in-KB", "append NAME KB", "delete NAME" or "read NAME block-number".');
    });
    if (!ops.length && !errors.length) errors.push('Enter at least one operation.');
    if (ops.length > LIMITS.maxOps) errors.push('At most ' + LIMITS.maxOps + ' operations.');
    if (errors.length) return { ok: false, errors };

    const disk = Array.from({ length: N }, () => null), files = new Map(), fat = new Array(N).fill(null); let failedAllocs = 0;
    const freeCount = () => disk.filter((b) => !b).length;
    const longestRun = () => { let best = 0, cur = 0; disk.forEach((b) => { cur = b ? 0 : cur + 1; best = Math.max(best, cur); }); return best; };
    const lowestFree = (n) => { const out = []; for (let i = 0; i < N && out.length < n; i++) if (!disk[i]) out.push(i); return out.length === n ? out : null; };
    const findRun = (n) => { let cur = 0; for (let i = 0; i < N; i++) { cur = disk[i] ? 0 : cur + 1; if (cur === n) return i - n + 1; } return -1; };
    const snap = (i, op, t, ok, extra) => {
      const metaBlocks = disk.filter((b) => b && b.kind === 'meta').length, used = disk.filter(Boolean).length;
      let waste = 0; files.forEach((f) => { waste += f.data.length * bs - f.kb; });
      return Object.assign({ i, op, ok, text: t, disk: disk.map((b) => (b ? { owner: b.owner, kind: b.kind } : null)), files: [...files].map(([name, f]) => ({ name, kb: f.kb, data: f.data.slice(), meta: f.meta.slice() })), fat: fat.slice(),
        stats: { used, free: N - used, meta: metaBlocks, longestFree: longestRun(), waste, failed: failedAllocs } }, extra || {});
    };
    const frames = [snap(0, null, 'Empty disk: ' + N + ' blocks of ' + bs + ' KB.', true)];
    const place = (name, data, mt) => { mt.forEach((b) => { disk[b] = { owner: name, kind: 'meta' }; }); data.forEach((b) => { disk[b] = { owner: name, kind: 'data' }; }); };
    const dirty = (name) => { if (method === 'fat') { fat.fill(null); files.forEach((f) => f.data.forEach((b, j) => { fat[b] = j + 1 < f.data.length ? f.data[j + 1] : 'EOF'; })); } };

    ops.forEach((o, k) => {
      const f = files.get(o.f), step = k + 1, fail = (t) => { failedAllocs++; frames.push(snap(step, o, t, false)); };
      if (o.op === 'delete') {
        if (!f) return frames.push(snap(step, o, 'delete ' + o.f + ': no such file.', false));
        f.data.concat(f.meta).forEach((b) => { disk[b] = null; }); files.delete(o.f); dirty();
        return frames.push(snap(step, o, 'delete ' + o.f + ': ' + (f.data.length + f.meta.length) + ' blocks freed.' + (method === 'contiguous' ? ' The hole it leaves can only be reused by files that fit inside it.' : ''), true));
      }
      if (o.op === 'read') {
        if (!f) return frames.push(snap(step, o, 'read ' + o.f + ': no such file.', false));
        if (o.k >= f.data.length) return frames.push(snap(step, o, 'read ' + o.f + ' block ' + o.k + ': the file has only ' + f.data.length + ' blocks (0 to ' + (f.data.length - 1) + ').', false));
        const c = readCost(method, o.k, P, D);
        return frames.push(snap(step, o, 'read ' + o.f + ' block ' + o.k + ' (disk block ' + f.data[o.k] + '): ' + c.path + ' = ' + c.disk + ' disk read' + (c.disk === 1 ? '' : 's') + '.', true, { read: { file: o.f, k: o.k, block: f.data[o.k], cost: c } }));
      }
      if (o.op === 'create') {
        if (f) return fail('create ' + o.f + ': already exists.');
        const n = Math.ceil(o.kb / bs), mt = meta(method, n, P, D);
        if (mt === null) return fail('create ' + o.f + ': ' + n + ' blocks is more than one ' + (method === 'indexed' ? 'index block' : 'inode') + ' can address (' + (method === 'indexed' ? P : D + P + P * P) + '). A real system would chain index blocks.');
        let data, m;
        if (method === 'contiguous') { const s = findRun(n); if (s < 0) return fail('create ' + o.f + ': needs ' + n + ' neighbouring free blocks but the longest free run is ' + longestRun() + (freeCount() >= n ? ' (' + freeCount() + ' blocks are free in total: external fragmentation).' : '. Not enough free space.')); data = Array.from({ length: n }, (_, j) => s + j); m = []; }
        else { const got = lowestFree(n + mt); if (!got) return fail('create ' + o.f + ': needs ' + (n + mt) + ' blocks (' + n + ' data' + (mt ? ' + ' + mt + ' index/inode' : '') + ') but only ' + freeCount() + ' are free.'); m = got.slice(0, mt); data = got.slice(mt); }
        files.set(o.f, { kb: o.kb, data, meta: m }); place(o.f, data, m); dirty();
        return frames.push(snap(step, o, 'create ' + o.f + ' (' + o.kb + ' KB = ' + n + ' block' + (n > 1 ? 's' : '') + (n * bs > o.kb ? ', ' + (n * bs - o.kb) + ' KB wasted in the last block' : '') + '): ' + (method === 'contiguous' ? 'blocks ' + data[0] + (n > 1 ? '–' + data[n - 1] : '') + '.' : (m.length ? 'metadata in block' + (m.length > 1 ? 's ' : ' ') + m.join(', ') + '; ' : '') + 'data in ' + data.join(', ') + '.'), true));
      }
      // append
      if (!f) return fail('append ' + o.f + ': no such file.');
      const nk = f.kb + o.kb, nn = Math.ceil(nk / bs), add = nn - f.data.length, mt = meta(method, nn, P, D);
      if (mt === null) return fail('append ' + o.f + ': file would exceed what one ' + (method === 'indexed' ? 'index block' : 'inode') + ' can address.');
      if (add === 0 && mt === f.meta.length) { f.kb = nk; return frames.push(snap(step, o, 'append ' + o.f + ': fits in the free space of the last block; no new block needed.', true)); }
      if (method === 'contiguous') {
        const end = f.data[f.data.length - 1]; let can = true; for (let j = 1; j <= add; j++) if (end + j >= N || disk[end + j]) can = false;
        if (!can) return fail('append ' + o.f + ': the ' + add + ' block' + (add > 1 ? 's' : '') + ' after the file are not free. Contiguous files cannot grow in place: the whole file would have to be copied elsewhere.');
        const nb = Array.from({ length: add }, (_, j) => end + 1 + j); nb.forEach((b) => { disk[b] = { owner: o.f, kind: 'data' }; }); f.data = f.data.concat(nb); f.kb = nk;
        return frames.push(snap(step, o, 'append ' + o.f + ': extended in place into blocks ' + nb.join(', ') + '.', true));
      }
      const extraMeta = mt - f.meta.length, got = lowestFree(add + extraMeta);
      if (!got) return fail('append ' + o.f + ': needs ' + (add + extraMeta) + ' more blocks but only ' + freeCount() + ' are free.');
      const nm = got.slice(0, extraMeta), nd = got.slice(extraMeta); place(o.f, nd, nm); f.meta = f.meta.concat(nm); f.data = f.data.concat(nd); f.kb = nk; dirty();
      frames.push(snap(step, o, 'append ' + o.f + ': ' + nd.length + ' new data block' + (nd.length > 1 ? 's' : '') + ' (' + nd.join(', ') + ')' + (nm.length ? ' and ' + nm.length + ' new index/indirect block' + (nm.length > 1 ? 's' : '') + ' (' + nm.join(', ') + ')' : '') + (method === 'linked' ? '; the old last block\'s pointer is rewritten.' : '.'), true));
    });
    return { ok: true, cfg: { method, blocks: N, blockKB: bs, ptrs: P, direct: D }, frames };
  }

  const BASE = { method: 'contiguous', blocks: 16, blockKB: 1, ptrs: 4, direct: 3 };
  const PRESETS = [
    { id: 'frag', name: 'Fragmentation test', note: 'Delete a middle file, then ask for a file bigger than any hole. Contiguous fails; switch the method and the same script succeeds.', state: Object.assign({}, BASE, { text: 'create A 4\ncreate B 3\ncreate C 4\ndelete B\ncreate D 8\nread A 3' }) },
    { id: 'grow', name: 'Growing files', note: 'Append to a file that has a neighbour right after it.', state: Object.assign({}, BASE, { text: 'create A 3\ncreate B 3\nappend A 2\nappend B 2\nread A 4' }) },
    { id: 'big', name: 'Reading deep into a file', note: 'Compare the disk reads needed for the last block under each method.', state: Object.assign({}, BASE, { blocks: 32, text: 'create A 12\nread A 0\nread A 3\nread A 7\nread A 11' }) }
  ];
  NS.fileloc = { LIMITS, METHODS, meta, readCost, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.fileloc;
})(typeof window !== 'undefined' ? window : globalThis);
