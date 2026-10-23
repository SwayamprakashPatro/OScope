/* Threading-model view: the same request stream served by one thread, a thread per request, or a fixed pool.
   Per-request timeline (waiting, creating a thread, running, rejected) plus a comparison of all three models. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el, colorFor } = NS.util, K = NS.kit, PV = NS.pv, TP = NS.threadpool, P = TP.PRESETS[0];
  K.reg('threadpool', {
    key: 'threadpool', title: 'Thread pools and threading models', statsTitle: 'Comparing the three models', visualTitle: 'Request timeline', label: 'Tick',
    chips: { key: 'model', label: 'Server model', options: [['single', 'One thread'], ['perrequest', 'Thread per request'], ['pool', 'Thread pool']] },
    intro: 'A server gets a stream of requests. It can handle them one at a time, create a new thread for every request, or keep a fixed pool of workers and a waiting queue. Compare latency, throughput and what happens under a burst.',
    defaults: P.state,
    presets: TP.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'cores', label: 'CPU cores', type: 'number', min: 1, max: 16, half: true }, { key: 'workers', label: 'Pool size (workers)', type: 'number', min: 1, max: 16, half: true },
      { key: 'queueCap', label: 'Queue size (pool)', type: 'number', min: 0, max: 20, half: true, hint: 'Waiting requests allowed. A request that finds every worker busy and the queue full is rejected.' }, { key: 'spawn', label: 'Thread creation cost (ticks)', type: 'number', min: 0, max: 10, half: true },
      { key: 'overhead', label: 'Overhead per extra thread (%)', type: 'number', min: 0, max: 50, hint: 'Slowdown for each runnable thread beyond the core count (context switches, cache misses).' },
      { key: 'requests', label: 'Requests', type: 'area', rows: 6, hint: 'One per line: name arrive work (CPU ticks).' }],
    about: [['One thread', 'Simple and safe, but one slow request delays all the ones behind it (head-of-line blocking) and extra cores sit idle.'], ['Thread per request', 'Great for light load: every request starts at once. Under a burst the thread count explodes, creation costs add up, and the cores thrash.'], ['Thread pool', 'A fixed set of workers is reused. The pool size caps the load, the queue absorbs bursts, and a full queue sheds load instead of collapsing.'], ['Sizing rule', 'For CPU-bound work, pool size is about the core count. For work that waits on I/O, more threads help because they are not all runnable.'], ['Memory hook', 'Pool = taxis at a rank: a fixed fleet, a queue of riders, and a rule for when the queue is too long.']],
    compute: (s) => PV.withStart(TP.run({ model: s.model, cores: +s.cores, workers: +s.workers, queueCap: +s.queueCap, spawn: +s.spawn, overhead: +s.overhead, requests: s.requests })),
    draw: (f, i, sim) => {
      const T = sim.ticksFrames, now = i - 1, cur = f.start ? null : f;
      const rows = sim.rows.map((r, k) => ({ label: r.name, cell: (t) => { const fr = T[t]; if (!fr) return null;
        if (fr.active.some((a) => a.name === r.name)) return { cls: 'run', bg: colorFor(k), text: fr.rate >= 1 ? '' : PV.f1(fr.rate), title: r.name + ' runs at ' + PV.f1(fr.rate) + ' of a core' };
        if (fr.queue.includes(r.name)) return { cls: 'wait', text: '' }; if (fr.spawning.includes(r.name)) return { cls: 'spawn', text: '+' };
        if (r.status === 'rejected' && r.arrive === t) return { cls: 'bad', text: '✕', title: r.name + ' rejected' }; return null; } }));
      const panel = cur ? el('div', { class: 'pv-qs' }, cur.slots ? el('div', { class: 'pv-q cpu' }, el('b', null, 'Workers'), cur.slots.map((s, k) => el('span', { class: 'pv-badge ' + (s ? 'ok' : '') }, 'W' + k + ': ' + (s || 'idle')))) : el('div', { class: 'pv-q cpu' }, el('b', null, 'Threads'), el('span', null, cur.threads + ' alive')),
        el('div', { class: 'pv-q' }, el('b', null, 'Queue'), cur.queue.length ? cur.queue.map((n) => PV.chip(n, sim.rows.findIndex((r) => r.name === n))) : PV.empty()), el('div', { class: 'pv-q' }, el('b', null, 'Speed'), el('span', null, cur.active.length + ' running on ' + sim.cfg.cores + ' core' + (sim.cfg.cores > 1 ? 's' : '') + ' → each at ' + PV.f1(cur.rate) + ' of a core'))) : null;
      return { visual: [PV.timeline({ ticks: T.length, now, rows, aria: 'Timeline per request: solid = running, dashed = waiting in the queue, hatched = thread being created, red cross = rejected' }), PV.legend([['', 'solid = running (number = share of a core when sharing)'], ['wait', 'dashed = waiting in queue'], ['spawn', 'hatched = thread being created'], ['cost', '✕ = rejected']]), panel],
        why: cur ? [cur.notes.length ? el('ul', { class: 'fv-steps' }, cur.notes.map((n) => el('li', null, n))) : el('p', { class: 'hint' }, 'No new events this tick.')] : [el('p', { class: 'hint' }, 'Step through to watch requests queue, start and finish.')] };
    },
    stats: (f, sim, st) => {
      const m = sim.metrics, base = { cores: +st.cores, workers: +st.workers, queueCap: +st.queueCap, spawn: +st.spawn, overhead: +st.overhead, requests: st.requests };
      const all = [['single', 'One thread'], ['perrequest', 'Thread per request'], ['pool', 'Thread pool']].map(([id, name]) => ({ id, name, r: TP.run({ ...base, model: id }) }));
      return [K.metrics([['Completed', m.completed], ['Rejected', m.rejected], ['Avg response', m.avgResponse === null ? '-' : PV.f1(m.avgResponse)], ['Slowest', m.maxResponse === null ? '-' : m.maxResponse], ['Peak threads', m.peakThreads], ['Core use', Math.round(100 * m.coreUse) + '%']]),
        K.table(['Model', 'Completed', 'Rejected', 'Avg response', 'Slowest', 'Threads created', 'Finished at'], all.map((x) => x.r.ok ? [x.name + (x.id === st.model ? '  (selected)' : ''), x.r.metrics.completed, x.r.metrics.rejected, x.r.metrics.avgResponse === null ? '-' : PV.f1(x.r.metrics.avgResponse), x.r.metrics.maxResponse === null ? '-' : x.r.metrics.maxResponse, x.r.metrics.threadsCreated, 'tick ' + x.r.metrics.ticks] : [x.name, 'too long', '', '', '', '', ''])),
        el('p', { class: 'hint' }, 'Response = finish minus arrival, in whole ticks (rejected requests excluded). Honest limits: a toy CPU-sharing model with a flat overhead per extra thread, CPU-bound work only (no I/O waits, locks or memory per thread), creation delay uses no CPU, and rejection is the only overload policy.')];
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
