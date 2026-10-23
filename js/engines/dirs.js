/* Tier 2B: directories, links and permissions. A tiny Unix-style file system driven by a command script.
   Shows the directory tree, inode numbers, link counts, and exactly which permission check allowed or refused an access. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const LIMITS = { maxCmds: 40, maxSymlinkDepth: 8 };

  const modeStr = (m, type) => (type === 'dir' ? 'd' : type === 'symlink' ? 'l' : '-') + [6, 3, 0].map((s) => ((m >> s) & 4 ? 'r' : '-') + ((m >> s) & 2 ? 'w' : '-') + ((m >> s) & 1 ? 'x' : '-')).join('');
  const parseMode = (s) => (/^[0-7]{3}$/.test(s) ? parseInt(s, 8) : null);
  const splitPath = (p) => p.split('/').filter(Boolean);

  function run(text) {
    const errors = [], cmds = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim(); if (!line) return;
      const t = line.split(/\s+/), c = t[0].toLowerCase(), at = 'Line ' + (i + 1) + ': ';
      const needAbs = (p) => { if (!p || !p.startsWith('/')) { errors.push(at + 'paths must start with "/" (got "' + (p || '') + '").'); return false; } return true; };
      if (c === 'su' && t.length === 3) cmds.push({ c, user: t[1], groups: t[2].split(',').filter(Boolean), line });
      else if ((c === 'mkdir' || c === 'touch') && (t.length === 2 || t.length === 3) && needAbs(t[1]) && (t[2] === undefined || parseMode(t[2]) !== null)) cmds.push({ c, path: t[1], mode: t[2] === undefined ? (c === 'mkdir' ? 0o755 : 0o644) : parseMode(t[2]), line });
      else if (c === 'ln' && t[1] === '-s' && t.length === 4 && needAbs(t[3])) cmds.push({ c: 'symlink', target: t[2], path: t[3], line });
      else if (c === 'ln' && t.length === 3 && needAbs(t[1]) && needAbs(t[2])) cmds.push({ c: 'link', target: t[1], path: t[2], line });
      else if ((c === 'rm' || c === 'rmdir') && t.length === 2 && needAbs(t[1])) cmds.push({ c, path: t[1], line });
      else if (c === 'chmod' && t.length === 3 && parseMode(t[1]) !== null && needAbs(t[2])) cmds.push({ c, mode: parseMode(t[1]), path: t[2], line });
      else if (c === 'chown' && t.length === 4 && needAbs(t[3])) cmds.push({ c, user: t[1], group: t[2], path: t[3], line });
      else if (['read', 'write', 'exec'].includes(c) && t.length === 2 && needAbs(t[1])) cmds.push({ c, path: t[1], line });
      else if (!errors.some((e) => e.startsWith(at))) errors.push(at + 'not understood. Commands: su USER GROUP[,GROUP]; mkdir|touch /path [mode]; ln [-s] TARGET /path; rm|rmdir /path; chmod MODE /path; chown USER GROUP /path; read|write|exec /path. Modes are 3 octal digits like 644.');
    });
    if (!cmds.length && !errors.length) errors.push('Enter at least one command.');
    if (cmds.length > LIMITS.maxCmds) errors.push('At most ' + LIMITS.maxCmds + ' commands.');
    if (errors.length) return { ok: false, errors };

    let nextIno = 2, user = { name: 'root', groups: ['root'] };
    const inodes = new Map([[1, { type: 'dir', owner: 'root', group: 'root', mode: 0o755, links: 2, entries: new Map() }]]);
    const isRoot = () => user.name === 'root';

    // Which permission class applies? Owner class wins even if the group would allow more (this is the classic trap).
    function allowed(ino, bit) {
      const n = inodes.get(ino);
      if (isRoot()) return { ok: true, why: 'root bypasses permission checks' };
      let cls, shift;
      if (user.name === n.owner) { cls = 'owner'; shift = 6; } else if (user.groups.includes(n.group)) { cls = 'group'; shift = 3; } else { cls = 'other'; shift = 0; }
      const ok = ((n.mode >> shift) & bit) !== 0, nm = bit === 4 ? 'read' : bit === 2 ? 'write' : 'execute';
      return { ok, cls, why: user.name + ' is in the ' + cls + ' class (' + (cls === 'owner' ? 'owner ' + n.owner : cls === 'group' ? 'group ' + n.group : 'neither owner nor in group ' + n.group) + '); ' + cls + ' bits are ' + modeStr(n.mode, n.type).slice(1 + 6 - shift, 4 + 6 - shift) + ', so ' + nm + ' is ' + (ok ? 'allowed' : 'denied') };
    }
    // Walk a path. Needs execute (search) permission on every directory passed through.
    function resolve(path, follow, depth) {
      let cur = 1; const parts = splitPath(path), steps = [];
      for (let k = 0; k < parts.length; k++) {
        const dir = inodes.get(cur);
        if (dir.type !== 'dir') return { err: '/' + parts.slice(0, k).join('/') + ' is not a directory', steps };
        const x = allowed(cur, 1); steps.push('search ' + (k ? '/' + parts.slice(0, k).join('/') : '/') + ': ' + x.why);
        if (!x.ok) return { err: 'permission denied: cannot search directory ' + (k ? '/' + parts.slice(0, k).join('/') : '/'), steps, denied: true };
        const name = parts[k], child = dir.entries.get(name);
        if (child === undefined) return { err: 'no such file or directory: /' + parts.slice(0, k + 1).join('/'), steps, missing: true, parent: cur, name, last: k === parts.length - 1 };
        let ino = child; const last = k === parts.length - 1;
        if (inodes.get(ino).type === 'symlink' && (!last || follow)) {
          if (depth >= LIMITS.maxSymlinkDepth) return { err: 'too many levels of symbolic links (loop?)', steps, loop: true };
          const tgt = inodes.get(ino).target; steps.push('/' + parts.slice(0, k + 1).join('/') + ' is a symlink to ' + tgt);
          const base = tgt.startsWith('/') ? tgt : '/' + parts.slice(0, k).concat(tgt).join('/');
          const r = resolve(base + (last ? '' : '/' + parts.slice(k + 1).join('/')), follow, depth + 1); r.steps = steps.concat(r.steps); return r;
        }
        if (last) return { ino, parent: cur, name, steps };
        cur = ino;
      }
      return { ino: cur, parent: null, name: '', steps };
    }
    const where = (path) => { const i = path.lastIndexOf('/'); return { dir: i <= 0 ? '/' : path.slice(0, i), name: path.slice(i + 1) }; };
    function tree() {
      const out = [];
      const walk = (ino, depth, name) => { const n = inodes.get(ino); out.push({ depth, name, ino, type: n.type, mode: modeStr(n.mode, n.type), owner: n.owner, group: n.group, links: n.links, target: n.target || null });
        if (n.type === 'dir') [...n.entries].sort((a, b) => a[0].localeCompare(b[0])).forEach(([nm, c]) => walk(c, depth + 1, nm)); };
      walk(1, 0, '/'); return out;
    }
    const frames = [{ i: 0, text: 'An empty file system: just the root directory, owned by root.', ok: true, tree: tree(), user: user.name, inodes: inodes.size }];
    const log = (k, cmd, t, ok, steps) => frames.push({ i: k + 1, cmd: cmd.line, text: t, ok, steps: steps || [], tree: tree(), user: user.name + ' (' + user.groups.join(', ') + ')', inodes: inodes.size });

    cmds.forEach((cmd, k) => {
      if (cmd.c === 'su') { user = { name: cmd.user, groups: cmd.groups }; return log(k, cmd, 'Now acting as ' + cmd.user + ' in group' + (cmd.groups.length > 1 ? 's ' : ' ') + cmd.groups.join(', ') + (cmd.user === 'root' ? ' (root: all checks pass).' : '.'), true); }
      if (['read', 'write', 'exec'].includes(cmd.c)) {
        const r = resolve(cmd.path, true, 0);
        if (r.err) return log(k, cmd, cmd.c + ' ' + cmd.path + ': ' + r.err + '.', false, r.steps);
        const bit = cmd.c === 'read' ? 4 : cmd.c === 'write' ? 2 : 1, n = inodes.get(r.ino), a = allowed(r.ino, bit);
        if (n.type === 'dir' && cmd.c === 'write') return log(k, cmd, cmd.path + ' is a directory.', false, r.steps);
        return log(k, cmd, cmd.c + ' ' + cmd.path + ' (inode ' + r.ino + '): ' + (a.ok ? 'allowed' : 'denied') + '.', a.ok, r.steps.concat(a.why));
      }
      if (cmd.c === 'mkdir' || cmd.c === 'touch' || cmd.c === 'symlink' || cmd.c === 'link') {
        const { dir, name } = where(cmd.path), p = resolve(dir, true, 0);
        if (p.err) return log(k, cmd, cmd.c + ' ' + cmd.path + ': ' + p.err + '.', false, p.steps);
        const pd = inodes.get(p.ino); if (pd.type !== 'dir') return log(k, cmd, dir + ' is not a directory.', false, p.steps);
        const w = allowed(p.ino, 2), x = allowed(p.ino, 1), steps = p.steps.concat('creating an entry needs write and search on ' + dir + ': ' + w.why);
        if (!w.ok || !x.ok) return log(k, cmd, cmd.c + ' ' + cmd.path + ': permission denied on directory ' + dir + '.', false, steps);
        if (!name || pd.entries.has(name)) return log(k, cmd, cmd.c + ' ' + cmd.path + ': name already exists.', false, steps);
        if (cmd.c === 'link') {
          const t = resolve(cmd.target, false, 0); if (t.err) return log(k, cmd, 'ln: ' + t.err + '.', false, t.steps);
          const tn = inodes.get(t.ino); if (tn.type === 'dir') return log(k, cmd, 'ln: hard links to directories are not allowed (they would make loops).', false, steps);
          pd.entries.set(name, t.ino); tn.links++;
          return log(k, cmd, 'Hard link: ' + cmd.path + ' is another name for inode ' + t.ino + '. Link count is now ' + tn.links + '. Both names are equal; neither is the "original".', true, steps);
        }
        const ino = nextIno++;
        if (cmd.c === 'symlink') { inodes.set(ino, { type: 'symlink', owner: user.name, group: user.groups[0], mode: 0o777, links: 1, target: cmd.target }); pd.entries.set(name, ino); return log(k, cmd, 'Symbolic link ' + cmd.path + ' (inode ' + ino + ') stores the text "' + cmd.target + '". The target is looked up each time it is used, so it can dangle.', true, steps); }
        const isDir = cmd.c === 'mkdir'; inodes.set(ino, { type: isDir ? 'dir' : 'file', owner: user.name, group: user.groups[0], mode: cmd.mode, links: isDir ? 2 : 1, entries: isDir ? new Map() : undefined }); pd.entries.set(name, ino); if (isDir) pd.links++;
        return log(k, cmd, (isDir ? 'Directory ' : 'File ') + cmd.path + ' created as inode ' + ino + ', owner ' + user.name + ', group ' + user.groups[0] + ', mode ' + modeStr(cmd.mode, isDir ? 'dir' : 'file') + '.', true, steps);
      }
      if (cmd.c === 'rm' || cmd.c === 'rmdir') {
        const { dir, name } = where(cmd.path), p = resolve(dir, true, 0);
        if (p.err) return log(k, cmd, cmd.c + ' ' + cmd.path + ': ' + p.err + '.', false, p.steps);
        const pd = inodes.get(p.ino), ino = pd.entries.get(name);
        if (ino === undefined) return log(k, cmd, cmd.c + ' ' + cmd.path + ': no such file or directory.', false, p.steps);
        const w = allowed(p.ino, 2), steps = p.steps.concat('removing a name needs write permission on the directory (not on the file): ' + w.why);
        if (!w.ok) return log(k, cmd, cmd.c + ' ' + cmd.path + ': permission denied on directory ' + dir + '.', false, steps);
        const n = inodes.get(ino);
        if (cmd.c === 'rmdir') { if (n.type !== 'dir') return log(k, cmd, cmd.path + ' is not a directory.', false, steps); if (n.entries.size) return log(k, cmd, cmd.path + ' is not empty.', false, steps); pd.entries.delete(name); pd.links--; inodes.delete(ino); return log(k, cmd, 'Directory removed.', true, steps); }
        if (n.type === 'dir') return log(k, cmd, 'rm: ' + cmd.path + ' is a directory (use rmdir).', false, steps);
        pd.entries.delete(name); n.links--;
        if (n.links === 0) { inodes.delete(ino); return log(k, cmd, 'Name removed; link count reached 0, so inode ' + ino + ' and its data blocks are freed.', true, steps); }
        return log(k, cmd, 'Name removed (rm only unlinks a name); inode ' + ino + ' still has ' + n.links + ' link' + (n.links > 1 ? 's' : '') + ', so the data stays.', true, steps);
      }
      // chmod / chown act on the object itself, following symlinks
      const r = resolve(cmd.path, true, 0); if (r.err) return log(k, cmd, cmd.c + ' ' + cmd.path + ': ' + r.err + '.', false, r.steps);
      const n = inodes.get(r.ino);
      if (cmd.c === 'chmod') { if (!isRoot() && user.name !== n.owner) return log(k, cmd, 'chmod: only the owner (' + n.owner + ') or root may change the mode.', false, r.steps); n.mode = cmd.mode; return log(k, cmd, 'Mode of inode ' + r.ino + ' is now ' + modeStr(cmd.mode, n.type) + '.', true, r.steps); }
      if (!isRoot()) return log(k, cmd, 'chown: only root may change the owner.', false, r.steps);
      n.owner = cmd.user; n.group = cmd.group; return log(k, cmd, 'Inode ' + r.ino + ' now belongs to ' + cmd.user + ':' + cmd.group + '.', true, r.steps);
    });
    return { ok: true, frames };
  }

  const PRESETS = [
    { id: 'perm', name: 'Owner, group, other', note: 'Same file, three users, three outcomes. Then the owner-class trap: with mode 070 the owner is locked out although the group has full access.', text: 'mkdir /home\ntouch /home/a.txt 640\nchown alice staff /home/a.txt\nsu bob dev\nread /home/a.txt\nsu carol staff\nread /home/a.txt\nwrite /home/a.txt\nsu alice staff\nwrite /home/a.txt\nchmod 070 /home/a.txt\nwrite /home/a.txt' },
    { id: 'hard', name: 'Hard links', note: 'Two names, one inode: removing one name keeps the data until the last name is gone.', text: 'mkdir /d\ntouch /d/a\nln /d/a /d/b\nrm /d/a\nread /d/b\nrm /d/b' },
    { id: 'sym', name: 'Symbolic links', note: 'A symlink stores a path, so it dangles when the target goes, and two symlinks can point at each other.', text: 'mkdir /d\ntouch /d/a\nln -s /d/a /d/s\nread /d/s\nrm /d/a\nread /d/s\nln -s /y /x\nln -s /x /y\nread /x' },
    { id: 'trav', name: 'Directory permissions', note: 'The file is world-readable, but its directory has no search permission for others, so the path cannot be walked.', text: 'mkdir /priv 700\ntouch /priv/f 644\nchown alice staff /priv\nsu bob dev\nread /priv/f\nsu alice staff\nread /priv/f' }
  ];
  NS.dirs = { LIMITS, run, modeStr, PRESETS };
  if (typeof module !== 'undefined') module.exports = NS.dirs;
})(typeof window !== 'undefined' ? window : globalThis);
