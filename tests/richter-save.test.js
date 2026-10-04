const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../sotn-core.js'), H = require('../extra-hacks-ui.js');
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(require.resolve('../extra-hacks-catalog.js'), 'utf8'), context);
const catalog = H.prepareCatalog(context.window.SotnExtraHacks);
const feature = catalog.features.find(f => f.id === 'richter-save');
const name = 'BOSS/BO6/BO6.BIN', base = 0x80180000, ric = 0x800762D8, orb = 0x80077A58;
const signal = 0x801D169C, flags = 0x801D11C4, scene = 0x80181278;
const sources = [process.env.SOTN_VANILLA_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin',
  process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin',
  process.env.SOTN_ASS_OLD_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night Alter.bin'];

// Follow the actual game instructions.
function run(bytes, start, memory, initial = {}, stops = [], calls = new Map()) {
  const r = new Int32Array(32); r[29] = 0x801FFF00; r[31] = -1;
  for (const [reg, value] of Object.entries(initial)) r[reg] = value;
  const get = (addr, size) => {
    addr >>>= 0;
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.has(addr + i) ? memory.get(addr + i) :
      addr + i >= base && addr + i < base + bytes.length ? bytes[addr + i - base] : 0) << (i * 8);
    return value;
  };
  const put = (addr, size, value) => {
    for (let i = 0; i < size; i++) memory.set((addr >>> 0) + i, value >>> (i * 8) & 255);
  };
  let pc = start >>> 0, branch = null, load = null;
  for (let step = 0; step < 2000; step++) {
    if (pc === 0xFFFFFFFF || stops.includes(pc)) return {pc, r, get, put};
    if (calls.has(pc)) {
      if (calls.get(pc)({r, get, put}) === false) return {pc, r, get, put};
      pc = r[31] >>> 0;
      continue;
    }
    const w = get(pc, 4) >>> 0, op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
    const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
    let next = null, nextLoad = null;
    if (op === 0) {
      const fn = w & 63, shift = w >>> 6 & 31;
      if (fn === 0) r[rd] = r[rt] << shift;
      else if (fn === 2) r[rd] = r[rt] >>> shift;
      else if (fn === 3) r[rd] = r[rt] >> shift;
      else if (fn === 0x21) r[rd] = r[rs] + r[rt];
      else if (fn === 0x23) r[rd] = r[rs] - r[rt];
      else if (fn === 0x24) r[rd] = r[rs] & r[rt];
      else if (fn === 0x25) r[rd] = r[rs] | r[rt];
      else if (fn === 0x26) r[rd] = r[rs] ^ r[rt];
      else if (fn === 0x27) r[rd] = ~(r[rs] | r[rt]);
      else if (fn === 0x2A) r[rd] = Number(r[rs] < r[rt]);
      else if (fn === 8) next = r[rs] >>> 0;
      else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    } else if (op === 15) r[rt] = (w & 65535) << 16;
    else if (op === 9) r[rt] = r[rs] + imm;
    else if (op === 11) r[rt] = Number((r[rs] >>> 0) < (imm >>> 0));
    else if (op === 12) r[rt] = r[rs] & (w & 65535);
    else if (op === 13) r[rt] = r[rs] | (w & 65535);
    else if ([33, 35, 36, 37].includes(op)) {
      const size = op === 35 ? 4 : op === 36 ? 1 : 2;
      const value = get(addr, size);
      nextLoad = [rt, op === 33 ? value << 16 >> 16 : value];
    } else if ([40, 41, 43].includes(op)) put(addr, op === 40 ? 1 : op === 41 ? 2 : 4, r[rt]);
    else if (op === 4) { if (r[rs] === r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 5) { if (r[rs] !== r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 1 && rt === 1) { if (r[rs] >= 0) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 2 || op === 3) {
      if (op === 3) r[31] = pc + 8;
      next = ((pc & 0xF0000000) | (w & 0x3FFFFFF) << 2) >>> 0;
    } else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    if (load) r[load[0]] = load[1];
    r[0] = 0;
    pc = branch === null ? (pc + 4) >>> 0 : branch;
    branch = next; load = nextLoad;
  }
  throw Error('The checked game path did not finish.');
}

function toggle(bytes, profile, selected) {
  const files = new Map([[name, bytes]]), info = H.featureState(feature, files, profile);
  const analysis = {profile, features: [{id: feature.id, ...info, context: true}]};
  const after = bytes.slice();
  H.applyEdits({before: bytes, after}, H.plan(catalog, analysis, new Map([[feature.id, selected]])), name);
  return after;
}

(async () => {
  let count = 0;
  for (const source of sources) {
    if (!fs.existsSync(source)) { console.log(`Missing image; skipped: ${source}`); continue; }
    const profile = source === sources[0] ? 'vanilla' : 'ass';
    const disc = await C.DiscImage.open(await fs.openAsBlob(source)), record = await disc.findPath(name.split('/'));
    const original = await disc.readFile(record), before = toggle(original, profile, false), after = toggle(before, profile, true);
    assert.equal(H.featureState(feature, new Map([[name, after]]), profile).state, 'on');
    assert.deepEqual(toggle(after, profile, false), before);
    const old = before.slice();
    feature.onVersions[0].forEach((bytes, i) => old.set(bytes, feature.edits[i].offset));
    assert.equal(H.featureState(feature, new Map([[name, old]]), profile).version, 1);
    assert.deepEqual(toggle(old, profile, true), old, 'An unchanged older selection preserves its bytes');
    assert.deepEqual(toggle(old, profile, false), before, 'Remove the earlier sitting-only patch');
    assert.deepEqual(toggle(toggle(old, profile, false), profile, true), after, 'Re-add installs the fix');
    for (const edit of feature.edits) {
      const broken = after.slice(); broken[edit.offset + edit.on.length - 1] ^= 1;
      assert.equal(H.featureState(feature, new Map([[name, broken]]), profile).state, 'unknown');
    }
    for (const edit of feature.edits) {
      const partial = before.slice(); partial.set(edit.on, edit.offset);
      assert.equal(H.featureState(feature, new Map([[name, partial]]), profile).state, 'mixed', 'Reject incomplete installs');
    }
    for (let i = 0; i < before.length; i++) {
      if (!feature.edits.some(e => i >= e.offset && i < e.offset + e.on.length)) assert.equal(after[i], before[i]);
    }
    const change = await C.changedSectors(disc, record, original, after);
    const output = await C.DiscImage.open(C.modifiedBlob(disc.file, change));
    assert.deepEqual(await output.readFile(await output.findPath(name.split('/'))), after);
    for (const sector of change) assert.deepEqual(C.repairSector(sector.modified.slice(), disc.dataOffset), sector.modified);
    assert.deepEqual(await disc.readFile(record), original, 'Keep the source intact');
    const memory = new Map(), access = run(after, 0xFFFFFFFF, memory), {get, put} = access;
    put(ric + 0x2C, 2, 1); put(ric + 0x34, 4, 0x100);
    run(after, base + 0x353AC, memory, {4: ric + 0x2C}, [base + 0x354FC]);
    assert.equal(get(ric + 0x2C, 2), 0x70, 'Lethal damage enters the saved pose');
    const factories = [], calls = new Map([[0x801BBDC0, ({r}) => { factories.push(r[5]); }],
      [0x801ACF6C, ({r, put}) => { assert.equal(r[4] >>> 0, orb); put(orb + 0x26, 2, 0); }]]);
    put(orb + 0x2C, 2, 2); put(orb + 0x34, 4, 0); put(orb + 0x26, 2, 1);
    run(after, base + 0x403E8, memory, {4: orb}, [base + 0x40874], calls);
    assert.equal(get(signal, 4), 1, 'Orb death emits the rescue signal');
    assert.equal(get(orb + 0x2C, 2), 21);
    assert.deepEqual(factories, [0x49, 0x4B], 'Use the normal orb effects and cutscene actors');
    const handoff = new Map([[0x801B5A14, ({r, put}) => { assert.equal(r[4], 0x28); put(0x801CF3C8, 4, 0x28); return false; }]]);
    run(after, base + 0x35A2C, memory, {}, [], handoff);
    assert.equal(get(0x801CF3C8, 4), 0x28, 'The actual installed AI accepts the rescue signal');
    run(after, base + 0x403E8, memory, {4: orb}, [base + 0x40D5C], calls);
    assert.equal(get(signal, 4), 0, 'The rescue signal lasts one update');
    assert.equal(get(orb + 0x26, 2), 0, 'The orb is destroyed');
    assert.deepEqual(factories, [0x49, 0x4B], 'The rescue actors are created once');
    put(scene, 4, 40); put(flags, 4, 0x40);
    run(after, base + 0x36998, memory);
    assert.equal(get(flags, 4), 0x48, 'The native dialogue handoff keeps other cutscene flags');
    for (const [richterDead, orbDead, step, hit] of [[0, 0, 2, 0], [0, 0, 2, 2], [0, 0, 10, 0], [0, 0x100, 2, 0], [0x100, 0, 2, 0]]) {
      const mem = new Map(), a = run(after, 0xFFFFFFFF, mem);
      a.put(ric + 0x34, 4, richterDead); a.put(orb + 0x34, 4, orbDead); a.put(orb + 0x2C, 2, step); a.put(orb + 0x48, 1, hit);
      const result = run(after, base + 0x403E8, mem, {4: orb}, [base + 0x4048C]);
      assert.equal(result.get(signal, 4), richterDead || orbDead ? 1 : 0);
      assert.equal(result.get(orb + 0x2C, 2), richterDead || orbDead ? 20 : hit ? 10 : step);
    }
    // Reproduce the earlier failure.
    const failed = new Map(), f = run(old, 0xFFFFFFFF, failed);
    f.put(ric + 0x34, 4, 0x100); f.put(orb + 0x2C, 2, 2);
    run(old, base + 0x403E8, failed, {4: orb}, [base + 0x4048C]);
    assert.equal(f.get(signal, 4), 0, 'The old jump never starts the rescue');
    console.log(`Richter rescue instructions, upgrade and exported sectors passed: ${source}`); count++;
  }
  assert(count > 0, 'Supply a reference image for the game-code checks');
})().catch(error => { console.error(error); process.exitCode = 1; });
