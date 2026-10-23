/* Lab frame: the shared wrapper around every concept screen.
   wrap(lab, stage) fills `stage` (the container app.js made for this lab) with three parts and returns
   the middle one, where the lab's own view is mounted:

     1. a breadcrumb row      Area > Lab title   (plus an "Advanced" badge when relevant)
     2. host                  the screen built by js/views/<x>-view.js
     3. a "Go deeper" card    the idea and memory hook always visible; Deep dive and Common mistakes
                              folded away so the page never feels crowded

   All the text comes from the lab's description in js/labs/<id>.js, so every lab gets the same
   layout and a new lab needs no extra frame code. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el } = NS.util;

  // list(items): a bullet list from an array of strings.
  const list = (items) => el('ul', { class: 'fr-list' }, items.map((t) => el('li', null, t)));

  // fold(title, items, count): one collapsed section. <details> gives keyboard and screen-reader
  // support for free; it starts closed.
  const fold = (title, items) => el('details', { class: 'fr-fold' },
    el('summary', null, title, el('span', { class: 'fr-count' }, String(items.length))), list(items));

  function wrap(lab, stage) {
    const L = lab.learn;
    const crumb = el('div', { class: 'fr-crumb' },
      el('span', null, NS.labs.areaTitle(lab.area)), el('span', { class: 'fr-sep', 'aria-hidden': 'true' }, '›'),
      el('span', null, NS.labs.sectionTitle(lab.area, lab.section)), el('span', { class: 'fr-sep', 'aria-hidden': 'true' }, '›'),
      el('strong', null, lab.title),
      lab.level === 'advanced' ? el('span', { class: 'fr-badge' }, 'Advanced') : null);
    const host = el('div', { class: 'fr-host' });
    const learn = el('section', { class: 'card fr-learn', 'aria-label': 'Go deeper: ' + lab.title },
      el('h3', null, 'Go deeper'),
      el('p', { class: 'fr-idea' }, el('b', null, 'The idea. '), L.idea),
      el('p', { class: 'fr-hook' }, el('b', null, 'Memory hook. '), L.hook),
      fold('Deep dive', L.deep),
      fold('Common mistakes', L.mistakes));
    // Phone / narrow layouts stack the input panel under the animation, so a small floating button jumps between them.
    const jump = el('button', { type: 'button', class: 'fr-jump', hidden: true, 'aria-label': 'Jump between the animation and your input' });
    const panel = () => host.querySelector('.problem');
    const calm = () => (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
    const refresh = () => {
      const p = panel(); if (!p || !stage.offsetParent) { jump.hidden = true; return; }
      const near = p.getBoundingClientRect().top < window.innerHeight * 0.55;   // is the input panel already on screen?
      jump.hidden = false; jump.dataset.dir = near ? 'up' : 'down'; jump.textContent = near ? 'Animation ↑' : 'Your input ↓';
    };
    jump.addEventListener('click', () => { const p = panel(); if (p) (jump.dataset.dir === 'up' ? crumb : p).scrollIntoView({ behavior: calm(), block: 'start' }); });
    window.addEventListener('scroll', refresh, { passive: true }); window.addEventListener('resize', refresh);
    window.addEventListener('hashchange', () => setTimeout(refresh, 50));
    setTimeout(refresh, 300);
    stage.append(crumb, host, learn, jump);
    return host;
  }

  NS.frame = { wrap };
})(window);
