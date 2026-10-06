const assert = require('node:assert/strict');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');
const BASE = M.DRA_BASE, CAVE = 0x2EC00, HOOK = 0x718B8;
const ORIGINAL = 0x801112AC, CAST = 0x800FDC94, PERFORM = 0x8010FBF4, LEARN = 0x800FDCE0;
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;

function helper() {
  const words = [], labels = new Map(), branches = [];
  const emit = (...values) => words.push(...values);
  const label = name => labels.set(name, words.length);
  const branch = (op, rs, rt, name) => { branches.push([words.length, name]); emit(i(op, rs, rt, 0), 0); };
  emit(i(15, 0, 8, 0x8014), i(37, 8, 9, 0x8FC8), i(13, 0, 10, 255));
  branch(5, 9, 10, 'fallback');
  emit(i(15, 0, 8, 0x8007), i(35, 8, 9, 0x2EEC), 0, i(12, 9, 10, 0x80));
  branch(4, 10, 0, 'otherHand');
  emit(i(15, 0, 10, 0x8009), i(35, 10, 11, 0x7C00), i(13, 0, 12, 123));
  branch(4, 11, 12, 'eligible');
  label('otherHand');
  emit(i(12, 9, 10, 0x20)); branch(4, 10, 0, 'fallback');
  emit(i(15, 0, 10, 0x8009), i(35, 10, 11, 0x7C04), i(13, 0, 12, 123));
  branch(5, 11, 12, 'fallback');
  label('eligible');
  emit(i(37, 8, 9, 0x2F66), 0, i(12, 9, 9, 0x8000)); branch(5, 9, 0, 'fallback');
  emit(i(37, 8, 9, 0x3404), 0, i(11, 9, 9, 2)); branch(4, 9, 0, 'fallback');
  emit(i(9, 29, 29, -24), i(43, 29, 31, 16), jump(CAST, true), i(13, 0, 4, 5));
  branch(4, 2, 0, 'failed');
  emit(jump(PERFORM, true), 0, i(15, 0, 8, 0x8014), i(43, 8, 0, 0x8FC8),
    i(41, 8, 0, 0x8FD8), jump(LEARN, true), i(13, 0, 4, 5),
    i(35, 29, 31, 16), i(9, 29, 29, 24), 0x03E00008, i(13, 0, 2, 1));
  label('failed'); emit(i(35, 29, 31, 16), i(9, 29, 29, 24));
  label('fallback'); emit(jump(ORIGINAL), 0);
  for (const [at, name] of branches) words[at] = K.withImmediate(words[at], labels.get(name) - at - 1);
  const bytes = Buffer.alloc(words.length * 4); words.forEach((w, n) => bytes.writeUInt32LE(w >>> 0, n * 4));
  assert.ok(bytes.length <= 512); return bytes;
}

function prepare(dra) {
  assert.equal(K.u32(dra, HOOK), jump(ORIGINAL, true), 'Unknown Soul Steal dispatch.');
  assert.equal(K.u32(dra, HOOK + 4), 0);
  const code = helper(); assert.ok(dra.subarray(CAVE, CAVE + 512).every(v => v === 0), 'Occupied helper space.');
  const model = M.parse({DRA: {bytes: dra, base: BASE}});
  assert.equal(model.get(model.sections.hand[123].weaponId), 43);
  const items = [...model.sections.equipRows, ...Object.values(model.sections.body).flat()];
  assert.ok(items.every(row => model.get(row.icon) < 304), 'Helper space overlaps an equipped icon.');
  assert.deepEqual(Buffer.from(dra.subarray(0x71488, 0x7151C)), Buffer.from(
    '0780023cec2e428c00000000a00042301c004010211000000780023c662f4294000000000080423016004014211000000780023c04344294000000000200422c100040102110000025f7030c050004340c00401021100000fd3e040c000000001480013cd88f20a438f7030c0500043443450408010002341480013cd88f20a4211000001000bf8f1800bd270800e00300000000', 'hex'), 'Unknown native Soul Steal path.');
  const after = dra.slice(); after.set(code, CAVE); K.put32(after, HOOK, jump(BASE + CAVE, true));
  return after;
}
module.exports = {prepare, helper, BASE, CAVE, HOOK, ORIGINAL, CAST, PERFORM, LEARN, jump};
