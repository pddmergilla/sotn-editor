const assert = require('node:assert/strict');
const BASE = 0x800A0000, TIMER = 0x80072F16, STATUS = 0x80090000;
// g_Status: statsBase 0x80097BB8, statsEquip 0x80097BC8, statsTotal 0x80097BD8 (STR, CON, INT, LCK), defenseEquip 0x80097C24.
const STATS = {base: 0x7BB8, equip: 0x7BC8, total: 0x7BD8, defense: 0x7C24}, STR = 0, CON = 1, INT = 2, LCK = 3;
const CON_BONUS = 2, CAP = 999;
const CALC_DEFENSE = 0x800F4FD0, UPDATE_EQUIP = 0x800F4994;
// Installed Dark Metamorphosis stat buff (+25 ATK/INT/DEF, cap 999; helper STR +0, CON +3, LCK +0).
// Entry points stay put: attackBonus 0x800E282C, statsBonus 0x800E2864, extension 0x800E2E98.
const RANGES = [
  {name: 'attackBonus', offset: 0x4282C, words: 14, live: '0b004010000000000780083c162f088500000000060000190000000019004224e80348280200001500000000e70302240800e00300000000'},
  {name: 'statsBonus', offset: 0x42864, words: 31, live: 'f0ffbd270c00bfaff4d3030c000000000780083c162f08850000000012000019000000000980093cd07b2a8d0000000019004a25d07b2aade07b2a8d0000000019004a25e07b2aad247c2a8d0000000019004a25e8034b290200601500000000e7030a24247c2aad0c00bf8f000000001000bd270800e00300000000'},
  {name: 'extension', offset: 0x42E98, words: 31, live: 'e8ffbd271000bfaf65d2030c000000000780083c162f088500000000130000190980093cc87b2a8dd87b2b8d00004a2500006b25c87b2aadd87b2badcc7b2a8ddc7b2b8d03004a2503006b25cc7b2aaddc7b2badd47b2a8de47b2b8d00004a2500006b25d47b2aade47b2bad1000bf8f1800bd270800e00300000000'}
];
// Hook words that must still point at the entry points above.
const HOOKS = [[0x54F40, 0x08038A0B], [0x553AC, 0x0C038BA6], [0x553BC, 0x0C038A19]];

const zero = 0, v0 = 2, t0 = 8, t1 = 9, t2 = 10, t3 = 11, t4 = 12, sp = 29, ra = 31;
const I = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 0xFFFF)) >>> 0;
const lui = (rt, imm) => I(15, 0, rt, imm), addiu = (rt, rs, imm) => I(9, rs, rt, imm), slti = (rt, rs, imm) => I(10, rs, rt, imm);
const lh = (rt, imm, rs) => I(33, rs, rt, imm), lw = (rt, imm, rs) => I(35, rs, rt, imm), sw = (rt, imm, rs) => I(43, rs, rt, imm);
const beq = (rs, rt, to) => I(4, rs, rt, to), bne = (rs, rt, to) => I(5, rs, rt, to), blez = (rs, to) => I(6, rs, 0, to);
const addu = (rd, rs, rt) => ((rs << 21) | (rt << 16) | (rd << 11) | 0x21) >>> 0;
const sra = (rd, rt, sa) => ((rt << 16) | (rd << 11) | (sa << 6) | 3) >>> 0;
const jal = addr => ((3 << 26) | ((addr >>> 2) & 0x3FFFFFF)) >>> 0;
const JR_RA = 0x03E00008, NOP = 0;
const stat = (kind, n) => STATS[kind] + n * 4;

// Branch offsets are written as "word index of target minus word index of the branch minus 1".
function code() {
  const attack = [ // v0 = CalcAttack result; adds statsBase[STR] / 2 while the spell timer runs.
    beq(v0, zero, 12 - 0 - 1), lui(t0, TIMER >>> 16), lh(t0, TIMER & 0xFFFF, t0), lui(t1, STATUS >>> 16),
    lw(t1, stat('base', STR), t1), blez(t0, 12 - 5 - 1), sra(t1, t1, 1), addu(v0, v0, t1),
    slti(t0, v0, CAP + 1), bne(t0, zero, 12 - 9 - 1), NOP, addiu(v0, zero, CAP),
    JR_RA, NOP];
  const stats = [ // CalcDefense, then INT += statsBase[INT] / 2 (shown and effective), DEF += statsBase[CON] / 2.
    addiu(sp, sp, -16), sw(ra, 12, sp), jal(CALC_DEFENSE), NOP,
    lui(t0, TIMER >>> 16), lh(t0, TIMER & 0xFFFF, t0), lui(t1, STATUS >>> 16), lw(t2, stat('base', INT), t1),
    blez(t0, 25 - 8 - 1), lw(t3, stat('equip', INT), t1), sra(t2, t2, 1), lw(t4, stat('total', INT), t1),
    addu(t3, t3, t2), sw(t3, stat('equip', INT), t1), addu(t4, t4, t2), sw(t4, stat('total', INT), t1),
    lw(t2, stat('base', CON), t1), lw(t3, STATS.defense, t1), sra(t2, t2, 1), addu(t2, t3, t2),
    slti(t3, t2, CAP + 1), bne(t3, zero, 24 - 21 - 1), NOP, addiu(t2, zero, CAP),
    sw(t2, STATS.defense, t1), lw(ra, 12, sp), NOP, addiu(sp, sp, 16), JR_RA, NOP];
  const extension = [ // UpdateEquipStatBonuses, then CON += 2 and LCK += statsBase[LCK] / 2 (equip and total).
    addiu(sp, sp, -24), sw(ra, 16, sp), jal(UPDATE_EQUIP), NOP,
    lui(t0, TIMER >>> 16), lh(t0, TIMER & 0xFFFF, t0), lui(t1, STATUS >>> 16), lw(t4, stat('base', LCK), t1),
    blez(t0, 22 - 8 - 1), lw(t2, stat('equip', CON), t1), lw(t3, stat('total', CON), t1), addiu(t2, t2, CON_BONUS),
    addiu(t3, t3, CON_BONUS), sw(t2, stat('equip', CON), t1), sw(t3, stat('total', CON), t1), sra(t4, t4, 1),
    lw(t2, stat('equip', LCK), t1), lw(t3, stat('total', LCK), t1), addu(t2, t2, t4), addu(t3, t3, t4),
    sw(t2, stat('equip', LCK), t1), sw(t3, stat('total', LCK), t1), lw(ra, 16, sp), addiu(sp, sp, 24),
    JR_RA, NOP];
  return [attack, stats, extension].map((words, n) => {
    assert.ok(words.length <= RANGES[n].words, RANGES[n].name);
    const bytes = Buffer.alloc(RANGES[n].words * 4);
    words.forEach((w, k) => bytes.writeUInt32LE(w, k * 4));
    return bytes;
  });
}

// Replace the fixed buff with stat-scaled bonuses; only the hack's own code bodies change.
function prepare(files) {
  const source = files.get('DRA.BIN'), dra = Buffer.from(source.buffer, source.byteOffset, source.length), after = new Uint8Array(source);
  for (const [offset, word] of HOOKS) assert.equal(dra.readUInt32LE(offset), word, `Dark Metamorphosis hook at 0x${offset.toString(16)}`);
  code().forEach((bytes, n) => {
    const {offset, live, name} = RANGES[n];
    assert.equal(Buffer.from(dra.subarray(offset, offset + bytes.length)).toString('hex'), live, `${name} is not the installed +25 buff`);
    after.set(bytes, offset);
  });
  return new Map([['DRA.BIN', after]]);
}

module.exports = {BASE, TIMER, STATS, STR, CON, INT, LCK, CON_BONUS, CAP, CALC_DEFENSE, UPDATE_EQUIP, RANGES, HOOKS, code, prepare};
