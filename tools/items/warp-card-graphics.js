const assert = require('node:assert/strict');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
const BASE = M.DRA_BASE, ICON = 315, ICON_START = 0x25324 + ICON * 128, ICON_END = ICON_START + 128;
const CAVE = 0x2F0B0, HOOK = 0x44EF4, ORIGINAL = 0x800F1454;
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
function helper() {
  const H = require('./warp-cards.js');
  const words = [i(13, 0, 8, H.SCORPION_INDEX), i(4, 4, 8, 3), i(13, 0, 8, H.NOIL_INDEX),
    i(5, 4, 8, 7), 0, i(15, 0, 3, 0x8009), i(35, 3, 3, 0x74A0), 0,
    0x03E00008, 0, 0, H.jump(ORIGINAL), 0];
  const bytes = Buffer.alloc(words.length * 4); words.forEach((w, n) => bytes.writeUInt32LE(w, n * 4));
  return bytes;
}
function install(dra) {
  const H = require('./warp-cards.js');
  assert.equal(K.u32(dra, HOOK), H.jump(ORIGINAL, true), 'Unknown stage-art loading hook.');
  assert.equal(K.u32(dra, HOOK + 4), 0);
  assert.deepEqual(Buffer.from(dra.subarray(0x51454, 0x51484)), Buffer.from(
    '0900821002000334a291033403008310000000000800e003ffff03240980033ca074638c000000000800e00300000000', 'hex'), 'Unknown existing artwork selector.');
  assert.ok(dra.subarray(ICON_START, ICON_END).every(v => v === 0), 'Artwork helper space is occupied.');
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  const items = [...m.sections.equipRows, ...Object.values(m.sections.body).flat()];
  assert.ok(items.every(row => m.get(row.icon) !== ICON), 'An equipment item uses icon 315.');
  for (let off = 0; off + 4 <= dra.length; off += 4) {
    const value = K.u32(dra, off);
    assert.ok(!(value >= BASE + ICON_START && value < BASE + ICON_END), 'An existing pointer uses icon 315.');
    if (off >= 0x42398 && off < 0x962A8) {
      const target = K.branchTarget(value, BASE + off);
      assert.ok(!(target >= BASE + ICON_START && target < BASE + ICON_END), 'Existing code uses icon 315.');
    }
  }
  const code = helper(), after = new Uint8Array(dra); assert.ok(CAVE + code.length <= ICON_END);
  after.set(code, CAVE); K.put32(after, HOOK, H.jump(BASE + CAVE, true));
  return after;
}
function prepareInstalled(dra) {
  const H = require('./warp-cards.js'), expected = Buffer.alloc(H.END - H.CAVE);
  for (const {start, bytes} of H.helpers()) expected.set(bytes, start - H.CAVE);
  for (const [off, values] of [[H.SCORPION_RECORD, [192, 132, 16, 0, H.WRP_STAGE]], [H.NOIL_RECORD, [192, 132, 0, 0, H.RWRP_STAGE]]])
    values.forEach((v, n) => K.put16(expected, off - H.CAVE + n * 2, v));
  assert.deepEqual(Buffer.from(dra.subarray(H.CAVE, H.END)), expected, 'Unknown installed warp-card code.');
  for (const [off, target, call] of [[H.HOOK, H.ACTIVATE, true], [H.TRANSITION_HOOK, H.TRANSITION, false], [H.SELECT_HOOK, H.SELECT, false]])
    assert.equal(K.u32(dra, off), H.jump(BASE + target, call));
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  assert.equal(m.get(m.sections.hand[166].name), 'Scorpion Card'); assert.equal(m.get(m.sections.hand[27].name), 'noiL Card');
  return install(dra);
}
module.exports = {install, prepareInstalled, helper, BASE, ICON, ICON_START, ICON_END, CAVE, HOOK, ORIGINAL};
