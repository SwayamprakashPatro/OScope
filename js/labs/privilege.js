/* Lab: Privilege rings & access control. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/privilege-view.js. Logic: js/engines/concepts.js (where there is any calculation). */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "privilege",
  "area": "system",
  "section": "protect",
  "title": "Privilege rings",
  "view": "privilege",
  "level": "advanced",
  "summary": "Hardware rings protect the kernel; the access matrix, ACLs and capabilities decide who may use which object.",
  "keywords": ["Privilege rings & access control", 
    "privilege",
    "rings",
    "ring 0",
    "kernel mode",
    "user mode",
    "protection",
    "access matrix",
    "acl",
    "access control list",
    "capability",
    "capabilities",
    "permissions",
    "protection domain",
    "least privilege",
    "confused deputy",
    "revocation"
  ],
  "learn": {
    "idea": "Protection has two layers: the CPU keeps user code out of kernel mode, and the OS keeps users out of each other's objects. The access matrix lists every (subject, object, rights) triple; ACLs store its columns and capabilities store its rows.",
    "hook": "Low ring number = high power. ACL = guest list at each object's door. Capability = ticket in the subject's pocket.",
    "deep": [
      "The CPU records the current ring. Privileged instructions fail outside ring 0, and user code enters the kernel only via system calls and interrupts the kernel set up.",
      "The access matrix is a model: rows are subjects (domains), columns are objects, cells are rights.",
      "ACLs make \"who can use this?\" and revoking easy; capabilities make \"what can this subject do?\" and delegating easy, and avoid ambient authority.",
      "Least privilege means each subject holds only the rights its job needs.",
      "The confused deputy problem: a program with its own authority is tricked into using it for someone else. Capabilities pair the right with the designation, which helps."
    ],
    "mistakes": [
      "Confusing the ring (hardware mode) with the user account (software identity).",
      "Believing a capability is just an ACL entry; it is held by the subject and passed around.",
      "Forgetting that revoking a capability is hard once copies have been handed out."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
