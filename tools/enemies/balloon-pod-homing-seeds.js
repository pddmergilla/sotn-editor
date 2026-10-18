const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
// Balloon Pod (enemy 0x11D) seeds (EntityImpDeathParticle, enemy 0x11E) in RDAI (Anti-Chapel) and RNO4 (Reverse Caverns).
// Both overlays load at 0x80180000 and hold the same vanilla code; only relocations differ (RNO4 = RDAI + 0x17BF8).
const BASE = 0x80180000, PLAYER = 0x800733D8, RCOS = 0x80016D68, RSIN = 0x80016C9C;
const HOMING_FRAMES = 180, TURN = 0x20, SPEED = 12; // 3 s; 2.8 degrees per frame; 0.75 px per frame
const RDAI = {
  name: 'RDAI', path: ['ST', 'RDAI', 'RDAI.BIN'], podInit: 0x80180908, seedInit: 0x80180914, seedEntity: 0x34,
  getAngle: 0x801B85A4, delta: 0,
  signature: '6AB44B715A2B75DC267D62FE905B035B44219A11FCA76DEF064101287FF68414'
};
const RNO4 = {...RDAI, name: 'RNO4', path: ['ST', 'RNO4', 'RNO4.BIN'], podInit: 0x80180C44, seedInit: 0x80180C50, seedEntity: 0x5D,
  getAngle: 0x801CE15C, delta: 0x17BF8,
  signature: 'D7FBB6E1EEE0BC322B99F910E2B854E77200DB55BF06D5F4B53224FE2DAAFD79'};
// RDAI addresses: Balloon Pod 0x801C4668-0x801C4904, seed 0x801C4908-0x801C4B28.
const POD = 0x801C4668, SEED_END = 0x801C4B2C;
const DISPATCH = 0x801C4714; // Balloon Pod "beq step, 0xFF, debug step"
const CAVE = 0x801C4848, CAVE_END = 0x801C48EC; // unreachable debug step 0xFF (FntPrint "charal"), 41 words; 0x801C48EC = Pod epilogue
const STEP2 = 0x801C4AC4, HOOK = 0x801C4ACC, RESUME = 0x801C4AD4; // seed step 2: jal MoveEntity; nop; [lw v1, 0xC(s3); ori v0, 0x7FFF]
const DEATH = 0x801C4938, EPILOGUE = 0x801C4B0C; // seed FLAG_DEAD path (sfx 0x691 -> EntityExplosion), seed epilogue
// Vanilla bytes, unchanged in ASS 2.0: Pod + seed functions, and GetAngleBetweenEntities (same code in both overlays).
const ANGLE_SIGNATURE = '7F414517C80CDDDF4E2B241848C7A0D091E65891D6B7FB08AEE1EC53B4684F19';
const r = {zero:0, at:1, v0:2, v1:3, a0:4, a1:5, s0:16, s1:17, s3:19};
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, sa, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | fn) >>> 0;
const lui = (t, v) => I(15, 0, t, v), lw = (t, o, b) => I(35, b, t, o), lhu = (t, o, b) => I(37, b, t, o), lbu = (t, o, b) => I(36, b, t, o);
const sw = (t, o, b) => I(43, b, t, o), sh = (t, o, b) => I(41, b, t, o);
const addiu = (t, s, v) => I(9, s, t, v), ori = (t, s, v) => I(13, s, t, v), andi = (t, s, v) => I(12, s, t, v);
const slti = (t, s, v) => I(10, s, t, v), sltiu = (t, s, v) => I(11, s, t, v);
const sll = (d, t, sa) => R(0, t, d, sa, 0), sra = (d, t, sa) => R(0, t, d, sa, 3), subu = (d, s, t) => R(s, t, d, 0, 0x23);
const addu = (d, s, t) => R(s, t, d, 0, 0x21), move = (d, s) => addu(d, s, r.zero), mult = (s, t) => R(s, t, 0, 0, 0x18), mflo = d => R(0, 0, d, 0, 0x12);
const jal = a => (0x0C000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0, j = a => (0x08000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0;
const branch = (op, s, t, pc, target) => I(op, s, t, (target - pc - 4) >> 2);
const hi = a => (a + 0x8000) >>> 16, lo = a => a & 0xFFFF;
const at = (o, a) => a + o.delta;
// Seed step 2 after MoveEntity: the two replaced instructions become "j CAVE; lhu v0, timer".
function hookWords(o) { return [j(at(o, CAVE)), lhu(r.v0, 0x80, r.s3)]; }
// For HOMING_FRAMES frames, turn rotate (heading) at most TURN toward Alucard and fly at SPEED; touching Alucard pops the
// seed like a kill. Afterwards the vanilla fall (sway, max 0.5 px/frame down) resumes from the current heading.
function caveWords(o) {
  const pc = n => at(o, CAVE) + n * 4;
  return [
    ori(r.s1, r.zero, SPEED), sltiu(r.v1, r.v0, HOMING_FRAMES), branch(4, r.v1, r.zero, pc(2), pc(36)), addiu(r.v0, r.v0, 1),
    sh(r.v0, 0x80, r.s3), lbu(r.v0, 0x48, r.s3), lhu(r.s0, 0x1E, r.s3), andi(r.v0, r.v0, 0x80),
    branch(5, r.v0, r.zero, pc(8), at(o, DEATH)), move(r.a0, r.s3), lui(r.a1, hi(PLAYER)), jal(o.getAngle), addiu(r.a1, r.a1, lo(PLAYER)),
    subu(r.v0, r.v0, r.s0), sll(r.v0, r.v0, 20), sra(r.v0, r.v0, 20),
    slti(r.v1, r.v0, -TURN), branch(4, r.v1, r.zero, pc(17), pc(20)), slti(r.v1, r.v0, TURN + 1), addiu(r.v0, r.zero, -TURN),
    branch(5, r.v1, r.zero, pc(20), pc(23)), 0, ori(r.v0, r.zero, TURN), addu(r.s0, r.s0, r.v0), sh(r.s0, 0x1E, r.s3),
    jal(RCOS), move(r.a0, r.s0), mult(r.v0, r.s1), mflo(r.v0), sw(r.v0, 8, r.s3),
    jal(RSIN), move(r.a0, r.s0), mult(r.v0, r.s1), mflo(r.v0), j(at(o, EPILOGUE)), sw(r.v0, 0xC, r.s3),
    lw(r.v1, 0xC, r.s3), j(at(o, RESUME)), ori(r.v0, r.zero, 0x7FFF)];
}
// The unreachable debug step now holds seed code; route a stray step 0xFF to the Pod epilogue instead.
const dispatchWord = o => branch(4, r.v1, r.v0, at(o, DISPATCH), at(o, CAVE_END));
const words = list => Buffer.from(Uint32Array.from(list).buffer);
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const region = o => [at(o, POD) - BASE, at(o, SEED_END) - BASE];
const angleRegion = o => [o.getAngle - BASE, o.getAngle + 0x38 - BASE];
function edits(o, file) {
  const cave = file.subarray(at(o, CAVE) - BASE, at(o, CAVE_END) - BASE), code = words(caveWords(o));
  return [
    {off: at(o, DISPATCH) - BASE, original: Buffer.from(file.subarray(at(o, DISPATCH) - BASE, at(o, DISPATCH) - BASE + 4)), expect: words([dispatchWord(o)])},
    {off: at(o, CAVE) - BASE, original: Buffer.from(cave), expect: Buffer.concat([code, cave.subarray(code.length)])},
    {off: at(o, HOOK) - BASE, original: words([0x8E63000C, 0x34027FFF]), expect: words(hookWords(o))}];
}
function check(o, file) {
  assert.equal(K.u32(file, o.podInit - BASE + 8) & 0xFFFF, 0x11D, `${o.name}: Balloon Pod EInit changed.`);
  assert.equal(K.u32(file, o.seedInit - BASE + 8) & 0xFFFF, 0x11E, `${o.name}: seed EInit changed.`);
  assert.ok(caveWords(o).length * 4 <= CAVE_END - CAVE, 'Homing code does not fit the debug step.');
}
function installed(o, file) {
  check(o, file);
  return edits(o, file).every(e => file.subarray(e.off, e.off + e.expect.length).equals(e.expect));
}
function verify(o, file) { assert.ok(installed(o, file), `${o.name}: homing seeds not installed.`); }
function overlay(o, file) {
  check(o, file);
  assert.equal(sha(file.subarray(...region(o))), o.signature, `${o.name}: unknown Balloon Pod or seed code.`);
  assert.equal(sha(file.subarray(...angleRegion(o))), ANGLE_SIGNATURE, `${o.name}: unknown GetAngleBetweenEntities.`);
  const out = Buffer.from(file);
  for (const e of edits(o, file)) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, `${o.name}: hook or cave changed.`);
    out.set(e.expect, e.off);
  }
  verify(o, out); return out;
}
module.exports = {ANGLE_SIGNATURE, BASE, PLAYER, RCOS, RSIN, HOMING_FRAMES, TURN, SPEED, RDAI, RNO4, OVERLAYS: [RDAI, RNO4], POD, SEED_END, DISPATCH, CAVE, CAVE_END,
  STEP2, HOOK, RESUME, DEATH, EPILOGUE, at, hookWords, caveWords, dispatchWord, edits, region, angleRegion, check, installed, verify, overlay, sha};
