const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
// Akmodan II (RBO7, Death Wing's Lair) attack tuning on top of the ASS 2.0 Akmodan rework.
// EntityAkmodanII is 0x801940B4-0x801957C0 (decomp src/boss/rbo7/e_akmodan_ii.c). ASS 2.0 calls its attack controller
// (0x801A2CEC, appended after the vanilla file end) at the top of every update; the controller spawns aimed shots and the
// step-9 barrage through 0x801A2F44 (CreateEntityFromEntity(E_UNK_1C) with params 1, 6 px/frame along an angle).
const BASE = 0x80180000;
const RANDOM = 0x80195ED4, ALLOC = 0x80199B5C, CREATE = 0x801985C0, SHOT = 0x801A2F44;
const AIMED_SHOTS = 6, AIMED_GAP = 120, BARRAGE_EVERY = 3;   // 6 aimed shots 2 s apart; barrage shot every 3 frames
const FLAME_TILES = 4, TILE = 16;                            // 4 flames ahead and 4 behind, one per 16 px tile
// Arm-stretch hitbox entity (EntityAkmodanaAttackHitbox, enemy 0x10C) rows 1-5: [offX, offY, halfWidth, halfHeight].
// HitDetection drops any hitbox whose centre is at screen x <= -32 or >= 288, so the centre stays 32 px ahead and the
// half-width grows; the last row (arm fully out) spans 223 px behind to 287 px ahead: the whole screen from any position.
const ARM = [[-32, -4, 32, 4], [-32, -4, 80, 4], [-32, -4, 128, 4], [-32, -4, 176, 4], [-32, -4, 255, 4]];
const ARM_TABLE = 0x80180750;
// Code sites.
const PHASE_LIMIT = 0x801A2E00;  // ori t1, zero, 4 -> phase that starts the barrage (shots are phases 1..limit-1)
const SHOT_GAP = 0x801A2EA4;     // ori t1, zero, 0xF0 -> cooldown after an aimed shot
const BARRAGE = 0x801A2EB8, BARRAGE_END = 0x801A2EDC; // barrage cadence check + Random + shot
const STEP3_SKIP = 0x80194440;   // ASS 2.0 "j 0x80195714" that skips the whole vanilla step-3 tail
const HIT_CHECK = 0x801944B0;    // vanilla: if (hitFlags & 3) SetStep(6) (pain burst)
const GRAB_CHECK = 0x801944CC;   // vanilla grab-distance check (dead in ASS 2.0; stays dead)
const TRAMP = 0x801944D8;        // dead vanilla step-3 tail, reused for the barrage call
const FLAMES = 0x80194394, FLAMES_END = 0x8019441C; // vanilla flame-trail spawn in step 3
const EPILOGUE = 0x80195714;
const AI = [0x801940B4, 0x801957C0], CONTROLLER = [0x801A2CEC, 0x801A2FE4], TABLES = [0x8018074C, 0x8018076C];
// SHA-256 of the inspected ASS 2.0 bytes (AI function, appended controller, arm hitbox tables).
const SIGNATURES = {
  ai: '1D14E75C9BF41E08EAD493E40170FE878ED0B466ED87717EABB6FFF8D69827FD',
  controller: 'AD49ED7B90CA7C6F036ADBEE8A5BAA7B0F8DDA83E1A829392C4A1B5E39EC023A',
  tables: '7E224A9595456717BD285BA0305CA32F6B7DC91A9298C1913037793829E99893'
};
const RBO7 = {name: 'RBO7', path: ['BOSS', 'RBO7', 'RBO7.BIN']};
const r = {zero: 0, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, t0: 8, t1: 9, s0: 16, s1: 17, s2: 18};
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, sa, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | fn) >>> 0;
const lui = (t, v) => I(15, 0, t, v), lhu = (t, o, b) => I(37, b, t, o), sh = (t, o, b) => I(41, b, t, o);
const addiu = (t, s, v) => I(9, s, t, v), ori = (t, s, v) => I(13, s, t, v), andi = (t, s, v) => I(12, s, t, v), slti = (t, s, v) => I(10, s, t, v);
const sll = (d, t, sa) => R(0, t, d, sa, 0), addu = (d, s, t) => R(s, t, d, 0, 0x21), move = (d, s) => addu(d, s, r.zero);
const divu = (s, t) => R(s, t, 0, 0, 0x1B), mfhi = d => R(0, 0, d, 0, 0x10);
const jal = a => (0x0C000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0, j = a => (0x08000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0;
const branch = (op, s, t, pc, target) => I(op, s, t, (target - pc - 4) >> 2);
const beqz = (s, pc, t) => branch(4, s, r.zero, pc, t), bnez = (s, pc, t) => branch(5, s, r.zero, pc, t);
const words = list => Buffer.from(Uint32Array.from(list).buffer);
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const span = ([a, b]) => [a - BASE, b - BASE];

// Barrage: fire when timer % 3 == 0 (timer 180..1, so 60 shots); the shot call moves to TRAMP for space.
function barrageWords() {
  const pc = n => BARRAGE + n * 4;
  return [lhu(r.t0, 0x8C, r.s0), ori(r.t1, r.zero, BARRAGE_EVERY), divu(r.t0, r.t1), mfhi(r.t1),
    bnez(r.t1, pc(4), BARRAGE_END), 0, jal(RANDOM), 0, j(TRAMP)]; // delay slot: BARRAGE_END's lhu t0 reload (harmless)
}
const trampWords = () => [jal(SHOT), sll(r.a0, r.v0, 4), j(BARRAGE_END), 0];
// Flame trail: on the vanilla 1-in-16 roll, spawn one flame per tile at -64..-16 and +16..+64 px (4 behind, 4 ahead).
function flameWords() {
  const pc = n => FLAMES + n * 4, LOOP = pc(5), NEXT = pc(26);
  const code = [
    jal(RANDOM), 0, andi(r.v0, r.v0, 0xF), bnez(r.v0, pc(3), FLAMES_END), addiu(r.s1, r.zero, -FLAME_TILES),
    beqz(r.s1, pc(5), NEXT), lui(r.a0, 0x8008), addiu(r.a0, r.a0, -0x56A8), jal(ALLOC), addiu(r.a1, r.a0, 0x1780),
    beqz(r.v0, pc(10), NEXT), move(r.s0, r.v0), ori(r.a0, r.zero, 0x1D), move(r.a1, r.s2), jal(CREATE), move(r.a2, r.s0),
    lhu(r.v0, 6, r.s0), lhu(r.v1, 0x24, r.s2), addiu(r.v0, r.v0, 0x20), sh(r.v0, 6, r.s0), addiu(r.v1, r.v1, 1), sh(r.v1, 0x24, r.s0),
    lhu(r.v0, 2, r.s0), sll(r.v1, r.s1, Math.log2(TILE)), addu(r.v0, r.v0, r.v1), sh(r.v0, 2, r.s0),
    slti(r.v0, r.s1, FLAME_TILES), bnez(r.v0, pc(27), LOOP), addiu(r.s1, r.s1, 1)];
  while (code.length < (FLAMES_END - FLAMES) / 4) code.push(0);
  return code;
}
const armBytes = () => Buffer.from(ARM.flat().map(v => v & 0xFF));
// Each edit: address, the exact ASS 2.0 bytes it replaces, and the new bytes.
function edits(file) {
  const cur = (a, n) => Buffer.from(file.subarray(a - BASE, a - BASE + n));
  const list = [
    {name: 'aimed shot count', at: PHASE_LIMIT, original: words([ori(r.t1, r.zero, 4)]), expect: words([ori(r.t1, r.zero, AIMED_SHOTS + 1)])},
    {name: 'aimed shot gap', at: SHOT_GAP, original: words([ori(r.t1, r.zero, 0xF0)]), expect: words([ori(r.t1, r.zero, AIMED_GAP)])},
    {name: 'barrage cadence', at: BARRAGE, original: words([lhu(r.t0, 0x8C, r.s0), 0, andi(r.t1, r.t0, 3), bnez(r.t1, BARRAGE + 12, BARRAGE_END), 0,
      jal(RANDOM), 0, jal(SHOT), sll(r.a0, r.v0, 4)]), expect: words(barrageWords())},
    {name: 'step-3 tail -> pain check', at: STEP3_SKIP, original: words([j(EPILOGUE)]), expect: words([j(HIT_CHECK)])},
    {name: 'skip grab-distance check', at: GRAB_CHECK, original: words([jal(0x801995EC)]), expect: words([j(EPILOGUE)])},
    {name: 'barrage shot call', at: TRAMP, original: cur(TRAMP, 16), expect: words(trampWords())},
    {name: 'flame trail x8', at: FLAMES, original: cur(FLAMES, FLAMES_END - FLAMES), expect: words(flameWords())},
    {name: 'arm hitbox rows 1-5', at: ARM_TABLE, original: Buffer.from('D4FC1C04D8FC2004D8FC2804D0FC2804C8FC3004', 'hex'), expect: armBytes()}];
  return list.map(e => ({...e, off: e.at - BASE}));
}
function check(file) {
  assert.equal(K.u32(file, 0x80180438 - BASE + 8) & 0xFFFF, 0x10B, 'Akmodan II EInit changed.');
  assert.equal(K.u32(file, 0x80180444 - BASE + 8) & 0xFFFF, 0x10C, 'Arm hitbox EInit changed.');
  assert.equal(K.u32(file, 0x80180450 - BASE + 8) & 0xFFFF, 0x10D, 'Projectile EInit changed.');
  assert.equal(flameWords().length * 4, FLAMES_END - FLAMES);
  assert.equal(barrageWords().length * 4, BARRAGE_END - BARRAGE);
}
const installed = file => { check(file); return edits(file).every(e => file.subarray(e.off, e.off + e.expect.length).equals(e.expect)); };
function verify(file) { assert.ok(installed(file), 'RBO7: Akmodan II attack tuning not installed.'); }
function overlay(file) {
  check(file);
  assert.equal(sha(file.subarray(...span(AI))), SIGNATURES.ai, 'RBO7: unknown Akmodan II AI code.');
  assert.equal(sha(file.subarray(...span(CONTROLLER))), SIGNATURES.controller, 'RBO7: unknown ASS 2.0 attack controller.');
  assert.equal(sha(file.subarray(...span(TABLES))), SIGNATURES.tables, 'RBO7: unknown arm hitbox tables.');
  const out = Buffer.from(file);
  for (const e of edits(file)) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, `RBO7: ${e.name} site changed.`);
    out.set(e.expect, e.off);
  }
  verify(out); return out;
}
module.exports = {BASE, RANDOM, ALLOC, CREATE, SHOT, AIMED_SHOTS, AIMED_GAP, BARRAGE_EVERY, FLAME_TILES, TILE, ARM, ARM_TABLE, PHASE_LIMIT,
  SHOT_GAP, BARRAGE, BARRAGE_END, STEP3_SKIP, HIT_CHECK, GRAB_CHECK, TRAMP, FLAMES, FLAMES_END, EPILOGUE, AI, CONTROLLER, TABLES, SIGNATURES,
  RBO7, OVERLAYS: [RBO7], barrageWords, trampWords, flameWords, armBytes, edits, check, installed, verify, overlay, span, sha};
