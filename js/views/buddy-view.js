/* Buddy system view: the memory bar (free and used blocks), the free lists by size, and fragmentation totals. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor, textOn } = NS.util, K = NS.kit;
  const ids = [];
  const idx = (id) => { let i = ids.indexOf(id); if (i < 0) { ids.push(id); i = ids.length - 1; } return i; };
  K.reg('buddy', {
    key: 'buddy', title: 'Buddy system', visualTitle: 'Memory', label: 'Operation', statsTitle: 'Fragmentation',
    intro: 'Memory is handed out in power-of-two blocks. A request is rounded up, a big free block is halved until it fits, and a freed block merges with its "buddy" when both halves are free.',
    defaults: { total: 64, min: 4, text: NS.buddy.PRESETS[0].text },
    presets: NS.buddy.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'total', label: 'Total memory (power of 2)', type: 'number', min: 8, max: 4096, half: true }, { key: 'min', label: 'Smallest block', type: 'number', min: 1, max: 4096, half: true },
      { key: 'text', label: 'Operations, one per line', type: 'area', rows: 9, hint: '"alloc A 10" asks for 10 units; "free A" releases it. "#" starts a comment.' }],
    about: [['The rule', 'Round the request up to a power of two. Take the smallest free block that fits; split it in halves (keep one, free the other) until it is the right size.'], ['Freeing', 'A block\'s buddy is the neighbour you get by flipping one address bit (start XOR size). If the buddy is free and the same size, merge, and repeat upward.'], ['Cost', 'Fast and simple, but rounding up wastes space inside each block (internal fragmentation).'], ['Memory hook', 'Halve to allocate, glue back to free: like folding and unfolding a sheet of paper.']],
    compute: (s) => NS.buddy.run({ total: +s.total, min: +s.min }, s.text),
    draw: (f, i, sim) => {
      const T = sim.cfg.total;
      const bar = el('div', { class: 'mv-bar', role: 'img', 'aria-label': 'Memory blocks' }, f.blocks.map((b) => { const c = b.state === 'used' ? colorFor(idx(b.id)) : null; return el('div', { class: 'mv-blk ' + b.state, style: Object.assign({ flex: b.size + ' 1 0' }, c ? { background: c, color: textOn(c) } : {}), title: b.size + '@' + b.start }, el('b', null, b.state === 'used' ? b.id : ''), el('span', null, String(b.size))); }));
      const lists = K.table(['Block size', 'Free blocks (start addresses)'], Object.keys(f.lists).map((s) => [s, f.lists[s].length ? f.lists[s].join(', ') : '–']));
      return { visual: [bar, el('div', { class: 'mv-scale' }, el('span', null, '0'), el('span', null, String(T))), el('h4', null, 'Free lists'), lists], why: el('p', null, f.text) };
    },
    stats: (f) => [K.metrics([['Used (rounded)', f.stats.used], ['Free', f.stats.free], ['Internal waste', f.stats.internal], ['Largest free block', f.stats.largestFree]])]
  });
})(typeof window !== 'undefined' ? window : globalThis);
