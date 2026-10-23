/* Tier 2C shared view helpers (the processes and I/O labs): a tick timeline, queue chips, a legend and a "Start" frame.
   Views only draw; every number shown comes from the engines. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor, textOn } = NS.util;

  // withStart(sim): prepend an empty "Start" frame so Step 0 shows the layout before anything has happened.
  // Frame index i then means "after tick i-1" (i = 0 is before the first tick).
  function withStart(sim) { if (sim.ok) { sim.ticksFrames = sim.frames; sim.frames = [{ start: true, t: -1 }].concat(sim.frames); } return sim; }

  // timeline({ ticks, now, rows: [{ label, cell: (t) => ({ cls, text, bg, title }) }] })
  // Draws one coloured cell per tick per row. Cells after `now` are faded, the current tick is outlined.
  function timeline(o) {
    const head = el('div', { class: 'pv-row pv-head' }, el('div', { class: 'pv-lab' }), Array.from({ length: o.ticks }, (_, t) => el('div', { class: 'pv-c' + (t === o.now ? ' now' : '') }, t % 5 === 0 || t === o.now ? String(t) : '')));
    const rows = o.rows.map((r) => el('div', { class: 'pv-row' }, el('div', { class: 'pv-lab', title: r.label }, r.label),
      Array.from({ length: o.ticks }, (_, t) => { const c = r.cell(t) || {}; const style = {}; if (c.bg) { style.background = c.bg; style.color = textOn(c.bg); }
        return el('div', { class: 'pv-c ' + (c.cls || '') + (t > o.now ? ' future' : '') + (t === o.now ? ' now' : ''), style, title: c.title || '', 'data-m': c.m }, c.text || ''); })));
    return el('div', { class: 'pv-tl', role: 'img', 'aria-label': o.aria || 'Timeline, one column per tick' }, head, rows);
  }

  const chip = (name, idx) => el('span', { class: 'pv-chip', style: { background: colorFor(idx), color: textOn(colorFor(idx)) } }, name);
  const empty = () => el('span', { class: 'pv-none' }, 'empty');
  const legend = (items) => el('div', { class: 'pv-legend' }, items.map(([cls, text, bg]) => el('span', null, el('i', { class: 'pv-sw ' + cls, style: bg ? { background: bg } : {} }), text)));
  const badge = (kind, text) => el('span', { class: 'pv-badge ' + kind }, text);
  const f1 = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  NS.pv = { withStart, timeline, chip, empty, legend, badge, f1 };
})(typeof window !== 'undefined' ? window : globalThis);
