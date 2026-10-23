/* Lab: Boot sequence. Description for the sidebar, search and the "Go deeper" card.
   Screen: js/views/boot-view.js. Logic: js/engines/concepts.js (where there is any calculation). */
(function (root) {
  'use strict';
  root.OSViz.labs.register({
  "id": "boot",
  "area": "system",
  "section": "kernel",
  "title": "Boot sequence",
  "view": "boot",
  "level": "advanced",
  "summary": "From power button to login: firmware, bootloader, kernel, initramfs, init, for BIOS/MBR and UEFI/GPT.",
  "keywords": [
    "boot",
    "booting",
    "bios",
    "uefi",
    "mbr",
    "gpt",
    "grub",
    "bootloader",
    "initramfs",
    "systemd",
    "init",
    "kernel panic",
    "secure boot",
    "post",
    "esp"
  ],
  "learn": {
    "idea": "Booting is a relay race of ever-bigger programs. Each one is just large enough to find and start the next, until the kernel and then the first user process (init) are running.",
    "hook": "Power, Firmware, Boot loader, Kernel, Init, Login: \"Please Find Big Kernels In Lunchboxes\".",
    "deep": [
      "The CPU starts at a fixed reset address inside firmware, because RAM is empty and nothing else is known.",
      "BIOS reads one 512-byte sector and jumps into it, so a tiny first stage must chain-load a bigger loader. UEFI reads a real file from a FAT partition, so the loader is an ordinary program.",
      "Secure Boot makes each stage verify the signature of the next, so a modified loader or kernel is refused.",
      "The initramfs exists because the driver needed to reach the real root filesystem may itself live on that filesystem.",
      "init is PID 1: it starts services and adopts orphaned processes."
    ],
    "mistakes": [
      "Thinking the OS loads the BIOS. The firmware loads the bootloader, which loads the kernel.",
      "Mixing up MBR (a sector of code and a partition table) with the bootloader (the program the MBR starts).",
      "Treating a kernel panic and a bootloader failure as the same: they happen at different stages."
    ]
  }
});
})(typeof window !== 'undefined' ? window : globalThis);
