const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), M = require('../stats-model.js'), K = require('../stats-core.js');
const H = require('../tools/weapons/elemental-weapons.js'), X = require('../weapon-special-rows.js');
const S = require('../edit-session.js');
const {machine} = require('./helpers/mips.js'), {ppf, apply} = require('../tools/weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || `${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const parse = dra => M.parse({DRA: {bytes: dra, base: X.BASE, label: 'DRA.BIN'}});
const parsedModels = new WeakMap();
function cachedModel(dra) {
  if (!parsedModels.has(dra)) parsedModels.set(dra, parse(dra));
  return parsedModels.get(dra);
}
function select(dra, c, hand, combo, step = 0, active = 0) {
  let chosen;
  const cpu = machine([{base: X.BASE, bytes: dra}], new Map([
    [0x8010EB5C, r => {r[2] = -1;}], [0x800FD688, r => {r[2] = 1;}], [0x800E2BA0, () => {}],
    [0x8011AAFC, r => {chosen = {row: r[6], factory: r[5] >>> 0}; return 'stop';}]
  ]));
  cpu.put(0x80072EEC, 4, hand ? 0x20 : 0x80); cpu.put(0x80097C00 + hand * 4, 4, c.item);
  cpu.put(0x80072F20, 4, step < 3 ? 1 : 0); cpu.put(0x80073404, 2, step); cpu.put(0x80072F66, 2, active);
  cpu.put(0x80138FC8, 2, combo === 'bf' ? 255 : 0); cpu.put(0x80138FC4, 2, combo === 'qcf' ? 255 : 0);
  cpu.run(0x8010EDB8); return chosen;
}
function attack(bytes, hand, dra, row, variant, facing, anim, pose) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  const events = [], model = cachedModel(dra), equip = model.sections.equipRows[row];
  const rowAt = row === 217 ? X.DATA : model.tables.equip + row * 52;
  const cpu = machine([{base, bytes}], new Map([
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand); assert.equal(r[6], row);
      for (let n = 0; n < 52; n++) put((r[5] >>> 0) + n, 1, dra[rowAt + n]);
    }],
    [0x80010010, () => {}], [0x80010020, r => {events.push({sound: r[4]});}],
    [0x80010030, r => {events.push({frames: r[5] >>> 0, props: r[4] >>> 0}); r[2] = 0;}],
    [0x80010040, r => {events.push({factory: r[5] >>> 0}); r[2] = 0x80076000;}]
  ]));
  cpu.put(0x8003C788, 4, 0x80078000); cpu.put(0x8006C3B8, 4, self);
  for (const [pointer, service] of [[0x8003C7D0, 0x80010000], [0x8003C804, 0x80010010],
    [0x8003C7DC, 0x80010020], [0x8003C814, 0x80010030], [0x8003C7F4, 0x80010040]]) cpu.put(pointer, 4, service);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x24, 2, 100); cpu.put(player + 0x14, 2, facing);
  cpu.put(player + 0x50, 2, pose); cpu.put(player + 0x52, 2, 1); cpu.put(player + 0xAC, 1, anim);
  cpu.put(0x80072F66, 2, 0x8002); cpu.put(self + 0xAE, 2, row); cpu.put(self + 0x30, 2, hand << 15 | variant << 8);
  cpu.run(K.u32(bytes, 0), {4: self});
  assert.equal(cpu.get(self + 0x40, 2), model.get(equip.attack));
  assert.equal(cpu.get(self + 0x42, 2), model.get(equip.element));
  return {cpu, events, self};
}
function properties(dra, row, hand, strength = 20, mp = 99) {
  const cpu = machine([{base: X.BASE, bytes: dra}], new Map([
    [0x800160E4, r => {r[2] = 0;}], [0x80016EEC, r => {r[2] = 5;}], [0x800F4994, () => {}]
  ]));
  const out = 0x80076000;
  cpu.put(0x80097BD8, 4, strength); cpu.put(0x80097BE4, 4, 0); cpu.put(0x80097BB0, 4, mp);
  cpu.put(0x80097C00, 4, 111); cpu.put(0x80097C04, 4, 112);
  for (let n = 0; n < 5; n++) cpu.put(0x80097C08 + n * 4, 4, 0);
  cpu.run(0x800FE728, {4: hand, 5: out, 6: row});
  return {cpu, out};
}
async function main() {
  const synthetic = new Uint8Array(0x70000);
  assert.deepEqual(X.detect(synthetic, X.TABLE), []);
  for (const edit of X.edits()) synthetic.set(edit.expect, edit.off);
  assert.equal(X.detect(synthetic, X.TABLE)[0].index, 217);
  for (const edit of X.edits()) {
    const bad = synthetic.slice(); bad[edit.off] ^= 1;
    assert.throws(() => X.detect(bad, X.TABLE), /incomplete/);
  }
  assert.throws(() => X.detect(synthetic, X.TABLE + 4), /incomplete/);
  let disc, original, files, model, weapons, initial;
  if (fs.existsSync(source)) {
    original = fs.readFileSync(source); initial = hash(original);
    disc = await C.DiscImage.open(new Blob([original])); model = await M.loadFromDisc(disc, C.normalizeIsoName);
    if (model.extendedSpecialRows.length) {
      const report = JSON.parse(fs.readFileSync(process.env.SOTN_ELEMENTAL_REPORT || path.join(process.env.USERPROFILE,
        'Downloads/Elemental-Swords-Instant-Specials-ASS-2.0/verification.json'), 'utf8'));
      assert.equal(initial, report.result.sha256); apply(original, fs.readFileSync(report.reversal.path));
      assert.equal(hash(original), report.source.sha256); disc = await C.DiscImage.open(new Blob([original]));
      model = await M.loadFromDisc(disc, C.normalizeIsoName);
    }
    files = model.files;
    weapons = await Promise.all([0, 1].map(async hand => disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]))));
  } else if (process.env.SOTN_ELEMENTAL_FIXTURES_DIR) {
    const dir = process.env.SOTN_ELEMENTAL_FIXTURES_DIR;
    model = parse(new Uint8Array(fs.readFileSync(path.join(dir, 'dra.dat')))); files = model.files;
    weapons = [0, 1].map(hand => {
      const w = new Uint8Array(51 * H.SLOT);
      for (const overlay of [48, 49, 50]) w.set(fs.readFileSync(path.join(dir, `w${overlay}-${hand}.dat`)), overlay * H.SLOT + H.CODE);
      return w;
    });
  } else {console.log('Extended-row guards passed; image checks skipped (supply SOTN_ASS_BIN).'); return;}
  const before = files.DRA.bytes, prepared = H.prepare(model, weapons), opened = parse(prepared.dra);
  assert.equal(opened.sections.equipRows.length, 218);
  for (const c of H.CONFIG) {
    assert.equal(opened.get(opened.sections.hand[c.item].unk17), c.special);
    assert.deepEqual(M.rowUsers(opened, c.special), [c.item]);
    assert.ok(M.specialRows(opened).some(r => r.index === c.special));
    assert.ok(!M.freeSpecialRows(opened).some(r => r.index === c.special));
    for (const key of M.STYLE_KEYS) assert.equal(opened.get(opened.sections.hand[c.item][key]), opened.get(opened.sections.hand[c.normal][key]));
    for (const hand of [0, 1]) {
      for (const step of [0, 1, 2, 3, 4]) {
        const selected = select(prepared.dra, c, hand, 'bf', step);
        assert.equal(selected.row, c.special); assert.equal(selected.factory >>> 16, opened.get(opened.sections.equipRows[c.special].unk14) + hand * 128);
        assert.equal(select(prepared.dra, c, hand, 'none', step).row, c.item);
        assert.equal(select(prepared.dra, c, hand, 'qcf', step).row, c.item);
      }
      assert.equal(select(prepared.dra, c, hand, 'bf', 0, 0x8000), undefined);
      const start = c.overlay * H.SLOT + H.CODE;
      const old = weapons[hand].subarray(start, start + H.LENGTH), now = prepared.weapons[hand].subarray(start, start + H.LENGTH);
      for (const facing of [0, 1]) for (const anim of [65, 66, 67, 68, 69, 70, 71]) for (const pose of [0, 1, 2]) {
        const reference = attack(old, hand, prepared.dra, c.normal, 0, facing, anim, pose);
        const normal = attack(now, hand, prepared.dra, c.item, 0, facing, anim, pose);
        assert.deepEqual(normal.events, reference.events);
        const privateVariant = opened.get(opened.sections.equipRows[c.special].unk14);
        const a = attack(now, hand, prepared.dra, c.special, privateVariant, facing, anim, pose);
        const donorVariant = opened.get(opened.sections.equipRows[c.donor].unk14);
        const donor = attack(old, hand, prepared.dra, c.donor, donorVariant, facing, anim, pose);
        const keptDonor = attack(now, hand, prepared.dra, c.donor, donorVariant, facing, anim, pose);
        assert.deepEqual(keptDonor.events, donor.events);
        const effects = a.events.filter(e => e.factory).map(e => e.factory & 0xFFFF);
        if (c.overlay === 49) assert.deepEqual(a.events, donor.events);
        else if (pose === 0) assert.equal(effects.length, 0);
        else if (pose === 1) assert.deepEqual(effects, c.overlay === 48 ? [0x1038, 0x103A, 0x103A, 0x103A].map(v => v + hand * 0x1000) : [0x1044, 0x1061].map(v => v + hand * 0x1000));
        assert.deepEqual(a.events.filter(e => e.frames), donor.events.filter(e => e.frames));
      }
      const p = properties(prepared.dra, c.special, hand);
      assert.equal(p.cpu.get(p.out + 8, 2), Math.min(999, opened.get(opened.sections.equipRows[c.special].attack) + 10));
      assert.equal(p.cpu.get(p.out + 12, 2), opened.get(opened.sections.equipRows[c.special].element));
      for (const mp of [0, 2, 99]) {
        const spend = machine([{base: X.BASE, bytes: prepared.dra}], new Map([[0x8010F3E0, () => 'stop']]));
        spend.put(0x80097BB0, 4, mp);
        spend.run(0x8010F3B4, {19: c.special, 20: hand});
        const cost = opened.get(opened.sections.equipRows[c.special].mp);
        assert.equal(spend.get(0x80097BB0, 4), mp >= cost ? mp - cost : mp);
      }
    }
  }
  for (const [off, reg, pointer, originalWords, secondAfter] of X.sites) {
    for (let row = 0; row <= 217; row++) {
      const after = machine([{base: X.BASE, bytes: prepared.dra}], new Map([[X.BASE + off + 8, () => 'stop']]));
      const old = machine([{base: X.BASE, bytes: before}], new Map([[X.BASE + off + 8, () => 'stop']]));
      const init = Object.fromEntries(Array.from({length: 31}, (_, n) => [n + 1, 0x12480000 + n * 0x100]));
      init[29] = 0x801FF000; init[2] = row * 52; init[4] = pointer ? X.BASE + X.TABLE : row * 52;
      init[3] = init[6] = X.BASE + X.TABLE;
      const actual = after.run(X.BASE + off, init), expected = old.run(X.BASE + off, init);
      if (row === 217) {expected[reg] = pointer ? X.BASE + X.DATA : X.BASE + X.DATA - X.TABLE; if (secondAfter) expected[8] = X.BASE + X.DATA + 48;}
      assert.deepEqual(actual, expected, `Preserved registers at ${off.toString(16)}, row ${row}`);
    }
  }
  const tuned = prepared.dra.slice();
  for (const c of H.CONFIG) for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]]) opened.set(opened.sections.equipRows[c.special][key], value);
  M.apply(opened, {DRA: tuned}); const reopened = parse(tuned);
  const saved = S.parse(JSON.stringify(await S.capture({stats: opened, stages: new Map()})));
  const restored = parse(prepared.dra);
  (await S.prepare(saved, {stats: restored, stages: new Map()})).apply();
  const restoredBytes = prepared.dra.slice(); M.apply(restored, {DRA: restoredBytes});
  assert.deepEqual(restoredBytes, tuned);
  for (const c of H.CONFIG) {
    assert.equal(reopened.get(reopened.sections.equipRows[c.special].attack), 321);
    for (const hand of [0, 1]) {
      const p = properties(tuned, c.special, hand); assert.equal(p.cpu.get(p.out + 8, 2), 331);
      assert.equal(p.cpu.get(p.out + 12, 2), 0x2040); assert.equal(p.cpu.get(p.out + 26, 1), 7);
      assert.equal(p.cpu.get(p.out + 38, 2), 11);
    }
  }
  for (let row = 0; row < 217; row++) if (![86, 87, 88, 200, 201].includes(row))
    assert.deepEqual(prepared.dra.subarray(X.TABLE + row * 52, X.TABLE + (row + 1) * 52), before.subarray(X.TABLE + row * 52, X.TABLE + (row + 1) * 52));
  assert.deepEqual(prepared.dra.subarray(0x7718, 0x8258), before.subarray(0x7718, 0x8258));
  for (let n = 0; n < before.length; n++) if (before[n] !== prepared.dra[n])
    assert.ok(n >= X.DATA && n < X.START + X.sites.length * X.SLOT || X.sites.some(s => n >= s[0] && n < s[0] + 8) ||
      [86, 87, 88, 200, 201].some(row => n >= X.TABLE + row * 52 && n < X.TABLE + (row + 1) * 52));
  for (const hand of [0, 1]) for (let n = 0; n < weapons[hand].length; n++) if (weapons[hand][n] !== prepared.weapons[hand][n])
    assert.ok(Object.entries(H.hooks).some(([overlay, h]) => {
      const off = n - overlay * H.SLOT - H.CODE; return off >= h.off && off < h.off + 4 || off >= h.cave && off < h.cave + 40;
    }));
  const broken = prepared.dra.slice(); broken[X.START] ^= 1;
  assert.throws(() => parse(broken), /incomplete/);
  assert.throws(() => M.apply(opened, {DRA: broken}), /changed by another patch/);
  if (disc) {
    const changes = await C.changedSectors(disc, files.DRA.record, before, tuned);
    for (const hand of [0, 1]) {
      const record = await disc.findPath(['BIN', `WEAPON${hand}.BIN`]);
      changes.push(...await C.changedSectors(disc, record, weapons[hand], prepared.weapons[hand]));
    }
    changes.sort((a, b) => a.start - b.start);
    for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified);
    const built = C.modifiedBlob(disc.file, changes);
    const fullModel = await M.loadFromDisc(await C.DiscImage.open(built), C.normalizeIsoName);
    for (const c of H.CONFIG) for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]])
      assert.equal(fullModel.get(fullModel.sections.equipRows[c.special][key]), value);
    const patch = ppf(changes, original.subarray(0x9320, 0x9720), 'Private elemental special stats test');
    const replayed = Buffer.from(original); apply(replayed, patch);
    assert.equal(hash(replayed), hash(new Uint8Array(await built.arrayBuffer())));
    apply(replayed, patch, true); assert.equal(hash(replayed), hash(original));
  }
  if (initial) assert.equal(hash(fs.readFileSync(source)), initial);
  console.log('Elemental weapons: both hands, poses, normal parity, instant slash effects, original donors, all-row register preservation, private stats, saved edits, BIN/PPF exports and guards passed.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
