/* Tier 2C: inter-process communication: pipes, POSIX-style message queues and signals. Pure logic, no DOM.
   run({ kind: 'pipe'|'mq'|'signal', ... , script }) -> { ok, errors, frames }.
   Each line of the script is one call made by one of two processes (or by the outside world for signals); every call
   returns one frame holding the whole state afterwards and a note that says why.

   Pipe   a byte stream with a fixed capacity: no message boundaries; writer blocks when full, reader blocks when empty.
   Queue  a bounded list of whole messages with priorities: boundaries are kept; highest priority is received first.
   Signal one process with handlers, a blocked mask and a pending set; standard signals do NOT queue. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_CALLS = 60;
  const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

  // ---------------------------------------------------------------- pipe
  function pipe(cfg) {
    const cap = +cfg.capacity, errors = [];
    if (!(Number.isInteger(cap) && cap >= 1 && cap <= 32)) errors.push('Pipe capacity must be a whole number of bytes from 1 to 32.');
    const L = lines(cfg.script), calls = [];
    L.forEach((line, i) => {
      let m;
      if ((m = /^write\s+(.+)$/i.exec(line))) { if (m[1].length > 64) errors.push('Line ' + (i + 1) + ': write at most 64 bytes at a time.'); else calls.push({ op: 'write', text: m[1], line }); }
      else if ((m = /^read\s+(\d+)$/i.exec(line))) { if (+m[1] < 1 || +m[1] > 64) errors.push('Line ' + (i + 1) + ': read 1 to 64 bytes.'); else calls.push({ op: 'read', n: +m[1], line }); }
      else if (/^close\s*w(rite)?$/i.test(line)) calls.push({ op: 'closew', line });
      else if (/^close\s*r(ead)?$/i.test(line)) calls.push({ op: 'closer', line });
      else errors.push('Line ' + (i + 1) + ': use "write text", "read n", "closew" or "closer".');
    });
    if (!calls.length) errors.push('Enter at least one call.'); if (calls.length > MAX_CALLS) errors.push('At most ' + MAX_CALLS + ' calls.');
    if (errors.length) return { ok: false, errors };

    const S = { buf: '', pending: '', wBlocked: false, rBlocked: false, rWant: 0, closedW: false, closedR: false, got: [] };
    const snap = () => ({ buf: S.buf, cap, pending: S.pending, wBlocked: S.wBlocked, rBlocked: S.rBlocked, rWant: S.rWant, closedW: S.closedW, closedR: S.closedR, got: S.got.slice() });
    const frames = [{ i: 0, call: null, ok: true, note: 'An empty pipe holding up to ' + cap + ' bytes. Writer and reader are two processes.', state: snap() }];
    const flush = (parts) => { if (!S.pending) return; const fit = Math.min(S.pending.length, cap - S.buf.length); if (fit > 0) { S.buf += S.pending.slice(0, fit); S.pending = S.pending.slice(fit); parts.push('the blocked writer gets ' + fit + ' more byte' + (fit > 1 ? 's' : '') + ' in'); } if (!S.pending) { S.wBlocked = false; parts.push('the writer wakes up: its write is complete'); } };
    const take = (n, parts) => { const out = S.buf.slice(0, n); S.buf = S.buf.slice(n); S.got.push(out); parts.push('the reader receives "' + out + '" (' + out.length + ' byte' + (out.length > 1 ? 's' : '') + ')'); flush(parts); return out; };

    calls.forEach((c, k) => {
      const parts = []; let ok = true;
      const bad = (m) => { ok = false; parts.push(m); };
      if (c.op === 'write') {
        if (S.closedR) bad('write to a pipe whose read end is closed: the writer gets SIGPIPE (EPIPE). The data is lost.');
        else if (S.closedW) bad('the write end is already closed.');
        else if (S.wBlocked) bad('the writer is asleep (pipe full) and cannot call write again.');
        else {
          const fit = Math.min(c.text.length, cap - S.buf.length); S.buf += c.text.slice(0, fit); S.pending = c.text.slice(fit);
          parts.push('writer writes "' + c.text + '": ' + fit + ' of ' + c.text.length + ' byte' + (c.text.length > 1 ? 's' : '') + ' fit');
          if (S.pending) { S.wBlocked = true; parts.push('the pipe is FULL, so the writer BLOCKS holding "' + S.pending + '"'); }
          if (S.rBlocked && S.buf) { S.rBlocked = false; take(S.rWant, parts); }
        }
      } else if (c.op === 'read') {
        if (S.closedR) bad('the read end is closed.');
        else if (S.rBlocked) bad('the reader is already asleep waiting for data.');
        else if (!S.buf) {
          if (S.closedW && !S.pending) parts.push('reader calls read(' + c.n + ') on an empty pipe whose write end is closed: read returns 0 = END OF FILE');
          else { S.rBlocked = true; S.rWant = c.n; parts.push('reader calls read(' + c.n + ') but the pipe is EMPTY, so the reader BLOCKS'); }
        } else { parts.push('reader calls read(' + c.n + ') and the pipe holds ' + S.buf.length + ' byte' + (S.buf.length > 1 ? 's' : '') + ': read returns up to ' + c.n); take(c.n, parts); }
      } else if (c.op === 'closew') {
        if (S.closedW) bad('already closed.'); else if (S.wBlocked) bad('the writer is asleep and cannot close the pipe yet.');
        else { S.closedW = true; parts.push('writer closes its end'); if (S.rBlocked) { S.rBlocked = false; if (S.buf) take(S.rWant, parts); else parts.push('the sleeping reader wakes and read returns 0 = END OF FILE'); } }
      } else if (c.op === 'closer') {
        if (S.closedR) bad('already closed.');
        else { S.closedR = true; parts.push('reader closes its end'); if (S.wBlocked) { S.wBlocked = false; S.pending = ''; parts.push('the blocked writer is woken with SIGPIPE: its pending data is dropped'); } }
      }
      frames.push({ i: k + 1, call: c.line, ok, note: (ok ? '' : 'Ignored: ') + parts.join('; ').replace(/\.?$/, '.'), state: snap() });
    });
    return { ok: true, kind: 'pipe', frames };
  }

  // ---------------------------------------------------------------- message queue
  function mq(cfg) {
    const cap = +cfg.capacity, errors = [];
    if (!(Number.isInteger(cap) && cap >= 1 && cap <= 8)) errors.push('Queue capacity must be a whole number of messages from 1 to 8.');
    const calls = [];
    lines(cfg.script).forEach((line, i) => {
      let m;
      if ((m = /^send\s+(\d+)\s+(.+)$/i.exec(line))) { if (+m[1] > 9) errors.push('Line ' + (i + 1) + ': priority is 0 to 9 (9 is highest).'); else calls.push({ op: 'send', prio: +m[1], text: m[2], line }); }
      else if (/^recv(eive)?$/i.test(line)) calls.push({ op: 'recv', line });
      else errors.push('Line ' + (i + 1) + ': use "send priority text" or "recv".');
    });
    if (!calls.length) errors.push('Enter at least one call.'); if (calls.length > MAX_CALLS) errors.push('At most ' + MAX_CALLS + ' calls.');
    if (errors.length) return { ok: false, errors };

    let seq = 0; const Q = []; let pendingSend = null, rBlocked = false; const got = [];
    const order = () => Q.slice().sort((a, b) => b.prio - a.prio || a.seq - b.seq);
    const snap = () => ({ queue: order().map((m) => ({ prio: m.prio, text: m.text })), cap, pendingSend: pendingSend && { prio: pendingSend.prio, text: pendingSend.text }, rBlocked, got: got.slice() });
    const frames = [{ i: 0, call: null, ok: true, note: 'An empty queue that holds up to ' + cap + ' whole messages. mq_receive always returns the highest priority; equal priorities keep arrival order.', state: snap() }];
    const recvOne = (parts) => { const m = order()[0]; Q.splice(Q.indexOf(m), 1); got.push(m.text); parts.push('receiver gets "' + m.text + '" (priority ' + m.prio + ')'); if (pendingSend) { Q.push({ ...pendingSend, seq: seq++ }); parts.push('the blocked sender\'s message "' + pendingSend.text + '" now fits and the sender wakes'); pendingSend = null; } };
    calls.forEach((c, k) => {
      const parts = []; let ok = true;
      if (c.op === 'send') {
        if (pendingSend) { ok = false; parts.push('the sender is asleep (queue full) and cannot send again'); }
        else {
          const msg = { prio: c.prio, text: c.text, seq: seq++ };
          if (Q.length >= cap) { pendingSend = msg; parts.push('sender calls mq_send("' + c.text + '", priority ' + c.prio + ') but the queue is FULL (' + cap + ' messages): the sender BLOCKS'); }
          else { Q.push(msg); parts.push('sender queues "' + c.text + '" with priority ' + c.prio); if (rBlocked) { rBlocked = false; parts.push('the sleeping receiver wakes'); recvOne(parts); } }
        }
      } else {
        if (rBlocked) { ok = false; parts.push('the receiver is already asleep waiting for a message'); }
        else if (!Q.length) { rBlocked = true; parts.push('receiver calls mq_receive but the queue is EMPTY: the receiver BLOCKS'); }
        else recvOne(parts);
      }
      frames.push({ i: k + 1, call: c.line, ok, note: (ok ? '' : 'Ignored: ') + parts.join('; ').replace(/\.?$/, '.'), state: snap() });
    });
    return { ok: true, kind: 'mq', frames };
  }

  // ---------------------------------------------------------------- signals
  const SIGS = { HUP: 1, INT: 2, KILL: 9, USR1: 10, USR2: 12, ALRM: 14, TERM: 15, CHLD: 17, CONT: 18, STOP: 19 };
  const DEFAULT = { HUP: 'terminate', INT: 'terminate', KILL: 'terminate', USR1: 'terminate', USR2: 'terminate', ALRM: 'terminate', TERM: 'terminate', CHLD: 'ignore', CONT: 'continue', STOP: 'stop' };
  const sigName = (s) => { const n = String(s || '').toUpperCase().replace(/^SIG/, ''); return SIGS[n] ? n : null; };

  function signal(cfg) {
    const errors = [], calls = [];
    lines(cfg.script).forEach((line, i) => {
      const m = /^(kill|handle|ignore|default|block|unblock)\s+(\S+)$/i.exec(line);
      if (!m) { errors.push('Line ' + (i + 1) + ': use "kill SIG", "handle SIG", "ignore SIG", "default SIG", "block SIG" or "unblock SIG".'); return; }
      const sg = sigName(m[2]); if (!sg) { errors.push('Line ' + (i + 1) + ': unknown signal "' + m[2] + '". Known: ' + Object.keys(SIGS).map((x) => 'SIG' + x).join(', ') + '.'); return; }
      calls.push({ op: m[1].toLowerCase(), sig: sg, line });
    });
    if (!calls.length) errors.push('Enter at least one call.'); if (calls.length > MAX_CALLS) errors.push('At most ' + MAX_CALLS + ' calls.');
    if (errors.length) return { ok: false, errors };

    const S = { status: 'running', disp: {}, blocked: new Set(), pending: new Set(), handled: [] };
    Object.keys(SIGS).forEach((s) => { S.disp[s] = 'default'; });
    const snap = () => ({ status: S.status, disp: { ...S.disp }, blocked: [...S.blocked].sort((a, b) => SIGS[a] - SIGS[b]), pending: [...S.pending].sort((a, b) => SIGS[a] - SIGS[b]), handled: S.handled.slice() });
    const frames = [{ i: 0, call: null, ok: true, note: 'One process, running, every signal at its default action.', state: snap() }];
    const label = (s) => 'SIG' + s + ' (' + SIGS[s] + ')';
    function deliver(s, parts) {
      if (S.disp[s] === 'ignore') { parts.push(label(s) + ' is delivered and IGNORED'); return; }
      if (S.disp[s] === 'handle') { S.handled.push(s); parts.push(label(s) + ' is delivered: the process\'s HANDLER runs, then it carries on'); return; }
      const a = DEFAULT[s];
      if (a === 'terminate') { S.status = 'terminated'; parts.push(label(s) + ' default action: TERMINATE the process'); }
      else if (a === 'stop') { S.status = 'stopped'; parts.push(label(s) + ' default action: STOP (freeze) the process'); }
      else if (a === 'ignore') parts.push(label(s) + ' default action: ignore');
      else parts.push(label(s) + ' default action: continue');
    }
    function drain(parts) { [...S.pending].filter((s) => !S.blocked.has(s)).sort((a, b) => SIGS[a] - SIGS[b]).forEach((s) => { if (S.status !== 'running') return; S.pending.delete(s); parts.push('pending ' + label(s) + ' is now deliverable'); deliver(s, parts); }); }

    calls.forEach((c, k) => {
      const parts = []; let ok = true; const s = c.sig;
      if (S.status === 'terminated') { ok = false; parts.push('the process is already terminated'); }
      else if (c.op === 'kill') {
        if (s === 'KILL') { S.status = 'terminated'; S.pending.clear(); parts.push('SIGKILL (9) cannot be caught, blocked or ignored: the process is terminated'); }
        else if (s === 'STOP') { S.status = 'stopped'; parts.push('SIGSTOP (19) cannot be caught, blocked or ignored: the process is frozen'); }
        else {
          if (s === 'CONT' && S.status === 'stopped') { S.status = 'running'; parts.push('SIGCONT resumes the stopped process (this happens even if SIGCONT is blocked)'); }
          if (S.blocked.has(s)) { parts.push(S.pending.has(s) ? label(s) + ' is blocked and already pending: this copy is MERGED with it (standard signals do not queue)' : label(s) + ' is blocked, so it becomes PENDING'); S.pending.add(s); }
          else if (S.status === 'stopped') { parts.push('the process is stopped, so ' + label(s) + ' waits as PENDING until SIGCONT'); S.pending.add(s); }
          else deliver(s, parts);
          if (S.status === 'running' && s === 'CONT') drain(parts);
        }
      } else if (c.op === 'handle' || c.op === 'ignore' || c.op === 'default') {
        if (s === 'KILL' || s === 'STOP') { ok = false; parts.push('SIG' + s + ' can never be caught, blocked or ignored'); }
        else { S.disp[s] = c.op === 'handle' ? 'handle' : c.op === 'ignore' ? 'ignore' : 'default'; parts.push('SIG' + s + ' action set to ' + (c.op === 'default' ? 'default (' + DEFAULT[s] + ')' : c.op === 'handle' ? 'run a handler' : 'ignore')); if (c.op === 'ignore') S.pending.delete(s); }
      } else if (c.op === 'block') {
        if (s === 'KILL' || s === 'STOP') { ok = false; parts.push('SIG' + s + ' can never be caught, blocked or ignored'); } else { S.blocked.add(s); parts.push('SIG' + s + ' is now blocked: it will wait as pending instead of being delivered'); }
      } else if (c.op === 'unblock') {
        S.blocked.delete(s); parts.push('SIG' + s + ' is unblocked');
        if (S.status === 'running') drain(parts); else if (S.pending.has(s)) parts.push('the process is stopped, so ' + label(s) + ' still waits');
      }
      if (c.op === 'kill' && S.status === 'running' && s === 'CONT') { /* drain already ran */ }
      frames.push({ i: k + 1, call: c.line, ok, note: (ok ? '' : 'Ignored: ') + parts.join('; ').replace(/\.?$/, '.'), state: snap() });
    });
    return { ok: true, kind: 'signal', frames, SIGS };
  }

  function run(cfg) { return cfg.kind === 'mq' ? mq(cfg) : cfg.kind === 'signal' ? signal(cfg) : pipe(cfg); }

  const PRESETS = [
    { id: 'pipe', name: 'Pipe: writer blocks when full', note: 'A 6-byte pipe. The second write does not fit, so the writer sleeps until the reader makes room.', state: { kind: 'pipe', capacity: 6, script: 'write hello\nwrite world\nread 4\nread 4\nread 4' } },
    { id: 'pipe-empty', name: 'Pipe: reader blocks when empty', note: 'The reader asks first and sleeps; the next write wakes it. Closing the write end gives end-of-file.', state: { kind: 'pipe', capacity: 8, script: 'read 5\nwrite hi\nwrite there\nread 10\nclosew\nread 3' } },
    { id: 'pipe-broken', name: 'Pipe: broken pipe (SIGPIPE)', note: 'Writing after the reader has gone away is an error and raises SIGPIPE.', state: { kind: 'pipe', capacity: 8, script: 'write data\ncloser\nwrite more' } },
    { id: 'mq', name: 'Message queue: priorities', note: 'Messages are whole units, not a stream, and the highest priority comes out first regardless of arrival order.', state: { kind: 'mq', capacity: 3, script: 'send 1 backup\nsend 5 ALERT\nsend 1 log\nrecv\nrecv\nrecv' } },
    { id: 'mq-full', name: 'Message queue: full and empty', note: 'A queue of 2: the third send blocks the sender, and a receive makes room and wakes it.', state: { kind: 'mq', capacity: 2, script: 'send 1 a\nsend 1 b\nsend 1 c\nrecv\nrecv\nrecv\nrecv' } },
    { id: 'sig-handler', name: 'Signals: handler, ignore, default', note: 'SIGINT normally kills a process; with a handler it just runs the handler. SIGUSR1 is ignored; SIGTERM keeps its default.', state: { kind: 'signal', capacity: 4, script: 'handle INT\nkill INT\nignore USR1\nkill USR1\nkill TERM' } },
    { id: 'sig-merge', name: 'Signals do not queue', note: 'While SIGUSR1 is blocked, three sends collapse into ONE pending signal. Unblocking runs the handler once.', state: { kind: 'signal', capacity: 4, script: 'handle USR1\nblock USR1\nkill USR1\nkill USR1\nkill USR1\nunblock USR1' } },
    { id: 'sig-stop', name: 'Signals: STOP, CONT and KILL', note: 'SIGSTOP and SIGKILL cannot be caught. A stopped process holds other signals until SIGCONT.', state: { kind: 'signal', capacity: 4, script: 'handle INT\nhandle STOP\nkill STOP\nkill INT\nkill CONT\nkill KILL' } }
  ];
  NS.ipc = { MAX_CALLS, SIGS, DEFAULT, pipe, mq, signal, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.ipc;
})(typeof window !== 'undefined' ? window : globalThis);
