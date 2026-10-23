/* Buffer overflow view: one stack frame drawn byte by byte (low addresses at the bottom, the stack grows down),
   a copy that fills it, the function return, and a table of how each defence changes the outcome for the SAME input.
   An abstract teaching model: no machine code, only named toy functions. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util;
  const O = NS.overflow;
  const KEY = 'oslab.overflow.v1';
  const REGION_CLASS = { buf: 'r-buf', auth: 'r-auth', pad: 'r-pad', canary: 'r-canary', fp: 'r-fp', ret: 'r-ret', caller: 'r-caller' };
  const OUTCOME = {
    normal: ['ok', 'returns normally'], rejected: ['ok', 'input rejected'], hijack: ['bad', 'hijacked to secret_admin'], 'hijack-valid': ['bad', 'jumps to another function'],
    canary: ['ok', 'canary aborts the program'], nx: ['ok', 'blocked by NX'], 'stack-exec': ['bad', 'would run stack data'], segv: ['warn', 'crash (bad address)'],
    'aslr-miss': ['warn', 'crash (ASLR miss)'], 'segv-copy': ['warn', 'crash during the copy']
  };

  function mount(host) {
    let state = Object.assign({ preset: 'hijack', input: O.PRESETS[3].input, mode: O.PRESETS[3].mode }, O.PRESETS[3].cfg, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    let sim = null;
    const cfgOf = () => ({ buf: state.buf, copy: state.copy, canary: state.canary, nx: state.nx, aslr: state.aslr, seed: state.seed });

    const view = el('section', { class: 'view', 'aria-labelledby': 'bo-title' });
    view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'bo-title' }, 'Buffer overflow & stack smashing'),
      el('p', null, 'A function copies your input into a small buffer. What happens when the input is longer than the buffer? Watch the bytes climb the stack frame, then switch the defences on one at a time. This is a toy model with made-up addresses; it contains no real code.')));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Copy routine' }, O.COPIES.map((c) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.copy === c.id), dataset: { copy: c.id }, onclick: () => { state.copy = c.id; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.copy === c.id))); renderAbout(); recompute(true); } }, c.short)));
    view.appendChild(chips);
    const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
    ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

    const aboutCard = el('details', { class: 'card about', open: true });
    const stackCard = el('div', { class: 'card' }), stackSlot = el('div'), legend = el('div', { class: 'key-legend' }), playerHost = el('div');
    stackCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The stack frame of vuln()'), el('span', { class: 'sub', id: 'bo-sub' }, 'Higher addresses at the top; the copy climbs upward')), stackSlot, legend, el('div', { style: { height: '12px' } }), playerHost);
    const whyCard = el('div', { class: 'card' }), whyBody = el('div', { class: 'why' });
    whyCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Why did that happen?')), whyBody);
    const distCard = el('div', { class: 'card' }), distBody = el('div');
    distCard.append(el('div', { class: 'card-head' }, el('h3', null, 'How far is each target?'), el('span', { class: 'sub' }, 'Computed from the frame layout')), distBody);
    const defCard = el('div', { class: 'card' }), defBody = el('div');
    defCard.append(el('div', { class: 'card-head' }, el('h3', null, 'The same input under every defence'), el('span', { class: 'sub' }, 'Each row is a real run')), defBody);
    colMain.append(aboutCard, stackCard, whyCard, distCard, defCard);
    const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

    function renderAbout() {
      const c = O.COPY_BY_ID[state.copy];
      aboutCard.replaceChildren(el('summary', null, c.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, c.rule), el('dt', null, 'Memory hook'), el('dd', null, c.hook), el('dt', null, 'Watch out for'), el('dd', null, c.watch)));
    }

    /* ----- side panel ----- */
    const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), O.PRESETS.map((p) => el('option', { value: p.id }, p.name)));
    const presetNote = el('p', { class: 'hint' });
    presetSel.addEventListener('change', () => { const p = O.PRESETS.find((x) => x.id === presetSel.value); if (!p) return; Object.assign(state, p.cfg, { input: p.input, mode: p.mode }); presetNote.textContent = p.note; save(); chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.copy === state.copy))); renderAbout(); renderFields(); recompute(false); });
    const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' }), helperHost = el('div');
    colSide.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your input and defences')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Address book of the toy program')), helperHost));
    const schedule = debounce(() => recompute(false), 250);
    function renderFields() {
      const box = el('textarea', { id: 'bo-input', rows: 4, spellcheck: 'false', class: 'bo-code', oninput: (e) => { state.input = e.target.value; save(); schedule(); } }); box.value = state.input;
      const chk = (key, id, label) => el('label', { class: 'bo-check' }, el('input', { type: 'checkbox', id, checked: !!state[key], onchange: (e) => { state[key] = e.target.checked; save(); recompute(true); } }), ' ' + label);
      fieldsHost.replaceChildren(
        el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Input is'), el('div', { class: 'seg' }, ['text', 'hex'].map((m) => el('button', { type: 'button', 'aria-pressed': String(state.mode === m), onclick: (e) => { state.mode = m; save(); renderFields(); recompute(false); } }, m === 'text' ? 'Text' : 'Hex bytes')))),
        el('div', { class: 'field' }, el('label', { for: 'bo-input' }, state.mode === 'text' ? 'Input text (each character is one byte)' : 'Input bytes in hex, separated by spaces'), box,
          el('p', { class: 'hint' }, state.mode === 'text' ? 'Try a short word, then a long one. Up to 64 bytes.' : 'Two hex digits per byte, for example 41 41 A9 13. Addresses are stored low byte first (A9 13 means 0x13A9).')),
        el('div', { class: 'grid2' },
          el('div', { class: 'field' }, el('label', { for: 'bo-buf' }, 'Buffer size (' + O.LIMITS.minBuf + '-' + O.LIMITS.maxBuf + ' bytes)'), el('input', { type: 'number', id: 'bo-buf', min: O.LIMITS.minBuf, max: O.LIMITS.maxBuf, value: state.buf, oninput: (e) => { state.buf = e.target.value; save(); schedule(); } })),
          el('div', { class: 'field' }, el('label', { for: 'bo-seed' }, 'Seed (canary and ASLR)'), el('input', { type: 'number', id: 'bo-seed', value: state.seed, oninput: (e) => { state.seed = e.target.value; save(); schedule(); } }))),
        el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Defences'), el('div', { class: 'bo-checks' }, chk('canary', 'bo-canary', 'Stack canary'), chk('nx', 'bo-nx', 'NX (stack is not executable)'), chk('aslr', 'bo-aslr', 'ASLR (random load address)'))));
    }

    // recompute(keep): parse the input, run the frame, and run it again under each defence for the comparison table.
    function recompute(keep) {
      const p = O.parseInput(state.input, state.mode);
      const r = p.ok ? O.run(cfgOf(), p.bytes) : { ok: false, errors: [] };
      const errs = p.errors.concat(r.errors || []);
      errBox.hidden = !errs.length; errBox.replaceChildren(...errs.map((m) => el('div', null, m)));
      if (!p.ok || !r.ok) return;
      sim = r; renderAbout(); renderHelper(); renderDist(); renderDefences(p.bytes);
      player.setStops(r.frames.map((_, i) => i), keep ? Math.min(player.pos, r.frames.length - 1) : 0);
    }

    // renderHelper(): the toy program's functions, their real addresses this run, and the bytes that spell them.
    function renderHelper() {
      const f = sim.funcs;
      helperHost.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl bo-addr' }, el('thead', null, el('tr', null, ['Function', 'In file', 'This run', 'Bytes'].map((h) => el('th', null, h)))),
        el('tbody', null, f.list.map((x) => el('tr', null, el('td', null, x.name), el('td', null, O.hex(x.addr)), el('td', null, O.hex(x.real)), el('td', null, O.addrBytes(x.real).map(O.hex2).join(' ')))))),
      ), el('p', { class: 'note', style: { marginTop: '8px' } }, 'The stack segment is ' + O.hex(O.STACK_LO) + '-' + O.hex(O.STACK_HI) + ' (buf[0] is at ' + O.hex(O.STACK_BASE) + '). Without ASLR the two columns match; with ASLR a person reading the program file would only know the first one.'));
    }
    function renderDist() {
      const d = sim.distances, c = sim.cfg;
      const row = (label, work, n) => el('tr', null, el('td', null, label), el('td', { class: 'bo-work' }, work), el('td', null, el('b', null, n)));
      distBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl bo-dist' }, el('thead', null, el('tr', null, ['The first byte of the…', 'is reached after', 'bytes'].map((h) => el('th', null, h)))),
        el('tbody', null, row('auth flag', c.buf + ' (buffer)', d.toAuth), c.canary ? row('canary', c.buf + ' + 1 (flag) + 1 (padding)', d.toCanary) : null, row('return address', c.buf + ' + 1 + 1' + (c.canary ? ' + 2 (canary)' : '') + ' + 2 (saved FP)', d.toRet)))),
      el('p', { class: 'note', style: { marginTop: '8px' } }, 'Input length: ' + sim.input.length + ' bytes. With the unchecked copy the terminating zero is written too, so the copy writes ' + (sim.input.indexOf(0) >= 0 ? sim.input.indexOf(0) + 1 : sim.input.length + 1) + ' bytes in this run' + (state.copy === 'strcpy' ? '.' : ' (the chosen routine limits that).')));
    }
    // renderDefences(): re-run the same bytes under every combination of defences, to see what each one buys.
    function renderDefences(bytes) {
      const base = cfgOf(), rows = [['No defences', { copy: 'strcpy', canary: false, nx: false, aslr: false }], ['Canary only', { copy: 'strcpy', canary: true, nx: false, aslr: false }], ['NX only', { copy: 'strcpy', canary: false, nx: true, aslr: false }],
        ['ASLR only', { copy: 'strcpy', canary: false, nx: false, aslr: true }], ['Canary + NX + ASLR', { copy: 'strcpy', canary: true, nx: true, aslr: true }], ['Bounded copy (strncpy), nothing else', { copy: 'strncpy', canary: false, nx: false, aslr: false }], ['Checked copy, nothing else', { copy: 'checked', canary: false, nx: false, aslr: false }]];
      defBody.replaceChildren(el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl bo-def' }, el('thead', null, el('tr', null, ['Setting', 'Outcome', 'Admin flag changed?'].map((h) => el('th', null, h)))),
        el('tbody', null, rows.map(([name, o]) => { const r = O.run(Object.assign({}, base, o), bytes); const [cls, word] = OUTCOME[r.result.kind] || ['warn', r.result.kind]; return el('tr', null, el('td', null, name), el('td', { class: 'bo-' + cls }, (cls === 'ok' ? '✓ ' : cls === 'bad' ? '✗ ' : '! ') + word), el('td', null, r.result.authGranted ? 'yes' : 'no')); })))),
      el('p', { class: 'note', style: { marginTop: '8px' } }, 'The canary catches a linear overwrite of the return address. NX stops running injected data but not jumping to code that already exists. ASLR hides addresses but is bypassed if one leaks. Bounded or checked copying removes the bug itself, which is why it is the real fix; the others only make the bug harder to use.'));
    }

    // draw(i): the frame's bytes, region by region, highest address first, with the byte just written outlined.
    function draw(i) {
      if (!sim) return;
      const f = sim.frames[i], L = sim.layout, prev = i > 0 ? sim.frames[i - 1].mem : null;
      const regions = L.regions.slice().reverse();
      stackSlot.replaceChildren(el('div', { class: 'bo-stack' }, regions.map((r) => {
        const cells = [];
        for (let k = 0; k < r.len; k++) {
          const off = r.off + k, v = f.mem[off], touched = f.touched.includes(off), changed = prev && prev[off] !== v;
          cells.push(el('div', { class: 'bo-cell ' + REGION_CLASS[r.id] + (touched ? ' touched' : '') + (changed ? ' changed' : '') + (f.focus === off ? ' focus' : ''), title: O.hex(O.STACK_BASE + off) + (v == null ? ' (not written yet)' : ' = ' + O.hex2(v)) },
            el('small', null, (r.id === 'buf' ? '[' + k + ']' : r.id === 'caller' ? '' : '+' + k)), el('b', null, v == null ? '??' : O.hex2(v)), el('span', null, v == null ? '' : O.ch(v))));
        }
        return el('div', { class: 'bo-region ' + REGION_CLASS[r.id] }, el('div', { class: 'bo-rhead' }, el('b', null, r.label), el('span', { class: 'mono muted' }, O.hex(r.addr) + (r.len > 1 ? '–' + O.hex(r.addr + r.len - 1) : ''))), el('div', { class: 'bo-cells' }, cells));
      })));
      legend.replaceChildren(...['buf', 'auth', 'canary', 'fp', 'ret'].filter((k) => k !== 'canary' || sim.cfg.canary).map((k) => el('span', null, el('i', { class: 'bo-sw ' + REGION_CLASS[k] }), { buf: 'buffer', auth: 'auth flag', canary: 'canary', fp: 'saved frame pointer', ret: 'return address' }[k])).concat([el('span', null, 'outlined = just written')]));
      const sub = document.getElementById('bo-sub'); if (sub) sub.textContent = f.written ? 'Byte ' + f.written + ' of the copy' : 'Higher addresses at the top; the copy climbs upward';
      const kids = [el('p', { class: 'muted' }, 'Step ' + i + ' of ' + (sim.frames.length - 1)), f.kind === 'end' ? null : el('p', null, f.text)];
      if (f.kind === 'end') { const res = f.result, [cls] = OUTCOME[res.kind] || ['warn']; kids.push(el('div', { class: 'callout ' + (cls === 'ok' ? 'callout-good' : cls === 'bad' ? 'callout-bad' : '') }, el('b', null, res.text), res.authGranted ? el('div', null, 'Also: the auth flag was overwritten, so administrator access was granted.') : null)); }
      whyBody.replaceChildren(...kids.filter(Boolean));
    }

    renderAbout(); renderFields(); recompute(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }

  NS.views = NS.views || {};
  NS.views.overflow = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
