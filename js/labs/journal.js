/* Lab: Journaling and crash recovery. Description for the sidebar, search and the "Go deeper" card.
   The screen itself is built by js/views (view key: journal) and the logic by js/engines/journal.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'journal',
    area: 'storage',
    section: 'fs',
    title: "Journaling",
    view: 'journal',
    level: 'advanced',
    summary: 'What happens to a file system when the power fails in the middle of an update, and how a journal makes it all-or-nothing.',
    keywords: ["Journaling & crash recovery", 
      'journaling', 'journal', 'write-ahead log', 'WAL', 'crash consistency', 'crash recovery', 'fsck', 'ext3', 'ext4',
      'data=ordered', 'data=writeback', 'data=journal', 'commit record', 'checkpoint', 'replay', 'atomic update',
      'transaction', 'file system consistency', 'inconsistency', 'orphan inode', 'space leak', 'NTFS log', 'metadata journaling',
      'power failure', 'torn write', 'stale data exposure'
    ],
    learn: {
      idea: 'One file-system change (append a block, create a file) needs several separate block writes, and a disk writes one block at a time. If the power fails between the writes, the disk is left half-updated. A journal writes down what it is about to do, seals it with a commit record, and only then does it. After a crash the OS replays sealed entries and discards unsealed ones.',
      hook: 'Write it down, seal it, then do it. Sealed = replay, not sealed = forget. (WAL: Write A Log first.)',
      deep: [
        'Appending to a file needs three updates: the data block, the bitmap (the block is now allocated) and the inode (it points at the block). Any crash between them breaks a rule: a leaked block, a pointer to a block the bitmap calls free, or a pointer to a block with no data.',
        'Without a journal, fsck scans the whole disk after a crash to find and repair such damage, which takes minutes to hours on a big disk. No write order is safe for every operation; the order only decides which kind of damage a crash causes.',
        'A journal transaction is: begin record, copies of the blocks, then a commit record (written only after everything before it is on disk). The checkpoint copies the blocks to their home places and then frees the log space. Recovery replays committed transactions and ignores the rest, so the work is proportional to the journal, not the disk.',
        'Ordered mode (the ext4 default) logs only metadata but forces the data blocks to disk BEFORE the commit, so a committed transaction never points at unwritten data. Writeback mode drops that ordering and can expose stale data after a crash. Full data journaling logs everything and writes data twice.',
        'The commit record is the dividing line: crash before it and the operation never happened; crash after it and replay makes it happen. That single write is what turns many writes into one atomic action.',
        'Journals protect file-system structure, not your application: a program that needs a file and its index updated together still needs its own protocol (write to a temporary file, fsync, rename).'
      ],
      mistakes: [
        'Believing a journal prevents data loss. It prevents inconsistency; an operation that was not committed is simply lost whole.',
        'Writing the commit record before the logged blocks are on disk: the disk may reorder writes, so a "committed" transaction could be replayed with missing blocks. Real systems use a barrier or flush between them.',
        'Assuming metadata journaling also protects the file contents. In writeback mode a file can point at blocks that hold someone else\'s old data.',
        'Thinking the journal is a backup. It only holds recent, not-yet-copied transactions and is freed after the checkpoint.',
        'Treating the write order as irrelevant without a journal: data-first leaks space, metadata-first gives names and pointers that lead nowhere.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
