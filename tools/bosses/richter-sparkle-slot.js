const assert = require('node:assert/strict');
const W = require('./richter-stopwatch-crash.js');
// BO6 factory kinds 4 and 5 are fixed slots (g_Entities[0x5F] and [0x70], the Shaft orb from blueprint 0x48), not ranges.
// The Stopwatch crash sparkle blueprint copied blueprint 0x48 and so replaced the orb, which the rescue cutscene needs.
// Kind 1 searches free slots 0x60-0x7F, like the crash clocks (blueprint 0x3F).
const PATH = W.PATH, BASE = W.BASE, AT = W.BLUEPRINT(W.SPARKLE_BP) + 4, OLD_KIND = 5, KIND = 1;
const RANGES = 0x80181868, ORB_SLOT = 0x70;
function edits() { return [{name: 'sparkle factory kind', off: AT - BASE, original: Buffer.of(OLD_KIND), expect: Buffer.of(KIND)}]; }
function check(file, fixed) {
  W.check(file, true);
  // Every other Stopwatch crash byte is installed.
  for (const e of W.edits(file)) if (e.name !== 'sparkle blueprint') assert.deepEqual(file.subarray(e.off, e.off + e.expect.length), e.expect, `Stopwatch crash ${e.name} missing.`);
  const bp = file.subarray(W.BLUEPRINT(W.SPARKLE_BP) - BASE, W.BLUEPRINT(W.SPARKLE_BP) - BASE + 6).toString('hex');
  assert.equal(bp, fixed ? W.SPARKLE_NEW : '2e0141000500', 'Unknown sparkle blueprint.');
  assert.equal(file[RANGES - BASE + KIND * 2], 0x60); assert.equal(file[RANGES - BASE + KIND * 2 + 1], 0x7F);
}
function verify(file) { check(file, true); }
function overlay(file) {
  check(file, false);
  const out = Buffer.from(file);
  for (const e of edits()) out.set(e.expect, e.off);
  verify(out); return out;
}
module.exports = {PATH, BASE, AT, OLD_KIND, KIND, RANGES, ORB_SLOT, edits, check, verify, overlay};
