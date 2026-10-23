/* Page tables view: the bit split of an address, per-level indices, and how much memory each design needs. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit;
  const fmtB = (n) => { const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '') : n) + ' ' + u[i]; };
  const P0 = NS.ptables.PRESETS[0];
  K.reg('ptables', {
    key: 'ptables', title: 'Multi-level & inverted page tables', visualTitle: 'Translation of one address', label: 'Access', statsTitle: 'Memory used by each design',
    intro: 'A flat page table for a big address space is huge and mostly empty. A multi-level table only creates the pieces a program touches. An inverted table has one entry per physical frame instead of per virtual page.',
    defaults: Object.assign({}, P0.cfg, { text: P0.text }),
    presets: NS.ptables.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'vbits', label: 'Virtual address bits', type: 'number', min: 12, max: 48, half: true }, { key: 'page', label: 'Page size (bytes)', type: 'number', min: 64, half: true },
      { key: 'levels', label: 'Levels (1-4)', type: 'number', min: 1, max: 4, half: true }, { key: 'entry', label: 'Entry size (2/4/8 bytes)', type: 'number', min: 2, max: 8, half: true },
      { key: 'frames', label: 'Physical frames (inverted table size)', type: 'number', min: 2, max: 4096 },
      { key: 'text', label: 'Addresses touched, one per line', type: 'area', rows: 7, hint: '"0x400000" or "A 0x400000" (process name first). Decimal or hex.' }],
    about: [['Multi-level', 'Split the page number into one index per level. The top table points to second-level tables, and so on. A table is only created when a page under it is used, so empty regions cost nothing.'], ['Cost', 'Every translation walks one table per level, so TLB misses cost more memory reads.'], ['Inverted', 'One entry per physical frame, found by hashing (process, page). Its size depends on RAM, not on the address space, but lookups walk a hash chain and sharing pages is harder.'], ['Memory hook', 'Multi-level = a book index with chapters; you only print the chapters you wrote. Inverted = a seating chart by seat, not by guest.']],
    compute: (s) => NS.ptables.run({ vbits: +s.vbits, page: +s.page, levels: +s.levels, entry: +s.entry, frames: +s.frames }, s.text),
    draw: (f, i, sim) => {
      if (!i) return { visual: el('p', { class: 'muted' }, 'Bit split: ' + sim.bits.map((b, k) => 'level ' + (k + 1) + ' = ' + b + ' bits').join(', ') + ', offset = ' + sim.offsetBits + ' bits.'), why: el('p', null, f.text) };
      if (f.error) return { visual: null, why: el('p', { class: 'mv-bad' }, f.text) };
      const bits = el('div', { class: 'mv-bits' }, f.idx.map((v, k) => el('div', null, el('small', null, 'level ' + (k + 1) + ' (' + f.bits[k] + ' bits)'), el('b', null, String(v)))), el('div', { class: 'off' }, el('small', null, 'offset (' + sim.offsetBits + ' bits)'), el('b', null, String(f.offset))));
      return { visual: [el('p', null, el('b', null, f.pid + ' → 0x' + f.addr.toString(16)), ' = page ' + f.vpn), bits,
        K.table(['', 'Multi-level', 'Inverted'], [['Steps', f.refs + ' table read' + (f.refs > 1 ? 's' : '') + ' (one per level)', f.steps + ' entr' + (f.steps === 1 ? 'y' : 'ies') + ' compared in bucket ' + f.bucket], ['Created', f.created.length ? 'level ' + f.created.join(', ') + ' table' : 'nothing new', f.isNew ? 'frame ' + f.frame + ' assigned' : 'found frame ' + f.frame]])], why: el('p', null, f.text) };
    },
    stats: (f, sim) => [K.table(['Design', 'Memory for tables', 'How it is computed'], [
      ['Flat (single level)', fmtB(f.stats.single), '2^' + (sim.cfg.vbits - sim.offsetBits) + ' entries x ' + sim.cfg.entry + ' B, always allocated in full'],
      ['Multi-level (' + sim.cfg.levels + ')', fmtB(f.stats.bytes), f.stats.nodes + ' table' + (f.stats.nodes === 1 ? '' : 's') + ' created so far (bits per level: ' + sim.bits.join(', ') + ')'],
      ['Inverted', fmtB(f.stats.inverted), sim.cfg.frames + ' entries x ' + sim.invEntry + ' B (entry plus process id and page number); ' + f.stats.mapped + ' frames in use']]),
      el('p', { class: 'hint' }, 'Honest limit: tables are counted, not stored; the inverted hash is (page + 31 x process number) mod frames with chaining; real tables also hold flag bits and sharing needs extra structures.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
