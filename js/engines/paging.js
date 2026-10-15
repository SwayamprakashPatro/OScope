/* Page replacement engine (FIFO, LRU, Optimal). Pure logic, no DOM.
   steps[0] is the empty starting state; steps[k] is the state after reference k-1. */
(function (root) {
  "use strict";
  const NS = (root.OSViz = root.OSViz || {});

  // ALGOS: teaching text (rule, memory hook, pitfall) for each replacement policy. No results stored here.
  const ALGOS = [
    {
      id: "fifo",
      short: "FIFO",
      name: "First In, First Out",
      rule: "When memory is full, evict the page that has been in memory the longest, no matter how often it was used.",
      hook: "A bouncer clearing a club: whoever walked in first is asked to leave first.",
      watch:
        "Can evict a page that is used all the time. Belady’s anomaly: more frames can cause more faults.",
    },
    {
      id: "lru",
      short: "LRU",
      name: "Least Recently Used",
      rule: "When memory is full, evict the page whose last use was the longest time ago.",
      hook: "The textbook you have not opened for the longest time goes back on the shelf.",
      watch:
        "Needs the time of every use to be tracked, which is costly in hardware. A loop slightly bigger than memory defeats it.",
    },
    {
      id: "opt",
      short: "Optimal",
      name: "Optimal (Belady’s OPT)",
      rule: "When memory is full, evict the page that will not be needed for the longest time in the future.",
      hook: "A fortune teller: she tells you which page you will need last. Impossible in real life, so it is the benchmark.",
      watch:
        "Needs the future reference string, so real systems cannot use it. It shows the best any algorithm could do.",
    },
  ];
  // BY_ID: lookup by id ('fifo', 'lru', 'opt').
  const BY_ID = {};
  ALGOS.forEach((a) => {
    BY_ID[a.id] = a;
  });

  // Input caps: reference-string length, number of frames, and characters per page name.
  const LIMITS = { maxRefs: 60, maxFrames: 10, maxTokenLen: 3 };

  // parseRefs(text): split the typed reference string into page names. Separators are spaces, commas or
  // semicolons. A single long digit string like '70120' is split into single digits (7 0 1 2 0), a common
  // exam shorthand; `splitDigits` tells the view so it can say so.
  function parseRefs(text) {
    let tokens = String(text)
      .split(/[\s,;]+/)
      .filter(Boolean);
    let split = false;
    if (
      tokens.length === 1 &&
      /^\d+$/.test(tokens[0]) &&
      tokens[0].length > 1
    ) {
      tokens = tokens[0].split("");
      split = true;
    }
    return { tokens, splitDigits: split };
  }

  // validate: readable error messages for empty input, too many references, over-long names, bad frame count.
  function validate(refs, nFrames) {
    const errors = [];
    if (!refs.length) errors.push("Enter at least one page number.");
    if (refs.length > LIMITS.maxRefs)
      errors.push("Use at most " + LIMITS.maxRefs + " page references.");
    if (refs.some((r) => r.length > LIMITS.maxTokenLen))
      errors.push(
        "Page names can be up to " + LIMITS.maxTokenLen + " characters.",
      );
    if (
      !Number.isInteger(+nFrames) ||
      +nFrames < 1 ||
      +nFrames > LIMITS.maxFrames
    )
      errors.push(
        "Frames must be a whole number from 1 to " + LIMITS.maxFrames + ".",
      );
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
    const cfg = Object.assign({ optTie: "fifo" }, config);
    const n = +nFrames;
    const frames = new Array(n).fill(null);
    // Per-page bookkeeping: loadedAt (step it entered memory, used by FIFO) and lastUsed (used by LRU).
    const loadedAt = {},
      lastUsed = {};
    let faults = 0,
      hits = 0;

    // meta(i): the ordered list shown under the frames (next victim first), different for each policy:
    // FIFO sorts by load time, LRU by last use, Optimal by how far away the next use is.
    const meta = (i) => {
      const res = frames.filter((p) => p !== null);
      if (algoId === "fifo")
        return {
          title: "Eviction order (next victim first)",
          items: res
            .slice()
            .sort((a, b) => loadedAt[a] - loadedAt[b])
            .map((p) => ({
              page: p,
              note: "in since step " + (loadedAt[p] + 1),
            })),
        };
      if (algoId === "lru")
        return {
          title: "Recency (least recently used first)",
          items: res
            .slice()
            .sort((a, b) => lastUsed[a] - lastUsed[b])
            .map((p) => ({
              page: p,
              note: "used at step " + (lastUsed[p] + 1),
            })),
        };
      const nu = {};
      res.forEach((p) => {
        nu[p] = nextUse(refs, i, p);
      });
      return {
        title: "Next use (farthest first)",
        items: res
          .slice()
          .sort((a, b) =>
            nu[b] === nu[a] ? loadedAt[a] - loadedAt[b] : nu[b] - nu[a],
          )
          .map((p) => ({
            page: p,
            note: nu[p] === Infinity ? "never again" : "at step " + (nu[p] + 1),
          })),
      };
    };

    // Step 0: memory is empty, before any reference.
    const steps = [
      {
        i: -1,
        page: null,
        hit: null,
        frames: frames.slice(),
        slot: -1,
        victim: null,
        cands: [],
        faults: 0,
        hits: 0,
        text:
          "Memory starts empty: all " +
          n +
          " frame" +
          (n === 1 ? " is" : "s are") +
          " free. Press Step to process the first reference.",
        meta: meta(-1),
      },
    ];

    // Process each reference in order.
    for (let i = 0; i < refs.length; i++) {
      const page = refs[i];
      let hit = false,
        slot = frames.indexOf(page),
        victim = null,
        cands = [],
        text = "";
      if (slot >= 0) {
        // HIT: the page is already in a frame. Only LRU's recency changes (lastUsed); FIFO ignores hits.
        hit = true;
        hits++;
        lastUsed[page] = i;
        const extra =
          algoId === "fifo"
            ? " FIFO does not reorder on a hit."
            : algoId === "lru"
              ? " It is now the most recently used page."
              : " Nothing changes.";
        text =
          "Page " +
          page +
          " is already in frame " +
          slot +
          ": a hit, no disk read needed." +
          extra;
      } else {
        // FAULT: the page is not in memory, so it must be loaded from disk.
        faults++;
        // If any frame is free, use it: no eviction is needed.
        slot = frames.indexOf(null);
        if (slot >= 0) {
          text =
            "Page " +
            page +
            " is not in memory: a page fault. Frame " +
            slot +
            " is free, so " +
            page +
            " loads there and nothing is evicted.";
        } else {
          // Memory is full: pick a victim with the selected policy.
          const res = frames.slice();
          // FIFO: victim = page with the oldest load time.
          if (algoId === "fifo") {
            cands = res
              .map((p) => ({
                page: p,
                value: loadedAt[p] + 1,
                label: "loaded at step " + (loadedAt[p] + 1),
              }))
              .sort((a, b) => a.value - b.value);
            victim = cands[0].page;
            text =
              "Page " +
              page +
              " is not in memory: a page fault, and memory is full. FIFO evicts " +
              victim +
              " because it has been in memory the longest (loaded at step " +
              cands[0].value +
              ").";
            // LRU: victim = page with the oldest last-use time.
          } else if (algoId === "lru") {
            cands = res
              .map((p) => ({
                page: p,
                value: lastUsed[p] + 1,
                label: "last used at step " + (lastUsed[p] + 1),
              }))
              .sort((a, b) => a.value - b.value);
            victim = cands[0].page;
            text =
              "Page " +
              page +
              " is not in memory: a page fault, and memory is full. LRU evicts " +
              victim +
              " because it was used least recently (last used at step " +
              cands[0].value +
              ").";
          } else {
            // Optimal: victim = page whose next use is farthest away (Infinity = never used again).
            // Ties are broken by the optTie setting.
            cands = res
              .map((p) => {
                const nu = nextUse(refs, i, p);
                return {
                  page: p,
                  value: nu,
                  label:
                    nu === Infinity
                      ? "never used again"
                      : "next used at step " + (nu + 1),
                  t: loadedAt[p],
                };
              })
              .sort((a, b) => {
                if (a.value !== b.value) return b.value - a.value;
                return cfg.optTie === "slot"
                  ? frames.indexOf(a.page) - frames.indexOf(b.page)
                  : a.t - b.t;
              });
            victim = cands[0].page;
            const never = cands.filter((c) => c.value === Infinity).length;
            text =
              "Page " +
              page +
              " is not in memory: a page fault, and memory is full. Optimal looks ahead and evicts " +
              victim +
              " because " +
              (cands[0].value === Infinity
                ? "it is never used again."
                : "it is needed farthest in the future (step " +
                  (cands[0].value + 1) +
                  ").");
            if (never > 1)
              text +=
                " " +
                never +
                " pages are never used again; " +
                (cfg.optTie === "slot"
                  ? "the one in the lowest frame"
                  : "the one that has been in memory longest") +
                " is chosen.";
          }
          slot = frames.indexOf(victim);
        }
        // Place the new page in its frame and record when it was loaded and used.
        frames[slot] = page;
        loadedAt[page] = i;
        lastUsed[page] = i;
      }
      steps.push({
        i,
        page,
        hit,
        frames: frames.slice(),
        slot,
        victim,
        cands,
        faults,
        hits,
        text,
        meta: meta(i),
      });
    }

    // Summary ratios for the results panel.
    const total = refs.length;
    return {
      algo: algoId,
      refs,
      nFrames: n,
      steps,
      faults,
      hits,
      hitRatio: total ? hits / total : 0,
      faultRatio: total ? faults / total : 0,
    };
  }

  // sweep: run the same string with 1..maxFrames frames and collect the fault counts.
  // This feeds the faults-versus-frames chart.
  function sweep(refs, algoId, maxFrames, config) {
    const out = [];
    for (let f = 1; f <= maxFrames; f++)
      out.push(simulate(refs, f, algoId, config).faults);
    return out; // out[k] = faults with k+1 frames
  }

  // anomalies: find Belady's anomaly, i.e. places where *adding* a frame *increased* faults.
  // (Possible with FIFO; impossible with LRU and Optimal, which are stack algorithms.)
  function anomalies(faultsByFrames) {
    const res = [];
    for (let k = 1; k < faultsByFrames.length; k++)
      if (faultsByFrames[k] > faultsByFrames[k - 1])
        res.push({
          from: k,
          to: k + 1,
          before: faultsByFrames[k - 1],
          after: faultsByFrames[k],
        });
    return res;
  }

  // Classic reference strings as INPUTS (answers are computed, not stored).
  const PRESETS = [
    {
      id: "galvin",
      name: "Textbook string, 3 frames",
      frames: 3,
      refs: "7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1",
      note: "The classic 20-reference string. Compare all three algorithms.",
    },
    {
      id: "belady",
      name: "Belady’s anomaly",
      frames: 3,
      algo: "fifo",
      refs: "1 2 3 4 1 2 5 1 2 3 4 5",
      note: "Run FIFO with 3 frames, then 4 frames. Then open Compare.",
    },
    {
      id: "loop",
      name: "Loop bigger than memory",
      frames: 3,
      refs: "1 2 3 4 1 2 3 4 1 2 3 4",
      note: "A loop over 4 pages with 3 frames is a bad case for FIFO and LRU.",
    },
    {
      id: "locality",
      name: "Good locality",
      frames: 3,
      refs: "1 2 1 2 3 1 2 1 3 2 1 2 4 1 2 1 2 4 1 2",
      note: "A few pages are used again and again, so LRU does well.",
    },
  ];

  NS.paging = {
    ALGOS,
    BY_ID,
    LIMITS,
    PRESETS,
    parseRefs,
    validate,
    simulate,
    sweep,
    anomalies,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = NS.paging;
})(typeof window !== "undefined" ? window : globalThis);
