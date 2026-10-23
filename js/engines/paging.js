/* Page replacement engine (FIFO, LRU, Optimal, Clock, NRU, LFU, MFU, Aging counters). Pure logic, no DOM.
   steps[0] is the empty starting state; steps[k] is the state after reference k-1. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  // ALGOS: teaching text (rule, memory hook, pitfall) for each replacement policy. No results stored here.
  const ALGOS = [
    {
      id: 'fifo', short: 'FIFO', name: 'First In, First Out',
      rule: 'When memory is full, evict the page that has been in memory the longest, no matter how often it was used.',
      hook: 'A bouncer clearing a club: whoever walked in first is asked to leave first.',
      watch: 'Can evict a page that is used all the time. Belady’s anomaly: more frames can cause more faults.'
    },
    {
      id: 'lru', short: 'LRU', name: 'Least Recently Used',
      rule: 'When memory is full, evict the page whose last use was the longest time ago.',
      hook: 'The textbook you have not opened for the longest time goes back on the shelf.',
      watch: 'Needs the time of every use to be tracked, which is costly in hardware. A loop slightly bigger than memory defeats it.'
    },
    {
      id: 'opt', short: 'Optimal', name: 'Optimal (Belady’s OPT)',
      rule: 'When memory is full, evict the page that will not be needed for the longest time in the future.',
      hook: 'A fortune teller: she tells you which page you will need last. Impossible in real life, so it is the benchmark.',
      watch: 'Needs the future reference string, so real systems cannot use it. It shows the best any algorithm could do.'
    },
    {
      id: 'clock', short: 'Clock', name: 'Clock (second chance)',
      rule: 'Frames sit on a circle with a hand. Every page has a reference bit, set to 1 when the page is loaded or used. To evict, the hand sweeps: a page with bit 1 gets a second chance (bit cleared, hand moves on); the first page with bit 0 is evicted.',
      hook: 'A museum guard walking a circle of rooms: if a visitor moved since the last round, they get one more round; if not, they are asked to leave.',
      watch: 'If every bit is 1 the hand clears them all and comes back to where it started, so it behaves like FIFO. It only approximates LRU.'
    },
    {
      id: 'nru', short: 'NRU', name: 'Not Recently Used',
      rule: 'Each page has a reference bit that the hardware sets on use and the OS clears every few references. Evict a page whose bit is 0 (not used in the current period); if all bits are 1, evict the oldest.',
      hook: 'A fridge with a sticker: you flip the sticker when you take something, and clean the stickers every Sunday. Anything with no sticker is a candidate.',
      watch: 'Textbook NRU also uses a modified (dirty) bit to prefer clean pages. This tool has no read/write information, so only the reference bit is used. Ties go to the page loaded first.'
    },
    {
      id: 'lfu', short: 'LFU', name: 'Least Frequently Used',
      rule: 'Count how many times each resident page has been used. Evict the page with the smallest count (ties: the one loaded first).',
      hook: 'The least popular song is dropped from the playlist.',
      watch: 'A page used heavily long ago keeps a big count and never leaves, while a new page that is about to be popular starts at 1 and is evicted first.'
    },
    {
      id: 'mfu', short: 'MFU', name: 'Most Frequently Used',
      rule: 'Count how many times each resident page has been used. Evict the page with the largest count (ties: the one loaded first).',
      hook: 'The page used the most has surely done its job; the page with count 1 has only just arrived and is probably still needed.',
      watch: 'Rarely good in practice, because heavily used pages are usually the ones you still need. It is taught as the contrast to LFU.'
    },
    {
      id: 'aging', short: 'Aging', name: 'Aging (counter approximation of LRU)',
      rule: 'Each page has an 8-bit counter. After every reference, every resident page shifts its counter right by one and puts its reference bit in the left-most place. Evict the page with the smallest counter.',
      hook: 'A diary where the newest day is written in the biggest digit: recent use counts for much more than old use.',
      watch: 'Only 8 bits of history, so two pages that were both idle for 8+ steps look identical (ties go to the page loaded first). It is cheap enough for real hardware, unlike exact LRU.'
    }
  ];
  // The Compare tab chart draws these four lines only (eight lines are unreadable); the table lists all.
  const CHART_ALGOS = ['fifo', 'lru', 'opt', 'clock'];
  // BY_ID: lookup by id ('fifo', 'lru', 'opt').
  const BY_ID = {};
  ALGOS.forEach((a) => { BY_ID[a.id] = a; });

  // Input caps: reference-string length, number of frames, and characters per page name.
  const LIMITS = { maxRefs: 60, maxFrames: 10, maxTokenLen: 3 };

  // parseRefs(text): split the typed reference string into page names. Separators are spaces, commas or
  // semicolons. A single long digit string like '70120' is split into single digits (7 0 1 2 0), a common
  // exam shorthand; `splitDigits` tells the view so it can say so.
  function parseRefs(text) {
    let tokens = String(text).split(/[\s,;]+/).filter(Boolean);
    let split = false;
    if (tokens.length === 1 && /^\d+$/.test(tokens[0]) && tokens[0].length > 1) { tokens = tokens[0].split(''); split = true; }
    return { tokens, splitDigits: split };
  }

  // validate: readable error messages for empty input, too many references, over-long names, bad frame count.
  function validate(refs, nFrames) {
    const errors = [];
    if (!refs.length) errors.push('Enter at least one page number.');
    if (refs.length > LIMITS.maxRefs) errors.push('Use at most ' + LIMITS.maxRefs + ' page references.');
    if (refs.some((r) => r.length > LIMITS.maxTokenLen)) errors.push('Page names can be up to ' + LIMITS.maxTokenLen + ' characters.');
    if (!Number.isInteger(+nFrames) || +nFrames < 1 || +nFrames > LIMITS.maxFrames) errors.push('Frames must be a whole number from 1 to ' + LIMITS.maxFrames + '.');
    return { ok: errors.length === 0, errors };
  }

  // nextUse: index of the next reference to `page` after position `from`, or Infinity if it is never
  // used again. This is the 'look into the future' that makes Optimal impossible in a real OS.
  function nextUse(refs, from, page) {
    for (let j = from + 1; j < refs.length; j++) if (refs[j] === page) return j;
    return Infinity;
  }

  // simulate: run the reference string against `nFrames` frames, recording one step per reference.
  // step 0 = empty memory; step k = state after reference k-1. Each step stores the frames, whether it
  // was a hit, which slot changed, the victim, the candidates considered, running counts, and an
  // explanation sentence. Nothing is looked up from a table: faults and hits fall out of the loop.
  function simulate(refs, nFrames, algoId, config) {
    // optTie: when several pages are never used again, Optimal can break the tie by FIFO order or by
    // lowest frame number; textbooks differ, so it is a switch.
    const cfg = Object.assign({ optTie: 'fifo', nruClear: 4 }, config);
    const nruEvery = Math.max(1, Math.floor(+cfg.nruClear) || 4);
    const n = +nFrames;
    const frames = new Array(n).fill(null);
    // Per-page bookkeeping: loadedAt (step it entered memory, used by FIFO) and lastUsed (used by LRU).
    const loadedAt = {}, lastUsed = {};
    // Extra state for the newer policies: reference bits, use counts, 8-bit age counters, and the clock hand.
    const refBit = {}, freq = {}, counter = {};
    let hand = 0;
    const bin8 = (v) => v.toString(2).padStart(8, '0');
    let faults = 0, hits = 0;

    // meta(i): the ordered list shown under the frames (next victim first), different for each policy:
    // FIFO sorts by load time, LRU by last use, Optimal by how far away the next use is.
    const meta = (i) => {
      const res = frames.filter((p) => p !== null);
      if (algoId === 'fifo') return { title: 'Eviction order (next victim first)', items: res.slice().sort((a, b) => loadedAt[a] - loadedAt[b]).map((p) => ({ page: p, note: 'in since step ' + (loadedAt[p] + 1) })) };
      if (algoId === 'lru') return { title: 'Recency (least recently used first)', items: res.slice().sort((a, b) => lastUsed[a] - lastUsed[b]).map((p) => ({ page: p, note: 'used at step ' + (lastUsed[p] + 1) })) };
      if (algoId === 'clock') {
        // Frames in circle order starting at the hand: the first one listed is examined first.
        const order = [];
        for (let k = 0; k < n; k++) { const sl = (hand + k) % n; if (frames[sl] !== null) order.push(frames[sl]); }
        return { title: 'Clock face (hand points at the first page)', items: order.map((p, idx) => ({ page: p, note: 'ref bit ' + refBit[p] + (idx === 0 ? ' ◀ hand' : '') })) };
      }
      if (algoId === 'nru') return { title: 'Reference bits (bit 0 goes first, then oldest)', items: res.slice().sort((a, b) => refBit[a] - refBit[b] || loadedAt[a] - loadedAt[b]).map((p) => ({ page: p, note: 'R = ' + refBit[p] })) };
      if (algoId === 'lfu') return { title: 'Use count (fewest first)', items: res.slice().sort((a, b) => freq[a] - freq[b] || loadedAt[a] - loadedAt[b]).map((p) => ({ page: p, note: 'used ' + freq[p] + '×' })) };
      if (algoId === 'mfu') return { title: 'Use count (most first)', items: res.slice().sort((a, b) => freq[b] - freq[a] || loadedAt[a] - loadedAt[b]).map((p) => ({ page: p, note: 'used ' + freq[p] + '×' })) };
      if (algoId === 'aging') return { title: 'Age counters (smallest first)', items: res.slice().sort((a, b) => counter[a] - counter[b] || loadedAt[a] - loadedAt[b]).map((p) => ({ page: p, note: bin8(counter[p]) })) };
      const nu = {};
      res.forEach((p) => { nu[p] = nextUse(refs, i, p); });
      return { title: 'Next use (farthest first)', items: res.slice().sort((a, b) => (nu[b] === nu[a] ? loadedAt[a] - loadedAt[b] : nu[b] - nu[a])).map((p) => ({ page: p, note: nu[p] === Infinity ? 'never again' : 'at step ' + (nu[p] + 1) })) };
    };

    // Step 0: memory is empty, before any reference.
    const steps = [{
      i: -1, page: null, hit: null, frames: frames.slice(), slot: -1, victim: null, cands: [],
      faults: 0, hits: 0, text: 'Memory starts empty: all ' + n + ' frame' + (n === 1 ? ' is' : 's are') + ' free. Press Step to process the first reference.',
      meta: meta(-1)
    }];

    // Process each reference in order.
    for (let i = 0; i < refs.length; i++) {
      const page = refs[i];
      let hit = false, slot = frames.indexOf(page), victim = null, cands = [], text = '';
      if (slot >= 0) {
        // HIT: the page is already in a frame. Only LRU's recency changes (lastUsed); FIFO ignores hits.
        hit = true; hits++; lastUsed[page] = i;
        refBit[page] = 1; freq[page] = (freq[page] || 0) + 1;
        const extra = {
          fifo: ' FIFO does not reorder on a hit.', lru: ' It is now the most recently used page.',
          clock: ' Its reference bit is set to 1, so the hand will give it a second chance.',
          nru: ' Its reference bit is set to 1.', lfu: ' Its use count goes up to ' + freq[page] + '.', mfu: ' Its use count goes up to ' + freq[page] + '.',
          aging: ' Its reference bit is set; it enters the counter at the end of this step.'
        }[algoId] || ' Nothing changes.';
        text = 'Page ' + page + ' is already in frame ' + slot + ': a hit, no disk read needed.' + extra;
      } else {
        // FAULT: the page is not in memory, so it must be loaded from disk.
        faults++;
        // If any frame is free, use it: no eviction is needed.
        slot = frames.indexOf(null);
        if (slot >= 0) {
          text = 'Page ' + page + ' is not in memory: a page fault. Frame ' + slot + ' is free, so ' + page + ' loads there and nothing is evicted.';
        } else {
          // Memory is full: pick a victim with the selected policy.
          const res = frames.slice();
          // FIFO: victim = page with the oldest load time.
          if (algoId === 'fifo') {
            cands = res.map((p) => ({ page: p, value: loadedAt[p] + 1, label: 'loaded at step ' + (loadedAt[p] + 1) })).sort((a, b) => a.value - b.value);
            victim = cands[0].page;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. FIFO evicts ' + victim + ' because it has been in memory the longest (loaded at step ' + cands[0].value + ').';
          // LRU: victim = page with the oldest last-use time.
          } else if (algoId === 'lru') {
            cands = res.map((p) => ({ page: p, value: lastUsed[p] + 1, label: 'last used at step ' + (lastUsed[p] + 1) })).sort((a, b) => a.value - b.value);
            victim = cands[0].page;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. LRU evicts ' + victim + ' because it was used least recently (last used at step ' + cands[0].value + ').';
          } else if (algoId === 'clock') {
            // Clock: sweep from the hand. Bit 1 -> clear it and move on (second chance); bit 0 -> evict.
            const seen = [];
            let guard = 0;
            while (refBit[frames[hand]] === 1 && guard++ <= n) { seen.push({ page: frames[hand], value: 1, label: 'bit 1: cleared, second chance' }); refBit[frames[hand]] = 0; hand = (hand + 1) % n; }
            victim = frames[hand];
            seen.push({ page: victim, value: 0, label: 'bit 0: evicted' });
            cands = seen;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. ' + (seen.length > 1
              ? 'The clock hand clears the reference bit of ' + seen.slice(0, -1).map((c) => c.page).join(', ') + ' (second chance) and stops at ' + victim + ', whose bit is 0. ' + victim + ' is evicted.'
              : 'The clock hand is on ' + victim + ' and its reference bit is 0, so ' + victim + ' is evicted.');
            if (seen.length > n) text += ' Every bit was 1, so the hand went all the way round.';
          } else if (algoId === 'nru') {
            cands = res.map((p) => ({ page: p, value: refBit[p], label: 'R = ' + refBit[p] + ', loaded at step ' + (loadedAt[p] + 1), t: loadedAt[p] })).sort((a, b) => a.value - b.value || a.t - b.t);
            victim = cands[0].page;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. NRU evicts ' + victim + ' ' + (cands[0].value === 0
              ? 'because its reference bit is 0 (not used since the bits were last cleared)' + (cands.filter((c) => c.value === 0).length > 1 ? '; several pages have bit 0, so the one loaded first goes' : '') + '.'
              : 'because every page was used recently (all bits are 1), so the oldest page goes.');
          } else if (algoId === 'lfu' || algoId === 'mfu') {
            const most = algoId === 'mfu';
            cands = res.map((p) => ({ page: p, value: freq[p], label: 'used ' + freq[p] + '×', t: loadedAt[p] })).sort((a, b) => (most ? b.value - a.value : a.value - b.value) || a.t - b.t);
            victim = cands[0].page;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. ' + (most ? 'MFU' : 'LFU') + ' evicts ' + victim + ' because it has the ' + (most ? 'largest' : 'smallest') + ' use count (' + cands[0].value + ').' +
              (cands.length > 1 && cands[1].value === cands[0].value ? ' Several pages tie, so the one loaded first goes.' : '');
          } else if (algoId === 'aging') {
            cands = res.map((p) => ({ page: p, value: counter[p], label: bin8(counter[p]), t: loadedAt[p] })).sort((a, b) => a.value - b.value || a.t - b.t);
            victim = cands[0].page;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. Aging evicts ' + victim + ' because its counter (' + bin8(cands[0].value) + ') is the smallest, so it was used least recently.' +
              (cands.length > 1 && cands[1].value === cands[0].value ? ' Several counters tie, so the one loaded first goes.' : '');
          } else {
            // Optimal: victim = page whose next use is farthest away (Infinity = never used again).
            // Ties are broken by the optTie setting.
            cands = res.map((p) => {
              const nu = nextUse(refs, i, p);
              return { page: p, value: nu, label: nu === Infinity ? 'never used again' : 'next used at step ' + (nu + 1), t: loadedAt[p] };
            }).sort((a, b) => {
              if (a.value !== b.value) return b.value - a.value;
              return cfg.optTie === 'slot' ? frames.indexOf(a.page) - frames.indexOf(b.page) : a.t - b.t;
            });
            victim = cands[0].page;
            const never = cands.filter((c) => c.value === Infinity).length;
            text = 'Page ' + page + ' is not in memory: a page fault, and memory is full. Optimal looks ahead and evicts ' + victim + ' because ' +
              (cands[0].value === Infinity ? 'it is never used again.' : 'it is needed farthest in the future (step ' + (cands[0].value + 1) + ').');
            if (never > 1) text += ' ' + never + ' pages are never used again; ' + (cfg.optTie === 'slot' ? 'the one in the lowest frame' : 'the one that has been in memory longest') + ' is chosen.';
          }
          slot = frames.indexOf(victim);
        }
        // Place the new page in its frame and record when it was loaded and used.
        frames[slot] = page; loadedAt[page] = i; lastUsed[page] = i;
        refBit[page] = 1; freq[page] = 1; counter[page] = 0;
        if (algoId === 'clock') hand = (slot + 1) % n; // the hand moves past the frame just filled
      }
      // End-of-step upkeep. Aging: every resident page shifts its counter right and inserts its reference
      // bit on the left, then the bit is cleared. NRU: every few references all reference bits are cleared.
      if (algoId === 'aging') frames.forEach((p) => { if (p !== null) { counter[p] = (counter[p] >> 1) | (refBit[p] << 7); refBit[p] = 0; } });
      let cleared = false;
      if (algoId === 'nru' && (i + 1) % nruEvery === 0) { frames.forEach((p) => { if (p !== null) refBit[p] = 0; }); cleared = true; text += ' After this reference all reference bits are cleared (every ' + nruEvery + ' references).'; }
      steps.push({
        i, page, hit, frames: frames.slice(), slot, victim, cands,
        faults, hits, text, meta: meta(i), hand: algoId === 'clock' ? hand : null, cleared
      });
    }

    // Summary ratios for the results panel.
    const total = refs.length;
    return { algo: algoId, refs, nFrames: n, steps, faults, hits, hitRatio: total ? hits / total : 0, faultRatio: total ? faults / total : 0 };
  }

  // sweep: run the same string with 1..maxFrames frames and collect the fault counts.
  // This feeds the faults-versus-frames chart.
  function sweep(refs, algoId, maxFrames, config) {
    const out = [];
    for (let f = 1; f <= maxFrames; f++) out.push(simulate(refs, f, algoId, config).faults);
    return out; // out[k] = faults with k+1 frames
  }

  // anomalies: find Belady's anomaly, i.e. places where *adding* a frame *increased* faults.
  // (Possible with FIFO; impossible with LRU and Optimal, which are stack algorithms.)
  function anomalies(faultsByFrames) {
    const res = [];
    for (let k = 1; k < faultsByFrames.length; k++)
      if (faultsByFrames[k] > faultsByFrames[k - 1]) res.push({ from: k, to: k + 1, before: faultsByFrames[k - 1], after: faultsByFrames[k] });
    return res;
  }

  // Classic reference strings as INPUTS (answers are computed, not stored).
  const PRESETS = [
    { id: 'galvin', name: 'Textbook string, 3 frames', frames: 3, refs: '7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1', note: 'The classic 20-reference string. Compare all three algorithms.' },
    { id: 'belady', name: 'Belady’s anomaly', frames: 3, algo: 'fifo', refs: '1 2 3 4 1 2 5 1 2 3 4 5', note: 'Run FIFO with 3 frames, then 4 frames. Then open Compare.' },
    { id: 'loop', name: 'Loop bigger than memory', frames: 3, refs: '1 2 3 4 1 2 3 4 1 2 3 4', note: 'A loop over 4 pages with 3 frames is a bad case for FIFO and LRU.' },
    { id: 'locality', name: 'Good locality', frames: 3, refs: '1 2 1 2 3 1 2 1 3 2 1 2 4 1 2 1 2 4 1 2', note: 'A few pages are used again and again, so LRU does well.' }
  ];

  NS.paging = { CHART_ALGOS, ALGOS, BY_ID, LIMITS, PRESETS, parseRefs, validate, simulate, sweep, anomalies };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.paging;
})(typeof window !== 'undefined' ? window : globalThis);
