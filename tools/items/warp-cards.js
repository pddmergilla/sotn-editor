const assert = require('node:assert/strict');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
const BASE = M.DRA_BASE, CAVE = 0x2EF00, END = 0x2F020;
const ACTIVATE = CAVE, TRANSITION = CAVE + 0x50, SELECT = CAVE + 0xA0;
const TABLE = 0x245C, SCORPION_RECORD = 0x2EFF2, NOIL_RECORD = SCORPION_RECORD + 10, PENDING = 0x2F010;
const SCORPION_INDEX = (SCORPION_RECORD - TABLE) / 10, NOIL_INDEX = SCORPION_INDEX + 1;
const HOOK = 0x6F26C, TRANSITION_HOOK = 0x532B8, SELECT_HOOK = 0x51720;
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const r = (rs, rt, rd, fn, shift = 0) => ((rs << 21) | (rt << 16) | (rd << 11) | (shift << 6) | fn) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;
function assemble(start, build) {
  const words = [], labels = new Map(), branches = [];
  const emit = (...w) => words.push(...w), label = n => labels.set(n, words.length);
  const branch = (op, rs, rt, n) => { branches.push([words.length, n]); emit(i(op, rs, rt, 0), 0); };
  build({emit, label, branch});
  for (const [at, n] of branches) words[at] = K.withImmediate(words[at], labels.get(n) - at - 1);
  const b = Buffer.alloc(words.length * 4); words.forEach((w, n) => b.writeUInt32LE(w, n * 4));
  return {start, bytes: b};
}
function helpers() {
  const address = BASE + PENDING, hi = (address + 0x8000) >>> 16, lo = address & 65535;
  return [
    assemble(ACTIVATE, ({emit, label, branch}) => {
      emit(i(12, 19, 8, 65535), i(13, 0, 9, 27), i(13, 0, 10, 0));
      branch(4, 8, 9, 'noil');
      emit(i(13, 0, 9, 166)); branch(5, 8, 9, 'store');
      emit(i(13, 0, 10, SCORPION_INDEX)); branch(4, 0, 0, 'store');
      label('noil'); emit(i(13, 0, 10, NOIL_INDEX));
      label('store'); emit(i(15, 0, 8, hi), i(43, 8, 10, lo), jump(0x800FD39C), 0);
    }),
    assemble(TRANSITION, ({emit, label, branch}) => {
      emit(i(15, 0, 8, hi), i(35, 8, 2, lo), 0); branch(4, 2, 0, 'original');
      emit(r(0, 2, 9, 0, 2), r(9, 2, 9, 0x21), r(0, 9, 9, 0, 1),
        i(15, 0, 8, 0x800A), r(8, 9, 8, 0x21), i(37, 8, 9, TABLE + 8),
        i(15, 0, 8, 0x8009), i(43, 8, 9, 0x74A0), jump(BASE + 0x533E0), 0);
      label('original'); emit(jump(BASE + 0x51424), i(13, 0, 2, 39));
    }),
    assemble(SELECT, ({emit, label, branch}) => {
      emit(i(13, 0, 8, 6)); branch(5, 3, 8, 'original');
      emit(i(15, 0, 8, hi), i(35, 8, 9, lo), 0); branch(4, 9, 0, 'return');
      emit(i(15, 0, 2, 0x8009), i(35, 2, 2, 0x74A0), 0);
      label('return'); emit(0x03E00008, 0);
      label('original'); emit(jump(BASE + 0x51728), 0);
    })
  ];
}
function prepare(dra) {
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  assert.equal(m.get(m.sections.hand[27].name), 'Takemitsu');
  assert.equal(m.get(m.sections.hand[166].name), 'Library card');
  assert.equal(m.get(m.sections.hand[166].consumable), 0);
  assert.equal(K.u32(dra, HOOK), jump(0x800FD39C, true));
  assert.equal(K.u32(dra, HOOK + 4), 0x00002021);
  assert.equal(K.u32(dra, TRANSITION_HOOK), jump(BASE + 0x51424));
  assert.equal(K.u32(dra, TRANSITION_HOOK + 4), 0x34020027);
  assert.equal(K.u32(dra, SELECT_HOOK), 0x10620011);
  assert.equal(K.u32(dra, SELECT_HOOK + 4), 0x34020002);
  assert.ok(dra.subarray(CAVE, END).every(v => v === 0), 'Card helper space is occupied.');
  const items = [...m.sections.equipRows, ...Object.values(m.sections.body).flat()];
  assert.ok(items.every(row => m.get(row.icon) < 311), 'An equipment icon uses card helper space.');
  for (let off = 0; off + 4 <= dra.length; off += 4) {
    const value = K.u32(dra, off);
    assert.ok(!(value >= BASE + CAVE && value < BASE + END), 'An existing pointer uses card helper space.');
    if (off >= 0x42398 && off < 0x962A8) {
      const target = K.branchTarget(value, BASE + off);
      assert.ok(!(target >= BASE + CAVE && target < BASE + END), 'Existing code uses card helper space.');
    }
  }
  const after = new Uint8Array(dra);
  for (const {start, bytes} of helpers()) after.set(bytes, start);
  assert.ok(helpers()[0].bytes.length <= TRANSITION - ACTIVATE);
  assert.ok(helpers()[1].bytes.length <= SELECT - TRANSITION);
  assert.ok(SELECT + helpers()[2].bytes.length <= SCORPION_RECORD);
  for (const [off, values] of [[SCORPION_RECORD, [192, 132, 16, 0, 11]], [NOIL_RECORD, [192, 132, 0, 0, 43]]])
    values.forEach((v, n) => K.put16(after, off + n * 2, v));
  K.put32(after, HOOK, jump(BASE + ACTIVATE, true));
  K.put32(after, TRANSITION_HOOK, jump(BASE + TRANSITION));
  K.put32(after, SELECT_HOOK, jump(BASE + SELECT));
  const noil = m.tables.equip + 27 * 52, scorpion = m.tables.equip + 166 * 52;
  after.set(dra.subarray(scorpion + 8, scorpion + 52), noil + 8);
  function text(field, value) {
    const f = m.field(field), b = f.encoding === 'font' ? K.encodeFont(value) : K.encodeSjis(value);
    assert.ok(b.length <= f.capacity); assert.equal(f.usedBy.length, 1);
    after.fill(0, f.off, f.off + f.capacity); after.set(b, f.off);
  }
  text(m.sections.hand[166].name, 'Scorpion Card'); text(m.sections.hand[166].desc, 'Warp to Outer Wall - reusable');
  text(m.sections.hand[27].name, 'noiL Card'); text(m.sections.hand[27].desc, 'Reverse Keep warp; reusable');
  return require('./warp-card-graphics.js').install(after);
}
module.exports = {prepare, helpers, BASE, CAVE, END, TABLE, PENDING, ACTIVATE, TRANSITION, SELECT,
  SCORPION_RECORD, NOIL_RECORD, SCORPION_INDEX, NOIL_INDEX, HOOK, TRANSITION_HOOK, SELECT_HOOK, jump};
