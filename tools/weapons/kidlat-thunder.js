const assert = require('node:assert/strict'), crypto = require('node:crypto');
const K = require('../../stats-core.js'), H = require('./elemental-weapons.js');
const OVERLAY = 48, ROW = 200, SOUND = 0x665, HOOK = 0x16E8, CAVE = 0x2400;
const signatures = [
  '06DA8205E16D8D1EF9D5054EF1B3EDD6EBCF16513B5818B145821833CF64CD01',
  '35D4422EAEED440F7BD0AA3F171148B34121D8C545C5F1F764800A9B856E4EF2'
];
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const ins = (op, rs, rt, value) => ((op << 26) | (rs << 21) | (rt << 16) | (value & 65535)) >>> 0;
const jump = address => (0x08000000 | (address >>> 2 & 0x3FFFFFF)) >>> 0;
const saved = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25, 31];
function edits(hand) {
  const base = hand ? 0x8017D000 : 0x8017A000;
  const words = [ins(9, 29, 29, -96), ...saved.map((reg, n) => ins(43, 29, reg, 16 + n * 4)),
    ins(37, 17, 2, 0xAE), ins(13, 0, 3, ROW), ins(5, 2, 3, 6), 0,
    ins(15, 0, 2, 0x8004), ins(35, 2, 2, 0xC7DC), ins(13, 0, 4, SOUND), 0x0040F809, 0,
    ...saved.map((reg, n) => ins(35, 29, reg, 16 + n * 4)), ins(9, 29, 29, 96),
    0x02202021, 0x00003021, jump(base + HOOK + 8), 0];
  const bytes = values => Uint8Array.from(values.flatMap(w => [w & 255, w >>> 8 & 255, w >>> 16 & 255, w >>> 24 & 255]));
  return [{off: HOOK, original: bytes([0x02202021, 0x00003021]), expect: bytes([jump(base + CAVE), 0])},
    {off: CAVE, original: new Uint8Array(words.length * 4), expect: bytes(words)}];
}
function verify(code, hand) {
  for (const e of edits(hand)) assert.deepEqual(code.subarray(e.off, e.off + e.expect.length), e.expect, 'Kidlat thunder sound changed.');
  assert.equal(K.u32(code, 0x21C0), 0x34040665, 'Thunderbrand sound changed.');
}
function weapon(file, hand) {
  const at = OVERLAY * H.SLOT + H.CODE, code = file.subarray(at, at + H.LENGTH);
  assert.equal(sha(code), signatures[hand], `Unknown Kidlat overlay, hand ${hand}.`);
  const out = file.slice();
  for (const e of edits(hand)) {
    assert.deepEqual(code.subarray(e.off, e.off + e.original.length), e.original, 'Kidlat sound space changed.');
    out.set(e.expect, at + e.off);
  }
  verify(out.subarray(at, at + H.LENGTH), hand); return out;
}
module.exports = {OVERLAY, ROW, SOUND, HOOK, CAVE, saved, signatures, edits, verify, weapon};
