const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), D = require('../disc-stage.js'), K = require('../stats-core.js');
const H = require('../tools/items/warp-cards.js'), G = require('../tools/items/warp-card-graphics.js');
const {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
function loading(bytes, index, stage, busy = 0, previous = 999) {
  const cpu = machine([{base: H.BASE, bytes}], new Map([[0x800E4F30, () => 'stop'], [0x800E5324, () => 'stop']]));
  cpu.put(0x800978AC, 4, 1); cpu.put(0x800974A0, 4, stage); cpu.put(0x8006C374, 4, index);
  cpu.put(0x8006C3B0, 4, busy); cpu.put(0x80097918, 4, previous);
  cpu.run(0x800E4D74);
  return [cpu.get(0x80097918, 4), cpu.get(0x8006C398, 4), cpu.get(0x8006BAFC, 4)];
}
function verifyLoading(before, after, warps) {
  assert.equal(K.u32(after, G.HOOK), H.jump(G.BASE + G.CAVE, true));
  for (const [id, index, stage, room, name] of [[166, H.SCORPION_INDEX, 11, 2, 'WRP'], [27, H.NOIL_INDEX, 43, 0, 'RWRP']]) {
    assert.deepEqual(loading(before, index, stage), [999, 0, 0], 'Reproduce the skipped graphics request.');
    for (const origin of [0, 2, 11, 32, 34, 43]) {
      assert.deepEqual(loading(after, index, stage, 0, origin), [stage, 1, 3]);
      assert.deepEqual(loading(after, index, stage, 1, origin), [origin, 0, 0]);
    }
    const overlay = warps[name], rooms = D.parseOverlay(overlay), events = [];
    const cpu = machine([{base: H.BASE, bytes: after.subarray(0, 0xE0000)}, {base: 0x80180000, bytes: overlay}], new Map([
      [0x8010DA48, () => events.push('teleport')], [0x800FD7C0, r => {r[2] = 0;}],
      [0x800F223C, () => events.push('cleanup')], [0x8010FAC4, () => 'stop'], [0x800F4818, () => 'stop'],
      [0x800E4F30, () => 'stop'], [0x800E5324, () => 'stop']
    ]));
    cpu.put(0x80097C00, 4, id); cpu.put(0x80073404, 2, 0);
    cpu.put(0x800978AC, 4, 1); cpu.put(0x8003C784, 4, 0x80180000 + rooms.roomHeaderOffset);
    cpu.run(0x8010F1CC, {5: 0, 20: 0}); cpu.put(0x80097C98, 4, 6);
    cpu.run(0x800F32A0, {3: 6, 2: 6, 19: 4});
    cpu.put(0x800974A0, 4, cpu.run(0x800F16D0)[2]);
    cpu.run(0x800E4D74);
    assert.equal(cpu.get(0x80097918, 4), stage); assert.equal(cpu.get(0x8006BAFC, 4), 3);
    cpu.run(0x800F14CC);
    assert.equal(cpu.get(0x801375BC, 4) >>> 0, 0x80180000 + rooms.roomHeaderOffset + room * 8 + 4);
    assert.deepEqual([cpu.get(0x800733DA, 2), cpu.get(0x800733DE, 2)], [id === 166 ? 192 : 64, 132]);
    assert.deepEqual(events, ['teleport', 'cleanup']);
  }
  for (const index of [0, 7, 37, 38, 39, 60, 0x91A2]) for (const stage of [0, 2, 11, 32, 43])
    for (const busy of [0, 1]) assert.deepEqual(loading(after, index, stage, busy), loading(before, index, stage, busy));
  for (const offset of [G.CAVE, G.HOOK]) {
    const damaged = before.slice(); damaged[offset] ^= 1; assert.throws(() => G.install(damaged));
  }
  console.log('Both missed graphics loads reproduced; corrected room, artwork, loading wait and 70 existing routes passed.');
}
async function verify(dra, warps) {
  const after = G.prepareInstalled(dra); verifyLoading(dra, after, warps);
  for (let n = 0; n < dra.length; n++) if (dra[n] !== after[n])
    assert.ok(n >= G.CAVE && n < G.CAVE + G.helper().length || n >= G.HOOK && n < G.HOOK + 4);
  return after;
}
if (require.main === module) (async () => {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = hash(), disc = await C.DiscImage.open(await fs.openAsBlob(source)), warps = {};
  for (const name of ['WRP', 'RWRP']) warps[name] = await disc.readFile(await disc.findPath(['ST', name, `${name}.BIN`]));
  await verify(await disc.readFile(await disc.findPath(['DRA.BIN'])), warps); assert.equal(hash(), before);
})().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {verify, verifyLoading};
