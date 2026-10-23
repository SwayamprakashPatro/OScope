/* Protection card: privilege rings, plus an editable access matrix shown both ways (ACL columns and capability
   rows) with an access checker and a revoke-cost comparison. The matrix logic is in js/engines/concepts.js. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util, K = NS.cards, C = () => NS.concepts;
  const KEY = 'oslab.privilege.v1';
  const RINGS = [['Ring 0', 'Kernel', 'Full control: page tables, interrupts, I/O, privileged instructions.'], ['Ring 1-2', 'Drivers (rarely used)', 'Unused by most modern OSes; drivers run in ring 0 or in user mode.'], ['Ring 3', 'User programs', 'No direct hardware access. Must ask the kernel through a system call.']];

  function mount(host) {
    let state = Object.assign({ text: 'alice report rw\nalice backup r\nbob report r\nbob backup rw\ncarol backup r', q: { s: '', o: '', r: 'r' } }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    const view = el('section', { class: 'view', 'aria-labelledby': 'pv-title' });
    view.appendChild(K.head('pv-title', 'Privilege rings & access control', 'Hardware keeps user code from touching the machine (rings). Software decides who may touch which object (the access matrix). The matrix can be stored by column (ACLs) or by row (capabilities).'));
    const ws = el('div', { class: 'workspace' }), main = el('div', { class: 'col' }), side = el('div', { class: 'col problem' }); ws.append(main, side); view.appendChild(ws); host.appendChild(view);

    main.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Privilege rings')),
      el('div', { class: 'cd-rings', 'aria-hidden': 'true' }, el('div', { class: 'r0' }, 'Ring 0 kernel'), el('div', { class: 'r3' }, 'Ring 3 user')),
      K.table(['Ring', 'Who', 'What it can do'], RINGS),
      el('p', null, 'The CPU keeps the current ring in a register. A user program crosses into ring 0 only through a controlled entry (system call, interrupt, exception) that jumps to code the kernel chose, so user code cannot run its own code at ring 0.'),
      K.note('Memory hook:', 'Low number = high power. Ring 0 is the kernel at the centre; the closer to the middle, the more you can break.'),
      K.note('Honest limit:', 'x86 has rings 0-3; ARM calls them exception levels (EL0-EL3) and virtualisation adds a hypervisor level below ring 0.')));
    const mat = el('div', { class: 'card' }), matBody = el('div'); mat.append(el('div', { class: 'card-head' }, el('h3', null, 'Access matrix')), matBody);
    const views = el('div', { class: 'card' }), viewsBody = el('div'); views.append(el('div', { class: 'card-head' }, el('h3', null, 'Same matrix, two storage choices')), viewsBody);
    main.append(mat, views);

    const err = el('div', { class: 'errors', hidden: true, role: 'alert' }), chk = el('div');
    const again = debounce(calc, 250);
    const ta = el('textarea', { id: 'pv-text', rows: 8, class: 'mp-code', spellcheck: 'false', oninput: (e) => { state.text = e.target.value; save(); again(); } }); ta.value = state.text;
    const sS = el('select', { id: 'pv-s', 'aria-label': 'Subject', onchange: (e) => { state.q.s = e.target.value; save(); check(); } });
    const sO = el('select', { id: 'pv-o', 'aria-label': 'Object', onchange: (e) => { state.q.o = e.target.value; save(); check(); } });
    const sR = el('select', { id: 'pv-r', 'aria-label': 'Right', onchange: (e) => { state.q.r = e.target.value; save(); check(); } }, ['r', 'w', 'x'].map((r) => el('option', { value: r }, { r: 'read', w: 'write', x: 'execute' }[r])));
    sR.value = state.q.r;
    side.append(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your rules')), el('div', { class: 'col', style: { gap: '12px' } },
      el('div', { class: 'field' }, el('label', { for: 'pv-text' }, 'One rule per line: subject object rights'), ta, el('p', { class: 'hint' }, 'Rights use r, w, x. Repeating a pair adds rights. "-" means none. Up to 6 subjects and 6 objects.')), err)),
      el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'May they?')), el('div', { class: 'col', style: { gap: '10px' } }, sS, sO, sR, chk)));

    let m = null;
    function calc() {
      const r = C().parseMatrix(state.text); K.err(err, r.errors); if (!r.ok) return; m = r.matrix;
      const fill = (sel, list, cur) => { sel.replaceChildren(...list.map((x) => el('option', { value: x }, x))); sel.value = list.includes(cur) ? cur : list[0]; return sel.value; };
      state.q.s = fill(sS, m.subjects, state.q.s); state.q.o = fill(sO, m.objects, state.q.o);
      const cell = (s, o) => { const v = C().rightsOf(m, s, o); return v || '·'; };
      matBody.replaceChildren(K.table([''].concat(m.objects), m.subjects.map((s) => [s].concat(m.objects.map((o) => cell(s, o))))), el('p', { class: 'hint' }, 'Rows are subjects (who acts), columns are objects (what is acted on), cells are rights.'));
      const acl = C().aclOf(m), caps = C().capsOf(m);
      const list = (a, f) => el('ul', { class: 'cd-list' }, a.map(f));
      viewsBody.replaceChildren(el('div', { class: 'grid2' },
        el('div', null, el('h4', null, 'ACL: one list per object (columns)'), list(acl, (a) => el('li', null, el('b', null, a.object + ': '), a.entries.length ? a.entries.map((e) => e.subject + ' ' + e.rights).join(', ') : 'nobody'))),
        el('div', null, el('h4', null, 'Capabilities: one list per subject (rows)'), list(caps, (c) => el('li', null, el('b', null, c.subject + ': '), c.caps.length ? c.caps.map((e) => e.object + ' ' + e.rights).join(', ') : 'holds nothing')))),
        K.table(['', 'ACL', 'Capability list'], [['Answer "who can use this object?"', 'Read one list', 'Search every subject'], ['Answer "what can this subject do?"', 'Search every object', 'Read one list'], ['Revoke access to one object', 'Edit that object\'s list', 'Find and remove every copy held'], ['Delegating a right', 'Needs the owner to edit the list', 'Pass the capability along'], ['Typical use', 'File permissions, Windows ACLs', 'File descriptors, Capsicum, seL4']]),
        K.note('Memory hook:', 'ACL = a guest list at the door of each object. Capability = a ticket in each subject\'s pocket.'),
        K.note('Honest limit:', 'Real systems mix them (a file descriptor is a capability obtained after an ACL check), add groups and roles, and capabilities need unforgeability by the OS, which this table does not model.'));
      check();
    }
    function check() {
      if (!m) return; const { s, o, r } = state.q; if (!s || !o) return;
      const ok = C().check(m, s, o, r), rc = C().revokeCost(m, o), name = { r: 'read', w: 'write', x: 'execute' }[r];
      chk.replaceChildren(el('p', { class: 'why' }, el('b', null, ok ? '✓ Allowed. ' : '✗ Denied. '), s + (ok ? ' holds ' : ' does not hold ') + name + ' on ' + o + ' (rights: ' + (C().rightsOf(m, s, o) || 'none') + ').'),
        el('p', { class: 'muted' }, 'To revoke everyone from ' + o + ': ACL needs ' + rc.aclEdits + ' edit; a capability system must search ' + rc.capSearches + ' subject' + (rc.capSearches === 1 ? '' : 's') + ' (' + rc.holders.length + ' hold it).'));
    }
    calc();
    return { activate() {}, deactivate() {} };
  }
  NS.views = NS.views || {}; NS.views.privilege = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
