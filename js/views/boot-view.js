/* Boot sequence card: step from power-on to a login prompt, for BIOS/MBR or UEFI/GPT machines.
   Static teaching content (a fixed sequence of events), shown with the shared step player. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});
  const { el, store } = NS.util, K = NS.cards;
  const KEY = 'oslab.boot.v1';
  const COMMON = (mode) => [
    { name: 'Power on and reset', who: 'CPU hardware', where: 'Reset vector, mapped to firmware flash', does: 'The CPU starts in its simplest mode and jumps to a fixed address (the reset vector) where the firmware lives. No OS, no disk, no memory yet.', fails: 'Dead board or bad power: nothing happens, no beep or screen.' },
    mode === 'bios'
      ? { name: 'Firmware: POST and device search', who: 'BIOS', where: 'Flash chip, runs from ROM', does: 'POST (power-on self-test) checks RAM and basic devices, sets up the hardware, then walks the boot order (disk, USB, network) looking for a device whose first sector is bootable.', fails: 'Beep codes or "no bootable device" if no device has the 0x55AA boot signature.' }
      : { name: 'Firmware: POST and boot entries', who: 'UEFI firmware', where: 'Flash chip plus NVRAM settings', does: 'Initialises hardware and loads drivers, then reads the boot entries saved in NVRAM instead of guessing by sector. If Secure Boot is on, it will only run signed boot programs.', fails: 'Secure Boot violation or missing boot entry: firmware shows an error or its own menu.' },
    mode === 'bios'
      ? { name: 'Load the boot sector (MBR)', who: 'BIOS', where: 'Disk sector 0 (512 bytes, partition table inside)', does: 'BIOS copies the 512-byte master boot record into RAM at 0x7C00 and jumps to it. Only about 440 bytes are code, so it can only load a bigger second-stage loader.', fails: 'Corrupted MBR: "missing operating system" or a hang.' }
      : { name: 'Find and load the boot program (ESP)', who: 'UEFI firmware', where: 'EFI System Partition (a FAT partition on a GPT disk)', does: 'UEFI understands FAT itself, so it reads the boot program file straight from the ESP and runs it as a normal program. No 512-byte limit.', fails: 'File missing or signature rejected: falls back to the next boot entry.' },
    { name: 'Bootloader', who: 'GRUB or similar', where: mode === 'bios' ? 'Stage 1 in MBR, stage 2 after it' : 'A file on the ESP', does: 'Shows the menu, understands filesystems, loads the chosen kernel image and the initial RAM disk (initramfs) into memory, passes the kernel its command line, and jumps to the kernel.', fails: 'Wrong kernel path or config: drops to a "grub rescue" prompt.' },
    { name: 'Kernel starts', who: 'OS kernel', where: 'RAM', does: 'Decompresses itself, switches to full 64-bit mode, turns on paging, sets up the memory manager, interrupts, scheduler and drivers it was built with. From here the OS is in control and firmware is no longer used for I/O.', fails: 'Kernel panic: bad kernel, missing hardware support, or bad command line.' },
    { name: 'Initramfs mounts the real root', who: 'Kernel plus a tiny temporary filesystem', where: 'RAM disk', does: 'The real root filesystem may sit on a disk that needs a driver (RAID, encryption, NVMe) which is not built in. The initramfs loads it, unlocks and mounts the real root, then switches over to it and discards itself.', fails: '"Cannot find root device" or a stuck emergency shell.' },
    { name: 'init (PID 1)', who: 'systemd or another init', where: 'User space, first process', does: 'The kernel starts the first user process. It mounts the other filesystems, starts services (network, logging, display) in dependency order, and adopts orphaned processes for as long as the system runs.', fails: 'A failing required service can drop the system into rescue mode.' },
    { name: 'Login prompt', who: 'Login manager', where: 'User space', does: 'Services are up and the system is ready for a user. Everything after this is normal processes created with fork and exec.', fails: '' }
  ];

  function mount(host) {
    let state = Object.assign({ mode: 'uefi' }, store.get(KEY, {}));
    const save = () => store.set(KEY, state);
    const view = el('section', { class: 'view', 'aria-labelledby': 'bt-title' });
    view.appendChild(K.head('bt-title', 'Boot sequence', 'From pressing the power button to a login prompt: who runs at each step, where that code lives, and what goes wrong. Pick the firmware style and step through.'));
    const chips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Firmware style' }, [['uefi', 'UEFI + GPT'], ['bios', 'BIOS + MBR']].map(([v, t]) => el('button', { type: 'button', class: 'chip-btn', role: 'radio', 'aria-checked': String(state.mode === v), dataset: { v }, onclick: () => { state.mode = v; save(); paint(); build(true); } }, t)));
    const paint = () => chips.querySelectorAll('.chip-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state.mode)));
    view.appendChild(chips);
    const card = el('div', { class: 'card' }), strip = el('ol', { class: 'cd-steps' }), playerHost = el('div'), detail = el('div', { class: 'why' });
    card.append(el('div', { class: 'card-head' }, el('h3', null, 'Boot stages'), el('span', { class: 'sub', id: 'bt-sub' })), strip, el('div', { style: { height: '10px' } }), playerHost, detail);
    const cmp = el('div', { class: 'card' });
    cmp.append(el('div', { class: 'card-head' }, el('h3', null, 'BIOS/MBR versus UEFI/GPT')), K.table(['', 'BIOS + MBR', 'UEFI + GPT'], [
      ['Boot code location', 'First sector of the disk', 'A file on the EFI System Partition'],
      ['Size limit for first code', '~440 bytes, so chain-loading', 'None: a normal program'],
      ['Disk size limit', '2 TB (32-bit sector numbers)', 'About 9 ZB'],
      ['Partitions', '4 primary (or extended trick)', '128 by default, with backup table'],
      ['Verification', 'None', 'Secure Boot signature checks'],
      ['Mode the loader starts in', '16-bit real mode', 'Already 32 or 64-bit']]),
      K.note('Memory hook:', 'Power, Firmware, Boot loader, Kernel, Init, Login: "Please Find Big Kernels In Lunchboxes".'),
      K.note('Honest limit:', 'Real machines add many sub-steps (ACPI tables, option ROMs, trusted boot measurement, kernel module loading); this card shows the main chain on a typical PC, not every vendor path.'));
    view.append(card, cmp); host.appendChild(view);
    const player = new NS.Player(playerHost, { label: 'Stage', onChange: (i) => draw(i) });
    let stages = [];
    function build(keep) { stages = COMMON(state.mode); player.setStops(stages.map((_, i) => i + 1), keep ? Math.min(player.pos, stages.length - 1) : 0); }
    function draw(i) {
      const s = stages[i - 1] || stages[0]; i = i - 1;
      strip.replaceChildren(...stages.map((x, j) => el('li', { class: j === i ? 'on' : j < i ? 'done' : '' }, x.name)));
      document.getElementById('bt-sub').textContent = 'Stage ' + (i + 1) + ' of ' + stages.length;
      detail.replaceChildren(el('h4', null, s.name), el('dl', null, el('dt', null, 'Who runs'), el('dd', null, s.who), el('dt', null, 'Where the code is'), el('dd', null, s.where), el('dt', null, 'What happens'), el('dd', null, s.does), ...(s.fails ? [el('dt', null, 'If it fails'), el('dd', null, s.fails)] : [])));
    }
    build(false);
    return { activate() { NS.Player.current = player; }, deactivate() { player.pause(); } };
  }
  NS.views = NS.views || {}; NS.views.boot = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
