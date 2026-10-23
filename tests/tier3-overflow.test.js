// Tier 3: buffer overflow & stack smashing (an abstract toy model). Hand-derived distances and outcomes.
const O = require('../js/engines/overflow.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))); };
const base = { buf: 8, copy: 'strcpy', canary: false, nx: true, aslr: false, seed: 1 };
const A = (n) => new Array(n).fill(0x41);
const go = (cfg, bytes) => O.run(Object.assign({}, base, cfg), bytes);
const finalMem = (r) => r.frames[r.frames.length - 1].mem;

// ---- input parsing
eq('text mode: characters become their codes', O.parseInput('Hi!', 'text').bytes, [72, 105, 33]);
eq('hex mode: tokens become bytes (0x prefix allowed)', O.parseInput('41 0xA9 13', 'hex').bytes, [0x41, 0xA9, 0x13]);
eq('hex mode: a bad token is a readable error', O.parseInput('41 ZZ', 'hex').errors.length, 1);
eq('text mode: non-ASCII is rejected', O.parseInput('café', 'text').ok, false);
eq('input is capped at 64 bytes', O.parseInput('x'.repeat(65), 'text').ok, false);
eq('empty input is allowed (a zero-length string)', O.parseInput('', 'text').ok, true);
eq('little-endian: 0x13A9 is stored as A9 13', O.addrBytes(0x13A9), [0xA9, 0x13]);

// ---- layout and distances, hand-derived: buf N, auth 1, padding 1, [canary 2], saved FP 2, then the return address
eq('N=8 no canary: auth at 8, return address at 8+1+1+2 = 12', (() => { const r = go({}, []); return [r.distances.toAuth, r.distances.toCanary, r.distances.toRet]; })(), [8, null, 12]);
eq('N=8 with canary: canary at 10, return address at 14', (() => { const r = go({ canary: true }, []); return [r.distances.toAuth, r.distances.toCanary, r.distances.toRet]; })(), [8, 10, 14]);
[4, 5, 10, 16].forEach((n) => {
  eq('N=' + n + ': distance to the return address = N + 4 (no canary) and N + 6 (canary)', [go({ buf: n }, []).distances.toRet, go({ buf: n, canary: true }, []).distances.toRet], [n + 4, n + 6]);
});
eq('regions are contiguous and ordered low to high', (() => { const L = go({ canary: true }, []).layout; return L.regions.every((r, i) => i === 0 || r.off === L.regions[i - 1].off + L.regions[i - 1].len); })(), true);
eq('buf[0] sits at the stack base and ret address is computed from the layout', (() => { const L = go({}, []).layout; return [L.regions[0].addr, L.by.ret.addr - L.regions[0].addr]; })(), [O.STACK_BASE, 12]);
eq('buffer size is validated', go({ buf: 3 }, []).ok, false);

// ---- unchecked copy
let r = go({}, O.parseInput('HELLO', 'text').bytes);
eq('short string: normal return, frame beyond the buffer untouched', [r.result.kind, r.changed], ['normal', ['buf']]);
eq('strcpy writes the terminating zero after the string', finalMem(r).slice(0, 6), [72, 69, 76, 76, 79, 0]);
eq('strcpy stops at the first zero byte even if more input follows', (() => { const x = go({}, [0x41, 0, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D]); return [x.bytesWritten, x.result.kind]; })(), [2, 'normal']);
r = go({}, A(8));
eq('8 characters need 9 bytes with the terminator: the zero lands in auth (value 0, still harmless)', [r.changed.includes('auth'), r.result.authGranted, r.result.kind], [false, false, 'normal']);
r = go({}, A(8).concat([0x42]));
eq('9 non-zero bytes: the 9th is the auth flag, administrator access granted, return still normal', [finalMem(r)[8], r.result.authGranted, r.result.kind], [0x42, true, 'normal']);
// the return-address overwrite, N=8: 12 filler bytes then the two address bytes
r = go({}, A(12).concat([0xA9, 0x13]));
eq('12 filler bytes + A9 13 hijacks the return into secret_admin', [r.result.kind, r.result.jump], ['hijack', 0x13A9]);
eq('11 filler bytes + A9 13 does NOT hijack (the address bytes are misaligned)', go({}, A(11).concat([0xA9, 0x13])).result.kind !== 'hijack', true);
eq('exactly 12 filler bytes: the terminating zero overwrites the low byte of the return address (0x1142 becomes 0x1100), so the return crashes', (() => { const x = go({}, A(12)); return [x.result.kind]; })(), ['segv']);
eq('input exactly one byte shorter than the distance leaves the return address alone', go({}, A(11)).result.kind, 'normal');
eq('return into another valid function: jumps there (harmless function)', go({}, A(12).concat([0x57, 0x12])).result.kind, 'hijack-valid');
eq('return to garbage is a segmentation fault', go({}, A(12).concat([0x34, 0x12])).result.kind, 'segv');
eq('overflow far enough crashes during the copy (past the top of the stack)', go({}, A(40)).result.kind, 'segv-copy');
eq('the copy writes up to and including the caller frame before that', go({}, A(30)).overflowed.includes('caller'), true);

// ---- canary
eq('canary: the same overflow is caught, never reaches the jump', (() => { const x = go({ canary: true, seed: 5 }, A(14).concat([0xA9, 0x13])); return [x.result.kind, x.result.jump]; })(), ['canary', null]);
eq('canary: input that stops before the canary passes', go({ canary: true }, A(9)).result.kind, 'normal');
eq('canary: a single overwritten canary byte is detected', go({ canary: true }, A(10)).result.kind, 'canary');
eq('canary value comes from the seed and is never 00', [1, 2, 3, 4, 5, 6, 7, 8].every((s) => O.canaryFor({ seed: s }).every((b) => b > 0 && b < 256)), true);
eq('different seeds give different canaries', new Set([1, 2, 3, 4, 5].map((s) => O.canaryFor({ seed: s }).join())).size > 1, true);
eq('writing the real canary value back (a leak) passes the check, then the hijack works', (() => { const can = O.canaryFor({ seed: 5 }); const x = go({ canary: true, seed: 5 }, A(10).concat(can, [0x41, 0x41], [0xA9, 0x13])); return x.result.kind; })(), 'hijack');
// ---- NX
eq('NX on: returning into the stack is blocked', go({ nx: true }, A(12).concat([0x40, 0x7F])).result.kind, 'nx');
eq('NX off: returning into the stack would execute data (model stops)', go({ nx: false }, A(12).concat([0x40, 0x7F])).result.kind, 'stack-exec');
eq('NX does not stop a return to an existing function (return-to-function)', go({ nx: true }, A(12).concat([0xA9, 0x13])).result.kind, 'hijack');
// ---- ASLR
eq('ASLR: the shift is a multiple of 0x100 between 0x100 and 0x700', [1, 2, 3, 4, 5, 6, 7, 8, 9].every((s) => { const sh = O.functionsFor({ aslr: true, seed: s }).shift; return sh % 0x100 === 0 && sh >= 0x100 && sh <= 0x700; }), true);
eq('ASLR off: no shift', O.functionsFor({ aslr: false, seed: 4 }).shift, 0);
eq('ASLR on: a hard-coded address misses for every seed', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((s) => go({ aslr: true, seed: s }, A(12).concat([0xA9, 0x13])).result.kind === 'aslr-miss'), true);
eq('ASLR on: the true shifted address still hijacks', (() => { const s = 3, f = O.functionsFor({ aslr: true, seed: s }); const t = f.list.find((x) => x.id === 'secret_admin').real; return go({ aslr: true, seed: s }, A(12).concat(O.addrBytes(t))).result.kind; })(), 'hijack');
eq('ASLR on: a normal run returns to the shifted main, not 0x1142', (() => { const x = go({ aslr: true, seed: 2 }, A(3)); return [x.result.kind, x.result.jump !== 0x1142]; })(), ['normal', true]);
// ---- bounded and checked copies
eq('strncpy: at most N bytes are written', go({ copy: 'strncpy' }, A(40)).bytesWritten, 8);
eq('strncpy: never touches auth, canary, saved FP or return address (N=8, 64 bytes)', (() => { const x = go({ copy: 'strncpy', canary: true }, A(64)); return [x.changed, x.result.kind, x.result.authGranted]; })(), [['buf'], 'normal', false]);
eq('strncpy pads with zeros after a short string', finalMem(go({ copy: 'strncpy' }, [0x41, 0x42]))[7], 0);
eq('checked copy rejects input that does not fit with its terminator', [go({ copy: 'checked' }, A(8)).result.kind, go({ copy: 'checked' }, A(7)).result.kind], ['rejected', 'normal']);
eq('checked copy leaves the frame untouched when it rejects', go({ copy: 'checked' }, A(30)).changed, []);

// ---- frames
eq('first frame is the untouched frame, last frame carries the result', (() => { const x = go({}, A(3)); return [x.frames[0].kind, x.frames[x.frames.length - 1].kind, !!x.frames[x.frames.length - 1].result]; })(), ['start', 'end', true]);
eq('one frame per copied byte plus start, auth check, return and end', (() => { const x = go({}, A(3)); return x.frames.length; })(), 1 + 4 + 1 + 1 + 1);
eq('frames record what has been written so far (touched bytes grow)', (() => { const x = go({}, A(5)); const t = x.frames.filter((f) => f.kind === 'copy').map((f) => f.touched.length); return t.every((v, i) => i === 0 || v === t[i - 1] + 1); })(), true);

// ---- randomized: no bounded or checked copy ever corrupts anything outside the buffer, for any size/input
function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(77); let safe = 0, total = 0, strcpyHit = 0, strcpyTotal = 0, canaryOk = 0, canaryTotal = 0;
for (let i = 0; i < 400; i++) {
  const n = 4 + Math.floor(R() * 13), len = Math.floor(R() * 65), bytes = Array.from({ length: len }, () => 1 + Math.floor(R() * 255));
  ['strncpy', 'checked'].forEach((copy) => { const x = go({ buf: n, copy, canary: R() < 0.5 }, bytes); total++; if (x.changed.every((c) => c === 'buf') && x.result.kind === 'normal' || x.result.kind === 'rejected') safe++; });
  // unchecked copy: the return address changes exactly when the input is long enough to reach it
  const x = go({ buf: n, copy: 'strcpy' }, bytes), reach = n + 4; strcpyTotal++;
  if ((x.changed.includes('ret')) === (len + 1 > reach)) strcpyHit++;
  // with a canary, any input that reaches the canary is detected and nothing is ever jumped to
  const y = go({ buf: n, copy: 'strcpy', canary: true, seed: 1 + i }, bytes); canaryTotal++;
  const reachC = n + 2; // first byte of the canary
  if (len + 1 > reachC + 0 ? (y.result.kind === 'canary' || y.result.kind === 'segv-copy') : true) canaryOk++;
}
eq('random: bounded and checked copies never change anything outside buf', safe, total);
eq('random: strcpy changes the return address exactly when input length + terminator exceeds N+4', strcpyHit, strcpyTotal);
eq('random: with a canary, any input long enough to reach it is stopped (canary or crash), never jumped', canaryOk, canaryTotal);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
