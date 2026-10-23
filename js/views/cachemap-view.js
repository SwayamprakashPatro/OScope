/* Cache mapping view: the address split into tag / index / offset, the cache as sets by ways, and miss classification. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, P = NS.cachemap.PRESETS[0];
  K.reg('cachemap', {
    key: 'cachemap', title: 'Cache mapping', visualTitle: 'The cache', label: 'Access', statsTitle: 'Hits, misses and average access time',
    intro: 'A cache holds recently used blocks. Where a block may sit depends on the mapping: one place (direct-mapped), a small group of places (set-associative), or anywhere (fully associative).',
    defaults: Object.assign({}, P.cfg, { text: P.text }),
    presets: NS.cachemap.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'size', label: 'Cache size (bytes)', type: 'number', min: 16, max: 65536, half: true }, { key: 'block', label: 'Block size (bytes)', type: 'number', min: 1, half: true },
      { key: 'ways', label: 'Ways', type: 'select', options: [['1', '1 (direct-mapped)'], ['2', '2-way'], ['4', '4-way'], ['8', '8-way'], ['full', 'Fully associative']], half: true }, { key: 'repl', label: 'Replacement', type: 'select', options: [['LRU', 'LRU'], ['FIFO', 'FIFO']], half: true },
      { key: 'abits', label: 'Address bits', type: 'number', min: 6, max: 32, half: true }, { key: 'hitTime', label: 'Hit time (cycles)', type: 'number', min: 0, half: true }, { key: 'penalty', label: 'Miss penalty (cycles)', type: 'number', min: 0 },
      { key: 'text', label: 'Addresses (hex or decimal, spaces or lines)', type: 'area', rows: 4 }],
    about: [['Address split', 'offset = which byte inside the block; index = which set; tag = what is left, to tell blocks in the same set apart.'], ['Direct-mapped', 'Each block has exactly one possible slot: fast and cheap, but two hot blocks with the same index keep evicting each other.'], ['Set-associative', 'Index picks a set; the block may use any way in it. More ways, fewer conflicts, more comparators.'], ['Three kinds of miss', 'Compulsory (first use), capacity (cache too small even if fully associative), conflict (the mapping, not the size, caused it).'], ['Memory hook', 'Parking: assigned spot (direct), a row of spots (set), any spot (full lot). Conflicts happen when two cars share one assigned spot.']],
    compute: (s) => NS.cachemap.run({ size: +s.size, block: +s.block, ways: s.ways, repl: s.repl, abits: +s.abits, hitTime: +s.hitTime, penalty: +s.penalty }, s.text),
    draw: (f, i, sim) => {
      const b = sim.bits, hot = i ? f.idx : -1;
      const split = el('div', { class: 'mv-bits' }, el('div', null, el('small', null, 'tag (' + b.tag + ' bits)'), el('b', null, i ? String(f.tag) : '')), el('div', null, el('small', null, 'index (' + b.index + ' bits)'), el('b', null, i ? String(f.idx) : '')), el('div', { class: 'off' }, el('small', null, 'offset (' + b.offset + ' bits)'), el('b', null, i ? String(f.off) : '')));
      const grid = el('div', { class: 'tbl-wrap' }, el('table', { class: 'mv-cache' }, el('thead', null, el('tr', null, el('th', null, 'Set'), Array.from({ length: sim.cfg.ways }, (_, w) => el('th', null, 'Way ' + w)))),
        el('tbody', null, f.sets.map((set, s) => el('tr', null, el('th', null, String(s)), set.map((w, k) => el('td', null, el('div', { class: 'mv-way' + (w ? ' full' : '') + (s === hot && k === f.way ? (f.hit ? ' hit' : ' miss') : '') }, w ? [el('b', null, 'blk ' + w.block), el('small', null, 'tag ' + w.tag)] : el('small', null, 'empty')))))))));
      return { visual: [i ? el('p', null, el('b', null, '0x' + f.addr.toString(16)), ' = block ', el('b', null, String(f.block)), ' → ', el('span', { class: f.hit ? 'mv-ok' : 'mv-bad' }, f.hit ? 'HIT' : 'MISS (' + f.kind + ')')) : null, split, grid], why: el('p', null, f.text) };
    },
    stats: (f, sim) => { const s = f.stats, n = s.hits + s.misses; return [K.metrics([['Accesses', n], ['Hits', s.hits], ['Misses', s.misses], ['Compulsory', s.cold], ['Capacity', s.capacity], ['Conflict', s.conflict]]),
      el('p', { class: 'why' }, el('b', null, 'Whole run: '), 'hit rate ' + (100 * sim.stats.hitRate).toFixed(1) + '%, average access time = hit time + miss rate x penalty = ' + sim.stats.amat.toFixed(2) + ' cycles.'), el('p', { class: 'hint' }, 'Honest limit: reads only (no write policy), one level of cache, and capacity-versus-conflict is judged against a fully associative LRU cache of the same size.')]; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
