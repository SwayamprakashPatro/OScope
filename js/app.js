/* App shell: concept rail, theme switch, hash routing. Add a concept by adding an entry to CONCEPTS
   and a view that exposes mount(host) → { activate, deactivate }. */
(function (root) {
  "use strict";
  const NS = root.OSViz;
  const { el, store } = NS.util;

  // The rail of concepts. group = heading in the sidebar, id = URL hash (#paging), view = key in
  // OSViz.views that builds the screen. To add a concept: add a row here, write the view, add a <script> tag.
  const CONCEPTS = [
    {
      group: "Processes",
      id: "scheduling",
      title: "CPU scheduling",
      view: "scheduling",
    },
    {
      group: "Processes",
      id: "states",
      title: "Process states",
      view: "states",
    },
    {
      group: "Memory",
      id: "paging",
      title: "Page replacement",
      view: "paging",
    },
    {
      group: "Memory",
      id: "allocation",
      title: "Memory allocation",
      view: "allocation",
    },
    {
      group: "Memory",
      id: "translation",
      title: "Address translation",
      view: "translation",
    },
    { group: "Storage", id: "disk", title: "Disk scheduling", view: "disk" },
    {
      group: "Coordination",
      id: "bankers",
      title: "Banker’s algorithm",
      view: "bankers",
    },
    { group: "Coordination", id: "rag", title: "Deadlock graphs", view: "rag" },
    {
      group: "Coordination",
      id: "sync",
      title: "Synchronization",
      view: "sync",
    },
  ];
  // A row is clickable only if its view script actually loaded; otherwise the rail shows "soon".
  // A concept is live once its view script has loaded; otherwise it shows as "soon".
  CONCEPTS.forEach((c) => {
    c.soon = !(NS.views && NS.views[c.view]);
  });

  // mounted[id] = the object returned by that view's mount(); views are built lazily on first visit
  // and then kept alive (so your inputs are not lost when you switch concepts). current = visible id.
  const mounted = {};
  let current = null;

  // applyTheme: 'light' / 'dark' force a theme through a data-theme attribute on <html>;
  // 'system' removes it so the CSS prefers-color-scheme media query decides.
  function applyTheme(mode) {
    const r = document.documentElement;
    if (mode === "light" || mode === "dark") r.setAttribute("data-theme", mode);
    else r.removeAttribute("data-theme");
  }

  // build(): create the page frame (header, theme switch, sidebar rail, main area) and start routing.
  function build() {
    const app = document.getElementById("app");
    const themeMode = store.get("oslab.theme", "system");
    applyTheme(themeMode);

    // Theme switch: remember the choice in localStorage and update the pressed state of the three buttons.
    const themeBtns = ["system", "light", "dark"].map((m) =>
      el(
        "button",
        {
          type: "button",
          "aria-pressed": String(m === themeMode),
          dataset: { mode: m },
          onclick: () => {
            store.set("oslab.theme", m);
            applyTheme(m);
            themeBtns.forEach((b) =>
              b.setAttribute("aria-pressed", String(b.dataset.mode === m)),
            );
          },
        },
        m[0].toUpperCase() + m.slice(1),
      ),
    );

    // Sidebar: one button per concept, grouped under headings. Unavailable concepts are disabled.
    const rail = el("nav", { class: "rail", "aria-label": "Concepts" });
    const groups = [...new Set(CONCEPTS.map((c) => c.group))];
    const railBtns = {};
    groups.forEach((g) => {
      rail.appendChild(
        el(
          "div",
          { class: "rail-group" },
          el("h2", null, g),
          el(
            "div",
            { class: "rail-list" },
            CONCEPTS.filter((c) => c.group === g).map((c) => {
              const b = el(
                "button",
                {
                  type: "button",
                  class: "rail-item",
                  disabled: !!c.soon,
                  onclick: () => go(c.id),
                },
                c.title,
                c.soon ? el("span", { class: "soon" }, "soon") : null,
              );
              railBtns[c.id] = b;
              return b;
            }),
          ),
        ),
      );
    });

    // One hidden container per live concept; only the current one is shown.
    const main = el("main", { id: "main" });
    const stages = {};
    CONCEPTS.filter((c) => !c.soon).forEach((c) => {
      stages[c.id] = el("div", { hidden: true });
      main.appendChild(stages[c.id]);
    });

    app.append(
      el(
        "header",
        { class: "topbar" },
        el(
          "div",
          { class: "brand" },
          NS.util.svg(
            "svg",
            {
              class: "brand-mark",
              width: 34,
              height: 34,
              viewBox: "0 0 34 34",
              "aria-hidden": "true",
            },
            NS.util.svg("rect", {
              x: 8,
              y: 8,
              width: 18,
              height: 18,
              rx: 4,
              fill: "none",
              stroke: "currentColor",
              "stroke-width": 2.2,
            }),
            NS.util.svg("path", {
              d: "M13 3v5M21 3v5M13 26v5M21 26v5M3 13h5M3 21h5M26 13h5M26 21h5",
              stroke: "currentColor",
              "stroke-width": 2.2,
              "stroke-linecap": "round",
            }),
            NS.util.svg("rect", {
              x: 14,
              y: 14,
              width: 6,
              height: 6,
              rx: 1.5,
              fill: "var(--accent)",
            }),
          ),
          el(
            "div",
            null,
            el("h1", null, "OScope"),
            el(
              "p",
              null,
              "Type your own problem, then watch the operating system work it out.",
            ),
          ),
        ),
        el(
          "div",
          { class: "theme", role: "group", "aria-label": "Colour theme" },
          themeBtns,
        ),
      ),
      el("div", { class: "shell" }, rail, main),
    );

    // go(id): switch concept. Pause the old view's player, show the new container, mark the rail item,
    // mount the view if this is its first visit, activate it (routes keyboard shortcuts to its player),
    // and update the URL hash and page title. Unknown ids fall back to the first concept.
    function go(id, fromHash) {
      const c = CONCEPTS.find((x) => x.id === id && !x.soon) || CONCEPTS[0];
      if (current === c.id) return;
      if (current && mounted[current]) mounted[current].deactivate();
      Object.keys(stages).forEach((k) => {
        stages[k].hidden = k !== c.id;
      });
      Object.keys(railBtns).forEach((k) => {
        if (k === c.id) railBtns[k].setAttribute("aria-current", "page");
        else railBtns[k].removeAttribute("aria-current");
      });
      if (!mounted[c.id]) mounted[c.id] = NS.views[c.view].mount(stages[c.id]);
      mounted[c.id].activate();
      current = c.id;
      if (!fromHash) {
        try {
          history.replaceState(null, "", "#" + c.id);
        } catch (e) {
          /* ignore */
        }
      }
      document.title = c.title + " · OScope";
    }

    // Back / forward buttons and pasted links (#sync) drive the same go().
    window.addEventListener("hashchange", () =>
      go(location.hash.slice(1), true),
    );
    go(location.hash.slice(1) || "scheduling", true);
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", build);
  else build();
})(window);
