const assert = require('node:assert/strict');
const D = require('./dark-metamorphosis-scaled.js');
const {BASE, TIMER, STATS, STR, CON, INT, LCK, CON_BONUS} = D;
const STATUS = 0x80090000;
// g_StatBuffTimers 0x80139828: DEF, ATK, LCK, INT, STR (set to 0x1000 by GiveStatBuff for potions and the Faerie).
const TIMERS = {def: 0x80139828, atk: 0x8013982C, lck: 0x80139830, int: 0x80139834, str: 0x80139838};
const ATK_CAP = 9999, DEF_CAP = 999;
const UPDATE_EQUIP = 0x800F4994, CALC_DEFENSE = 0x800F4FD0;
// UpdateEquipStatBonuses `if (timer) statsEquip[n] += 20;` blocks (11 words, vanilla). STR and LCK count once in
// statsTotal, so they are rewritten in place; INT counts four times (total = base + equip * 4), so its +20 becomes +0
// and the epilogue helper adds INT straight to equip and total, like Dark Metamorphosis.
const BLOCKS = [
  {name: 'STR buff', offset: 0x54AFC, timer: TIMERS.str, stat: STR, live: '1480023c3898428c0000000007004010000000000980033cc87b63240000628c0000000014004224000062ac'},
  {name: 'LCK buff', offset: 0x54B54, timer: TIMERS.lck, stat: LCK, live: '1480023c3098428c0000000007004010000000000980033cd47b63240000628c0000000014004224000062ac'}
];
// Flat +20 immediates that become +0: INT (`addiu v0,v0,20`), CalcAttack and CalcDefense (`addiu s0,s0,20`).
const FLAT = [{name: 'INT buff', offset: 0x54B4C, from: 0x24420014, to: 0x24420000},
  {name: 'ATK buff', offset: 0x54EF8, from: 0x26100014, to: 0x26100000}, {name: 'DEF buff', offset: 0x55350, from: 0x26100014, to: 0x26100000}];
// Code: attackBonus stays at 0x800E282C (CalcAttack epilogue hook), defenseBonus follows it, statBonus replaces the
// extension at 0x800E2E98. The old statsBonus entry 0x800E2864 loses its only caller.
const ATTACK = 0x4282C, DEFENSE = 0x4287C, STATS_HELPER = 0x42E98;
const SLOTS = [{name: 'attackBonus + defenseBonus', offset: ATTACK, words: 45}, {name: 'statBonus', offset: STATS_HELPER, words: 31}];
const jr = 0x03E00008;
const j = addr => ((2 << 26) | ((addr >>> 2) & 0x3FFFFFF)) >>> 0, jal = addr => ((3 << 26) | ((addr >>> 2) & 0x3FFFFFF)) >>> 0;
// make_all goes back to vanilla; the function epilogues jump to the helpers instead.
const HOOKS = [
  {name: 'make_all UpdateEquipStatBonuses call', offset: 0x553AC, from: jal(BASE + STATS_HELPER), to: jal(UPDATE_EQUIP)},
  {name: 'make_all CalcDefense call', offset: 0x553BC, from: jal(BASE + 0x42864), to: jal(CALC_DEFENSE)},
  {name: 'UpdateEquipStatBonuses epilogue', offset: 0x54D30, from: jr, to: j(BASE + STATS_HELPER)},
  {name: 'CalcDefense epilogue', offset: 0x5539C, from: jr, to: j(BASE + DEFENSE)}
];

const zero = 0, v0 = 2, v1 = 3, t0 = 8, t1 = 9, t2 = 10, t3 = 11, t4 = 12, t5 = 13, t6 = 14;
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const R = (rs, rt, rd, fn, sa = 0) => ((rs << 21) | (rt << 16) | (rd << 11) | (sa << 6) | fn) >>> 0;
const lui = (rt, imm) => I(15, 0, rt, imm), addiu = (rt, rs, imm) => I(9, rs, rt, imm), slti = (rt, rs, imm) => I(10, rs, rt, imm);
const lh = (rt, imm, rs) => I(33, rs, rt, imm), lw = (rt, imm, rs) => I(35, rs, rt, imm), sw = (rt, imm, rs) => I(43, rs, rt, imm);
const beq = (rs, rt, to) => I(4, rs, rt, to), bne = (rs, rt, to) => I(5, rs, rt, to);
const addu = (rd, rs, rt) => R(rs, rt, rd, 0x21), slt = (rd, rs, rt) => R(rs, rt, rd, 0x2A), sltu = (rd, rs, rt) => R(rs, rt, rd, 0x2B);
const sll = (rd, rt, sa) => R(0, rt, rd, 0, sa), sra = (rd, rt, sa) => R(0, rt, rd, 3, sa);
const mult = (rs, rt) => R(rs, rt, 0, 0x18), mflo = rd => R(0, 0, rd, 0x12);
const NOP = 0;
// hi/lo split for lui + signed 16-bit offset (0x80139838 -> lui 0x8014, -0x67C8).
const stat = (kind, n) => STATS[kind] + n * 4, hi = a => (a + 0x8000) >>> 16, lo = a => a & 0xFFFF;
const words = (list, length = list.length) => {
  assert.ok(list.length <= length, `${list.length} > ${length} words`);
  const bytes = Buffer.alloc(length * 4); list.forEach((w, k) => bytes.writeUInt32LE(w >>> 0, k * 4)); return bytes;
};

// Branch offsets are "target word index minus branch word index minus 1".
function block({timer, stat: n}) { // statsEquip[n] += statsBase[n] / 2 while the buff timer runs.
  return words([lui(v0, hi(timer)), lw(v0, lo(timer), v0), lui(v1, hi(STATUS)), beq(v0, zero, 11 - 3 - 1),
    lw(v0, stat('base', n), v1), lw(v1, stat('equip', n), v1), sra(v0, v0, 1), addu(v0, v1, v0),
    lui(v1, hi(STATUS)), sw(v0, stat('equip', n), v1), NOP]);
}

// Each bonus is half the base stat, counted once for Dark Metamorphosis and once for the matching buff.
function code() {
  assert.equal(CON_BONUS, 2, 'CON uses dm << 1');
  // v0 = CalcAttack result (already capped at 9999 by ASS). Non-zero results get statsBase[STR] / 2 per source.
  const attack = [beq(v0, zero, 18 - 0 - 1), lui(t0, hi(TIMER)), lh(t0, lo(TIMER), t0), lui(t1, hi(TIMERS.atk)),
    lw(t1, lo(TIMERS.atk), t1), lui(t2, hi(STATUS)), lw(t2, stat('base', STR), t2), slt(t0, zero, t0),
    sltu(t1, zero, t1), addu(t0, t0, t1), sra(t2, t2, 1), mult(t2, t0),
    mflo(t1), addu(v0, v0, t1), slti(t0, v0, ATK_CAP + 1), bne(t0, zero, 18 - 15 - 1),
    NOP, addiu(v0, zero, ATK_CAP), jr, NOP];
  // CalcDefense epilogue (v0 = defense, already stored): add statsBase[CON] / 2 per source, cap 999, store again.
  const defense = [lui(t0, hi(TIMER)), lh(t0, lo(TIMER), t0), lui(t1, hi(TIMERS.def)), lw(t1, lo(TIMERS.def), t1),
    lui(t2, hi(STATUS)), lw(t3, stat('base', CON), t2), slt(t0, zero, t0), sltu(t1, zero, t1),
    addu(t0, t0, t1), sra(t3, t3, 1), mult(t3, t0), mflo(t1),
    addu(v0, v0, t1), slti(t1, v0, DEF_CAP + 1), bne(t1, zero, 17 - 14 - 1), NOP,
    addiu(v0, zero, DEF_CAP), jr, sw(v0, STATS.defense, t2)];
  assert.equal(ATTACK + attack.length * 4, DEFENSE);
  // UpdateEquipStatBonuses epilogue: CON += 2 (Dark Metamorphosis), INT += base / 2 per source (DM, INT buff),
  // LCK += base / 2 (DM; the LCK buff is in the block above). Equip and total both, after the CON x8 / INT x4 totals.
  const stats = [lui(t0, hi(TIMER)), lh(t0, lo(TIMER), t0), lui(t1, hi(TIMERS.int)), lw(t6, lo(TIMERS.int), t1),
    lui(t1, hi(STATUS)), slt(t0, zero, t0), sltu(t6, zero, t6), addu(t6, t6, t0),
    lw(t2, stat('equip', CON), t1), lw(t3, stat('total', CON), t1), sll(t4, t0, 1), addu(t2, t2, t4),
    addu(t3, t3, t4), sw(t2, stat('equip', CON), t1), sw(t3, stat('total', CON), t1), addiu(t5, t1, 8),
    lw(t4, stat('base', INT), t1), lw(t2, stat('equip', INT), t1), lw(t3, stat('total', INT), t1), sra(t4, t4, 1),
    mult(t4, t6), mflo(t4), addu(t2, t2, t4), addu(t3, t3, t4),
    sw(t2, stat('equip', INT), t1), sw(t3, stat('total', INT), t1), addiu(t1, t1, 4), bne(t1, t5, 16 - 27 - 1),
    addu(t6, t0, zero), jr, NOP];
  return [words([...attack, ...defense], 45), words(stats, 31)];
}

// Potion/Faerie buffs follow the Dark Metamorphosis formula and stack with it; the image must hold the scaled DM buff.
function prepare(files) {
  const source = files.get('DRA.BIN'), dra = Buffer.from(source.buffer, source.byteOffset, source.length), after = new Uint8Array(source);
  const installed = D.code();
  D.RANGES.forEach((r, n) => assert.equal(Buffer.from(dra.subarray(r.offset, r.offset + r.words * 4)).toString('hex'), installed[n].toString('hex'), `${r.name} is not the scaled Dark Metamorphosis buff`));
  assert.equal(dra.readUInt32LE(0x54F40), j(BASE + ATTACK), 'CalcAttack epilogue hook');
  for (const b of BLOCKS) {
    assert.equal(dra.subarray(b.offset, b.offset + 44).toString('hex'), b.live, `${b.name} block changed`);
    after.set(block(b), b.offset);
  }
  for (const e of [...FLAT, ...HOOKS]) { assert.equal(dra.readUInt32LE(e.offset), e.from, e.name); after.set(words([e.to]), e.offset); }
  code().forEach((bytes, n) => after.set(bytes, SLOTS[n].offset));
  return new Map([['DRA.BIN', after]]);
}

const RANGES = [...BLOCKS.map(b => ({name: b.name, offset: b.offset, length: 44})),
  ...[...FLAT, ...HOOKS].map(e => ({name: e.name, offset: e.offset, length: 4})),
  ...SLOTS.map(s => ({name: s.name, offset: s.offset, length: s.words * 4}))];
module.exports = {BASE, TIMER, STATS, STR, CON, INT, LCK, CON_BONUS, UPDATE_EQUIP, CALC_DEFENSE, TIMERS, ATK_CAP, DEF_CAP,
  ATTACK, DEFENSE, STATS_HELPER, BLOCKS, FLAT, HOOKS, SLOTS, RANGES, code, prepare};
