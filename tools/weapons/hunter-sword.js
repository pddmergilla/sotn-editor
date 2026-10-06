const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');

const HUNTER = 94, SHOTEL = 28, SPECIAL = 169;
const SLOT = 0x7000, CODE = 0x4000, LENGTH = 0x3000;
const ENTRY = 0x1800, THROW = 0x1820, BANK = 0x1D00;
const DONOR_START = 0xF0C, DONOR_END = 0x1388;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const signatures = [
  ['510b29a7e6e61341a639b219b0a77c827d00e8b03daf99f533317175dd83aa4a',
    '102b8b75a4b85d84825aea86363e7436b2564d5f89637f510f21be546c7f628d'],
  ['009de53473abc9d53469038ddc239ab4f165662e9c040db559915c4fbb308c1a',
    '8d67be0e2dd2bf753ee69785f877f802b49f172b2518b1eaa42528b28274eae1']
];
const jump = (address, call = false) => ((call ? 0x0C000000 : 0x08000000) | (address >>> 2 & 0x3FFFFFF)) >>> 0;

function weapon(file, hand) {
  const base = hand ? 0x8017D000 : 0x8017A000;
  const before = file.slice(CODE, CODE + LENGTH);
  const donor = file.slice(34 * SLOT + CODE, 34 * SLOT + CODE + LENGTH);
  assert.equal(sha(before), signatures[hand][0], 'Unknown sword code or occupied padding.');
  assert.equal(sha(donor), signatures[hand][1], 'Unknown Shotel code.');
  assert.equal(K.u32(before, 0x10D0), hand);
  assert.ok(before.subarray(ENTRY, BANK + 0x144).every(v => v === 0));
  const after = before.slice(), body = donor.slice(DONOR_START, DONOR_END);
  const helpers = new Map([[0xA54, 0x11D8], [0xB5C, 0x12E0], [0xBF4, 0x1378],
    [0xB84, 0x1308], [0x950, 0x10D4]]);
  for (let off = 0; off < body.length; off += 4) {
    const w = K.u32(body, off), op = w >>> 26;
    if (op !== 2 && op !== 3) continue;
    const target = K.branchTarget(w, base + DONOR_START + off), local = target - base;
    if (local >= DONOR_START && local < DONOR_END) K.put32(body, off, jump(base + THROW + local - DONOR_START, op === 3));
    else if (helpers.has(local)) K.put32(body, off, jump(base + helpers.get(local), op === 3));
    else assert.ok(target < base || target >= base + LENGTH, 'Unreviewed local Shotel call.');
  }
  const change = (off, expected, word) => {
    assert.equal(K.u32(donor, off), expected >>> 0, `Shotel instruction ${off.toString(16)}`);
    K.put32(body, off - DONOR_START, word);
  };
  change(0xF5C, 0x3C048018, K.lui(4, (base + BANK + 0x8000) >>> 16));
  change(0xF60, hand ? 0x2484D040 : 0x2484A040, K.withImmediate(K.u32(donor, 0xF60), (base + BANK) & 0xFFFF));
  change(0xF6C, 0x3C038018, K.lui(3, (base + 0x10D0 + 0x8000) >>> 16));
  change(0xF70, hand ? 0x8C63D94C : 0x8C63A94C, K.withImmediate(K.u32(donor, 0xF70), (base + 0x10D0) & 0xFFFF));
  change(0xF74, 0x24028010, 0x24028011);
  change(0xFB4, 0x3402003A, 0x34020001);
  after.set(body, THROW);
  const entry = [0x948200AE, K.ori(3, SPECIAL), 0x10430005, 0, 0x03E00008, 0, 0, 0];
  entry.forEach((w, i) => K.put32(after, ENTRY + i * 4, w));
  K.put32(after, 4, base + ENTRY);
  after.set(before.subarray(0x40, 0x184), BANK);
  const output = file.slice(); output.set(after, CODE);
  return output;
}

function prepare(model, weapons) {
  const rows = model.sections.equipRows, hunter = rows[HUNTER], shotel = rows[SHOTEL];
  assert.equal(model.get(hunter.weaponId), 0, 'Hunter Sword must retain its ordinary sword style.');
  assert.equal(model.get(hunter.specialMove), 0, 'Hunter Sword already has a special.');
  assert.equal(model.get(hunter.unk17), 0);
  assert.equal(model.get(hunter.unk11), 1);
  assert.equal(model.get(hunter.playerAnim), 65);
  assert.equal(model.get(shotel.weaponId), 34);
  assert.equal(model.get(shotel.specialMove), 176);
  assert.ok(M.freeSpecialRows(model).some(r => r.index === SPECIAL), 'The private special row is occupied.');
  for (const row of rows) assert.ok(!(model.get(row.weaponId) === 0 && model.get(row.unk13) === 56), 'Another sword already uses the throw entry.');
  const result = weapons.map((file, hand) => weapon(file, hand));
  for (const [id, value] of M.planRowCopy(model, 176, SPECIAL)) model.set(id, value);
  model.set(rows[SPECIAL].weaponId, 0);
  model.set(hunter.specialMove, SPECIAL);
  const dra = model.files.DRA.bytes.slice(); M.apply(model, {DRA: dra});
  return {dra, weapons: result};
}

module.exports = {prepare, weapon, HUNTER, SHOTEL, SPECIAL, SLOT, CODE, LENGTH, ENTRY, THROW, BANK, DONOR_START, DONOR_END};
