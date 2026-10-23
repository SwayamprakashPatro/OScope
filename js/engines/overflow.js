/* Buffer-overflow engine: an ABSTRACT, educational model of one stack frame on a toy 16-bit machine. Pure logic, no DOM.

   There is no real machine code and no real operating-system address here. The "program" is a table of named
   functions at made-up addresses; the "attack" is only a choice of bytes that names one of them. The point is to
   see WHY an unchecked copy corrupts a neighbour and how each defence stops it.

   The stack grows DOWN, so inside one frame the low addresses come first. From low to high the frame holds:
     buf[N]      a local character buffer (4 to 16 bytes)
     auth        a one-byte local flag ("is this user an administrator?"), then one padding byte
     canary      (optional) a 2-byte secret value placed before the saved registers
     saved FP    the caller's frame pointer (2 bytes)
     return addr where the function will jump back to (2 bytes, little-endian: low byte first)
   followed by the caller's frame. A copy runs UP the addresses, so a too-long input walks through each of these in turn.

   Everything shown (the distances, which byte lands where, the outcome) is computed from the bytes you type. */
(function (root) {
  'use strict';
  const NS = (root.OSViz = root.OSViz || {});

  const LIMITS = { minBuf: 4, maxBuf: 16, maxInput: 64, callerBytes: 16 };
  const STACK_BASE = 0x7F40;                  // address of buf[0] in this toy machine
  const STACK_LO = 0x7F00, STACK_HI = 0x7FFF; // the stack segment: data, never code (that is what NX protects)

  // The toy program's functions at made-up addresses. No address contains a 00 byte, so a string copy is not
  // stopped by an "address byte" (real programs have that complication; the model leaves it out).
  const FUNCS = [
    { id: 'main_after', name: 'main (after the call)', addr: 0x1142, note: 'where vuln() is supposed to return to' },
    { id: 'log_message', name: 'log_message', addr: 0x1257, note: 'an ordinary function the program also contains' },
    { id: 'secret_admin', name: 'secret_admin', addr: 0x13A9, note: 'a function that must never be reachable from user input' }
  ];

  const COPIES = [
    { id: 'strcpy', short: 'Unchecked (strcpy)', name: 'Unchecked copy (strcpy)',
      rule: 'Copy bytes from the input into the buffer until a zero byte (the end-of-string marker) is found. It never asks how big the buffer is.',
      hook: 'strcpy trusts the string: the string decides how far the write goes.',
      watch: 'A string longer than the buffer keeps writing up the stack, over every neighbour, until its terminator.' },
    { id: 'strncpy', short: 'Bounded (strncpy)', name: 'Bounded copy (strncpy)',
      rule: 'Copy at most N bytes, where N is the buffer size. The write can never leave the buffer.',
      hook: 'Count first, copy second.',
      watch: 'If the input is N bytes or longer, no terminator is written, so a later string function may read past the end. It protects the neighbours but is easy to misuse.' },
    { id: 'checked', short: 'Checked (reject)', name: 'Bounds-checked copy (reject long input)',
      rule: 'Compare the input length (plus the terminator) with the buffer size first. If it does not fit, refuse and return an error.',
      hook: 'Validate the length, then copy.',
      watch: 'Safe, but only for this one copy: every other write in the program needs the same discipline (or a memory-safe language).' }
  ];
  const COPY_BY_ID = {}; COPIES.forEach((c) => { COPY_BY_ID[c.id] = c; });

  const hex = (v, w) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w == null ? 4 : w, '0');
  const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
  const ch = (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '·');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // addrBytes(a): a 16-bit address as the two bytes stored in memory, little-endian (low byte first).
  const addrBytes = (a) => [a & 0xFF, (a >> 8) & 0xFF];

  /* ------------------------------------------------------------- input */

  // parseInput(text, mode): turn what the user typed into bytes. mode 'text': every character is one byte (its code,
  // 32 to 126). mode 'hex': space-separated byte values like "41 41 A9 13". Errors are readable.
  function parseInput(text, mode) {
    const errors = [], bytes = [];
    const t = String(text == null ? '' : text);
    if (mode === 'hex') {
      t.split(/[\s,]+/).filter(Boolean).forEach((tok) => {
        const m = /^(?:0x)?([0-9a-fA-F]{1,2})$/.exec(tok);
        if (!m) errors.push('"' + tok + '" is not a byte. Write two hex digits per byte, for example 41 or A9.'); else bytes.push(parseInt(m[1], 16));
      });
    } else {
      for (const c of t.replace(/\r?\n/g, '')) { const k = c.charCodeAt(0); if (k < 32 || k > 126) { errors.push('Character "' + c + '" is not plain ASCII. Use letters, digits and symbols, or switch to hex bytes.'); break; } bytes.push(k); }
    }
    if (bytes.length > LIMITS.maxInput) errors.push('At most ' + LIMITS.maxInput + ' bytes of input (you typed ' + bytes.length + ').');
    return { ok: errors.length === 0, errors, bytes };
  }

  /* ------------------------------------------------------------- layout */

  // layout(cfg): the regions of the frame, low address first, with offsets from buf[0]. Also the distances an
  // attacker would need, computed from the layout (not stored).
  function layout(cfg) {
    const regs = [{ id: 'buf', label: 'buf', len: cfg.buf }, { id: 'auth', label: 'auth flag', len: 1 }, { id: 'pad', label: 'padding', len: 1 }];
    if (cfg.canary) regs.push({ id: 'canary', label: 'stack canary', len: 2 });
    regs.push({ id: 'fp', label: 'saved FP', len: 2 }, { id: 'ret', label: 'return address', len: 2 }, { id: 'caller', label: 'caller\'s frame', len: LIMITS.callerBytes });
    let off = 0; regs.forEach((r) => { r.off = off; r.addr = STACK_BASE + off; off += r.len; });
    const by = {}; regs.forEach((r) => { by[r.id] = r; });
    return { regions: regs, by, size: off, toAuth: by.auth.off, toCanary: by.canary ? by.canary.off : null, toRet: by.ret.off };
  }
  const regionAt = (L, off) => L.regions.find((r) => off >= r.off && off < r.off + r.len) || null;

  /* ------------------------------------------------------------- the run */

  // functionsFor(cfg): the REAL addresses of the toy functions this run. With ASLR on, every function is shifted by the
  // same random multiple of 0x100 (chosen by the seed), so an address copied from a "map of the program" no longer matches.
  function functionsFor(cfg) {
    const shift = cfg.aslr ? (1 + Math.floor(mulberry32((cfg.seed | 0) * 7919 + 13)() * 7)) * 0x100 : 0;
    return { shift, list: FUNCS.map((f) => Object.assign({}, f, { real: f.addr + shift })) };
  }
  // canaryFor(cfg): two secret bytes derived from the seed (never 00, which would make the demo too easy to read).
  function canaryFor(cfg) { const r = mulberry32((cfg.seed | 0) * 104729 + 7); return [1 + Math.floor(r() * 255), 1 + Math.floor(r() * 255)]; }

  function checkConfig(cfg) {
    const errors = [], c = { buf: +cfg.buf, copy: cfg.copy, canary: !!cfg.canary, nx: !!cfg.nx, aslr: !!cfg.aslr, seed: Math.trunc(+cfg.seed) || 1 };
    if (!Number.isInteger(c.buf) || c.buf < LIMITS.minBuf || c.buf > LIMITS.maxBuf) errors.push('The buffer size must be a whole number from ' + LIMITS.minBuf + ' to ' + LIMITS.maxBuf + '.');
    if (!COPY_BY_ID[c.copy]) errors.push('Unknown copy routine.');
    return { c, errors };
  }

  // run(cfg, bytes): execute vuln(input) byte by byte and return the frames plus the computed result.
  // Each frame is a snapshot of the frame's memory (value per byte or null = not yet written) and a plain-language
  // explanation. The final result says what the function's return actually did.
  function run(cfgIn, bytes) {
    const { c: cfg, errors } = checkConfig(cfgIn);
    if (errors.length) return { ok: false, errors };
    const L = layout(cfg), fn = functionsFor(cfg), can = canaryFor(cfg), frames = [];
    const mem = new Array(L.size).fill(null);
    const retGood = fn.list[0].real;
    // Starting contents: the flag is 0 ("not admin"), the canary and saved FP and return address were written by the caller / prologue.
    mem[L.by.auth.off] = 0; mem[L.by.pad.off] = 0;
    if (cfg.canary) { mem[L.by.canary.off] = can[0]; mem[L.by.canary.off + 1] = can[1]; }
    mem[L.by.fp.off] = 0xF0; mem[L.by.fp.off + 1] = 0x7F;
    addrBytes(retGood).forEach((b, i) => { mem[L.by.ret.off + i] = b; });
    for (let i = 0; i < LIMITS.callerBytes; i++) mem[L.by.caller.off + i] = 0xC0 + i;
    const orig = mem.slice();
    const touched = new Set();
    const snap = (kind, text, extra) => frames.push(Object.assign({ kind, text, mem: mem.slice(), touched: Array.from(touched), written: null, focus: null }, extra || {}));
    const word = (id) => mem[L.by[id].off] | (mem[L.by[id].off + 1] << 8);

    const cp = COPY_BY_ID[cfg.copy];
    snap('start', 'vuln(input) has just been called. Its frame holds a ' + cfg.buf + '-byte buffer, the auth flag (0 = not an administrator)' + (cfg.canary ? ', a stack canary (' + hex2(can[0]) + ' ' + hex2(can[1]) + ', a secret the attacker does not know)' : '') + ', the saved frame pointer and the return address ' + hex(retGood) + ' (back into main). The input is ' + plural(bytes.length, 'byte') + ' long. The copy will start at buf[0] and move UP the addresses.');

    // Which bytes get written, in order? That is the whole difference between the three copy routines.
    const plan = [];            // { off, val, note }
    let rejected = false;
    if (cfg.copy === 'strcpy') {
      // Copies until (and including) the first zero byte, or the end of the input plus a terminator.
      for (let i = 0; i <= bytes.length; i++) { const v = i < bytes.length ? bytes[i] : 0; plan.push({ off: i, val: v, term: v === 0 }); if (v === 0) break; }
    } else if (cfg.copy === 'strncpy') {
      // At most `buf` bytes; after a zero byte the rest of the buffer is padded with zeros (like the C function).
      for (let i = 0; i < cfg.buf; i++) { const v = i < bytes.length ? bytes[i] : 0; plan.push({ off: i, val: v, term: false }); }
      // a zero inside the input ends the copy but the padding is zero, which the loop above already does for short input; a zero in the middle of long input pads too
      const z = bytes.indexOf(0); if (z >= 0 && z < cfg.buf) for (let i = z; i < cfg.buf; i++) plan[i].val = 0;
    } else {
      if (bytes.length + 1 > cfg.buf) rejected = true;
      else for (let i = 0; i <= bytes.length; i++) plan.push({ off: i, val: i < bytes.length ? bytes[i] : 0, term: i === bytes.length });
    }

    let copySegv = false, lastOff = -1;
    if (rejected) {
      snap('reject', 'The check "length + 1 <= ' + cfg.buf + '" fails: the input needs ' + (bytes.length + 1) + ' bytes (with its terminator) but the buffer holds ' + cfg.buf + '. The routine refuses to copy and returns an error. Nothing in the frame changed.');
    } else {
      plan.forEach((w, n) => {
        if (copySegv) return;
        if (w.off >= L.size) { copySegv = true; snap('segv-copy', 'Byte ' + n + ' would be written at address ' + hex(STACK_BASE + w.off) + ', past the top of the stack segment. The hardware raises a segmentation fault in the middle of the copy.', { focus: w.off }); return; }
        const reg = regionAt(L, w.off);
        mem[w.off] = w.val; touched.add(w.off); lastOff = w.off;
        let t = 'Copy byte ' + n + ' (' + hex2(w.val) + (w.val >= 32 && w.val <= 126 ? ' "' + ch(w.val) + '"' : '') + ') to address ' + hex(STACK_BASE + w.off) + ', which is ';
        if (reg.id === 'buf') t += 'buf[' + w.off + '], inside the buffer. That is fine.';
        else t += 'in the ' + reg.label + (reg.id === 'ret' ? ' (byte ' + (w.off - reg.off) + ' of 2). The function will later jump to whatever this holds.' : reg.id === 'caller' ? ': the overflow has run out of this frame and is now trashing the caller.' : reg.id === 'canary' ? ': the secret value is being overwritten.' : reg.id === 'auth' ? ': the neighbouring flag now holds the attacker\'s byte.' : '.');
        if (w.term) t += ' (This is the terminating zero byte, so the copy stops here.)';
        snap('copy', t, { focus: w.off, written: n + 1 });
      });
    }

    // Epilogue.
    const changed = [];
    L.regions.forEach((r) => { for (let i = 0; i < r.len; i++) if (mem[r.off + i] !== orig[r.off + i]) { changed.push(r.id); break; } });
    const bufOverflow = L.regions.filter((r) => r.id !== 'buf' && r.id !== 'pad' && changed.includes(r.id)).map((r) => r.id);
    let result;
    if (copySegv) {
      result = { kind: 'segv-copy', text: 'CRASH during the copy: the write ran past the top of the stack segment (segmentation fault).', jump: null };
    } else if (rejected) {
      result = { kind: 'rejected', text: 'The input was rejected; vuln() returns normally to ' + hex(retGood) + '. No memory was corrupted.', jump: retGood };
    } else {
      // 1) the program body checks the auth flag (a data-only corruption: no code runs that the programmer did not write)
      let authGranted = mem[L.by.auth.off] !== 0;
      snap('auth', 'The body of vuln() now tests the auth flag. It holds ' + hex2(mem[L.by.auth.off]) + (authGranted ? ', which is not zero, so the program grants administrator access. The attacker never touched the code; they only changed a variable next to the buffer.' : ', which is zero, so no administrator access is granted.'), { focus: L.by.auth.off });
      // 2) function epilogue: canary check first
      let canaryOk = true;
      if (cfg.canary) {
        canaryOk = mem[L.by.canary.off] === can[0] && mem[L.by.canary.off + 1] === can[1];
        snap('canary', 'Before returning, the function compares the canary with the secret it was given: now ' + hex2(mem[L.by.canary.off]) + ' ' + hex2(mem[L.by.canary.off + 1]) + ', expected ' + hex2(can[0]) + ' ' + hex2(can[1]) + '. ' + (canaryOk ? 'They match, so nothing crossed it on the way up.' : 'They differ: something wrote through the canary on its way to the saved registers.'), { focus: L.by.canary.off });
      }
      if (!canaryOk) result = { kind: 'canary', text: 'ABORTED: "stack smashing detected". The program stops before the corrupted return address is used.', jump: null, authGranted };
      else {
        const r = word('ret');
        const target = fn.list.find((f) => f.real === r);
        const unshifted = cfg.aslr ? FUNCS.find((f) => f.addr === r) : null;
        let kind, text;
        if (r === retGood) { kind = 'normal'; text = 'vuln() returns normally to ' + hex(r) + ' (back in main).'; }
        else if (target && target.id === 'secret_admin') { kind = 'hijack'; text = 'CONTROL FLOW HIJACKED: the return address was overwritten with ' + hex(r) + ', so vuln() "returns" into secret_admin, a function the program never intended to run for this input.'; }
        else if (target) { kind = 'hijack-valid'; text = 'The return address now holds ' + hex(r) + ', the start of ' + target.name + '. vuln() returns there instead of to main: the attacker chose which existing function runs next (a harmless one here).'; }
        else if (r >= STACK_LO && r <= STACK_HI) { kind = cfg.nx ? 'nx' : 'stack-exec'; text = cfg.nx ? 'BLOCKED by NX: the return address ' + hex(r) + ' points into the stack, which is marked non-executable. The CPU refuses to run data as instructions and raises a fault.' : 'The return address ' + hex(r) + ' points into the stack, and NX is OFF, so the CPU would try to run the input bytes as instructions. (This model stops here: it contains no machine code and does not run anything.)'; }
        else { kind = unshifted ? 'aslr-miss' : 'segv'; text = unshifted ? 'CRASH: ' + hex(r) + ' is where ' + unshifted.name + ' lives in the program file, but ASLR loaded the program ' + hex(fn.shift) + ' higher this run, so nothing valid is at ' + hex(r) + '. A fixed address copied from the program file misses.' : 'CRASH: the return address ' + hex(r) + ' is not the start of any code (segmentation fault).'; }
        snap('return', 'The function returns: it restores the frame pointer and jumps to the address stored in the return-address cell, which now holds ' + hex(r) + '.', { focus: L.by.ret.off });
        result = { kind, text, jump: r, authGranted };
      }
    }
    snap('end', result.text + (result.authGranted ? ' (The auth flag was also corrupted: administrator access was granted along the way.)' : ''), { result });

    const dist = { toAuth: L.toAuth, toCanary: L.toCanary, toRet: L.toRet };
    return { ok: true, errors: [], cfg, layout: L, funcs: fn, canary: can, frames, result, bytesWritten: lastOff + 1, changed, overflowed: bufOverflow, distances: dist, input: bytes };
  }

  // Examples (inputs only). `bytes` are given in hex mode so the intended effect is visible.
  const PRESETS = [
    { id: 'normal', name: 'Normal input', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: false, seed: 1 }, mode: 'text', input: 'HELLO',
      note: 'A short string fits. The copy stops at the terminator and the frame is untouched.' },
    { id: 'offbyone', name: 'One byte too many', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: false, seed: 1 }, mode: 'text', input: 'ABCDEFGH',
      note: 'Eight characters plus the terminating zero need nine bytes: the zero lands in the neighbouring auth flag (harmless here because it writes 0).' },
    { id: 'auth', name: 'Overwrite the neighbouring flag', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: false, seed: 1 }, mode: 'text', input: 'AAAAAAAAB',
      note: 'The ninth byte lands on the auth flag. The program now believes you are an administrator, and no code was changed.' },
    { id: 'hijack', name: 'Overwrite the return address', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: false, seed: 1 }, mode: 'hex', input: '41 41 41 41 41 41 41 41 41 41 41 41 A9 13',
      note: '8 bytes fill the buffer, 1 the flag, 1 the padding, 2 the saved FP; the next two bytes (A9 13 = address 0x13A9, little-endian) overwrite the return address, so vuln() returns into secret_admin.' },
    { id: 'canary', name: 'The canary catches it', cfg: { buf: 8, copy: 'strcpy', canary: true, nx: true, aslr: false, seed: 5 }, mode: 'hex', input: '41 41 41 41 41 41 41 41 41 41 41 41 41 41 A9 13',
      note: 'The same idea, but the canary sits between the buffer and the return address, so the copy has to overwrite it and the check fails before the return.' },
    { id: 'aslr', name: 'ASLR makes a fixed address miss', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: true, seed: 3 }, mode: 'hex', input: '41 41 41 41 41 41 41 41 41 41 41 41 A9 13',
      note: 'Same bytes as the hijack, but the program was loaded at a random offset this run, so 0x13A9 is no longer secret_admin.' },
    { id: 'stack', name: 'Jump into the stack (NX off vs on)', cfg: { buf: 8, copy: 'strcpy', canary: false, nx: false, aslr: false, seed: 1 }, mode: 'hex', input: '41 41 41 41 41 41 41 41 41 41 41 41 40 7F',
      note: 'The return address 0x7F40 is the start of the buffer itself. Switch NX on and the jump is refused: data on the stack cannot run.' },
    { id: 'bounded', name: 'Bounded copy stops the damage', cfg: { buf: 8, copy: 'strncpy', canary: false, nx: true, aslr: false, seed: 1 }, mode: 'hex', input: '41 41 41 41 41 41 41 41 41 41 41 41 A9 13',
      note: 'At most 8 bytes are copied, so the return address cannot be reached however long the input is.' }
  ];

  const api = { LIMITS, FUNCS, COPIES, COPY_BY_ID, PRESETS, STACK_BASE, STACK_LO, STACK_HI, parseInput, layout, run, addrBytes, functionsFor, canaryFor, hex, hex2, ch };
  NS.overflow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
