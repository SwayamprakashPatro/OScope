# OScope

Interactive visualizer for operating-system concepts. Open `index.html` in a browser (no build step).

## Concepts (v1 to v4)

| Group        | Concept             | What you can do                                                                                                                                                                                      |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processes    | CPU scheduling      | FCFS, SJF, SRTF, Priority (both kinds), Round Robin; compare tab                                                                                                                                     |
| Processes    | Process states      | Five-state diagram driven by an event script or by clicking legal events; ready/waiting queues; PCB with context save/load; random legal scenarios                                                   |
| Memory       | Page replacement    | FIFO, LRU, Optimal; faults-vs-frames chart that exposes Belady's anomaly                                                                                                                             |
| Memory       | Memory allocation   | First/Best/Worst/Next fit with alloc/free operations, fragmentation, compaction                                                                                                                      |
| Memory       | Address translation | Paging with page table and TLB, step-by-step bit split and hit/miss                                                                                                                                  |
| Storage      | Disk scheduling     | FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; seek-path chart; compare tab                                                                                                                                 |
| Coordination | Banker's algorithm  | Editable matrices, stepped safety algorithm, resource-request checker, count of all safe sequences                                                                                                   |
| Coordination | Deadlock graphs     | Resource-allocation graph, cycle search, graph reduction, wait-for graph                                                                                                                             |
| Coordination | Synchronization     | Tiny concurrent machine: race condition, producer-consumer, dining philosophers (4 variants), readers-writers. You pick the interleaving, or use random / round-robin, or explore every interleaving |

## Structure

- `js/engines/` pure simulation logic (no DOM). Answers are computed, never stored.
- `js/views/` one file per concept: inputs, animation, explanations
- `js/core/` shared helpers and the playback controller
- `css/` styles.css (tokens, shared classes, shared helpers) plus one stylesheet per concept: scheduling, paging, allocation, translation, disk, procstate, bankers, rag, sync
- `tests/` run all with `for f in tests/*.test.js; do node $f; done` (engines are checked against textbook answers and brute-force checks)

## Adding a concept

1. Write an engine in `js/engines/` that returns a list of frames.
2. Write a view in `js/views/` exposing `mount(host)` that returns `{ activate, deactivate }`.
3. Add an entry to `CONCEPTS` in `js/app.js` and a `<script>` tag in `index.html`.
