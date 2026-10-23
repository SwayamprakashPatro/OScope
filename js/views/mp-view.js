/* Generic distributed-systems view (Tier 4). One view serves every message-passing protocol: it draws a
   SPACE-TIME DIAGRAM (one horizontal line per node, time running left to right, a slanted arrow per message),
   the state of each node at the current step, and the protocol's own report (metrics, checks, tables).
   Which protocol is shown comes from the lab: NS.views[id] = mount for that protocol in NS.mp.protocols[id]. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, svg, store, debounce, colorFor, clamp } = NS.util;
  const SVGNS = 'http://www.w3.org/2000/svg';

  function makeMount(pid) {
    return function mount(host) {
      const MP = NS.mp, P = MP.protocols[pid], KEY = 'oslab.mp.' + pid + '.v1';
      const p0 = P.presets[0];
      let state = Object.assign({ cfg: Object.assign({}, P.defaults, p0.cfg), text: p0.text }, store.get(KEY, {}));
      state.cfg = Object.assign({}, P.defaults, state.cfg);
      const save = () => store.set(KEY, state);
      let res = null;

      const view = el('section', { class: 'view', 'aria-labelledby': 'mp-title-' + pid });
      view.appendChild(el('div', { class: 'view-head' }, el('h2', { id: 'mp-title-' + pid }, P.name), el('p', null, P.intro)));
      const chipParam = (P.params || []).find((q) => q.type === 'select' && q.chips);
      let chips = null;
      if (chipParam) {
        chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': chipParam.label }, chipParam.options.map((o) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.cfg[chipParam.key] === o.id), dataset: { v: o.id }, onclick: () => { state.cfg[chipParam.key] = o.id; save(); paintChips(); recompute(false); } }, o.short || o.name)));
        view.appendChild(chips);
      }
      const paintChips = () => { if (chips) chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state.cfg[chipParam.key]))); };
      const ws = el('div', { class: 'workspace' }), colMain = el('div', { class: 'col' }), colSide = el('div', { class: 'col problem' });
      ws.append(colMain, colSide); view.appendChild(ws); host.appendChild(view);

      const aboutCard = el('details', { class: 'card about', open: true });
      const diagCard = el('div', { class: 'card' }), diagSlot = el('div', { class: 'mp-scroll' }), legend = el('div', { class: 'key-legend' }), playerHost = el('div'), whyBox = el('div', { class: 'why mp-why' });
      diagCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Space-time diagram'), el('span', { class: 'sub', id: 'mp-sub-' + pid }, 'Time runs left to right')), diagSlot, legend, el('div', { style: { height: '10px' } }), playerHost, whyBox);
      const nodesCard = el('div', { class: 'card' }), nodesBody = el('div', { class: 'mp-nodes' });
      nodesCard.append(el('div', { class: 'card-head' }, el('h3', null, 'What each node knows right now')), nodesBody);
      const repCard = el('div', { class: 'card' }), repBody = el('div');
      repCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Results and checks'), el('span', { class: 'sub' }, 'Computed from the whole run')), repBody);
      colMain.append(aboutCard, diagCard, nodesCard, repCard);
      const player = new NS.Player(playerHost, { label: 'Step', onChange: (i) => draw(i) });

      function renderAbout() {
        const variant = chipParam ? chipParam.options.find((o) => o.id === state.cfg[chipParam.key]) : null;
        const a = variant && variant.about ? variant.about : P.about;
        aboutCard.replaceChildren(el('summary', null, variant ? variant.name : P.name), el('dl', null, el('dt', null, 'The rule'), el('dd', null, a.rule), el('dt', null, 'Watch out for'), el('dd', null, a.watch), el('dt', null, 'Memory hook'), el('dd', null, (variant && variant.hook) || P.hook)));
      }

      /* ----- side panel: preset, scenario text, parameters ----- */
      const presetSel = el('select', { 'aria-label': 'Load an example' }, el('option', { value: '' }, 'Load an example…'), P.presets.map((p) => el('option', { value: p.id }, p.name)));
      const presetNote = el('p', { class: 'hint' });
      presetSel.addEventListener('change', () => { const p = P.presets.find((x) => x.id === presetSel.value); if (!p) return; state.cfg = Object.assign({}, P.defaults, p.cfg); state.text = p.text; presetNote.textContent = p.note || ''; save(); paintChips(); renderFields(); recompute(false); });
      const fieldsHost = el('div', { class: 'col', style: { gap: '12px' } }), errBox = el('div', { class: 'errors', hidden: true, role: 'alert' });
      colSide.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your scenario')), el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, presetSel, presetNote), fieldsHost, errBox)));
      const schedule = debounce(() => recompute(false), 250);
      function renderFields() {
        const num = (key, id, label, lo, hi, hint) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: lo, max: hi, value: state.cfg[key], oninput: (e) => { state.cfg[key] = e.target.value === '' ? '' : +e.target.value; save(); schedule(); } }), hint ? el('p', { class: 'hint' }, hint) : null);
        const box = el('textarea', { id: 'mp-text-' + pid, rows: 9, spellcheck: 'false', class: 'mp-code', oninput: (e) => { state.text = e.target.value; save(); schedule(); } }); box.value = state.text;
        const kids = [el('div', { class: 'field' }, el('label', { for: 'mp-text-' + pid }, 'Steps, one per line: TIME NODE STEP'), box, el('p', { class: 'hint' }, P.grammar + ' "#" starts a comment.'))];
        const grid = [];
        if ((P.minN || 2) < (P.maxN || 6)) grid.push(num('n', 'mp-n-' + pid, 'Nodes (' + (P.minN || 2) + '-' + (P.maxN || 6) + ')', P.minN || 2, P.maxN || 6));
        grid.push(num('seed', 'mp-seed-' + pid, 'Seed', 0, 2147483647));
        kids.push(el('div', { class: 'grid2' }, grid));
        kids.push(el('div', { class: 'grid2' }, num('dmin', 'mp-dmin-' + pid, 'Fastest message delay', 1, 30), num('dmax', 'mp-dmax-' + pid, 'Slowest message delay', 1, 30)));
        if (P.usesLoss) kids.push(num('loss', 'mp-loss-' + pid, 'Messages lost (%)', 0, 60, 'Each message is dropped by the network with this chance (seeded).'));
        for (const q of P.params || []) {
          if (q.chips) continue;
          if (q.type === 'number') kids.push(num(q.key, 'mp-' + q.key + '-' + pid, q.label, q.min, q.max, q.hint));
          else if (q.type === 'select') kids.push(el('div', { class: 'field' }, el('label', { for: 'mp-' + q.key + '-' + pid }, q.label), el('select', { id: 'mp-' + q.key + '-' + pid, onchange: (e) => { state.cfg[q.key] = e.target.value; save(); recompute(true); } }, q.options.map((o) => el('option', { value: o.id, selected: state.cfg[q.key] === o.id }, o.name))), q.hint ? el('p', { class: 'hint' }, q.hint) : null));
          else if (q.type === 'checkbox') kids.push(el('label', { class: 'mp-check' }, el('input', { type: 'checkbox', checked: !!state.cfg[q.key], onchange: (e) => { state.cfg[q.key] = e.target.checked; save(); recompute(true); } }), ' ' + q.label));
        }
        fieldsHost.replaceChildren(...kids);
      }

      function recompute(keep) {
        const r = MP.run(P, state.cfg, state.text);
        errBox.hidden = !(r.errors && r.errors.length); errBox.replaceChildren(...(r.errors || []).map((m) => el('div', null, m)));
        if (!r.ok) return;
        res = r; renderAbout(); renderReport(); buildLegend();
        player.setStops(r.frames.map((_, i) => i), keep ? Math.min(player.pos, r.frames.length - 1) : 0);
      }

      function buildLegend() {
        const items = [['dot local', 'internal event'], ['dot send', 'a send'], ['dot recv', 'a receive'], ['dot timer', 'timer fires'], ['dot crash', 'crash'], ['dot drop', 'message dropped'], ['band cut', 'cut off']];
        legend.replaceChildren(...items.map(([c, t]) => el('span', null, el('i', { class: 'mp-sw ' + c }), t)), el('span', null, 'faded = not happened yet'));
      }

      /* ----- the diagram ----- */
      function niceStep(span) { for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (span / s <= 14) return s; return 1000; }
      function draw(i) {
        if (!res) return;
        const f = res.frames[i], n = res.cfg.n, laneH = 56, top = 24, left = 40, right = 56;
        const T = Math.max(6, ...res.events.map((e) => e.t)) + 1, unit = clamp(640 / T, 22, 64), W = left + T * unit + right, H = top + n * laneH + 24;
        const X = (t) => left + t * unit, Y = (nd) => top + nd * laneH + laneH / 2;
        const g = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'mp-svg', role: 'img', 'aria-label': 'Space-time diagram of ' + n + ' nodes' });
        g.appendChild(svg('defs', null, svg('marker', { id: 'mp-arr-' + pid, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10z', fill: 'context-stroke' }))));
        // down intervals (crash .. recover) shaded on the node's line
        res.names.forEach((nm, nd) => {
          g.appendChild(svg('text', { x: 8, y: Y(nd) + 5, class: 'mp-lane-label' }, nm));
          g.appendChild(svg('line', { x1: left - 6, x2: W - right, y1: Y(nd), y2: Y(nd), class: 'mp-lane' }));
          // shaded bands: red while the node is down (crash..recover), amber while it is cut off (cut..heal)
          [['crash', 'recover', 'mp-down'], ['cut', 'heal', 'mp-cut']].forEach(([a, b, cls]) => {
            let from = null;
            res.events.filter((e) => e.node === nd).forEach((e) => { if (e.kind === a && from == null) from = e; else if (e.kind === b && from != null) { g.appendChild(svg('rect', { x: X(from.t), y: Y(nd) - 11, width: Math.max(2, X(e.t) - X(from.t)), height: 22, class: cls + (e.frame > i ? ' future' : '') })); from = null; } });
            if (from != null) g.appendChild(svg('rect', { x: X(from.t), y: Y(nd) - 11, width: Math.max(2, W - right - X(from.t)), height: 22, class: cls + (from.frame > i ? ' future' : '') }));
          });
        });
        const step = niceStep(T);
        for (let t = 0; t <= T; t += step) { g.appendChild(svg('line', { x1: X(t), x2: X(t), y1: top - 6, y2: H - 20, class: 'mp-grid' })); g.appendChild(svg('text', { x: X(t), y: H - 6, class: 'mp-tick', 'text-anchor': 'middle' }, String(t))); }
        const types = [...new Set(res.msgs.map((m) => m.type))];
        // messages
        res.msgs.forEach((m) => {
          if (m.recvT == null) return;
          const x1 = X(m.sendT), y1 = Y(m.from), x2 = X(m.recvT), y2 = Y(m.to), col = m.status === 'delivered' ? colorFor(types.indexOf(m.type)) : 'var(--fault)';
          const future = m.sendFrame > i, arrived = m.recvFrame <= i;
          const ln = svg('line', { x1, y1, x2, y2, class: 'mp-msg' + (future ? ' future' : '') + (!future && !arrived ? ' flying' : '') + (m.status !== 'delivered' ? ' lost' : ''), stroke: col, 'marker-end': 'url(#mp-arr-' + pid + ')' });
          ln.appendChild(svg('title', null, m.type + ' ' + res.names[m.from] + ' → ' + res.names[m.to] + ', sent t=' + m.sendT + ', ' + (m.status === 'delivered' ? 'arrives' : m.status) + ' t=' + m.recvT));
          g.appendChild(ln);
          if (res.msgs.length <= 9 && x2 - x1 > 50) g.appendChild(svg('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 4, class: 'mp-mlabel' + (future ? ' future' : ''), 'text-anchor': 'middle' }, m.type));
        });
        // events
        res.events.forEach((e) => {
          const x = X(e.t), y = Y(e.node), future = e.frame > i, cls = 'mp-ev ' + e.kind + (future ? ' future' : '') + (e.id === f.event ? ' now' : '');
          const grp = svg('g', { class: cls });
          grp.appendChild(svg('title', null, e.label + ' (' + e.kind + ') at t=' + e.t + (e.tag ? ': ' + e.tag : '')));
          if (e.kind === 'crash') grp.appendChild(svg('path', { d: 'M' + (x - 6) + ' ' + (y - 6) + 'L' + (x + 6) + ' ' + (y + 6) + 'M' + (x + 6) + ' ' + (y - 6) + 'L' + (x - 6) + ' ' + (y + 6), class: 'mp-x' }));
          else if (e.kind === 'drop') grp.appendChild(svg('path', { d: 'M' + (x - 4) + ' ' + (y - 4) + 'L' + (x + 4) + ' ' + (y + 4) + 'M' + (x + 4) + ' ' + (y - 4) + 'L' + (x - 4) + ' ' + (y + 4), class: 'mp-x drop' }));
          else if (e.kind === 'timer') grp.appendChild(svg('rect', { x: x - 4.5, y: y - 4.5, width: 9, height: 9, class: 'mp-dot' }));
          else grp.appendChild(svg('circle', { cx: x, cy: y, r: 5, class: 'mp-dot' }));
          if (e.id === f.event) grp.appendChild(svg('circle', { cx: x, cy: y, r: 10, class: 'mp-ring' }));
          grp.appendChild(svg('text', { x, y: y - 11, class: 'mp-elabel', 'text-anchor': 'middle' }, e.label));
          if (e.tag) grp.appendChild(svg('text', { x, y: y + 20, class: 'mp-tag', 'text-anchor': 'middle' }, e.tag));
          g.appendChild(grp);
        });
        diagSlot.replaceChildren(g);
        // long runs scroll sideways at a readable scale; keep the current event in view
        if (f.event >= 0 && res.events[f.event]) diagSlot.scrollLeft = Math.max(0, X(res.events[f.event].t) - diagSlot.clientWidth / 2);
        const sub = document.getElementById('mp-sub-' + pid); if (sub) sub.textContent = i ? 'Step ' + i + ' of ' + (res.frames.length - 1) + ' · t = ' + f.t : 'Time runs left to right';
        whyBox.replaceChildren(el('p', null, f.text));
        nodesBody.replaceChildren(...f.states.map((s, nd) => el('div', { class: 'mp-node' + (s.down ? ' down' : s.cut ? ' cut' : '') + (f.node === nd ? ' now' : '') }, el('div', { class: 'mp-nhead' }, el('b', null, res.names[nd]), s.down ? el('span', { class: 'mp-badge bad' }, 'DOWN') : s.cut ? el('span', { class: 'mp-badge bad' }, 'CUT OFF') : (s.badge ? el('span', { class: 'mp-badge' }, s.badge) : null)), (s.lines || []).map((l) => el('div', { class: 'mp-nline' }, l)))));
        if (f.inflight.length) nodesBody.appendChild(el('div', { class: 'mp-flight' }, el('b', null, 'In flight: '), f.inflight.map((m) => m.type + ' ' + res.names[m.from] + '→' + res.names[m.to]).join(', ')));
      }

      function renderReport() {
        const R = res.report, kids = [];
        if (R.metrics && R.metrics.length) kids.push(el('div', { class: 'mp-metrics' }, R.metrics.map(([k, v]) => el('div', null, el('small', null, k), el('b', null, String(v))))));
        if (R.checks && R.checks.length) kids.push(el('ul', { class: 'mp-checks' }, R.checks.map((c) => el('li', { class: c.ok ? 'ok' : 'bad' }, el('b', null, c.ok ? '✓ ' : '✗ '), c.text))));
        if (R.pair && R.pair.events.length > 1) {
          const sa = el('select', { 'aria-label': 'First event' }, R.pair.events.map((e) => el('option', { value: e.id }, e.text))), sb = el('select', { 'aria-label': 'Second event' }, R.pair.events.map((e, k) => el('option', { value: e.id, selected: k === Math.min(1, R.pair.events.length - 1) }, e.text))), out = el('div', { class: 'mp-pairout' });
          const upd = () => { const lines = R.pair.compare(+sa.value, +sb.value); out.replaceChildren(...(lines || []).map((l, k) => el('p', { class: k === 0 ? 'mp-pairhead' : '' }, l))); };
          sa.addEventListener('change', upd); sb.addEventListener('change', upd); upd();
          kids.push(el('div', { class: 'mp-pair' }, el('h4', null, 'Compare two events'), el('div', { class: 'grid2' }, sa, sb), out));
        }
        (R.tables || []).forEach((t) => kids.push(el('div', null, el('h4', { style: { margin: '14px 0 6px' } }, t.title), el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl mp-tbl' }, el('thead', null, el('tr', null, t.head.map((h) => el('th', null, h)))), el('tbody', null, t.rows.map((r) => el('tr', null, r.map((c) => el('td', null, String(c)))))))))));
        if (R.note) kids.push(el('p', { class: 'note', style: { marginTop: '10px' } }, R.note));
        repBody.replaceChildren(...kids);
      }

      renderAbout(); renderFields(); recompute(false);
      return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
    };
  }

  NS.views = NS.views || {};
  ['clocks', 'mutex', 'election', 'twopc', 'raft'].forEach((id) => { NS.views[id] = { mount: makeMount(id) }; });
})(typeof window !== 'undefined' ? window : globalThis);
