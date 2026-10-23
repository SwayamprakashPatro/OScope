// Tier 2C: polling vs interrupts vs DMA. Expected values derived by hand.
const IO = require('../js/engines/iomodes.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const B = { words: 3, device: 4, copy: 1, irq: 2, setup: 2 };
const go = (mode, o) => IO.run(Object.assign({}, B, { mode }, o));
const lane = (r) => r.frames.map((f) => ({ cmd: 'C', spin: 'S', copy: 'c', irq: 'I', setup: 'P', work: 'w' }[f.cpu])).join('');

// W=3 d=4 c=1 o=2 s=2.  poll: 1 + 3*(4+1) = 16.  irq: 1 + 3*(4+2+1) = 22.  dma: 2 + 12 + 2 = 16.
let r = go('poll');
eq('polling timeline: C then (SSSS c) x3', lane(r), 'C' + 'SSSSc'.repeat(3));
eq('polling total 16, useful 0, overhead 16', [r.metrics.total, r.metrics.useful, r.metrics.overhead], [16, 0, 16]);
eq('polling: 0 interrupts, 3 CPU copies', [r.metrics.interrupts, r.metrics.cpuCopies], [0, 3]);
r = go('irq');
eq('interrupt timeline: C then (wwww II c) x3', lane(r), 'C' + 'wwwwIIc'.repeat(3));
eq('interrupt total 22, useful 12, overhead 10 = 1 + 3*(2+1)', [r.metrics.total, r.metrics.useful, r.metrics.overhead], [22, 12, 10]);
eq('interrupt: 3 interrupts', r.metrics.interrupts, 3);
r = go('dma');
eq('DMA timeline: PP then wwww x3 then II', lane(r), 'PP' + 'wwww'.repeat(3) + 'II');
eq('DMA total 16, useful 12, overhead 4 = s + o', [r.metrics.total, r.metrics.useful, r.metrics.overhead], [16, 12, 4]);
eq('DMA: 1 interrupt, no CPU copies', [r.metrics.interrupts, r.metrics.cpuCopies], [1, 0]);
eq('closed-form formulas match the timelines', ['poll', 'irq', 'dma'].map((m) => go(m).metrics.formula === go(m).metrics.total), [true, true, true]);
eq('device lane in polling: idle during cmd and copy, busy while preparing', go('poll').frames.map((f) => f.dev[0]).join(''), 'i' + 'bbbbi'.repeat(3));
eq('device lane in DMA is "dma" during the transfer', go('dma').frames.filter((f) => f.dev === 'dma').length, 12);
eq('frames carry running totals', [r.frames[5].useful, r.frames[5].overhead], [4, 2]);
eq('efficiency = useful / total', go('irq').metrics.efficiency, 12 / 22);

// Break-even: interrupt overhead vs device wait
let cmp = IO.compare({ words: 8, device: 2, copy: 1, irq: 4, setup: 3 });
eq('fast device: polling overhead (1+8*3=25) beats interrupt overhead (1+8*5=41)', [cmp.rows[0].overhead, cmp.rows[1].overhead], [25, 41]);
eq('fast device note says polling wastes less', /polling wastes less/.test(cmp.notes[0]), true);
cmp = IO.compare({ words: 4, device: 8, copy: 1, irq: 2, setup: 3 });
eq('slow device: interrupt overhead 1+4*3=13 vs polling 1+4*9=37', [cmp.rows[1].overhead, cmp.rows[0].overhead], [13, 37]);
eq('slow device note says interrupts save CPU time', /interrupts save CPU/.test(cmp.notes[0]), true);
eq('best (lowest) CPU overhead is DMA: 3+2=5', [cmp.best.overhead, cmp.rows[2].overhead], [2, 5]);
eq('interrupt mode finishes LATER than polling (it trades latency for free CPU)', cmp.rows[1].total > cmp.rows[0].total, true);
cmp = IO.compare({ words: 1, device: 3, copy: 1, irq: 2, setup: 4 });
eq('single word: DMA overhead (4+2=6) is worse than interrupt-driven (1+2+1=4)', [cmp.rows[2].overhead, cmp.rows[1].overhead], [6, 4]);
eq('...and the note says DMA setup is not worth it', /not cheaper/.test(cmp.notes[1]), true);
eq('lowest total time for one word is polling (1+3+1=5)', cmp.best.total, 0);

// Errors
eq('words 0', go('poll', { words: 0 }).ok, false); eq('device 21', go('poll', { device: 21 }).ok, false); eq('fractional', go('poll', { copy: 1.5 }).ok, false);
eq('too long', go('irq', { words: 16, device: 20, irq: 10 }).ok, false); eq('compare reports errors too', IO.compare({ words: 0, device: 1, copy: 1, irq: 1, setup: 1 }).ok, false);
eq('unknown mode falls back to polling', IO.run(Object.assign({}, B, { mode: 'x' })).cfg.mode, 'poll');

// Random invariants over the whole parameter space
let seed = 31; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 500; k++) {
  const cfg = { words: 1 + rnd(16), device: 1 + rnd(20), copy: 1 + rnd(5), irq: 1 + rnd(10), setup: 1 + rnd(10) }, c = IO.compare(cfg);
  if (!c.ok) continue;                                                   // only the over-long ones are refused
  c.rows.forEach((x) => { if (x.useful + x.overhead !== x.total || x.total !== x.formula) bad++; });
  ['poll', 'irq', 'dma'].forEach((m) => { const r = IO.run({ ...cfg, mode: m }); const words = new Set(r.frames.filter((f) => f.word).map((f) => f.word)); if (words.size !== cfg.words) bad++;
    if (m !== 'dma' && r.frames.filter((f) => f.cpu === 'copy').length !== cfg.words * cfg.copy) bad++; if (m === 'dma' && r.frames.some((f) => f.cpu === 'copy')) bad++;
    if (m === 'poll' && r.metrics.useful) bad++; });
  // interrupts beat polling on CPU overhead exactly when o < d
  const pollO = c.rows[0].overhead, irqO = c.rows[1].overhead; if ((cfg.irq < cfg.device) !== (irqO < pollO) && cfg.irq !== cfg.device) bad++;
  if (cfg.irq === cfg.device && irqO !== pollO) bad++;
  // interrupt-driven always finishes later than polling
  if (!(c.rows[1].total > c.rows[0].total)) bad++;
}
eq('500 random parameter sets: totals match formulas, every word moved, break-even is exactly o < d', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
