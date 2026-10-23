/* Lab: fork, exec, wait and zombies. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/forkwait-view.js. Logic: js/engines/forkwait.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "forkwait",
    "area": "processes",
    "section": "lifecycle",
    "title": "Fork, exec & wait",
    "view": "forkwait",
    "level": "core",
    "summary": "Build a process tree with fork, exec, wait and exit; see zombies, orphans and what init does.",
    "keywords": ["fork, exec, wait and zombies", 
      "fork",
      "exec",
      "wait",
      "exit",
      "zombie",
      "orphan",
      "process tree",
      "init",
      "pid",
      "parent child",
      "waitpid",
      "reaping",
      "process creation",
      "defunct"
    ],
    "learn": {
      "idea": "Every process except the first is created by another with fork(), which copies the caller. exec() then replaces the program in that process. When a process exits, it stays as a zombie until its parent calls wait() to collect the exit status.",
      "hook": "Fork copies, exec replaces, exit leaves a corpse, wait buries it.",
      "deep": [
        "fork() returns the child's pid in the parent and 0 in the child; that is how one program tells the two apart.",
        "A shell runs a command by fork, exec in the child, and wait in the parent.",
        "A zombie uses no CPU or memory but still occupies a process-table slot, so zombie leaks can exhaust pids.",
        "If a parent dies first, its children become orphans and are adopted by init (pid 1), which reaps them.",
        "wait() blocks if children exist but none has exited, and fails with ECHILD if there are no children."
      ],
      "mistakes": [
        "Thinking a zombie is still running: it is dead and only its exit code remains.",
        "Believing kill removes a zombie: only the parent's wait (or the parent dying) does.",
        "Confusing orphan (parent gone) with zombie (child finished, not collected)."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
