/* Memory hierarchy view: effective access time for a stack of levels, and for paging with a TLB and page faults. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, P = NS.hierarchy.PRESETS[0];
  const n = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : (+v.toFixed(4)).toString());
  K.reg('hierarchy', {
    key: 'hierarchy', title: 'Memory hierarchy & effective access time', visualTitle: 'Average cost of one access', noPlayer: true, statsTitle: 'Paging: TLB, page tables and faults',
    intro: 'Fast memory is small and slow memory is big. The average access time is dominated by how often the fast levels have what you need. Change a hit ratio and see which term moves the average.',
    defaults: Object.assign({}, P.cfg, { text: P.text }),
    presets: NS.hierarchy.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: Object.assign({}, p.cfg, { text: p.text }) })),
    fields: [{ key: 'text', label: 'Levels: name hit-ratio time (fastest first)', type: 'area', rows: 5, hint: 'Times in any one unit (ns). A level that misses passes the access to the next one. The last level always hits.' },
      { key: 'alpha', label: 'TLB hit ratio', type: 'number', min: 0, max: 1, half: true }, { key: 'tlb', label: 'TLB time', type: 'number', min: 0, half: true },
      { key: 'mem', label: 'Memory access time', type: 'number', min: 0.001, half: true }, { key: 'ptlevels', label: 'Page-table levels', type: 'number', min: 1, max: 4, half: true },
      { key: 'pfault', label: 'Page-fault rate (0 to 1)', type: 'number', min: 0, max: 1, half: true }, { key: 'faultTime', label: 'Fault service time', type: 'number', min: 0, half: true }],
    about: [['Levels', 'EAT = h1 x t1 + (1 - h1) x [h2 x (t1 + t2) + (1 - h2) x (...)]. A miss pays for the lookup at that level and then tries the next, so times add up as you go down.'], ['Paging', 'TLB hit: tlb + mem. TLB miss: tlb + (levels x mem) for the table walk + mem for the data. A page fault adds the disk service time with probability p.'], ['Lesson', 'Rare events with huge costs matter: a one-in-a-million fault can still add as much as everything else.'], ['Memory hook', 'Your desk, your shelf, the library, the other city: the average trip is set by how often the desk has it.']],
    compute: (s) => NS.hierarchy.run(s, s.text),
    draw: (f, i, sim) => {
      const L = sim.levels, p = sim.paging, q = sim.params;
      return { visual: [K.table(['Level', 'Hit ratio', 'Lookup time', 'Reached by', 'Served here', 'Time if served here', 'Adds to average'], L.rows.map((r) => [r.name, n(r.hit), n(r.time), (100 * r.reach).toFixed(3) + '%', (100 * r.served).toFixed(3) + '%', n(r.cum), n(r.contrib)])),
        el('p', { class: 'why' }, el('b', null, 'Effective access time = ' + n(L.eat)), '  (the sum of the last column). Biggest contributor: ' + L.rows.reduce((a, r) => (r.contrib > a.contrib ? r : a)).name + '.')],
        why: [el('h4', null, 'Paging with a TLB'), el('p', null, 'TLB hit = ' + n(q.tlb) + ' + ' + n(q.mem) + ' = ' + n(p.hitT) + '. TLB miss = ' + n(q.tlb) + ' + ' + q.levels + ' x ' + n(q.mem) + ' + ' + n(q.mem) + ' = ' + n(p.missT) + '. Without faults: ' + n(q.alpha) + ' x ' + n(p.hitT) + ' + ' + n(1 - q.alpha) + ' x ' + n(p.missT) + ' = ' + n(p.noFault) + '.'),
          el('p', null, el('b', null, 'With faults: (1 - p) x ' + n(p.noFault) + ' + p x ' + n(q.fault) + ' = ' + n(p.eat)), '.')] };
    },
    stats: (f, sim) => [K.metrics([['No-fault EAT', n(sim.paging.noFault)], ['EAT with faults', n(sim.paging.eat)], ['Slowdown from faults', (100 * (sim.paging.eat / sim.base - 1)).toFixed(2) + '%'], ['Max fault rate for 10% slowdown', sim.maxP10.toExponential(3)]]),
      K.table(['TLB hit ratio', 'EAT (no faults)'], sim.sens.map((r) => [r.alpha, n(r.eat)])), el('p', { class: 'hint' }, 'Honest limit: times are averages, the TLB and cache are assumed to be searched one after another, and caches inside the page-table walk are ignored.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
