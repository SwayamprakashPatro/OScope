/* NUMA card: threads placed on nodes, pages spread over nodes, local versus remote latency. Shows each thread's
   average latency now and after a simple rebalance that follows the pages but keeps the nodes evenly loaded. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store, debounce } = NS.util, K = NS.cards, C = () => NS.concepts;
  const KEY = 'oslab.numa.v1';
  function mount(host) {
    let state = Object.assign({ nodes: 2, local: 80, remote: 140, text: 'web 0 90 10\ncache 0 5 95\nbatch 1 10 90\nlogger 1 60 40' }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    const view = el('section', { class: 'view', 'aria-labelledby': 'nu-title' });
    view.appendChild(K.head('nu-title', 'NUMA & load balancing', 'On a big machine, each CPU socket (node) has its own memory. A thread reading memory on its own node is fast; reading another node\'s memory crosses a slower link. The OS balances load but should keep threads near their pages.'));
    const ws = el('div', { class: 'workspace' }), main = el('div', { class: 'col' }), side = el('div', { class: 'col problem' }); ws.append(main, side); view.appendChild(ws); host.appendChild(view);
    const now = el('div', { class: 'card' }), nowB = el('div'), aft = el('div', { class: 'card' }), aftB = el('div'), info = el('div', { class: 'card' });
    now.append(el('div', { class: 'card-head' }, el('h3', null, 'As placed')), nowB); aft.append(el('div', { class: 'card-head' }, el('h3', null, 'After rebalancing')), aftB);
    info.append(el('div', { class: 'card-head' }, el('h3', null, 'How the OS handles it')), K.table(['Technique', 'Idea'], [['First-touch allocation', 'A page is placed on the node of the thread that first writes it.'], ['Interleaving', 'Spread pages round-robin over nodes: average speed, no hot node.'], ['Affinity', 'Keep a thread on its chosen node so its pages stay local.'], ['Automatic balancing', 'Sample page accesses, then move the thread or migrate the page toward the other.']]),
      K.note('Memory hook:', 'Run the thread where the data is, or move the data to where the thread is. Local = short walk, remote = a trip across town.'),
      K.note('Honest limit:', 'Latency here is the simple weighted average of local and remote cost. Real machines also have bandwidth limits, caches, and more than two distances between nodes. The balancer is a greedy heuristic (threads with the most to gain choose first, no node gets more than ceil(threads / nodes)), not the Linux algorithm.'));
    main.append(now, aft, info);
    const err = el('div', { class: 'errors', hidden: true, role: 'alert' }), again = debounce(calc, 250);
    const num = (key, id, label, lo, hi) => el('div', { class: 'field' }, el('label', { for: id }, label), el('input', { type: 'number', id, min: lo, max: hi, value: state[key], oninput: (e) => { state[key] = +e.target.value; save(); again(); } }));
    const ta = el('textarea', { id: 'nu-text', rows: 7, class: 'mp-code', spellcheck: 'false', oninput: (e) => { state.text = e.target.value; save(); again(); } }); ta.value = state.text;
    side.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', null, 'Your machine')), el('div', { class: 'col', style: { gap: '12px' } },
      el('div', { class: 'grid2' }, num('nodes', 'nu-nodes', 'Nodes (2-4)', 2, 4), num('local', 'nu-local', 'Local latency (ns)', 1, 1000)), num('remote', 'nu-remote', 'Remote latency (ns)', 1, 2000),
      el('div', { class: 'field' }, el('label', { for: 'nu-text' }, 'Threads: name node pages-on-node0 pages-on-node1 ...'), ta, el('p', { class: 'hint' }, 'One field of page counts per node. Example with 2 nodes: "web 0 90 10" is a thread on node 0 with 90 pages local and 10 on node 1. Up to 8 threads.')), err)));
    function table(cfg, ths) {
      const r = C().numaReport(cfg, ths);
      return [K.table(['Thread', 'On node', 'Pages remote', 'Avg latency'], r.per.map((p) => [p.name, String(p.node), (100 * p.remoteShare).toFixed(0) + '%', p.avg.toFixed(1) + ' ns'])),
        el('p', { class: 'why' }, el('b', null, 'Mean latency ' + r.mean.toFixed(1) + ' ns. '), 'Threads per node: ' + r.load.map((n, i) => 'node ' + i + ' = ' + n).join(', ') + '.')];
    }
    function calc() {
      const errs = [];
      if (!Number.isInteger(state.nodes) || state.nodes < 2 || state.nodes > 4) errs.push('Nodes must be 2, 3 or 4.');
      if (!(state.local > 0) || !(state.remote > 0)) errs.push('Latencies must be above 0.'); else if (state.remote < state.local) errs.push('Remote latency should not be lower than local.');
      let p = { ok: false, errors: [], threads: [] }; if (!errs.length) p = C().parseNuma(state.text, state.nodes);
      K.err(err, errs.concat(p.errors)); if (errs.length || !p.ok) return;
      const cfg = { nodes: state.nodes, local: state.local, remote: state.remote }, bal = C().numaBalance(cfg, p.threads);
      const a = C().numaReport(cfg, p.threads), b = C().numaReport(cfg, bal), moved = bal.filter((t, i) => t.node !== p.threads[i].node).map((t) => t.name);
      nowB.replaceChildren(...table(cfg, p.threads));
      aftB.replaceChildren(...table(cfg, bal), el('p', { class: 'muted' }, moved.length ? 'Moved: ' + moved.join(', ') + '. Mean latency ' + (b.mean <= a.mean ? 'drops' : 'rises') + ' from ' + a.mean.toFixed(1) + ' to ' + b.mean.toFixed(1) + ' ns.' : 'No thread needs to move.'));
    }
    calc();
    return { activate() {}, deactivate() {} };
  }
  NS.views = NS.views || {}; NS.views.numa = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
