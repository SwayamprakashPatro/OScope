/* Lab: Virtual machine vs container. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/vmcont-view.js. Logic: js/engines/concepts.js (where there is any calculation). */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "vmcont",
  "area": "system",
  "section": "protect",
  "title": "VM vs container",
  "view": "vmcont",
  "level": "advanced",
  "summary": "A hypervisor virtualises hardware; a container shares the host kernel, isolated by namespaces and limited by cgroups.",
  "keywords": ["Virtual machine vs container", 
    "virtual machine",
    "vm",
    "container",
    "docker",
    "namespace",
    "cgroup",
    "hypervisor",
    "isolation",
    "kubernetes",
    "lxc",
    "pid namespace",
    "cpu shares",
    "oom",
    "sandbox"
  ],
  "learn": {
    "idea": "A virtual machine runs a whole guest OS on virtual hardware. A container is an ordinary process (or group) on the host kernel, made to believe it is alone by namespaces and kept within a budget by cgroups.",
    "hook": "VM = a whole computer in a box. Container = a process in a costume. Namespaces say what you can see; cgroups say what you can use.",
    "deep": [
      "Namespaces give a process its own view of PIDs, network, mounts, hostname, IPC, users and cgroups.",
      "cgroups meter CPU, memory, I/O and process counts. CPU weights only matter when the CPU is contended; a memory limit triggers an OOM kill inside the group.",
      "Containers start fast and pack densely because there is no guest kernel to boot or hold in memory.",
      "All containers share one kernel, so a kernel vulnerability is a shared risk. VMs put a smaller hypervisor interface in between, at the cost of overhead.",
      "They combine: many clouds run containers inside VMs."
    ],
    "mistakes": [
      "Calling a container a lightweight VM. There is no second kernel.",
      "Thinking namespaces limit resource use; that is the cgroup job.",
      "Assuming root in a container is harmless. Without a user namespace it is root on the host kernel."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
