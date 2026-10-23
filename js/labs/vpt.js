/* Lab: Shadow & nested page tables. Description for the sidebar, search and the "Go deeper" card.
   The screen is built by js/views (view key: vpt) and the logic by js/engines/vpt.js. */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
    id: 'vpt',
    area: 'memory',
    section: 'translation',
    title: 'Shadow & nested page tables',
    view: 'vpt',
    level: 'advanced',
    summary: 'How a virtual machine translates addresses through two layers, and why shadow paging and nested paging (EPT/NPT) cost different things.',
    keywords: [
      'shadow page table', 'nested page table', 'nested paging', 'EPT', 'NPT', 'extended page tables', 'two-dimensional page walk',
      'virtualization', 'virtual machine', 'hypervisor', 'VM exit', 'guest physical address', 'host physical address', 'TLB miss cost',
      'page walk', 'memory virtualization', 'CR3', 'second level address translation', 'SLAT'
    ],
    learn: {
      idea: 'Inside a virtual machine the guest OS thinks it controls real memory, but its "physical" addresses are really just more virtual addresses. Two translations are needed: guest virtual to guest physical (the guest\'s table) and guest physical to host physical (the hypervisor\'s table). The two methods differ in who stitches them together.',
      hook: 'Shadow = the hypervisor Spies on edits. Nested = the hardware Nests a walk inside a walk. (Shadow: cheap miss, costly edits. Nested: costly miss, free edits.)',
      deep: [
        'Shadow paging: the hypervisor keeps a combined table (guest virtual to host physical) and gives it to the MMU. Misses walk only g levels, like native. The price is that the hypervisor must notice every change to the guest tables, so it write-protects them, and every edit, process switch and first touch becomes a VM exit.',
        'Nested paging (Intel EPT, AMD NPT): the MMU walks both tables. Every guest-table address is itself a guest-physical address that needs a host walk, so a miss costs (g+1)(h+1)-1 references: 24 for 4 levels each, against 4 natively.',
        'The grid in the lab is that walk: each row translates one guest-physical pointer through the host table, then reads one guest entry.',
        'Which is better depends on the workload. A program that touches memory in a stable pattern (TLB friendly) hardly notices either. One that builds and tears down mappings constantly (fork, mmap, short-lived processes) suffers under shadow. One that streams over a huge working set, missing the TLB constantly, suffers under nested.',
        'Real systems soften the nested cost with page-walk caches, huge pages (fewer levels) and large TLBs; none of those are modelled here, so the absolute numbers are teaching figures, not benchmarks.'
      ],
      mistakes: [
        'Thinking nested paging makes every access slower. A TLB hit costs the same under all methods; only misses differ.',
        'Thinking shadow paging walks two tables. The hardware walks one combined table; the cost is in keeping it in sync.',
        'Mixing up the two levels: the guest cannot see host physical addresses at all.',
        'Treating the VM-exit cost as a fixed number. It varies by CPU and hypervisor, which is why the lab lets you change it.',
        'Forgetting that a deeper guest table makes a nested walk longer too: the cost grows with the product of the two depths.'
      ]
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
