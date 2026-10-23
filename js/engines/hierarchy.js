/* Tier 2A: memory hierarchy and effective access time (EAT). Two calculators: a stack of levels with hit ratios,
   and paging with a TLB, page-table levels and page faults. All values come from the inputs. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // Levels are tried in order; a miss pays that level's lookup time and goes on to the next.
  // EAT = sum over levels of P(reach level) * hit ratio * (time of all lookups so far).
  function eatLevels(levels) {
    let reach = 1, cum = 0, eat = 0; const rows = [];
    levels.forEach((l, i) => {
      const last = i === levels.length - 1, h = last ? 1 : l.hit; cum += l.time;
      const share = reach * h; eat += share * cum;
      rows.push({ name: l.name, hit: h, time: l.time, reach, served: share, cum, contrib: share * cum }); reach *= 1 - h;
    });
    return { rows, eat };
  }
  // Paging: TLB hit costs tlb + mem. TLB miss costs tlb + L table reads + mem. A page fault adds the service time.
  function eatPaging(p) {
    const hitT = p.tlb + p.mem, missT = p.tlb + p.levels * p.mem + p.mem, noFault = p.alpha * hitT + (1 - p.alpha) * missT;
    return { hitT, missT, noFault, eat: (1 - p.p) * noFault + p.p * p.fault };
  }
  // Largest page-fault rate that keeps EAT within `slow` times the no-fault EAT.
  function maxFaultRate(p, slow) { const b = eatPaging(Object.assign({}, p, { p: 0 })).noFault; return p.fault > b ? (slow - 1) * b / (p.fault - b) : 1; }

  function run(cfg, text) {
    const errors = [], levels = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/), h = +t[1], tm = +t[2];
      if (t.length !== 3 || !(h >= 0 && h <= 1) || !(tm >= 0)) errors.push('Line ' + (i + 1) + ': write "name hit-ratio time", hit ratio between 0 and 1.');
      else levels.push({ name: t[0], hit: h, time: tm });
    });
    if (levels.length < 2 && !errors.length) errors.push('Enter at least two levels (the last one always hits).');
    if (levels.length > 6) errors.push('At most 6 levels.');
    const p = { alpha: +cfg.alpha, tlb: +cfg.tlb, mem: +cfg.mem, levels: +cfg.ptlevels, p: +cfg.pfault, fault: +cfg.faultTime };
    if (!(p.alpha >= 0 && p.alpha <= 1)) errors.push('TLB hit ratio must be between 0 and 1.');
    if (!(p.tlb >= 0) || !(p.mem > 0)) errors.push('TLB time must be 0 or more and memory time above 0.');
    if (![1, 2, 3, 4].includes(p.levels)) errors.push('Page-table levels must be 1 to 4.');
    if (!(p.p >= 0 && p.p <= 1)) errors.push('Page-fault rate must be between 0 and 1.');
    if (!(p.fault >= 0)) errors.push('Fault service time must be 0 or more.');
    if (errors.length) return { ok: false, errors };
    const lv = eatLevels(levels), pg = eatPaging(p), base = pg.noFault;
    const sens = [0, 0.5, 0.8, 0.9, 0.95, 0.99, 1].map((a) => ({ alpha: a, eat: eatPaging(Object.assign({}, p, { alpha: a, p: 0 })).noFault }));
    return { ok: true, levels: lv, paging: pg, params: p, maxP10: maxFaultRate(p, 1.1), sens, frames: [{ i: 0, text: '' }], base };
  }

  const PRESETS = [
    { id: 'cache', name: 'Cache + RAM + disk', note: 'Tiny miss rates matter: look at which level contributes most to the average.', cfg: { alpha: 0.98, tlb: 1, mem: 100, ptlevels: 2, pfault: 0.00001, faultTime: 8000000 }, text: 'L1 0.9 1\nL2 0.95 10\nRAM 0.999 100\nDisk 1 8000000' },
    { id: 'tlb', name: 'TLB matters', note: 'Drop the TLB hit ratio and watch the 4-level walk dominate.', cfg: { alpha: 0.8, tlb: 20, mem: 100, ptlevels: 4, pfault: 0, faultTime: 8000000 }, text: 'L1 0.9 1\nRAM 1 100' }
  ];
  NS.hierarchy = { eatLevels, eatPaging, maxFaultRate, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.hierarchy;
})(typeof window !== 'undefined' ? window : globalThis);
