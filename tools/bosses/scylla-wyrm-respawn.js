const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
// BO3.BIN (Scylla) loads at 0x80180000. Scylla = entity 0x31 (0x801A2AEC), wyrm controller = entity 0x3A (0x801A5338).
const PATH = ['BOSS', 'BO3', 'BO3.BIN'], BASE = 0x80180000;
const SCYLLA = 0x11F, WYRM_ENTITY = 0x3A, FLAGS = 0x80180D48, DONE = 0x80;
const HOOK = 0x801A2DA8, RESUME = 0x801A2DC4, CAVE = 0x801A358C, CAVE_END = 0x801A363C;
const CREATE_ENTITY_FROM_ENTITY = 0x801A8DF0, ENEMY_DEFS = 0x8003C808, SCROLL_X = 0x8007308E, SCROLL_Y = 0x80073092;
const FIRST_WYRM = 0x178, WYRM_STRIDE = 0x98C; // Scylla + 2, + 15, + 28 entity slots (13 slots per wyrm)
// Vanilla Scylla and wyrm code, unchanged in ASS 2.0: Scylla, wyrm helpers and wyrm parts (0x801A2AEC-0x801A5F0C).
const REGION = [0x22AEC, 0x25F0C], SIGNATURE = 'F9DF2C2BED7F70340FE6DBFD72FE359109023D85A26870669B2E4895A8832F78';
const r = {zero:0, at:1, v0:2, v1:3, a0:4, a1:5, a2:6, s0:16, s1:17, s2:18, s3:19};
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, sa, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | fn) >>> 0;
const lui = (t, v) => I(15, 0, t, v), lw = (t, o, b) => I(35, b, t, o), lh = (t, o, b) => I(33, b, t, o);
const lhu = (t, o, b) => I(37, b, t, o), sw = (t, o, b) => I(43, b, t, o), sh = (t, o, b) => I(41, b, t, o);
const addiu = (t, s, v) => I(9, s, t, v), ori = (t, s, v) => I(13, s, t, v), andi = (t, s, v) => I(12, s, t, v);
const xori = (t, s, v) => I(14, s, t, v), slti = (t, s, v) => I(10, s, t, v);
const sll = (d, t, sa) => R(0, t, d, sa, 0), subu = (d, s, t) => R(s, t, d, 0, 0x23), slt = (d, s, t) => R(s, t, d, 0, 0x2A);
const move = (d, s) => R(s, 0, d, 0, 0x21), jal = a => (0x0C000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0, j = a => (0x08000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0;
const branch = (op, s, t, pc, target) => I(op, s, t, (target - pc - 4) >> 2);
const hi = a => (a + 0x8000) >>> 16, lo = a => a & 0xFFFF;
// Scylla's idle step: "if (hitFlags & 3) SetStep(HURT)" becomes the once-only respawn check.
function hookWords() {
  const pc = n => HOOK + n * 4;
  return [lui(r.v0, hi(FLAGS)), lw(r.v0, lo(FLAGS), r.v0), lui(r.a1, hi(ENEMY_DEFS)), lh(r.v1, 0x3E, r.s3),
    andi(r.v0, r.v0, DONE), branch(4, r.v0, r.zero, pc(5), CAVE), lw(r.a1, lo(ENEMY_DEFS), r.a1)];
}
// Unused debug step 0xFF of Scylla. Below half HP: wait while any wyrm is mid-death, then recreate every
// free wyrm; the flag is set only when one is actually recreated, so it stays armed while all three live.
function caveWords() {
  const pc = n => CAVE + n * 4, P1 = pc(6), P2 = pc(15), P2N = pc(36);
  return [
    addiu(r.s0, r.s3, FIRST_WYRM), lh(r.a1, SCYLLA * 0x28 + 4, r.a1), sll(r.v1, r.v1, 1), slt(r.v0, r.v1, r.a1),
    branch(4, r.v0, r.zero, pc(4), RESUME), ori(r.s1, r.zero, 3),
    lhu(r.v0, 0x2C, r.s0), addiu(r.s1, r.s1, -1), xori(r.v0, r.v0, 3), branch(4, r.v0, r.zero, pc(9), RESUME),
    addiu(r.s0, r.s0, WYRM_STRIDE), branch(5, r.s1, r.zero, pc(11), P1), lhu(r.s2, 0x24, r.s3),
    addiu(r.s0, r.s3, FIRST_WYRM), ori(r.s1, r.zero, 1),
    lhu(r.v0, 0x26, r.s0), ori(r.a0, r.zero, WYRM_ENTITY), branch(5, r.v0, r.zero, pc(17), P2N), move(r.a1, r.s3),
    jal(CREATE_ENTITY_FROM_ENTITY), move(r.a2, r.s0), lui(r.v0, hi(SCROLL_X)), lhu(r.v1, lo(SCROLL_X), r.v0),
    lhu(r.v0, lo(SCROLL_Y), r.v0), ori(r.a0, r.zero, 0x48), subu(r.a0, r.a0, r.v1), sh(r.a0, 2, r.s0),
    ori(r.a0, r.zero, 0x90), subu(r.a0, r.a0, r.v0), sh(r.a0, 6, r.s0),
    lui(r.at, hi(FLAGS)), lw(r.a1, lo(FLAGS), r.at), sh(r.s1, 0x30, r.s0), ori(r.a1, r.a1, DONE), sw(r.a1, lo(FLAGS), r.at),
    sh(r.s2, 0x24, r.s0),
    addiu(r.s1, r.s1, 1), addiu(r.s2, r.s2, -2), slti(r.v0, r.s1, 4), branch(5, r.v0, r.zero, pc(39), P2),
    addiu(r.s0, r.s0, WYRM_STRIDE), j(RESUME), 0];
}
const words = list => Buffer.from(Uint32Array.from(list).buffer);
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const HOOK_ORIGINAL = [0x92620048, 0, 0x30420003, 0x10400003, 0, 0x0C06A9D7, 0x34040005];
function edits(file) {
  const cave = file.subarray(CAVE - BASE, CAVE_END - BASE);
  return [{off: HOOK - BASE, original: words(HOOK_ORIGINAL), expect: words(hookWords())},
    {off: CAVE - BASE, original: Buffer.from(cave), expect: Buffer.concat([words(caveWords()), cave.subarray(caveWords().length * 4)])}];
}
function check(file) {
  assert.equal(K.u32(file, 0x5A0 + 8) & 0xFFFF, SCYLLA, 'g_EInitScylla enemy changed.');
  assert.equal(K.u32(file, 0x600 + 8) & 0xFFFF, 0x126, 'g_EInitScyllawyrm enemy changed.');
  assert.ok(caveWords().length * 4 <= CAVE_END - CAVE, 'Respawn code does not fit the debug step.');
}
function verify(file) {
  check(file);
  for (const e of edits(file)) assert.deepEqual(file.subarray(e.off, e.off + e.expect.length), e.expect, 'Scylla wyrm respawn changed.');
}
function overlay(file, signature = SIGNATURE) {
  check(file);
  assert.equal(sha(file.subarray(...REGION)), signature, 'Unknown Scylla code in BO3.BIN.');
  const out = Buffer.from(file);
  for (const e of edits(file)) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, 'Scylla hook or cave space changed.');
    out.set(e.expect, e.off);
  }
  verify(out); return out;
}
module.exports = {PATH, BASE, SCYLLA, WYRM_ENTITY, FLAGS, DONE, HOOK, RESUME, CAVE, CAVE_END, CREATE_ENTITY_FROM_ENTITY,
  ENEMY_DEFS, SCROLL_X, SCROLL_Y, FIRST_WYRM, WYRM_STRIDE, REGION, SIGNATURE, HOOK_ORIGINAL, hookWords, caveWords, edits, verify, overlay};
