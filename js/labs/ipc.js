/* Lab: Pipes, message queues and signals. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/ipc-view.js. Logic: js/engines/ipc.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    "id": "ipc",
    "area": "processes",
    "section": "comm",
    "title": "Pipes, queues & signals",
    "view": "ipc",
    "level": "advanced",
    "summary": "Three ways processes communicate: a byte-stream pipe, a priority message queue and asynchronous signals, with blocking, closing and masking.",
    "keywords": ["Pipes, message queues and signals", 
      "pipe",
      "pipes",
      "message queue",
      "mq",
      "signal",
      "signals",
      "ipc",
      "inter process communication",
      "sigint",
      "sigkill",
      "sigterm",
      "sigstop",
      "sigpipe",
      "signal handler",
      "signal mask",
      "blocking",
      "end of file"
    ],
    "learn": {
      "idea": "Processes cannot touch each other's memory, so the kernel carries messages for them. A pipe is a bounded byte stream. A message queue passes whole messages, highest priority first. A signal is a small asynchronous notification.",
      "hook": "Pipe = stream, queue = letters, signal = tap on the shoulder.",
      "deep": [
        "A full pipe blocks the writer and an empty pipe blocks the reader: this is the bounded-buffer problem solved by the kernel.",
        "Closing the write end gives the reader end-of-file; writing after the read end is closed raises SIGPIPE.",
        "Pipes have no message boundaries: two 5-byte writes may be read as one 10-byte read.",
        "Standard signals do not queue: many identical pending signals are delivered once.",
        "SIGKILL and SIGSTOP can never be caught, blocked or ignored, so an administrator can always stop a process."
      ],
      "mistakes": [
        "Expecting a pipe read to return exactly what one write sent.",
        "Counting signals: three blocked SIGUSR1s still run the handler once.",
        "Trying to install a handler for SIGKILL."
      ]
    }
});
})(typeof window !== 'undefined' ? window : globalThis);
