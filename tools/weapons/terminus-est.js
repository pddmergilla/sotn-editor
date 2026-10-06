const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');

const TERMINUS = 116, CRISSAEGRIM = 164, SPECIAL = 186, OVERLAY = 12;
const SLOT = 0x7000, CODE = 0x4000, LENGTH = 0x3000;
const BANK = 0x1B30, DATA = 0x2534, NORMAL = 0x274C, ENTRY = 0x2970;
const PAL = 0x2990, TABLE = 0x2C90, END = 0x2CAC;
const signatures = [
  ['054c837b6f416a972a8732d43a680e4fe02f9d25fa0c300d0d7e37d02b3be827',
    'f0ec8adacef9948d7ccf2fadec6cc5c57bc23717710c68004eeaf2d0fb922938'],
  ['c3945125f72329bb3efb21426a7d2cc763ba3eb8af206213d66b4ba99c5ddcc4',
    'f1d65940b042495f51f7dfc45f3499c5e051a0ef381f028c1f6b8c771b99c7e1']
];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const jump = (address, call = false) => ((call ? 0x0C000000 : 0x08000000) | (address >>> 2 & 0x3FFFFFF)) >>> 0;
const ins = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;

function weapon(file, hand) {
  const base = hand ? 0x8017D000 : 0x8017A000;
  const sword = file.subarray(CODE, CODE + LENGTH);
  const before = file.subarray(OVERLAY * SLOT + CODE, (OVERLAY + 1) * SLOT);
  assert.equal(sha(sword), signatures[hand][0], 'Unknown sword code.');
  assert.equal(sha(before), signatures[hand][1], 'Unknown Crissaegrim code.');
  assert.ok(before.subarray(BANK, END).every(v => v === 0), 'Weapon space is occupied.');
  const after = before.slice();
  const local = off => {
    if (off >= 0x40 && off < 0xA44) return BANK + off - 0x40;
    if (off >= 0xEA4 && off < 0x10BC) return DATA + off - 0xEA4;
    if (off === 0x10D0) return 0xAC8;
    if (off >= 0x1474 && off < 0x1698) return NORMAL + off - 0x1474;
    throw Error(`Unreviewed sword reference ${off.toString(16)}`);
  };
  after.set(sword.subarray(0x40, 0xA44), BANK);
  for (let frame = 1; frame <= 80; frame++) {
    const ptr = K.u32(sword, 0x40 + frame * 4) - base;
    K.put32(after, BANK + frame * 4, base + local(ptr));
    assert.equal(K.u16(sword, ptr), 1);
    for (const off of [16, 20]) {
      assert.ok(K.u16(sword, ptr + off) <= 112);
      K.put16(after, local(ptr) + off, K.u16(sword, ptr + off) + 128);
    }
  }
  after.set(sword.subarray(0xEA4, 0x10BC), DATA);
  for (let off = 0x1034; off < 0x10BC; off += 4) {
    const ptr = K.u32(sword, off);
    if (ptr >= base && ptr < base + LENGTH) K.put32(after, local(off), base + local(ptr - base));
  }
  const body = sword.slice(0x1474, 0x1698);
  const helpers = new Map([[0x11D8, 0xBF8], [0x1378, 0xD70], [0x10D4, 0xACC]]);
  for (let off = 0; off < body.length; off += 4) {
    const word = K.u32(body, off), op = word >>> 26;
    if (op !== 2 && op !== 3) continue;
    const target = K.branchTarget(word, base + 0x1474 + off) - base;
    assert.ok(helpers.has(target) || target >= 0x1474 && target < 0x1698);
    K.put32(body, off, jump(base + (helpers.get(target) ?? local(target)), op === 3));
  }
  for (const [hi, lo, target] of [[0x14BC, 0x14C0, 0x106C], [0x1514, 0x1518, 0x40], [0x1524, 0x1528, 0x10D0]]) {
    const addr = base + local(target);
    K.put32(body, hi - 0x1474, K.withImmediate(K.u32(body, hi - 0x1474), (addr + 0x8000) >>> 16));
    K.put32(body, lo - 0x1474, K.withImmediate(K.u32(body, lo - 0x1474), addr & 65535));
  }
  assert.equal(K.u32(body, 0x152C - 0x1474), 0x24028010);
  assert.equal(K.u32(body, 0x1534 - 0x1474), 0x34020110);
  K.put32(body, 0x152C - 0x1474, 0x24028011);
  K.put32(body, 0x1534 - 0x1474, 0x3402011E);
  after.set(body, NORMAL);
  [0x948200AE, ins(13, 0, 3, TERMINUS), 0x10430003, 0,
    jump(K.u32(before, 0)), 0, jump(base + NORMAL), 0].forEach((w, i) => K.put32(after, ENTRY + i * 4, w));
  K.put32(after, 0, base + ENTRY);
  after.set(before.subarray(0x2B0, 0x5B0), PAL);
  after.set(sword.subarray(0xC04, 0xCE4), PAL + 14 * 32);
  after.set(before.subarray(0xAB0, 0xAC8), TABLE);
  K.put32(after, TABLE + 24, base + PAL);
  assert.equal(K.u32(before, 0xB4C), 0x3C018018);
  assert.equal(K.u32(before, 0xB54), hand ? 0x8C25DAB0 : 0x8C25AAB0);
  K.put32(after, 0xB4C, K.withImmediate(K.u32(before, 0xB4C), (base + TABLE + 0x8000) >>> 16));
  K.put32(after, 0xB54, K.withImmediate(K.u32(before, 0xB54), (base + TABLE) & 65535));
  const output = file.slice(); output.set(after, OVERLAY * SLOT + CODE);
  for (let y = 0; y < 96; y++) {
    const dst = OVERLAY * SLOT + y * 128 + 64;
    assert.ok(file.subarray(dst, dst + 56).every(v => v === 0), 'Sword artwork space is occupied.');
    output.set(file.subarray(y * 128, y * 128 + 56), dst);
  }
  return output;
}

function prepare(model, weapons) {
  const rows = model.sections.equipRows, item = rows[TERMINUS];
  for (const [key, expected] of [['weaponId', 0], ['wpal', 2], ['unk14', 2], ['unk17', 0], ['specialMove', 0]])
    assert.equal(model.get(item[key]), expected, `Unsupported Terminus Est ${key}.`);
  assert.equal(model.get(rows[CRISSAEGRIM].weaponId), OVERLAY);
  assert.equal(model.get(rows[CRISSAEGRIM].unk13), 52);
  assert.equal(model.get(rows[CRISSAEGRIM].unk14), 2);
  assert.ok(M.freeSpecialRows(model).some(r => r.index === SPECIAL), 'The private special row is occupied.');
  const result = weapons.map(weapon);
  for (const [id, value] of M.planRowCopy(model, CRISSAEGRIM, SPECIAL)) model.set(id, value);
  model.set(rows[SPECIAL].attack, model.get(item.attack));
  model.set(rows[SPECIAL].wpal, 6);
  model.set(item.weaponId, OVERLAY); model.set(item.wpal, 6); model.set(item.unk17, SPECIAL);
  const dra = model.files.DRA.bytes.slice(); M.apply(model, {DRA: dra});
  return {dra, weapons: result};
}

module.exports = {prepare, weapon, TERMINUS, CRISSAEGRIM, SPECIAL, OVERLAY, SLOT, CODE, LENGTH, BANK, DATA, NORMAL, ENTRY, PAL, TABLE, END};
