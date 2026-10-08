const assert = require('node:assert/strict'), fs = require('node:fs'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), D = require('../disc-stage.js'), K = require('../stats-core.js');
const H = require('../tools/items/warp-cards.js'), L = require('../tools/items/warp-card-location.js');
const {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
async function loadFiles(disc) {
  const files = [];
  for (const name of ['TOP', 'RTOP', 'WRP', 'RWRP']) {
    const record = await disc.findPath(['ST', name, `${name}.BIN`]);
    const graphics = await disc.findPath(['ST', name, `F_${name}.BIN`]);
    files.push({name, record, graphics, bytes: await disc.readFile(record)});
  }
  return files;
}
function selectedFile(cpu, files) {
  cpu.run(0x8010848C);
  const lba = cpu.get(0x800ACC34, 4), size = cpu.get(0x800ACC3C, 4);
  const file = files.find(f => f.record.extent === lba && f.record.size === size);
  assert.ok(file, `Unknown requested area at sector ${lba}.`);
  cpu.run(0x8010858C, {18: 0x800ACB00});
  assert.equal(cpu.get(0x800ACB00, 4), file.graphics.extent, 'Artwork must match the loaded area.');
  return file;
}
function arrival(bytes, files, id, hand, origin, expected) {
  const events = [], code = [{base: H.BASE, bytes: bytes.subarray(0, 0xE0000)}];
  const cpu = machine(code, new Map([
    [0x8010DA48, () => events.push('teleport')], [0x800FD7C0, r => {r[2] = 0;}],
    [0x800F223C, () => events.push('cleanup')], [0x8010FAC4, () => 'stop'], [0x800F4818, () => 'stop'],
    [0x800E4F30, () => 'stop'], [0x800E5324, () => 'stop'], [0x8010871C, () => 'stop'], [0x801085C0, () => 'stop'],
    [0x800F2B40, () => 'stop'], [0x800F2DE0, () => 'stop']
  ]));
  cpu.put(0x80097C00 + hand * 4, 4, id); cpu.put(0x800974A0, 4, origin);
  cpu.put(0x80073404, 2, 0); cpu.put(0x800978AC, 4, 1);
  cpu.put(0x8009798A + id, 1, 7); cpu.put(0x80097BB0, 4, 0);
  cpu.run(0x8010F1CC, {5: hand, 20: hand}); cpu.put(0x80097C98, 4, 6);
  cpu.run(0x800F32A0, {3: 6, 2: 6, 19: 4});
  cpu.put(0x800974A0, 4, cpu.run(0x800F16D0)[2]); cpu.run(0x800E4D74);
  const file = selectedFile(cpu, files), overlay = D.parseOverlay(file.bytes);
  code.push({base: 0x80180000, bytes: file.bytes});
  cpu.put(0x8003C784, 4, K.u32(file.bytes, 16)); cpu.put(0x8003C794, 4, K.u32(file.bytes, 32));
  cpu.put(0x800974A0, 4, cpu.run(0x800F16D0)[2]);
  // Load the requested room and its map.
  cpu.run(0x800F2B20); cpu.run(0x800F2C9C);
  const pointer = cpu.get(0x801375BC, 4) >>> 0;
  const roomIndex = (pointer - 0x80180000 - overlay.roomHeaderOffset - 4) / 8;
  const result = {area: file.name, room: roomIndex, map: [cpu.get(0x8009791C, 4), cpu.get(0x80097920, 4)],
    spawn: [cpu.get(0x800733DA, 2), cpu.get(0x800733DE, 2)],
    layout: cpu.get(pointer + 3, 1), layer: cpu.get(pointer, 1)};
  assert.deepEqual(events, ['teleport', 'cleanup']);
  assert.equal(cpu.get(0x8009798A + id, 1), 7); assert.equal(cpu.get(0x80097BB0, 4), 0);
  if (expected) {
    assert.deepEqual(result, expected);
    assert.equal(cpu.get(0x800730B0, 4), expected.map[0]); assert.equal(cpu.get(0x800730B4, 4), expected.map[1]);
    assert.equal(cpu.get(0x800730C8, 4), 256); assert.equal(cpu.get(0x800730CC, 4), 256);
  }
  return result;
}
async function verify(dra, files) {
  const after = L.prepareInstalled(dra);
  // Reproduce the real area requests.
  assert.equal(arrival(dra, files, 166, 0, 2).area, 'TOP');
  assert.equal(arrival(dra, files, 27, 0, 34).area, 'RTOP');
  verifyDestinations(after, files);
  const edits = [];
  for (let n = 0; n < dra.length; n++) if (dra[n] !== after[n]) edits.push(n);
  assert.deepEqual(edits, [H.SCORPION_RECORD + 8, H.NOIL_RECORD + 8]);
  for (const offset of [H.SCORPION_RECORD + 8, H.NOIL_RECORD + 8, H.HOOK]) {
    const damaged = new Uint8Array(dra); damaged[offset] ^= 1; assert.throws(() => L.prepareInstalled(damaged));
  }
  return after;
}
function verifyDestinations(after, files) {
  assert.ok(files, 'Supply disc records for real area selection.');
  const destinations = [
    [166, {area: 'WRP', room: 2, map: [59, 17], spawn: [192, 132], layer: 2, layout: 3}],
    [27, {area: 'RWRP', room: 0, map: [23, 51], spawn: [64, 132], layer: 0, layout: 1}]
  ];
  let cases = 0;
  for (const [id, expected] of destinations) for (const hand of [0, 1])
    for (const origin of [0, 2, 11, 14, 32, 34, 43, 46, 65]) {
      arrival(after, files, id, hand, origin, expected); cases++;
    }
  console.log(`${cases} arrivals passed through native disc file selection, artwork, room layers and final map coordinates.`);
}
if (require.main === module) (async () => {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = hash(), disc = await C.DiscImage.open(await fs.openAsBlob(source));
  await verify(await disc.readFile(await disc.findPath(['DRA.BIN'])), await loadFiles(disc)); assert.equal(hash(), before);
})().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {verify, loadFiles, arrival, verifyDestinations};
