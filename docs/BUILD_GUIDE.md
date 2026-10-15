# Build guide: adding a concept to OScope

Read these existing files first and copy their patterns (they are the reference implementation):
- `js/core/util.js` (el, svg, colorFor, textOn, store, fmt, restart, debounce, icon, clamp)
- `js/core/player.js` (step / back / play / scrub controller)
- `js/engines/scheduling.js` + `js/views/scheduling-view.js` (frames + stage + Gantt + why panel + results + compare tab)
- `js/engines/paging.js` + `js/views/paging-view.js`
- `css/styles.css` (all tokens and shared classes: .card, .card-head, .chips, .chip-btn, .tabs, .workspace, .col, .problem, .field, .ptable, .btn, .errors, .tbl, .stats/.stat, .why, .decision, .cand, .events, .about, .mode/.seg, .proc, .pill, .callout, .hint, .note, .muted, .mono, and helpers .text-good/.text-bad, .callout-good/.callout-bad, .grid2, .key-legend, .qitem/.qchip). One stylesheet per concept lives beside it: css/<concept>.css
- `tests/engines.test.js`

## Contract
**Engine** (`js/engines/<name>.js`): pure logic, no DOM. Wrap in the same IIFE as the others, attach to `OSViz.<name>`, and also `module.exports` for node tests. It must COMPUTE every answer by simulating (never store expected results as output). Return a list of `frames`/`steps` so the Player can step forward AND back. Each frame carries a human-readable explanation (`text`) saying why it happened, in plain language a student can follow. Validate user input and return readable error messages; enforce sensible limits.

**View** (`js/views/<name>-view.js`): `OSViz.views.<viewId> = { mount(host) }`, where `mount` builds the whole UI inside `host` and returns `{ activate(), deactivate() }`. `activate` sets `OSViz.Player.current = player` (keyboard shortcuts) and may relayout; `deactivate` pauses the player. Keep a localStorage-persisted state object (use `OSViz.util.store`, a unique key like `oslab.<viewId>.v1`).

**Layout**: same as the others: `.view-head` (h2 + one-sentence description), optional algorithm `.chips` radiogroup, optional `.tabs` (Visualize / Compare), then `.workspace` with the visualiser column on the left (`.col`) and the "Your problem" editor card on the right (`.col.problem`). Include an "about" card (rule / memory hook / watch out for) per algorithm or sub-concept, a "Load an example" select with classic textbook problems, validation with `.errors`, a "Why did that happen?" card, and live results.

**Quality bar**
- Student friendly: plain language, key terms defined, a mnemonic ("Memory hook") for each algorithm, formulas shown with the working.
- User-driven: every input editable; nothing hardcoded. Examples are only inputs.
- Great visuals: the animation must show the mechanism (things physically move/highlight), not just a table. Use SVG or absolutely-positioned DOM with CSS transitions. Respect `prefers-reduced-motion` (the global rule already disables transitions).
- Theme: use only CSS variables from `styles.css` (light + dark). No literal colours except the process palette from `util.colorFor`. Put your new CSS in `css/<name>.css` (do NOT edit `css/styles.css`, `index.html`, or `js/app.js`; the integrator wires those). Prefix your class names with a short module prefix to avoid collisions (e.g. `.ma-` for memory allocation).
- Never colour alone: pair colour with text, icon or shape.
- Responsive to a 400px phone width; no horizontal page overflow (wide things scroll inside their own container). Keyboard operable, visible focus (global rule exists), aria-labels on icon buttons and svg.
- Convention switches (like the tie-break selector) wherever textbooks differ.
- Cap input sizes so nothing can hang the browser.

## Tests
`tests/<name>.test.js`, runnable with `node tests/<name>.test.js`, exit code 1 on failure. Verify engines against well-known textbook answers (Silberschatz/Galvin, Tanenbaum, GATE-style) whose results you are certain of (derive by hand; do not just copy the engine output). Print PASS/FAIL lines like `tests/engines.test.js`.

## Visual verification
Chromium is at `/opt/pw-browsers/chromium` (do not run `playwright install`). Python playwright works: `p.chromium.launch(executable_path="/opt/pw-browsers/chromium")`. To check your view without the shell wiring, write a throwaway HTML page in your scratchpad that loads `css/styles.css`, your css, `js/core/*.js`, your engine/view, and a tiny script that calls `OSViz.views.<viewId>.mount(document.getElementById('app'))` then `.activate()`. Take desktop (1360x900) and phone (400x860) screenshots in light and dark (`color_scheme`), step through the player, try an invalid input, and look at the images. Google Fonts will fail to load in the sandbox; ignore that. Check the page for JS errors and horizontal overflow.

## Report back
Reply with: the files you created, the exact `viewId`s and the title for each concept (for the rail), any new CSS file names, test results, and anything you could not finish or that the integrator must know. Keep it short.
