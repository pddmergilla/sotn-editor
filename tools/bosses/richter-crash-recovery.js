const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
// BO6.BIN (Richter) loads at 0x80180000. Needs the Epic Richter AI with the four-clock finisher.
const PATH = ['BOSS', 'BO6', 'BO6.BIN'], BASE = 0x80180000;
// EntityRichter's "jal RichterThinking" (vanilla word); RichterThinking itself enters the Epic AI and finisher.
const CALL = 0x801B6B90, THINKING = 0x801B5A2C;
// Two unreferenced zero areas in BO6's unused BSS, after the four-clock visual and after the Stopwatch immunity code.
const CAVE = 0x801CF278, CAVE_END = 0x801CF340, TAIL = 0x801CF354, STATE = 0x801CF39C, TAIL_END = 0x801CF3A0;
const THINK = 0x801CF3C8, THINK_S = 0x801CF3CC, FINISHER = 0x801CF3A0, AGGRESSIVE = 0x801CF3E0;
const PAD_SIM = 0x801D15EC, VRAM_FLAG = 0x801D1618, MAX_HP = 0x801D1686, FORCE = 0x801B6992;
const RIC = 0x800733D8 + 64 * 0xBC, PLAY_SFX = 0x8003C7DC;
const CRASHES = (1 << 4) | (1 << 5) | (1 << 9); // Cross, Bible and Agunea; not Axe (2) or Rebound Stone (7)
const FRAMES = 60, SFX = 0x83A, DOWN = 0x4000; // one second; boss Richter's crouching hit grunt
// Epic Richter AI regions this code relies on: RichterThinking, RicCheckSubweapon and the clock finisher.
const REGIONS = [[0x35A2C, 0x36998], [0x3B3FC, 0x3B5BC], [0x4E7C8, 0x4F278], [0x4F340, 0x4F354]];
const SIGNATURE = '4D2C3F89FB49360213511CF511C754FFFAFD3EA592B6A4E6516339EE470E94D2';
const r = {zero:0, a0:4, a1:5, a2:6, a3:7, v0:2, t0:8, t1:9, t2:10, t3:11, t4:12, t5:13, sp:29, ra:31};
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, sa, fn) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | fn) >>> 0;
const lui = (t, v) => I(15, 0, t, v), lw = (t, o, b) => I(35, b, t, o), lh = (t, o, b) => I(33, b, t, o);
const lhu = (t, o, b) => I(37, b, t, o), lbu = (t, o, b) => I(36, b, t, o), sw = (t, o, b) => I(43, b, t, o);
const sh = (t, o, b) => I(41, b, t, o), sb = (t, o, b) => I(40, b, t, o), addiu = (t, s, v) => I(9, s, t, v);
const ori = (t, s, v) => I(13, s, t, v), sltiu = (t, s, v) => I(11, s, t, v);
const sll = (d, t, sa) => R(0, t, d, sa, 0), srlv = (d, t, s) => R(s, t, d, 0, 6), slt = (d, s, t) => R(s, t, d, 0, 0x2A);
const and = (d, s, t) => R(s, t, d, 0, 0x24), jr = s => R(s, 0, 0, 0, 8), jalr = s => R(s, 0, 31, 0, 9);
const jal = a => (0x0C000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0, j = a => (0x08000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0;
const hi = a => (a + 0x8000) >>> 16, lo = a => a & 0xFFFF, at = (base, a) => a - base;
const H = 0x801D0000, P = 0x80070000; // t0 and t1 bases
// Runs the AI, then: a forced Cross/Bible/Agunea crash in aggressive mode below 25% HP sets the latch; once Richter
// is back on his feet he grunts and holds Down for one second while the AI waits in its idle step. A hit, death,
// cutscene, scripted think step or the finisher cancels it.
function program() {
  const out = [], labels = {}, fix = [];
  const pc = () => (out.length < 48 ? CAVE + out.length * 4 : TAIL + (out.length - 48) * 4);
  const op = w => out.push(w), br = (code, s, t, label) => { fix.push([out.length, pc(), label]); out.push(I(code, s, t, 0)); };
  const label = name => { labels[name] = pc(); };
  op(addiu(r.sp, r.sp, -24)); op(sw(r.ra, 16, r.sp)); op(jal(THINKING)); op(0);
  op(lui(r.t0, H >>> 16)); op(lui(r.t1, P >>> 16));
  op(lhu(r.a1, at(P, RIC + 0x2C), r.t1)); op(lw(r.a2, at(H, THINK), r.t0)); op(lw(r.a3, at(H, FINISHER), r.t0));
  op(lhu(r.v0, at(H, STATE), r.t0)); op(addiu(r.t2, r.a1, -1)); op(sltiu(r.t2, r.t2, 3)); op(sltiu(r.t3, r.a2, 2));
  br(5, r.a3, r.zero, 'clear'); op(and(r.t2, r.t2, r.t3));
  br(4, r.v0, r.zero, 'idle'); op(addiu(r.v0, r.v0, -1));
  br(4, r.t2, r.zero, 'clear'); op(sh(r.v0, at(H, STATE), r.t0));
  label('hold'); op(sw(r.zero, at(H, THINK), r.t0)); op(sw(r.zero, at(H, THINK_S), r.t0)); op(ori(r.t3, r.zero, DOWN));
  br(4, r.zero, r.zero, 'out'); op(sw(r.t3, at(H, PAD_SIM), r.t0));
  label('clear'); br(4, r.zero, r.zero, 'out'); op(sw(r.zero, at(H, STATE), r.t0));
  label('idle'); op(lw(r.t3, at(H, AGGRESSIVE), r.t0)); op(lh(r.t4, at(P, RIC + 0x3E), r.t1)); op(lhu(r.t5, at(H, MAX_HP), r.t0));
  op(sll(r.t4, r.t4, 2)); op(slt(r.t4, r.t4, r.t5)); op(and(r.t3, r.t3, r.t4));
  op(lui(r.t4, hi(FORCE))); op(lbu(r.t4, lo(FORCE), r.t4)); op(ori(r.t5, r.zero, CRASHES)); op(srlv(r.t5, r.t5, r.t4));
  op(and(r.t3, r.t3, r.t5)); op(addiu(r.t4, r.a1, -0x13)); op(sltiu(r.t4, r.t4, 10)); op(and(r.t3, r.t3, r.t4));
  br(4, r.t3, r.zero, 'recover'); op(ori(r.t4, r.zero, 1));
  br(4, r.zero, r.zero, 'out'); op(sb(r.t4, at(H, STATE + 2), r.t0));
  label('recover'); op(lbu(r.t3, at(H, STATE + 2), r.t0)); op(lw(r.t4, at(H, VRAM_FLAG), r.t0));
  op(j(TAIL)); op(and(r.t2, r.t2, r.t4));
  assert.equal(out.length, 48, 'Crash recovery code does not fill the first area as laid out.');
  op(and(r.t2, r.t2, r.t3)); br(4, r.t2, r.zero, 'out'); op(ori(r.t3, r.zero, FRAMES - 1));
  op(lui(r.v0, hi(PLAY_SFX))); op(lw(r.v0, lo(PLAY_SFX), r.v0)); op(sw(r.t3, at(H, STATE), r.t0));
  op(jalr(r.v0)); op(ori(r.a0, r.zero, SFX));
  br(4, r.zero, r.zero, 'hold'); op(lui(r.t0, H >>> 16));
  label('out'); op(lw(r.ra, 16, r.sp)); op(addiu(r.sp, r.sp, 24)); op(jr(r.ra)); op(0);
  for (const [n, from, name] of fix) out[n] = (out[n] | ((labels[name] - from - 4) >> 2 & 0xFFFF)) >>> 0;
  return {cave: out.slice(0, 48), tail: out.slice(48)};
}
const words = list => Buffer.from(Uint32Array.from(list).buffer);
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const signature = file => sha(Buffer.concat(REGIONS.map(([s, e]) => file.subarray(s, e))));
function edits() {
  const {cave, tail} = program();
  assert.ok(cave.length * 4 <= CAVE_END - CAVE && TAIL + tail.length * 4 <= STATE, 'Crash recovery code does not fit.');
  return [{off: CALL - BASE, original: words([jal(THINKING)]), expect: words([jal(CAVE)])},
    {off: CAVE - BASE, original: Buffer.alloc(cave.length * 4), expect: words(cave)},
    {off: TAIL - BASE, original: Buffer.alloc(TAIL_END - TAIL), expect: Buffer.concat([words(tail), Buffer.alloc(TAIL_END - TAIL - tail.length * 4)])}];
}
function check(file, expected = SIGNATURE) {
  assert.equal(K.u32(file, THINKING - BASE), j(0x801CE800), 'RichterThinking does not enter the Epic Richter AI finisher.');
  assert.equal(signature(file), expected, 'Unknown Epic Richter AI code in BO6.BIN.');
}
function verify(file) {
  check(file);
  for (const e of edits()) assert.deepEqual(file.subarray(e.off, e.off + e.expect.length), e.expect, 'Richter crash recovery changed.');
}
function overlay(file) {
  check(file);
  const out = Buffer.from(file);
  for (const e of edits()) {
    assert.deepEqual(file.subarray(e.off, e.off + e.original.length), e.original, 'Richter AI call or free space changed.');
    out.set(e.expect, e.off);
  }
  verify(out); return out;
}
module.exports = {PATH, BASE, CALL, THINKING, CAVE, CAVE_END, TAIL, STATE, TAIL_END, THINK, THINK_S, FINISHER, AGGRESSIVE,
  PAD_SIM, VRAM_FLAG, MAX_HP, FORCE, RIC, PLAY_SFX, CRASHES, FRAMES, SFX, DOWN, REGIONS, SIGNATURE, program, edits, signature,
  check, verify, overlay};
