/* Segmentation view: segment table, physical memory map with the accessed address marked, and the verdict. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, P = NS.segmentation.PRESETS[0];
  K.reg('segmentation', {
    key: 'segmentation', title: 'Segmentation', visualTitle: 'Physical memory', label: 'Access', statsTitle: 'Results so far',
    intro: 'A program sees a few named pieces (code, data, stack). Each logical address is a segment and an offset; the segment table gives where the piece starts in memory (base) and how long it is (limit).',
    defaults: { phys: P.cfg.phys, segs: P.segs, acc: P.acc },
    presets: NS.segmentation.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: { phys: p.cfg.phys, segs: p.segs, acc: p.acc } })),
    fields: [{ key: 'phys', label: 'Physical memory (bytes)', type: 'number', min: 16 }, { key: 'segs', label: 'Segment table: name base limit [rights]', type: 'area', rows: 5, hint: 'Rights r, w, x (default rw). Numbers may be decimal or 0x hex.' }, { key: 'acc', label: 'Accesses: segment offset [r|w|x]', type: 'area', rows: 7 }],
    about: [['The rule', 'physical address = base + offset, but only if offset < limit and the access type is allowed.'], ['Faults', 'Offset at or beyond the limit: limit fault. Right not granted: protection fault. Unknown segment: invalid segment.'], ['Pros and cons', 'Matches how programmers think and gives per-segment protection and sharing. But segments are variable-sized, so physical memory suffers external fragmentation.'], ['Memory hook', 'Base is where the room starts, limit is the room\'s length: you can walk in, but not through the wall.']],
    compute: (s) => NS.segmentation.run({ phys: +s.phys }, s.segs, s.acc),
    draw: (f, i, sim) => {
      const P = sim.cfg.phys, pct = (v) => (100 * v / P) + '%';
      const map = el('div', { class: 'mv-map' }, sim.segs.map((s) => el('div', { class: 'mv-seg' + (f.seg === s.n ? ' hot' : ''), style: { left: pct(s.base), width: pct(Math.min(s.limit, P - s.base)), '--c': colorFor(s.n) }, title: s.name + ' ' + s.base + '..' + (s.base + s.limit - 1) }, s.name)),
        f.phys != null ? el('div', { class: 'mv-ptr', style: { left: pct(f.phys) } }) : null);
      return { visual: [map, el('div', { class: 'mv-scale' }, el('span', null, '0'), el('span', null, String(P))), sim.warnings.length ? el('p', { class: 'mv-bad' }, 'Warning: ' + sim.warnings.join(' ')) : null,
        K.table(['Segment', 'Base', 'Limit', 'Last byte', 'Rights'], sim.segs.map((s) => [s.name, s.base, s.limit, s.base + s.limit - 1, s.rights]))],
        why: [el('p', { class: f.result && f.result !== 'ok' ? 'mv-bad' : '' }, f.text), f.phys != null ? el('p', { class: 'mv-ok' }, 'Physical address ' + f.phys) : null] };
    },
    stats: (f, sim) => { const done = sim.frames.slice(1, f.i + 1); return K.metrics([['Accesses', done.length], ['Translated', done.filter((x) => x.result === 'ok').length], ['Limit faults', done.filter((x) => x.result === 'fault-limit').length], ['Protection faults', done.filter((x) => x.result === 'fault-prot').length], ['Bad segments', done.filter((x) => x.result === 'fault-seg').length]]); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
