/* Tier 2C: fork / exec / wait / exit, zombies and orphans. Pure logic, no DOM.
   You write a script of system calls, one per line, each made BY a numbered process:  "2: fork"  "3: exit 0"  "2: wait".
   The engine keeps the process table and returns one frame (a snapshot of the tree) after every call.

   Process states used:  running (alive), blocked (sleeping in wait), zombie (exited, exit code not yet collected by its
   parent), gone (reaped: removed from the table).
   Rules: fork copies the caller (new pid, same program); exec replaces the caller's program (same pid);
   exit turns the caller into a zombie and re-parents its children to init (pid 1); wait collects one zombie child, or
   sleeps until a child exits, or fails (ECHILD) if there are no children. init (pid 1) normally reaps adopted zombies
   at once; the "init is buggy" option turns that off so you can watch zombies pile up. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const MAX_CALLS = 60, MAX_PROCS = 30;

  function parse(text) {
    const errors = [], calls = [];
    String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).forEach((line, i) => {
      const m = /^(\d+)\s*:\s*(fork|exec|exit|wait)(?:\s+(\S+))?$/i.exec(line);
      if (!m) { errors.push('Line ' + (i + 1) + ': use "pid: fork", "pid: exec name", "pid: exit [code]" or "pid: wait".'); return; }
      const op = m[1 + 1].toLowerCase(), arg = m[3];
      if (op === 'exec' && !arg) { errors.push('Line ' + (i + 1) + ': exec needs a program name, e.g. "3: exec ls".'); return; }
      if (op === 'exit' && arg !== undefined && !/^\d+$/.test(arg)) { errors.push('Line ' + (i + 1) + ': exit code must be a number.'); return; }
      if ((op === 'fork' || op === 'wait') && arg !== undefined) { errors.push('Line ' + (i + 1) + ': ' + op + ' takes no argument.'); return; }
      calls.push({ pid: +m[1], op, arg: op === 'exit' ? +(arg || 0) : arg, line: line });
    });
    if (!calls.length) errors.push('Enter at least one call.');
    if (calls.length > MAX_CALLS) errors.push('At most ' + MAX_CALLS + ' calls.');
    return { calls, errors };
  }

  function run(cfg) {
    const parsed = parse(cfg.script); if (parsed.errors.length) return { ok: false, errors: parsed.errors };
    const initReaps = cfg.initReaps !== false && cfg.initReaps !== 'no';
    const procs = [{ pid: 1, ppid: 0, name: 'init', state: 'running', code: null, waitingFor: false }, { pid: 2, ppid: 1, name: 'shell', state: 'running', code: null, waitingFor: false }];
    let next = 3; const frames = [];
    const live = () => procs.filter((p) => p.state !== 'gone');
    const snap = () => live().map((p) => ({ pid: p.pid, ppid: p.ppid, name: p.name, state: p.state, code: p.code }));
    const kids = (pid) => live().filter((p) => p.ppid === pid);
    frames.push({ i: 0, call: null, ok: true, note: 'Start: init (pid 1) is the ancestor of everything; the shell (pid 2) is its child.', procs: snap(), events: [] });

    const reap = (parent, zombie, events) => { zombie.state = 'gone'; events.push('pid ' + parent.pid + ' reaped zombie ' + zombie.pid + ' (exit code ' + zombie.code + '): its table entry is freed'); };
    const initCleanup = (events) => { if (!initReaps) return; kids(1).filter((p) => p.state === 'zombie').forEach((z) => reap(procs[0], z, events)); };

    parsed.calls.forEach((c, idx) => {
      const events = [], p = procs.find((x) => x.pid === c.pid && x.state !== 'gone');
      const fail = (why) => frames.push({ i: idx + 1, call: c.line, ok: false, note: 'Ignored: ' + why, procs: snap(), events });
      if (!p) return fail('pid ' + c.pid + ' does not exist (it was never created, or it was already reaped).');
      if (p.state === 'zombie') return fail('pid ' + c.pid + ' is a zombie: it has exited and can no longer run.');
      if (p.state === 'blocked') return fail('pid ' + c.pid + ' is asleep inside wait() and cannot make another call until a child exits.');
      let note = '';
      if (c.op === 'fork') {
        if (live().length >= MAX_PROCS) return fail('process table full (' + MAX_PROCS + ').');
        const child = { pid: next++, ppid: p.pid, name: p.name, state: 'running', code: null };
        procs.push(child); note = 'pid ' + p.pid + ' calls fork(): child pid ' + child.pid + ' is a copy running "' + p.name + '". fork returns ' + child.pid + ' in the parent and 0 in the child.';
      } else if (c.op === 'exec') {
        const old = p.name; p.name = c.arg; note = 'pid ' + p.pid + ' calls exec("' + c.arg + '"): the program "' + old + '" is replaced by "' + c.arg + '". Same pid, same parent, new code.';
      } else if (c.op === 'exit') {
        const children = kids(p.pid); p.code = c.arg;
        children.forEach((k) => { k.ppid = 1; });
        const parent = procs.find((x) => x.pid === p.ppid && x.state !== 'gone');
        if (p.pid === 1) { p.state = 'zombie'; note = 'init exits (a real kernel would panic). Everything is now orphaned.'; }
        else if (parent && parent.state === 'blocked') { p.state = 'zombie'; parent.state = 'running'; parent.waitingFor = false; events.push('pid ' + parent.pid + ' wakes up: its wait() returns ' + p.pid + ' with code ' + p.code); reap(parent, p, events); note = 'pid ' + p.pid + ' calls exit(' + c.arg + '). Its parent was sleeping in wait(), so it collects the status immediately.'; }
        else { p.state = 'zombie'; note = 'pid ' + p.pid + ' calls exit(' + c.arg + '): it becomes a ZOMBIE (dead, but its exit code waits in the process table until pid ' + p.ppid + ' calls wait()).'; }
        if (children.length) { note += ' Its ' + (children.length === 1 ? 'child ' : 'children ') + children.map((k) => k.pid).join(', ') + ' became ORPHAN' + (children.length > 1 ? 'S' : '') + ' and ' + (children.length > 1 ? 'were' : 'was') + ' adopted by init (pid 1).'; }
        initCleanup(events);
        if (events.some((e) => /^pid 1 reaped/.test(e))) note += ' init reaps adopted zombies straight away.';
      } else if (c.op === 'wait') {
        const children = kids(p.pid), z = children.filter((k) => k.state === 'zombie').sort((a, b) => a.pid - b.pid)[0];
        if (z) { reap(p, z, events); note = 'pid ' + p.pid + ' calls wait(): zombie child ' + z.pid + ' is collected, wait returns ' + z.pid + '.'; }
        else if (children.length) { p.state = 'blocked'; p.waitingFor = true; note = 'pid ' + p.pid + ' calls wait() but no child has exited yet: it BLOCKS until one does.'; }
        else { note = 'pid ' + p.pid + ' calls wait() with no children: it returns -1 immediately (ECHILD). Nothing to wait for.'; }
      }
      frames.push({ i: idx + 1, call: c.line, ok: true, note, procs: snap(), events });
    });
    const last = frames[frames.length - 1].procs;
    return { ok: true, cfg: { initReaps }, frames, final: { zombies: last.filter((x) => x.state === 'zombie').map((x) => x.pid), blocked: last.filter((x) => x.state === 'blocked').map((x) => x.pid), alive: last.filter((x) => x.state === 'running').map((x) => x.pid) } };
  }

  const PRESETS = [
    { id: 'basic', name: 'fork, exec, wait (a shell runs ls)', note: 'The classic pattern: fork a child, exec a new program in it, and wait for it to finish.', state: { initReaps: 'yes', script: '2: fork\n3: exec ls\n2: wait\n3: exit 0' } },
    { id: 'zombie', name: 'Zombie: the parent never waits', note: 'The child exits but nobody calls wait(), so its entry stays in the table as a zombie. A zombie uses no CPU or memory but still holds a pid.', state: { initReaps: 'yes', script: '2: fork\n3: exit 7\n2: fork\n4: exit 0' } },
    { id: 'orphan', name: 'Orphan: the parent exits first', note: 'The shell exits while its child is still running. The child is adopted by init, which reaps it when it finishes.', state: { initReaps: 'yes', script: '2: fork\n2: exit 0\n3: exec sleep\n3: exit 0' } },
    { id: 'buggy', name: 'Orphans under a buggy init', note: 'If init never calls wait(), adopted children that exit stay zombies forever. Compare with the "yes" setting.', state: { initReaps: 'no', script: '2: fork\n2: exit 0\n3: exit 0' } },
    { id: 'tree', name: 'A small process tree', note: 'Each fork adds a node; fork a few times and exit in a different order to see re-parenting.', state: { initReaps: 'yes', script: '2: fork\n2: fork\n3: fork\n3: exit 1\n4: exec vim\n2: wait\n2: wait' } }
  ];
  NS.forkwait = { MAX_CALLS, parse, run, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.forkwait;
})(typeof window !== 'undefined' ? window : globalThis);
