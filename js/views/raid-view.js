/* RAID view: stripe layout across disks (data, mirror, parity), capacity and performance, and what survives failures. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, P = NS.raid.PRESETS[0];
  const x = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  K.reg('raid', {
    key: 'raid', title: 'RAID', visualTitle: 'Stripe layout', noPlayer: true, statsTitle: 'Capacity, speed and failures',
    chips: { key: 'level', label: 'RAID level', options: NS.raid.LEVELS.map((l) => [l.id, l.name]) },
    intro: 'RAID combines several disks into one. Striping adds speed, mirroring adds safety by copying, and parity adds safety cheaply by storing the XOR of the data. Fail some disks and see what survives.',
    defaults: P.state,
    presets: NS.raid.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'disks', label: 'Disks (2-8)', type: 'number', min: 2, max: 8, half: true }, { key: 'capacity', label: 'Capacity per disk (GB)', type: 'number', min: 1, half: true },
      { key: 'rate', label: 'Rebuild speed (MB/s)', type: 'number', min: 1, half: true }, { key: 'failed', label: 'Failed disks (numbers)', type: 'text', half: true, hint: 'For example "1" or "0 2".' },
      { key: 'data', label: 'Data bytes (0-255)', type: 'text', hint: 'These values fill the data blocks in order, repeating. Parity is the XOR of the data blocks in a stripe.' }],
    about: [['RAID 0', 'Striping only: fastest, all capacity, but any one failure loses everything.'], ['RAID 1', 'Mirroring: every block is copied. Survives all but one disk failing, costs capacity.'], ['RAID 5', 'Striping with one rotating parity block per stripe. Lost block = XOR of the others. Survives one failure.'], ['RAID 6', 'Two parity blocks per stripe: survives any two failures; more write cost.'], ['RAID 10', 'Mirrored pairs that are then striped. Fast writes, and survives one failure per pair.'], ['Memory hook', 'Stripe for speed, mirror for safety, parity for cheap safety. Parity = "A XOR B XOR C" so any one missing piece is the XOR of the rest.']],
    compute: (s) => NS.raid.run({ level: s.level, disks: +s.disks, capacity: +s.capacity, rate: +s.rate, failed: s.failed, data: s.data }),
    draw: (f, i, sim) => {
      const lab = { D: (c) => 'D' + c.block, M: (c) => 'copy of D' + c.block, P: () => 'P', Q: () => 'Q' };
      const head = el('tr', null, el('th', null, 'Stripe'), Array.from({ length: sim.cfg.N }, (_, d) => el('th', null, 'Disk ' + d + (sim.cfg.failed.includes(d) ? ' ✗' : ''))));
      const cell = (c) => el('td', null, el('div', { class: 'fv-cell ' + c.kind + (c.failed ? ' failed' : '') }, lab[c.kind](c), c.value === null ? null : el('small', null, '= ' + c.value)));
      const body = sim.rows.map((r) => el('tr', null, el('th', null, String(r.s)), r.cells.map(cell)));
      const grid = el('div', { class: 'tbl-wrap' }, el('table', { class: 'fv-stripes' }, el('thead', null, head), el('tbody', null, body)));
      const rec = sim.recovered.filter((r) => r.value !== null);
      return { visual: [grid, el('div', { class: 'fv-legend' }, el('span', null, 'D = data'), el('span', null, 'copy = mirror'), el('span', null, 'P, Q = parity'), el('span', null, 'struck out = on a failed disk'), el('span', null, 'Showing the first ' + sim.stripes + ' stripes. Parity rotates one disk left per stripe.'))],
        why: [el('p', { class: sim.survives ? 'mv-ok' : 'mv-bad' }, sim.cfg.failed.length ? (sim.survives ? 'The array survives with disk' + (sim.cfg.failed.length > 1 ? 's ' : ' ') + sim.cfg.failed.join(', ') + ' failed.' : 'Data is LOST: ' + (sim.cfg.level === '10' ? 'both disks of a mirrored pair failed.' : sim.cfg.level === '0' ? 'RAID 0 has no redundancy.' : 'more disks failed than this level tolerates.')) : 'All disks healthy. Fail some disks above to see what happens.'),
          sim.cfg.failed.length && sim.survives && sim.cfg.level === '6' && sim.cfg.failed.length === 2 ? el('p', { class: 'hint' }, 'Rebuilding two lost blocks needs the second parity (Reed-Solomon maths), which this lab does not compute.') : null,
          rec.length ? K.table(['Stripe', 'Disk', 'Block', 'Original', 'Rebuilt', 'How', 'Match'], rec.map((r) => [r.s, r.disk, r.kind, r.original, r.value, r.how, r.ok ? '✓' : '✗'])) : null] };
    },
    stats: (f, sim) => { const p = sim.perf; return [K.table(['Measure', 'Value'], [['Usable capacity', x(p.usable / 1000) + ' TB of ' + x(sim.cfg.N * sim.cfg.C / 1000) + ' TB raw (' + (100 * sim.efficiency).toFixed(0) + '%)'], ['Failures survived', p.tolMin === p.tolMax ? p.tolMin : p.tolMin + ' guaranteed, up to ' + p.tolMax + ' if lucky'], ['Read speed (vs one disk)', 'up to ' + x(p.read) + 'x'], ['Large sequential write', 'up to ' + x(p.write) + 'x'], ['Small random write cost', p.smallNote], ['Rebuild one disk', x(sim.rebuildHours) + ' hours at ' + sim.cfg.rate + ' MB/s']]),
      el('p', { class: 'hint' }, 'Honest limits: speed figures are ideal multiples of one disk; rebuild time ignores foreground load; a second failure or an unreadable sector during a long rebuild is the real danger and is not simulated; the layout is left-asymmetric.')]; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
