/* Lab: Deadlock graphs. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: rag) and the maths by js/engines. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "rag",
  "area": "concurrency",
  "section": "deadlock",
  "title": "Deadlock graphs",
  "view": "rag",
  "level": "core",
  "summary": "Does this pattern of holding and waiting produce a deadlock?",
  "keywords": [
    "resource allocation graph",
    "RAG",
    "wait-for graph",
    "deadlock detection",
    "deadlock",
    "circular wait",
    "cycle detection",
    "four conditions",
    "Coffman conditions",
    "graph reduction",
    "mutual exclusion",
    "hold and wait",
    "no preemption",
    "deadlock recovery",
    "victim selection",
    "process termination",
    "resource preemption",
    "rollback",
    "abort one process"
  ],
  "learn": {
    "idea": "Draw who holds which resource and who is waiting for which. A cycle in that picture can reveal a deadlock.",
    "hook": "One instance per resource: a cycle means deadlock. Several instances: a cycle means maybe.",
    "deep": [
      "A request edge points from a process to a resource. An assignment edge points from a resource to a process.",
      "With single-instance resources a cycle is necessary and sufficient. With multiple instances it is necessary but not sufficient, so run the reduction to be sure.",
      "A wait-for graph removes the resources and keeps only process-to-process edges. A cycle there means deadlock when resources have one instance.",
      "The four conditions are mutual exclusion, hold and wait, no preemption and circular wait. Break any one and deadlock cannot occur.",
      "Recovery has three common forms: terminate every deadlocked process (simple, wasteful), terminate one at a time and re-run detection (cheaper), or preempt one resource and roll the victim back (nobody dies, but the victim can starve).",
      "The victim is usually chosen by cost: how much work it has done, how many resources it holds, its priority and how many processes would have to be killed. Only a process that holds something another stuck process needs can help."
    ],
    "mistakes": [
      "Calling every cycle a deadlock when resources have several instances.",
      "Drawing an edge in the wrong direction (request versus assignment).",
      "Forgetting that a deadlocked set can be smaller than the set of processes that are waiting.",
      "Killing a process that merely waits behind the circle: it holds nothing anyone needs, so it frees nothing.",
      "Preempting a resource without rolling the victim back to a safe point: it would carry on with half-finished work."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
