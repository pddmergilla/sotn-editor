const assert = require('node:assert/strict');
const fs = require('node:fs'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), D = require('../disc-stage.js'), M = require('../stats-model.js');
const H = require('../tools/items/warp-cards.js'), {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
async function verify(dra, warps) {
  const after = H.prepare(dra), model = M.parse({DRA: {bytes: after, base: H.BASE}});
  const destinations = [[166, H.SCORPION_INDEX, 11, 2, 192, warps.WRP], [27, H.NOIL_INDEX, 43, 0, 64, warps.RWRP]];
  let scenarios = 0;
  for (const [id, name] of [[166, 'Scorpion Card'], [27, 'noiL Card']]) {
    const row = model.sections.hand[id]; assert.equal(model.get(row.name), name);
    for (const [key, value] of Object.entries({category: 10, attack: 0, defense: 0, weaponId: 255,
      unk13: 55, unk14: 20, consumable: 0, mp: 0, icon: 70, palette: 70, specialMove: 0, unk17: 0}))
      assert.equal(model.get(row[key]), value);
  }
  for (const [id, index, stage, roomIndex, x, overlay] of destinations)
    for (const hand of [0, 1]) for (const origin of [0, 2, 11, 32, 34, 43]) for (const step of [0, 1, 2, 3, 4, 18]) {
      const events = [];
      const hooks = new Map([
        [0x8010DA48, (r) => { assert.equal(r[4], 0xF4); events.push('teleport'); }],
        [0x800FD7C0, r => { r[2] = 0; }],
        [H.BASE + 0x6FAC4, () => 'stop'],
        [H.BASE + 0x54818, () => 'stop']
      ]);
      const cpu = machine([{base: H.BASE, bytes: after.subarray(0, 0xE0000)}, {base: 0x80180000, bytes: overlay}], hooks);
      cpu.put(0x80097C00 + hand * 4, 4, id); cpu.put(0x800974A0, 4, origin);
      cpu.put(0x80073404, 2, step); cpu.put(0x8009798A + id, 1, 7);
      cpu.put(0x80097BB0, 4, 0); cpu.put(0x8003C784, 4, 0x80180000 + D.parseOverlay(overlay).roomHeaderOffset);
      const result = cpu.run(H.BASE + 0x6F1CC, {5: hand, 20: hand}); scenarios++;
      if (step > 2) {
        assert.equal(result[2], 0); assert.deepEqual(events, []); assert.equal(cpu.get(H.BASE + H.PENDING, 4), 0); continue;
      }
      assert.equal(result[2], 1); assert.deepEqual(events, ['teleport']);
      assert.equal(cpu.get(H.BASE + H.PENDING, 4), index);
      assert.equal(cpu.get(0x8009798A + id, 1), 7); assert.equal(cpu.get(0x80097C00 + hand * 4, 4), id);
      assert.equal(cpu.get(0x80097BB0, 4), 0); assert.equal(cpu.get(0x80073404, 2), 18);
      cpu.put(0x80097C98, 4, 6);
      // Complete the stage change.
      cpu.hooks.set(0x800F223C, r => { events.push('stage cleanup'); r[8] = r[9] = -123; });
      cpu.run(H.BASE + 0x532A0, {3: 6, 2: 6, 19: 4});
      assert.equal(cpu.get(0x8006C374, 4), index); assert.equal(cpu.get(0x800974A0, 4), stage);
      assert.equal(cpu.get(0x80073060, 4), 4);
      assert.equal(cpu.run(H.BASE + 0x516D0)[2], stage);
      cpu.run(H.BASE + 0x514CC);
      assert.equal(cpu.get(0x800733DA, 2), x); assert.equal(cpu.get(0x800733DE, 2), 132);
      assert.equal(cpu.get(0x801375BC, 4) >>> 0, 0x80180000 + D.parseOverlay(overlay).roomHeaderOffset + roomIndex * 8 + 4);
      assert.deepEqual(events, ['teleport', 'stage cleanup']);
    }
  for (const id of [0, 36, 166, 27]) {
    const cpu = machine([{base: H.BASE, bytes: after}], new Map([[0x800FD39C, () => 'stop']]));
    cpu.put(H.BASE + H.PENDING, 4, 999); cpu.run(H.BASE + H.ACTIVATE, {19: id});
    assert.equal(cpu.get(H.BASE + H.PENDING, 4), id === 27 ? H.NOIL_INDEX : id === 166 ? H.SCORPION_INDEX : 0);
  }
  const repeated = machine([{base: H.BASE, bytes: after}], new Map([[0x800FD39C, () => 'stop']]));
  for (const id of [27, 166, 27, 36, 166]) {
    repeated.run(H.BASE + H.ACTIVATE, {19: id});
    assert.equal(repeated.get(H.BASE + H.PENDING, 4), id === 27 ? H.NOIL_INDEX : id === 166 ? H.SCORPION_INDEX : 0);
  }
  // Keep other teleport routes.
  for (const mode of [0, 4, 5, 6]) for (const stage of [0, 32]) {
    const values = [];
    for (const bytes of [dra, after]) {
      const cpu = machine([{base: H.BASE, bytes}]); cpu.put(0x80097C98, 4, mode);
      cpu.put(0x800974A0, 4, stage); cpu.put(0x8006C374, 4, 42);
      values.push(cpu.run(H.BASE + 0x516D0)[2]);
    }
    assert.equal(values[0], values[1]);
  }
  for (const flag of [0, 2]) {
    const states = [];
    for (const bytes of [dra, after]) {
      const cpu = machine([{base: H.BASE, bytes}], new Map([[H.BASE + 0x54818, () => 'stop']]));
      cpu.put(0x800FD4BC, 4, flag); cpu.put(0x800974A0, 4, 34); cpu.put(0x80097C98, 4, 6);
      cpu.run(H.BASE + H.TRANSITION_HOOK, {19: 4});
      states.push([cpu.get(0x8006C374, 4), cpu.get(0x800974A0, 4), cpu.get(0x80097C98, 4)]);
    }
    assert.deepEqual(states[0], states[1]);
  }
  const rooms = [D.parseOverlay(warps.WRP).rooms[2], D.parseOverlay(warps.RWRP).rooms[0]];
  assert.deepEqual(rooms.map(room => [room.left, room.top]), [[59, 17], [23, 51]]);
  const allowed = [[H.CAVE, H.END], [H.HOOK, H.HOOK + 4], [H.TRANSITION_HOOK, H.TRANSITION_HOOK + 4],
    [H.SELECT_HOOK, H.SELECT_HOOK + 4], [0x5088, 0x50B4]];
  const originalModel = M.parse({DRA: {bytes: dra, base: H.BASE}});
  for (const id of [27, 166]) for (const key of ['name', 'desc']) {
    const field = originalModel.field(originalModel.sections.hand[id][key]); allowed.push([field.off, field.off + field.capacity]);
  }
  for (let n = 0; n < dra.length; n++) if (dra[n] !== after[n]) assert.ok(allowed.some(([lo, hi]) => n >= lo && n < hi));
  for (const offset of [H.CAVE, H.HOOK, H.TRANSITION_HOOK, H.SELECT_HOOK]) {
    const damaged = dra.slice(); damaged[offset] ^= 1; assert.throws(() => H.prepare(damaged));
  }
  const occupiedIcon = dra.slice(); require('../stats-core.js').put16(occupiedIcon, originalModel.field(originalModel.sections.hand[0].icon).off, 311);
  assert.throws(() => H.prepare(occupiedIcon));
  console.log(`${scenarios} card-use cases, actual stage selection/position, reusable inventory and existing routes passed.`);
  return after;
}
if (require.main === module) (async () => {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = hash(), disc = await C.DiscImage.open(await fs.openAsBlob(source));
  const dra = await disc.readFile(await disc.findPath(['DRA.BIN'])), warps = {};
  for (const name of ['WRP', 'RWRP']) warps[name] = await disc.readFile(await disc.findPath(['ST', name, `${name}.BIN`]));
  await verify(dra, warps); assert.equal(hash(), before);
})().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {verify};
