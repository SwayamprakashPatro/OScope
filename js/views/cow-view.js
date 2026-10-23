/* Copy-on-write view: each process's page table (frame number, read-only flag) and the frame reference counts. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, P = NS.cow.PRESETS[0];
  K.reg('cow', {
    key: 'cow', title: 'Copy-on-write', visualTitle: 'Page tables and frames', label: 'Operation', statsTitle: 'Memory saved',
    intro: 'fork() would have to copy the parent\'s whole memory. Copy-on-write shares every frame instead, marks them read-only, and copies a single page only when someone writes to it.',
    defaults: { frames: P.cfg.frames, text: P.text },
    presets: NS.cow.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: { frames: p.cfg.frames, text: p.text } })),
    fields: [{ key: 'frames', label: 'Physical frames', type: 'number', min: 2, max: 64 }, { key: 'text', label: 'Operations, one per line', type: 'area', rows: 9, hint: 'start P n · fork P child · read P page · write P page · exit P' }],
    about: [['fork', 'The child gets a copy of the page table only. Both sides point at the same frames, and every shared page is marked read-only.'], ['First write', 'A write to a read-only shared page faults. If the frame has other users, the OS copies it, maps the copy writable for the writer, and retries. If the writer is the last user, it simply unmarks the page.'], ['Why it helps', 'Most children call exec or exit right away, so almost nothing is ever copied.'], ['Memory hook', 'Share the notebook until someone wants to write; only then photocopy that one page.']],
    compute: (s) => NS.cow.run({ frames: +s.frames }, s.text),
    draw: (f, i, sim) => {
      const touched = new Set((f.touched || []).map((t) => t[0] + ':' + t[1]));
      const procs = el('div', { class: 'mv-procs' }, f.procs.map((p) => el('div', { class: 'mv-proc' }, el('h4', null, p.name), p.pages.map((e, k) => el('div', { class: 'mv-page' + (e.ro ? ' ro' : '') + (f.ref[e.frame] > 1 ? ' shared' : '') + (touched.has(p.name + ':' + k) || touched.has(p.name + ':-1') ? ' hot' : '') }, el('span', null, 'page ' + k), el('span', null, '→'), el('b', null, 'frame ' + e.frame), e.ro ? el('span', null, 'RO') : null)))));
      const frames = el('div', { class: 'mv-frames', 'aria-label': 'Physical frames' }, f.ref.map((r, k) => el('div', { class: 'mv-fr' + (r > 1 ? ' s' : r === 1 ? ' u' : '') }, el('div', null, 'F' + k), el('div', null, r ? '×' + r : '·'))));
      return { visual: [procs, el('p', { class: 'hint' }, 'Frames: × is how many page tables point at it. Red = shared. RO = read-only (write will fault).'), frames], why: el('p', { class: f.ok ? '' : 'mv-bad' }, f.text) };
    },
    stats: (f) => [K.metrics([['Frames in use', f.stats.used + ' / ' + f.stats.total], ['Eager fork would use', f.stats.eager], ['Pages copied', f.stats.copies], ['Write faults', f.stats.cowFaults], ['Shared frames', f.stats.shared]])]
  });
})(typeof window !== 'undefined' ? window : globalThis);
