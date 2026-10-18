const assert = require('node:assert/strict');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
const BASE = M.DRA_BASE, ITEM = 84, MYSTIC = 76, BONUS = 30;
// Blank equipment icon 314 holds the helper; warp cards use 311-313.
const ICON = 314, ICON_START = 0x25324 + ICON * 0x80, ICON_END = ICON_START + 0x80, CAVE = 0x2F040;
const HOOK = 0x61DA8, CHECK = 0x800FD7C0, TIMER = 0x8003C8C4, MP = 0x80097BB0;
const NAME = 'Duplichaos', DESC = 'Gain the power of Chaos';
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;
// Mystic Pendant's MP block (+3 on its tick) followed by the MP clamp; ASS changed base regen and +3.
const PENDANT = [jump(CHECK, true), 0x34050004, 0x1040000D, 0x3403001F, 0x3C028004, 0x8C42C8C4, 0, 0x3042003F,
  0x14430007, 0, 0x3C028009, 0x8C427BB0, 0, 0x24420003, 0x3C018009, 0xAC227BB0];
const CLAMP = [0x3C048009, 0x24847BB0, 0x8C820000, 0x3C038009, 0x8C637BB4, 0, 0x0062102A, 0x10400002, 0, 0xAC830000, 0x34040011];
// On the pendant tick, add BONUS MP when an accessory slot holds ITEM; the caller's clamp follows.
function helper() {
  const words = [
    i(15, 0, 2, TIMER + 0x8000 >>> 16), i(35, 2, 2, TIMER & 65535), i(13, 0, 3, 0x1F), i(12, 2, 2, 0x3F),
    i(5, 2, 3, 14), 0, // not the tick: out
    i(9, 29, 29, -24), i(43, 29, 31, 16), i(13, 0, 4, ITEM), jump(CHECK, true), i(13, 0, 5, 4),
    i(35, 29, 31, 16), i(4, 2, 0, 6), i(9, 29, 29, 24), // not equipped: out
    i(15, 0, 3, MP >>> 16), i(35, 3, 2, MP & 65535), 0, i(9, 2, 2, BONUS), i(43, 3, 2, MP & 65535),
    // out: restore the clamp's a0 = &g_Status.mp
    i(15, 0, 4, MP >>> 16), 0x03E00008, i(9, 4, 4, MP & 65535)];
  const b = Buffer.alloc(words.length * 4); words.forEach((w, n) => b.writeUInt32LE(w, n * 4));
  return b;
}
function prepare(dra) {
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  const row = m.sections.body.accessory.find(r => r.index === ITEM);
  assert.ok(row, 'Accessory 84 is missing.'); assert.equal(row.type, 3);
  assert.equal(m.get(row.name), 'Duplicator');
  const effect = id => m.field(m.effects.find(e => m.field(e).group === id));
  const duplicator = effect('duplicator'), pendant = effect('mysticpendant');
  assert.equal(duplicator.value, ITEM); assert.equal(duplicator.sites.length, 1);
  assert.deepEqual([duplicator.sites[0].call, ...duplicator.sites[0].pcs], [0x5DD94, 0x5DD5C]);
  assert.equal(pendant.value, MYSTIC); assert.deepEqual(pendant.sites.map(s => s.call), [0x61D68]);
  PENDANT.forEach((w, n) => assert.equal(K.u32(dra, 0x61D68 + n * 4), w, 'Unknown Mystic Pendant code.'));
  CLAMP.forEach((w, n) => assert.equal(K.u32(dra, HOOK + n * 4), w, 'Unknown MP clamp code.'));
  assert.ok(dra.subarray(ICON_START, ICON_END).every(v => v === 0), 'Icon 314 space is occupied.');
  const items = [...m.sections.equipRows, ...Object.values(m.sections.body).flat()];
  assert.ok(items.every(r => m.get(r.icon) !== ICON), 'An equipment item uses icon 314.');
  for (let off = 0; off + 4 <= dra.length; off += 4) {
    const value = K.u32(dra, off);
    assert.ok(!(value >= BASE + ICON_START && value < BASE + ICON_END), 'An existing pointer uses icon 314 space.');
    if (off >= 0x42398 && off < 0x962A8) {
      const target = K.branchTarget(value, BASE + off);
      assert.ok(!(target >= BASE + ICON_START && target < BASE + ICON_END), 'Existing code uses icon 314 space.');
      assert.ok(target !== BASE + HOOK + 4, 'Existing code branches into the hook delay slot.');
    }
  }
  for (const key of ['attack', 'defense', 'str', 'con', 'int', 'lck', 'weak', 'resist', 'immune', 'absorb']) m.set(row[key], 0);
  m.set(row.name, NAME); m.set(row.desc, DESC); m.set(m.effects.find(e => m.field(e).group === 'duplicator'), 0xFFFF);
  for (const key of ['name', 'desc']) assert.equal(m.field(row[key]).usedBy.length, 1);
  const after = new Uint8Array(dra); M.apply(m, {DRA: after});
  const code = helper(); assert.ok(CAVE + code.length <= ICON_END);
  after.set(code, CAVE); K.put32(after, HOOK, jump(BASE + CAVE, true)); K.put32(after, HOOK + 4, 0);
  return after;
}
module.exports = {prepare, helper, BASE, ITEM, MYSTIC, BONUS, ICON, ICON_START, ICON_END, CAVE, HOOK, CHECK, TIMER, MP,
  NAME, DESC, PENDANT, CLAMP, jump};
