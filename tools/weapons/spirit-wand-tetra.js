const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');
const BASE = M.DRA_BASE, CAVE = 0x2EDA4, LIMIT = 0x2F324, HOOK = 0x718A8;
const ORIGINAL = 0x80111018, CAST = 0x800FDC94, PERFORM = 0x8010FCB8, LEARN = 0x800FDCE0;
const WAND = 96, SPELL = 3, QCF = 0x80138FC4, FACING = 0x80137FC0;
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;

// Runs in CheckSpecialMoveInputs' Tetra Spirit slot, after the native QCF tracker. While the
// Spirit Wand is equipped, holding down keeps QCF stage 1 alive, so down then forward + that
// hand's attack casts native Tetra Spirit. The full down, down-forward, forward motion also works.
function helper() {
  const words = [], labels = new Map(), branches = [];
  const emit = (...values) => words.push(...values);
  const label = name => labels.set(name, words.length);
  const branch = (op, rs, rt, name, slot = 0) => { branches.push([words.length, name]); emit(i(op, rs, rt, 0), slot); };
  emit(i(15, 0, 11, 0x8009), i(35, 11, 12, 0x7C00), i(35, 11, 13, 0x7C04), i(13, 0, 14, WAND));
  branch(4, 12, 14, 'equipped'); branch(5, 13, 14, 'fallback');
  label('equipped');
  emit(i(15, 0, 8, 0x8007), i(35, 8, 9, 0x2EE8), i(15, 0, 11, 0x8014), i(33, 11, 12, QCF & 0xFFFF),
    i(12, 9, 9, 0xF000), i(13, 0, 13, 1));
  branch(5, 12, 13, 'tap', i(13, 0, 13, 0x4000));
  branch(5, 9, 13, 'tap', i(13, 0, 13, 20));
  emit(i(41, 11, 13, (QCF + 2) & 0xFFFF));
  label('tap');
  emit(i(35, 8, 10, 0x2EEC), i(15, 0, 11, 0x8009), i(12, 10, 13, 0x80));
  branch(4, 13, 0, 'otherHand');
  emit(i(35, 11, 12, 0x7C00), 0); branch(4, 12, 14, 'eligible');
  label('otherHand');
  emit(i(12, 10, 13, 0x20)); branch(4, 13, 0, 'fallback');
  emit(i(35, 11, 12, 0x7C04), 0); branch(5, 12, 14, 'fallback');
  label('eligible');
  emit(i(37, 8, 13, 0x2F66), 0, i(12, 13, 13, 0x8000)); branch(5, 13, 0, 'fallback');
  emit(i(37, 8, 13, 0x3404), 0, i(11, 13, 13, 3)); branch(4, 13, 0, 'fallback');
  emit(i(15, 0, 11, 0x8014), i(33, 11, 12, QCF & 0xFFFF), i(13, 0, 13, 0xFF), 0);
  branch(4, 12, 13, 'cast', i(9, 12, 12, -1));
  emit(i(11, 12, 12, 2)); branch(4, 12, 0, 'fallback');
  emit(i(15, 0, 15, 0x8013), i(33, 15, 15, FACING & 0xFFFF), i(13, 0, 13, 0x2000), 0);
  branch(4, 15, 0, 'forward');
  emit(i(13, 0, 13, 0x8000));
  label('forward'); branch(5, 9, 13, 'fallback');
  label('cast');
  emit(i(9, 29, 29, -24), i(43, 29, 31, 16), jump(CAST, true), i(13, 0, 4, SPELL));
  branch(4, 2, 0, 'failed');
  emit(jump(PERFORM, true), 0, i(15, 0, 8, 0x8014), i(41, 8, 0, QCF & 0xFFFF),
    jump(LEARN, true), i(13, 0, 4, SPELL),
    i(35, 29, 31, 16), i(9, 29, 29, 24), 0x03E00008, i(13, 0, 2, 1));
  label('failed'); emit(i(35, 29, 31, 16), i(9, 29, 29, 24));
  label('fallback'); emit(jump(ORIGINAL), 0);
  for (const [at, name] of branches) words[at] = K.withImmediate(words[at], labels.get(name) - at - 1);
  const bytes = Buffer.alloc(words.length * 4); words.forEach((w, n) => bytes.writeUInt32LE(w >>> 0, n * 4));
  assert.ok(CAVE + bytes.length <= LIMIT); return bytes;
}

// Native routines the helper reads or calls (QCF tracker, Tetra Spirit input, PerformTetraSpirit,
// CastSpell/LearnSpell); each hash matches vanilla US and ASS 2.0.
const NATIVE = [
  [0x706A4, 0x7081C, 'e5f865d44107f1308e757018f4a32a67eac8513b96097bd611fedb67dddbcaeb'],
  [0x71018, 0x712AC, 'a7279d4c9a7462b9518c540ad755bec51e570af9ddc1de5e047d6c60fb7cdc15'],
  [0x6FCB8, 0x6FD24, '55d190d099939eb05222d62915492ba64ce0571696a5558394b6df1ab233720b'],
  [0x5DC94, 0x5DD40, '3ba38567b7380f722dace8e8e4af33cc1635945fe9d6ad3492a4a1527a6779f7']
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function prepare(dra) {
  assert.equal(K.u32(dra, HOOK), jump(ORIGINAL, true), 'Unknown Tetra Spirit dispatch.');
  assert.equal(K.u32(dra, HOOK + 4), 0);
  for (const [start, end, hash] of NATIVE) assert.equal(sha(dra.subarray(start, end)), hash, `Unknown native code at 0x${start.toString(16)}.`);
  const code = helper(); assert.ok(dra.subarray(CAVE, CAVE + code.length).every(v => v === 0), 'Occupied helper space.');
  const model = M.parse({DRA: {bytes: dra, base: BASE}});
  const wand = model.sections.hand[WAND];
  assert.equal(String(model.get(wand.name)).trim(), 'Spirit Wand');
  assert.equal(model.sections.spells[SPELL].name, 'Tetra Spirit');
  const items = [...model.sections.equipRows, ...Object.values(model.sections.body).flat()];
  const first = Math.floor((CAVE - 0x25324) / 128);
  assert.ok(items.every(row => model.get(row.icon) < first), 'Helper space overlaps an equipped icon.');
  const after = dra.slice(); after.set(code, CAVE); K.put32(after, HOOK, jump(BASE + CAVE, true));
  return after;
}
module.exports = {prepare, helper, BASE, CAVE, LIMIT, HOOK, ORIGINAL, CAST, PERFORM, LEARN, WAND, SPELL, QCF, FACING, jump};
