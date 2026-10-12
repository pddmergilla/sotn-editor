const assert = require('node:assert/strict');
const W = require('./richter-stopwatch-crash.js');
// The finisher holds Richter's laughing Up stance until F.stance reaches this count, then starts the dagger crash
// (Think phase 4: "if(++F.stance>=30)" = sltiu at,v1,30 at 0x801CED58). One second lets the four clocks' waves
// and their factories finish before the daggers need entity slots.
const PATH = W.PATH, BASE = W.BASE, STANCE = 0x801CED58, FRAMES = 60, OLD_FRAMES = 30;
const sltiu = n => Buffer.from(Uint32Array.of(0x2C610000 | n).buffer);
// lw v1,0(at); nop; addiu v1,v1,1; sw v1,0(at) before the compare, bne at,zero after it.
const CONTEXT = [0x8C230000, 0, 0x24630001, 0xAC230000], NEXT = 0x142000C9;
function edits() { return [{name: 'stance length', off: STANCE - BASE, original: sltiu(OLD_FRAMES), expect: sltiu(FRAMES)}]; }
function check(file) {
  W.check(file, true); W.verify(file);
  CONTEXT.forEach((word, i) => assert.equal(file.readUInt32LE(STANCE - BASE - 16 + i * 4), word, 'Unknown finisher stance code.'));
  assert.equal(file.readUInt32LE(STANCE - BASE + 4), NEXT, 'Unknown finisher stance code.');
}
function verify(file) {
  check(file);
  for (const e of edits()) assert.deepEqual(file.subarray(e.off, e.off + 4), e.expect, 'Richter dagger pause changed.');
}
function overlay(file) {
  check(file);
  const out = Buffer.from(file);
  for (const e of edits()) { assert.deepEqual(file.subarray(e.off, e.off + 4), e.original, 'Richter stance length changed.'); out.set(e.expect, e.off); }
  verify(out); return out;
}
module.exports = {PATH, BASE, STANCE, FRAMES, OLD_FRAMES, edits, check, verify, overlay};
