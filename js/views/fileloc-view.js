/* File allocation view: the disk as a grid of blocks coloured by file, the file table, the FAT, and read costs. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor, textOn } = NS.util, K = NS.kit, P = NS.fileloc.PRESETS[0];
  const names = []; const ci = (n) => { let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } return i; };
  K.reg('fileloc', {
    key: 'fileloc', title: 'File allocation methods', visualTitle: 'The disk', label: 'Operation', statsTitle: 'Disk use',
    chips: { key: 'method', label: 'Allocation method', options: NS.fileloc.METHODS.map((m) => [m.id, m.short]) },
    intro: 'A file system must decide which disk blocks hold each file. The choice trades fragmentation, growth, and how many disk reads it takes to reach a block in the middle of a file.',
    defaults: P.state,
    presets: NS.fileloc.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'blocks', label: 'Disk blocks (8-64)', type: 'number', min: 8, max: 64, half: true }, { key: 'blockKB', label: 'Block size (KB)', type: 'number', min: 1, max: 64, half: true },
      { key: 'ptrs', label: 'Pointers per index block', type: 'number', min: 2, max: 64, half: true, hint: 'Small on purpose, so large files show the indirect levels.' }, { key: 'direct', label: 'Inode direct pointers', type: 'number', min: 1, max: 12, half: true },
      { key: 'text', label: 'Operations, one per line', type: 'area', rows: 8, hint: 'create NAME size-in-KB · append NAME KB · delete NAME · read NAME block-number (0 is the first block)' }],
    afterCompute: (sim, state, h) => { const m = NS.fileloc.METHODS.find((x) => x.id === state.method); K.put(h.about, [el('summary', null, 'How it works: ' + m.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, m.about.rule), el('dt', null, 'Watch out for'), el('dd', null, m.about.watch), el('dt', null, 'Memory hook'), el('dd', null, m.hook))]); },
    about: [['', '']],
    compute: (s) => NS.fileloc.run({ method: s.method, blocks: +s.blocks, blockKB: +s.blockKB, ptrs: +s.ptrs, direct: +s.direct }, s.text),
    draw: (f, i, sim) => {
      const hot = f.read ? f.read.block : -1;
      const grid = el('div', { class: 'fv-disk', role: 'img', 'aria-label': 'Disk blocks' }, f.disk.map((b, k) => { const c = b ? colorFor(ci(b.owner)) : null; return el('div', { class: 'fv-blk' + (b && b.kind === 'meta' ? ' meta' : '') + (k === hot ? ' hot' : ''), style: c ? { background: c, color: textOn(c), borderColor: c } : {}, title: b ? b.owner + (b.kind === 'meta' ? ' (index/inode)' : '') : 'free' }, el('small', { style: c ? { color: 'inherit', opacity: 0.8 } : {} }, String(k)), el('b', null, b ? b.owner + (b.kind === 'meta' ? '*' : '') : '·')); }));
      const files = f.files.length ? K.table(['File', 'KB', 'Data blocks', sim.cfg.method === 'indexed' || sim.cfg.method === 'inode' ? 'Index / inode blocks' : ''].filter((x) => x !== '' ), f.files.map((x) => [x.name, x.kb, x.data.join(', ')].concat(sim.cfg.method === 'indexed' || sim.cfg.method === 'inode' ? [x.meta.join(', ')] : []))) : el('p', { class: 'muted' }, 'No files yet.');
      let fat = null;
      if (sim.cfg.method === 'fat') { const used = f.fat.map((n, k) => [k, n]).filter(([, n]) => n !== null); fat = [el('h4', null, 'FAT (next-block table, kept in RAM)'), used.length ? K.table(['Block'].concat(used.map(([k]) => k)), [['next'].concat(used.map(([, n]) => n))]) : el('p', { class: 'muted' }, 'All entries free.')]; }
      return { visual: [grid, el('p', { class: 'hint' }, 'Colour = file. A * marks an index or inode (metadata) block. Dot = free.'), files, fat], why: [el('p', { class: f.ok ? '' : 'mv-bad' }, f.text), f.read ? el('p', { class: 'why' }, el('b', null, 'Disk reads for this access: ' + f.read.cost.disk), ' (' + f.read.cost.path + ')') : null] };
    },
    stats: (f) => [K.metrics([['Blocks used', f.stats.used], ['Free', f.stats.free], ['Metadata blocks', f.stats.meta], ['Longest free run', f.stats.longestFree], ['KB wasted in last blocks', f.stats.waste], ['Failed requests', f.stats.failed]]),
      el('p', { class: 'hint' }, 'Honest limits: directory entries, free-space maps and journaling are not modelled; the FAT is assumed cached in RAM; seek time is not counted, only block reads; allocation takes the lowest free blocks (contiguous uses first fit).')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
