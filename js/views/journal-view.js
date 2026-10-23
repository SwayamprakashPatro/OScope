/* Journaling view: a small disk (directory, inodes, bitmap, data blocks, journal), the list of block writes, and a
   crash analysis for the step you are looking at: "if the power fails RIGHT NOW, what do we find at boot?".
   The step slider IS the crash point. A strip of cells shows the verdict for every crash point of every protocol. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, colorFor, textOn, debounce } = NS.util;
  const J = NS.journal;
  const KEY = 'oslab.journal.v1';
  // What each verdict looks like (a symbol AND a word, never colour alone).
  const KIND = {
    clean: { sym: '✓', word: 'clean', cls: 'ok' }, old: { sym: '↶', word: 'old state', cls: 'ok' }, new: { sym: '✓', word: 'new state', cls: 'ok' },
    corrupt: { sym: '✗', word: 'corrupt', cls: 'bad' }, partial: { sym: '✗', word: 'half-done', cls: 'bad' }
  };

  // drawDisk(d, prev, opts): the platter as boxes. `prev` is the previous snapshot; whatever differs is outlined,
  // so each step shows exactly which block just changed.
  function drawDisk(d, prev, files) {
    const chg = (a, b) => !prev || JSON.stringify(a) !== JSON.stringify(b);
    const fcol = (f) => { const i = files.indexOf(f); return i < 0 ? null : colorFor(i); };
    const chip = (f) => { const c = fcol(f); return el('span', { class: 'jn-file', style: c ? { background: c, color: textOn(c) } : null }, f); };
    const dirBox = el('div', { class: 'jn-box' + (prev && chg(d.dir, prev.dir) ? ' changed' : '') }, el('h4', null, 'Directory block'), el('div', { class: 'jn-row' }, d.dir.length ? d.dir.map(chip) : el('span', { class: 'muted' }, 'empty')));
    const inoNames = Object.keys(d.inodes), prevNames = prev ? Object.keys(prev.inodes) : [];
    const inoBox = el('div', { class: 'jn-box' + (prev && chg(d.inodes, prev.inodes) ? ' changed' : '') }, el('h4', null, 'Inode blocks'),
      inoNames.length ? inoNames.map((n) => el('div', { class: 'jn-row' }, chip(n), el('span', { class: 'mono' }, '→ ' + (d.inodes[n].blocks.map((b) => 'D' + b).join(' ') || 'no blocks')))) : el('span', { class: 'muted' }, 'none in use'));
    void prevNames;
    const bmBox = el('div', { class: 'jn-box' + (prev && chg(d.bitmap, prev.bitmap) ? ' changed' : '') }, el('h4', null, 'Bitmap block (1 = allocated)'), el('div', { class: 'jn-bits mono' }, d.bitmap.map((b, k) => el('span', { class: b ? 'on' : '', title: 'D' + k + (b ? ' allocated' : ' free') }, b))));
    const cells = el('div', { class: 'jn-data' }, d.data.map((t, k) => {
      const c = t.gen ? fcol(t.file) : null;
      return el('div', { class: 'jn-cell' + (prev && chg(d.data[k], prev.data[k]) ? ' changed' : ''), style: c ? { background: c, color: textOn(c) } : null, title: t.gen ? 'D' + k + ' holds data of file ' + t.file : 'D' + k + ' holds stale data from before' },
        el('small', null, 'D' + k), el('b', null, t.gen ? t.file : '–'));
    }));
    const dataBox = el('div', { class: 'jn-box wide' }, el('h4', null, 'Data blocks'), cells, el('p', { class: 'note' }, '"–" means the block still holds old, stale content that no file wrote.'));
    const jBox = el('div', { class: 'jn-box wide jn-journal' + (prev && chg(d.journal, prev.journal) ? ' changed' : '') }, el('h4', null, 'Journal (log area)'),
      d.journal.length ? d.journal.map((t) => el('div', { class: 'jn-tx ' + (t.committed ? 'committed' : 'open') },
        el('b', null, 'Tx ' + t.tx), el('span', { class: 'jn-state' }, t.committed ? 'COMMITTED (sealed)' : 'open (no commit record yet)'),
        el('span', { class: 'jn-blocks' }, t.blocks.length ? t.blocks.map((b) => b.label).join('  ·  ') : 'begin record only'))) : el('span', { class: 'muted' }, 'empty'));
    return el('div', { class: 'jn-disk' }, el('div', { class: 'jn-top' }, dirBox, inoBox, bmBox), dataBox, jBox);
  }

  function mount(host) {
    let state = Object.assign({ mode: 'ordered', order: 'data-first', script: J.PRESETS[0].script }, store.get(KEY, {}));
    if (!J.BY_ID[state.mode]) state.mode = 'ordered';
    const save = () => store.set(KEY, state);
    let prep = null, sweeps = null, files = [];

    const view = el('section', { class: 'view', 'aria-labelledby': 'jn-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'jn-title' }, 'Journaling & crash recovery'),
      el('p', null, 'A disk writes one block at a time, and power can fail between any two writes. Step through the writes of a small file-system update, "pull the plug" at any step, and see what the machine finds at the next boot.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Write protocol' }, J.MODES.map((m) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.mode === m.id), dataset: { mode: m.id }, onclick: () => setMode(m.id) }, m.short)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const diskCard = el('div', { class: 'card' }), diskSlot = el('div'), playerHost = el('div'), stepList = el('ol', { class: 'jn-steps' });
    diskCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The disk after this write'), el('span', { class: 'sub', id: 'jn-sub' }, 'The step slider is the moment the power fails')), diskSlot, el('div', { style: { height: '12px' } }), playerHost);
    const stepCard = el('div', { class: 'card' });
    stepCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Block writes, in order'), el('span', { class: 'sub' }, 'Click a step to crash right after it')), stepList);
    const crashCard = el('div', { class: 'card' }), crashBody = el('div', { class: 'col', style: { gap: '10px' } });
    crashCard.append(el('div', { class: 'card-head' }, el('h3', null, 'If the power fails right now'), el('span', { class: 'sub' }, 'Recovery at the next boot')), crashBody);
    const sweepCard = el('div', { class: 'card' }), sweepBody = el('div', { class: 'col', style: { gap: '12px' } });
    sweepCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Crash at every point, in every protocol'), el('span', { class: 'sub' }, 'Same script, one cell per crash point')), sweepBody);
    colMain.append(aboutCard, diskCard, crashCard, stepCard, sweepCard);
    const player = new NS.Player(playerHost, { label: 'Write', onChange: (i) => draw(i) });

    function renderAbout() {
      const m = J.BY_ID[state.mode];
      aboutCard.replaceChildren(el('summary', null, m.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, m.rule), el('dt', null, 'Memory hook'), el('dd', null, m.hook), el('dt', null, 'Watch out for'), el('dd', null, m.watch)));
    }
    function setMode(id) {
      state.mode = id; save();
      chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === id)));
      renderAbout(); orderSel.disabled = id !== 'none'; recompute(true);
    }

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), J.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = J.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; state.script = p.script; state.order = p.order; state.mode = p.mode; presetNote.textContent = p.note; save(); renderFields(); setMode(p.mode); });
    const orderSel = el('select', { id: 'jn-order', onchange: (e) => { state.order = e.target.value; save(); recompute(false); } }, J.ORDERS.map((o) => el('option', { value: o.id, selected: state.order === o.id }, o.label)));
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your file-system script')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    const schedule = debounce(() => recompute(false), 250);
    function renderFields() {
      const box = el('textarea', { id: 'jn-script', rows: 8, spellcheck: 'false', class: 'jn-code', oninput: (e) => { state.script = e.target.value; save(); schedule(); } }); box.value = state.script;
      orderSel.value = state.order; orderSel.disabled = state.mode !== 'none';
      fieldsHost.replaceChildren(el('div', { class: 'field' }, el('label', { for: 'jn-script' }, 'Operations, one per line'), box, el('p', { class: 'hint' }, 'create A · append A 2 (give A two more blocks) · delete A. Up to 6 operations on a 16-block disk. Each operation is one transaction.')),
        el('div', { class: 'field' }, el('label', { for: 'jn-order' }, 'Write order (only for "No journal")'), orderSel, el('p', { class: 'hint' }, 'Journaling modes choose their own safe order, so this box is greyed out for them.')));
    }

    // recompute(keepPos): parse the script, build the writes of the chosen protocol, and run the crash sweep for ALL four protocols.
    function recompute(keepPos) {
      const r = J.prepare(state.script, state.mode, state.order);
      errBox.hidden = r.ok; errBox.replaceChildren(...(r.errors || []).map((m) => el('div', null, m)));
      if (!r.ok) return;
      prep = r; files = []; r.plan.forEach((p) => { if (p.op === 'create' && !files.includes(p.name)) files.push(p.name); });
      sweeps = J.MODES.map((m) => { const b = m.id === state.mode ? r.built : J.build(r.plan, m.id, state.order); return { m, b, s: J.sweep(b) }; });
      const T = r.built.states.length;
      player.setStops(r.built.states.map((_, i) => i), keepPos ? Math.min(player.pos, T - 1) : Math.min(player.pos, T - 1));
      renderSweep(); renderSteps();
    }
    // renderSteps(): the numbered list of block writes; the ones already on disk are ticked.
    function renderSteps() {
      const k = player.frame || 0, b = prep.built;
      stepList.replaceChildren(...[el('li', { class: 'jn-step' + (k === 0 ? ' now' : ''), onclick: () => player.seek(0) }, el('span', { class: 'jn-n' }, '0'), 'Start: empty disk. Crash here and nothing has happened yet.')].concat(b.steps.map((s, i) => el('li', { class: 'jn-step t-' + s.type + (i + 1 === k ? ' now' : '') + (i + 1 < k ? ' past' : ''), onclick: () => player.seek(i + 1) },
        el('span', { class: 'jn-n' }, i + 1), el('span', { class: 'jn-op' }, 'op ' + (s.op + 1)), s.text))));
      const now = stepList.querySelector('.now'); if (now && now.scrollIntoView && stepList.scrollHeight > stepList.clientHeight) { const top = now.offsetTop - stepList.offsetTop - 60; stepList.scrollTop = Math.max(0, top); }
    }
    // renderSweep(): one row per protocol, one cell per crash point. Clicking a cell jumps there (and switches protocol).
    function renderSweep() {
      const k = player.frame || 0;
      sweepBody.replaceChildren(el('div', { class: 'jn-legend key-legend' }, ['clean', 'old', 'new', 'corrupt'].map((x) => el('span', null, el('i', { class: 'jn-cellkey ' + KIND[x].cls }, KIND[x].sym), KIND[x].word + (x === 'old' ? ' (operation lost whole)' : x === 'new' ? ' (operation survived whole)' : x === 'clean' ? ' (nothing in flight)' : ' (breaks a rule)')))),
        ...sweeps.map(({ m, b, s }) => el('div', { class: 'jn-sweeprow' + (m.id === state.mode ? ' cur' : '') },
          el('div', { class: 'jn-sweephead' }, el('b', null, m.short), el('span', { class: s.bad ? 'text-bad' : 'text-good' }, s.bad + ' of ' + s.total + ' crash points corrupt')),
          el('div', { class: 'jn-strip' }, s.points.map((p) => { const kd = KIND[p.kind]; return el('button', { type: 'button', class: 'jn-pt ' + kd.cls + (m.id === state.mode && p.k === k ? ' now' : ''), title: 'Crash after write ' + p.k + ': ' + p.text, 'aria-label': m.short + ', crash after write ' + p.k + ': ' + kd.word, onclick: () => { if (m.id !== state.mode) { state.mode = m.id; save(); chips.querySelectorAll('.chip-btn').forEach((bb) => bb.setAttribute('aria-checked', String(bb.dataset.mode === m.id))); renderAbout(); orderSel.disabled = m.id !== 'none'; recompute(true); } player.seek(p.k); } }, kd.sym); })))),
        el('p', { class: 'note' }, 'Every cell is a real simulation: the writes up to that point are put on a disk, the power is cut, the journal is replayed or discarded, and a consistency check (fsck) inspects the result. The protocols differ in how many of their cells are red.'));
    }

    // draw(k): the platter after k writes, the crash verdict for crashing exactly here, and the current-step highlight.
    function draw(k) {
      if (!prep) return;
      const b = prep.built, c = J.crashAt(b, k), prev = k > 0 ? b.states[k - 1] : null;
      diskSlot.replaceChildren(drawDisk(b.states[k], prev, files));
      const sub = document.getElementById('jn-sub'); if (sub) sub.textContent = k === 0 ? 'Start: empty disk' : 'After write ' + k + ' of ' + b.steps.length + ' (outlined = just changed)';
      const kd = KIND[c.kind];
      const kids = [el('div', { class: 'callout ' + (kd.cls === 'ok' ? 'callout-good' : 'callout-bad') }, el('b', null, kd.sym + ' ' + c.text))];
      kids.push(el('div', null, el('b', null, '1. At boot the OS reads the journal'), el('ul', { class: 'jn-actions' }, c.actions.map((a) => el('li', { class: a.replay ? 'replay' : '' }, a.text)))));
      kids.push(el('div', null, el('b', null, '2. The consistency check inspects the result'),
        c.violations.length ? el('ul', { class: 'jn-viol' }, c.violations.map((v) => el('li', null, el('span', { class: 'jn-code-tag' }, v.code), v.text)))
          : el('p', { class: 'text-good' }, '✓ Every rule holds: allocated blocks are used, used blocks are allocated, every file has the right data, directory and inodes agree.')));
      kids.push(el('details', null, el('summary', null, 'Show the disk after recovery'), drawDisk(c.post, b.states[k], files)));
      crashBody.replaceChildren(...kids);
      renderSteps(); renderSweep();
    }

    renderAbout(); renderFields(); recompute(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.journal = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
