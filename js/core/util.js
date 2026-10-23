/* Shared helpers: DOM builder, colours, safe storage. No framework needed. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // One colour per process / page. Mid-tone so they read on light and dark surfaces.
  // The palette: one colour per process / page / thread, indexed by position.
  // Mid-tone hues were chosen so each reads on both the light and the dark surface.
  const PALETTE = [
    '#2860F0', '#E58A00', '#0FA36B', '#D63A30', '#7C4DFF',
    '#C7347B', '#0E9AA7', '#6BA300', '#F2702A', '#4F5BD5',
    '#A0693B', '#506E80'
  ];

  // colorFor(i): palette colour for index i. The double modulo makes it wrap around
  // and also work for negative indices (JavaScript's % can return negatives).
  function colorFor(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]; }

  // textOn(hex): choose black or white text for a coloured background.
  // Implements the WCAG relative-luminance formula: convert each sRGB channel to linear light,
  // weight them (the eye is most sensitive to green), and switch to dark text on bright colours.
  function textOn(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    // pick whichever of white / near-black gives the higher contrast ratio (they tie at L of about 0.18)
    return 1.05 / (L + 0.05) >= (L + 0.05) / 0.06 ? '#ffffff' : '#101828';
  }

  // clamp(v, lo, hi): keep v inside [lo, hi]. Used for input limits and slider positions.
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // flat(kids, out): flatten nested arrays of children into DOM nodes.
  // null / false are skipped (so `cond && node` works), arrays are expanded, and any other
  // value (strings, numbers) becomes a text node. This is what lets el() accept loose child lists.
  function flat(kids, out) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) flat(k, out);
      else out.push(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return out;
  }

  // These attributes must be set as DOM *properties* (node.value = ...), not attributes,
  // because the attribute only sets the initial value and would not update live inputs.
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

  // apply(n, attrs): copy an attributes object onto an element.
  //   class -> class attribute     text -> textContent     style -> object of CSS properties
  //   dataset -> data-* attributes  onXxx -> addEventListener('xxx', fn)   PROPS -> DOM property
  // Anything else becomes a normal attribute; `true` means a bare attribute, null/false skips it.
  function apply(n, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.setAttribute('class', v);
      else if (k === 'text') n.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
  }

  // el(tag, attrs, ...children): tiny hyperscript-style element builder, e.g.
  //   el('button', { class: 'btn', onclick: go }, 'Run')
  // Using it everywhere avoids innerHTML, so user-typed text can never inject markup.
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    apply(n, attrs);
    flat(kids, []).forEach((k) => n.appendChild(k));
    return n;
  }

  // svg(tag, attrs, ...children): same idea for SVG elements. SVG needs the SVG namespace
  // (createElementNS) and uses attributes for everything, so it has its own, simpler loop.
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    flat(kids, []).forEach((k) => n.appendChild(k));
    return n;
  }

  // store: localStorage wrapper that never throws. Private windows or blocked storage make
  // localStorage throw, so every read and write is wrapped and falls back gracefully.
  // Each view keeps its inputs here so a refresh brings your problem back.
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage may be blocked */ }
    }
  };

  // fmt(n, d): format a number for display with up to d decimals (default 2).
  // Trailing zeros are trimmed (2.50 -> 2.5, 3.00 -> 3); NaN shows as a dash and Infinity as the symbol.
  function fmt(n, d) {
    if (n == null || Number.isNaN(n)) return '–';
    if (!Number.isFinite(n)) return '∞';
    const s = (+n).toFixed(d == null ? 2 : d);
    return s.replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
  }

  // restart(node, cls): replay a CSS animation by removing and re-adding its class.
  // Reading offsetWidth forces the browser to apply the removal first, otherwise nothing replays.
  function restart(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // force reflow so the CSS animation plays again
    node.classList.add(cls);
  }

  // debounce(fn, ms): run fn only after the user has stopped typing for ms milliseconds,
  // so we recompute a simulation once per pause instead of once per keystroke.
  function debounce(fn, ms) {
    let t = null;
    return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
  }

  // ICONS: SVG path data (24x24 grid) for the player buttons and small actions.
  const ICONS = {
    first: 'M6 5v14M18 6l-8 6 8 6z',
    prev: 'M16 6l-8 6 8 6z',
    next: 'M8 6l8 6-8 6z',
    last: 'M18 5v14M6 6l8 6-8 6z',
    play: 'M8 5l11 7-11 7z',
    pause: 'M8 5v14M16 5v14',
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
    dice: 'M5 5h14v14H5zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01',
    check: 'M5 12l5 5 9-10',
    cross: 'M6 6l12 12M18 6L6 18'
  };

  // icon(name, size): build a small inline SVG icon. Solid shapes (play / next / prev) are filled,
  // the rest are drawn as strokes. aria-hidden because the button around it carries the label.
  function icon(name, size) {
    const s = size || 18;
    const fill = (name === 'play' || name === 'next' || name === 'prev') ? 'currentColor' : 'none';
    return svg('svg', { viewBox: '0 0 24 24', width: s, height: s, 'aria-hidden': 'true', fill, stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
      svg('path', { d: ICONS[name] }));
  }

  // Public API: everything on window.OSViz.util (and used by every view).
  NS.util = { PALETTE, colorFor, textOn, clamp, el, svg, store, fmt, restart, debounce, icon };
})(typeof window !== 'undefined' ? window : globalThis);
