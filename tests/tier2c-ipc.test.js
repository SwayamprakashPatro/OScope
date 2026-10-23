// Tier 2C: pipes, message queues, signals. Expected values derived by hand.
const I = require('../js/engines/ipc.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const pipe = (capacity, script) => I.run({ kind: 'pipe', capacity, script });
const mq = (capacity, script) => I.run({ kind: 'mq', capacity, script });
const sig = (script) => I.run({ kind: 'signal', script });

// ---- pipe. Capacity 6: write "hello" (5 fit), write "world" (only 1 fits, writer blocks holding "orld").
let r = pipe(6, 'write hello\nwrite world\nread 4\nread 4\nread 4');
eq('after write hello: buffer hello', r.frames[1].state.buf, 'hello');
eq('second write fills to 6 bytes and blocks with 4 pending', [r.frames[2].state.buf, r.frames[2].state.pending, r.frames[2].state.wBlocked], ['hellow', 'orld', true]);
eq('read 4 frees room: buffer is "ow" + 4 pending bytes = "oworld"? no: 2 left + 4 flushed', [r.frames[3].state.buf, r.frames[3].state.wBlocked, r.frames[3].state.pending], ['oworld', false, '']);
eq('reader gets "hell" first', r.frames[3].state.got, ['hell']);
eq('stream order preserved overall', r.frames[5].state.got.join(''), 'helloworld');
eq('last read returns the 2 remaining bytes only', r.frames[5].state.got[2], 'ld');

// Reader blocks first, writer wakes it
r = pipe(8, 'read 5\nwrite hi\nwrite there\nread 10\nclosew\nread 3');
eq('read on empty pipe blocks', [r.frames[1].state.rBlocked, r.frames[1].state.rWant], [true, 5]);
eq('write wakes the reader, who gets just the 2 bytes available', [r.frames[2].state.rBlocked, r.frames[2].state.got, r.frames[2].state.buf], [false, ['hi'], '']);
eq('read(10) returns the 5 bytes present, not 10', r.frames[4].state.got[1], 'there');
eq('closed write end + empty pipe = EOF', /END OF FILE/.test(r.frames[6].note), true);

// Close write end wakes a sleeping reader with EOF
r = pipe(4, 'read 3\nclosew');
eq('closew wakes the blocked reader with EOF', [r.frames[2].state.rBlocked, /END OF FILE/.test(r.frames[2].note)], [false, true]);

// Broken pipe
r = pipe(8, 'write data\ncloser\nwrite more');
eq('write after reader closed is rejected with SIGPIPE', [r.frames[3].ok, /SIGPIPE/.test(r.frames[3].note), r.frames[3].state.buf], [false, true, 'data']);
r = pipe(3, 'write abcdef\ncloser');
eq('closing the read end wakes a blocked writer and drops its pending data', [r.frames[1].state.wBlocked, r.frames[2].state.wBlocked, r.frames[2].state.pending], [true, false, '']);
r = pipe(3, 'write abcdef\nwrite x');
eq('a blocked writer cannot write again', r.frames[2].ok, false);
r = pipe(3, 'write abcdef\nclosew');
eq('a blocked writer cannot close either', r.frames[2].ok, false);
eq('bad capacity', pipe(0, 'write a').ok, false); eq('bad line', pipe(4, 'push a').ok, false); eq('empty script', pipe(4, '').ok, false);

// ---- message queue
r = mq(3, 'send 1 backup\nsend 5 ALERT\nsend 1 log\nrecv\nrecv\nrecv');
eq('queue is shown highest priority first', r.frames[3].state.queue.map((m) => m.text), ['ALERT', 'backup', 'log']);
eq('receive order: priority, then arrival', r.frames[6].state.got, ['ALERT', 'backup', 'log']);
r = mq(2, 'send 1 a\nsend 1 b\nsend 1 c\nrecv\nrecv\nrecv\nrecv');
eq('third send blocks the sender', [r.frames[3].state.pendingSend, r.frames[3].state.queue.length], [{ prio: 1, text: 'c' }, 2]);
eq('recv makes room: c enters the queue behind b, sender wakes', [r.frames[4].state.pendingSend, r.frames[4].state.queue.map((m) => m.text)], [null, ['b', 'c']]);
eq('fourth recv on empty queue blocks the receiver', r.frames[7].state.rBlocked, true);
r = mq(2, 'recv\nsend 3 hi');
eq('send wakes a blocked receiver which takes the message directly', [r.frames[2].state.rBlocked, r.frames[2].state.got, r.frames[2].state.queue.length], [false, ['hi'], 0]);
r = mq(1, 'send 1 a\nsend 9 urgent\nrecv');
eq('a blocked sender\'s high-priority message still waits for space, then joins', [r.frames[2].state.pendingSend.text, r.frames[3].state.queue.map((m) => m.text)], ['urgent', ['urgent']]);
eq('message boundaries kept: one recv returns one whole message', mq(3, 'send 1 abc\nsend 1 de\nrecv').frames[3].state.got, ['abc']);
eq('priority above 9 rejected', mq(2, 'send 12 x').ok, false); eq('capacity 0 rejected', mq(0, 'recv').ok, false);

// ---- signals
r = sig('handle INT\nkill INT\nignore USR1\nkill USR1\nkill TERM');
eq('handled SIGINT keeps the process alive and records the handler run', [r.frames[2].state.status, r.frames[2].state.handled], ['running', ['INT']]);
eq('ignored signal does nothing', r.frames[4].state.status, 'running');
eq('default SIGTERM terminates', r.frames[5].state.status, 'terminated');
r = sig('kill INT');
eq('default SIGINT terminates', r.frames[1].state.status, 'terminated');
r = sig('handle USR1\nblock USR1\nkill USR1\nkill USR1\nkill USR1\nunblock USR1');
eq('three blocked sends = ONE pending', r.frames[5].state.pending, ['USR1']);
eq('unblock runs the handler exactly once', [r.frames[6].state.handled, r.frames[6].state.pending], [['USR1'], []]);
r = sig('block USR1\nblock USR2\nkill USR2\nkill USR1\nunblock USR1\nunblock USR2');
eq('unblocking USR1 delivers it (default action: terminate) while USR2 stays pending', [r.frames[5].state.status, r.frames[5].state.pending], ['terminated', ['USR2']]);
eq('the later unblock of USR2 is ignored: the process is already dead', r.frames[6].ok, false);
r = sig('handle STOP');  eq('cannot handle STOP', r.frames[1].ok, false);
r = sig('block KILL');   eq('cannot block KILL', r.frames[1].ok, false);
r = sig('ignore KILL');  eq('cannot ignore KILL', r.frames[1].ok, false);
r = sig('handle INT\nhandle STOP\nkill STOP\nkill INT\nkill CONT\nkill KILL');
eq('SIGSTOP freezes', r.frames[3].state.status, 'stopped');
eq('a signal sent to a stopped process waits as pending', r.frames[4].state.pending, ['INT']);
eq('SIGCONT resumes and the held SIGINT handler then runs', [r.frames[5].state.status, r.frames[5].state.pending, r.frames[5].state.handled], ['running', [], ['INT']]);
eq('SIGKILL always works', r.frames[6].state.status, 'terminated');
r = sig('kill TERM\nkill INT');
eq('calls on a terminated process are ignored', r.frames[2].ok, false);
r = sig('block CONT\nkill STOP\nkill CONT');
eq('SIGCONT resumes a stopped process even when blocked, and stays pending', [r.frames[3].state.status, r.frames[3].state.pending], ['running', ['CONT']]);
r = sig('block INT\nkill INT\nignore INT');
eq('switching to ignore discards a pending signal', r.frames[3].state.pending, []);
r = sig('kill CHLD'); eq('SIGCHLD default is ignore', r.frames[1].state.status, 'running');
r = sig('kill SIGTERM'); eq('SIG prefix accepted', r.frames[1].state.status, 'terminated');
eq('lower case accepted', sig('kill term').frames[1].state.status, 'terminated');
eq('unknown signal rejected', sig('kill FOO').ok, false);

// ---- random invariants
let seed = 9; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let bad = 0;
for (let k = 0; k < 300; k++) {
  // pipe without closer: everything received + buffered + pending is a prefix of everything written
  const cap = 1 + rnd(10), L = [], written = []; for (let i = 0, n = 3 + rnd(20); i < n; i++) { const o = rnd(5); if (o < 3) { const w = 'abcdefghij'.slice(0, 1 + rnd(9)); L.push('write ' + w); written.push(w); } else if (o < 4) L.push('read ' + (1 + rnd(8))); else L.push(rnd(2) ? 'read 2' : 'closew'); }
  const p = pipe(cap, L.join('\n')); if (!p.ok) { bad++; continue; }
  p.frames.forEach((f) => { const s = f.state; if (s.buf.length > cap) bad++; if (s.wBlocked !== (s.pending.length > 0)) bad++; if (s.rBlocked && s.buf.length) bad++; if (s.wBlocked && s.buf.length < cap) bad++; });
  // accepted writes: those frames where ok is true and call starts with write
  let acc = ''; p.frames.forEach((f) => { if (f.call && /^write/.test(f.call) && f.ok) acc += f.call.slice(6); });
  const last = p.frames[p.frames.length - 1].state; if (!(acc.startsWith(last.got.join('') + last.buf) && (last.got.join('') + last.buf + last.pending) === acc)) { bad++; console.log('stream broken', cap, L.join('|')); }
  // queue
  const M = [], sent = []; for (let i = 0, n = 3 + rnd(20); i < n; i++) M.push(rnd(3) ? 'send ' + rnd(10) + ' m' + i : 'recv');
  const q = mq(1 + rnd(5), M.join('\n')); if (!q.ok) { bad++; continue; }
  q.frames.forEach((f, i) => { const s = f.state; if (s.queue.length > q.frames[0].state.cap) bad++; if (s.rBlocked && s.queue.length) bad++; if (s.pendingSend && s.queue.length < s.cap) bad++;
    for (let j = 1; j < s.queue.length; j++) if (s.queue[j - 1].prio < s.queue[j].prio) bad++;
    if (i && s.got.length > q.frames[i - 1].state.got.length) { const prev = q.frames[i - 1].state; const cand = prev.queue.concat(f.call && /^send/.test(f.call) && prev.rBlocked ? [{ prio: +f.call.split(' ')[1], text: f.call.split(' ').slice(2).join(' ') }] : []); const best = Math.max(...cand.map((m) => m.prio)); const gotMsg = s.got[s.got.length - 1]; const m = cand.find((x) => x.text === gotMsg); if (!m || m.prio !== best) { bad++; console.log('wrong priority order', M.join('|')); } } });
  const accepted = q.frames.filter((f) => f.call && /^send/.test(f.call) && f.ok).length, lastQ = q.frames[q.frames.length - 1].state;
  if (accepted !== lastQ.got.length + lastQ.queue.length + (lastQ.pendingSend ? 1 : 0)) { bad++; console.log('message count broken', M.join('|')); }
  // signals
  const names = ['INT', 'TERM', 'USR1', 'USR2', 'HUP', 'CONT', 'STOP', 'KILL', 'CHLD', 'ALRM'], ops = ['kill', 'kill', 'kill', 'handle', 'ignore', 'default', 'block', 'unblock'], S = [];
  for (let i = 0, n = 3 + rnd(25); i < n; i++) S.push(ops[rnd(ops.length)] + ' ' + names[rnd(names.length)]);
  const g = sig(S.join('\n')); if (!g.ok) { bad++; continue; }
  let dead = false; g.frames.forEach((f) => { const s = f.state; if (dead && f.ok) bad++; if (s.status === 'terminated') dead = true; if (s.blocked.includes('KILL') || s.blocked.includes('STOP')) bad++; s.pending.forEach((x) => { if (!s.blocked.includes(x) && s.status !== 'stopped' && s.status !== 'terminated') { bad++; console.log('stuck pending', S.join('|')); } }); });
}
eq('300 random scripts per model keep every invariant (capacity, order, conservation, priority, signal masks)', bad, 0);
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
