/* Memory allocation engine: First / Best / Worst / Next Fit, fragmentation, free + merge, compaction.
   Pure logic. Memory is an ordered list of blocks {start, size, pid, req}. */
(function (root) {
  "use strict";
  const NS = (root.OSViz = root.OSViz || {});

  // ALGOS: teaching text (rule, memory hook, pitfall) for each placement strategy.
  const ALGOS = [
    {
      id: "first",
      short: "First Fit",
      name: "First Fit",
      rule: "Scan the holes from the start of memory and take the first one big enough.",
      hook: "Grab the first seat that fits you.",
      watch:
        "Quick, but it chews up the start of memory and leaves small holes there.",
    },
    {
      id: "best",
      short: "Best Fit",
      name: "Best Fit",
      rule: "Look at every hole and take the smallest one that is still big enough.",
      hook: "The tightest fit, like a key in a lock. The leftover is often a tiny useless crumb.",
      watch:
        "Needs a full scan, and it creates many tiny holes (external fragmentation).",
    },
    {
      id: "worst",
      short: "Worst Fit",
      name: "Worst Fit",
      rule: "Look at every hole and take the largest one.",
      hook: "Take the biggest room so the leftover is still big enough to use.",
      watch:
        "It burns through the big holes, so a large request can fail later.",
    },
    {
      id: "next",
      short: "Next Fit",
      name: "Next Fit",
      rule: "Like First Fit, but the scan starts where the last placement ended and wraps around.",
      hook: "First Fit that keeps walking forward instead of going back to the start.",
      watch:
        "Spreads allocations across memory and tends to break up the big hole at the end.",
    },
  ];
  const BY_ID = {};
  ALGOS.forEach((a) => {
    BY_ID[a.id] = a;
  });

  // Input caps (blocks, size, operations, name length) so nothing can hang the page.
  const LIMITS = { maxBlocks: 16, maxSize: 100000, maxOps: 40, maxName: 6 };

  // parseLayout: '100 500 200' (or commas) -> [100, 500, 200], the sizes of the initial memory blocks.
  const parseLayout = (text) =>
    String(text)
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number);

  // validate: check the layout and replay the operation list *symbolically* with a set of live names, so it can
  // report mistakes before simulating: duplicate names, freeing something not in memory, compaction in
  // fixed-partition mode, bad sizes.
  function validate(layout, ops, cfg) {
    const errors = [];
    if (!layout.length) errors.push("Enter at least one memory block size.");
    if (layout.length > LIMITS.maxBlocks)
      errors.push("Use at most " + LIMITS.maxBlocks + " blocks.");
    if (layout.some((s) => !Number.isInteger(s) || s < 1 || s > LIMITS.maxSize))
      errors.push(
        "Block sizes must be whole numbers from 1 to " + LIMITS.maxSize + ".",
      );
    if (ops.length > LIMITS.maxOps)
      errors.push("Use at most " + LIMITS.maxOps + " operations.");
    const live = new Set();
    ops.forEach((o, i) => {
      const n = i + 1;
      if (o.op === "alloc") {
        if (!o.name || o.name.length > LIMITS.maxName)
          errors.push("Step " + n + ": give the process a short name.");
        else if (live.has(o.name))
          errors.push(
            "Step " +
              n +
              ": " +
              o.name +
              " is already in memory. Free it first or use another name.",
          );
        if (
          !Number.isInteger(+o.size) ||
          +o.size < 1 ||
          +o.size > LIMITS.maxSize
        )
          errors.push(
            "Step " +
              n +
              ": size must be a whole number from 1 to " +
              LIMITS.maxSize +
              ".",
          );
        live.add(o.name);
      } else if (o.op === "free") {
        if (!live.has(o.name))
          errors.push(
            "Step " +
              n +
              ": " +
              (o.name || "that process") +
              " is not in memory, so it cannot be freed. (A request that failed earlier is never placed.)",
          );
        live.delete(o.name);
      } else if (o.op === "compact") {
        if (cfg && !cfg.split)
          errors.push(
            "Step " +
              n +
              ': compaction needs variable partitions. Switch the mode to "Split leftover".',
          );
      } else errors.push("Step " + n + ": unknown operation.");
    });
    return { ok: !errors.length, errors };
  }

  // snap: copy the block list so each frame keeps its own immutable picture of memory.
  const snap = (blocks) => blocks.map((b) => Object.assign({}, b));

  // stats: the numbers shown under the memory bar.
  //   free        = total size of all holes     largest = biggest single hole
  //   internal    = waste inside allocated blocks (block size - requested size)
  //   extFrag     = share of free space NOT in the largest hole = (free - largest) / free
  //   utilization = requested units in use / total memory
  function stats(blocks, total) {
    const holes = blocks.filter((b) => b.pid === null);
    const free = holes.reduce((s, b) => s + b.size, 0);
    const largest = holes.reduce((m, b) => Math.max(m, b.size), 0);
    const internal = blocks.reduce(
      (s, b) => s + (b.pid !== null ? b.size - b.req : 0),
      0,
    );
    const used = blocks.reduce((s, b) => s + (b.pid !== null ? b.req : 0), 0);
    return {
      total,
      free,
      largest,
      holes: holes.length,
      internal,
      used,
      utilization: total ? (used / total) * 100 : 0,
      extFrag: free ? ((free - largest) / free) * 100 : 0,
    };
  }

  // simulate: run the operations (alloc / free / compact) in order against the memory layout.
  // Memory is an ordered list of blocks { start, size, pid, req } where pid === null means a hole.
  // Each operation pushes one or two frames (a 'search' frame showing which holes were examined, then a
  // 'result' frame), so the Player can step through the placement decision.
  function simulate(layoutSizes, ops, config) {
    // split = true: variable partitions (a placed process splits its hole, leaving a new hole).
    // split = false: fixed partitions (the process takes the whole block, wasting the rest = internal fragmentation).
    const cfg = Object.assign({ algo: "first", split: true }, config);
    let addr = 0;
    let blocks = layoutSizes.map((s) => {
      const b = { start: addr, size: s, pid: null, req: 0 };
      addr += s;
      return b;
    });
    const total = addr;
    // Next Fit's roving pointer: the address where the next scan begins.
    let ptr = 0; // Next Fit: address where the next scan begins
    const frames = [];
    const placed = {}; // name -> block start (last placement) or null when failed
    const names = [];

    // push(f): finish a frame by attaching a snapshot of memory, its statistics and the pointer, then store it.
    const push = (f) => {
      f.blocks = snap(blocks);
      f.stats = stats(blocks, total);
      f.ptr = ptr;
      frames.push(f);
    };
    push({
      op: null,
      phase: "start",
      text:
        "Memory starts with " +
        blocks.length +
        " block" +
        (blocks.length === 1 ? "" : "s") +
        " (" +
        total +
        " units in all), all free. Press Step to run the first operation.",
    });

    ops.forEach((o, oi) => {
      if (o.op === "alloc") {
        // ALLOCATE: find a hole with the chosen strategy.
        const req = +o.size;
        if (!names.includes(o.name)) names.push(o.name);
        const holes = blocks.filter((b) => b.pid === null);
        // Candidate holes in the order the strategy examines them. Next Fit rotates the list so the scan
        // starts at the first hole at or after the pointer and wraps around.
        let order;
        if (cfg.algo === "next") {
          const k = holes.findIndex((h) => h.start >= ptr);
          order =
            k < 0 ? holes.slice() : holes.slice(k).concat(holes.slice(0, k));
        } else order = holes.slice();
        const search = [];
        let chosen = null;
        // First / Next Fit stop at the first hole that is big enough.
        if (cfg.algo === "first" || cfg.algo === "next") {
          for (const h of order) {
            const fits = h.size >= req;
            search.push({ start: h.start, size: h.size, fits });
            if (fits) {
              chosen = h;
              break;
            }
          }
        } else {
          // Best / Worst Fit examine every hole, then choose among those that fit:
          // Best = the smallest that fits (least leftover), Worst = the largest.
          order.forEach((h) =>
            search.push({ start: h.start, size: h.size, fits: h.size >= req }),
          );
          const fit = order.filter((h) => h.size >= req);
          if (fit.length) {
            chosen = fit.reduce((best, h) => {
              if (cfg.algo === "best") return h.size < best.size ? h : best;
              return h.size > best.size ? h : best;
            });
          }
        }
        if (chosen)
          search.forEach((s) => {
            s.chosen = s.start === chosen.start;
          });
        // Sentence explaining the strategy's choice, for the Why panel.
        const rule = {
          first:
            "First Fit takes the first hole that is big enough" +
            (chosen
              ? ": the hole at " + chosen.start + " (size " + chosen.size + ")."
              : "."),
          next:
            "Next Fit starts scanning at address " +
            ptr +
            " and takes the first hole that is big enough" +
            (chosen
              ? ": the hole at " + chosen.start + " (size " + chosen.size + ")."
              : "."),
          best:
            "Best Fit compares every hole that fits and takes the smallest" +
            (chosen
              ? ": the hole at " + chosen.start + " (size " + chosen.size + ")."
              : "."),
          worst:
            "Worst Fit compares every hole that fits and takes the largest" +
            (chosen
              ? ": the hole at " + chosen.start + " (size " + chosen.size + ")."
              : "."),
        }[cfg.algo];
        const listing = search.length
          ? "Holes checked (sizes): " +
            search
              .map((s) => s.size + (s.fits ? " fits" : " too small"))
              .join(", ") +
            ". "
          : "There are no free holes. ";
        push({
          op: o,
          opIndex: oi,
          phase: "search",
          search,
          chosenStart: chosen ? chosen.start : null,
          text:
            o.name +
            " asks for " +
            req +
            ". " +
            listing +
            (chosen ? rule : "No hole is big enough."),
        });
        if (chosen) {
          const idx = blocks.indexOf(chosen);
          let leftover = 0,
            note;
          // Variable partitions: replace the hole with [allocated block][leftover hole]. Next Fit's pointer moves
          // to just after the new block.
          if (cfg.split && chosen.size > req) {
            leftover = chosen.size - req;
            blocks.splice(
              idx,
              1,
              { start: chosen.start, size: req, pid: o.name, req },
              { start: chosen.start + req, size: leftover, pid: null, req: 0 },
            );
            note =
              o.name +
              " is placed at " +
              chosen.start +
              ". The leftover " +
              leftover +
              " becomes a new hole at " +
              (chosen.start + req) +
              ".";
            ptr = chosen.start + req;
          } else {
            // Fixed partitions (or an exact fit): the process occupies the whole block. Whatever it did not use is
            // internal fragmentation.
            chosen.pid = o.name;
            chosen.req = req;
            leftover = chosen.size - req;
            note =
              o.name +
              " is placed in the block at " +
              chosen.start +
              "." +
              (leftover
                ? " " +
                  leftover +
                  " units are wasted inside the block: internal fragmentation."
                : " It fits exactly.");
            ptr = chosen.start + chosen.size;
          }
          if (ptr >= total) ptr = 0;
          placed[o.name] = chosen.start;
          push({
            op: o,
            opIndex: oi,
            phase: "result",
            ok: true,
            at: chosen.start,
            text: note,
          });
        } else {
          const free = blocks
            .filter((b) => b.pid === null)
            .reduce((s, b) => s + b.size, 0);
          const largest = blocks
            .filter((b) => b.pid === null)
            .reduce((m, b) => Math.max(m, b.size), 0);
          // No hole is big enough. Work out *why*, because the lesson differs:
          //   no-space  - not enough free memory in total
          //   external  - enough in total but scattered in small holes (external fragmentation)
          //   no-block  - fixed partitions: no single block is large enough
          let kind, text;
          if (free < req) {
            kind = "no-space";
            text =
              o.name +
              " cannot be placed: only " +
              free +
              " units are free in total, and " +
              req +
              " are needed.";
          } else if (cfg.split) {
            kind = "external";
            text =
              "EXTERNAL FRAGMENTATION: " +
              free +
              " units are free in total (enough for " +
              o.name +
              " at " +
              req +
              "), but the largest single hole is only " +
              largest +
              ". The free space is scattered. Compaction would fix this.";
          } else {
            kind = "no-block";
            text =
              o.name +
              " cannot be placed: " +
              free +
              " units are free, but no single block is large enough (largest free block: " +
              largest +
              "). Fixed partitions cannot be merged.";
          }
          placed[o.name] = null;
          push({ op: o, opIndex: oi, phase: "result", ok: false, kind, text });
        }
      } else if (o.op === "free") {
        // FREE: mark the block empty. With variable partitions, merge it with free neighbours (coalescing).
        const b = blocks.find((x) => x.pid === o.name);
        const size = b.req;
        b.pid = null;
        b.req = 0;
        let text = o.name + " (" + size + ") is freed. ";
        if (cfg.split) {
          let merged = false;
          for (let i = 0; i < blocks.length - 1; ) {
            if (blocks[i].pid === null && blocks[i + 1].pid === null) {
              blocks[i].size += blocks[i + 1].size;
              blocks.splice(i + 1, 1);
              merged = true;
            } else i++;
          }
          text += merged
            ? "It touches another free hole, so they merge into one bigger hole."
            : "Its neighbours are in use, so it stays a separate hole.";
        } else
          text +=
            "Fixed partitions stay as they are, so the block becomes free again.";
        if (ptr > total) ptr = 0;
        push({ op: o, opIndex: oi, phase: "result", ok: true, text });
      } else if (o.op === "compact") {
        // COMPACT: slide every allocated block to the start of memory, leaving one large hole at the end.
        // This cures external fragmentation but costs time (copying, updating addresses).
        const used = blocks.filter((b) => b.pid !== null);
        let pos = 0;
        const out = [];
        used.forEach((b) => {
          out.push({ start: pos, size: b.size, pid: b.pid, req: b.req });
          pos += b.size;
        });
        if (pos < total)
          out.push({ start: pos, size: total - pos, pid: null, req: 0 });
        const before = blocks.filter((b) => b.pid === null).length;
        blocks = out;
        ptr = 0;
        push({
          op: o,
          opIndex: oi,
          phase: "result",
          ok: true,
          compacted: true,
          text:
            "Compaction slides every process down to the start of memory and merges the " +
            before +
            " hole" +
            (before === 1 ? "" : "s") +
            " into one hole of " +
            (total - pos) +
            ". It costs time because every moved process must be copied and its addresses updated.",
        });
      }
    });
    return {
      cfg,
      total,
      frames,
      names,
      placed,
      final: snap(blocks),
      stats: stats(blocks, total),
    };
  }

  // simulateAll: run every strategy on the same input for the Compare tab.
  function simulateAll(layout, ops, config) {
    const out = {};
    ALGOS.forEach((a) => {
      out[a.id] = simulate(
        layout,
        ops,
        Object.assign({}, config, { algo: a.id }),
      );
    });
    return out;
  }

  // Classic textbook problems as INPUTS ([op, name, size]); outcomes are computed by simulate().
  const PRESETS = [
    {
      id: "galvin",
      name: "Textbook partitions (Galvin)",
      algo: "first",
      split: true,
      layout: "100 500 200 300 600",
      ops: [
        ["alloc", "P1", 212],
        ["alloc", "P2", 417],
        ["alloc", "P3", 112],
        ["alloc", "P4", 426],
      ],
      note: "Five existing holes and four requests. Try all four algorithms: only Best Fit places everything.",
    },
    {
      id: "frag",
      name: "Fragmentation, then compaction",
      algo: "first",
      split: true,
      layout: "1000",
      ops: [
        ["alloc", "A", 200],
        ["alloc", "B", 300],
        ["alloc", "C", 100],
        ["alloc", "D", 250],
        ["free", "A"],
        ["free", "C"],
        ["alloc", "E", 300],
        ["compact"],
        ["alloc", "E", 300],
      ],
      note: "450 units are free but scattered, so E (300) fails. Compaction merges the holes and E fits.",
    },
    {
      id: "fixed",
      name: "Fixed partitions (internal fragmentation)",
      algo: "first",
      split: false,
      layout: "300 600 350 200 750 125",
      ops: [
        ["alloc", "P1", 115],
        ["alloc", "P2", 500],
        ["alloc", "P3", 358],
        ["alloc", "P4", 200],
        ["alloc", "P5", 375],
      ],
      note: "Each process takes a whole block. The unused space inside a block is internal fragmentation.",
    },
    {
      id: "next",
      name: "Where Next Fit differs",
      algo: "next",
      split: true,
      layout: "200",
      ops: [
        ["alloc", "A", 30],
        ["alloc", "B", 30],
        ["alloc", "C", 30],
        ["free", "A"],
        ["alloc", "D", 20],
        ["alloc", "E", 20],
      ],
      note: "After A is freed, First Fit reuses the hole at the start. Next Fit keeps walking forward. Compare the two.",
    },
  ];

  NS.allocation = {
    ALGOS,
    BY_ID,
    LIMITS,
    PRESETS,
    parseLayout,
    validate,
    simulate,
    simulateAll,
    stats,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = NS.allocation;
})(typeof window !== "undefined" ? window : globalThis);
