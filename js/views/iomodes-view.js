/* I/O modes view: CPU lane and device lane for polling, interrupt-driven I/O and DMA, plus a side-by-side comparison. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, PV = NS.pv, IO = NS.iomodes, P = IO.PRESETS[0];
  const CPU = { cmd: ['cost', 'C', 'command'], spin: ['cost', '⟳', 'spinning'], copy: ['cost', 'c', 'copying a word'], irq: ['cost', 'I', 'interrupt overhead'], setup: ['cost', 'P', 'DMA setup'], work: ['free', '✓', 'free for useful work'] };
  K.reg('iomodes', {
    key: 'iomodes', title: 'Polling, interrupts and DMA', statsTitle: 'Comparing the three methods', visualTitle: 'CPU and device, tick by tick', label: 'Tick',
    chips: { key: 'mode', label: 'I/O method', options: IO.MODES.map((m) => [m.id, m.name]) },
    intro: 'To read a block from a device the CPU can wait in a loop (polling), go and do other work until the device interrupts, or hand the whole block to a DMA controller. Each costs CPU time differently, and the cheapest depends on how fast the device is.',
    defaults: P.state,
    presets: IO.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'words', label: 'Words to transfer', type: 'number', min: 1, max: 16, half: true }, { key: 'device', label: 'Device time per word (d)', type: 'number', min: 1, max: 20, half: true },
      { key: 'copy', label: 'CPU copy time per word (c)', type: 'number', min: 1, max: 5, half: true }, { key: 'irq', label: 'Interrupt overhead (o)', type: 'number', min: 1, max: 10, half: true }, { key: 'setup', label: 'DMA setup time (s)', type: 'number', min: 1, max: 10, hint: 'All times are in ticks.' }],
    about: [['Polling', 'The CPU reads the status register in a loop. Zero latency when the device is fast, but every waiting tick is wasted.'], ['Interrupt-driven', 'The CPU starts the device and runs something else. Each word costs an interrupt (save state, ISR, return) plus the copy. Wins when o is smaller than the device wait d.'], ['DMA', 'A controller moves the whole block between device and memory by itself. The CPU pays one setup and one interrupt at the end, and never copies the data.'], ['Rule of thumb', 'Slow device: interrupts. Big block: DMA. Very fast device or tiny transfer: polling can be cheapest.'], ['Memory hook', 'Poll = keep checking the oven. Interrupt = timer beeps for every tray. DMA = a helper loads the whole batch and calls you once.']],
    compute: (s) => PV.withStart(IO.run({ mode: s.mode, words: +s.words, device: +s.device, copy: +s.copy, irq: +s.irq, setup: +s.setup })),
    draw: (f, i, sim) => {
      const T = sim.ticksFrames, now = i - 1, cur = f.start ? null : f;
      const rows = [{ label: 'CPU', cell: (t) => { const x = T[t]; if (!x) return null; const [cls, text, title] = CPU[x.cpu]; return { cls, text, title }; } },
        { label: 'Device', cell: (t) => { const x = T[t]; if (!x || x.dev === 'idle') return null; return { cls: 'dev', text: String(x.word), title: x.devText }; } }];
      return { visual: [PV.timeline({ ticks: T.length, now, rows, aria: 'Timeline of the CPU and the device' }), PV.legend([['free', '✓ CPU free for useful work'], ['cost', 'C command, ⟳ spinning, c copy, I interrupt, P DMA setup: CPU time spent on the I/O'], ['', 'blue number = device working on that word']]),
        cur ? el('div', { class: 'pv-qs' }, el('div', { class: 'pv-q cpu' }, el('b', null, 'CPU'), el('span', null, CPU[cur.cpu][2] + ' — ' + cur.why)), el('div', { class: 'pv-q' }, el('b', null, 'Device'), el('span', null, cur.devText)), el('div', { class: 'pv-q' }, el('b', null, 'So far'), el('span', null, cur.useful + ' ticks of useful work, ' + cur.overhead + ' ticks spent on the I/O'))) : null],
        why: [el('p', { class: 'hint' }, cur ? cur.why : 'Step through to see what the CPU does at each tick.')] };
    },
    stats: (f, sim, st) => {
      const c = IO.compare({ words: +st.words, device: +st.device, copy: +st.copy, irq: +st.irq, setup: +st.setup }); if (!c.ok) return [];
      return [K.table(['Method', 'Finishes at', 'CPU time spent on the I/O', 'CPU left for other work', 'Useful share', 'Interrupts', 'CPU copies'], c.rows.map((r, k) => [r.name + (r.id === st.mode ? '  (selected)' : ''), 'tick ' + r.total, r.overhead + (k === c.best.overhead ? '  ← least' : ''), r.useful, Math.round(100 * r.efficiency) + '%', r.interrupts, r.cpuCopies])),
        el('ul', { class: 'fv-steps' }, c.notes.map((n) => el('li', null, n))),
        el('p', { class: 'hint' }, 'Honest limits: one-word device buffer (the device waits for the CPU to copy before preparing the next word), DMA does not steal bus cycles from the CPU, no interrupt coalescing, and "useful work" is assumed to be always available.')];
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
