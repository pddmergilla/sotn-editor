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
function attack(bytes, hand, dra, row, variant, facing, anim, pose, privateIce = false) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  const events = [], model = cachedModel(dra), equip = privateIce ? model.sections.icePrivate : model.sections.equipRows[row];
  const rowAt = privateIce ? X.ICE_DATA : row === 217 ? X.DATA : model.tables.equip + row * 52;
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
function iceSelection(dra, equipment, hand, combo, mp, {pressed = 0, busy = 0, fail = false, nested = null} = {}) {
  const events = [], cpu = machine([{base: X.BASE, bytes: dra}], new Map([
    [0x800160E4, r => {r[2] = 0;}],
    [0x80016EEC, r => {r[2] = 5;}], [0x800F4994, () => {}],
    [0x8010EB5C, r => {r[2] = -1;}], [0x800FD688, r => {r[2] = 1;}], [0x800E2BA0, () => {}],
    [0x8011AAFC, (r, api) => {
      events.push({row: r[6], factory: r[5] >>> 0, damage: api.get(X.BASE + X.TABLE + r[6] * 52 + 8, 2)});
      if (nested) nested(cpu, r);
      r[2] = fail ? 0 : 0x80076000;
    }]
  ]));
  cpu.put(0x80072EEC, 4, hand === 'both' ? 0xA0 : hand ? 0x20 : 0x80);
  cpu.put(0x80072EE8, 4, pressed); cpu.put(0x80072F68, 2, busy);
  equipment.forEach((item, n) => cpu.put(0x80097C00 + n * 4, 4, item));
  cpu.put(0x80072F20, 4, 1); cpu.put(0x80073404, 2, 0);
  cpu.put(0x80138FC4, 2, combo === 'qcf' ? 255 : 0); cpu.put(0x80097BB0, 4, mp);
  const registers = cpu.run(0x8010EDB8);
  for (let n = 0; n < 52; n++) assert.equal(cpu.get(X.BASE + X.TABLE + 181 * 52 + n, 1), dra[X.TABLE + 181 * 52 + n], 'Shared stats restored.');
  assert.equal(registers[29] >>> 0, 0x801FF000);
  return {events, mp: cpu.get(0x80097BB0, 4), result: registers[2]};
}
function iceProperties(dra, equipment, hand, row = 181) {
  const cpu = machine([{base: X.BASE, bytes: dra}], new Map([
    [0x800160E4, r => {r[2] = 0;}], [0x80016EEC, r => {r[2] = 5;}],
    [0x800F4994, (r, api) => {for (let n = 0; n < 16; n++) api.put((r[29] >>> 0) + n, 1, 0xCC);}]
  ]));
  cpu.put(0x80097BD8, 4, 20); cpu.put(0x80097BB0, 4, 99);
  equipment.forEach((item, n) => cpu.put(0x80097C00 + n * 4, 4, item));
  const out = 0x80076000, r = cpu.run(0x800FE728, {4: hand, 5: out, 6: row});
  for (let n = 0; n < 52; n++) assert.equal(cpu.get(X.BASE + X.TABLE + 181 * 52 + n, 1), dra[X.TABLE + 181 * 52 + n]);
  assert.equal(r[29] >>> 0, 0x801FF000);
  return {attack: cpu.get(out + 8, 2), element: cpu.get(out + 12, 2), cooldown: cpu.get(out + 26, 1)};
}
async function mainIce() {
  if (!fs.existsSync(source)) {console.log('Private ice image checks skipped: BIN missing.'); return;}
  let image = fs.readFileSync(source);
  const initial = hash(image);
  let disc = await C.DiscImage.open(new Blob([image])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  if (model.sections.icePrivate) {
    image = Buffer.from(image);
    apply(image, fs.readFileSync(process.env.SOTN_ICE_REVERSAL || path.join(process.env.USERPROFILE,
      'Downloads/Reverse-Icebrand-Zero-Celcius-Separate-Stats-V2-ASS-2.0.ppf')));
    disc = await C.DiscImage.open(new Blob([image])); model = await M.loadFromDisc(disc, C.normalizeIsoName);
  }
  const baseline = hash(image), before = model.files.DRA.bytes;
  const prepared = H.prepareIce(model), opened = parse(prepared), privateRow = opened.sections.icePrivate;
  assert.equal(opened.sections.equipRows.length, model.sections.equipRows.length);
  assert.deepEqual(X.detect(prepared, X.TABLE), X.detect(before, X.TABLE));
  assert.equal(opened.get(opened.sections.hand[93].specialMove), 181);
  assert.equal(opened.get(opened.sections.hand[113].specialMove), 181);
  assert.deepEqual(M.rowUsers(opened, 181), [113]);
  assert.equal(M.weaponSpecialRow(opened, 93, 'specialMove'), privateRow);
  assert.equal(M.weaponSpecialRow(opened, 113, 'specialMove'), opened.sections.equipRows[181]);
  for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]]) opened.set(privateRow[key], value);
  const tuned = prepared.slice(); M.apply(opened, {DRA: tuned});
  for (const equipment of [[93, 113], [113, 93], [93, 93], [113, 113]]) for (const hand of [0, 1]) {
    const zero = equipment[hand] === 93, own = zero ? privateRow : opened.sections.equipRows[181];
    const cost = opened.get(own.mp);
    for (const mp of [0, cost - 1, cost, 99]) {
      const selected = iceSelection(tuned, equipment, hand, 'qcf', mp);
      assert.equal(selected.events[0].row, mp >= cost ? 181 : equipment[hand]);
      assert.equal(selected.mp, mp >= cost ? mp - cost : mp);
      const failed = iceSelection(tuned, equipment, hand, 'qcf', mp, {fail: true});
      assert.equal(failed.mp, mp); assert.equal(failed.result, 0);
    }
    assert.deepEqual(iceProperties(tuned, equipment, hand), {
      attack: Math.min(999, opened.get(own.attack) + 10), element: opened.get(own.element), cooldown: opened.get(own.invFrames)
    });
    assert.deepEqual(iceProperties(tuned, equipment, hand, equipment[hand]), iceProperties(before, equipment, hand, equipment[hand]));
    assert.deepEqual(iceSelection(tuned, equipment, hand, 'none', 99), iceSelection(before, equipment, hand, 'none', 99));
    const nested = iceSelection(tuned, equipment, hand, 'qcf', 99, {nested: (cpu, r) => {
      cpu.put(0x80097BD8, 4, 20);
      cpu.run(0x800FE728, {4: hand, 5: 0x80077000, 6: 181, 29: r[29] - 24});
      assert.equal(cpu.get(0x80077008, 2), Math.min(999, opened.get(own.attack) + 10));
    }});
    assert.equal(nested.mp, 99 - cost);
  }
  for (const equipment of [[93, 113], [113, 93]]) {
    assert.equal(iceSelection(tuned, equipment, 'both', 'qcf', 99).mp, 99 - (equipment[0] === 93 ? 13 : opened.get(opened.sections.equipRows[181].mp)));
  }
  for (const hand of [0, 1]) {
    const equipment = hand ? [5, 93] : [93, 5];
    const chosen = iceSelection(tuned, equipment, hand, 'qcf', 99, {pressed: hand ? 0x80 : 0x20});
    if (!hand) {assert.equal(chosen.events[0].row, 181); assert.equal(chosen.mp, 86);}
    const weapon = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    const overlay = weapon.subarray(50 * H.SLOT + H.CODE, 51 * H.SLOT);
    for (const facing of [0, 1]) for (const anim of [65, 66, 67, 68, 69, 70, 71]) for (const pose of [0, 1, 2]) {
      const zero = attack(overlay, hand, tuned, 181, 1, facing, anim, pose, true);
      const ice = attack(overlay, hand, tuned, 181, 1, facing, anim, pose);
      assert.deepEqual(zero.events, ice.events);
    }
    for (let n = 0; n < 10; n++) assert.equal(iceSelection(tuned, hand ? [113, 93] : [93, 113], hand, 'qcf', 99).mp, 86);
  }
  for (const edit of X.privateEdits()) {
    const damaged = prepared.slice(); damaged[edit.off] ^= 1;
    assert.throws(() => parse(damaged), /private ice special/);
    assert.throws(() => M.apply(opened, {DRA: damaged}), /changed by another patch/);
  }
  const occupied = before.slice(); occupied[X.ICE_DATA] = 1;
  assert.throws(() => H.prepareIce(parse(occupied)), /padding/);
  assert.throws(() => H.prepareIce(opened), /already installed/);
  const saved = S.parse(JSON.stringify(await S.capture({stats: opened, stages: new Map()})));
  const restored = parse(prepared); (await S.prepare(saved, {stats: restored, stages: new Map()})).apply();
  const restoredBytes = prepared.slice(); M.apply(restored, {DRA: restoredBytes}); assert.deepEqual(restoredBytes, tuned);
  const changes = await C.changedSectors(disc, model.files.DRA.record, before, tuned);
  const built = C.modifiedBlob(disc.file, changes), reopened = await M.loadFromDisc(await C.DiscImage.open(built), C.normalizeIsoName);
  assert.equal(reopened.get(reopened.sections.icePrivate.attack), 321);
  assert.equal(reopened.get(reopened.sections.equipRows[181].attack), model.get(model.sections.equipRows[181].attack));
  const patch = ppf(changes, image.subarray(0x9320, 0x9720), 'Independent ice specials test'), replay = Buffer.from(image);
  apply(replay, patch); assert.equal(hash(replay), hash(new Uint8Array(await built.arrayBuffer())));
  apply(replay, patch, true); assert.equal(hash(replay), baseline);
  for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified);
  for (let n = 0; n < before.length; n++) if (before[n] !== prepared[n]) assert.ok(
    n >= X.ICE_DATA && n < X.ICE_END || [0x6EDB8, 0x5E728].some(off => n >= off && n < off + 8));
  assert.equal(hash(fs.readFileSync(source)), initial);
  console.log('Private ice stats: complete attack paths, MP gating and spending, failure, both hands, shields, repeated attacks, real properties, native slash effects, stats restoration, saves, exports, guards and checksums passed.');
}
(process.argv.includes('--ice-private') ? mainIce() : main()).catch(error => {console.error(error); process.exitCode = 1;});
