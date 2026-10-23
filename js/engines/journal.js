/* Journaling and crash-recovery engine. Pure logic, no DOM.

   A tiny file system lives on a disk of 16 data blocks plus four kinds of metadata blocks:
     bitmap   which data blocks are allocated (one block holding 16 bits)
     inode    one per file: its generation number and the list of data blocks it owns
     dir      the directory: the names of the files that exist
     data     the 16 data blocks; each holds a tag saying which file (and generation) wrote it
   The user types a script of operations:
     create A        make a new empty file       (writes: inode A, directory)
     append A n      give A n more data blocks   (writes: n data blocks, bitmap, inode A)
     delete A        remove file A               (writes: directory, inode A, bitmap)
   Each operation is a TRANSACTION: a set of block writes that must ALL reach the disk or NONE.
   A disk can only write one block at a time and power can fail between any two writes, so a crash
   in the middle leaves a half-done operation. Journaling is the trick that makes it all-or-nothing.

   Four ways of ordering the writes (the "modes"):
     none       write blocks straight to their home place, in an order you choose (no protection)
     writeback  metadata goes through the journal, data is written whenever (after the commit here)
     ordered    metadata goes through the journal, but data is written to disk BEFORE the commit
     full       data and metadata both go through the journal (data written twice)
   Every number shown is computed by really running the writes and really crashing the disk;
   nothing is stored as an answer. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  const LIMITS = { maxOps: 6, maxBlocksPerOp: 4, dataBlocks: 16, nameRe: /^[A-Za-z][A-Za-z0-9]{0,5}$/ };

  const MODES = [
    { id: 'none', short: 'No journal', name: 'No journal (write in place)',
      rule: 'Each block is written straight to its home location, one after another, in the order you pick. Power can fail between any two writes.',
      hook: 'Many small writes, no safety net: whatever was written is what you get.',
      watch: 'No ordering of the writes is safe for every operation. Some orders leak space, others leave pointers to unwritten data, and only a slow full-disk scan (fsck) can repair it.' },
    { id: 'writeback', short: 'Metadata, writeback', name: 'Metadata journaling, writeback (data may come late)',
      rule: 'Only metadata (bitmap, inode, directory) goes through the journal: log it, write a commit record, then copy it to its home. File data is written independently, here after the commit.',
      hook: 'The structure is safe; what is inside the file is not promised.',
      watch: 'After a crash the file system is consistent, but a file can point at a block whose data never arrived, so it contains stale old data (and may even expose another user\'s deleted data).' },
    { id: 'ordered', short: 'Metadata, ordered', name: 'Metadata journaling, ordered (data first)',
      rule: 'Write the file data to its home blocks FIRST, then journal the metadata and commit it. A committed transaction can therefore only point at data that is already on disk.',
      hook: 'Data first, then the commit: never point at what is not there. (The default in ext4.)',
      watch: 'The data itself is not logged, so an overwrite of existing data can still be torn; but appends and new files are all-or-nothing.' },
    { id: 'full', short: 'Full data journal', name: 'Full data journaling (data and metadata logged)',
      rule: 'Everything, data included, is written to the journal and committed first, then copied to its home location. After a crash, committed transactions are replayed; uncommitted ones are thrown away.',
      hook: 'Write it down, seal it (commit), then do it. Replay what is sealed, forget the rest.',
      watch: 'Every data block is written twice, so it is the slowest. It is the only mode that makes even overwritten file data all-or-nothing.' }
  ];
  const BY_ID = {}; MODES.forEach((m) => { BY_ID[m.id] = m; });

  // Orders for the no-journal mode: the writes of one operation are sorted by the rank of their kind.
  const ORDERS = [
    { id: 'data-first', label: 'data, bitmap, inode, directory', kinds: ['data', 'bitmap', 'inode', 'dir'] },
    { id: 'meta-first', label: 'directory, inode, bitmap, data', kinds: ['dir', 'inode', 'bitmap', 'data'] },
    { id: 'inode-first', label: 'inode, directory, data, bitmap', kinds: ['inode', 'dir', 'data', 'bitmap'] },
    { id: 'bitmap-first', label: 'bitmap, data, inode, directory', kinds: ['bitmap', 'data', 'inode', 'dir'] }
  ];
  const ORDER_BY_ID = {}; ORDERS.forEach((o) => { ORDER_BY_ID[o.id] = o; });

  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* ---------------------------------------------------------------- parsing and planning */

  // freshDisk(): an empty file system. Every data block starts with STALE content (generation 0) from "a previous
  // life", so a block that is never written is distinguishable from one that holds a file's real data.
  function freshDisk() {
    return { bitmap: new Array(LIMITS.dataBlocks).fill(0), inodes: {}, dir: [], data: Array.from({ length: LIMITS.dataBlocks }, () => ({ file: '?', gen: 0 })), journal: [] };
  }

  // parse(text): read the script, applying it to a logical model as it goes so that mistakes (appending to a
  // file that does not exist, running out of blocks) are reported with their line number. Returns the PLAN: for
  // every operation the list of block writes it needs, plus the logical state after it.
  function parse(text) {
    let tooMany = false;
    const errors = [], plan = [], model = { bitmap: new Array(LIMITS.dataBlocks).fill(0), inodes: {}, dir: [] };
    const states = [logical(model)];
    String(text == null ? '' : text).split(/\r?\n/).forEach((raw, i) => {
      const body = raw.replace(/#.*$/, '').trim(); if (!body) return;
      const ln = i + 1, w = body.split(/\s+/), cmd = w[0].toLowerCase();
      if (plan.length >= LIMITS.maxOps) { if (!tooMany) errors.push('At most ' + LIMITS.maxOps + ' operations (line ' + ln + ' and later are ignored).'); tooMany = true; return; }
      const name = w[1];
      const okName = () => { if (!name || !LIMITS.nameRe.test(name)) { errors.push('Line ' + ln + ': give a file name of up to 6 letters or digits, starting with a letter, for example "' + cmd + ' A".'); return false; } return true; };
      const opIndex = plan.length + 1;
      if (cmd === 'create') {
        if (w.length !== 2 || !okName()) { if (w.length !== 2 && name) errors.push('Line ' + ln + ': "create" needs just a file name.'); return; }
        if (name in model.inodes) { errors.push('Line ' + ln + ': ' + name + ' already exists.'); return; }
        model.inodes[name] = { gen: opIndex, blocks: [] }; model.dir.push(name);
        plan.push({ op: 'create', name, text: 'create ' + name, line: ln, writes: [
          { kind: 'inode', name, payload: clone(model.inodes[name]) }, { kind: 'dir', payload: model.dir.slice() }] });
      } else if (cmd === 'append') {
        if (w.length !== 3 || !okName()) { if (w.length !== 3 && name) errors.push('Line ' + ln + ': "append" needs a file name and a number of blocks, for example "append A 2".'); return; }
        const n = Number(w[2]);
        if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxBlocksPerOp) { errors.push('Line ' + ln + ': the number of blocks must be a whole number from 1 to ' + LIMITS.maxBlocksPerOp + '.'); return; }
        if (!(name in model.inodes)) { errors.push('Line ' + ln + ': ' + name + ' does not exist. Create it first with "create ' + name + '".'); return; }
        const free = model.bitmap.map((b, k) => (b ? -1 : k)).filter((k) => k >= 0);
        if (free.length < n) { errors.push('Line ' + ln + ': only ' + plural(free.length, 'free block') + ' left on the 16-block disk.'); return; }
        const pick = free.slice(0, n), ino = model.inodes[name];
        pick.forEach((b) => { model.bitmap[b] = 1; ino.blocks.push(b); });
        plan.push({ op: 'append', name, n, text: 'append ' + name + ' ' + n, line: ln, blocks: pick, writes: pick.map((b) => ({ kind: 'data', block: b, payload: { file: name, gen: ino.gen } }))
          .concat([{ kind: 'bitmap', payload: model.bitmap.slice() }, { kind: 'inode', name, payload: clone(ino) }]) });
      } else if (cmd === 'delete') {
        if (w.length !== 2 || !okName()) { if (w.length !== 2 && name) errors.push('Line ' + ln + ': "delete" needs just a file name.'); return; }
        if (!(name in model.inodes)) { errors.push('Line ' + ln + ': ' + name + ' does not exist.'); return; }
        const ino = model.inodes[name]; ino.blocks.forEach((b) => { model.bitmap[b] = 0; });
        delete model.inodes[name]; model.dir = model.dir.filter((x) => x !== name);
        plan.push({ op: 'delete', name, text: 'delete ' + name, line: ln, writes: [
          { kind: 'dir', payload: model.dir.slice() }, { kind: 'inode', name, payload: null }, { kind: 'bitmap', payload: model.bitmap.slice() }] });
      } else { errors.push('Line ' + ln + ': unknown operation "' + w[0] + '". Use create, append or delete.'); return; }
      states.push(logical(model));
    });
    const real = plan;
    if (!real.length && !errors.length) errors.push('Write at least one operation, for example: create A');
    return { ok: errors.length === 0, errors, plan: real, states };
  }

  // logical(model): the part of the state that decides "which operations happened": bitmap, inodes, directory.
  function logical(m) { return { bitmap: m.bitmap.slice(), inodes: clone(m.inodes), dir: m.dir.slice().sort() }; }
  const sameLogical = (a, b) => JSON.stringify([a.bitmap, a.inodes, a.dir.slice().sort()]) === JSON.stringify([b.bitmap, b.inodes, b.dir.slice().sort()]);

  /* ---------------------------------------------------------------- the disk and its writes */

  // applyWrite(disk, w): put one block write on the platter (the write is atomic: the block is either old or new).
  function applyWrite(d, w) {
    if (w.kind === 'data') d.data[w.block] = clone(w.payload);
    else if (w.kind === 'bitmap') d.bitmap = w.payload.slice();
    else if (w.kind === 'dir') d.dir = w.payload.slice();
    else if (w.kind === 'inode') { if (w.payload == null) delete d.inodes[w.name]; else d.inodes[w.name] = clone(w.payload); }
  }

  // describe(w): the plain-language name of a write, used in the step list.
  function describe(w) {
    if (w.kind === 'data') return 'data block D' + w.block + ' (file ' + w.payload.file + ')';
    if (w.kind === 'bitmap') return 'the bitmap (allocated: ' + (w.payload.map((b, k) => (b ? 'D' + k : null)).filter(Boolean).join(' ') || 'none') + ')';
    if (w.kind === 'dir') return 'the directory (' + (w.payload.length ? w.payload.join(', ') : 'empty') + ')';
    return 'inode ' + w.name + (w.payload == null ? ' (freed)' : ' (blocks: ' + (w.payload.blocks.map((b) => 'D' + b).join(' ') || 'none') + ')');
  }

  /* ---------------------------------------------------------------- the write protocol */

  // build(plan, mode, orderId): turn the plan into the list of disk-write STEPS for one mode, and the disk image
  // after every step (states[k] = the platter after k steps; k = 0 is the empty disk). opEnd[i] is the number of steps
  // after which operation i is completely finished (including its checkpoint and journal clean-up).
  function build(plan, mode, orderId) {
    const order = (ORDER_BY_ID[orderId] || ORDERS[0]).kinds, steps = [], opEnd = [];
    plan.forEach((p, i) => {
      const tx = i + 1, ws = p.writes, data = ws.filter((w) => w.kind === 'data'), meta = ws.filter((w) => w.kind !== 'data');
      const W = (w, why) => steps.push({ type: 'write', op: i, tx, w, text: 'Write ' + describe(w) + ' to its home location.' + (why ? ' ' + why : '') });
      const jb = () => steps.push({ type: 'jbegin', op: i, tx, text: 'Journal: write the transaction-begin record for "' + p.text + '". The journal is a small log area of the disk.' });
      const jw = (w) => steps.push({ type: 'jblock', op: i, tx, w, text: 'Journal: write a COPY of ' + describe(w) + ' into the log. The real location is untouched.' });
      const jc = () => steps.push({ type: 'jcommit', op: i, tx, text: 'Journal: write the COMMIT record. From this instant the transaction is sealed: after a crash it will be replayed, not discarded. (Everything above must be on disk before this write.)' });
      const jf = () => steps.push({ type: 'jfree', op: i, tx, text: 'Journal: the transaction is fully copied home, so free its log space.' });
      if (mode === 'none') {
        const sorted = ws.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
        sorted.forEach((w) => W(w));
      } else if (mode === 'ordered') {
        data.forEach((w) => W(w, 'Ordered mode writes data BEFORE the commit.'));
        jb(); meta.forEach(jw); jc(); meta.forEach((w) => W(w, 'Checkpoint.')); jf();
      } else if (mode === 'writeback') {
        jb(); meta.forEach(jw); jc(); meta.forEach((w) => W(w, 'Checkpoint.')); data.forEach((w) => W(w, 'Writeback mode: the data goes whenever the cache flushes, here after the commit.')); jf();
      } else {
        jb(); data.forEach(jw); meta.forEach(jw); jc(); data.forEach((w) => W(w, 'Checkpoint.')); meta.forEach((w) => W(w, 'Checkpoint.')); jf();
      }
      opEnd.push(steps.length);
    });
    // Replay the steps on a disk image to get the platter after each step.
    const states = [freshDisk()];
    steps.forEach((s) => {
      const d = clone(states[states.length - 1]);
      if (s.type === 'write') applyWrite(d, s.w);
      else if (s.type === 'jbegin') d.journal.push({ tx: s.tx, committed: false, blocks: [] });
      else if (s.type === 'jblock') d.journal.find((t) => t.tx === s.tx).blocks.push({ w: s.w, label: describe(s.w) });
      else if (s.type === 'jcommit') d.journal.find((t) => t.tx === s.tx).committed = true;
      else if (s.type === 'jfree') d.journal = d.journal.filter((t) => t.tx !== s.tx);
      states.push(d);
    });
    return { mode, steps, states, opEnd, plan };
  }

  /* ---------------------------------------------------------------- crash, recovery, consistency check */

  // check(disk): the consistency check (what fsck verifies), computed from the platter alone. Returns the list
  // of violations; an empty list means the structures are consistent.
  function check(d) {
    const v = [], refs = {};
    Object.keys(d.inodes).forEach((n) => d.inodes[n].blocks.forEach((b) => { (refs[b] = refs[b] || []).push(n); }));
    d.bitmap.forEach((bit, b) => { if (bit && !refs[b]) v.push({ code: 'leak', block: b, text: 'Block D' + b + ' is marked allocated but no file uses it: the space is leaked (only a full fsck scan can give it back).' }); });
    Object.keys(refs).forEach((b) => {
      if (refs[b].length > 1) v.push({ code: 'double', block: +b, text: 'Block D' + b + ' belongs to more than one file (' + refs[b].join(', ') + ').' });
      if (!d.bitmap[b]) v.push({ code: 'dangling', block: +b, text: 'File ' + refs[b][0] + ' uses block D' + b + ' but the bitmap says it is free: the allocator could hand it to another file and the two would overwrite each other.' });
    });
    Object.keys(d.inodes).forEach((n) => {
      d.inodes[n].blocks.forEach((b) => { const t = d.data[b]; if (!t || t.file !== n || t.gen !== d.inodes[n].gen) v.push({ code: 'garbage', block: b, text: 'File ' + n + ' points at block D' + b + ' but the block holds ' + (t && t.gen === 0 ? 'stale data that was there before' : 'data of ' + (t ? 'file ' + t.file : 'nothing')) + ', not ' + n + '\'s data. Reading it returns garbage (possibly someone else\'s deleted data).' }); });
      if (!d.dir.includes(n)) v.push({ code: 'orphan', name: n, text: 'Inode ' + n + ' is in use but no directory entry names it: an orphan file nobody can open.' });
    });
    d.dir.forEach((n) => { if (!d.inodes[n]) v.push({ code: 'baddir', name: n, text: 'The directory lists ' + n + ' but its inode is empty or was never written: opening it reads garbage.' }); });
    return v;
  }

  // recover(disk): what the OS does at the next boot. Walk the journal: a transaction with a commit record is
  // REPLAYED (its logged blocks are copied to their home places); one without is DISCARDED. Then the log is cleared.
  function recover(pre) {
    const post = clone(pre), actions = [];
    pre.journal.forEach((t) => {
      if (t.committed) { t.blocks.forEach((b) => applyWrite(post, b.w)); actions.push({ tx: t.tx, replay: true, text: 'Transaction ' + t.tx + ' has a commit record, so REPLAY it: copy ' + (t.blocks.length ? t.blocks.map((b) => b.label).join('; ') : 'nothing') + ' to the home locations.' }); }
      else actions.push({ tx: t.tx, replay: false, text: 'Transaction ' + t.tx + ' has no commit record (the crash came before it was sealed), so DISCARD it. Its half-written log entries are ignored.' });
    });
    post.journal = [];
    if (!actions.length) actions.push({ tx: null, replay: false, text: 'The journal is empty: nothing to replay or discard.' });
    return { post, actions };
  }

  // crashAt(built, k): power fails right after step k. Returns the platter at the crash, the recovery, the final platter
  // and a verdict: corrupt (with the violated rules), or consistent as the OLD state (the operation in flight is lost)
  // or the NEW state (it survived), or "clean" when no operation was in flight.
  function crashAt(b, k) {
    const pre = b.states[k], rec = recover(pre), viol = check(rec.post);
    const done = b.opEnd.filter((e) => e <= k).length, start = done ? b.opEnd[done - 1] : 0, inFlight = done < b.plan.length && k > start;
    const logicalNow = logical(rec.post);
    let kind, text, survived = done;
    if (viol.length) { kind = 'corrupt'; text = 'INCONSISTENT after recovery: ' + viol.map((x) => x.code).filter((c, i, a) => a.indexOf(c) === i).join(', ') + '.'; }
    else if (sameLogical(logicalNow, b.plan.stateAfter(done))) {
      kind = inFlight ? 'old' : 'clean';
      text = inFlight ? 'Consistent: the interrupted operation "' + b.plan[done].text + '" is lost as a whole (old state).' : (done === 0 ? 'Nothing had happened yet: the empty disk.' : 'Consistent: every operation so far is complete.');
    } else if (done < b.plan.length && sameLogical(logicalNow, b.plan.stateAfter(done + 1))) { kind = 'new'; survived = done + 1; text = 'Consistent: the interrupted operation "' + b.plan[done].text + '" survived as a whole (new state).'; }
    else { kind = 'partial'; text = 'The structures are consistent, but they match no whole operation (a half-done operation).'; }
    return { k, pre, post: rec.post, actions: rec.actions, violations: viol, kind, text, opsSurvived: survived, inFlight, op: inFlight ? b.plan[done] : null };
  }

  // sweep(built): crash at EVERY possible point and classify each. This is the table that shows whether a protocol is safe.
  function sweep(b) {
    const points = b.states.map((_, k) => { const c = crashAt(b, k); return { k, kind: c.kind, codes: c.violations.map((v) => v.code).filter((x, i, a) => a.indexOf(x) === i), text: c.text }; });
    const bad = points.filter((p) => p.kind === 'corrupt' || p.kind === 'partial').length;
    return { points, bad, total: points.length };
  }

  // prepare(text, mode, orderId): parse + build + attach the logical states so crashAt can compare against them.
  function prepare(text, mode, orderId) {
    const p = parse(text);
    if (!p.ok) return { ok: false, errors: p.errors };
    const plan = p.plan; plan.stateAfter = (j) => p.states[j];
    const b = build(plan, mode, orderId);
    return { ok: true, errors: [], built: b, plan, states: p.states };
  }

  const PRESETS = [
    { id: 'append', name: 'Create a file and append two blocks', script: 'create A\nappend A 2', mode: 'none', order: 'data-first',
      note: 'The classic safe-looking order for plain writes (data, bitmap, inode, directory). Drag the step slider and look at the crash verdict at every point, then press "Crash at every point".' },
    { id: 'metafirst', name: 'Same script, metadata written first', script: 'create A\nappend A 2', mode: 'none', order: 'meta-first',
      note: 'Directory and inode go to disk before the data: a crash leaves names and pointers that lead to nothing. Compare with the data-first order.' },
    { id: 'reuse', name: 'Delete a file and reuse its blocks', script: 'create A\nappend A 2\ndelete A\ncreate B\nappend B 2', mode: 'writeback', order: 'data-first',
      note: 'B gets the blocks A just freed. If a crash lets the metadata commit but the new data never arrives, B reads A\'s old data. Switch to Ordered mode to see it fixed.' },
    { id: 'big', name: 'A bigger append', script: 'create A\nappend A 3\ncreate B\nappend B 1', mode: 'ordered', order: 'data-first',
      note: 'Try every mode. Only the journaling modes keep each operation all-or-nothing.' }
  ];

  const api = { LIMITS, MODES, BY_ID, ORDERS, PRESETS, parse, build, crashAt, sweep, recover, check, prepare, freshDisk, applyWrite, describe };
  NS.journal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
