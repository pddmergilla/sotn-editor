const assert = require('node:assert/strict');
const K = require('../../stats-core.js');
const spec = require('./specs/damage-colors.json');
const BASE = 0x800A0000, CLUTS = 0x411A0, RESIST = 0x18E, GUARD = 0x1B0;
const PICKER = 0x2EAC0, SPAWN = 0x2EB0C, CAVE = 0x2E300, FLAG = 0x800CE3B0;
// Weak hits: 'ori t0,zero,0x18D' -> 'addiu t0,v0,0x1B0' (v0 holds the flash frame bit).
const WEAK_PICK = 0x2EAD4, WEAK_OLD = 0x3408018D, WEAK_NEW = 0x244801B0;
// The live image changed the weakness multiplier inside the installed cave.
const ARITHMETIC = [0x2E340, 0x2E344];
const rgb = ([r, g, b]) => r | g << 5 | b << 10;
const level = value => Math.max(value & 31, value >>> 5 & 31, value >>> 10 & 31);

// Number glyphs sample entries 2 (outline), 4 (upper fill) and 5 (lower fill).
const GREY = {clut: RESIST, outline: [1, 1, 1], top: [16, 16, 16], bottom: [21, 21, 21], tone: n => Array(3).fill(Math.max(1, Math.round(n * 16 / 31)))};

function palettes(before) {
  const after = before.slice(), start = CLUTS + (RESIST - 0x18D) * 32;
  for (let n = 1; n < 16; n++) {
    const at = start + n * 2, old = K.u16(before, at);
    if (!(old & 0x7FFF)) continue;
    const color = n === 2 ? GREY.outline : n === 4 ? GREY.top : n === 5 ? GREY.bottom : GREY.tone(level(old));
    K.put16(after, at, old & 0x8000 | rgb(color));
  }
  return after;
}

// Weak numbers flash the GUARD colors and resisted numbers turn grey; other number colors stay as loaded.
function prepare(files) {
  const dra = files.get('DRA.BIN'), gfx = files.get('BIN/F_GAME.BIN');
  for (const e of spec.edits) {
    const at = Number(e.offset), want = Buffer.from(e.on, 'hex'), have = Buffer.from(files.get(e.file).subarray(at, at + want.length));
    if (e.file === 'DRA.BIN' && at === CAVE) {
      for (let n = 0; n < want.length; n += 4) if (!ARITHMETIC.includes(at + n)) assert.equal(have.readUInt32LE(n), want.readUInt32LE(n), `Installed flag cave changed at ${(at + n).toString(16)}.`);
    } else assert.deepEqual(have, want, `Damage Number Colors is not installed as expected: ${e.file} ${e.offset}.`);
  }
  assert.equal(K.u32(dra, WEAK_PICK), WEAK_OLD);
  assert.equal(K.u16(gfx, CLUTS + 32), 0);
  // Each stage must hand the picker its frame bit in v0 and keep GUARD at table entries 6 and 7.
  for (const e of spec.edits.filter(e => e.why.startsWith('EntityDamageDisplay palette select'))) {
    const bytes = files.get(e.file), at = Number(e.offset);
    assert.equal(K.u32(bytes, at - 4), 0x30820001, `${e.file} frame bit`);
    assert.equal(K.u32(bytes, at + 8), 0x00621025, `${e.file} table index`);
    assert.equal(K.u32(bytes, at + 16) >>> 16, 0x3C01); assert.equal(K.u32(bytes, at + 24) >>> 16, 0x9428);
    const table = ((K.u32(bytes, at + 16) << 16) + (K.u32(bytes, at + 24) << 16 >> 16) >>> 0) - 0x80180000;
    assert.equal(K.u16(bytes, table + 12), GUARD, `${e.file} GUARD color`); assert.equal(K.u16(bytes, table + 14), GUARD + 1, `${e.file} GUARD flash`);
  }
  const code = dra.slice(); K.put32(code, WEAK_PICK, WEAK_NEW);
  return new Map([['DRA.BIN', code], ['BIN/F_GAME.BIN', palettes(gfx)]]);
}

module.exports = {BASE, CLUTS, RESIST, GUARD, PICKER, SPAWN, FLAG, WEAK_PICK, WEAK_OLD, WEAK_NEW, GREY, rgb, palettes, prepare};
