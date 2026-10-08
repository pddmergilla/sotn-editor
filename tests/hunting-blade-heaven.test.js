const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js'), M = require('../stats-model.js');
const H = require('../tools/weapons/hunting-blade-heaven.js');
const {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || `${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

function selection(dra, item, hand, combo, mp, grounded = true, busyHand = null) {
  let selected;
  const cpu = machine([{base: M.DRA_BASE, bytes: dra}], new Map([
    [0x8010EB5C, r => {r[2] = -1;}], [0x800FD688, r => {r[2] = 1;}],
    [0x800E2BA0, () => {}], [0x8011AAFC, r => {selected = {row: r[6], factory: r[5]}; return 'stop';}]
  ]));
  cpu.put(0x80072EEC, 4, hand ? 0x20 : 0x80);
  cpu.put(0x80097C00 + hand * 4, 4, item); cpu.put(0x80097BB0, 4, mp);
  cpu.put(0x80072F20, 4, grounded ? 1 : 0); cpu.put(0x80138FC4, 2, combo ? 255 : 0);
  if (busyHand !== null) {
    cpu.put(0x80073F98 + 0xAE, 2, H.SPECIAL);
    cpu.put(0x80073F98 + 0x30, 2, busyHand << 15);
  }
  cpu.run(0x8010EDB8); assert.ok(selected); return selected;
}

function setup(bytes, hand, dra, equip, row, facing, pose) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  const events = [];
  let destroyed = false;
  const cpu = machine([{base, bytes}], new Map([
    [base + (bytes.length && K.u32(bytes, 0) === base + 0x1474 ? 0x10D4 : 0x62C), () => {destroyed = true;}],
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand);
      for (let n = 0; n < 52; n++) put((r[5] >>> 0) + n, 1, dra[equip + r[6] * 52 + n]);
      events.push({row: r[6]});
    }],
    [0x80010010, () => {}], [0x80010020, () => {}],
    [0x80010030, (r, {get}) => {
      events.push({frames: Array.from({length: 7}, (_, n) => get((r[5] >>> 0) + n * 4, 4) >>> 0)}); r[2] = 0;
    }],
    [0x80010040, (r, {get}) => {
      events.push({factory: r[5] >>> 0, parent: r[4] >>> 0, palette: get(self + 0x8A, 2)}); r[2] = 0;
    }],
    [0x80010050, r => {events.push({sound: r[4], volume: r[5]});}],
    [0x800190AC, r => {r[2] = Math.round(Math.atan2(r[4], r[5]) * 2048 / Math.PI) & 4095;}],
    [0x80016D68, r => {r[2] = Math.round(Math.cos((r[4] & 4095) * Math.PI / 2048) * 4096);}],
    [0x80016C9C, r => {r[2] = Math.round(Math.sin((r[4] & 4095) * Math.PI / 2048) * 4096);}],
    [0x80012B24, () => {}]
  ]));
  cpu.put(0x8003C788, 4, 0x80078000);
  for (const [ptr, addr] of [[0x8003C7D0, 0x80010000], [0x8003C804, 0x80010010],
    [0x8003C7DC, 0x80010020], [0x8003C814, 0x80010030], [0x8003C7F4, 0x80010040],
    [0x8003C858, 0x80010050]]) cpu.put(ptr, 4, addr);
  cpu.put(0x8006C3B8, 4, self);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x24, 2, 100); cpu.put(player + 0x14, 2, facing);
  cpu.put(player + 0x2C, 2, pose); cpu.put(player + 0xAC, 1, 65);
  cpu.put(player + 0x46, 1, 8); cpu.put(player + 0x47, 1, 16);
  cpu.put(0x80072F66, 2, 1);
  cpu.put(self + 0xAE, 2, row); cpu.put(self + 0x30, 2, hand << 15 | 2 << 8);
  return {cpu, base, self, player, events, destroyed: () => destroyed};
}

async function main() {
  const image = fs.readFileSync(source), initial = hash(image);
  if (process.env.SOTN_HUNTING_HEAVEN_REPORT) {
    const report = JSON.parse(fs.readFileSync(process.env.SOTN_HUNTING_HEAVEN_REPORT, 'utf8'));
    if (initial.toUpperCase() === report.result.sha256) {
      require('../tools/weapons/build-hunter-sword-patch.js').apply(image, fs.readFileSync(report.reversal.path));
      assert.equal(hash(image).toUpperCase(), report.source.sha256);
    }
  }
  const disc = await C.DiscImage.open(new Blob([image]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName), equip = model.tables.equip;
  const records = await Promise.all([0, 1].map(h => disc.findPath(['BIN', `WEAPON${h}.BIN`])));
  const weapons = await Promise.all(records.map(r => disc.readFile(r)));
  const prepared = H.prepare(model, weapons);
  for (let n = 0; n < prepared.dra.length; n++) if (prepared.dra[n] !== model.files.DRA.bytes[n])
    assert.ok([15, 16].some(off => n === equip + H.ITEM * 52 + off) ||
      [15, 16, 19].some(off => n === equip + H.SPECIAL * 52 + off), 'Only attack routing may change.');
  const opened = M.parse({...model.files, DRA: {...model.files.DRA, bytes: prepared.dra}});
  assert.deepEqual(M.rowUsers(opened, H.SPECIAL), [H.ITEM]);
  assert.equal(opened.get(opened.sections.equipRows[H.SPECIAL].attack), 460);
  assert.equal(opened.get(opened.sections.equipRows[H.SPECIAL].mp), 5);
  for (const hand of [0, 1]) {
    const special = selection(prepared.dra, H.ITEM, hand, true, 99);
    assert.equal(special.row, H.SPECIAL);
    assert.equal(special.factory & 65535, 50 + ((hand + 1) << 12));
    assert.equal(selection(prepared.dra, H.ITEM, hand, false, 99).row, H.ITEM);
    assert.equal(selection(prepared.dra, H.ITEM, hand, true, 4).row, H.ITEM);
    assert.equal(selection(prepared.dra, H.ITEM, hand, true, 5).row, H.SPECIAL);
    assert.equal(selection(prepared.dra, H.ITEM, hand, true, 99, false).row, H.ITEM);
    assert.equal(selection(prepared.dra, H.ITEM, hand, true, 99, true, hand).row, H.ITEM);
    assert.equal(selection(prepared.dra, H.ITEM, hand, true, 99, true, 1 - hand).row, H.SPECIAL);
    const before = weapons[hand].subarray(H.OVERLAY * H.SLOT + H.CODE, (H.OVERLAY + 1) * H.SLOT);
    const sword = weapons[hand].subarray(H.CODE, H.CODE + H.LENGTH);
    const after = prepared.weapons[hand].subarray(H.OVERLAY * H.SLOT + H.CODE, (H.OVERLAY + 1) * H.SLOT);
    assert.deepEqual(after.subarray(0xACC, 0x1C0C), before.subarray(0xACC, 0x1C0C), 'Heaven attacks and afterimages stay unchanged.');
    assert.deepEqual(prepared.weapons[hand].subarray(0, H.OVERLAY * H.SLOT), weapons[hand].subarray(0, H.OVERLAY * H.SLOT));
    assert.deepEqual(prepared.weapons[hand].subarray((H.OVERLAY + 1) * H.SLOT), weapons[hand].subarray((H.OVERLAY + 1) * H.SLOT));
    for (let y = 0; y < 128; y++) {
      const start = H.OVERLAY * H.SLOT + y * 128;
      assert.deepEqual(prepared.weapons[hand].subarray(start, start + 64), weapons[hand].subarray(start, start + 64));
      if (y < 96) assert.deepEqual(prepared.weapons[hand].subarray(start + 64, start + 120), weapons[hand].subarray(y * 128, y * 128 + 56));
    }
    assert.deepEqual(after.subarray(H.PAL, H.PAL + 9 * 32), before.subarray(0x2B0, 0x2B0 + 9 * 32));
    assert.deepEqual(after.subarray(H.PAL + 14 * 32, H.PAL + 21 * 32), sword.subarray(0xC04, 0xCE4));
    const palettes = [setup(before, hand, prepared.dra, equip, H.HEAVEN, 0, 0), setup(after, hand, prepared.dra, equip, H.HEAVEN, 0, 0)];
    for (let v = 0; v < 2; v++) palettes[v].cpu.run(K.u32(v ? after : before, 0x1C), {4: 0});
    const colors = 0x8006EDCC + hand * 768;
    for (let n = 0; n < 768; n++) assert.equal(palettes[1].cpu.get(colors + n, 1), palettes[0].cpu.get(colors + n, 1));
    palettes[1].cpu.run(K.u32(after, 0x1C), {4: 1});
    for (let n = 0; n < 768; n++) assert.equal(palettes[1].cpu.get(colors + n, 1), after[H.PAL + n]);
    for (const facing of [0, 1]) for (const pose of [0, 1, 2, 4]) {
      const normal = [setup(sword, hand, prepared.dra, equip, H.ITEM, facing, pose), setup(after, hand, prepared.dra, equip, H.ITEM, facing, pose)];
      for (let v = 0; v < 2; v++) normal[v].cpu.run(K.u32(v ? after : sword, 0), {4: normal[v].self});
      for (const [off, size] of [[0, 4], [4, 4], [0x14, 2], [0x24, 2], [0x34, 4], [0x40, 2], [0x42, 2], [0x49, 1], [0x58, 2], [0x6A, 2], [0xAC, 1], [0xAE, 2]])
        assert.equal(normal[1].cpu.get(normal[1].self + off, size), normal[0].cpu.get(normal[0].self + off, size));
      assert.equal(normal[1].cpu.get(normal[1].self + 0x54, 2), hand ? 0x8013 : 0x8011);
      assert.equal(normal[1].cpu.get(normal[1].self + 0x16, 2), 0x11E + hand * 24);
      assert.deepEqual(normal[1].events.find(e => e.frames).frames.map(a => a - normal[1].base - H.DATA + 0xEA4), normal[0].events.find(e => e.frames).frames.map(a => a - normal[0].base));
      const flying = [setup(before, hand, prepared.dra, equip, H.SPECIAL, facing, pose), setup(after, hand, prepared.dra, equip, H.SPECIAL, facing, pose)];
      for (let frame = 0; frame < 200 && !flying[0].destroyed(); frame++) {
        for (const s of flying) {s.cpu.put(0x8003C8C4, 4, frame); s.cpu.run(K.u32(s === flying[0] ? before : after, 0), {4: s.self});}
        for (let off = 0; off < 0xBC; off++) assert.equal(flying[1].cpu.get(flying[1].self + off, 1), flying[0].cpu.get(flying[0].self + off, 1));
        assert.deepEqual(flying[1].events, flying[0].events);
        assert.equal(flying[1].destroyed(), flying[0].destroyed());
      }
      assert.ok(flying[1].destroyed(), 'The flying sword returns and is caught.');
      assert.ok(flying[1].events.some(e => e.factory), 'The native afterimages are requested.');
      assert.ok(flying[1].events.some(e => e.row === H.SPECIAL));
      const trails = [setup(before, hand, prepared.dra, equip, H.SPECIAL, facing, pose), setup(after, hand, prepared.dra, equip, H.SPECIAL, facing, pose)];
      for (const s of trails) {
        s.cpu.put(s.self + 0x8C, 4, s.player); s.cpu.put(s.player + 0x26, 2, 1);
        s.cpu.put(s.player + 0x54, 2, hand ? 0x8012 : 0x8010); s.cpu.put(s.player + 0x56, 2, 6);
        s.cpu.put(s.player + 0x5A, 2, hand ? 0x66 : 0x64); s.cpu.put(s.player + 0x8A, 2, 0x114 + hand * 24);
      }
      for (let frame = 0; frame < 20 && !trails[0].destroyed(); frame++) {
        for (let v = 0; v < 2; v++) trails[v].cpu.run(K.u32(v ? after : before, 4), {4: trails[v].self});
        for (let n = 0; n < 0xBC; n++) assert.equal(trails[1].cpu.get(trails[1].self + n, 1), trails[0].cpu.get(trails[0].self + n, 1));
        assert.equal(trails[1].destroyed(), trails[0].destroyed());
      }
      assert.ok(trails[1].destroyed(), 'The afterimages fade and end naturally.');
    }
    const unknown = weapons[hand].slice(); unknown[H.OVERLAY * H.SLOT + H.CODE + H.BANK] = 1;
    assert.throws(() => H.weapon(unknown, hand));
  }
  const heavenBefore = prepared.dra.slice(equip + H.HEAVEN * 52, equip + (H.HEAVEN + 1) * 52);
  opened.set(opened.sections.equipRows[H.SPECIAL].attack, 777);
  opened.set(opened.sections.equipRows[H.SPECIAL].mp, 9);
  const tuned = prepared.dra.slice(); M.apply(opened, {DRA: tuned});
  assert.deepEqual(tuned.subarray(equip + H.HEAVEN * 52, equip + (H.HEAVEN + 1) * 52), heavenBefore);
  const reopened = M.parse({...model.files, DRA: {...model.files.DRA, bytes: tuned}});
  assert.equal(reopened.get(reopened.sections.equipRows[H.SPECIAL].attack), 777);
  assert.equal(reopened.get(reopened.sections.equipRows[H.SPECIAL].mp), 9);
  assert.equal(opened.get(opened.sections.equipRows[H.ITEM].attack), 435);
  assert.equal(hash(fs.readFileSync(source)), initial, 'The source BIN stays unchanged.');
  console.log('PASS: both hands, normal slash parity, Heaven flight parity, native afterimages, private stats, MP/chain/input gates, artwork, palettes, guards and unchanged source.');
}
if (require.main === module) main().catch(e => {console.error(e); process.exitCode = 1;});
module.exports = {main};
