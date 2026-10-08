const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');

const ITEM = 94, SPECIAL = 169, HEAVEN = 119, OVERLAY = 13;
const SLOT = 0x7000, CODE = 0x4000, LENGTH = 0x3000;
const BANK = 0x1C10, DATA = 0x2614, NORMAL = 0x282C, ENTRY = 0x2A50;
const PAL = 0x2A70, TABLE = 0x2D70, END = 0x2D78;
const signatures = [
  ['db2efccd6e4c8c9fd945cf1c4701f5006fd2f610e88b54af56c206bf1c8eb201',
    'f6b252185af40892ae29b4278ff55438ec8a2ca7f04315449255408dc36defeb'],
  ['3b87a42b729210245d61add36df19b8467819a952e36d0e72928e359780f1a8c',
    'fd121026827770bd8f65f63b518fae8ea4675a66152990ebbe6222b352cfb1c3']
];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const jump = (address, call = false) => ((call ? 0x0C000000 : 0x08000000) | (address >>> 2 & 0x3FFFFFF)) >>> 0;

function weapon(file, hand) {
  const base = hand ? 0x8017D000 : 0x8017A000;
  const sword = file.subarray(CODE, CODE + LENGTH);
  const before = file.subarray(OVERLAY * SLOT + CODE, (OVERLAY + 1) * SLOT);
  assert.equal(sha(sword), signatures[hand][0], 'Unknown installed sword code.');
  assert.equal(K.u32(sword, 4), base + 0x1800, 'The existing throw must match.');
  assert.equal(sha(before), signatures[hand][1], 'Unknown Heaven Sword code.');
  assert.ok(before.subarray(BANK, END).every(v => v === 0), 'Weapon space is occupied.');
  const after = before.slice();
  const local = off => {
    if (off >= 0x40 && off < 0xA44) return BANK + off - 0x40;
    if (off >= 0xEA4 && off < 0x10BC) return DATA + off - 0xEA4;
    if (off === 0x10D0) return 0x604;
    if (off >= 0x1474 && off < 0x1698) return NORMAL + off - 0x1474;
    throw Error(`Unreviewed sword reference ${off.toString(16)}`);
  };
  // Keep the ordinary slash artwork.
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
  const helpers = new Map([[0x11D8, 0x758], [0x1378, 0x8D0], [0x10D4, 0x62C]]);
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
  [0x948200AE, K.ori(3, ITEM), 0x10430003, 0,
    jump(K.u32(before, 0)), 0, jump(base + NORMAL), 0].forEach((w, n) => K.put32(after, ENTRY + n * 4, w));
  K.put32(after, 0, base + ENTRY);
  // Give the slash its own colors.
  after.set(before.subarray(0x2B0, 0x5B0), PAL);
  assert.ok(Array.from({length: 14}, (_, n) => K.u16(before, 0x5E0 + n * 2)).every(n => n <= 8));
  after.set(sword.subarray(0xC04, 0xCE4), PAL + 14 * 32);
  K.put32(after, TABLE, K.u32(before, 0x5FC));
  K.put32(after, TABLE + 4, base + PAL);
  assert.equal(K.u32(before, 0x6AC), 0x3C018018);
  assert.equal(K.u32(before, 0x6B4), hand ? 0x8C25D5FC : 0x8C25A5FC);
  K.put32(after, 0x6AC, K.withImmediate(K.u32(before, 0x6AC), (base + TABLE + 0x8000) >>> 16));
  K.put32(after, 0x6B4, K.withImmediate(K.u32(before, 0x6B4), (base + TABLE) & 65535));
  const output = file.slice(); output.set(after, OVERLAY * SLOT + CODE);
  for (let y = 0; y < 96; y++) {
    const dst = OVERLAY * SLOT + y * 128 + 64;
    assert.ok(file.subarray(dst, dst + 56).every(v => v === 0), 'Sword artwork space is occupied.');
    output.set(file.subarray(y * 128, y * 128 + 56), dst);
  }
  return output;
}

function prepare(model, weapons) {
  const rows = model.sections.equipRows, item = rows[ITEM], special = rows[SPECIAL], heaven = rows[HEAVEN];
  for (const [key, expected] of [['weaponId', 0], ['wpal', 0], ['unk13', 48], ['specialMove', SPECIAL]])
    assert.equal(model.get(item[key]), expected, `Unsupported Hunting Blade ${key}.`);
  for (const [key, expected] of [['weaponId', 0], ['wpal', 0], ['unk13', 56], ['playerAnim', 93]])
    assert.equal(model.get(special[key]), expected, `Unsupported special ${key}.`);
  assert.deepEqual(M.rowUsers(model, SPECIAL), [ITEM]);
  assert.equal(model.get(heaven.weaponId), OVERLAY);
  assert.equal(model.get(heaven.unk13), 50);
  for (const row of rows) if (model.get(row.weaponId) === OVERLAY)
    assert.equal(model.get(row.wpal), 0, 'Heaven Sword palette choice is already used.');
  const result = weapons.map(weapon);
  model.set(item.weaponId, OVERLAY); model.set(item.wpal, 1);
  model.set(special.weaponId, OVERLAY); model.set(special.wpal, 1); model.set(special.unk13, 50);
  const dra = model.files.DRA.bytes.slice(); M.apply(model, {DRA: dra});
  return {dra, weapons: result};
}

module.exports = {prepare, weapon, ITEM, SPECIAL, HEAVEN, OVERLAY, SLOT, CODE, LENGTH, BANK, DATA, NORMAL, ENTRY, PAL, TABLE, END};
