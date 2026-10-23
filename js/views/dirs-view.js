/* Directories, links and permissions view: the tree with inode numbers and link counts, plus the exact permission checks. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {}), { el } = NS.util, K = NS.kit, P = NS.dirs.PRESETS[0];
  K.reg('dirs', {
    key: 'dirs', title: 'Directories, links & permissions', visualTitle: 'The file system', label: 'Command', statsTitle: 'Who am I, and what happened',
    intro: 'Run a script of file-system commands as different users. See the directory tree, which names share an inode (hard links), which names are just text (symbolic links), and the exact permission check behind every yes or no.',
    defaults: { text: P.text },
    presets: NS.dirs.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note, state: { text: p.text } })),
    fields: [{ key: 'text', label: 'Commands, one per line', type: 'area', rows: 14, hint: 'su USER GROUP[,GROUP] · mkdir|touch /path [mode] · ln [-s] TARGET /path · rm|rmdir /path · chmod 644 /path · chown USER GROUP /path · read|write|exec /path. Paths are absolute. You start as root.' }],
    about: [['Permission classes', 'Three classes are checked in order: owner, then group, then other. Only the first matching class is used, so an owner with fewer bits than the group is still refused.'], ['Directories', 'r lists names, w creates or removes names, x lets you pass through (search). To reach /a/b/f you need x on / and /a and /a/b.'], ['Hard link', 'Another name for the same inode. The inode counts its names and is freed when the count reaches 0. Not allowed for directories.'], ['Symbolic link', 'A tiny file holding a path. It can dangle or loop, and it works across file systems.'], ['Memory hook', 'rwx = 4 2 1. Owner, Group, Other: "OGO", and the first that fits is the only one that counts.']],
    compute: (s) => NS.dirs.run(s.text),
    draw: (f) => ({ visual: [el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl cd-tbl fv-tree' }, el('thead', null, el('tr', null, ['Name', 'Inode', 'Mode', 'Owner:group', 'Links', 'Points to'].map((h) => el('th', null, h)))),
        el('tbody', null, f.tree.map((n) => el('tr', null, el('td', null, '   '.repeat(n.depth) + (n.depth ? '└ ' : '') + n.name + (n.type === 'dir' && n.depth ? '/' : '')), el('td', null, String(n.ino)), el('td', null, n.mode), el('td', null, n.owner + ':' + n.group), el('td', null, String(n.links)), el('td', null, n.target || ''))))))],
      why: [f.cmd ? el('p', null, el('b', null, '$ ' + f.cmd)) : null, el('p', { class: f.ok ? 'mv-ok' : 'mv-bad' }, f.text), f.steps && f.steps.length ? el('ul', { class: 'fv-steps' }, f.steps.map((s) => el('li', null, s))) : null] }),
    stats: (f, sim) => { const done = sim.frames.slice(1, f.i + 1); return [K.metrics([['Acting as', f.user], ['Inodes in use', f.inodes], ['Commands run', done.length], ['Allowed', done.filter((x) => x.ok).length], ['Refused', done.filter((x) => !x.ok).length]]),
      el('p', { class: 'hint' }, 'Honest limits: one primary group plus extra groups per user, no ACLs, setuid, sticky bit or umask; the owner of a new file is whoever ran the command; names are checked one path component at a time.')]; }
  });
})(typeof window !== 'undefined' ? window : globalThis);
