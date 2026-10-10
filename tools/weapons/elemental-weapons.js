const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js'), M = require('../../stats-model.js'), X = require('../../weapon-special-rows.js');
const SLOT = 0x7000, CODE = 0x4000, LENGTH = 0x3000;
const CONFIG = [
  {name: 'Heatgar', item: 88, normal: 111, donor: 117, special: 217, overlay: 49},
  {name: 'Sparkblade', item: 86, normal: 112, donor: 178, special: 200, overlay: 48},
  {name: 'Coldsteel', item: 87, normal: 113, donor: 181, special: 201, overlay: 50}
];
const signatures = {
  48: ['e537aff7d119154676015812b906cfa796c4dc88793b76263a1cf52197129304', 'c8ac2341a6152aa12de6557783ad4962ba889dc08490ae36678efb9c62d33a88'],
  49: ['53d39bd9be2e45c8d7706d7de518b0ff2df944428e8d1c8c40c327d723413600', '46ef8ef01970be973441c0328bd2542b8d072910831504402106aea316a1fbd6'],
  50: ['6820227a27d5fa9da271133aaf0f09099ead830a7590f34db38ec8a52c36f8fb', '0bbaf50d0029a357c6b4badd557148121d5d8691562e8bcac95e6dd2446f94d8']
};
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const ins = (op, rs, rt, value) => ((op << 26) | (rs << 21) | (rt << 16) | (value & 65535)) >>> 0;
const jump = address => (0x08000000 | (address >>> 2 & 0x3FFFFFF)) >>> 0;
const hooks = {
  48: {off: 0x1528, end: 0x1604, next: 0x1530, cave: 0x23C0, self: 17, anim: 16, row: 200},
  50: {off: 0x1560, end: 0x15D0, next: 0x1568, cave: 0x2E90, self: 16, anim: 18, row: 201}
};
function weapon(file, hand) {
  const base = hand ? 0x8017D000 : 0x8017A000, out = file.slice();
  for (const overlay of [48, 49, 50]) {
    const start = overlay * SLOT + CODE, before = file.subarray(start, start + LENGTH);
    assert.equal(sha(before), signatures[overlay][hand], `Unknown elemental overlay ${overlay}, hand ${hand}.`);
    if (!hooks[overlay]) continue;
    const h = hooks[overlay], after = out.subarray(start, start + LENGTH);
    const words = [overlay === 48 ? ins(4, h.anim, 0, 7) : ins(5, h.anim, 2, 7), 0,
      ins(37, h.self, 2, 0xAE), ins(13, 0, 3, h.row), ins(4, 2, 3, 3), 0,
      jump(base + h.next), 0, jump(base + h.end), 0];
    // Keep the original charge for the brand weapons.
    assert.ok(before.subarray(h.cave, h.cave + words.length * 4).every(v => v === 0), 'Weapon padding is occupied.');
    words.forEach((w, n) => K.put32(after, h.cave + n * 4, w));
    assert.equal(K.u32(before, h.off), overlay === 48 ? 0x12000036 : 0x1642001B);
    K.put32(after, h.off, jump(base + h.cave));
  }
  return out;
}
function prepare(model, weapons) {
  const original = model.files.DRA.bytes, rows = model.sections.equipRows, table = model.tables.equip;
  assert.equal(table, X.TABLE); assert.equal(rows.length, 217, 'The extended special is already installed.');
  assert.ok(M.freeSpecialRows(model).some(r => r.index === 200));
  assert.ok(M.freeSpecialRows(model).some(r => r.index === 201));
  for (const c of CONFIG) {
    assert.equal(model.get(rows[c.item].name).trim().toLowerCase(), c.name.toLowerCase());
    for (const [key, value] of [['weaponId', 0], ['unk17', 0], ['specialMove', 0]])
      assert.equal(model.get(rows[c.item][key]), value, `${c.name} ${key} changed.`);
    assert.equal(model.get(rows[c.normal].weaponId), c.overlay);
    assert.equal(model.get(rows[c.donor].weaponId), c.overlay);
  }
  const header = 0x1407C;
  assert.equal(K.u32(original, header), 0x56414270);
  const programs = K.u16(original, header + 18);
  assert.ok(programs <= 128 && header + 32 + 128 * 16 + programs * 16 * 32 + 512 <= X.DATA, 'Sound header occupies the extension.');
  const end = X.START + X.sites.length * X.SLOT;
  assert.ok(original.subarray(X.DATA, end).every(v => v === 0), 'DRA padding is occupied.');
  for (const edit of X.edits().filter(e => e.original))
    assert.deepEqual(original.subarray(edit.off, edit.off + edit.original.length), edit.original, 'Unknown special-row instruction.');
  const changedWeapons = weapons.map(weapon);
  for (const c of CONFIG) {
    for (const [id, value] of M.planStyleCopy(model, c.normal, c.item)) model.set(id, value);
    if (c.special < 217) {
      for (const [id, value] of M.planRowCopy(model, c.donor, c.special)) model.set(id, value);
      model.set(rows[c.special].unk11, model.get(rows[c.normal].unk11));
    }
    model.set(rows[c.item].unk17, c.special);
  }
  const dra = original.slice(); M.apply(model, {DRA: dra});
  dra.set(original.subarray(table + 117 * 52, table + 118 * 52), X.DATA);
  dra[X.DATA + 0x17] = dra[X.DATA + 0x18] = 0;
  K.put32(dra, X.DATA + 0x1C, 0); K.put32(dra, X.DATA + 0x20, 0);
  for (const edit of X.edits()) dra.set(edit.expect, edit.off);
  return {dra, weapons: changedWeapons};
}
module.exports = {prepare, weapon, CONFIG, hooks, signatures, SLOT, CODE, LENGTH};
