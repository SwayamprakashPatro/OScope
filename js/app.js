/* App shell: sidebar (areas and labs), search button, theme switch, hash routing.
   The list of labs is not written here. Each lab describes itself in js/labs/<id>.js and registers with
   OSViz.labs; this file only displays whatever is registered. To add a lab: write its engine and view,
   add js/labs/<id>.js, and add the <script> tags in index.html. */
(function (root) {
  'use strict';
  const NS = root.OSViz;
  const { el, store } = NS.util;

  const LABS = NS.labs.LABS;
  // A lab is live once its view script has loaded; otherwise its sidebar row shows "soon".
  const isSoon = (lab) => !(NS.views && NS.views[lab.view]);

  // Sidebar rows are shown for a lab when it is a core lab, or advanced labs are switched on, or it
  // is the lab currently open (so the page never hides the screen you are looking at).
  // collapsed = ids of sidebar areas the user folded away.
  const SMALL_MENU = 12; // up to this many visible labs, every area starts expanded

  // mounted[id] = object returned by that view's mount(); views are built lazily on first visit and
  // then kept alive, so your inputs are not lost when you switch labs. stages[id] = its container.
  const mounted = {}, stages = {};
  let current = null;
  let showAdvanced = !!store.get('oslab.advanced', false);
  let collapsed = null; // Set of area ids; created in build()
  let rail, main, railBtns = {}, advInput = null;

  // applyTheme: 'light' / 'dark' force a theme through data-theme on <html>; 'system' removes it so
  // the CSS prefers-color-scheme media query decides.
  function applyTheme(mode) {
    const r = document.documentElement;
    if (mode === 'light' || mode === 'dark') r.setAttribute('data-theme', mode); else r.removeAttribute('data-theme');
  }

  const visibleLabs = () => LABS.filter((l) => showAdvanced || l.level === 'core' || l.id === current);

  // initialCollapsed(): first visit defaults. A small menu starts fully open; a big one starts with only
  // the area of the current lab open, so the sidebar stays short.
  function initialCollapsed() {
    const saved = store.get('oslab.collapsed', null);
    if (Array.isArray(saved)) return new Set(saved);
    if (visibleLabs().length <= SMALL_MENU) return new Set();
    const cur = LABS.find((l) => l.id === current);
    return new Set(NS.labs.AREAS.map((a) => a.id).filter((id) => !cur || id !== cur.area));
  }
  const saveCollapsed = () => store.set('oslab.collapsed', [...collapsed]);

  // renderRail(): rebuild the sidebar from the registry. One collapsible heading per area that has
  // visible labs, then one button per lab. Called on start, when advanced labs are toggled, and when an
  // area is folded or unfolded.
  function renderRail() {
    railBtns = {};
    const vis = visibleLabs();
    const parts = NS.labs.AREAS.filter((a) => vis.some((l) => l.area === a.id)).map((a) => {
      const open = !collapsed.has(a.id);
      const labs = vis.filter((l) => l.area === a.id);
      const head = el('button', {
        type: 'button', class: 'rail-head', 'aria-expanded': String(open),
        onclick: () => { if (collapsed.has(a.id)) collapsed.delete(a.id); else collapsed.add(a.id); saveCollapsed(); renderRail(); }
      }, el('span', null, a.title), el('span', { class: 'rail-count' }, String(labs.length)), el('i', { class: 'rail-chev', 'aria-hidden': 'true' }));
      const button = (l) => {
        const soon = isSoon(l);
        const b = el('button', { type: 'button', class: 'rail-item', disabled: soon, onclick: () => go(l.id) },
          l.title, soon ? el('span', { class: 'soon' }, 'soon') : null);
        railBtns[l.id] = b; return b;
      };
      // One sub-heading per section that has visible labs, then that section's lab buttons.
      const sections = a.sections.filter((s) => labs.some((l) => l.section === s.id)).map((s) =>
        el('div', { class: 'rail-sec' }, el('div', { class: 'rail-sub' }, s.title), labs.filter((l) => l.section === s.id).map(button)));
      return el('div', { class: 'rail-group', dataset: { open: String(open) } }, head, el('div', { class: 'rail-list' }, sections));
    });
    rail.replaceChildren(...parts.filter(Boolean));
    if (advInput) advInput.checked = showAdvanced;
    markCurrent();
  }

  function markCurrent() {
    Object.keys(railBtns).forEach((k) => { if (k === current) railBtns[k].setAttribute('aria-current', 'page'); else railBtns[k].removeAttribute('aria-current'); });
    revealCurrent();
  }

  // revealCurrent(): scroll the sidebar (not the page) so the open lab is visible and roughly centred.
  // On desktop the sidebar scrolls vertically; on phones it is a horizontal strip. Only the sidebar's own
  // scroll position is changed, so the page itself does not jump.
  function revealCurrent() {
    const b = railBtns[current];
    if (!b || !rail) return;
    const r = rail.getBoundingClientRect(), i = b.getBoundingClientRect();
    if (rail.scrollHeight > rail.clientHeight + 2 && (i.top < r.top + 40 || i.bottom > r.bottom - 8)) rail.scrollTop += (i.top + i.bottom) / 2 - (r.top + r.bottom) / 2;
    if (rail.scrollWidth > rail.clientWidth + 2) rail.scrollLeft += (i.left + i.right) / 2 - (r.left + r.right) / 2;
  }

  // go(id): open a lab. Pause the old view, show the new lab container, mount it on first visit (inside
  // the shared frame), activate it (routes keyboard shortcuts to its player), then update the sidebar,
  // URL hash and page title. Unknown or unavailable ids fall back to the first live lab.
  function go(id, fromHash) {
    const lab = LABS.find((x) => x.id === id && !isSoon(x)) || LABS.find((x) => !isSoon(x));
    if (!lab || current === lab.id) return;
    if (current && mounted[current]) mounted[current].deactivate();
    // Make sure the lab is reachable in the sidebar: reveal advanced labs and unfold its area.
    let dirty = false;
    if (lab.level === 'advanced' && !showAdvanced) { showAdvanced = true; store.set('oslab.advanced', true); dirty = true; }
    if (collapsed.has(lab.area)) { collapsed.delete(lab.area); saveCollapsed(); dirty = true; }
    if (!stages[lab.id]) { stages[lab.id] = el('div', { hidden: true }); main.appendChild(stages[lab.id]); }
    Object.keys(stages).forEach((k) => { stages[k].hidden = k !== lab.id; });
    if (!mounted[lab.id]) mounted[lab.id] = NS.views[lab.view].mount(NS.frame.wrap(lab, stages[lab.id]));
    mounted[lab.id].activate();
    // Bring the new lab into view and fade it in, so a click in a long sidebar never leaves you looking at the old spot.
    if (!fromHash && current) { try { window.scrollTo({ top: 0 }); } catch (e) { /* ignore */ } }
    stages[lab.id].classList.remove('stage-in'); void stages[lab.id].offsetWidth; stages[lab.id].classList.add('stage-in');
    current = lab.id;
    if (dirty) renderRail(); else markCurrent();
    // A user click adds a history entry, so the browser Back and Forward buttons move between labs.
    if (!fromHash && location.hash !== '#' + lab.id) { try { history.pushState(null, '', '#' + lab.id); } catch (e) { /* ignore */ } }
    document.title = lab.title + ' · OScope';
  }

  // advControl(): the "Advanced labs" switch in the top bar, with an (i) button that explains what it means.
  function advControl() {
    advInput = el('input', { type: 'checkbox', checked: showAdvanced, onchange: (e) => { showAdvanced = e.target.checked; store.set('oslab.advanced', showAdvanced); renderRail(); } });
    const pop = el('div', { class: 'adv-pop', role: 'tooltip', id: 'adv-pop', hidden: true },
      el('b', null, 'Core vs advanced labs'),
      el('p', null, 'Core labs cover the topics in almost every first OS course: scheduling, paging, deadlock, synchronization, disks, interrupts.'),
      el('p', null, 'Advanced labs go further: Raft, NUMA, MLFQ, RAID, journaling, buffer overflows and similar. Switch this on to show them in the sidebar.'));
    const info = el('button', { type: 'button', class: 'adv-info', 'aria-label': 'What are advanced labs?', 'aria-controls': 'adv-pop', 'aria-expanded': 'false' }, 'i');
    const close = () => { pop.hidden = true; info.setAttribute('aria-expanded', 'false'); };
    info.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; info.setAttribute('aria-expanded', String(!pop.hidden)); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return el('div', { class: 'adv' }, el('label', { class: 'adv-switch' }, advInput, el('span', null, 'Advanced labs')), info, pop);
  }

  // build(): create the page frame (header, search button, theme switch, sidebar, main area).
  function build() {
    const app = document.getElementById('app');
    const themeMode = store.get('oslab.theme', 'system');
    applyTheme(themeMode);

    // Theme switch: remember the choice and update the pressed state of the three buttons.
    const themeBtns = ['system', 'light', 'dark'].map((m) => el('button', {
      type: 'button', 'aria-pressed': String(m === themeMode), dataset: { mode: m },
      onclick: () => { store.set('oslab.theme', m); applyTheme(m); themeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m))); }
    }, m[0].toUpperCase() + m.slice(1)));

    // Search palette (Ctrl+K). Picking a result opens that lab.
    const search = NS.search.init((lab) => go(lab.id));
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    const searchBtn = el('button', { type: 'button', class: 'sr-btn', 'aria-label': 'Search concepts', onclick: () => search.open() },
      'Search', el('kbd', null, isMac ? '⌘K' : 'Ctrl K'));

    rail = el('nav', { class: 'rail', 'aria-label': 'Labs' });
    main = el('main', { id: 'main' });

    app.append(
      el('header', { class: 'topbar' },
        el('div', { class: 'brand' },
          NS.util.svg('svg', { class: 'brand-mark', width: 34, height: 34, viewBox: '0 0 34 34', 'aria-hidden': 'true' },
            NS.util.svg('rect', { x: 8, y: 8, width: 18, height: 18, rx: 4, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2 }),
            NS.util.svg('path', { d: 'M13 3v5M21 3v5M13 26v5M21 26v5M3 13h5M3 21h5M26 13h5M26 21h5', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
            NS.util.svg('rect', { x: 14, y: 14, width: 6, height: 6, rx: 1.5, fill: 'var(--accent)' })),
          el('div', null, el('h1', null, 'OScope'), el('p', null, 'Type your own problem, then watch the operating system work it out.'))),
        el('div', { class: 'topbar-tools' }, searchBtn, advControl(), el('div', { class: 'theme', role: 'group', 'aria-label': 'Colour theme' }, themeBtns))),
      el('div', { class: 'shell' }, rail, main));

    // Decide the first lab before drawing the sidebar so the right area starts unfolded.
    current = null;
    const first = LABS.find((l) => l.id === location.hash.slice(1) && !isSoon(l)) || LABS.find((l) => !isSoon(l));
    current = first ? first.id : null;
    collapsed = initialCollapsed();
    if (first && collapsed.has(first.area)) collapsed.delete(first.area);
    renderRail();
    const start = current; current = null; // go() skips work when the id is already current
    go(start, true);

    // Back / forward buttons and pasted links (#sync) drive the same go().
    window.addEventListener('hashchange', () => go(location.hash.slice(1), true));
  }

  // refresh(): rebuild the sidebar after labs were registered late (used by tests and future lazy loading).
  NS.app = { refresh: () => { if (rail) renderRail(); }, go };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})(window);
