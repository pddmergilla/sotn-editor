const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const C = require('../sotn-core.js');
const K = require('../stats-core.js');
const H = require('../tools/extra-hacks/damage-number-colors.js');
const {machine} = require('./helpers/mips.js');
const spec = require('../tools/extra-hacks/specs/damage-colors.json');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image])), files = new Map(), records = new Map();
  for (const name of new Set(spec.edits.map(e => e.file))) {
    const record = await disc.findPath(name.split('/'));
    records.set(name, record); files.set(name, await disc.readFile(record));
  }
  return {disc, files, records};
}

function verify(files, after) {
  const dra = files.get('DRA.BIN'), patched = after.get('DRA.BIN');
  let cases = 0;
  for (const crit of [0, 255]) for (const element of [0, 0x20, 0x40, 0x8000, 0xA000, 0x8020]) {
    for (const weak of [0, 0x20, 0x8000, 0xA000]) for (const resist of [0, 0x20, 0x8000, 0xA000]) {
      for (const immune of [0, element || 0x20]) for (const absorb of [0, element || 0x20]) {
        const results = [];
        for (const bytes of [dra, patched]) {
          const hooks = new Map([[0x800FD7C0, r => {r[2] = 0;}], [0x800160E4, r => {r[2] = 127;}], [0x80018F14, r => {r[2] = 4;}]]);
          const m = machine([{base: H.BASE, bytes}], hooks);
          const enemy = 0x801E0000, attacker = enemy + 0x100;
          m.put(enemy + 0x3A, 2, 0);
          for (const [offset, value] of [[0xA, 7], [0xE, weak], [0x10, resist], [0x12, immune], [0x14, absorb]]) m.put(H.BASE + 0x8900 + offset, 2, value);
          m.put(attacker + 0x40, 2, 123); m.put(attacker + 0x42, 2, element); m.put(attacker + 0x32, 2, crit);
          m.put(0x800CE3B0, 1, 2);
          const result = m.run(H.BASE + 0x5F128, {4: enemy, 5: attacker});
          assert.equal(result[29] >>> 0, 0x801FF000);
          results.push(result[2] & 65535);
          if (bytes === patched) {
            const attack = element || 0x20, mask = attack & 0xFF80 ? 0xFF80 : 0x7F, masked = attack & mask;
            const flag = attack & weak ? 1 : masked === (masked & resist & mask) ? 2 : 0;
            assert.equal(m.get(0x800CE3B0, 1), flag, JSON.stringify({element, weak, resist, immune, absorb, crit}));
          }
        }
        assert.equal(results[0], results[1], 'Damage or healing changed.'); cases++;
      }
    }
  }
  const m = machine([{base: H.BASE, bytes: patched}]);
  const entity = 0x801E0000, returnAddress = 0x801F0000;
  for (const group of [0, 2, 4, 6]) for (const flag of [0, 1, 2, 3]) for (const frame of [0, 1]) {
    m.put(entity + 0x86, 1, flag);
    m.hooks.set(returnAddress, () => 'stop'); m.hooks.set(returnAddress + 20, () => 'stop');
    const regs = m.run(H.BASE + 0x2EAC0, {3: group | frame, 16: entity, 31: returnAddress, 8: 0x77});
    const selected = group !== 6 && [1, 2].includes(flag);
    assert.equal(regs[3], group); assert.equal(regs[31] >>> 0, returnAddress + (selected ? 20 : 0));
    if (selected) assert.equal(regs[8], flag === 1 ? 0x18D : 0x18E);
    cases++;
  }
  const spawn = machine([{base: H.BASE, bytes: patched}]);
  for (const flag of [0, 1, 2]) {
    spawn.put(0x800CE3B0, 1, flag); spawn.put(0x801FF010, 2, 0x807B);
    const regs = spawn.run(H.BASE + 0x2EB0C, {17: entity});
    assert.equal(regs[7] & 65535, 0x807B); assert.equal(spawn.get(entity + 0x86, 1), flag); assert.equal(spawn.get(0x800CE3B0, 1), 0); cases++;
  }
  const oldGfx = files.get('BIN/F_GAME.BIN'), gfx = after.get('BIN/F_GAME.BIN');
  for (let n = 0; n < 32; n++) {
    const old = K.u16(oldGfx, 0x411A0 + n * 2), value = K.u16(gfx, 0x411A0 + n * 2);
    assert.equal(old & 0x8000, value & 0x8000);
    if (!(n % 16)) assert.equal(value, old);
    else if (n < 16) assert.equal(value & 0x7FE0, 0);
    else { const level = value & 31; assert.equal(value >>> 5 & 31, level); assert.equal(value >>> 10 & 31, level); assert.ok(level <= 18); }
  }
  for (const [file, bytes] of after) {
    const before = files.get(file);
    for (let at = 0; at < bytes.length; at++) if (bytes[at] !== before[at]) {
      assert.ok(file === 'DRA.BIN' ? at >= H.HOOK && at < H.HOOK + 4 || at >= 0x2EAC0 && at < 0x2EB0C || at >= H.CAVE && at < H.CAVE + H.affinity().length : at >= 0x411A2 && at < 0x411E0);
    }
  }
  const occupied = new Map(files); const bad = dra.slice(); bad[H.CAVE] = 1; occupied.set('DRA.BIN', bad); assert.throws(() => H.prepare(occupied));
  return {cases, overlays: files.size - 2};
}

async function main() {
  const {files} = await inspect(await fs.readFile(source));
  console.log(JSON.stringify(verify(files, H.prepare(files))));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect, verify};
