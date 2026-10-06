const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');

const STONE = 114, SPECIAL = 211, MEDUSA = 27, SWORD = 37;
const SLOT = 0x7000, CODE = 0x4000, LENGTH = 0x3000;
const BANK = 0x26F0, DATA = 0x2BD0, ANIM = 0x2C78, PAL = 0x2C88;
const NORMAL = 0x2CA8, ENTRY = 0x2F3C, PALETTE = 0x2F64, POSE = 0x2FA0, FRAMES = 0x2FA4;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const signatures = [
  ['766e8eb135e907d0a182a9910f426a0c27b1a48b46c1a067878c6e8d3ea0fb13',
    '76661114d07311b8d0da8df6050af50b305e8fd4ca450754ea0b809fa73bd2da'],
  ['a0ac1f27d30086fa253cc33285788c1e66e91d8996a92860f39766db42b731f8',
    'e8c343d46d2e6e7225097e8ff8f4e770d5d86cb04bd374bf2696a5b5a8b78480']
];
const jump = (address, call = false) => ((call ? 0x0C000000 : 0x08000000) | (address >>> 2 & 0x3FFFFFF)) >>> 0;

function weapon(file, hand) {
  const base = hand ? 0x8017D000 : 0x8017A000;
  const before = file.slice(MEDUSA * SLOT + CODE, (MEDUSA + 1) * SLOT);
  const sword = file.slice(SWORD * SLOT + CODE, (SWORD + 1) * SLOT);
  assert.equal(sha(before), signatures[hand][0], 'Unknown Medusa code or occupied padding.');
  assert.equal(sha(sword), signatures[hand][1], 'Unknown Stone Sword code.');
  assert.ok(before.subarray(BANK).every(v => v === 0));
  const after = before.slice();
  const local = off => {
    if (off >= 0x40 && off < 0x520) return BANK + off - 0x40;
    if (off >= 0x5A4 && off < 0x64C) return DATA + off - 0x5A4;
    if (off === 0x688) return FRAMES;
    if (off === 0x6A4) return ANIM - 3 * 16;
    if (off === 0x7C0) return 0xCC8;
    if (off === 0xBBE4) return POSE;
    if (off >= 0xB64 && off < 0xDF8) return NORMAL + off - 0xB64;
    throw Error(`Unreviewed sword reference ${off.toString(16)}`);
  };
  after.set(sword.subarray(0x40, 0x520), BANK);
  for (let off = BANK; off < BANK + 39 * 4; off += 4) {
    const ptr = K.u32(after, off);
    if (ptr) K.put32(after, off, base + local(ptr - base));
  }
  for (let frame = 1; frame < 39; frame++) {
    const ptr = K.u32(after, BANK + frame * 4) - base;
    assert.equal(K.u16(after, ptr), 1);
    for (const off of [16, 20]) K.put16(after, ptr + off, K.u16(after, ptr + off) + 128);
    for (const off of [18, 22]) K.put16(after, ptr + off, K.u16(after, ptr + off) + 80);
  }
  after.set(sword.subarray(0x5A4, 0x64C), DATA);
  after.set(sword.subarray(0x688, 0x6A4), FRAMES);
  for (let off = FRAMES; off < FRAMES + 28; off += 4) K.put32(after, off, base + local(K.u32(after, off) - base));
  after.set(sword.subarray(0x6D4, 0x6E4), ANIM);
  for (const off of [0, 4]) K.put32(after, ANIM + off, base + local(K.u32(after, ANIM + off) - base));
  after.set(sword.subarray(0x504, 0x524), PAL);
  const body = sword.slice(0xB64, 0xDF8);
  const helpers = new Map([[0x8C8, 0xE80], [0xA68, 0xFF4], [0x7C4, 0xD54]]);
  for (let off = 0; off < body.length; off += 4) {
    const word = K.u32(body, off), op = word >>> 26;
    if (op === 2 || op === 3) {
      const target = K.branchTarget(word, base + 0xB64 + off) - base;
      assert.ok(helpers.has(target) || target >= 0xB64 && target < 0xDF8);
      K.put32(body, off, jump(base + (helpers.get(target) ?? local(target)), op === 3));
    }
  }
  for (const [hi, lo, target] of [[0xBB0, 0xBB4, 0x6A4], [0xC0C, 0xC10, 0x40],
    [0xC1C, 0xC20, 0x7C0], [0xD38, 0xD3C, 0xBBE4], [0xD74, 0xD78, 0x7C0], [0xDB0, 0xDB4, 0xBBE4]]) {
    const addr = base + local(target);
    K.put32(body, hi - 0xB64, K.withImmediate(K.u32(body, hi - 0xB64), (addr + 0x8000) >>> 16));
    K.put32(body, lo - 0xB64, K.withImmediate(K.u32(body, lo - 0xB64), addr & 65535));
  }
  assert.equal(K.u32(body, 0xC24 - 0xB64), 0x24028010);
  assert.equal(K.u32(body, 0xC2C - 0xB64), 0x34020110);
  K.put32(body, 0xC24 - 0xB64, 0x24028011);
  K.put32(body, 0xC2C - 0xB64, 0x34020124);
  after.set(body, NORMAL);
  const entry = [0x948200AE, 0x34030072, 0x10430003, 0,
    jump(K.u32(before, 0)), 0, jump(base + NORMAL), 0];
  entry.forEach((w, i) => K.put32(after, ENTRY + i * 4, w));
  K.put32(after, 0, base + ENTRY);
  const palette = [0x2488FEC0, 0x2D090010, 0x11200007, 0x00084040,
    K.lui(9, (base + PAL + 0x8000) >>> 16), 0x25290000 | ((base + PAL) & 65535),
    0x01094021, 0x95020000, jump(base + 0xE08), 0x24A50002,
    0x94A20000, jump(base + 0xE08), 0x24A50002];
  palette.forEach((w, i) => K.put32(after, PALETTE + i * 4, w));
  assert.equal(K.u32(before, 0xE00), 0x94A20000);
  assert.equal(K.u32(before, 0xE04), 0x24A50002);
  K.put32(after, 0xE00, jump(base + PALETTE)); K.put32(after, 0xE04, 0);
  const output = file.slice(); output.set(after, MEDUSA * SLOT + CODE);
  for (let y = 0; y < 40; y++) {
    const dst = MEDUSA * SLOT + (y + 80) * 128 + 64;
    assert.ok(file.subarray(dst, dst + 60).every(v => v === 0), 'Medusa artwork space is occupied.');
    output.set(file.subarray(SWORD * SLOT + y * 128, SWORD * SLOT + y * 128 + 60), dst);
  }
  return output;
}

function prepare(model, weapons) {
  const stone = model.sections.hand[STONE], spell = model.sections.equipRows[SPECIAL];
  for (const [key, expected] of [['weaponId', SWORD], ['specialMove', 0], ['unk14', 3], ['wpal', 0], ['unk11', 15]])
    assert.equal(model.get(stone[key]), expected, `Unsupported Stone Sword ${key}.`);
  assert.equal(model.get(spell.weaponId), MEDUSA);
  assert.equal(model.get(spell.unk13), 86);
  const result = weapons.map(weapon);
  model.set(stone.weaponId, MEDUSA); model.set(stone.specialMove, SPECIAL);
  const dra = model.files.DRA.bytes.slice(); M.apply(model, {DRA: dra});
  return {dra, weapons: result};
}

module.exports = {prepare, weapon, STONE, SPECIAL, MEDUSA, SWORD, SLOT, CODE, LENGTH, BANK, DATA, ANIM, PAL, NORMAL, ENTRY, PALETTE, POSE, FRAMES};
