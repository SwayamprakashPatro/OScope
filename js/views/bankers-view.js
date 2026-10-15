/* Banker's algorithm view: editable matrices, stepped safety algorithm, resource-request checker. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, colorFor, debounce, clamp } = NS.util;
  const B = NS.bankers;
  const KEY = 'oslab.bankers.v1';
  // L(j): resource letter, 0 -> A, 1 -> B, ...
  const L = (j) => String.fromCharCode(65 + j);
  // Matrices are kept as strings in the UI state so a half-typed or empty cell does not break an input.
  const toStr = (m) => m.map((r) => r.map(String));

  // mount(host): build the Banker's screen and return { activate, deactivate } for app.js.
  // Left: the safety algorithm animation (Work vector, table with Need / Finish), explanation, verdict, and
  // the resource-request checker. Right: the editable system (matrices, Available or Total, scan order).
  function mount(host) {
    // fromPreset(p): turn an example into editable state.
    const fromPreset = (p) => ({ n: p.alloc.length, m: p.alloc[0].length, mode: p.mode, alloc: toStr(p.alloc), max: toStr(p.max), avail: p.avail.map(String), total: (p.total || p.avail.map(() => 0)).map(String), pick: p.pick, reqP: p.req.p, reqV: p.req.v.map(String) });
    let state = Object.assign(fromPreset(B.PRESETS[0]), store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    // sim = { avail, need, sf (safety result), seqs (safe-sequence count) } for the current valid input.
    let sim = null;

    const view = el('section', { class: 'view', 'aria-labelledby': 'bk-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'bk-title' }, 'Banker’s Algorithm'),
      el('p', null, 'Deadlock avoidance. Before granting resources, the OS asks: "If I say yes, can everyone still finish in some order?" If not, the request waits.')));
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    colMain.appendChild(el('details', { class: 'card about', open: true }, el('summary', null, 'How the Banker’s algorithm works'),
      el('dl', null,
        el('dt', null, 'The rule'), el('dd', null, 'Need = Max − Allocation. Start with Work = Available. Find an unfinished process whose Need ≤ Work. Pretend it finishes and add its Allocation back to Work. Repeat. If everyone finishes, the state is safe.'),
        el('dt', null, 'Memory hook'), el('dd', null, 'Bank loans: the banker only lends if every customer could still be paid off in some order. Work grows as customers repay.'),
        el('dt', null, 'Watch out for'), el('dd', null, 'Safe is a guarantee, not a prediction. Unsafe does not mean deadlock has happened, only that it can no longer be ruled out. Several safe sequences can exist, and your textbook may scan in a different order.'))));

    const safetyCard = el('div', { class: 'card' }), workBox = el('div', { class: 'bk-work' }), tableSlot = el('div', { class: 'tbl-wrap' }), seqBox = el('div', { class: 'bk-seq' });
    const playerHost = el('div');
    safetyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Safety algorithm'), el('span', { class: 'sub' }, 'Arrow keys step, Space plays')), workBox, tableSlot, seqBox, el('div', { style: { height: '12px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const resCard = el('div', { class: 'card' });
    const reqCard = el('div', { class: 'card' }), reqBody = el('div', { class: 'col', style: { gap: '10px' } });
    reqCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Resource request'), el('span', { class: 'sub' }, 'Ask the banker for more')), reqBody);
    colMain.append(safetyCard, whyCard, resCard, reqCard);
    // Shared playback bar; each step is one stage of the safety algorithm.
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    /* ---------- side panel ---------- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), B.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = B.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; state = Object.assign(state, fromPreset(p)); presetNote.textContent = p.note; save(); renderFields(); recompute(); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
    colSide.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your system')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
    const schedule = debounce(() => recompute(), 200);

    // resize(): when the number of processes or resources changes, resize every matrix, keeping existing values.
    function resize() {
      const n = clamp(parseInt(state.n, 10) || 1, 1, B.LIMITS.maxProcs), m = clamp(parseInt(state.m, 10) || 1, 1, B.LIMITS.maxRes);
      const fit = (mat) => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => (mat[i] && mat[i][j] != null ? mat[i][j] : '0')));
      const fit1 = (v) => Array.from({ length: m }, (_, j) => (v[j] != null ? v[j] : '0'));
      state.n = n; state.m = m; state.alloc = fit(state.alloc); state.max = fit(state.max); state.avail = fit1(state.avail); state.total = fit1(state.total); state.reqV = fit1(state.reqV); state.reqP = clamp(state.reqP, 0, n - 1);
    }
    // matrixInput(): an editable matrix (rows = processes, columns = resources A, B, C ...).
    function matrixInput(label, mat, id) {
      const head = el('tr', null, el('th', null, ''), Array.from({ length: state.m }, (_, j) => el('th', { scope: 'col' }, L(j))));
      const rows = mat.map((r, i) => el('tr', null, el('th', { scope: 'row' }, 'P' + i), r.map((v, j) => el('td', null, el('input', { type: 'number', min: 0, inputmode: 'numeric', value: v, 'aria-label': label + ' P' + i + ' resource ' + L(j), oninput: (e) => { mat[i][j] = e.target.value; save(); schedule(); } })))));
      return el('div', { class: 'field' }, el('div', { class: 'flabel' }, label), el('table', { class: 'ptable bk-in' }, el('thead', null, head), el('tbody', null, rows)));
    }
    // vecInput(): an editable one-row vector (Available or Total).
    function vecInput(label, v, hint) {
      return el('div', { class: 'field' }, el('div', { class: 'flabel' }, label), el('table', { class: 'ptable bk-in' }, el('thead', null, el('tr', null, v.map((_, j) => el('th', { scope: 'col' }, L(j))))),
        el('tbody', null, el('tr', null, v.map((x, j) => el('td', null, el('input', { type: 'number', min: 0, value: x, 'aria-label': label + ' resource ' + L(j), oninput: (e) => { v[j] = e.target.value; save(); schedule(); } })))))), hint ? el('p', { class: 'hint' }, hint) : null);
    }
    // renderFields(): the whole input panel; rebuilt only when the matrix shape changes (so typing never loses focus).
    function renderFields() {
      resize();
      fieldsHost.replaceChildren(
        el('div', { class: 'grid2' },
          el('div', { class: 'field' }, el('label', { for: 'bk-n' }, 'Processes (1 to ' + B.LIMITS.maxProcs + ')'), el('input', { type: 'number', id: 'bk-n', min: 1, max: B.LIMITS.maxProcs, value: state.n, onchange: (e) => { state.n = e.target.value; save(); renderFields(); recompute(); } })),
          el('div', { class: 'field' }, el('label', { for: 'bk-m' }, 'Resource types (1 to ' + B.LIMITS.maxRes + ')'), el('input', { type: 'number', id: 'bk-m', min: 1, max: B.LIMITS.maxRes, value: state.m, onchange: (e) => { state.m = e.target.value; save(); renderFields(); recompute(); } }))),
        matrixInput('Allocation (held now)', state.alloc), matrixInput('Max (most it may ever need)', state.max),
        el('div', { class: 'field' }, el('label', { for: 'bk-mode' }, 'You know'), el('select', { id: 'bk-mode', onchange: (e) => { state.mode = e.target.value; save(); renderFields(); recompute(); } },
          el('option', { value: 'avail', selected: state.mode === 'avail' }, 'Available (free right now)'), el('option', { value: 'total', selected: state.mode === 'total' }, 'Total instances (Available is computed)'))),
        state.mode === 'avail' ? vecInput('Available', state.avail) : vecInput('Total instances', state.total, 'Available = Total − sum of Allocation.'),
        el('div', { class: 'field' }, el('label', { for: 'bk-pick' }, 'When several processes could run next'), el('select', { id: 'bk-pick', onchange: (e) => { state.pick = e.target.value; save(); recompute(); } },
          el('option', { value: 'cyclic', selected: state.pick === 'cyclic' }, 'Keep scanning after the last pick (textbook)'), el('option', { value: 'lowest', selected: state.pick === 'lowest' }, 'Restart at P0 each time'), el('option', { value: 'highest', selected: state.pick === 'highest' }, 'Take the highest index')),
          el('p', { class: 'hint' }, 'Changes the order, never whether the state is safe.')));
    }

    // currentInput(): convert the typed strings to numbers; an empty cell becomes NaN so validation reports it.
    function currentInput() {
      const num = (x) => (String(x).trim() === '' ? NaN : Number(x));
      return { mode: state.mode, alloc: state.alloc.map((r) => r.map(num)), max: state.max.map((r) => r.map(num)), avail: state.avail.map(num), total: state.total.map(num) };
    }
    // inp = the numeric input last read from the form.
    let inp = null;
    // recompute(): validate, then compute Available, Need, the safety run and the number of safe sequences.
    function recompute() {
      inp = currentInput();
      const v = B.validate(inp);
      errBox.hidden = v.ok; errBox.replaceChildren(...v.errors.map((m) => el('div', null, m)));
      if (!v.ok) { sim = null; return; }
      const avail = B.availOf(inp), need = B.needOf(inp.alloc, inp.max);
      const sf = B.safety(inp.alloc, need, avail, state.pick);
      sim = { avail, need, sf, seqs: B.countSequences(inp.alloc, need, avail) };
      renderRequest(null);
      player.setStops(sf.frames.map((_, i) => i), Math.min(player.pos, sf.frames.length - 1));
    }

    // draw(i): show one stage of the safety algorithm: the Work vector, a table where finished processes fade,
    // the candidate row is highlighted and each unfinished process shows whether Need <= Work, and the
    // safe sequence found so far. The verdict card shows safe / unsafe and how many safe sequences exist.
    function draw(i) {
      if (!sim) return;
      const f = sim.sf.frames[i], { need } = sim, a = inp.alloc, mx = inp.max, n = a.length, m = a[0].length;
      workBox.replaceChildren(el('span', { class: 'bk-wl' }, 'Work'), el('div', { class: 'bk-vec' }, f.work.map((x, j) => el('span', { class: 'bk-cell' }, el('i', null, L(j)), el('b', null, x)))),
        el('span', { class: 'bk-wl muted' }, f.kind === 'start' ? '= Available' : ''));
      // checks[i] = did process i pass 'Need <= Work' in this stage.
      const checks = {}; (f.checks || []).forEach((c) => { checks[c.i] = c.ok; });
      const head = el('tr', null, el('th', null, 'Process'), el('th', { colspan: m }, 'Allocation'), el('th', { colspan: m }, 'Max'), el('th', { colspan: m }, 'Need'), el('th', null, 'Need ≤ Work?'), el('th', null, 'Finish'));
      const sub = el('tr', { class: 'bk-sub' }, el('th', null, ''), [0, 1, 2].map(() => Array.from({ length: m }, (_, j) => el('th', null, L(j)))), el('th', null, ''), el('th', null, ''));
      const rows = Array.from({ length: n }, (_, p) => {
        const done = f.finish[p], isPick = f.chosen === p || f.done === p;
        const fill = colorFor(p);
        const verdict = done ? el('span', { class: 'bk-done' }, '—') : (p in checks ? el('span', { class: checks[p] ? 'text-good' : 'text-bad' }, checks[p] ? '✓ yes' : '✗ no') : el('span', { class: 'muted' }, ''));
        return el('tr', { class: (done ? 'is-done ' : '') + (isPick ? 'is-pick' : '') },
          el('th', { scope: 'row' }, el('span', { class: 'bk-dot', style: { background: fill } }), 'P' + p), a[p].map((x) => el('td', null, x)), mx[p].map((x) => el('td', null, x)), need[p].map((x) => el('td', { class: 'bk-need' }, x)), el('td', null, verdict), el('td', null, done ? el('b', { class: 'text-good' }, 'T') : 'F'));
      });
      tableSlot.replaceChildren(el('table', { class: 'tbl bk-tbl' }, el('thead', null, head, sub), el('tbody', null, rows)));
      seqBox.replaceChildren(el('span', { class: 'bk-wl' }, 'Safe sequence so far'), ...(f.seq.length ? f.seq.map((p, k) => el('span', { class: 'qitem' }, el('span', { class: 'qchip', style: { background: colorFor(p), color: NS.util.textOn(colorFor(p)) } }, 'P' + p), k < f.seq.length - 1 ? el('i', null, '→') : null)) : [el('em', { class: 'muted' }, 'none yet')]));
      whyBody.replaceChildren(...[el('p', { class: 'muted' }, 'Step ' + i + ' of ' + (sim.sf.frames.length - 1)), el('p', null, f.text), f.kind === 'end' ? el('div', { class: 'callout ' + (f.safe ? 'callout-good' : 'callout-bad') }, f.safe ? 'SAFE state' : 'UNSAFE state') : null].filter(Boolean));
      const sc = sim.seqs;
      resCard.replaceChildren(el('div', { class: 'card-head' }, el('h3', null, 'Verdict')),
        el('div', { class: 'stats' }, el('div', { class: 'stat' }, el('span', null, 'State'), el('b', { class: sim.sf.safe ? 'text-good' : 'text-bad' }, sim.sf.safe ? 'Safe' : 'Unsafe')),
          el('div', { class: 'stat' }, el('span', null, 'Safe sequences'), el('b', null, sc.count + (sc.truncated ? '+' : ''))),
          el('div', { class: 'stat' }, el('span', null, 'Available'), el('b', { class: 'mono' }, B.vec(sim.avail)))),
        sc.count ? el('p', { class: 'note', style: { marginTop: '10px' } }, 'Other safe orders exist, for example ' + sc.samples.slice(0, 4).map((s) => '<' + s.map((x) => 'P' + x).join(', ') + '>').join('  ') + (sc.count > 4 ? ' …' : '') + '. Any one proves safety.')
          : el('p', { class: 'note', style: { marginTop: '10px' } }, 'No ordering lets every process finish, so no safe sequence exists.'));
    }

    /* ---------- resource request ---------- */
    // lastReq = result of the last request check (kept so the panel can be redrawn).
    let lastReq = null;
    // renderRequest(): the request checker. Pick a process and a request vector, press Check, and it shows the
    // four steps (Request <= Need? Request <= Available? pretend grant, safety run) and the outcome.
    function renderRequest(result) {
      lastReq = result;
      const sel = el('select', { id: 'bk-rp', 'aria-label': 'Requesting process', onchange: (e) => { state.reqP = +e.target.value; save(); renderRequest(null); } },
        Array.from({ length: state.n }, (_, p) => el('option', { value: p, selected: p === state.reqP }, 'P' + p)));
      const inputs = el('div', { class: 'bk-reqv' }, state.reqV.map((x, j) => el('label', { class: 'field' }, el('span', { class: 'flabel' }, L(j)), el('input', { type: 'number', min: 0, value: x, oninput: (e) => { state.reqV[j] = e.target.value; save(); } }))));
      const kids = [el('div', { class: 'row-inline' }, el('div', { class: 'field' }, el('label', { for: 'bk-rp' }, 'Process'), sel), inputs,
        el('button', { type: 'button', class: 'btn primary', onclick: () => {
          const r = B.request(inp, state.reqP, state.reqV.map((x) => (String(x).trim() === '' ? NaN : Number(x))), state.pick);
          renderRequest(r);
        } }, 'Check this request'))];
      if (result) {
        if (result.error) kids.push(el('div', { class: 'errors' }, el('div', null, result.error)));
        else {
          kids.push(el('ol', { class: 'bk-steps' }, result.steps.map((s) => el('li', { class: s.ok ? '' : 'bad' }, s.text))));
          kids.push(el('div', { class: 'callout ' + (result.outcome === 'grant' ? 'callout-good' : 'callout-bad') }, result.text));
          // A granted request can be applied: allocation and available are updated, so you can chain several requests.
          if (result.outcome === 'grant') kids.push(el('button', { type: 'button', class: 'btn', onclick: () => {
            const p = result.pretend; state.alloc = toStr(p.alloc); state.avail = p.avail.map(String);
            if (state.mode === 'total') { /* total unchanged; Available follows from Allocation */ }
            state.reqV = state.reqV.map(() => '0'); save(); renderFields(); recompute();
          } }, 'Apply the grant to the system'));
        }
      }
      reqBody.replaceChildren(...kids);
    }

    renderFields(); recompute();
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.bankers = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
