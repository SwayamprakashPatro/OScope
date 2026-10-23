/* Ctrl+K search palette. Type a concept or algorithm name (lru, c-scan, semaphore, tlb ...), pick a
   result with the arrow keys or the mouse, press Enter, and the matching lab opens.
   The ranking itself lives in labs.js (search); this file only draws the dialog and handles keys.

   init(onPick):  `onPick(lab)` is called with the chosen lab.
   Returns { open, close } so a button in the header can open it too. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el } = NS.util;

  function init(onPick) {
    let overlay = null, input, listEl, results = [], active = 0, returnFocus = null;

    // draw(): render the current results; the active row is marked for keyboard and screen readers.
    function draw() {
      const q = input.value.trim();
      listEl.replaceChildren(...(results.length ? results.map((r, i) => el('li', {
        id: 'sr-opt-' + i, role: 'option', class: 'sr-item', 'aria-selected': String(i === active),
        onmousedown: (e) => { e.preventDefault(); choose(i); }, onmousemove: () => { if (active !== i) { active = i; draw(); } }
      },
        el('span', { class: 'sr-main' }, r.lab.title, r.lab.level === 'advanced' ? el('span', { class: 'fr-badge' }, 'Advanced') : null),
        el('span', { class: 'sr-sub' }, NS.labs.areaTitle(r.lab.area) + ' › ' + NS.labs.sectionTitle(r.lab.area, r.lab.section) + (r.hit ? ' · matches “' + r.hit + '”' : '')))) :
        [el('li', { class: 'sr-empty' }, q ? 'No lab covers “' + q + '” yet.' : 'Type a concept, algorithm or term.')]));
      input.setAttribute('aria-activedescendant', results.length ? 'sr-opt-' + active : '');
      const sel = listEl.querySelector('[aria-selected="true"]');
      if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    }

    function update() { results = NS.labs.search(input.value, { limit: 8 }); active = 0; draw(); }
    function choose(i) { const r = results[i]; if (!r) return; close(); onPick(r.lab); }

    function build() {
      input = el('input', { type: 'text', class: 'sr-input', placeholder: 'Search concepts: lru, c-scan, semaphore, tlb ...', role: 'combobox',
        'aria-expanded': 'true', 'aria-controls': 'sr-list', 'aria-label': 'Search concepts', autocomplete: 'off', spellcheck: 'false' });
      listEl = el('ul', { id: 'sr-list', class: 'sr-list', role: 'listbox' });
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { if (results.length) { active = (active + 1) % results.length; draw(); } e.preventDefault(); }
        else if (e.key === 'ArrowUp') { if (results.length) { active = (active - 1 + results.length) % results.length; draw(); } e.preventDefault(); }
        else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
        else if (e.key === 'Escape') { close(); e.preventDefault(); }
        else if (e.key === 'Tab') { e.preventDefault(); } // keep focus inside the dialog
      });
      overlay = el('div', { class: 'sr-overlay', onmousedown: (e) => { if (e.target === overlay) close(); } },
        el('div', { class: 'sr-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search concepts' }, input, listEl,
          el('div', { class: 'sr-foot' }, el('span', null, '↑ ↓ to move'), el('span', null, 'Enter to open'), el('span', null, 'Esc to close'))));
      document.body.appendChild(overlay);
    }

    function open() {
      if (overlay && !overlay.hidden) return;
      returnFocus = document.activeElement;
      if (!overlay) build();
      overlay.hidden = false; input.value = ''; update(); input.focus();
    }
    function close() {
      if (!overlay || overlay.hidden) return;
      overlay.hidden = true;
      if (returnFocus && returnFocus.focus) returnFocus.focus();
    }

    // Ctrl+K / Cmd+K opens the palette from anywhere, even inside an input box.
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    });
    return { open, close };
  }

  NS.search = { init };
})(window);
