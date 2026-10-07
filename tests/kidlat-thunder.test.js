const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), M = require('../stats-model.js'), K = require('../stats-core.js');
const H = require('../tools/weapons/elemental-weapons.js'), T = require('../tools/weapons/kidlat-thunder.js');
const {machine} = require('./helpers/mips.js'), {ppf, apply} = require('../tools/weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || `${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
function scene(code, hand, model, row, facing, anim, variant) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8, events = [];
  const dra = model.files.DRA.bytes, equipAt = model.tables.equip + row * 52;
  const cpu = machine([{base, bytes: code}], new Map([
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand); assert.equal(r[6], row);
      for (let n = 0; n < 52; n++) put((r[5] >>> 0) + n, 1, dra[equipAt + n]);
    }], [0x80010010, () => {}],
    [0x80010020, (r, {put}) => {
      events.push({sound:r[4]});
      for (const reg of T.saved.filter(v => v !== 31)) r[reg] = 0x55550000 + reg;
      for (let n = 0; n < 16; n += 4) put((r[29] >>> 0) + n, 4, 0x55555555);
    }],
    [0x80010030, r => {events.push({frames:r[5] >>> 0, props:r[4] >>> 0}); r[2] = 0;}],
    [0x80010040, r => {events.push({factory:r[5] >>> 0}); r[2] = 0x80076000;}]
  ]));
  cpu.put(0x8003C788, 4, 0x80078000); cpu.put(0x8006C3B8, 4, self);
  for (const [pointer, service] of [[0x8003C7D0, 0x80010000], [0x8003C804, 0x80010010],
    [0x8003C7DC, 0x80010020], [0x8003C814, 0x80010030], [0x8003C7F4, 0x80010040]]) cpu.put(pointer, 4, service);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x24, 2, 100); cpu.put(player + 0x14, 2, facing);
  cpu.put(player + 0xAC, 1, anim); cpu.put(0x80072F66, 2, 0x8002);
  cpu.put(self + 0xAE, 2, row); cpu.put(self + 0x30, 2, hand << 15 | variant << 8);
  return {cpu, events, self, frame(pose, timer = 1) {
    cpu.put(player + 0x50, 2, pose); cpu.put(player + 0x52, 2, timer);
    cpu.run(K.u32(code, 0), {4:self});
    return {events:events.slice(), state:Array.from({length:0x100}, (_, n) => cpu.get(self + n, 1))};
  }};
}
async function main() {
  if (!fs.existsSync(source)) {console.log('Kidlat image checks skipped; supply SOTN_ASS_BIN.'); return;}
  const original = fs.readFileSync(source), liveHash = hash(original);
  let disc = await C.DiscImage.open(new Blob([original])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  let records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  let weapons = await Promise.all(records.map(record => disc.readFile(record)));
  const at = T.OVERLAY * H.SLOT + H.CODE;
  if (K.u32(weapons[0], at + T.CAVE)) {
    const reportPath = process.env.SOTN_KIDLAT_THUNDER_REPORT || path.join(process.env.USERPROFILE, 'Downloads/Kidlat-Thunder-Slash-ASS-2.0/verification.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(liveHash, report.result.sha256); apply(original, fs.readFileSync(report.reversal.path));
    assert.equal(hash(original), report.source.sha256);
    disc = await C.DiscImage.open(new Blob([original])); model = await M.loadFromDisc(disc, C.normalizeIsoName);
    records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
    weapons = await Promise.all(records.map(record => disc.readFile(record)));
  }
  assert.equal(model.get(model.sections.hand[86].name).trim(), 'Kidlat');
  assert.equal(model.get(model.sections.hand[86].unk17), T.ROW);
  assert.deepEqual(M.rowUsers(model, T.ROW), [86]);
  const changed = weapons.map(T.weapon);
  for (const hand of [0, 1]) {
    const old = weapons[hand].subarray(at, at + H.LENGTH), now = changed[hand].subarray(at, at + H.LENGTH);
    assert.equal(K.u32(old, 0x21C0), 0x34040000 | T.SOUND);
    assert.equal(K.u32(old, 0x21BC), 0x0040F809);
    for (const damagedAt of [0x1528, T.HOOK, T.CAVE, 0x21C0]) {
      const bad = weapons[hand].slice(); bad[at + damagedAt] ^= 1;
      assert.throws(() => T.weapon(bad, hand), /Unknown Kidlat overlay/);
    }
    for (let row = 0; row < 256; row++) {
      let calls = 0;
      const init = Object.fromEntries(Array.from({length:31}, (_, n) => [n + 1, 0x12480000 + n * 0x100]));
      init[17] = 0x80075000; init[29] = 0x801FF000;
      const stop = new Map([[ (hand ? 0x8017D000 : 0x8017A000) + T.HOOK + 8, () => 'stop']]);
      const base = hand ? 0x8017D000 : 0x8017A000;
      const a = machine([{base, bytes:old}], stop), b = machine([{base, bytes:now}], new Map(stop));
      b.hooks.set(0x80010020, (r, {put}) => {
        assert.equal(r[4], T.SOUND); calls++;
        for (const reg of T.saved.filter(v => v !== 31)) r[reg] = 0x55550000 + reg;
        for (let n = 0; n < 16; n += 4) put((r[29] >>> 0) + n, 4, -1);
      });
      b.put(0x8003C7DC, 4, 0x80010020); b.put(init[17] + 0xAE, 2, row);
      assert.deepEqual(b.run(base + T.HOOK, init), a.run(base + T.HOOK, init));
      assert.equal(calls, row === T.ROW ? 1 : 0);
    }
    for (const facing of [0, 1]) for (const anim of [65, 66, 67, 68, 69, 70, 71])
      for (const [row, variant] of [[T.ROW, 1], [86, 0], [112, 0], [178, 1]]) {
        const a = scene(old, hand, model, row, facing, anim, variant);
        const b = scene(now, hand, model, row, facing, anim, variant);
        for (const pose of [0, 0, 1, 1, 1, 2, 2, 3]) {
          const reference = a.frame(pose), result = b.frame(pose);
          const thunder = result.events.filter(e => e.sound === T.SOUND);
          assert.equal(thunder.length, row === T.ROW && pose >= 1 ? 1 : 0);
          assert.deepEqual(result.events.filter(e => e.sound !== T.SOUND), reference.events);
          assert.deepEqual(result.state, reference.state);
          if (row === T.ROW && pose === 0) assert.ok(!result.events.some(e => e.factory));
        }
        if (row === T.ROW) {
          assert.ok(b.events.some(e => e.sound === 0x60C));
          const thunderAt = b.events.findIndex(e => e.sound === T.SOUND);
          const slashAt = b.events.findIndex(e => e.factory);
          assert.ok(thunderAt >= 0 && thunderAt < slashAt);
        }
      }
    for (let n = 0; n < weapons[hand].length; n++) if (weapons[hand][n] !== changed[hand][n])
      assert.ok(T.edits(hand).some(e => n >= at + e.off && n < at + e.off + e.expect.length));
  }
  const changes = [];
  for (const hand of [0, 1]) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], changed[hand]));
  changes.sort((a, b) => a.start - b.start);
  for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified);
  const exported = C.modifiedBlob(disc.file, changes);
  const reopened = await M.loadFromDisc(await C.DiscImage.open(exported), C.normalizeIsoName);
  assert.deepEqual(reopened.files.DRA.bytes, model.files.DRA.bytes);
  const patch = ppf(changes, original.subarray(0x9320, 0x9720), 'Kidlat thunder sound test'), replayed = Buffer.from(original);
  apply(replayed, patch); assert.equal(hash(replayed), hash(new Uint8Array(await exported.arrayBuffer())));
  apply(replayed, patch, true); assert.equal(hash(replayed), hash(original));
  assert.equal(hash(fs.readFileSync(source)), liveHash);
  console.log('Kidlat thunder: both hands, all attack stances/directions, one sound per slash, original swish/effects/stats, Thunderbrand, all-row register preservation, guards and BIN/PPF round trips passed.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
