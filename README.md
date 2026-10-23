# OScope: See inside your OS

**Live site:** https://swayamprakashpatro.github.io/OScope/

**See inside your OS.**

OScope is an interactive visualizer for operating-system concepts. You type your own problem (processes, page references, a resource graph, a concurrent program), pick an algorithm, and step through the answer one move at a time. Nothing is hardcoded: every result is computed from your input.

Built for students who want to understand _why_ an algorithm gives its answer, not only what the answer is.

## Quick start

No install and no build step.

1. Unzip the project.
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
3. Pick a lab from the left menu (or press Ctrl+K and type a concept such as `lru`, `c-scan` or `semaphore`), load an example or type your own input, then press play.

Text uses Google Fonts when online and falls back to system fonts offline. Everything else works without a network.

## Concepts

| Group        | Concept                                             | What you can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processes    | CPU scheduling                                      | FCFS, SJF, SRTF, Priority (preemptive and not), Priority with aging, Round Robin, Lottery (seeded); Gantt chart, waiting and turnaround times; compare tab                                                                                                                                                                                                                                                                                                                                      |
| Processes    | Process states                                      | Five-state diagram driven by an event script or by clicking legal events; ready and waiting queues; PCB with context save and load; random legal scenarios                                                                                                                                                                                                                                                                                                                                      |
| Memory       | Page replacement                                    | FIFO, LRU, Optimal, Clock, NRU, LFU, MFU, Aging counters; faults-versus-frames chart that exposes Belady's anomaly                                                                                                                                                                                                                                                                                                                                                                              |
| Memory       | Memory allocation                                   | First, Best, Worst and Next fit with alloc and free operations; fragmentation and compaction                                                                                                                                                                                                                                                                                                                                                                                                    |
| Memory       | Address translation                                 | Paging with page table and TLB; step-by-step bit split and hit or miss                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Storage      | Disk scheduling                                     | FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; seek-path chart; compare tab; seek, rotational latency and transfer time breakdown from RPM and sectors per track                                                                                                                                                                                                                                                                                                                                       |
| Coordination | Banker's algorithm                                  | Editable matrices, stepped safety algorithm, resource-request checker, count of all safe sequences                                                                                                                                                                                                                                                                                                                                                                                              |
| Coordination | Deadlock graphs                                     | Resource-allocation graph, cycle search, graph reduction, wait-for graph; recovery by terminating all, terminating one at a time, or preempting and rolling back, with a victim policy                                                                                                                                                                                                                                                                                                          |
| Coordination | Synchronization                                     | Small concurrent machine: race condition, test-and-set and compare-and-swap, spinlocks (with livelock detection), rendezvous, barrier, sleeping barber, priority inversion, producer-consumer, dining philosophers (4 variants), readers-writers, plus Peterson, Dekker and the bakery algorithm, monitors and condition variables (Mesa and Hoare), proved or broken by exploring every interleaving. Pick the interleaving yourself, use random or round-robin, or explore every interleaving |
| Memory       | Garbage collection _(advanced)_                     | Mark-sweep with tri-colour marking, reference counting (cascading frees and cycle leaks), copying (Cheney) collector; fragmentation and pause metrics                                                                                                                                                                                                                                                                                                                                           |
| Memory       | Shadow & nested page tables _(advanced)_            | Native, shadow and nested (EPT/NPT) translation replayed on your own event script; the two-dimensional walk grid, TLB, VM exits and a three-way cost comparison                                                                                                                                                                                                                                                                                                                                 |
| Storage      | Journaling & crash recovery _(advanced)_            | Write-ahead journaling in four modes; crash at any step, recovery by replay, fsck-style consistency checks, and a sweep of every crash point                                                                                                                                                                                                                                                                                                                                                    |
| Storage      | Log-structured FS & SSD wear levelling _(advanced)_ | Append-only log, greedy and cost-benefit cleaning, write amplification, TRIM, and dynamic or static wear levelling with per-block erase counts                                                                                                                                                                                                                                                                                                                                                  |
| System       | Buffer overflow & stack smashing _(advanced)_       | An abstract toy stack frame (no real code): see which byte lands where, then compare canary, NX, ASLR and bounds checking on the same input                                                                                                                                                                                                                                                                                                                                                     |
| Coordination | Lamport & vector clocks _(advanced)_                | Message-passing simulator on a seeded network: logical and vector clocks, happened-before versus concurrent, causal-order checks; edit the event script yourself                                                                                                                                                                                                                                                                                                                                |
| Coordination | Distributed mutual exclusion _(advanced)_           | Ricart-Agrawala and token ring with crashes, loss and partitions; safety (one holder) and liveness checked on every run                                                                                                                                                                                                                                                                                                                                                                         |
| Coordination | Leader election _(advanced)_                        | Bully and Chang-Roberts ring election with crash and recover events; message counts and unique-leader check                                                                                                                                                                                                                                                                                                                                                                                     |
| Storage      | Two-phase commit _(advanced)_                       | Coordinator and participants with votes, crashes and timeouts; shows the blocking window and atomicity check                                                                                                                                                                                                                                                                                                                                                                                    |
| Coordination | Raft consensus _(advanced)_                         | Leader election, log replication and commit with crashes and partitions; election-safety and log-matching checks                                                                                                                                                                                                                                                                                                                                                                                |
| Memory       | Cache coherence (MESI) _(advanced)_                 | MSI and MESI snooping on your own read/write script; per-line state grid, bus traffic, coherence misses, false-sharing and ping-pong presets, MSI-versus-MESI comparison                                                                                                                                                                                                                                                                                                                        |
| System       | Boot sequence                                       | Step from power-on to login prompt for UEFI/GPT or BIOS/MBR: who runs, where the code lives, what fails at each stage                                                                                                                                                                                                                                                                                                                                                                           |
| System       | VM vs container _(advanced)_                        | Side-by-side table, a requirements helper, toggleable namespaces, and a cgroup calculator (weighted CPU shares and a memory-limit OOM check) computed from your input                                                                                                                                                                                                                                                                                                                           |
| System       | Privilege rings & access control                    | Ring diagram, an editable access matrix shown as ACLs and as capability lists, an access checker, and revoke-cost comparison                                                                                                                                                                                                                                                                                                                                                                    |
| Memory       | NUMA & load balancing _(advanced)_                  | Threads and page placement across nodes; per-thread latency, and a rebalance that follows the pages within a load limit                                                                                                                                                                                                                                                                                                                                                                         |
| Memory       | Buddy system _(advanced)_                           | Power-of-two allocation with split and merge on your own alloc/free script; free lists, internal waste and external fragmentation                                                                                                                                                                                                                                                                                                                                                               |
| Memory       | Multi-level & inverted page tables _(advanced)_     | Bit split per level, tables created on demand, translation steps, and the memory used by flat, multi-level and inverted designs                                                                                                                                                                                                                                                                                                                                                                 |
| Memory       | Segmentation _(advanced)_                           | Segment table with base, limit and rights; limit and protection faults; physical memory map; overlap warnings                                                                                                                                                                                                                                                                                                                                                                                   |
| Memory       | Copy-on-write _(advanced)_                          | fork sharing frames, write faults, reference counts, frames saved versus an eager copy                                                                                                                                                                                                                                                                                                                                                                                                          |
| Memory       | Working set & thrashing _(advanced)_                | Working set per process over a sliding window, total demand against frames, thrashing detection, faults under the working-set rule                                                                                                                                                                                                                                                                                                                                                              |
| Memory       | Frame allocation _(advanced)_                       | Equal, proportional and priority splits (largest-remainder), minimum frames, and the LRU fault cost of each split                                                                                                                                                                                                                                                                                                                                                                               |
| Memory       | Cache mapping _(advanced)_                          | Direct, set-associative and fully associative caches; tag/index/offset split; compulsory, capacity and conflict misses; average access time                                                                                                                                                                                                                                                                                                                                                     |
| Memory       | Memory hierarchy & EAT _(advanced)_                 | Effective access time over cache levels, and over TLB, page-table walk and page faults, with the fault rate allowed for a 10% slowdown                                                                                                                                                                                                                                                                                                                                                          |
| Storage      | File allocation methods _(advanced)_                | Contiguous, linked, indexed, FAT and Unix inode allocation on your own create/append/delete/read script; disk grid, metadata overhead, fragmentation and disk reads per access                                                                                                                                                                                                                                                                                                                  |
| Storage      | Directories, links & permissions _(advanced)_       | A tiny Unix file system: tree with inode numbers and link counts, hard and symbolic links, owner/group/other checks and the exact reason for each allow or deny                                                                                                                                                                                                                                                                                                                                 |
| Storage      | RAID _(advanced)_                                   | RAID 0, 1, 5, 6, 10: stripe layout, capacity, speed, small-write cost, failure survival and XOR rebuild of lost blocks                                                                                                                                                                                                                                                                                                                                                                          |
| Processes    | Multilevel queues _(advanced)_                      | MLQ and MLFQ: per-queue time slices, demotion, I/O-bound jobs staying high, priority boost against starvation; per-process timeline and queue view                                                                                                                                                                                                                                                                                                                                              |
| Processes    | CFS _(advanced)_                                    | Linux fair scheduler: nice-to-weight table, virtual runtime bars, slice from target latency and minimum granularity, fair share against actual CPU share                                                                                                                                                                                                                                                                                                                                        |
| Processes    | Real-time: EDF and RMS _(advanced)_                 | Periodic tasks with deadlines; utilisation, Liu-Layland bound and hyperperiod; releases, deadlines and missed jobs on a timeline                                                                                                                                                                                                                                                                                                                                                                |
| Processes    | fork, exec, wait and zombies                        | Script system calls; live process tree with zombies, orphans adopted by init, blocked parents; a buggy-init option                                                                                                                                                                                                                                                                                                                                                                              |
| Processes    | Pipes, message queues and signals _(advanced)_      | Bounded pipe (blocking, EOF, SIGPIPE), priority message queue, and a signal-handling process (handle, ignore, block, pending merge, STOP/CONT/KILL)                                                                                                                                                                                                                                                                                                                                             |
| Processes    | Thread pools and threading models _(advanced)_      | One thread, thread per request, or a fixed pool with a bounded queue; latency, throughput, rejection and a three-way comparison                                                                                                                                                                                                                                                                                                                                                                 |
| System       | Interrupts and system calls                         | User/kernel mode timeline, syscall table, page-fault exception, hardware interrupts with priority, masking, nesting and latency                                                                                                                                                                                                                                                                                                                                                                 |
| Storage      | Polling, interrupts and DMA                         | CPU and device lanes tick by tick; CPU cost, finish time and the break-even between the three methods                                                                                                                                                                                                                                                                                                                                                                                           |

## How to use it

1. **Choose a concept** in the left menu.
2. **Load an example or type your own.** Examples only fill the inputs; the animation is always computed from what is in the form. Invalid input shows a readable error instead of failing silently.
3. **Step through the result.** Use the playback bar to step, go back, play, scrub and change speed.
4. **Read the explanation** beside each step, which says why the algorithm made that choice.
5. **Go deeper** (below every lab): the idea and a memory hook are always visible; _Deep dive_ and _Common mistakes_ unfold on demand.

### Finding things

- The sidebar has six areas (Processes & CPU, Concurrency & deadlock, Memory, Storage & I/O, Kernel & security, Distributed systems), and each area is split into sections (for example Memory has Allocation, Paging & translation, Virtual memory, Caches). Click an area name to fold it. A lab picks its place with `area` and `section` in js/labs/<id>.js; the list of sections lives in js/core/labs.js.
- **Ctrl+K** (or **Cmd+K**, or the Search button) searches every lab by name, algorithm or term. Spaces and hyphens do not matter (`c-scan`, `cscan` and `c scan` all work).
- Labs marked _advanced_ stay hidden until you switch on **Show advanced labs**. Searching for one reveals it automatically.

Keyboard shortcuts for the playback bar work on every concept (see the bar's tooltips). Your last inputs are remembered in the browser. The interface supports light and dark themes and works on phone-sized screens.

## Project structure

```
index.html            page shell: links the stylesheets and scripts
css/
  styles.css          design tokens, shared classes, shared helpers
  frame.css, search.css   the lab frame (breadcrumb, Go deeper card) and the search palette
  <concept>.css       one stylesheet per concept (scheduling, paging, allocation,
                      translation, disk, procstate, bankers, rag, sync, gc, journal,
                      overflow, vpt, flashlog, mp, mesi, cards, memviz, fsviz, procviz)
js/
  core/
    util.js           small DOM and formatting helpers, colours
    player.js         shared playback controller (step, back, play, scrub, speed)
    labs.js           lab registry, validation and the search ranking (no DOM)
    frame.js          shared wrapper around every lab (breadcrumb + Go deeper card)
    search.js         the Ctrl+K palette
  labs/               one small file per lab: title, area, level, keywords, learn text
  engines/            pure simulation logic, no DOM: input in, list of frames out
  views/              one file per concept: inputs, animation, explanations
  app.js              sidebar, routing, theme (reads the lab registry; no list of its own)
tests/                one test file per engine group
docs/BUILD_GUIDE.md   conventions for adding a concept
```

### How it fits together

```
 user input  ->  engine (pure)  ->  frames  ->  Player  ->  view draws frame i
```

- An **engine** takes validated input and returns an ordered list of **frames**, one per step.
- The **Player** walks the frames and tells the view which one to draw.
- A **view** exposes `mount(host)` and returns `{ activate, deactivate }`; it only renders and never decides answers.

The code is plain HTML, CSS and vanilla JavaScript with classic `<script>` tags, so it runs straight from `file://`. Logic is commented in every file.

## Running the tests

Requires Node.js. The engines are checked against textbook answers and brute-force cross-checks.

```
for f in tests/*.test.js; do node $f; done
```

Expected: every file reports `N passed, 0 failed` (4697 tests in total).

## Adding a concept

1. Write an engine in `js/engines/` that returns a list of frames.
2. Write a view in `js/views/` exposing `mount(host)` that returns `{ activate, deactivate }`.
3. Add a stylesheet `css/<name>.css` with a short class prefix.
4. Describe the lab in `js/labs/<id>.js` (area, level, one-line summary, search keywords, and the Go deeper text). Loading fails loudly if a field is missing, and `tests/labs.test.js` checks it.
5. Add the `<link>` and `<script>` tags in `index.html` (the order of the lab scripts is the sidebar order).

See `docs/BUILD_GUIDE.md` for the full conventions.

## Known limits

- Input sizes are capped so the animations stay readable (for example, the interleaving explorer stops at 30,000 states).
- The synchronization concept is a teaching model with a small instruction set, not a real threading runtime. Peterson, Dekker and bakery are correct only under sequentially consistent memory; real CPUs need memory barriers. The bakery lab supports two threads.
- Journaling assumes single-block writes are atomic and a commit record is never torn.
- The buffer-overflow lab is an abstract toy model with made-up addresses and no machine code.
- The nested-paging, SSD and log-structured labs use tiny devices and teaching constants (such as the VM-exit cost); they show the shape of the trade-offs, not benchmarks.
- Search opens the lab that covers an algorithm, not the algorithm itself, and NRU page replacement ignores the modified bit.
- Tier 4 (distributed) labs simplify the network: messages are delayed by a seeded random amount, failure detection is a timeout or a global oracle (the ring election assumes one), and the token ring stops circulating when nobody wants the lock. The 2PC coordinator keeps a durable log. Raft has no log compaction, membership changes or leader no-op entry and assumes persistent state survives a crash.
- The MESI lab models one atomic bus, one transaction at a time, no evictions and no transient states; real protocols (MOESI, MESIF, directories) are more complex.
- The Tier 5 cards are mostly teaching content: the boot stages and the VM-versus-container table are fixed text, and the requirements helper only counts your ticks. Only the access matrix, cgroup shares and NUMA latency are computed. NUMA latency is a simple weighted average with a greedy balancer, not the Linux algorithm.
- Tier 2A memory labs: the buddy allocator has no splitting policy choices (lowest address first); page tables are counted, not stored, and the inverted-table hash is a teaching choice; segmentation has no paging underneath; copy-on-write ignores swapping and huge pages; the working-set lab runs processes in lockstep; frame allocation uses local LRU only; the cache lab models reads only and one level; the hierarchy times are averages.
- Tier 2B storage labs: the file-allocation lab ignores directories, free-space maps and journaling, assumes the FAT is cached, and counts block reads rather than seek time. The permissions lab has no ACLs, setuid, sticky bit or umask. The RAID lab shows ideal speed multiples, ignores rebuild contention and unreadable sectors, uses a left-asymmetric layout, and does not compute RAID 6 two-failure recovery (it shows the verdict only).
- Visual checks were done in Chromium; other browsers are expected to work but are less tested.
- Tier 2C process and I/O labs: the MLFQ lab restarts a preempted job's quantum and lets a job that blocks at the end of its slice keep its level; CFS is one CPU with whole-tick time, no sleeping tasks and no wake-up preemption; the real-time lab assumes free preemption, deadlines no later than periods and lets late jobs run on; fork/wait has no signals or scheduler (the script decides who runs); the IPC lab has one writer and reader and models classic, non-queuing signals only; the thread-pool lab is a toy CPU-sharing model for CPU-bound work; the interrupt lab uses teaching-sized handler lengths and one program; the I/O-modes lab assumes a one-word device buffer and no DMA bus stealing.

## Checking the interface (tools/audit.py)

The engine tests do not see layout or colour problems, so `tools/audit.py` opens every lab in a real browser and
checks: sideways overflow at five widths (1440, 1024, 768, 390, 320), console errors, "NaN/undefined" text,
duplicate ids, unlabeled controls, touch-target size, text contrast in light and dark mode, fuzzed inputs,
keyboard shortcuts, browser Back/Forward, blocked storage, a print stylesheet and memory use.

    pip install playwright && playwright install chromium
    python3 tools/audit.py            # exit code 1 if any problem is found

Set `CHROMIUM=/path/to/chromium` to use a browser you already have. Disabled controls and the deliberately
faded "not happened yet" items are exempt from the contrast check.

## Publishing (GitHub Pages)

1. Create a **public** repository (for example `oscope`) and push this folder to the `main` branch.
2. In the repository: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` runs the tests and deploys. After about a minute the site is at
   `https://<your-username>.github.io/<repo-name>/`.
