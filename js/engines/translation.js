/* Paging address translation engine with a TLB. Pure logic.
   Each address is walked through phases: split → TLB → page table → physical address. */
(function (root) {
  "use strict";
  const NS = (root.OSViz = root.OSViz || {});

  // Input caps: address width, page-number bits (so the page table stays drawable), frames, addresses, TLB size.
  const LIMITS = {
    maxAddrBits: 16,
    minAddrBits: 4,
    maxPageBits: 6,
    maxFrames: 64,
    maxAddrs: 24,
    maxTlb: 8,
  };

  // parseAddr: accept decimal (100), hex (0x64) or binary (0b1100100); NaN for anything else.
  function parseAddr(str) {
    const t = String(str).trim().toLowerCase();
    if (!t) return NaN;
    if (/^0x[0-9a-f]+$/.test(t)) return parseInt(t.slice(2), 16);
    if (/^0b[01]+$/.test(t)) return parseInt(t.slice(2), 2);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    return NaN;
  }
  // log2(n): number of bits needed for n values when n is a power of two.
  const log2 = (n) => Math.round(Math.log2(n));
  // isPow2(n): true for 1, 2, 4, 8, ... (n & (n-1) clears the lowest set bit, so it is 0 only for powers of two).
  const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
  // bin(v, bits): v in binary, left-padded with zeros to a fixed width, for the bit-split picture.
  const bin = (v, bits) => v.toString(2).padStart(bits, "0");

  // eat: Effective Access Time with a TLB hit ratio h.
  //   EAT = h * (tTlb + tMem) + (1 - h) * (tTlb + 2 * tMem)
  // A hit costs one TLB lookup plus one memory access; a miss costs the TLB lookup, then a page-table
  // access in memory, then the data access (two memory accesses).
  function eat(h, tTlb, tMem) {
    return h * (tTlb + tMem) + (1 - h) * (tTlb + 2 * tMem);
  }

  // derive: sizes implied by the settings. offset bits = log2(page size); the remaining address bits
  // are the page number, so the page table has 2^pageBits rows.
  function derive(cfg) {
    const offsetBits = log2(cfg.pageSize);
    const pageBits = cfg.addrBits - offsetBits;
    return {
      offsetBits,
      pageBits,
      numPages: Math.pow(2, pageBits),
      space: Math.pow(2, cfg.addrBits),
    };
  }

  // validate: readable errors for impossible settings (page size not a power of 2, page larger than the
  // address space, too many pages, frames out of range, addresses outside the logical space ...).
  function validate(cfg) {
    const errors = [];
    if (
      !Number.isInteger(cfg.addrBits) ||
      cfg.addrBits < LIMITS.minAddrBits ||
      cfg.addrBits > LIMITS.maxAddrBits
    )
      errors.push(
        "Address bits must be a whole number from " +
          LIMITS.minAddrBits +
          " to " +
          LIMITS.maxAddrBits +
          ".",
      );
    if (!isPow2(cfg.pageSize))
      errors.push("Page size must be a power of 2 (1, 2, 4, 8, ...).");
    if (!errors.length) {
      const d = derive(cfg);
      if (d.pageBits < 1)
        errors.push(
          "The page size is as big as the whole address space. Use a smaller page size.",
        );
      else if (d.pageBits > LIMITS.maxPageBits)
        errors.push(
          "That gives " +
            d.numPages +
            " pages. Use a bigger page size or fewer address bits (at most " +
            Math.pow(2, LIMITS.maxPageBits) +
            " pages).",
        );
    }
    if (
      !Number.isInteger(cfg.numFrames) ||
      cfg.numFrames < 1 ||
      cfg.numFrames > LIMITS.maxFrames
    )
      errors.push(
        "Frames must be a whole number from 1 to " + LIMITS.maxFrames + ".",
      );
    if (
      !Number.isInteger(cfg.tlbSize) ||
      cfg.tlbSize < 0 ||
      cfg.tlbSize > LIMITS.maxTlb
    )
      errors.push("TLB entries must be from 0 to " + LIMITS.maxTlb + ".");
    if (!(cfg.tMem > 0) || !(cfg.tTlb >= 0))
      errors.push(
        "Access times must be numbers (memory above 0, TLB 0 or more).",
      );
    if (!errors.length) {
      const d = derive(cfg);
      cfg.pageTable.forEach((f, p) => {
        if (f !== null && (!Number.isInteger(f) || f < 0 || f >= cfg.numFrames))
          errors.push(
            "Page " +
              p +
              ": frame must be a whole number from 0 to " +
              (cfg.numFrames - 1) +
              ", or empty for invalid.",
          );
      });
      // Two pages cannot share one frame: detect duplicates in the page table.
      const used = {};
      cfg.pageTable.forEach((f, p) => {
        if (f !== null) {
          if (used[f] !== undefined)
            errors.push(
              "Pages " +
                used[f] +
                " and " +
                p +
                " both map to frame " +
                f +
                ". Each frame can hold only one page.",
            );
          used[f] = p;
        }
      });
      if (cfg.addrs.length === 0)
        errors.push("Enter at least one logical address.");
      if (cfg.addrs.length > LIMITS.maxAddrs)
        errors.push("Use at most " + LIMITS.maxAddrs + " addresses.");
      cfg.addrs.forEach((a, i) => {
        if (!Number.isInteger(a) || a < 0)
          errors.push(
            "Address " +
              (i + 1) +
              " is not a number. Use decimal, 0x… hex or 0b… binary.",
          );
        else if (a >= d.space)
          errors.push(
            "Address " +
              a +
              " is outside the logical address space (0 to " +
              (d.space - 1) +
              ").",
          );
      });
    }
    return { ok: !errors.length, errors };
  }

  // simulate: translate each logical address through four phases, one frame each:
  //   split  - page number = address div page size, offset = address mod page size
  //   tlb    - hit (fast path) or miss
  //   table  - read the page-table row; if invalid, it is a page fault
  //   phys   - physical address = frame * page size + offset
  // The TLB is simulated for real (capacity, FIFO or LRU replacement), so hit ratios come out of the run.
  function simulate(cfg) {
    const d = derive(cfg);
    // Bits in a physical address = bits needed for the frame number + offset bits.
    const physBits =
      (cfg.numFrames > 1 ? Math.ceil(Math.log2(cfg.numFrames)) : 0) +
      d.offsetBits;
    let tlb = []; // entries {page, frame}, order = eviction order (oldest/least recent first)
    const frames = [],
      rows = [];
    const snapTlb = () => tlb.map((e) => Object.assign({}, e));
    // push(f): store a frame together with a snapshot of the TLB contents at that moment.
    const push = (f) => {
      f.tlb = snapTlb();
      frames.push(f);
    };
    push({
      addrIndex: -1,
      phase: "start",
      text: "Ready. Each address goes through four steps: split it, check the TLB, look in the page table if needed, build the physical address.",
    });

    // Translate each address in turn; `row` collects the per-address results for the summary table.
    cfg.addrs.forEach((A, i) => {
      // Phase 1: split the address.
      const page = Math.floor(A / cfg.pageSize),
        offset = A % cfg.pageSize;
      const row = {
        index: i,
        addr: A,
        page,
        offset,
        tlbHit: false,
        frame: null,
        phys: null,
        fault: false,
        ns: 0,
      };
      push({
        addrIndex: i,
        phase: "split",
        addr: A,
        page,
        offset,
        text:
          "Logical address " +
          A +
          " has " +
          cfg.addrBits +
          " bits: the top " +
          d.pageBits +
          " bits are the page number and the low " +
          d.offsetBits +
          " bits are the offset. Page = " +
          A +
          " div " +
          cfg.pageSize +
          " = " +
          page +
          ", offset = " +
          A +
          " mod " +
          cfg.pageSize +
          " = " +
          offset +
          ".",
      });
      // Phase 2: TLB lookup. On a hit, LRU moves the entry to the 'most recent' end of the list.
      let frame = null;
      const k = tlb.findIndex((e) => e.page === page);
      if (cfg.tlbSize > 0) {
        if (k >= 0) {
          row.tlbHit = true;
          frame = tlb[k].frame;
          if (cfg.tlbPolicy === "lru") {
            const e = tlb.splice(k, 1)[0];
            tlb.push(e);
          }
          push({
            addrIndex: i,
            phase: "tlb",
            hit: true,
            page,
            frame,
            text:
              "TLB HIT: the TLB already knows page " +
              page +
              " → frame " +
              frame +
              ". The page table in memory is not touched." +
              (cfg.tlbPolicy === "lru"
                ? " LRU marks this entry as most recently used."
                : ""),
          });
          row.ns = cfg.tTlb + cfg.tMem;
        } else
          push({
            addrIndex: i,
            phase: "tlb",
            hit: false,
            page,
            text:
              "TLB MISS: page " +
              page +
              " is not in the TLB, so the page table in memory must be read.",
          });
      } else
        push({
          addrIndex: i,
          phase: "tlb",
          hit: false,
          noTlb: true,
          page,
          text: "There is no TLB, so every translation reads the page table in memory.",
        });
      // Phase 3 (TLB miss): consult the page table in memory.
      if (!row.tlbHit) {
        frame = cfg.pageTable[page];
        // Invalid entry = the page is not in memory: a page fault, so there is no physical address.
        if (frame === null) {
          row.fault = true;
          row.ns = cfg.tTlb + cfg.tMem;
          push({
            addrIndex: i,
            phase: "table",
            page,
            frame: null,
            fault: true,
            text:
              "PAGE FAULT: the page table entry for page " +
              page +
              " is invalid (the page is not in memory). The hardware traps to the OS, which must find the page on disk, load it into a free frame, update the table and restart the instruction. No physical address yet.",
          });
        } else {
          let evicted = null;
          if (cfg.tlbSize > 0) {
            // Cache the new mapping in the TLB; if it is full, evict the first entry (oldest for FIFO,
            // least recently used for LRU, because the list is kept in eviction order).
            if (tlb.length >= cfg.tlbSize) evicted = tlb.shift();
            tlb.push({ page, frame });
          }
          row.ns = cfg.tTlb + 2 * cfg.tMem;
          push({
            addrIndex: i,
            phase: "table",
            page,
            frame,
            evicted,
            text:
              "Page table row " +
              page +
              " says frame " +
              frame +
              "." +
              (cfg.tlbSize > 0
                ? " The mapping is copied into the TLB" +
                  (evicted
                    ? ", replacing page " +
                      evicted.page +
                      " (" +
                      (cfg.tlbPolicy === "lru"
                        ? "least recently used"
                        : "oldest entry") +
                      ")."
                    : ".")
                : ""),
          });
        }
      }
      // Phase 4: build the physical address from the frame number and the (unchanged) offset.
      if (!row.fault) {
        row.frame = frame;
        row.phys = frame * cfg.pageSize + offset;
        push({
          addrIndex: i,
          phase: "phys",
          page,
          frame,
          offset,
          phys: row.phys,
          text:
            "Physical address = frame × page size + offset = " +
            frame +
            " × " +
            cfg.pageSize +
            " + " +
            offset +
            " = " +
            row.phys +
            ". In binary: frame bits " +
            bin(frame, physBits - d.offsetBits) +
            " followed by offset bits " +
            bin(offset, d.offsetBits) +
            ".",
        });
      }
      rows.push(row);
      // Remember how many result rows were complete at this frame, so the table can fill in as you step.
      frames[frames.length - 1].rowsDone = rows.length;
    });
    // Back-fill rowsDone for frames that did not set it.
    frames.forEach((f, idx) => {
      if (f.rowsDone === undefined)
        f.rowsDone = idx === 0 ? 0 : frames[idx - 1].rowsDone || 0;
    });

    // Summary: TLB hit ratio and the Effective Access Time computed from it.
    const n = rows.length,
      hits = rows.filter((r) => r.tlbHit).length,
      faults = rows.filter((r) => r.fault).length;
    const h = n ? hits / n : 0;
    return {
      cfg,
      d,
      physBits,
      frames,
      rows,
      hits,
      faults,
      hitRatio: h,
      eat: eat(
        cfg.tlbSize > 0 ? h : 0,
        cfg.tlbSize > 0 ? cfg.tTlb : 0,
        cfg.tMem,
      ),
    };
  }

  // Example INPUTS (page tables and address lists). Results are computed by simulate().
  const PRESETS = [
    {
      id: "small",
      name: "Small textbook (8-bit, 32-byte pages)",
      addrBits: 8,
      pageSize: 32,
      numFrames: 8,
      table: [2, 5, 1, 7, null, 3, 0, 4],
      addrs: "5, 40, 100, 130, 36, 200, 5, 70",
      tlbSize: 2,
      tlbPolicy: "fifo",
      tMem: 100,
      tTlb: 10,
      note: "Page 4 is invalid, so address 130 causes a page fault. Watch the 2-entry TLB fill up and evict.",
    },
    {
      id: "kb",
      name: "16-bit addresses, 1 KB pages",
      addrBits: 16,
      pageSize: 1024,
      numFrames: 16,
      table: Array.from({ length: 64 }, (_, i) =>
        i < 12 ? (i * 5 + 3) % 16 : null,
      ),
      addrs: "0x0000, 0x03FF, 0x0400, 0x0800, 0x0C10, 0x0400, 0x0001, 0x0404",
      tlbSize: 4,
      tlbPolicy: "lru",
      tMem: 100,
      tTlb: 10,
      note: "Hex addresses. The repeated pages hit the TLB.",
    },
    {
      id: "tlbdemo",
      name: "TLB: FIFO vs LRU",
      addrBits: 8,
      pageSize: 32,
      numFrames: 8,
      table: [2, 5, 1, 7, 6, 3, 0, 4],
      addrs: "0, 32, 64, 0, 96, 32, 0, 128",
      tlbSize: 3,
      tlbPolicy: "fifo",
      tMem: 100,
      tTlb: 10,
      note: "Switch the policy between FIFO and LRU and compare the hit ratio.",
    },
  ];

  NS.translation = {
    LIMITS,
    PRESETS,
    parseAddr,
    validate,
    derive,
    simulate,
    eat,
    bin,
    isPow2,
    log2,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = NS.translation;
})(typeof window !== "undefined" ? window : globalThis);
