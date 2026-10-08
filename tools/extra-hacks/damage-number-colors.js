const assert = require('node:assert/strict');
const M = require('../../stats-model.js');
const K = require('../../stats-core.js');
const spec = require('./specs/damage-colors.json');
const BASE = M.DRA_BASE, HOOK = 0x5F204, CAVE = 0x2EB28, LIMIT = 0x2EB80;
const words = values => { const b = Buffer.alloc(values.length * 4); values.forEach((v, n) => b.writeUInt32LE(v >>> 0, n * 4)); return b; };
const jump = address => (0x08000000 | (address >>> 2 & 0x3FFFFFF)) >>> 0;

// Remember this hit's color.
const affinity = () => words([
  0x3C08800D, 0xA100E3B0, 0x96820010, 0,
  0x00A21024, 0x00621024, 0x14620003, 0,
  0x34090002, 0xA109E3B0,
  0x9682000E, 0, 0x00C21024, 0x10400003, 0,
  0x34090001, 0xA109E3B0,
  0x96820012, jump(BASE + HOOK + 8), 0
]);

// Color damage and healing alike.
const picker = () => words([
  0x30630006, 0x340A0006, 0x106A000E, 0x92090086,
  0, 0x3408018D, 0x340A0001, 0x152A0003, 0,
  0x10000005, 0,
  0x3408018E, 0x340A0002, 0x152A0003, 0,
  0x03E00008, 0x27FF0014, 0x03E00008, 0
]);

function palettes(before) {
  const after = before.slice();
  for (let n = 0; n < 32; n++) {
    const at = 0x411A0 + n * 2, old = K.u16(before, at);
    if (n % 16 === 0) continue;
    const r = old & 31, g = old >>> 5 & 31, b = old >>> 10 & 31;
    const level = n < 16 ? Math.max(r, g, b) : Math.max(1, Math.round(Math.max(r, g, b) * 18 / 31));
    const value = n < 16 ? level : level | level << 5 | level << 10;
    K.put16(after, at, (old & 0x8000) | value);
  }
  return after;
}

function prepare(files) {
  const dra = files.get('DRA.BIN'), gfx = files.get('BIN/F_GAME.BIN');
  assert.equal(K.u32(dra, HOOK), 0x96820012);
  assert.equal(K.u32(dra, HOOK + 4), 0x00C51824);
  assert.equal(K.u32(dra, 0x5F248), 0x080338C0);
  const originalPicker = Buffer.from(spec.edits.find(e => e.file === 'DRA.BIN' && Number(e.offset) === 0x2EAC0).on, 'hex');
  assert.deepEqual(Buffer.from(dra.subarray(0x2EAC0, 0x2EB24)), originalPicker);
  assert.ok(dra.subarray(0x2EB24, LIMIT).every(v => v === 0), 'Color space is occupied.');
  const model = M.parse({DRA: {bytes: dra, base: BASE}});
  const firstIcon = Math.floor((CAVE - 0x25324) / 128);
  assert.ok([...model.sections.equipRows, ...Object.values(model.sections.body).flat()].every(row => model.get(row.icon) < firstIcon), 'Equipment uses this space.');
  for (const [file, data] of files) {
    if (file === 'BIN/F_GAME.BIN') continue;
    const base = file === 'DRA.BIN' ? BASE : 0x80180000;
    for (let at = 0; at + 4 <= data.length; at += 4) {
      const w = K.u32(data, at), op = w >>> 26;
      const addr = op === 2 || op === 3 ? K.branchTarget(w, base + at) : w;
      assert.ok(addr < BASE + CAVE || addr >= BASE + LIMIT, `Existing reference in ${file} at ${at.toString(16)}.`);
      if (op === 15 && (w & 65535) === 0x800D) {
        const reg = w >>> 16 & 31;
        for (let next = at + 4; next < Math.min(at + 20, data.length - 3); next += 4) {
          const use = K.u32(data, next), kind = use >>> 26;
          if ((use >>> 21 & 31) === reg && [9, 13].includes(kind)) {
            const address = (0x800D0000 + (kind === 9 ? use << 16 >> 16 : use & 65535)) >>> 0;
            assert.ok(address < BASE + CAVE || address >= BASE + LIMIT, `Existing address in ${file}.`);
          }
        }
      }
    }
  }
  for (const e of spec.edits.filter(e => !['DRA.BIN', 'BIN/F_GAME.BIN'].includes(e.file))) {
    assert.deepEqual(Buffer.from(files.get(e.file).subarray(Number(e.offset), Number(e.offset) + e.on.length / 2)), Buffer.from(e.on, 'hex'), `${e.file} ${e.offset}`);
  }
  assert.deepEqual(Buffer.from(gfx.subarray(0x411A2, 0x411E0)), Buffer.from(spec.edits.find(e => e.file === 'BIN/F_GAME.BIN').on, 'hex'));
  const after = dra.slice();
  assert.ok(CAVE + affinity().length <= LIMIT);
  after.set(affinity(), CAVE); after.set(picker(), 0x2EAC0);
  K.put32(after, HOOK, jump(BASE + CAVE));
  return new Map([['DRA.BIN', after], ['BIN/F_GAME.BIN', palettes(gfx)]]);
}

module.exports = {BASE, HOOK, CAVE, LIMIT, affinity, picker, palettes, prepare};
