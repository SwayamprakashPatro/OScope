/* Tier 2C: three ways to move data between a device and memory: polling (programmed I/O), interrupt-driven I/O and DMA.
   Pure logic, no DOM. The CPU must transfer `words` words from a device. Per tick the CPU is doing one of:
     cmd    writes the command register (1 tick)            spin   busy-waits reading the status register (polling)
     copy   moves one word from the device to memory        irq    interrupt overhead (save state, ISR entry, return)
     setup  programs the DMA controller                     work   useful computation for someone else (CPU is FREE)
   and the device is either idle or busy preparing a word / moving it by DMA.
   Timing rules (one-word device buffer, so the device starts the next word only after the CPU copied the last):
     polling    1 + W*(d + c)        CPU never free
     interrupt  1 + W*(d + o + c)    CPU free for d ticks per word, pays o + c per word
     DMA        s + W*d + o          CPU free during the whole transfer, pays setup once and ONE interrupt at the end
   (d = device time per word, c = CPU copy time, o = interrupt overhead, s = DMA setup.)
   Not modelled: DMA stealing bus cycles from the CPU, device buffers deeper than one word, interrupt coalescing. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MODES = [{ id: 'poll', name: 'Polling' }, { id: 'irq', name: 'Interrupt-driven' }, { id: 'dma', name: 'DMA' }];
  const MAX_TICKS = 400;

  function check(cfg) {
    const errors = [], W = +cfg.words, d = +cfg.device, c = +cfg.copy, o = +cfg.irq, s = +cfg.setup;
    const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!whole(W, 1, 16)) errors.push('Words to transfer must be 1 to 16.');
    if (!whole(d, 1, 20)) errors.push('Device time per word must be 1 to 20 ticks.');
    if (!whole(c, 1, 5)) errors.push('CPU copy time per word must be 1 to 5 ticks.');
    if (!whole(o, 1, 10)) errors.push('Interrupt overhead must be 1 to 10 ticks.');
    if (!whole(s, 1, 10)) errors.push('DMA setup time must be 1 to 10 ticks.');
    return { errors, W, d, c, o, s };
  }

  function run(cfg) {
    const mode = MODES.some((m) => m.id === cfg.mode) ? cfg.mode : 'poll', v = check(cfg);
    if (v.errors.length) return { ok: false, errors: v.errors };
    const { W, d, c, o, s } = v, tl = [];                        // tl[t] = { cpu, dev, word }
    const push = (n, cpu, dev, word) => { for (let i = 0; i < n; i++) tl.push({ cpu, dev, word }); };
    if (mode === 'poll') { push(1, 'cmd', 'idle'); for (let k = 1; k <= W; k++) { push(d, 'spin', 'busy', k); push(c, 'copy', 'idle', k); } }
    else if (mode === 'irq') { push(1, 'cmd', 'idle'); for (let k = 1; k <= W; k++) { push(d, 'work', 'busy', k); push(o, 'irq', 'idle', k); push(c, 'copy', 'idle', k); } }
    else { push(s, 'setup', 'idle'); for (let k = 1; k <= W; k++) push(d, 'work', 'dma', k); push(o, 'irq', 'idle'); }
    if (tl.length > MAX_TICKS) return { ok: false, errors: ['Timeline would pass ' + MAX_TICKS + ' ticks. Reduce words or device time.'] };
    const why = {
      cmd: 'The CPU writes the command register to start the transfer.', spin: 'The CPU reads the status register again and again, waiting for the device. It does nothing else: this is busy-waiting.',
      copy: 'The CPU copies one word from the device register into memory.', irq: mode === 'dma' ? 'The DMA controller raises ONE interrupt: the whole block is already in memory.' : 'The device interrupts: the CPU saves its state, runs the ISR and returns. This overhead is paid for every word.',
      setup: 'The CPU tells the DMA controller the memory address, the length and the direction, then walks away.', work: mode === 'dma' ? 'The CPU runs other useful work while the DMA controller moves the data.' : 'The CPU is free: it runs other useful work while the device prepares the next word.'
    };
    const cum = { work: 0, over: 0 }; const frames = tl.map((x, t) => { if (x.cpu === 'work') cum.work++; else cum.over++; return { t, cpu: x.cpu, dev: x.dev, word: x.word || null, why: why[x.cpu], useful: cum.work, overhead: cum.over, devText: x.dev === 'busy' ? 'preparing word ' + x.word : x.dev === 'dma' ? 'DMA moving word ' + x.word : 'idle' }; });
    const total = tl.length, useful = tl.filter((x) => x.cpu === 'work').length, over = total - useful;
    const wait = (mode === 'poll' ? 1 + W * (d + c) : mode === 'irq' ? 1 + W * (d + o + c) : s + W * d + o);
    return { ok: true, cfg: { mode, W, d, c, o, s }, frames, tl, metrics: { total, useful, overhead: over, efficiency: useful / total, interrupts: mode === 'poll' ? 0 : mode === 'irq' ? W : 1, cpuCopies: mode === 'dma' ? 0 : W, formula: wait } };
  }

  // Compare all three on the same parameters and explain the winner.
  function compare(cfg) {
    const rs = MODES.map((m) => run({ ...cfg, mode: m.id })); if (rs.some((r) => !r.ok)) return rs.find((r) => !r.ok);
    const [p, i, dm] = rs.map((r) => r.metrics), { d, o, W, c, s } = rs[0].cfg, notes = [];
    notes.push(o < d ? 'Per word, an interrupt costs the CPU ' + o + ' ticks against ' + d + ' spent spinning, so interrupts save CPU time.' : o > d ? 'The interrupt overhead (' + o + ') is larger than the device wait (' + d + '): polling wastes less CPU per word than interrupts. This is why very fast devices (NICs, NVMe) are polled or interrupt-coalesced.' : 'Interrupt overhead equals the device wait: a tie on CPU time, but interrupts finish later.');
    notes.push(s + o < W * (o + c) ? 'DMA pays ' + (s + o) + ' ticks once instead of ' + W * (o + c) + ' ticks of per-word interrupts and copying.' : 'For this tiny transfer DMA setup (' + (s + o) + ' ticks) is not cheaper than doing it by interrupts (' + W * (o + c) + ' ticks).');
    return { ok: true, rows: MODES.map((m, k) => ({ id: m.id, name: m.name, ...rs[k].metrics })), notes, best: { overhead: rs.map((r) => r.metrics.overhead).indexOf(Math.min(...rs.map((r) => r.metrics.overhead))), total: rs.map((r) => r.metrics.total).indexOf(Math.min(...rs.map((r) => r.metrics.total))) } };
  }

  const PRESETS = [
    { id: 'slow', name: 'Slow device (a disk)', note: 'Each word takes 8 ticks to arrive. Polling burns all of them; interrupts and DMA give the CPU back.', state: { mode: 'irq', words: 4, device: 8, copy: 1, irq: 2, setup: 3 } },
    { id: 'fast', name: 'Fast device: interrupts hurt', note: 'The device is quicker than an interrupt can be handled (2 vs 4). Per-word interrupts waste MORE CPU than spinning.', state: { mode: 'irq', words: 8, device: 2, copy: 1, irq: 4, setup: 3 } },
    { id: 'big', name: 'Big block: DMA shines', note: '16 words. Polling and interrupts copy every word through the CPU; DMA takes one setup and one interrupt.', state: { mode: 'dma', words: 16, device: 4, copy: 2, irq: 3, setup: 4 } },
    { id: 'tiny', name: 'One word: DMA setup not worth it', note: 'For a single word the DMA setup costs more than just reading it.', state: { mode: 'dma', words: 1, device: 3, copy: 1, irq: 2, setup: 4 } }
  ];
  NS.iomodes = { MODES, MAX_TICKS, run, compare, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.iomodes;
})(typeof window !== 'undefined' ? window : globalThis);
