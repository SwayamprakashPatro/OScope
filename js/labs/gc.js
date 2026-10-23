/* Lab: Garbage collection. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: gc) and the logic by js/engines/gc.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'gc',
    area: 'memory',
    section: 'alloc',
    title: 'Garbage collection',
    view: 'gc',
    level: 'advanced',
    summary: 'Who frees the memory nobody can reach? Compare mark-and-sweep, reference counting and a copying collector.',
    keywords: [
      'mark and sweep', 'mark-sweep', 'tracing', 'reference counting', 'refcount', 'cyclic reference', 'cycle leak',
      'memory leak', 'copying collector', 'Cheney', 'semispace', 'stop the world', 'roots', 'reachability',
      'tri-colour', 'tricolor', 'heap', 'fragmentation', 'compaction', 'forwarding pointer', 'dangling pointer',
      'use after free', 'automatic memory management', 'Java GC', 'Python gc', 'weak reference'
    ],
    learn: {
      idea: 'A program keeps allocating objects and dropping pointers to them. A garbage collector finds the objects nobody can reach any more and gives their memory back, so the programmer does not have to call free.',
      hook: 'Reachable = alive. Trace from the roots (mark and sweep, copying) or count arrows pointing in (reference counting). Counting is fast but cannot see a ring of objects that only point at each other.',
      deep: [
        'Roots are the starting points: stack variables, globals, registers. An object is live if a chain of pointers leads to it from a root. Everything else is garbage, even if it still points at other objects.',
        'Mark-and-sweep: stop the program, mark everything reachable (tri-colour: white = unseen, grey = seen but not yet scanned, black = done), then sweep the heap and free every white object. The pause grows with the heap, and the freed cells are scattered (fragmentation).',
        'Reference counting frees an object the instant its count reaches 0 and releases its pointers in turn (a cascade). Pauses are tiny and spread out, but two objects pointing at each other never reach 0, so cycles leak. Python adds a cycle detector; Swift and Rust use weak pointers to break cycles.',
        'Copying (Cheney semispace): copy live objects breadth-first into the empty half of the heap, leaving forwarding pointers so shared objects are copied once; when the scan pointer catches the free pointer you are done and the halves swap. Cost depends only on live data, and survivors end up packed together, but half of the memory is always idle.',
        'Generational collectors rely on the observation that most objects die young: collect a small young area often with a copying collector, and the old area rarely with mark-and-sweep.',
        'Garbage collection does not prevent every leak: an object that is still reachable but never used again (a forgotten entry in a cache or list) stays alive forever.'
      ],
      mistakes: [
        'Thinking an unreachable object is freed immediately. Tracing collectors free it only at the next collection; until then it is floating garbage.',
        'Believing reference counting handles everything: a cycle of two objects keeps both counts at 1 forever.',
        'Forgetting that a new object with no root can already be garbage: if a collection runs before it is stored somewhere, it is freed.',
        'Assuming mark-and-sweep compacts memory. It does not: free space becomes holes, and a big object may fail to fit even when enough cells are free in total.',
        'Mixing up "unreachable" with "unreferenced": an unreachable object can still have a non-zero reference count.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
