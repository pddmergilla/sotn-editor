const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const C = require('../sotn-core.js');
const M = require('../stats-model.js');
const H = require('../tools/menu/element-line.js');
const {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';

function expected(weak, resist, immune, absorb) {
  const strong = immune | absorb, r = (resist & ~weak) | strong;
  const w = weak & ~(resist | strong);
  for (const separator of [' ', '']) {
    const list = mask => H.ELEMENTS.filter(e => e[0] & mask).map(e => e[1]).join(separator) || '-';
    const text = `RES:${list(r)} WEAK:${list(w)}`;
    if (text.length <= 44) return text;
  }
  throw Error('The element line is too wide.');
}

function verifyInstructions(after) {
  const chars = [], hooks = new Map();
  hooks.set(0x800F678C, regs => {
    chars.push({ch: String.fromCharCode((regs[4] & 255) + 32), x: regs[5], y: regs[6], ctx: regs[7] >>> 0});
    for (const reg of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25]) regs[reg] = 0x76543210;
  });
  hooks.set(0x800F53D4, () => {});
  const m = machine([{base: H.BASE, bytes: after}], hooks), stack = 0x801FEE00;
  function run(weak, resist, immune, absorb, ctx = H.BG) {
    chars.length = 0;
    [weak, resist, immune, absorb].forEach((mask, n) => m.put(0x80097C28 + n * 2, 2, mask));
    for (let reg = 16; reg <= 21; reg++) m.put(stack + 24 + (reg - 16) * 4, 4, 0x12345000 + reg);
    m.put(stack + 48, 4, -1);
    const result = m.run(H.BASE + H.HOOK, {18: ctx, 29: stack});
    assert.equal(result[29] >>> 0, stack + 56);
    assert.equal(result[31], -1);
    for (let reg = 16; reg <= 21; reg++) assert.equal(result[reg], 0x12345000 + reg, `Saved register ${reg}.`);
    [weak, resist, immune, absorb].forEach((mask, n) => assert.equal(m.get(0x80097C28 + n * 2, 2), mask));
    if (ctx !== H.BG) { assert.equal(chars.length, 0); return ''; }
    const text = chars.map(c => c.ch).join(''); assert.equal(text, expected(weak, resist, immune, absorb));
    assert.ok(chars.length <= 44);
    chars.forEach((c, n) => assert.deepEqual(c, {ch: text[n], x: H.X + n * 8, y: H.Y, ctx: H.BG}));
    assert.ok(H.X + chars.length * 8 <= 360 - 0);
    assert.equal(H.Y, 216); assert.ok(H.Y + 8 <= 224);
    return text;
  }
  assert.equal(run(0, 0, 0, 0), 'RES:- WEAK:-');
  assert.equal(run(0x2000, 0x8000, 0, 0), 'RES:FLA WEAK:ICE');
  assert.equal(run(0x8000, 0x8000, 0, 0), 'RES:- WEAK:-');
  assert.equal(run(0x8000, 0, 0x8000, 0), 'RES:FLA WEAK:-');
  assert.equal(run(0x8000, 0, 0, 0x8000), 'RES:FLA WEAK:-');
  assert.equal(run(0, 0xA000, 0x0300, 0), 'RES:FLA ICE CUR STN WEAK:-');
  assert.equal(run(0, 0x5800, 0, 0), 'RES:LIT HOL DAR WEAK:-');
  assert.equal(run(0, 0xFFE0, 0, 0), 'RES:FLAICELITHOLDARWTRPSNCURSTNHITCUT WEAK:-');
  for (const [mask] of H.ELEMENTS) for (const field of [0, 1, 2, 3]) {
    const masks = [0, 0, 0, 0]; masks[field] = mask; run(...masks);
  }
  for (let subset = 0; subset < 2048; subset++) {
    const mask = H.ELEMENTS.reduce((value, e, n) => value | (subset & 1 << n ? e[0] : 0), 0);
    run(0, mask, 0, 0); run(mask, 0, 0, 0); run(mask, 0xFFE0 ^ mask, 0, 0);
  }
  let seed = 12345678;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed & 65535; };
  for (let n = 0; n < 500; n++) run(rand(), rand(), rand(), rand());
  run(31, 31, 31, 31); run(0, 0, 0, 0, H.BG + 30); run(0, 0xFFE0, 0, 0, H.BG + 60);
  return {run, cases: 6702};
}

function verifyEquipment(dra, line) {
  const model = M.parse({DRA: {bytes: dra, base: H.BASE}}), hooks = new Map();
  hooks.set(0x800FD7C0, regs => {
    const slots = regs[5] === 0 ? [0, 1] : regs[5] === 1 ? [2] : regs[5] === 2 ? [3] : regs[5] === 3 ? [4] : [5, 6];
    regs[2] = slots.filter(slot => m.get(0x80097C00 + slot * 4, 4) === regs[4]).length;
  });
  hooks.set(0x80016EEC, regs => { regs[2] = 4; });
  const m = machine([{base: H.BASE, bytes: dra}], hooks);
  const head = model.sections.body.head[0], armor = model.sections.body.armor[0], cape = model.sections.body.cloak[0], accessory = model.sections.body.accessory[0];
  const rows = [head, armor, cape, accessory, accessory];
  rows.forEach((row, n) => {
    m.put(0x80097C08 + n * 4, 4, row.index);
    for (const key of ['weak', 'resist', 'immune', 'absorb']) {
      const field = model.fields.get(row[key]);
      m.put(H.BASE + field.off, 2, 0);
    }
  });
  const masks = () => {
    m.run(H.BASE + 0x54FD0);
    const values = [0, 1, 2, 3].map(n => m.get(0x80097C28 + n * 2, 2));
    return {values, text: line.run(...values)};
  };
  const buffs = [[5, 0x8000, 1], [6, 0x2000, 1], [7, 0x4000, 1], [8, 0x0100, 1], [9, 0x1000, 1], [10, 0x0200, 2], [11, 0x0800, 1]];
  assert.equal(masks().text, 'RES:- WEAK:-');
  for (const [index, mask, field] of buffs) {
    m.put(0x80139828 + index * 4, 4, 4096);
    const v = [0, 0, 0, 0]; v[field] = mask; assert.deepEqual(masks().values, v);
    m.put(0x80139828 + index * 4, 4, 0); assert.equal(masks().text, 'RES:- WEAK:-');
  }
  for (const [index] of buffs) m.put(0x80139828 + index * 4, 4, 1);
  assert.deepEqual(masks().values, [0, 0xF900, 0x0200, 0]);
  for (const [index] of buffs) m.put(0x80139828 + index * 4, 4, 0);
  m.put(0x80097C00, 4, 13); assert.deepEqual(masks().values, [0, 0, 0x0200, 0]);
  m.put(0x80097C00, 4, 15); assert.deepEqual(masks().values, [0, 0, 0x8000, 0]);
  m.put(0x80097C00, 4, 0); m.put(0x8009797D, 1, 2); assert.deepEqual(masks().values, [0, 0, 0x0100, 0]);
  m.put(0x8009797D, 1, 0);
  for (const [n, key, value] of [[0, 'weak', 0x2000], [1, 'resist', 0x8000], [2, 'immune', 0x0080], [3, 'absorb', 0x4000]]) {
    const field = model.fields.get(rows[n][key]);
    m.put(H.BASE + field.off, 2, value);
  }
  assert.deepEqual(masks().values, [0x2000, 0x8000, 0x0080, 0x4000]);
  assert.equal(masks().text, 'RES:FLA LIT PSN WEAK:ICE');
}

function verifyMenuRefresh(dra, after) {
  function draw(bytes, dialog, values) {
    const calls = [], hooks = new Map(); let refreshed = false;
    hooks.set(0x800F53A4, () => {
      refreshed = true;
      values.forEach((mask, n) => m.put(0x80097C28 + n * 2, 2, mask));
    });
    for (const addr of [0x800F622C, 0x800F68F4, 0x800F678C, 0x800F6998]) hooks.set(addr, regs => calls.push([addr, regs[4], regs[5], regs[6], regs[7]]));
    hooks.set(0x800F4944, regs => { regs[2] = 0; });
    hooks.set(H.DRAW_TEXT, regs => {
      assert.equal(refreshed, true);
      const text = [];
      for (let n = 0; n < 256; n++) {
        const value = m.get((regs[4] + n) >>> 0, 1) & 255;
        if (value === 255 && (m.get((regs[4] + n + 1) >>> 0, 1) & 255) === 0) break;
        text.push(value);
      }
      assert.ok(text.length < 256);
      calls.push([H.DRAW_TEXT, Buffer.from(text).toString('hex'), regs[5], regs[6], regs[7]]);
    });
    const m = machine([{base: H.BASE, bytes}], hooks), initial = {4: dialog};
    for (let reg = 16; reg <= 23; reg++) initial[reg] = 0x54321000 + reg;
    const result = m.run(H.BASE + H.DRAW_STATS, initial);
    assert.equal(refreshed, true);
    assert.equal(result[29] >>> 0, 0x801FF000);
    for (let reg = 16; reg <= 23; reg++) assert.equal(result[reg], initial[reg]);
    return calls;
  }
  for (const dialog of [1, 2]) for (const values of [[0, 0, 0, 0], [0x2000, 0x8000, 0x0100, 0x4000], [0xFFE0, 0, 0, 0]]) {
    const original = draw(dra, dialog, values), patched = draw(after, dialog, values);
    if (dialog === 2) assert.deepEqual(patched, original);
    else {
      assert.deepEqual(patched.slice(0, -1), original);
      const gold = original.find(call => call[0] === H.DRAW_TEXT && call[1] === '272f2c24');
      assert.ok(gold, 'GOLD label must be present.');
      assert.ok(H.Y >= gold[3] + 8, 'Element line must be below GOLD.');
      assert.deepEqual(patched.at(-1), [H.DRAW_TEXT, Buffer.from([...expected(...values)].map(c => c.charCodeAt(0) - 32)).toString('hex'), H.X, H.Y, H.BG | 0]);
    }
  }
}

async function verify(dra) {
  const original = H.withoutLine(dra), after = H.prepare(dra), line = verifyInstructions(after);
  verifyEquipment(dra, line);
  verifyMenuRefresh(original, after);
  assert.deepEqual(H.prepare(after), after);
  const legacy = original.slice(); legacy.set(H.LEGACY, H.CAVE);
  require('../stats-core.js').put32(legacy, H.HOOK, H.jump(H.BASE + H.CAVE)); require('../stats-core.js').put32(legacy, H.HOOK + 4, 0);
  assert.deepEqual(H.prepare(legacy), after);
  const edits = new Set([...Array(H.LIMIT - H.CAVE)].map((_, n) => H.CAVE + n).concat([...Array(8)].map((_, n) => H.HOOK + n)));
  for (let at = 0; at < dra.length; at++) if (!edits.has(at)) assert.equal(after[at], dra[at]);
  const occupied = dra.slice(); occupied[H.CAVE] = 1; assert.throws(() => H.prepare(occupied));
  const damaged = dra.slice(); damaged[H.DRAW_STATS] ^= 1; assert.throws(() => H.prepare(damaged));
  return after;
}

if (require.main === module) (async () => {
  let image;
  try { image = await fs.readFile(source); } catch (err) { if (err.code !== 'ENOENT') throw err; console.log('SKIP: current ASS BIN unavailable.'); return; }
  const disc = await C.DiscImage.open(new Blob([image]));
  await verify(await disc.readFile(await disc.findPath(['DRA.BIN'])));
  console.log('Menu element line: instructions, equipment, buffs, layout and guards passed.');
})().catch(err => { console.error(err); process.exitCode = 1; });

module.exports = {verify, expected, verifyInstructions};
