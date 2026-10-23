/* Frame allocation view: how many frames each process gets under the chosen policy, and what that does to its faults. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, P = NS.frames.PRESETS[1];
  K.reg('frames', {
    key: 'frames', title: 'Frame allocation', visualTitle: 'Frames per process', noPlayer: true, statsTitle: 'Compare the three policies',
    chips: { key: 'policy', label: 'Policy', options: NS.frames.POLICIES.map((p) => [p.id, p.name]) },
    intro: 'When several processes share physical memory, how many frames should each get? Equal shares are simple, proportional shares follow process size, and priority shares favour important work.',
    defaults: Object.assign({}, P.cfg, { text: P.text }),
    presets: NS.frames.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'frames', label: 'Total frames', type: 'number', min: 2, max: 4096, half: true }, { key: 'min', label: 'Minimum per process', type: 'number', min: 1, max: 16, half: true },
      { key: 'text', label: 'Processes: name size [priority] [: page references]', type: 'area', rows: 7, hint: 'Size is the number of pages. Optional page references let the lab replay LRU inside each process\'s own frames and count faults.' }],
    about: [['Equal', 'm / n frames each. Simple, but a tiny process cannot use its share (wasted) while a big one starves.'], ['Proportional', 'Frames in proportion to process size: s_i / S x m. Fairer to big processes.'], ['Priority', 'Weight by priority instead of size, so important processes fault less.'], ['Minimum', 'Every process needs a few frames to make any progress at all (an instruction can touch several pages).'], ['Memory hook', 'Slicing a pizza: equal slices, slices by hunger, or slices by rank. Each slice size changes how often people get up for more.']],
    compute: (s) => NS.frames.run({ frames: +s.frames, min: +s.min, policy: s.policy }, s.text),
    draw: (f, i, sim) => ({ visual: [K.table(['Process', 'Pages', 'Priority', 'Frames', 'Share of memory', 'Unused', 'References', 'LRU faults'], sim.rows.map((r, k) => [r.name, r.size, r.prio, r.alloc, el('div', { class: 'mv-alloc' }, el('i', { style: { width: (100 * r.alloc / sim.cfg.frames) + '%', background: colorFor(k) } })), r.spare ? r.spare + ' (cannot use)' : '0', r.refs || '–', r.faults === null ? '–' : r.faults]))],
      why: el('p', null, 'Allocation uses the largest-remainder method: each share is rounded down, then leftover frames go to the largest fractional parts. A process is never given more frames than it has pages; the surplus is listed as unused here, and a real OS would hand it to others.') }),
    stats: (f, sim) => [K.table(['Policy', 'Total faults (all processes)', 'Frames unusable'], sim.compare.map((c) => [c.name + (c.id === sim.cfg.policy ? ' (selected)' : ''), sim.hasRefs ? c.faults : '–', c.spare])), el('p', { class: 'hint' }, 'Honest limit: local LRU replacement only, and the reference strings are replayed independently (no timing between processes).')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
