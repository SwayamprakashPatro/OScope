// Tier 3: garbage collection lab. Hand-traced cases plus differential tests against independent models.
const G = require('../js/engines/gc.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const run = (script, o) => G.run(script, Object.assign({ heap: 16, autoGc: true }, o || {}));
const lastF = (r, a) => r.runs[a].frames[r.runs[a].frames.length - 1];
const aliveNames = (r, a) => lastF(r, a).objs.filter((o) => o.alive).map((o) => o.name).sort();

// ---- parsing
eq('empty script', run('').ok, false);
eq('unknown command is line-numbered', run('new A\nfly A').errors, ['Line 2: unknown command "fly". Use new, root, unroot, ref, unref or gc.']);
eq('ref to an unknown object', run('new A\nref A B').errors[0].startsWith('Line 2: unknown object B'), true);
eq('duplicate name', /already created on line 1/.test(run('new A\nnew A').errors[0]), true);
eq('size limit', /from 1 to 3/.test(run('new A 9').errors[0]), true);
eq('unref of a pointer that does not exist', /does not point/.test(run('new A\nnew B\nunref A B').errors[0]), true);
eq('heap size is validated', /Heap capacity/.test(run('new A', { heap: 2 }).errors[0]), true);
eq('too many objects', /At most 12 objects/.test(run(Array.from({ length: 13 }, (_, i) => 'new O' + i).join('\n')).errors[0]), true);
eq('comments and blank lines are ignored', run('# hi\n\nnew A  # inline\nroot A').ok, true);

// ---- hand-traced: a chain whose root is dropped
let r = run('new A\nnew B\nnew C\nroot A\nref A B\nref B C\nunroot A\ngc');
eq('chain: mark-sweep frees A, B, C at the gc', [aliveNames(r, 'ms'), lastF(r, 'ms').stats.freedObjects, lastF(r, 'ms').stats.bytesReclaimed], [[], 3, 48]);
eq('chain: reference counting frees them at unroot, in cascade order A, B, C', r.runs.rc.freeOrder, ['A', 'B', 'C']);
eq('chain: the cascade happens BEFORE the gc line (frames name the line of the unroot)', r.runs.rc.frames.filter((f) => f.kind === 'free').map((f) => f.line), [7, 7, 7]);
eq('chain: copying collector leaves nothing', [aliveNames(r, 'cp'), lastF(r, 'cp').heap.spaces.map((s) => s.cells.filter(Boolean).length)], [[], [0, 0]]);
// ---- cycle: reference counting leaks it, tracing does not
r = run('new A\nnew B\nnew C\nref A B\nref B A\nroot A\nroot C\nunroot A\ngc');
eq('cycle: reference counting keeps A and B (leak), frees nothing', [aliveNames(r, 'rc'), lastF(r, 'rc').leaked, lastF(r, 'rc').stats.leaked], [['A', 'B', 'C'], ['A', 'B'], 2]);
eq('cycle: counts stay at 1 for A and B', lastF(r, 'rc').objs.filter((o) => ['A', 'B'].includes(o.name)).map((o) => o.rc), [1, 1]);
eq('cycle: mark-sweep frees A and B, keeps C', [aliveNames(r, 'ms'), lastF(r, 'ms').stats.freedObjects], [['C'], 2]);
eq('cycle: copying frees A and B, keeps C', aliveNames(r, 'cp'), ['C']);
eq('self pointer is a one-object cycle: leaks under counting', (() => { const x = run('new A\nref A A\nroot A\nunroot A\ngc'); return [aliveNames(x, 'rc'), aliveNames(x, 'ms')]; })(), [['A'], []]);
// ---- shared object
r = run('new A\nnew B\nnew C\nref A C\nref B C\nroot A\nroot B\nunroot A\ngc');
eq('shared: C survives while B still points at it (count 2 -> 1)', [aliveNames(r, 'ms'), aliveNames(r, 'rc'), lastF(r, 'rc').objs.find((o) => o.name === 'C').rc], [['B', 'C'], ['B', 'C'], 1]);
// ---- mark phase details (hand-traced): roots A; A->B, A->C, B->D
r = run('new A\nnew B\nnew C\nnew D\nnew E\nroot A\nref A B\nref A C\nref B D\ngc');
const marks = r.runs.ms.frames.filter((f) => f.kind === 'mark');
eq('mark visits A, B, D, C in depth-first-by-stack order', marks.map((f) => f.focus), ['A', 'B', 'D', 'C']);
eq('mark visits only reachable objects (4 of 5)', lastF(r, 'ms').stats.visited, 4);
eq('sweep visits all 5 allocated objects', lastF(r, 'ms').stats.swept, 5);
eq('E is the only object freed', r.runs.ms.freeOrder, ['E']);
eq('the world is stopped during the collection and resumes after', [r.runs.ms.frames.filter((f) => f.stw).length > 3, lastF(r, 'ms').stw], [true, false]);
eq('all marked objects were reset to white after the sweep', lastF(r, 'ms').objs.filter((o) => o.alive).every((o) => o.color === 'white'), true);
// ---- Cheney copying, hand-traced: same graph; copy order is breadth-first A, B, C, D
eq('copying: survivors packed at addresses A0 B1 C2 D3 (breadth-first)', lastF(r, 'cp').objs.filter((o) => o.alive).map((o) => [o.name, o.addr]), [['A', 0], ['B', 1], ['C', 2], ['D', 3]]);
eq('copying: 4 objects moved, E left behind', [lastF(r, 'cp').stats.moved, r.runs.cp.freeOrder], [4, ['E']]);
eq('copying: scan catches free at 4, then the spaces swap', (() => { const f = r.runs.cp.frames.find((x) => x.kind === 'cp-done'); return [f.heap.scan, f.heap.free]; })(), [4, 4]);
eq('copying: after the flip the old space is empty and survivors have no holes', (() => { const h = lastF(r, 'cp').heap; const act = h.spaces.find((s) => s.role === 'active'), idle = h.spaces.find((s) => s.role === 'idle'); return [act.cells.slice(0, 4).every(Boolean), act.cells.slice(4).every((c) => !c), idle.cells.every((c) => !c)]; })(), [true, true, true]);
eq('copying: forwarding pointers exist during the collection', r.runs.cp.frames.some((f) => f.kind === 'copy' && f.heap.spaces.some((s) => s.role === 'from' && s.cells.some((c) => c && c.fwd != null))), true);
eq('copying: a shared object is copied once (second pointer uses the forwarding pointer)', (() => { const x = run('new A\nnew B\nnew C\nroot A\nref A B\nref A C\nref B C\ngc'); return [lastF(x, 'cp').stats.moved, x.runs.cp.frames.filter((f) => f.kind === 'fwd').length]; })(), [3, 1]);
eq('copying: multi-cell objects keep their size', (() => { const x = run('new A 2\nnew B 3\nroot A\nref A B\ngc'); const o = lastF(x, 'cp').objs; return o.map((q) => [q.name, q.addr, q.size]); })(), [['A', 0, 2], ['B', 2, 3]]);
// ---- fragmentation: mark-sweep leaves holes, copying compacts
r = run('new A\nnew B\nnew C\nnew D\nroot A\nroot C\ngc', { heap: 8 });
eq('mark-sweep leaves holes where B and D were (A at 0, C at 2)', lastF(r, 'ms').objs.filter((o) => o.alive).map((o) => [o.name, o.addr]), [['A', 0], ['C', 2]]);
eq('mark-sweep: 6 free cells, largest block 5 (D was last, so hole at 1 and 3..7)', [lastF(r, 'ms').stats.freeCells, lastF(r, 'ms').stats.largestFree], [6, 5]);
eq('mark-sweep fragmentation is positive, copying is zero', [lastF(r, 'ms').stats.fragmentation > 0, lastF(r, 'cp').stats.fragmentation], [true, 0]);
eq('external fragmentation: free in total but no block big enough', (() => { const x = run('new A\nnew B\nnew C\nnew D\nroot A\nroot C\ngc\nnew BIG 2', { heap: 4 }); return /fragmentation/.test((x.runs.ms.error || {}).message || ''); })(), true);
// ---- automatic collection and out of memory
eq('auto-gc frees garbage when the heap is full', (() => { const x = run('new A\nnew B\nnew C\nnew D\nroot A\nnew E', { heap: 4 }); return [x.runs.ms.error, aliveNames(x, 'ms')]; })(), [null, ['A', 'E']]);
eq('reference counting says why it ran out: created-but-never-pointed-at objects', (() => { const x = run('new A\nnew B\nnew C\nnew D\nroot A\nnew E', { heap: 4 }); return /B, C, D were created but never pointed at/.test(x.runs.rc.error.message); })(), true);
eq('reference counting says why it ran out: a cycle', (() => { const x = run('new A\nnew B\nref A B\nref B A\nroot A\nunroot A\nnew C\nnew D\nnew E', { heap: 4 }); return /A, B form a cycle/.test(x.runs.rc.error.message); })(), true);
eq('auto-gc off: heap full is an error with advice', (() => { const x = run('new A\nnew B\nnew C\nnew D\nroot A\nnew E', { heap: 4, autoGc: false }); return /Automatic collection is off/.test(x.runs.ms.error.message); })(), true);
eq('really out of memory: everything reachable', (() => { const x = run('new A\nroot A\nnew B\nroot B\nnew C\nroot C\nnew D\nroot D\nnew E', { heap: 4 }); return /Even after a collection/.test(x.runs.ms.error.message); })(), true);
eq('copying collector can only use half the heap', (() => { const x = run('new A\nroot A\nnew B\nroot B\nnew C\nroot C\nnew D\nroot D\nnew E\nroot E', { heap: 8 }); return [x.runs.ms.error, /Out of memory/.test(x.runs.cp.error.message)]; })(), [null, true]);
eq('an object created but not yet rooted is garbage if a collection runs (copying, tiny heap)', (() => { const x = run('new A\nnew B\nnew C\nroot A', { heap: 4 }); return /Use after free/.test(x.runs.cp.error.message); })(), true);
eq('use after free is detected and stops only that collector', (() => { const x = run('new A\nnew B\nroot A\nref A B\nunref A B\nref A B'); return [x.runs.rc.error && /Use after free/.test(x.runs.rc.error.message), x.runs.ms.error]; })(), [true, null]);

// ---- differential tests on random scripts: independent models for reachability and reference counting
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// A random mutator that only touches objects it can still reach (so no collector ever sees a use-after-free).
function randomScript(seed) {
  const R = rng(seed), lines = [], edges = new Set(), roots = new Set(), made = []; let n = 0, cells = 0;
  const reach = () => { const seen = new Set(); const q = [...roots]; q.forEach((x) => seen.add(x)); while (q.length) { const x = q.shift(); edges.forEach((e) => { const [a, b] = e.split('>'); if (a === x && !seen.has(b)) { seen.add(b); q.push(b); } }); } return seen; };
  for (let i = 0; i < 28; i++) {
    const live = [...reach()], pick = (a) => a[Math.floor(R() * a.length)], r = R();
    if ((r < 0.3 && n < 10 && cells < 7) || !live.length) { const nm = 'O' + n++, sz = R() < 0.3 && cells < 7 ? 2 : 1; cells += sz; lines.push('new ' + nm + (sz > 1 ? ' 2' : '')); lines.push('root ' + nm); roots.add(nm); made.push(nm); }
    else if (r < 0.6) { const a = pick(live), b = pick(live); if (!edges.has(a + '>' + b)) { edges.add(a + '>' + b); lines.push('ref ' + a + ' ' + b); } }
    else if (r < 0.75) { const e = [...edges].filter((x) => live.includes(x.split('>')[0])); if (e.length) { const x = pick(e); edges.delete(x); lines.push('unref ' + x.replace('>', ' ')); } }
    else if (r < 0.9) { if (roots.size) { const x = pick([...roots]); roots.delete(x); lines.push('unroot ' + x); } }
    else lines.push('gc');
  }
  lines.push('gc');
  return { text: lines.join('\n'), made, edges, roots, reachSet: reach() };
}
// Independent reference-counting model: counts are incoming pointers (roots and edges from allocated objects).
function modelRC(text) {
  const alive = new Set(), refs = {}, rc = {}, roots = new Set();
  const dec = (x) => { rc[x]--; if (rc[x] === 0) { alive.delete(x); (refs[x] || []).slice().forEach(dec); } };
  text.split('\n').forEach((l) => { const [op, a, b] = l.split(' '); if (op === 'new') { alive.add(a); refs[a] = []; rc[a] = 0; } else if (op === 'root') { rc[a]++; roots.add(a); } else if (op === 'ref') { refs[a].push(b); rc[b]++; } else if (op === 'unref') { refs[a] = refs[a].filter((x) => x !== b); dec(b); } else if (op === 'unroot') { roots.delete(a); dec(a); } });
  return [...alive].sort();
}
let agree = 0, total = 0, cyclesSeen = 0, packed = 0, shapeOk = 0, rcOk = 0, leakOk = 0;
for (let seed = 1; seed <= 250; seed++) {
  const sc = randomScript(seed), x = run(sc.text, { heap: 16, autoGc: false });
  if (!x.ok) { console.log('generator produced a bad script', seed, x.errors); fail++; continue; }
  if (Object.values(x.runs).some((q) => q.error)) continue;          // e.g. 16 cells too small for this random script
  total++;
  const want = [...sc.reachSet].sort();
  const ms = aliveNames(x, 'ms'), cp = aliveNames(x, 'cp');
  if (JSON.stringify(ms) === JSON.stringify(want) && JSON.stringify(cp) === JSON.stringify(want)) agree++;
  else console.log('FAIL tracing disagrees with BFS on seed', seed, ms, cp, want);
  const rcAlive = aliveNames(x, 'rc'), model = modelRC(sc.text);
  if (JSON.stringify(rcAlive) === JSON.stringify(model)) rcOk++; else console.log('FAIL refcount model differs on seed', seed, rcAlive, model);
  // leak = alive under refcount but unreachable; every such object must be on or fed only by a cycle
  const leaked = rcAlive.filter((n) => !sc.reachSet.has(n)), reported = lastF(x, 'rc').leaked.slice().sort();
  if (JSON.stringify(leaked) === JSON.stringify(reported)) leakOk++; else console.log('FAIL leak report differs on seed', seed, leaked, reported);
  if (leaked.length) cyclesSeen++;
  // copying: survivors contiguous from address 0, pointer graph unchanged, sizes preserved
  const f = lastF(x, 'cp'), act = f.heap.spaces.find((s) => s.role === 'active'), live = f.objs.filter((o) => o.alive);
  const cells = live.reduce((t, o) => t + o.size, 0);
  if (act.cells.slice(0, cells).every(Boolean) && act.cells.slice(cells).every((c) => !c)) packed++;
  const edgesAfter = [].concat(...live.map((o) => o.refs.map((c) => o.name + '>' + c))).sort(), edgesWant = [...sc.edges].filter((e) => sc.reachSet.has(e.split('>')[0])).sort();
  if (JSON.stringify(edgesAfter) === JSON.stringify(edgesWant)) shapeOk++;
}
eq('random scripts: mark-sweep and copying keep exactly the reachable set (vs independent BFS)', [agree, total > 150], [total, true]);
eq('random scripts: reference counting matches an independent counting model', rcOk, total);
eq('random scripts: reported leaks = unreachable objects that counting kept', leakOk, total);
eq('random scripts: copying packs survivors from address 0 with no holes', packed, total);
eq('random scripts: copying preserves every pointer between survivors', shapeOk, total);
eq('random scripts: some of them really contained leaking cycles', cyclesSeen > 5, true);
// every statistic is internally consistent
eq('freed objects + still allocated = objects created (all collectors, random scripts)', (() => { let ok = true; for (let seed = 300; seed < 340; seed++) { const sc = randomScript(seed), x = run(sc.text, { autoGc: false }); if (!x.ok) continue; Object.keys(x.runs).forEach((a) => { const q = x.runs[a]; if (q.error) return; const st = q.stats; if (st.freedObjects + st.alive !== sc.made.length) ok = false; }); } return ok; })(), true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
