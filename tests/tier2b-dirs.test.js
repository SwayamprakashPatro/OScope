// Tier 2B: directories, links, permissions. Expected outcomes derived from the Unix permission rules.
const D = require('../js/engines/dirs.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const res = (r) => r.frames.slice(1).map((f) => f.ok);
const find = (f, name) => f.tree.find((t) => t.name === name);

eq('mode string 644', D.modeStr(0o644, 'file'), '-rw-r--r--');
eq('mode string 755 dir', D.modeStr(0o755, 'dir'), 'drwxr-xr-x');
eq('mode string 070', D.modeStr(0o070, 'file'), '----rwx---');

let r = D.run(D.PRESETS[0].text);
eq('permissions preset: mkdir, touch, chown, su, bob read, carol read, carol write, alice write, chmod, alice write', res(r), [true, true, true, true, false, true, true, false, true, true, true, false]);
eq('bob (other, bits 0) denied read', r.frames[5].ok, false);
eq('carol (group staff, 4) allowed read', r.frames[7].ok, true);
eq('carol denied write (group has only r)', r.frames[8].ok, false);
eq('alice (owner, 6) allowed write', r.frames[10].ok, true);
eq('owner is locked out when mode is 070 even though the group has rwx', r.frames[12].ok, false);
eq('reason shows the owner bits ---', /owner bits are ---/.test(r.frames[12].steps.join(' ')), true);
eq('carol reason shows group bits r--', /group bits are r--/.test(r.frames[7].steps.join(' ')), true);
eq('reason mentions owner class', /owner class/.test(r.frames[12].steps.join(' ')), true);

r = D.run(D.PRESETS[1].text);
eq('hard link: link count 2', find(r.frames[3], 'b').links, 2);
eq('both names share one inode', find(r.frames[3], 'a').ino, find(r.frames[3], 'b').ino);
eq('after rm a: count 1, data stays, b readable', [find(r.frames[4], 'b').links, r.frames[5].ok], [1, true]);
eq('after rm b: inode gone', r.frames[6].tree.some((t) => t.name === 'b'), false);
eq('inode count back to root + dir only', r.frames[6].inodes, 2);

r = D.run(D.PRESETS[2].text);
eq('symlink read works', r.frames[4].ok, true);
eq('dangling symlink fails after target removed', r.frames[6].ok, false);
eq('symlink loop detected', [r.frames[9].ok, /symbolic links/.test(r.frames[9].text)], [false, true]);
eq('symlink target text stored', find(r.frames[3], 's').target, '/d/a');

r = D.run(D.PRESETS[3].text);
eq('bob cannot walk through /priv (needs x on directory)', r.frames[5].ok, false);
eq('denial names the directory', /search directory \/priv/.test(r.frames[5].text), true);
eq('alice (owner, 7) can read', r.frames[7].ok, true);

r = D.run('mkdir /a 700\nsu bob dev\ntouch /a/x');
eq('creating needs write on the directory', [r.frames[1].ok, r.frames[3].ok], [true, false]);
r = D.run('mkdir /a 755\ntouch /a/x 000\nsu bob dev\nrm /a/x');
eq('unlink needs write on the DIRECTORY, not the file: bob has no w on /a → denied', r.frames[4].ok, false);
r = D.run('mkdir /a 777\ntouch /a/x 000\nsu bob dev\nrm /a/x');
eq('with a world-writable directory, even a mode-000 file can be removed', r.frames[4].ok, true);
r = D.run('touch /f 000\nread /f\nwrite /f\nexec /f');
eq('root bypasses mode 000', res(r), [true, true, true, true]);
r = D.run('mkdir /d\nrm /d');
eq('rm on a directory refused', r.frames[2].ok, false);
r = D.run('mkdir /d\ntouch /d/f\nrmdir /d');
eq('rmdir on non-empty refused', r.frames[3].ok, false);
r = D.run('mkdir /d\nmkdir /d/e\nrmdir /d/e\nrmdir /d');
eq('rmdir empty works', [r.frames[3].ok, r.frames[4].ok], [true, true]);
eq('directory link count: parent + "." + child ".." = 3 with one subdir', D.run('mkdir /d\nmkdir /d/e').frames[1].tree.find((t) => t.name === '/').links, 3);
r = D.run('mkdir /d\nln /d /e');
eq('hard link to directory refused', r.frames[2].ok, false);
r = D.run('touch /f\nsu bob dev\nchmod 777 /f');
eq('only owner or root can chmod', r.frames[3].ok, false);
r = D.run('touch /f\nsu bob dev\nchown bob dev /f');
eq('only root can chown', r.frames[3].ok, false);
r = D.run('touch /f\nchown alice staff /f\nsu alice staff\nchmod 600 /f');
eq('owner can chmod', r.frames[4].ok, true);
r = D.run('mkdir /d\nmkdir /d/sub\nln -s sub /d/rel\ntouch /d/sub/f\nread /d/rel/f');
eq('relative symlink resolves against its own directory', r.frames[5].ok, true);
eq('relative path rejected', D.run('touch f').ok, false);
eq('bad mode rejected', D.run('touch /f 999').ok, false);
eq('unknown command rejected', D.run('cat /f').ok, false);
eq('empty rejected', D.run('').ok, false);
eq('write to a directory refused', D.run('mkdir /d\nwrite /d').frames[2].ok, false);
for (let t = 0; t < 200; t++) { // random: link counts always equal the number of directory entries pointing at the inode
  const names = ['/a', '/b', '/c', '/d'], cmds = ['mkdir /a', 'touch /a/x'];
  for (let i = 0; i < 12; i++) { const p = '/a/' + 'xyzw'[Math.floor(Math.random() * 4)], q = '/a/' + 'xyzw'[Math.floor(Math.random() * 4)], x = Math.random(); cmds.push(x < 0.35 ? 'touch ' + p : x < 0.65 ? 'ln ' + p + ' ' + q : x < 0.85 ? 'rm ' + p : 'ln -s ' + p + ' ' + q); }
  const rr = D.run(cmds.join('\n')); let ok = rr.ok;
  rr.frames.forEach((f) => { const cnt = {}; f.tree.forEach((n) => { if (n.depth > 0 && n.type === 'file') cnt[n.ino] = (cnt[n.ino] || 0) + 1; }); f.tree.forEach((n) => { if (n.type === 'file' && n.links !== cnt[n.ino]) ok = false; }); });
  if (!ok) { fail++; console.log('FAIL random links', cmds.join(';')); } else pass++;
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
