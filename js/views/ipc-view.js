/* IPC view: a pipe (byte stream), a message queue (whole messages with priorities) or a signal-handling process.
   Switch with the chips; each has its own script of calls. Everything comes from NS.ipc. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, PV = NS.pv, I = NS.ipc;
  const DEFAULT = { pipe: I.PRESETS[0].state, mq: I.PRESETS[3].state, signal: I.PRESETS[5].state };
  const end = (title, badge, lines) => el('div', { class: 'ip-end' }, el('h4', null, title), badge, lines);
  K.reg('ipc', {
    key: 'ipc', title: 'Inter-process communication', statsTitle: 'How the three differ', visualTitle: 'The channel', label: 'Call',
    chips: { key: 'kind', label: 'Mechanism', options: [['pipe', 'Pipe'], ['mq', 'Message queue'], ['signal', 'Signals']], onPick: (st, v) => { Object.assign(st, DEFAULT[v], { kind: v }); } },
    intro: 'Processes are isolated, so they need the kernel to talk. A pipe is a byte stream with a small buffer. A message queue passes whole messages in priority order. A signal is a tiny asynchronous nudge. Write a script and see who blocks, who wakes, and what is kept or lost.',
    defaults: DEFAULT.pipe,
    presets: I.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'capacity', label: 'Capacity (pipe: bytes, queue: messages; ignored for signals)', type: 'number', min: 1, max: 32 },
      { key: 'script', label: 'Calls', type: 'area', rows: 9, hint: 'Pipe: write text, read n, closew, closer. Queue: send priority text, recv. Signals: kill SIG, handle SIG, ignore SIG, default SIG, block SIG, unblock SIG (SIGINT, SIGTERM, SIGKILL, SIGSTOP, SIGCONT, SIGUSR1, SIGUSR2, SIGHUP, SIGCHLD, SIGALRM).' }],
    about: [['Pipe', 'Bytes flow in order through a fixed buffer. A full pipe blocks the writer, an empty one blocks the reader, a closed write end gives the reader end-of-file, a closed read end gives the writer SIGPIPE.'], ['Message queue', 'Each message is one unit with a priority. Receiving always returns the highest priority first. Boundaries are kept, unlike a pipe.'], ['Signal', 'An asynchronous notification. A process can handle, ignore or block most signals, but never SIGKILL or SIGSTOP. Standard signals do not queue: ten pending copies are delivered once.'], ['Memory hook', 'Pipe = stream, queue = letters, signal = tap on the shoulder.']],
    compute: (s) => I.run({ kind: s.kind, capacity: s.capacity, script: s.script }),
    draw: (f, i, sim) => {
      const S = f.state; let vis;
      if (sim.kind === 'pipe') {
        const slots = Array.from({ length: S.cap }, (_, k) => el('div', { class: 'ip-slot' + (k < S.buf.length ? ' full' : '') }, k < S.buf.length ? S.buf[k] : ''));
        vis = [el('div', { class: 'ip-ends' }, end('Writer', S.closedW ? PV.badge('', 'write end closed') : S.wBlocked ? PV.badge('warn', 'BLOCKED (pipe full)') : PV.badge('ok', 'ready'), S.pending ? el('small', null, 'still holding: "' + S.pending + '"') : null),
          end('Reader', S.closedR ? PV.badge('', 'read end closed') : S.rBlocked ? PV.badge('warn', 'BLOCKED (wants ' + S.rWant + ')') : PV.badge('ok', 'ready'), el('div', { class: 'ip-got' }, S.got.length ? 'received: ' + S.got.map((g) => '"' + g + '"').join(' ') : 'received: nothing yet'))),
          el('div', { class: 'ip-pipe', role: 'img', 'aria-label': 'Pipe buffer, ' + S.buf.length + ' of ' + S.cap + ' bytes used' }, slots), el('p', { class: 'hint' }, S.buf.length + ' of ' + S.cap + ' bytes used. The reader takes from the left, the writer adds on the right.')];
      } else if (sim.kind === 'mq') {
        const cells = Array.from({ length: S.cap }, (_, k) => { const m = S.queue[k]; return el('div', { class: 'ip-msg' + (m ? ' full' : '') }, m ? [el('small', null, 'priority ' + m.prio), m.text] : 'free'); });
        vis = [el('div', { class: 'ip-ends' }, end('Sender', S.pendingSend ? PV.badge('warn', 'BLOCKED (queue full)') : PV.badge('ok', 'ready'), S.pendingSend ? el('small', null, 'holding: "' + S.pendingSend.text + '" (priority ' + S.pendingSend.prio + ')') : null),
          end('Receiver', S.rBlocked ? PV.badge('warn', 'BLOCKED (queue empty)') : PV.badge('ok', 'ready'), el('div', { class: 'ip-got' }, S.got.length ? 'received: ' + S.got.map((g) => '"' + g + '"').join(' ') : 'received: nothing yet'))),
          el('div', { class: 'ip-msgs', role: 'img', 'aria-label': 'Message queue, ' + S.queue.length + ' of ' + S.cap + ' used' }, cells), el('p', { class: 'hint' }, 'Slots are listed in the order they will be received: highest priority first, then oldest.')];
      } else {
        const names = Object.keys(I.SIGS).sort((a, b) => I.SIGS[a] - I.SIGS[b]);
        const stat = { running: PV.badge('ok', 'running'), stopped: PV.badge('warn', 'STOPPED'), terminated: PV.badge('bad', 'TERMINATED') }[S.status];
        vis = [el('div', { class: 'ip-end' }, el('h4', null, 'The process'), stat), K.table(['Signal', 'No.', 'Default action', 'Now', 'Blocked', 'Pending', 'Handler ran'], names.map((n) => [n === 'KILL' || n === 'STOP' ? 'SIG' + n + ' (cannot be changed)' : 'SIG' + n, I.SIGS[n], I.DEFAULT[n], S.disp[n] === 'default' ? 'default' : S.disp[n], S.blocked.includes(n) ? 'blocked' : '', S.pending.includes(n) ? 'PENDING' : '', S.handled.filter((x) => x === n).length || '']))];
      }
      return { visual: vis, why: [el('p', { class: f.ok ? '' : 'mv-bad' }, f.call ? [el('b', null, f.call + '  '), f.note] : f.note)] };
    },
    stats: (f, sim) => [K.table(['', 'Pipe', 'Message queue', 'Signal'], [['Carries', 'a stream of bytes', 'whole messages', 'just a signal number'], ['Boundaries', 'none: 5+5 bytes can be read as 10', 'kept: one receive = one message', 'n/a'], ['Order', 'first in, first out', 'highest priority first', 'lowest number first when several pending'], ['Blocking', 'writer if full, reader if empty', 'sender if full, receiver if empty', 'never blocks the sender'], ['Queued?', 'yes, up to the buffer size', 'yes, up to the message limit', 'NO: repeats merge into one pending']]),
      el('p', { class: 'hint' }, 'Honest limits: exactly one writer and one reader, one sender and one receiver, one target process. Real pipes guarantee atomic writes only up to PIPE_BUF (4096 bytes on Linux), and real-time signals do queue; this lab models the classic ones.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
