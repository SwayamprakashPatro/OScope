/* Virtual machine versus container card: a requirements helper, the namespaces that isolate what a container sees,
   and a cgroup calculator for CPU shares and memory limits (computed by js/engines/concepts.js). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util, K = NS.cards, C = () => NS.concepts;
  const KEY = 'oslab.vmcont.v1';
  const NSES = [
    ['pid', 'PID', 'Process IDs. Inside, the first process is PID 1 and the host\'s processes are invisible.'],
    ['net', 'Network', 'Own interfaces, IP address, routing table and ports.'],
    ['mnt', 'Mount', 'Own view of the filesystem tree (the container image becomes /).'],
    ['uts', 'UTS', 'Own hostname.'],
    ['ipc', 'IPC', 'Own shared memory and message queues.'],
    ['user', 'User', 'Root inside can map to an ordinary user outside.'],
    ['cgroup', 'Cgroup', 'Sees only its own slice of the cgroup tree.']];
  const NEEDS = [
    ['kernel', 'I need a different OS kernel than the host (for example Windows on a Linux host)', 'vm'],
    ['strong', 'Untrusted tenants: a kernel bug must not let them escape', 'vm'],
    ['fast', 'Start in well under a second and run many copies', 'ct'],
    ['dense', 'Pack as many instances as possible on one machine', 'ct'],
    ['same', 'Everything runs on the same Linux kernel anyway', 'ct'],
    ['legacy', 'I need to load kernel modules or tune kernel settings per instance', 'vm']];

  function mount(host) {
    let state = Object.assign({ needs: ['fast', 'same'], on: ['pid', 'net', 'mnt'], cap: 4, groups: 'web 1024 3\ndb 512 3\nbatch 256 2', mlimit: 512, muse: 600 }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    const view = el('section', { class: 'view', 'aria-labelledby': 'vc-title' });
    view.appendChild(K.head('vc-title', 'Virtual machine vs container', 'Both isolate programs, at different levels. A VM virtualises hardware and runs its own kernel; a container shares the host kernel and is isolated by namespaces (what it can see) and cgroups (what it can use).'));
    const ws = el('div', { class: 'workspace' }), main = el('div', { class: 'col' }), side = el('div', { class: 'col problem' }); ws.append(main, side); view.appendChild(ws); host.appendChild(view);

    main.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Side by side')), K.table(['', 'Virtual machine', 'Container'], [
      ['What is virtualised', 'Hardware (CPU, memory, devices)', 'The OS view (processes, network, files)'],
      ['Kernel', 'Its own guest kernel on a hypervisor', 'Shares the host kernel'],
      ['Isolation boundary', 'Hypervisor, a small interface', 'The whole kernel system-call interface'],
      ['Start time', 'Seconds to minutes (boots an OS)', 'Milliseconds to seconds (starts a process)'],
      ['Memory overhead', 'A full guest OS each', 'Almost none beyond the app'],
      ['Guest OS', 'Any the hardware supports', 'Same kernel family as the host'],
      ['Main risk', 'Resource overhead', 'A kernel bug can expose the host']]), K.note('Memory hook:', 'VM = "a whole computer in a box", container = "a process in a costume": it believes it is alone, but it is still one of the host\'s processes.')));

    const helper = el('div', { class: 'card' }), helperBody = el('div'); helper.append(el('div', { class: 'card-head' }, el('h3', null, 'Which fits my needs?')), helperBody);
    const nsCard = el('div', { class: 'card' }), nsBody = el('div'); nsCard.append(el('div', { class: 'card-head' }, el('h3', null, 'Namespaces: what the container can see'), el('span', { class: 'sub' }, 'Switch them on and off')), nsBody);
    main.append(helper, nsCard);
    function paintHelper() {
      const chosen = NEEDS.filter(([k]) => state.needs.includes(k)), vm = chosen.filter((n) => n[2] === 'vm').length, ct = chosen.filter((n) => n[2] === 'ct').length;
      const verdict = !chosen.length ? 'Tick at least one requirement.' : vm && ct ? 'Mixed needs (' + vm + ' for VM, ' + ct + ' for container). A common answer is containers inside VMs: the VM gives the hard boundary, containers give density and speed.' : vm ? 'Leans to a virtual machine (' + vm + ' of ' + chosen.length + ' needs point there).' : 'Leans to containers (' + ct + ' of ' + chosen.length + ' needs point there).';
      helperBody.replaceChildren(el('div', { class: 'col', style: { gap: '6px' } }, NEEDS.map(([k, t]) => el('label', { class: 'cd-check' }, el('input', { type: 'checkbox', checked: state.needs.includes(k), onchange: (e) => { state.needs = e.target.checked ? state.needs.concat(k) : state.needs.filter((x) => x !== k); save(); paintHelper(); } }), ' ' + t))),
        el('p', { class: 'why', style: { marginTop: '10px' } }, el('b', null, verdict)), K.note('Honest limit:', 'This is a rule of thumb that counts your ticks; real choices also depend on cost, tooling and compliance rules.'));
    }
    function paintNs() {
      nsBody.replaceChildren(el('div', { class: 'chips' }, NSES.map(([k, t]) => el('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(state.on.includes(k)), onclick: () => { state.on = state.on.includes(k) ? state.on.filter((x) => x !== k) : state.on.concat(k); save(); paintNs(); } }, t))),
        K.table(['Namespace', 'State', 'What the container sees'], NSES.map(([k, t, d]) => [t, state.on.includes(k) ? 'isolated' : 'shared with host', state.on.includes(k) ? d : 'The host\'s own view (not isolated).'])),
        K.note(state.on.length + ' of ' + NSES.length + ' isolated.', state.on.length === NSES.length ? 'Full set, like a typical container runtime.' : 'Anything left shared can be seen or affected from inside. For example, without the PID namespace the container can list and signal host processes.'));
    }
    paintHelper(); paintNs();

    // cgroup calculator
    const err = el('div', { class: 'errors', hidden: true, role: 'alert' }), out = el('div'), outMem = el('div');
    const again = debounce(calc, 250);
    const cap = el('input', { type: 'number', id: 'vc-cap', min: 1, max: 64, value: state.cap, oninput: (e) => { state.cap = +e.target.value; save(); again(); } });
    const ta = el('textarea', { id: 'vc-groups', rows: 5, class: 'mp-code', spellcheck: 'false', oninput: (e) => { state.groups = e.target.value; save(); again(); } }); ta.value = state.groups;
    const ml = el('input', { type: 'number', id: 'vc-ml', min: 1, value: state.mlimit, oninput: (e) => { state.mlimit = +e.target.value; save(); again(); } });
    const mu = el('input', { type: 'number', id: 'vc-mu', min: 0, value: state.muse, oninput: (e) => { state.muse = +e.target.value; save(); again(); } });
    side.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'cgroups: what it may use')),
      el('div', { class: 'col', style: { gap: '12px' } }, el('div', { class: 'field' }, el('label', { for: 'vc-cap' }, 'Machine CPU cores'), cap),
        el('div', { class: 'field' }, el('label', { for: 'vc-groups' }, 'Containers: name weight cores-wanted'), ta, el('p', { class: 'hint' }, 'Weight is the cgroup CPU share (default 1024). When the CPU is busy the cores are split by weight; a container that wants less keeps only what it wants and the rest is shared on.')),
        err, out,
        el('div', { class: 'grid2' }, el('div', { class: 'field' }, el('label', { for: 'vc-ml' }, 'Memory limit (MB)'), ml), el('div', { class: 'field' }, el('label', { for: 'vc-mu' }, 'Memory it tries to use (MB)'), mu)), outMem,
        K.note('Honest limit:', 'CPU split is the idealised weighted fair share. Real schedulers also have per-container quotas, burst and cache effects, and memory limits count page cache too.'))));
    function calc() {
      const lines = String(state.groups).split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean), errs = [], gs = [];
      lines.forEach((l, i) => { const t = l.split(/\s+/), w = +t[1], d = +t[2]; if (t.length !== 3 || !(w > 0) || !(d >= 0)) errs.push('Line ' + (i + 1) + ': write "name weight cores-wanted", weight above 0.'); else gs.push({ name: t[0], weight: w, demand: d }); });
      if (!(state.cap >= 1)) errs.push('Cores must be at least 1.'); if (gs.length > 8) errs.push('At most 8 containers.'); if (!gs.length && !errs.length) errs.push('Enter at least one container.');
      K.err(err, errs); if (errs.length) return;
      const r = C().cpuShares(gs, state.cap), tw = gs.reduce((a, g) => a + g.weight, 0);
      out.replaceChildren(K.table(['Container', 'Weight share', 'Wants', 'Gets (cores)'], r.map((g) => [g.name, (100 * g.weight / tw).toFixed(1) + '%', String(g.demand), g.got.toFixed(2) + (g.got < g.demand - 1e-9 ? ' (throttled)' : '')])));
      const m = C().memCheck(state.mlimit, state.muse);
      outMem.replaceChildren(el('p', { class: 'why' }, el('b', null, m.oomKill ? 'Over the limit by ' + (-m.headroom) + ' MB: the kernel OOM-kills a process inside this container only. ' : 'Within the limit, ' + m.headroom + ' MB to spare. '), m.oomKill ? 'The rest of the machine is unaffected; that is the point of a memory cgroup.' : ''));
    }
    calc();
    return { activate() {}, deactivate() {} };
  }
  NS.views = NS.views || {}; NS.views.vmcont = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
