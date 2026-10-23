/* Tier 2A: segmentation. A logical address is (segment, offset); the segment table gives a base and a limit.
   Offset >= limit is a limit fault; a missing right is a protection fault. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxSegs: 8, maxAccesses: 40 };
  const num = (s) => (/^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? +s : NaN);

  function run(cfg, segText, accText) {
    const errors = [], phys = +cfg.phys, segs = [];
    if (!Number.isInteger(phys) || phys < 16 || phys > 1 << 24) errors.push('Physical memory must be 16 to 16,777,216 bytes.');
    String(segText || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/), base = num(t[1]), limit = num(t[2]), rights = (t[3] || 'rw').toLowerCase();
      if (t.length < 3 || t.length > 4 || !(base >= 0) || !(limit >= 1)) errors.push('Segment line ' + (i + 1) + ': write "name base limit [rights]", for example "code 1000 400 rx".');
      else if (!/^[rwx]+$/.test(rights)) errors.push('Segment line ' + (i + 1) + ': rights use r, w, x.');
      else if (segs.some((s) => s.name === t[0])) errors.push('Segment line ' + (i + 1) + ': duplicate name ' + t[0] + '.');
      else segs.push({ name: t[0], base, limit, rights, n: segs.length });
    });
    if (!segs.length && !errors.length) errors.push('Define at least one segment.');
    if (segs.length > LIMITS.maxSegs) errors.push('At most ' + LIMITS.maxSegs + ' segments.');
    const acc = [];
    String(accText || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/), off = num(t[1]), op = (t[2] || 'r').toLowerCase();
      if (t.length < 2 || t.length > 3 || !(off >= 0) || !['r', 'w', 'x'].includes(op)) errors.push('Access line ' + (i + 1) + ': write "segment offset [r|w|x]", for example "code 399 x".');
      else acc.push({ seg: t[0], off, op });
    });
    if (!acc.length && !errors.length) errors.push('Enter at least one access.');
    if (acc.length > LIMITS.maxAccesses) errors.push('At most ' + LIMITS.maxAccesses + ' accesses.');
    if (errors.length) return { ok: false, errors };
    const warnings = [];
    segs.forEach((s) => { if (s.base + s.limit > phys) warnings.push(s.name + ' extends past the end of physical memory (' + (s.base + s.limit) + ' > ' + phys + ').'); });
    for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) if (segs[a].base < segs[b].base + segs[b].limit && segs[b].base < segs[a].base + segs[a].limit) warnings.push(segs[a].name + ' and ' + segs[b].name + ' overlap in physical memory.');
    const frames = [{ i: 0, text: 'Segment table loaded. Pick an access to translate.', result: null }], used = new Set();
    acc.forEach((x, k) => {
      const s = segs.find((g) => g.name === x.seg);
      let result, text;
      if (!s) { result = 'fault-seg'; text = 'Segment "' + x.seg + '" is not in the segment table: invalid segment fault.'; }
      else if (x.off >= s.limit) { result = 'fault-limit'; text = x.seg + ':' + x.off + ' → offset ' + x.off + ' is not less than the limit ' + s.limit + ': limit fault (trap to the OS).'; }
      else if (!s.rights.includes(x.op)) { result = 'fault-prot'; text = x.seg + ':' + x.off + ' → offset is inside the segment, but "' + x.op + '" is not allowed (rights: ' + s.rights + '): protection fault.'; }
      else { result = 'ok'; used.add(s.name); text = x.seg + ':' + x.off + ' → ' + x.off + ' < limit ' + s.limit + ' and "' + x.op + '" is allowed, so physical address = base ' + s.base + ' + offset ' + x.off + ' = ' + (s.base + x.off) + '.'; }
      frames.push({ i: k + 1, acc: x, seg: s ? s.n : -1, result, phys: result === 'ok' ? s.base + x.off : null, text });
    });
    return { ok: true, cfg: { phys }, segs, warnings, frames };
  }

  const PRESETS = [
    { id: 'basic', name: 'Typical process', note: 'Code, data and stack segments; the last accesses break the limit and the rights.', cfg: { phys: 4096 }, segs: 'code 1000 400 rx\ndata 2000 200 rw\nstack 3000 300 rw', acc: 'code 0 x\ncode 399 x\ncode 400 x\ndata 50 w\ncode 10 w\nstack 299 r\nheap 0 r' },
    { id: 'overlap', name: 'Overlapping segments', note: 'A mistake in the table: two segments claim the same physical bytes.', cfg: { phys: 4096 }, segs: 'a 1000 500 rw\nb 1300 500 rw', acc: 'a 400 w\nb 100 r' }
  ];
  NS.segmentation = { LIMITS, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.segmentation;
})(typeof window !== 'undefined' ? window : globalThis);
