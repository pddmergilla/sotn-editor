const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
const BUILD = require('./richter-stopwatch-crash/code.json');
// BO6.BIN (Richter) loads at 0x80180000. Needs the Epic Richter AI clock finisher.
const PATH = ['BOSS', 'BO6', 'BO6.BIN'], BASE = 0x80180000;
// Thrown Agunea (0x2C), its enemy hit (0x2D), Vibhuti crash cloud (0x2F) and Vibhuti crash (0x2E): boss Richter never throws
// Agunea or crashes Vibhuti, so their contiguous code holds the new Stopwatch crash.
const CAVE = 0x801C7408, CAVE_END = 0x801C8590;
const ENTITIES = 0x8018158C, SLOT = id => ENTITIES + id * 4, BLUEPRINTS = 0x801816A0, BLUEPRINT = id => BLUEPRINTS + id * 6;
const DESTROY = 0x801ACF6C, CLOCK = 0x801CF77C, FOUR_CLOCK = 0x801CF0A0, FOUR_CLOCK_END = 0x801CF278, CRASH_CLOCK = 0x801CFDAC;
const CHAIN = 0x801CF3B4, LAST = 0x801CF3C0;
const CODE = Buffer.from(BUILD.hex, 'hex'), ENTRY = Object.fromEntries(Object.entries(BUILD.entries).map(([k, v]) => [k, Number(v)]));
const DEAD = {0x2C: 0x801C7408, 0x2D: 0x801C7938, 0x2E: 0x801C818C, 0x2F: 0x801C7FEC};
// Sparkle blueprint: the Vibhuti crash blueprint without its 18-frame delay, spawning into free slots 0x60-0x7F (kind 1).
// Kinds 4 and 5 are fixed slots in BO6; kind 5 is the Shaft orb's slot.
const SPARKLE_BP = 0x36, SPARKLE_OLD = '2e01c1000012', SPARKLE_NEW = '2e0141000100';
// Finisher code the new clocks call into (Think, Clear, Rain, Clock, Knife, Speed).
const REGIONS = [[0x4E7C8, 0x4F0A0], [0x4F400, 0x4FE90]];
const SIGNATURE = 'F3B611999EBC98D5B87275B0423DC5E2116E9DA13F2029D1A6BD2D913AB26144';
const CAVE_SIGNATURE = '67C50173F848FFDA597A4D94D1B43BAA5D4FCFC4C5BAF4B9869296BBB55AA2D2';
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
// The finisher's Up-stance length (sltiu at BO6 0x4ED58) is tunable, so its immediate is not part of the signature.
const STANCE = 0x4ED58;
const signature = file => { const copy = Buffer.from(file); copy.writeUInt16LE(0, STANCE); return sha(Buffer.concat(REGIONS.map(([s, e]) => copy.subarray(s, e)))); };
const words = list => Buffer.from(Uint32Array.from(list).buffer);
function edits(file) {
  const cave = Buffer.alloc(CAVE_END - CAVE); CODE.copy(cave);
  return [
    {name: 'code', off: CAVE - BASE, original: Buffer.from(file.subarray(CAVE - BASE, CAVE_END - BASE)), expect: cave},
    {name: 'dead entity slots', off: SLOT(0x2C) - BASE, original: words([DEAD[0x2C], DEAD[0x2D], DEAD[0x2E], DEAD[0x2F]]),
      expect: words([DESTROY, DESTROY, ENTRY.StopwatchSparkle, DESTROY])},
    {name: 'stopwatch slot', off: SLOT(0x37) - BASE, original: words([FOUR_CLOCK]), expect: words([ENTRY.Stopwatch])},
    {name: 'crash stopwatch slot', off: SLOT(0x39) - BASE, original: words([CRASH_CLOCK]), expect: words([ENTRY.CrashStopwatch])},
    {name: 'sparkle blueprint', off: BLUEPRINT(SPARKLE_BP) - BASE, original: Buffer.from(SPARKLE_OLD, 'hex'), expect: Buffer.from(SPARKLE_NEW, 'hex')},
    {name: 'old four-clock visual', off: FOUR_CLOCK - BASE, original: Buffer.from(file.subarray(FOUR_CLOCK - BASE, FOUR_CLOCK_END - BASE)),
      expect: Buffer.alloc(FOUR_CLOCK_END - FOUR_CLOCK)}];
}
function check(file, installed = false) {
  assert.equal(signature(file), SIGNATURE, 'Unknown Epic Richter AI finisher code in BO6.BIN.');
  assert.equal(K.u32(file, 0x35A2C), 0x08073A00, 'RichterThinking does not enter the Epic Richter AI finisher.');
  if (!installed) {
    assert.equal(sha(file.subarray(CAVE - BASE, CAVE_END - BASE)), CAVE_SIGNATURE, 'The Agunea and Vibhuti code is not vanilla.');
    assert.equal(sha(file.subarray(FOUR_CLOCK - BASE, FOUR_CLOCK_END - BASE)), FOUR_CLOCK_SIGNATURE, 'Unknown four-clock visual code.');
  }
}
const FOUR_CLOCK_SIGNATURE = '47611C4CDA4F7CC44C8ABEB9A6EA77052F58BC5299A48EC84716E5524A9DAA40';
function verify(file) {
  if (K.u32(file, BIBLE_CALL - BASE) === bibleJump()) return verifyBibleFix(file);
  check(file, true);
  for (const e of edits(file)) assert.deepEqual(file.subarray(e.off, e.off + e.expect.length), e.expect, `Richter Stopwatch crash ${e.name} changed.`);
}
// Clear old Bibles before the finisher.
const BIBLE_CALL = 0x801CEBE0, BIBLE_HELPER = FOUR_CLOCK;
const bibleJump = () => (0x0C000000 | (BIBLE_HELPER >>> 2 & 0x3FFFFFF)) >>> 0;
function bibleProgram() {
  const out = [], labels = {}, branches = [];
  const i = (op, s, t, n) => ((op << 26) | (s << 21) | (t << 16) | (n & 65535)) >>> 0;
  const emit = (...ws) => out.push(...ws);
  const branch = (op, s, t, label) => { branches.push([out.length, label]); emit(i(op, s, t, 0), 0); };
  emit(i(9, 29, 29, -32), i(43, 29, 31, 24), i(43, 29, 16, 20), i(43, 29, 17, 16));
  emit(i(15, 0, 16, 0x8007), i(13, 16, 16, 0x65C8));
  const end = 0x800733D8 + 0x90 * 188;
  emit(i(15, 0, 17, end >>> 16), i(13, 17, 17, end));
  labels.loop = out.length;
  emit(i(37, 16, 8, 0x26), 0, i(9, 8, 9, -0x33), i(11, 9, 9, 4));
  branch(5, 9, 0, 'destroy');
  emit(i(9, 0, 9, 1)); branch(5, 8, 9, 'next');
  emit(i(37, 16, 8, 0x30), 0, i(9, 8, 8, -0x3B), i(11, 8, 8, 4));
  branch(4, 8, 0, 'next');
  labels.destroy = out.length;
  emit((0x0C000000 | (DESTROY >>> 2 & 0x3FFFFFF)) >>> 0, i(9, 16, 4, 0));
  labels.next = out.length;
  emit(i(9, 16, 16, 188)); branch(5, 16, 17, 'loop');
  emit(i(35, 29, 17, 16), i(35, 29, 16, 20), i(35, 29, 31, 24), i(9, 29, 29, 32));
  emit((0x08000000 | (0x801BA598 >>> 2 & 0x3FFFFFF)) >>> 0, 0);
  for (const [n, label] of branches) out[n] = (out[n] | ((labels[label] - n - 1) & 65535)) >>> 0;
  assert.ok(out.length * 4 <= FOUR_CLOCK_END - FOUR_CLOCK);
  return words(out);
}
function bibleEdits() {
  const code = Buffer.alloc(FOUR_CLOCK_END - FOUR_CLOCK); bibleProgram().copy(code);
  return [{name: 'Bible cleanup call', off: BIBLE_CALL - BASE, original: words([0x0320F809]), expect: words([bibleJump()])},
    {name: 'Bible cleanup helper', off: BIBLE_HELPER - BASE, original: Buffer.alloc(code.length), expect: code}];
}
function verifyBibleFix(file) {
  const original = Buffer.from(file);
  for (const e of bibleEdits()) {
    assert.deepEqual(file.subarray(e.off, e.off + e.expect.length), e.expect, `Richter ${e.name} changed.`);
    original.set(e.original, e.off);
  }
  verify(original);
}
function overlayBibleFix(file) {
  verify(file);
  const out = Buffer.from(file);
  for (const e of bibleEdits()) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, `Richter ${e.name} changed.`);
    out.set(e.expect, e.off);
  }
  verifyBibleFix(out); return out;
}
function overlay(file) {
  check(file);
  const out = Buffer.from(file);
  for (const e of edits(file)) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, `Richter ${e.name} changed.`);
    out.set(e.expect, e.off);
  }
  verify(out); return out;
}
module.exports = {PATH, BASE, CAVE, CAVE_END, ENTITIES, SLOT, BLUEPRINTS, BLUEPRINT, DESTROY, CLOCK, FOUR_CLOCK, FOUR_CLOCK_END,
  CRASH_CLOCK, CHAIN, LAST, CODE, ENTRY, DEAD, SPARKLE_BP, SPARKLE_OLD, SPARKLE_NEW, REGIONS, SIGNATURE, CAVE_SIGNATURE,
  FOUR_CLOCK_SIGNATURE, BUILD, signature, edits, check, verify, overlay,
  BIBLE_CALL, BIBLE_HELPER, bibleProgram, bibleEdits, verifyBibleFix, overlayBibleFix};
