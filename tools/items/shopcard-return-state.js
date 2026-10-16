const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js');
// DRA.BIN loads at 0x800A0000. The Shop Card inverted-castle return fix keeps its return room (stage + 1, left, top)
// in three words at 0x800CDCB0, inside blank icon 275. The second-castle enemy attack helper (jal 0x800CDCA4 from
// every inverted-castle overlay's hit detection) was later written over 0x800CDCA4-0x800CDD13 in the same icon, so
// once the recorder stores a room, the helper's words at 0x800CDCB0-0x800CDCBB become syscall / nor / jalr zero and
// the next inverted-castle hit check jumps to address 0. This moves the three state words to the unreferenced,
// zero-filled tail of icon 308 (after the Shop Card reader) and leaves the attack helper untouched.
const PATH = ['DRA.BIN'], BASE = 0x800A0000;
const OLD = 0x800CDCB0, NEW = 0x800CED8C, SIZE = 12;
const HELPER = 0x800CDCA4, HELPER_END = 0x800CDD14;
const HELPER_SHA = 'BE8C96380944B72B309753B88AA7E6BD15E56244C5A8B22F2151F65DB63209BC';
// Every reference to the old state: recorder (hooked from 0x80105428), two old load/init clears, the reader (from 0x800F4748).
const SITES = [
  {at: 0x800CE248, word: 0, op: 'sw t5'}, {at: 0x800CE24C, word: 1, op: 'sw t3'}, {at: 0x800CE250, word: 2, op: 'sw t4'},
  {at: 0x800CE35C, word: 0, op: 'sw zero'}, {at: 0x800CE36C, word: 0, op: 'sw zero'},
  {at: 0x800CED08, word: 0, op: 'lw t1'}, {at: 0x800CED40, word: 1, op: 'lw t3'}, {at: 0x800CED44, word: 2, op: 'lw t4'}
];
// "lui t0, 0x800D" that sets the base register for each group of sites.
const LUIS = [0x800CE238, 0x800CE358, 0x800CE368, 0x800CED04], LUI_T0 = 0x3C08800D;
const RECORDER = 0x800CE21C, RECORDER_HOOK = 0x80105428, READER = 0x800CED04, READER_HOOK = 0x800F4748;
const ORIGINAL = [0xAD0DDCB0, 0xAD0BDCB4, 0xAD0CDCB8, 0xAD00DCB0, 0xAD00DCB0, 0x8D09DCB0, 0x8D0BDCB4, 0x8D0CDCB8];
const at = a => a - BASE;
const lo = a => a & 0xFFFF;
const retarget = (w, address) => ((w & 0xFFFF0000) | lo(address)) >>> 0;
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const words = list => Buffer.from(Uint32Array.from(list).buffer);
const j = a => (0x08000000 | (a >>> 2 & 0x3FFFFFF)) >>> 0;
function edits() {
  return SITES.map((s, i) => ({off: at(s.at), original: words([ORIGINAL[i]]), expect: words([retarget(ORIGINAL[i], NEW + s.word * 4)])}));
}
function common(file) {
  for (const a of LUIS) assert.equal(K.u32(file, at(a)), LUI_T0, `lui t0,0x800D missing at ${a.toString(16)}.`);
  assert.equal(K.u32(file, at(RECORDER_HOOK)), j(RECORDER), 'The Shop Card room recorder hook changed.');
  assert.equal(K.u32(file, at(READER_HOOK)), j(READER), 'The Shop Card return reader hook changed.');
  assert.equal(sha(file.subarray(at(HELPER), at(HELPER_END))), HELPER_SHA, 'The second-castle attack helper changed.');
}
function check(file) {
  common(file);
  edits().forEach((e, i) => assert.deepEqual(file.subarray(e.off, e.off + 4), e.original, `Unexpected Shop Card state access at ${SITES[i].at.toString(16)}.`));
  assert.ok(file.subarray(at(NEW), at(NEW) + SIZE).every(b => b === 0), 'The new Shop Card state area is not free.');
}
function verify(file) {
  common(file);
  edits().forEach(e => assert.deepEqual(file.subarray(e.off, e.off + 4), e.expect, 'Shop Card state relocation changed.'));
  assert.ok(file.subarray(at(NEW), at(NEW) + SIZE).every(b => b === 0), 'The relocated Shop Card state is not zero on disc.');
}
function overlay(file) {
  check(file);
  const out = Buffer.from(file);
  for (const e of edits()) out.set(e.expect, e.off);
  verify(out); return out;
}
module.exports = {PATH, BASE, OLD, NEW, SIZE, HELPER, HELPER_END, HELPER_SHA, SITES, LUIS, RECORDER, RECORDER_HOOK, READER, READER_HOOK,
  ORIGINAL, edits, check, verify, overlay, sha};
