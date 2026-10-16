const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const C = require('../sotn-core.js');
const T = require('../tools/items/shopcard-return-state.js');
const {machine} = require('./helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || path.resolve(__dirname, '../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const STAGE = 0x800974A0, LEFT = 0x800730B0, TOP = 0x800730B4, MODE = 0x80097914, CHARACTER = 0x8003C9A0, LOAD_FLAG = 0x8003C730;
const RECORDER_DONE = 0x80105430, READER_DONE = 0x800CEB94, ENEMY = 0x80080000;
// Room entry in the Castle Keep save room (TOP 0x27,0x09): the recorder stores stage + 1, left, top.
function record(cpu) {
  cpu.put(MODE, 4, 0); cpu.put(STAGE, 4, 0x0B); cpu.put(LEFT, 4, 0x27); cpu.put(TOP, 4, 0x09);
  cpu.run(T.RECORDER, {});
}
// One call of the second-castle attack helper as RTOP hit detection makes it (s7 = enemy attack data).
function attack(cpu, power = 30, id = 0x20) {
  cpu.put(ENEMY + 2, 2, power); cpu.put(ENEMY - 4, 2, id);
  return cpu.run(T.HELPER, {23: ENEMY})[2];
}
function cpuFor(dra) {
  return machine([{base: T.BASE, bytes: dra}], new Map([[RECORDER_DONE, () => 'stop'], [READER_DONE, () => 'stop']]));
}
async function main() {
  const disc = await C.DiscImage.open(new Blob([fs.readFileSync(source)]));
  const dra = Buffer.from(await disc.readFile(await disc.findPath(T.PATH)));
  let installed = true;
  try { T.verify(dra); } catch { installed = false; }
  const before = installed ? null : dra, after = installed ? dra : T.overlay(dra);
  if (before) {
    const pristine = cpuFor(before), expected = attack(pristine);
    assert.equal(expected, 30 + 200, 'The helper adds 200 to second-castle enemy attacks.');
    const cpu = cpuFor(before); record(cpu);
    assert.deepEqual([0, 4, 8].map(o => cpu.get(T.OLD + o, 4)), [0x0C, 0x27, 0x09], 'The recorder stores the room over the helper.');
    assert.throws(() => attack(cpu), /Unsupported attack instruction c/, 'The overwritten helper reaches syscall / jalr zero.');
  }
  const cpu = cpuFor(after); record(cpu);
  assert.deepEqual([0, 4, 8].map(o => cpu.get(T.NEW + o, 4)), [0x0C, 0x27, 0x09], 'The recorder uses the relocated state.');
  assert.deepEqual(Buffer.from([0, 4, 8].flatMap(o => [...Buffer.from(Uint32Array.of(cpu.get(T.OLD + o, 4)).buffer)])), after.subarray(T.OLD - T.BASE, T.OLD - T.BASE + 12), 'Helper code stays intact.');
  assert.equal(attack(cpu), 230); assert.equal(attack(cpu, 30, 0x15E), 500); assert.equal(attack(cpu, 30, 5), 30); assert.equal(attack(cpu, 0), 0);
  // The Shop Card return reader restores the recorded room from the relocated state.
  cpu.put(CHARACTER, 4, 0); cpu.put(MODE, 4, 0); cpu.put(STAGE, 4, 0x2B); cpu.put(LEFT, 4, 0); cpu.put(TOP, 4, 0); cpu.put(LOAD_FLAG, 4, 0);
  cpu.run(T.READER, {});
  assert.deepEqual([cpu.get(STAGE, 4), cpu.get(LEFT, 4), cpu.get(TOP, 4), cpu.get(LOAD_FLAG, 4)], [0x0B, 0x27, 0x09, 1]);
  // Nothing in DRA other than the patched sites refers to the old or new state words.
  const refs = [];
  for (let o = 0; o + 8 <= after.length && o < 0x9B6A0; o += 4) {
    const w = after.readUInt32LE(o); if (w >>> 26 !== 15) continue;
    for (let k = 1; k <= 20; k++) {
      const x = after.readUInt32LE(o + k * 4), op = x >>> 26;
      if ((x >>> 21 & 31) !== (w >>> 16 & 31) || ![9, 32, 33, 35, 36, 37, 40, 41, 43].includes(op)) continue;
      const v = (((w & 0xFFFF) << 16) + (x << 16 >> 16)) >>> 0;
      if ((v >= T.OLD && v < T.OLD + 12) || (v >= T.NEW && v < T.NEW + 12)) refs.push(T.BASE + o + k * 4);
    }
  }
  assert.deepEqual([...new Set(refs)].sort(), T.SITES.map(s => s.at).sort(), 'Only the relocated sites use the state.');
  console.log(`shopcard-return-state: ${installed ? 'installed image verified' : 'crash reproduced and fix verified'}`);
}
main().catch(e => {console.error(e); process.exit(1);});
