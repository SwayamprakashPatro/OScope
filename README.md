# OScope

**See inside your OS.**

OScope is an interactive visualizer for operating-system concepts. You type your own problem (processes, page references, a resource graph, a concurrent program), pick an algorithm, and step through the answer one move at a time. Nothing is hardcoded: every result is computed from your input.

Built for students who want to understand *why* an algorithm gives its answer, not only what the answer is.

## Quick start

No install and no build step.

1. Unzip the project.
2. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
3. Pick a concept from the left menu, load an example or type your own input, then press play.

Text uses Google Fonts when online and falls back to system fonts offline. Everything else works without a network.

## Concepts

| Group | Concept | What you can do |
|---|---|---|
| Processes | CPU scheduling | FCFS, SJF, SRTF, Priority (preemptive and not), Round Robin; Gantt chart, waiting and turnaround times; compare tab |
| Processes | Process states | Five-state diagram driven by an event script or by clicking legal events; ready and waiting queues; PCB with context save and load; random legal scenarios |
| Memory | Page replacement | FIFO, LRU, Optimal; faults-versus-frames chart that exposes Belady's anomaly |
| Memory | Memory allocation | First, Best, Worst and Next fit with alloc and free operations; fragmentation and compaction |
| Memory | Address translation | Paging with page table and TLB; step-by-step bit split and hit or miss |
| Storage | Disk scheduling | FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; seek-path chart; compare tab |
| Coordination | Banker's algorithm | Editable matrices, stepped safety algorithm, resource-request checker, count of all safe sequences |
| Coordination | Deadlock graphs | Resource-allocation graph, cycle search, graph reduction, wait-for graph |
| Coordination | Synchronization | Small concurrent machine: race condition, producer-consumer, dining philosophers (4 variants), readers-writers. Pick the interleaving yourself, use random or round-robin, or explore every interleaving |

## How to use it

1. **Choose a concept** in the left menu.
2. **Load an example or type your own.** Examples only fill the inputs; the animation is always computed from what is in the form. Invalid input shows a readable error instead of failing silently.
3. **Step through the result.** Use the playback bar to step, go back, play, scrub and change speed.
4. **Read the explanation** beside each step, which says why the algorithm made that choice.

Keyboard shortcuts for the playback bar work on every concept (see the bar's tooltips). Your last inputs are remembered in the browser. The interface supports light and dark themes and works on phone-sized screens.

## Project structure

```
index.html            page shell: links the stylesheets and scripts
css/
  styles.css          design tokens, shared classes, shared helpers
  <concept>.css       one stylesheet per concept (scheduling, paging, allocation,
                      translation, disk, procstate, bankers, rag, sync)
js/
  core/
    util.js           small DOM and formatting helpers, colours
    player.js         shared playback controller (step, back, play, scrub, speed)
  engines/            pure simulation logic, no DOM: input in, list of frames out
  views/              one file per concept: inputs, animation, explanations
  app.js              concept list, navigation, theme
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

Expected: every file reports `N passed, 0 failed` (170 tests in total).

## Adding a concept

1. Write an engine in `js/engines/` that returns a list of frames.
2. Write a view in `js/views/` exposing `mount(host)` that returns `{ activate, deactivate }`.
3. Add a stylesheet `css/<name>.css` with a short class prefix.
4. Add an entry to `CONCEPTS` in `js/app.js`, plus the `<link>` and `<script>` tags in `index.html`.

See `docs/BUILD_GUIDE.md` for the full conventions.

## Known limits

- Input sizes are capped so the animations stay readable (for example, the interleaving explorer stops at 30,000 states).
- The synchronization concept is a teaching model with a small instruction set, not a real threading runtime.
- Visual checks were done in Chromium; other browsers are expected to work but are less tested.
