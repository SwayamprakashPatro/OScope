/* Lab: Real-time: EDF and RMS. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/realtime-view.js. Logic: js/engines/realtime.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "realtime",
    "area": "processes",
    "section": "scheduling",
    "title": "Real-time (EDF, RMS)",
    "view": "realtime",
    "level": "advanced",
    "summary": "Periodic tasks with deadlines under Earliest Deadline First and Rate Monotonic scheduling: utilisation tests, schedulability and missed deadlines.",
    "keywords": ["Real-time: EDF and RMS", 
      "real time",
      "realtime",
      "edf",
      "rms",
      "earliest deadline first",
      "rate monotonic",
      "deadline",
      "periodic task",
      "utilization",
      "utilisation",
      "liu layland",
      "hyperperiod",
      "schedulability",
      "hard real time",
      "missed deadline"
    ],
    "learn": {
      "idea": "A real-time task repeats every period T, needs C ticks of CPU each time and must finish before its deadline. RMS gives the shortest period the top fixed priority. EDF always runs the job whose deadline is nearest.",
      "hook": "EDF = earliest deadline first. RMS = rapid repeaters rule.",
      "deep": [
        "Utilisation U is the sum of C/T. Above 1 no scheduler can meet every deadline.",
        "With deadlines equal to periods, EDF meets all deadlines exactly when U <= 1.",
        "RMS is guaranteed up to U = n(2^(1/n) - 1) (about 0.78 for 3 tasks, tending to 0.69). Above that bound it may or may not work.",
        "The RMS bound is sufficient, not necessary: harmonic periods can reach U = 1.",
        "Under overload EDF can fail badly (a domino effect), while RMS sacrifices only the lowest-priority tasks."
      ],
      "mistakes": [
        "Treating the RMS bound as a hard limit: above it you must simulate.",
        "Assuming EDF is always better: it is optimal on one CPU but unpredictable in overload.",
        "Forgetting the hyperperiod (the lcm of the periods) when checking by hand."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
