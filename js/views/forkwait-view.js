/* fork / exec / wait view: the process tree after every call, with zombie, orphan and blocked states marked,
   plus the process table. Everything comes from NS.forkwait.run. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, PV = NS.pv, P = NS.forkwait.PRESETS[0];
  const STATE = { running: ['ok', 'running'], blocked: ['warn', 'asleep in wait()'], zombie: ['bad', 'zombie'] };
  K.reg('forkwait', {
    key: 'forkwait', title: 'fork, exec, wait and zombies', statsTitle: 'Process table', visualTitle: 'Process tree', label: 'Call',
    intro: 'A new process is always made by an existing one: fork() copies the caller, exec() swaps in a new program, wait() collects the exit status of a child. Write a script of calls and see the tree, zombies (dead but not collected) and orphans (parent died first).',
    defaults: P.state,
    presets: NS.forkwait.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: p.state })),
    fields: [{ key: 'script', label: 'System calls', type: 'area', rows: 9, hint: 'One per line: "pid: fork", "pid: exec name", "pid: exit [code]", "pid: wait". New children get the next free pid (3, 4, 5, ...). pid 1 is init and pid 2 is the shell.' },
      { key: 'initReaps', label: 'Does init reap the children it adopts?', type: 'select', options: [['yes', 'Yes (a healthy init)'], ['no', 'No (a buggy init: zombies pile up)']] }],
    about: [['fork()', 'Creates a child that is a copy of the caller. It returns the child\'s pid in the parent and 0 in the child.'], ['exec()', 'Replaces the running program with another. The pid and parent stay the same.'], ['exit()', 'The process stops running but stays in the table as a ZOMBIE so the parent can read its exit code.'], ['wait()', 'Collects one zombie child and frees its table entry. With no zombie yet it sleeps; with no children it fails.'], ['Orphan', 'A child whose parent exited. The kernel hands it to init (pid 1), which reaps it when it ends.'], ['Memory hook', 'Fork copies, exec replaces, exit leaves a corpse, wait buries it.']],
    compute: (s) => NS.forkwait.run({ script: s.script, initReaps: s.initReaps }),
    draw: (f) => {
      const caller = f.call ? parseInt(f.call, 10) : null, by = {};
      f.procs.forEach((p) => { (by[p.ppid] = by[p.ppid] || []).push(p); });
      const node = (p) => { const [kind, text] = STATE[p.state] || ['', p.state]; const kids = (by[p.pid] || []).sort((a, b) => a.pid - b.pid);
        return el('li', null, el('span', { class: 'pt-node ' + p.state + (p.pid === caller ? ' caller' : '') }, 'pid ' + p.pid, el('span', null, p.name), PV.badge(kind, text + (p.state === 'zombie' ? ' (code ' + p.code + ')' : '')), el('small', null, 'parent ' + (p.ppid || '-'))), kids.length ? el('ul', null, kids.map(node)) : null); };
      const roots = f.procs.filter((p) => !f.procs.some((q) => q.pid === p.ppid));
      return { visual: [el('ul', { class: 'pt-tree' }, roots.map(node)), PV.legend([['', 'outlined = the process making this call']])],
        why: [el('p', { class: f.ok ? '' : 'mv-bad' }, f.call ? [el('b', null, f.call + '  '), f.note] : f.note), f.events.length ? el('ul', { class: 'fv-steps' }, f.events.map((e) => el('li', null, e))) : null] };
    },
    stats: (f, sim) => [K.table(['pid', 'Parent', 'Program', 'State', 'Exit code'], f.procs.map((p) => [p.pid, p.ppid || '-', p.name, p.state, p.code === null ? '' : p.code])),
      el('p', { class: 'hint' }, 'A zombie holds only its table entry (pid and exit code): no memory, no CPU. Too many of them can still exhaust the pid table. Honest limits: no signals, no threads, copy-on-write is not shown (see the Copy-on-write lab), and the script chooses who runs, since there is no scheduler here.')]
  });
})(typeof window !== 'undefined' ? window : globalThis);
