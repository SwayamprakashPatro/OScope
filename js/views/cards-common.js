/* Shared bits for the Tier 5 concept cards: the page head and a small "mnemonic" box. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el } = NS.util;
  NS.cards = {
    head(id, title, text) { return el('div', { class: 'view-head' }, el('h2', { id }, title), el('p', null, text)); },
    note(label, text) { return el('p', { class: 'note cd-note' }, el('b', null, label + ' '), text); },
    table(headers, rows, cls) { return el('div', { class: 'tbl-wrap' }, el('table', { class: 'tbl cd-tbl ' + (cls || '') }, el('thead', null, el('tr', null, headers.map((h) => el('th', null, h)))), el('tbody', null, rows.map((r) => el('tr', null, r.map((c, i) => el(i ? 'td' : 'th', null, c))))))); },
    err(box, list) { box.hidden = !list.length; box.replaceChildren(...list.map((m) => el('div', null, m))); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
