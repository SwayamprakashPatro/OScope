/* Lab: Directories, links & permissions. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/dirs-view.js (built with js/views/lab-kit.js). Logic: js/engines/dirs.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "dirs",
  "area": "storage",
  "section": "fs",
  "title": "Directories & links",
  "view": "dirs",
  "level": "advanced",
  "summary": "A tiny Unix file system: directory tree, hard and symbolic links, and exactly why each permission check passes or fails.",
  "keywords": ["Directories, links & permissions", 
    "directory",
    "links",
    "hard link",
    "symbolic link",
    "symlink",
    "inode",
    "link count",
    "permissions",
    "rwx",
    "chmod",
    "chown",
    "owner group other",
    "umask",
    "file permissions",
    "access control",
    "dangling symlink",
    "path traversal"
  ],
  "learn": {
    "idea": "Directories map names to inodes. A hard link is another name for the same inode; a symbolic link is a file holding a path. Permissions are checked in the order owner, group, other, and walking a path needs search (x) permission on every directory along the way.",
    "hook": "rwx = 4 2 1. Owner, Group, Other: the first class that fits is the only one that counts.",
    "deep": [
      "Removing a name needs write permission on the directory, not on the file.",
      "A file is freed only when its link count reaches zero and nobody holds it open.",
      "A symbolic link stores text, so it can dangle (target gone) or loop.",
      "Hard links cannot cross file systems and cannot point at directories.",
      "Root bypasses permission checks."
    ],
    "mistakes": [
      "Thinking the owner can always access their file. If the owner bits are stricter than the group bits, the owner is still refused.",
      "Thinking rm deletes data. It removes a name.",
      "Forgetting the x bit on directories."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
