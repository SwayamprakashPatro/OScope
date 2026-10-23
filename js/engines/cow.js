/* Tier 2A: copy-on-write fork. fork shares every frame and marks it read-only; the first write to a shared frame
   copies just that page. Counts frames used versus an eager copy at fork time. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxOps: 40, maxPages: 16 };

  function run(cfg, text) {
    const errors = [], total = +cfg.frames;
    if (!Number.isInteger(total) || total < 2 || total > 64) errors.push('Physical frames must be 2 to 64.');
    const ops = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return; let m;
      if ((m = /^start\s+(\S+)\s+(\d+)$/i.exec(line))) ops.push({ op: 'start', p: m[1], n: +m[2] });
      else if ((m = /^fork\s+(\S+)\s+(\S+)$/i.exec(line))) ops.push({ op: 'fork', p: m[1], c: m[2] });
      else if ((m = /^(read|write)\s+(\S+)\s+(\d+)$/i.exec(line))) ops.push({ op: m[1].toLowerCase(), p: m[2], page: +m[3] });
      else if ((m = /^exit\s+(\S+)$/i.exec(line))) ops.push({ op: 'exit', p: m[1] });
      else errors.push('Line ' + (i + 1) + ': use "start P n", "fork P C", "read P page", "write P page" or "exit P".');
    });
    if (!ops.length && !errors.length) errors.push('Enter at least one operation.');
    if (ops.length > LIMITS.maxOps) errors.push('At most ' + LIMITS.maxOps + ' operations.');
    if (errors.length) return { ok: false, errors };

    const procs = new Map(), ref = new Array(total).fill(0); let copies = 0, cowFaults = 0, eagerExtra = 0; const forked = new Set();
    const alloc = () => { const f = ref.findIndex((r) => r === 0); if (f >= 0) ref[f] = 1; return f; };
    const snap = (i, op, t, ok, touched) => ({ i, op, ok, text: t, touched: touched || [], procs: [...procs].map(([name, pt]) => ({ name, pages: pt.map((e) => ({ frame: e.frame, ro: e.ro })) })), ref: ref.slice(),
      stats: { used: ref.filter((r) => r > 0).length, total, copies, cowFaults, shared: ref.filter((r) => r > 1).length, eager: ref.filter((r) => r > 0).length - copies + eagerExtra } });
    const frames = [snap(0, null, 'No processes yet. ' + total + ' free frames.', true)];
    ops.forEach((o, k) => {
      const pt = procs.get(o.p), fail = (t) => frames.push(snap(k + 1, o, t, false));
      if (o.op === 'start') {
        if (procs.has(o.p)) return fail(o.p + ' already exists.'); if (o.n < 1 || o.n > LIMITS.maxPages) return fail('Pages must be 1 to ' + LIMITS.maxPages + '.');
        if (ref.filter((r) => r === 0).length < o.n) return fail('Not enough free frames for ' + o.n + ' pages.');
        procs.set(o.p, Array.from({ length: o.n }, () => ({ frame: alloc(), ro: false })));
        return frames.push(snap(k + 1, o, o.p + ' starts with ' + o.n + ' private writable pages in frames ' + procs.get(o.p).map((e) => e.frame).join(', ') + '.', true));
      }
      if (!pt) return fail('No process named ' + o.p + '.');
      if (o.op === 'fork') {
        if (procs.has(o.c)) return fail(o.c + ' already exists.');
        procs.set(o.c, pt.map((e) => { ref[e.frame]++; e.ro = true; return { frame: e.frame, ro: true }; }));
        eagerExtra += pt.length; forked.add(o.c);
        return frames.push(snap(k + 1, o, 'fork: ' + o.c + ' gets a copy of ' + o.p + '\'s page table, pointing at the SAME ' + pt.length + ' frames. Every shared page is marked read-only in both. No data was copied (an eager fork would have copied ' + pt.length + ' frames).', true, [[o.p, -1], [o.c, -1]]));
      }
      if (o.op === 'exit') {
        pt.forEach((e) => { ref[e.frame]--; }); procs.delete(o.p); if (forked.has(o.p)) { eagerExtra -= pt.length; forked.delete(o.p); }
        return frames.push(snap(k + 1, o, o.p + ' exits: its frames are released (a shared frame stays until its last user exits).', true));
      }
      if (o.page >= pt.length) return fail(o.p + ' has only ' + pt.length + ' pages (0 to ' + (pt.length - 1) + ').');
      const e = pt[o.page];
      if (o.op === 'read') return frames.push(snap(k + 1, o, o.p + ' reads page ' + o.page + ' from frame ' + e.frame + '. Reads never need a copy.', true, [[o.p, o.page]]));
      if (!e.ro) return frames.push(snap(k + 1, o, o.p + ' writes page ' + o.page + ' in its private frame ' + e.frame + ': allowed, no fault.', true, [[o.p, o.page]]));
      cowFaults++;
      if (ref[e.frame] > 1) {
        const nf = alloc(); if (nf < 0) { cowFaults--; return fail('Copy-on-write needs a free frame but memory is full.'); }
        ref[e.frame]--; const old = e.frame; e.frame = nf; e.ro = false; copies++;
        return frames.push(snap(k + 1, o, 'Write to read-only shared page: protection fault. Frame ' + old + ' still has ' + ref[old] + ' user' + (ref[old] > 1 ? 's' : '') + ', so the OS copies it into new frame ' + nf + ', maps that writable for ' + o.p + ', and retries the write.', true, [[o.p, o.page]]));
      }
      e.ro = false;
      return frames.push(snap(k + 1, o, 'Write to a page marked read-only, but frame ' + e.frame + ' now has only one user. The OS just makes it writable again: no copy needed.', true, [[o.p, o.page]]));
    });
    return { ok: true, cfg: { frames: total }, frames };
  }

  const PRESETS = [
    { id: 'basic', name: 'Fork then write', note: 'Fork copies nothing. Only the written page is copied, and the last owner writes for free.', cfg: { frames: 12 }, text: 'start P0 3\nfork P0 P1\nread P1 0\nwrite P1 1\nwrite P0 1\nwrite P0 2' },
    { id: 'exec', name: 'fork + exit (like fork/exec)', note: 'The child exits before touching anything: no frames were ever copied.', cfg: { frames: 12 }, text: 'start P0 4\nfork P0 P1\nexit P1\nwrite P0 0' },
    { id: 'tree', name: 'Three processes', note: 'A grandchild shares with both; a frame stays shared until only one user remains.', cfg: { frames: 12 }, text: 'start P0 2\nfork P0 P1\nfork P1 P2\nwrite P2 0\nwrite P1 0\nwrite P0 0' }
  ];
  NS.cow = { LIMITS, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.cow;
})(typeof window !== 'undefined' ? window : globalThis);
