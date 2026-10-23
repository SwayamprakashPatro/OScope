/* Lab registry and concept search. Pure logic: no DOM, so it can be tested in Node.

   A "lab" is one screen in the app (for example "Page replacement"). Each lab lives in its own file
   under js/labs/ and calls OSViz.labs.register({...}) with a description of itself:

     id        URL hash and unique key                 (e.g. 'paging')
     area      one of AREAS below                      (e.g. 'memory')
     section   one of that area's sections             (e.g. 'translation'), the sub-heading in the sidebar
     title     name shown in the sidebar               (e.g. 'Page replacement')
     view      key of the screen builder in OSViz.views
     level     'core' (shown by default) or 'advanced' (hidden until the user turns advanced labs on)
     summary   one line: what problem does this lab help you understand?
     keywords  other names a student might search for (algorithm names, terms, abbreviations)
     learn     { idea, hook, deep: [..], mistakes: [..] }   text for the "Go deeper" card

   The sidebar order is the order in which lab files are loaded (see index.html). */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // The top-level areas of the sidebar, in display order, each split into sections (the sub-headings).
  // Within a section, labs appear in the order their <script> tags load in index.html.
  const AREAS = [
    { id: 'processes', title: 'Processes & CPU', sections: [
      { id: 'scheduling', title: 'CPU scheduling' }, { id: 'lifecycle', title: 'Process lifecycle' }, { id: 'comm', title: 'Threads & communication' }] },
    { id: 'concurrency', title: 'Concurrency & deadlock', sections: [
      { id: 'sync', title: 'Synchronization' }, { id: 'deadlock', title: 'Deadlock' }] },
    { id: 'memory', title: 'Memory', sections: [
      { id: 'alloc', title: 'Allocation & reclaiming' }, { id: 'translation', title: 'Paging & address translation' },
      { id: 'virtual', title: 'Virtual memory behaviour' }, { id: 'caches', title: 'Caches & hardware' }] },
    { id: 'storage', title: 'Storage & I/O', sections: [
      { id: 'io', title: 'Disks & I/O' }, { id: 'fs', title: 'File systems & reliability' }] },
    { id: 'system', title: 'Kernel & security', sections: [
      { id: 'kernel', title: 'Kernel entry & boot' }, { id: 'protect', title: 'Protection & isolation' }] },
    { id: 'distributed', title: 'Distributed systems', sections: [
      { id: 'time', title: 'Time & ordering' }, { id: 'agree', title: 'Agreement & coordination' }] }
  ];
  const LEVELS = ['core', 'advanced'];
  const LABS = [];

  // validate(lab): list every problem with a lab description (empty list = fine).
  // register() throws on any problem so a typo in a lab file fails loudly at load time instead of
  // silently producing a half-empty screen.
  function validate(lab, existing) {
    const bad = [];
    const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
    const list = (v) => Array.isArray(v) && v.length > 0 && v.every(nonEmpty);
    if (!lab || typeof lab !== 'object') return ['lab is not an object'];
    ['id', 'title', 'view', 'summary'].forEach((k) => { if (!nonEmpty(lab[k])) bad.push('missing ' + k); });
    const area = AREAS.find((a) => a.id === lab.area);
    if (!area) bad.push('unknown area "' + lab.area + '"');
    else if (!area.sections.some((x) => x.id === lab.section)) bad.push('unknown section "' + lab.section + '" in area "' + lab.area + '"');
    if (!LEVELS.includes(lab.level)) bad.push('level must be core or advanced');
    if (!list(lab.keywords)) bad.push('keywords must be a non-empty list of text');
    const L = lab.learn || {};
    if (!nonEmpty(L.idea)) bad.push('learn.idea missing');
    if (!nonEmpty(L.hook)) bad.push('learn.hook missing');
    if (!list(L.deep)) bad.push('learn.deep must be a non-empty list of text');
    if (!list(L.mistakes)) bad.push('learn.mistakes must be a non-empty list of text');
    if (existing && existing.some((x) => x.id === lab.id)) bad.push('duplicate id "' + lab.id + '"');
    return bad;
  }

  function register(lab) {
    const bad = validate(lab, LABS);
    if (bad.length) throw new Error('Lab "' + (lab && lab.id) + '": ' + bad.join('; '));
    LABS.push(lab);
    return lab;
  }

  // compact(s): lower-case and drop everything except letters and digits, so "C-SCAN", "c scan" and
  // "cscan" all become the same string, and the search does not care about spacing or hyphens.
  const compact = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const words = (s) => String(s == null ? '' : s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  // score(text, q): how well does one piece of text match the compact query q?  0 = not at all.
  //   100 identical   80 starts with the query   70 a word in it starts with the query
  //   40 the query appears inside it (only for queries of 3+ characters, to avoid noise like "rr")
  function score(text, q) {
    const c = compact(text);
    if (!c || !q) return 0;
    if (c === q) return 100;
    if (c.startsWith(q)) return 80;
    if (words(text).some((w) => w.startsWith(q))) return 70;
    if (q.length >= 3 && c.includes(q)) return 40;
    return 0;
  }

  // search(query, opts): rank labs for a typed query. Each result is { lab, score, hit } where hit is
  // the keyword that matched (null when the title or summary matched). A lab's score is its best
  // single field: the title counts a little extra, the one-line summary a little less. Ties keep the
  // sidebar order. A query of several words that is not a phrase match falls back to matching each word
  // on its own. opts.limit (default 8) caps the list; opts.includeAdvanced (default true) filters.
  function search(query, opts) {
    const o = opts || {};
    const q = compact(query);
    if (!q) return [];
    const tokens = words(query).map(compact).filter(Boolean);
    const out = [];
    LABS.forEach((lab, order) => {
      if (o.includeAdvanced === false && lab.level === 'advanced') return;
      let best = Math.min(100, score(lab.title, q) + (score(lab.title, q) ? 10 : 0)), hit = null;
      lab.keywords.forEach((k) => { const s = score(k, q); if (s > best) { best = s; hit = k; } });
      const sum = q.length >= 3 && compact(lab.summary).includes(q) ? 15 : 0;
      if (sum > best) { best = sum; hit = null; }
      // Several words ("priority preemptive"): every word must match something in the lab. The lab
      // scores a little below a whole-phrase match, using its weakest word.
      if (best === 0 && tokens.length > 1) {
        const fields = [lab.title].concat(lab.keywords);
        const per = tokens.map((t) => Math.max.apply(null, fields.map((f) => score(f, t))));
        if (per.every((v) => v > 0)) {
          best = Math.round(Math.min.apply(null, per) * 0.8);
          hit = lab.keywords.find((k) => score(k, tokens[0]) > 0) || null;
        }
      }
      if (best > 0) out.push({ lab, score: best, hit, order });
    });
    out.sort((a, b) => b.score - a.score || a.order - b.order);
    return out.slice(0, o.limit || 8);
  }

  const areaTitle = (id) => (AREAS.find((a) => a.id === id) || {}).title || id;
  const sectionTitle = (area, id) => ((((AREAS.find((a) => a.id === area) || {}).sections) || []).find((x) => x.id === id) || {}).title || id;
  NS.labs = { AREAS, LEVELS, LABS, register, validate, search, areaTitle, sectionTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.labs;
})(typeof window !== 'undefined' ? window : globalThis);
