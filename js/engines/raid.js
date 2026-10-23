/* Tier 2B: RAID 0, 1, 5, 6 and 10. Computes capacity, fault tolerance and I/O cost from the number of disks, draws
   the stripe layout (data and parity placement), and shows what survives when you fail disks, including the XOR
   rebuild of a lost block. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LEVELS = [{ id: '0', name: 'RAID 0', minN: 2 }, { id: '1', name: 'RAID 1', minN: 2 }, { id: '5', name: 'RAID 5', minN: 3 }, { id: '6', name: 'RAID 6', minN: 4 }, { id: '10', name: 'RAID 10', minN: 4 }];
  const STRIPES = 6;

  // Layout of one stripe: array over disks of { kind:'D'|'P'|'Q'|'M', block }. M = mirror copy of 'block'.
  function stripe(level, N, s) {
    const cells = new Array(N).fill(null); let d;
    if (level === '0') { for (let i = 0; i < N; i++) cells[i] = { kind: 'D', block: s * N + i }; }
    else if (level === '1') { for (let i = 0; i < N; i++) cells[i] = { kind: i === 0 ? 'D' : 'M', block: s }; }
    else if (level === '10') { const pairs = N / 2; for (let p = 0; p < pairs; p++) { cells[2 * p] = { kind: 'D', block: s * pairs + p }; cells[2 * p + 1] = { kind: 'M', block: s * pairs + p }; } }
    else {
      const P = (N - 1 - (s % N) + N) % N, Q = level === '6' ? (P + 1) % N : -1; d = 0;   // parity rotates one disk to the left each stripe
      for (let i = 0; i < N; i++) { if (i === P) cells[i] = { kind: 'P' }; else if (i === Q) cells[i] = { kind: 'Q' }; else cells[i] = { kind: 'D', block: s * (N - (Q >= 0 ? 2 : 1)) + d++ }; }
    }
    return cells;
  }

  function perf(level, N, C) {
    const h = N / 2;
    return { '0': { usable: N * C, tolMin: 0, tolMax: 0, read: N, write: N, small: 1, smallNote: '1 write' },
      '1': { usable: C, tolMin: N - 1, tolMax: N - 1, read: N, write: 1, small: N, smallNote: N + ' writes (one per copy)' },
      '5': { usable: (N - 1) * C, tolMin: 1, tolMax: 1, read: N - 1, write: N - 1, small: 4, smallNote: '4 I/Os: read old data and old parity, write new data and new parity' },
      '6': { usable: (N - 2) * C, tolMin: 2, tolMax: 2, read: N - 2, write: N - 2, small: 6, smallNote: '6 I/Os: read old data, P and Q, write all three' },
      '10': { usable: h * C, tolMin: 1, tolMax: h, read: N, write: h, small: 2, smallNote: '2 writes (data and its mirror)' } }[level];
  }

  function run(cfg) {
    const errors = [], level = String(cfg.level), N = +cfg.disks, C = +cfg.capacity, rate = +cfg.rate, lv = LEVELS.find((l) => l.id === level);
    if (!lv) errors.push('Choose a RAID level.');
    if (!Number.isInteger(N) || N < 2 || N > 8) errors.push('Disks must be 2 to 8.');
    else if (lv && N < lv.minN) errors.push(lv.name + ' needs at least ' + lv.minN + ' disks.');
    else if (level === '10' && N % 2) errors.push('RAID 10 needs an even number of disks.');
    if (!(C > 0)) errors.push('Disk capacity must be above 0 (GB).'); if (!(rate > 0)) errors.push('Rebuild speed must be above 0 (MB/s).');
    const bytes = String(cfg.data || '').split(/[\s,]+/).filter(Boolean).map((x) => (/^0x/i.test(x) ? parseInt(x, 16) : /^\d+$/.test(x) ? +x : NaN));
    if (!bytes.length) errors.push('Enter at least one data byte.'); else if (bytes.some((b) => !(b >= 0 && b <= 255))) errors.push('Data values must be whole numbers 0 to 255 (or 0x hex).');
    const failed = [...new Set(String(cfg.failed || '').split(/[\s,]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
    if (failed.some((f) => !Number.isInteger(f) || f < 0 || f >= N)) errors.push('Failed disks must be numbers from 0 to ' + (N - 1) + '.');
    if (errors.length) return { ok: false, errors };

    const dataAt = (blk) => bytes[blk % bytes.length];
    const rows = [];
    for (let s = 0; s < STRIPES; s++) {
      const cells = stripe(level, N, s), dataVals = cells.filter((c) => c.kind === 'D').map((c) => dataAt(c.block));
      const parity = (level === '5' || level === '6') ? dataVals.reduce((a, b) => a ^ b, 0) : null;
      cells.forEach((c, i) => { c.disk = i; c.value = c.kind === 'D' || c.kind === 'M' ? dataAt(c.block) : c.kind === 'P' ? parity : null; c.failed = failed.includes(i); });
      rows.push({ s, cells, parity });
    }
    // Survival and rebuild
    let survives, detail; const lost = [];
    if (level === '0') survives = failed.length === 0;
    else if (level === '1') survives = failed.length < N;
    else if (level === '5') survives = failed.length <= 1;
    else if (level === '6') survives = failed.length <= 2;
    else survives = Array.from({ length: N / 2 }, (_, p) => !(failed.includes(2 * p) && failed.includes(2 * p + 1))).every(Boolean);
    const recovered = []; let canCompute = true;
    rows.forEach((row) => row.cells.forEach((c) => {
      if (!c.failed) return;
      let v = null, how = '';
      if (level === '5' || (level === '6' && failed.length === 1)) { const others = row.cells.filter((x, i) => i !== c.disk && x.kind !== 'Q'); if (!others.some((x) => x.failed)) { v = others.reduce((a, x) => a ^ (x.kind === 'P' ? row.parity : x.value), 0); how = 'XOR of the surviving blocks in the stripe'; } }
      else if (level === '1' || level === '10') { const mate = level === '1' ? row.cells.find((x) => !x.failed) : row.cells[c.disk ^ 1]; if (mate && !mate.failed) { v = c.kind === 'Q' ? null : (c.kind === 'D' || c.kind === 'M' ? mate.value : null); how = 'copy from the mirror (disk ' + mate.disk + ')'; } }
      else if (level === '6' && failed.length === 2) canCompute = false;
      if (c.kind === 'D' || c.kind === 'M' || c.kind === 'P') recovered.push({ s: row.s, disk: c.disk, kind: c.kind, original: c.value, value: v, how, ok: v !== null && v === c.value });
      if (v === null && level !== '6' && c.kind !== 'Q') lost.push({ s: row.s, disk: c.disk });
    }));
    const p = perf(level, N, C), hours = (C * 1024) / rate / 3600;
    return { ok: true, cfg: { level, N, C, rate, failed }, rows, perf: p, survives, recovered, lost, canCompute, rebuildHours: hours, stripes: STRIPES, efficiency: p.usable / (N * C) };
  }

  const PRESETS = [
    { id: 'r5', name: 'RAID 5, one disk fails', note: 'Disk 1 is lost. Each missing block is the XOR of the others in its stripe, so the array survives.', state: { level: '5', disks: 4, capacity: 1000, rate: 100, failed: '1', data: '5 12 10 7 9 3 14 6 11' } },
    { id: 'r5x', name: 'RAID 5, two disks fail', note: 'A second failure removes too much: one parity cannot solve for two unknowns.', state: { level: '5', disks: 4, capacity: 1000, rate: 100, failed: '1 2', data: '5 12 10 7 9 3 14 6 11' } },
    { id: 'r10', name: 'RAID 10 luck', note: 'Disks 0 and 2 are in different mirror pairs (survives); disks 0 and 1 are the same pair (data lost).', state: { level: '10', disks: 4, capacity: 1000, rate: 100, failed: '0 2', data: '5 12 10 7 9 3 14 6 11' } },
    { id: 'r6', name: 'RAID 6, two disks fail', note: 'Two parities survive any two failures. This lab shows the layout and verdict but does not compute the two-failure maths.', state: { level: '6', disks: 5, capacity: 1000, rate: 100, failed: '0 3', data: '5 12 10 7 9 3 14 6 11' } }
  ];
  NS.raid = { LEVELS, STRIPES, stripe, perf, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.raid;
})(typeof window !== 'undefined' ? window : globalThis);
