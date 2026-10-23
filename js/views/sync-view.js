/* Synchronization view: threads with program listings, shared state (vars, semaphores, mutexes, buffer),
   a scheduler you control (manual / random / round-robin), a swimlane trace, and exhaustive interleaving explorer. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, colorFor, textOn, debounce } = NS.util;
  const S = NS.sync;
  const KEY = 'oslab.sync.v1';

  // mount(host): build the Synchronization screen and return { activate, deactivate } for app.js.
  // Two tabs: 'Run one schedule' (threads, shared state, scheduler controls, trace) and 'Explore every
  // interleaving' (the exhaustive explorer). The right panel holds the declarations and the program text.
  function mount(host) {
    // fromPreset(p): turn an example into editable state; `picks` is the list of manual scheduling choices.
    const fromPreset = (p) => ({ vars: p.vars, sems: p.sems, muts: p.muts, conds: p.conds || '', mon: p.mon || 'mesa', cap: String(p.cap), expect: p.expect, prog: p.prog, picks: [] });
    // State: declarations, program text, scheduler mode (manual / random / round-robin), seed, time slice, tab.
    let state = Object.assign(fromPreset(S.PRESETS[0]), { mode: 'manual', seed: 1, quantum: 1, tab: 'run' }, store.get(KEY, {}));
    if (!Array.isArray(state.picks)) state.picks = [];
    const save = () => store.set(KEY, state);
    // prog = parsed threads, decl = parsed declarations, sim = the last run result (frames + outcome).
    let prog = null, decl = null, sim = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'sy-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'sy-title' }, 'Synchronization'),
      el('p', null, 'Threads share data. The scheduler decides who runs next, and it can switch at any instruction. Choose the interleaving yourself, or let the explorer try them all, and watch races and deadlocks appear.')));
    // Tabs: run a single schedule, or explore all of them.
    const tabRun = el('button', { type: 'button', role: 'tab', onclick: () => setTab('run') }, 'Run one schedule');
    const tabExp = el('button', { type: 'button', role: 'tab', onclick: () => setTab('exp') }, 'Explore every interleaving');
    view.appendChild(el('div', { class: 'tabs', role: 'tablist' }, tabRun, tabExp));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    // The 'about' card: rule, memory hook and what to watch out for.
    const aboutCard = el('details', { class: 'card about', open: true }, el('summary', null, 'Why synchronization is hard'),
      el('dl', null,
        el('dt', null, 'The rule'), el('dd', null, 'A thread can be paused between any two instructions. So "X = X + 1" (load, add, store) can interleave with another thread\'s copy. Locks (mutex) and semaphores make sure only the right threads proceed.'),
        el('dt', null, 'Memory hook'), el('dd', null, 'Semaphore: wait = "take a ticket or queue", signal = "return a ticket (and wake the first in line)". Mutex = a key held by exactly one thread.'),
        el('dt', null, 'Watch out for'), el('dd', null, 'A program that passes a hundred runs can still be wrong. Only exploring all interleavings proves it. Also: the order of wait and lock matters as much as having them.')));
    const runHost = el('div', { class: 'col' }), expHost = el('div', { class: 'col' });
    colMain.append(aboutCard, runHost, expHost);

    /* ----- run tab ----- */
    const ctlCard = el('div', { class: 'card' }), ctlBody = el('div', { class: 'col', style: { gap: '10px' } });
    ctlCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Scheduler'), el('span', { class: 'sub' }, 'Who runs the next instruction?')), ctlBody);
    const stateCard = el('div', { class: 'card' }), threadsSlot = el('div', { class: 'sy-threads' }), sharedSlot = el('div', { class: 'sy-shared' }), playerHost = el('div');
    stateCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Threads and shared state'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), threadsSlot, sharedSlot, el('div', { style: { height: '12px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const traceCard = el('div', { class: 'card' }), traceSlot = el('div', { class: 'tbl-wrap sy-trace' });
    traceCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Interleaving trace'), el('span', { class: 'sub' }, 'One row per instruction, one column per thread')), traceSlot);
    const verdictCard = el('div', { class: 'card' });
    runHost.append(ctlCard, stateCard, whyCard, verdictCard, traceCard);
    // Shared playback bar; each step is one instruction of the chosen schedule.
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    /* ----- explore tab ----- */
    const expCard = el('div', { class: 'card' }), expBody = el('div', { class: 'col', style: { gap: '10px' } });
    expCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Every possible outcome'), el('span', { class: 'sub' }, 'Tries all schedules, merging identical states')), expBody);
    expHost.appendChild(expCard);

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), S.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    // Loading an example only fills the inputs. Everything that happens afterwards comes from running the program.
    presetSel.addEventListener('change', () => { const p = S.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; save(); renderFields(); recompute(); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your program')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    // Changing the program resets the manual picks, because the old schedule may no longer be valid.
    const schedule = debounce(() => { state.picks = []; recompute(); }, 250);
    // renderFields(): variable / semaphore / mutex / buffer declarations and the program textarea (monospaced).
    function renderFields() {
      const txt = (key, label, hint, id) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'text', id, value: state[key], spellcheck: 'false', oninput: (e) => { state[key] = e.target.value; save(); schedule(); } }), hint ? el('p', { class: 'hint' }, hint) : null);
      const progBox = el('textarea', { id: 'sy-prog', rows: 18, spellcheck: 'false', class: 'sy-code', oninput: (e) => { state.prog = e.target.value; save(); schedule(); } }); progBox.value = state.prog;
      fieldsHost.replaceChildren(
        txt('vars', 'Shared variables', 'NAME=value, for example X=0', 'sy-vars'),
        txt('sems', 'Semaphores', 'NAME=starting value, for example empty=2', 'sy-sems'),
        txt('muts', 'Mutexes', 'names only, for example M, F0', 'sy-muts'),
        txt('conds', 'Condition variables (monitors)', 'names only, for example notEmpty', 'sy-conds'),
        el('div', { class: 'field' }, el('label', { for: 'sy-mon' }, 'Signal rules for condition variables'),
          el('select', { id: 'sy-mon', onchange: (e) => { state.mon = e.target.value; save(); schedule2(); } },
            el('option', { value: 'mesa', selected: state.mon !== 'hoare' }, 'Mesa: signaller keeps running, sleeper re-checks'),
            el('option', { value: 'hoare', selected: state.mon === 'hoare' }, 'Hoare: sleeper runs at once, signaller steps aside')),
          el('p', { class: 'hint' }, 'Only matters for cwait / csignal. Real systems (Java, pthreads) use Mesa, which is why a woken thread must re-check its condition in a while loop.')),
        el('div', { class: 'grid2' }, txt('cap', 'Buffer size (0 = none)', null, 'sy-cap'), txt('expect', 'Expected result', 'for example X=2', 'sy-exp')),
        el('div', { class: 'field' }, el('label', { for: 'sy-prog' }, 'Threads and their programs'), progBox,
          el('p', { class: 'hint' }, 'thread NAME [xN repeats]. Instructions: load r X, add r 1, store X r, set X 0, inc X, dec X, wait S, signal S, lock M, unlock M, put, get, enter/leave cs|read|write, if X == 1 (next line runs only if true), goto LABEL (with NAME: lines) makes loops, several if lines in a row mean AND, cwait C M / csignal C / cbroadcast C for monitors, work label.')));
    }

    // recompute(): parse declarations and program (line-numbered errors), then run the chosen scheduler.
    // If a manual pick turns out to be impossible, the engine stops at it and the picks list is trimmed.
    function recompute() {
      const d = S.parseDecls({ vars: state.vars, sems: state.sems, muts: state.muts, conds: state.conds, mon: state.mon, cap: state.cap, expect: state.expect });
      const g = d.errors.length ? { errors: [], threads: [] } : S.parseProgram(state.prog, d.decl);
      const errs = d.errors.concat(g.errors);
      errBox.hidden = !errs.length; errBox.replaceChildren(...errs.map((m) => el('div', null, m)));
      if (errs.length) { sim = null; return; }
      prog = g.threads; decl = d.decl;
      const sched = { mode: state.mode, seed: Number(state.seed) || 1, quantum: Number(state.quantum) || 1, picks: state.picks };
      sim = S.run(prog, decl, sched);
      if (state.mode === 'manual' && sim.error) { state.picks = sim.picks.slice(); save(); }
      renderControls(); renderExplore(null);
      player.setStops(sim.frames.map((_, i) => i), state.mode === 'manual' ? sim.frames.length - 1 : Math.min(player.pos, sim.frames.length - 1));
    }

    // renderControls(): the scheduler panel. Manual shows one button per thread (disabled when blocked or done,
    // with the reason in the tooltip); Random has a seed; Round-robin has a time slice.
    function renderControls() {
      const modes = [['manual', 'You choose'], ['random', 'Random'], ['rr', 'Round-robin']];
      const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Scheduler type' }, modes.map(([id, l]) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.mode === id), onclick: () => { state.mode = id; state.picks = state.mode === 'manual' ? [] : state.picks; save(); recompute(); } }, l)));
      const kids = [chips];
      if (state.mode === 'manual') {
        const last = sim.frames[sim.frames.length - 1].st, rs = S.runnable(last), over = !!sim.term;
        kids.push(el('p', { class: 'hint' }, over ? 'The run has ended. Undo a pick or clear to try another interleaving.' : 'Click a thread to run its next instruction. Switch threads at the worst moment to provoke a bug.'));
        kids.push(el('div', { class: 'sy-picks' }, prog.map((t, i) => el('button', { type: 'button', class: 'btn sy-pick', disabled: over || !rs.includes(i), title: last.threads[i].state === 'blocked' ? t.id + ' is blocked on ' + last.threads[i].on : last.threads[i].state === 'done' ? t.id + ' has finished' : 'Run ' + t.id, style: { borderLeft: '6px solid ' + colorFor(i) },
          onclick: () => { state.picks.push(t.id); save(); recompute(); } }, 'Run ' + t.id, el('small', null, last.threads[i].state === 'blocked' ? 'blocked on ' + last.threads[i].on : last.threads[i].state === 'done' ? 'done' : (prog[i].code[last.threads[i].pc] || {}).text || '')))));
        kids.push(el('div', { class: 'row-inline' }, el('button', { type: 'button', class: 'btn', disabled: !state.picks.length, onclick: () => { state.picks.pop(); save(); recompute(); } }, 'Undo last pick'), el('button', { type: 'button', class: 'btn', disabled: !state.picks.length, onclick: () => { state.picks = []; save(); recompute(); } }, 'Clear'), el('span', { class: 'muted mono' }, state.picks.length ? 'Schedule: ' + state.picks.join(' ') : 'No picks yet')));
      } else if (state.mode === 'random') {
        kids.push(el('div', { class: 'row-inline' }, el('div', { class: 'field' }, el('label', { for: 'sy-seed' }, 'Seed'), el('input', { type: 'number', id: 'sy-seed', value: state.seed, oninput: (e) => { state.seed = e.target.value; save(); schedule2(); } })),
          el('button', { type: 'button', class: 'btn', onclick: () => { state.seed = (Number(state.seed) || 1) + 1; save(); renderControls(); recompute(); } }, 'Try the next seed')), el('p', { class: 'hint' }, 'The same seed always replays the same interleaving. Try a few seeds to see different outcomes.'));
      } else {
        kids.push(el('div', { class: 'field' }, el('label', { for: 'sy-q' }, 'Time slice (instructions before switching thread)'), el('input', { type: 'number', min: 1, id: 'sy-q', value: state.quantum, oninput: (e) => { state.quantum = e.target.value; save(); schedule2(); } })), el('p', { class: 'hint' }, 'A slice of 1 switches after every instruction, the harshest test. A large slice runs threads one after another.'));
      }
      if (sim.error) kids.push(el('div', { class: 'errors' }, el('div', null, sim.error)));
      ctlBody.replaceChildren(...kids);
    }
    // Debounce for the seed / time-slice inputs (these keep the manual picks).
    const schedule2 = debounce(() => recompute(), 250);

    // draw(i): show the machine after instruction i: each thread's program with a pointer at its next
    // instruction, private registers and status (ready / blocked on X / done); the shared tiles (variables,
    // semaphores with their queues, mutex owners, buffer slots, regions); the explanation; the swimlane trace;
    // and the outcome of the whole run.
    function draw(i) {
      if (!sim) return;
      const f = sim.frames[i], st = f.st, ev = f.ev;
      threadsSlot.replaceChildren(...prog.map((t, ti) => {
        const th = st.threads[ti], fill = colorFor(ti);
        // A ready thread sitting on `spin L` while L is held is busy-waiting: ready, but wasting its steps.
        const cur = t.code[th.pc], spinning = th.state === 'ready' && cur && cur.op === 'spin' && st.vars[cur.x] !== 0;
        const status = th.state === 'done' ? 'done' : th.state === 'blocked' ? 'blocked on ' + th.on : spinning ? 'spinning on ' + cur.x : 'ready';
        const lines = t.code.map((c, k) => el('li', { class: (k === th.pc && th.state !== 'done' ? 'is-pc ' : '') + (ev && ev.ti === ti && ev.pc === k ? 'is-ran' : '') }, el('i', null, k === th.pc && th.state !== 'done' ? '▶' : ''), c.text));
        const regs = Object.keys(th.regs).map((r) => r + '=' + th.regs[r]).join('  ');
        return el('div', { class: 'sy-thread st-' + th.state + (ev && ev.ti === ti ? ' is-now' : '') },
          el('div', { class: 'sy-th-head' }, el('span', { class: 'sy-th-name', style: { background: fill, color: textOn(fill) } }, t.id), el('span', { class: 'sy-status' }, status), t.rounds > 1 ? el('span', { class: 'muted' }, 'round ' + (t.rounds - th.left + (th.state === 'done' ? 0 : 1)) + '/' + t.rounds) : null),
          el('ol', { class: 'sy-lines' }, lines), el('div', { class: 'sy-regs mono' }, regs ? 'private: ' + regs : 'private registers: none yet'));
      }));
      // tile(): one box in the shared-state area.
      const tile = (label, body, cls) => el('div', { class: 'sy-tile ' + (cls || '') }, el('span', null, label), body);
      const chip = (ti) => el('span', { class: 'qchip', style: { background: colorFor(ti), color: textOn(colorFor(ti)) } }, prog[ti].id);
      const tiles = [];
      Object.keys(st.vars).forEach((k) => tiles.push(tile('variable ' + k, el('b', { class: 'mono sy-big' }, st.vars[k]))));
      Object.keys(st.sems).forEach((k) => tiles.push(tile('semaphore ' + k, el('div', null, el('b', { class: 'mono sy-big' }, st.sems[k].v), el('div', { class: 'sy-q' }, st.sems[k].q.length ? ['queue: ', ...st.sems[k].q.map(chip)] : 'queue empty')))));
      Object.keys(st.muts).forEach((k) => tiles.push(tile('mutex ' + k, el('div', null, st.muts[k].owner != null ? el('b', { class: 'sy-owner' }, 'held by ', chip(st.muts[k].owner)) : el('b', { class: 'sy-free' }, 'free'), el('div', { class: 'sy-q' }, st.muts[k].q.length ? ['waiting: ', ...st.muts[k].q.map(chip)] : 'no waiters'), st.muts[k].urg.length ? el('div', { class: 'sy-q' }, ['urgent (stepped aside): ', ...st.muts[k].urg.map(chip)]) : null))));
      Object.keys(st.conds).forEach((k) => tiles.push(tile('condition ' + k, el('div', { class: 'sy-q' }, st.conds[k].q.length ? ['asleep: ', ...st.conds[k].q.map((w) => chip(w.ti))] : 'nobody asleep'))));
      if (st.buf.cap) tiles.push(tile('buffer', el('div', null, el('div', { class: 'sy-slots' }, Array.from({ length: st.buf.cap }, (_, k) => el('i', { class: k < st.buf.count ? 'full' : '' }))), el('div', { class: 'sy-q' }, st.buf.count + ' of ' + st.buf.cap + ' slots used'))));
      const occ = ['cs', 'read', 'write'].filter((t) => st.occ[t].length);
      if (occ.length || /enter /.test(state.prog)) tiles.push(tile('regions', el('div', { class: 'sy-q' }, occ.length ? occ.map((t) => el('div', null, t + ': ', ...st.occ[t].map(chip))) : 'nobody inside'), (st.violation && st.violation.kind === 'exclusion') ? 'bad' : ''));
      sharedSlot.replaceChildren(...tiles);
      const kids = [el('p', { class: 'muted' }, i === 0 ? 'Before any instruction' : 'Instruction ' + i + ' of ' + (sim.frames.length - 1)), el('p', null, f.text)];
      if (ev && ev.spin) kids.push(el('div', { class: 'callout' }, ev.id + ' is spinning: it is still ready, so the scheduler may pick it again, and every such step is CPU time wasted. A blocked thread would use none.'));
      if (ev && ev.loop) kids.push(el('div', { class: 'callout' }, ev.id + ' jumped back up: it is looping (busy-waiting). It stays READY, so the scheduler can pick it again and each pass is CPU time spent for nothing. Correct software locks (Peterson, Dekker, bakery) rely on such loops.'));
      if (ev && ev.lost) kids.push(el('div', { class: 'callout callout-bad' }, 'Lost signal: nobody was asleep, so nothing happened. Unlike a semaphore, a condition variable remembers nothing.'));
      if (ev && ev.blocked) kids.push(el('div', { class: 'callout' }, ev.id + ' cannot continue, so the scheduler must pick someone else. A blocked thread uses no CPU.'));
      whyBody.replaceChildren(...kids);
      // Swimlane trace: one row per executed instruction, one column per thread, blocked steps marked.
      // trace
      const head = el('tr', null, el('th', null, '#'), prog.map((t, ti) => el('th', null, el('span', { class: 'sy-dot', style: { background: colorFor(ti) } }), t.id)));
      const rows = sim.frames.slice(1, i + 1).map((fr, k) => el('tr', { class: (k === i - 1 ? 'now ' : '') + (fr.ev.blocked || fr.ev.spin ? 'blk' : '') }, el('td', { class: 'muted' }, k + 1), prog.map((t, ti) => el('td', { class: 'sy-cell' }, fr.ev.ti === ti ? (fr.ev.text + (fr.ev.blocked ? '  ⏸ blocked' : '')) : ''))));
      traceSlot.replaceChildren(el('table', { class: 'tbl sy-tbl' }, el('thead', null, head), el('tbody', null, rows.length ? rows : el('tr', null, el('td', { colspan: prog.length + 1, class: 'muted' }, 'No instructions run yet.')))));
      // Outcome of the full run: finished normally / deadlock (who waits on what) / violation message.
      // verdict
      const last = i === sim.frames.length - 1, term = sim.term;
      const fin = sim.frames[sim.frames.length - 1].st;
      let box;
      if (!term) box = el('p', { class: 'note' }, state.mode === 'manual' ? 'Still running. Keep picking threads until every thread finishes, or something goes wrong.' : sim.status === 'limit' ? 'Stopped after ' + S.LIMITS.maxSteps + ' steps. If the threads are looping, press Explore to find out whether the program can ever finish.' : 'Still running.');
      else if (term.kind === 'done') box = el('div', { class: 'callout callout-good' }, 'Finished normally. Final shared values: ' + (Object.keys(fin.vars).map((k) => k + '=' + fin.vars[k]).join(', ') || 'none') + (Object.keys(decl.expect).length ? ' (matches the expected result).' : '.'));
      else if (term.kind === 'deadlock') box = el('div', { class: 'callout callout-bad' }, 'DEADLOCK. ' + term.waits.map((w) => w.id + ' waits on ' + w.on + (w.holder ? ' (held by ' + w.holder + ')' : '')).join('; ') + '. No thread can ever run again.');
      else box = el('div', { class: 'callout callout-bad' }, term.v.msg);
      verdictCard.replaceChildren(el('div', { class: 'card-head' }, el('h3', null, 'Outcome of this schedule'), last ? null : el('span', { class: 'sub' }, 'Shown for the full run')), box,
        ...(sim.picks.length ? [el('p', { class: 'hint mono', style: { marginTop: '8px' } }, 'Schedule: ' + sim.picks.join(' '))] : []));
    }

    // renderExplore(): the explorer tab. Runs S.explore() on demand and lists every distinct outcome (bad ones
    // first) with the shortest schedule that produces it and a Replay button that loads that schedule into
    // the manual scheduler.
    function renderExplore(result) {
      const kids = [el('p', null, 'The explorer runs every possible choice of "who goes next", merging states it has already seen, and lists each distinct way the program can end. Bad outcomes come first, with the shortest schedule that causes them.'),
        el('div', { class: 'row-inline' }, el('button', { type: 'button', class: 'btn primary', disabled: !sim, onclick: () => { renderExplore({ busy: true }); setTimeout(() => { renderExplore(S.explore(prog, decl)); }, 20); } }, 'Explore all interleavings'))];
      if (result && result.busy) kids.push(el('p', { class: 'muted' }, 'Exploring…'));
      else if (result) {
        const bad = result.outcomes.filter((o) => o.bad).length;
        kids.push(el('div', { class: 'stats' }, el('div', { class: 'stat' }, el('span', null, 'States visited'), el('b', null, result.states + (result.truncated ? '+' : ''))), el('div', { class: 'stat' }, el('span', null, 'Distinct outcomes'), el('b', null, result.outcomes.length)), el('div', { class: 'stat' }, el('span', null, 'Bad outcomes'), el('b', { class: bad ? 'text-bad' : 'text-good' }, bad))));
        if (result.truncated) kids.push(el('div', { class: 'callout' }, 'The search stopped at ' + S.LIMITS.maxStates + ' states, so this list may be incomplete. Shorten the programs or repeat counts.'));
        kids.push(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl sy-out' }, el('thead', null, el('tr', null, ['Outcome', 'Shortest schedule that causes it', ''].map((h) => el('th', null, h)))),
          el('tbody', null, result.outcomes.map((o) => el('tr', { class: o.bad ? 'bad' : '' }, el('td', null, (o.bad ? '⚠ ' : '✓ ') + o.label + (o.kind === 'stuck' ? ' (' + o.hits + ' such states)' : '')), el('td', { class: 'mono' }, o.path.join(' ') || '(none)'), el('td', null, el('button', { type: 'button', class: 'btn', onclick: () => { state.mode = 'manual'; state.picks = o.path.slice(); save(); setTab('run'); recompute(); } }, 'Replay'))))))));
        kids.push(el('p', { class: 'note' }, bad ? 'At least one bad ending is reachable. Even if random runs usually look fine, this program is not correct.' : 'Every possible interleaving ends well, so the synchronization is correct for this input.'));
      }
      expBody.replaceChildren(...kids);
    }

    // setTab(): switch between running one schedule and exploring all of them.
    function setTab(t) {
      state.tab = t; save(); const run = t === 'run';
      runHost.hidden = !run; expHost.hidden = run;
      tabRun.setAttribute('aria-selected', String(run)); tabExp.setAttribute('aria-selected', String(!run));
    }

    renderFields(); setTab(state.tab === 'exp' ? 'exp' : 'run'); recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.sync = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
