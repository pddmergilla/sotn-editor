const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js'), M = require('../stats-model.js');
const H = require('../tools/weapons/terminus-est.js');
const source = process.env.SOTN_ASS_BIN || (process.env.USERPROFILE + '/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin');

// Check the attack steps.
function machine(code, hooks = new Map()) {
  const memory = new Map();
  const put = (addr, size, value) => { for (let i = 0; i < size; i++) memory.set((addr + i) >>> 0, value >>> (i * 8) & 255); };
  const get = (addr, size) => {
    addr >>>= 0;
    const part = code.find(c => addr >= c.base && addr + size <= c.base + c.bytes.length);
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.has((addr + i) >>> 0) ? memory.get((addr + i) >>> 0) : part ? part.bytes[addr - part.base + i] : 0) << (i * 8);
    return value;
  };
  function run(start, initial = {}) {
    const r = new Int32Array(32); r[29] = 0x801FF000; r[31] = -1;
    for (const [reg, value] of Object.entries(initial)) r[reg] = value;
    let pc = start >>> 0, branch = null, load = null, lo = 0, hi = 0;
    for (let n = 0; n < 20000; n++) {
      if (pc === 0xFFFFFFFF) return r;
      if (hooks.has(pc)) {
        assert.equal(branch, null); assert.equal(load, null);
        if (hooks.get(pc)(r, {get, put}) === 'stop') return r;
        pc = r[31] >>> 0; continue;
      }
      assert.ok(code.some(c => pc >= c.base && pc + 4 <= c.base + c.bytes.length), `Unknown instruction address ${pc.toString(16)}`);
      const w = get(pc, 4) >>> 0, op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
      const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
      let next = null, nextLoad = null, written = null;
      const set = (reg, value) => { r[reg] = value; written = reg; };
      if (op === 0) {
        const f = w & 63, shift = w >>> 6 & 31;
        if (f === 0) set(rd, r[rt] << shift);
        else if (f === 2) set(rd, r[rt] >>> shift);
        else if (f === 3) set(rd, r[rt] >> shift);
        else if (f === 0x21) set(rd, r[rs] + r[rt]);
        else if (f === 0x23) set(rd, r[rs] - r[rt]);
        else if (f === 0x24) set(rd, r[rs] & r[rt]);
        else if (f === 0x25) set(rd, r[rs] | r[rt]);
        else if (f === 0x26) set(rd, r[rs] ^ r[rt]);
        else if (f === 0x2A) set(rd, Number(r[rs] < r[rt]));
        else if (f === 0x2B) set(rd, Number((r[rs] >>> 0) < (r[rt] >>> 0)));
        else if (f === 8 || f === 9) { next = r[rs] >>> 0; if (f === 9) set(rd, pc + 8); }
        else if (f === 0x18) { const v = BigInt(r[rs]) * BigInt(r[rt]); lo = Number(BigInt.asIntN(32, v)); hi = Number(BigInt.asIntN(32, v >> 32n)); }
        else if (f === 0x12) set(rd, lo);
        else if (f === 0x10) set(rd, hi);
        else throw Error(`Unsupported attack instruction ${w.toString(16)}`);
      } else if (op === 15) set(rt, (w & 65535) << 16);
      else if (op === 9) set(rt, r[rs] + imm);
      else if (op === 10) set(rt, Number(r[rs] < imm));
      else if (op === 11) set(rt, Number((r[rs] >>> 0) < (imm >>> 0)));
      else if (op === 12) set(rt, r[rs] & (w & 65535));
      else if (op === 13) set(rt, r[rs] | (w & 65535));
      else if ([32, 33, 35, 36, 37].includes(op)) {
        const size = op === 35 ? 4 : op === 33 || op === 37 ? 2 : 1, value = get(addr, size);
        nextLoad = [rt, op === 32 ? value << 24 >> 24 : op === 33 ? value << 16 >> 16 : value];
      } else if ([40, 41, 43].includes(op)) put(addr, op === 43 ? 4 : op === 41 ? 2 : 1, r[rt]);
      else if (op === 4 || op === 5) { if ((r[rs] === r[rt]) === (op === 4)) next = pc + 4 + imm * 4; }
      else if (op === 6 || op === 7) { if (op === 6 ? r[rs] <= 0 : r[rs] > 0) next = pc + 4 + imm * 4; }
      else if (op === 1) { assert.ok(rt === 0 || rt === 1); if ((r[rs] < 0) === (rt === 0)) next = pc + 4 + imm * 4; }
      else if (op === 2 || op === 3) { if (op === 3) set(31, pc + 8); next = K.branchTarget(w, pc); }
      else throw Error(`Unsupported attack instruction ${w.toString(16)} at ${pc.toString(16)}`);
      if (load && written !== load[0]) r[load[0]] = load[1];
      r[0] = 0; pc = (branch === null ? pc + 4 : branch) >>> 0; branch = next; load = nextLoad;
    }
    throw Error('Attack check did not finish.');
  }
  return {put, get, run, hooks};
}

function selection(dra, item, hand, combo, mp, grounded = true, busy = 0, busyHand = hand) {
  let selected;
  const cpu = machine([{base: 0x800A0000, bytes: dra}], new Map([
    [0x8010EB5C, r => {r[2] = -1;}], [0x800FD688, r => {r[2] = 1;}],
    [0x800E2BA0, () => {}],
    [0x8011AAFC, r => {selected = {row: r[6], factory: r[5]}; return 'stop';}]
  ]));
  cpu.put(0x80072EEC, 4, hand ? 0x20 : 0x80);
  cpu.put(0x80097C00 + hand * 4, 4, item); cpu.put(0x80097BB0, 4, mp);
  cpu.put(0x80072F20, 4, grounded ? 1 : 0);
  cpu.put(0x80138FC8, 2, combo === 'bf' ? 255 : 0);
  cpu.put(0x80138FC4, 2, combo === 'qcf' ? 255 : 0);
  for (let i = 0; i < busy; i++) {
    cpu.put(0x80073F98 + i * 0xBC + 0xAE, 2, H.SPECIAL);
    cpu.put(0x80073F98 + i * 0xBC + 0x30, 2, busyHand << 15);
  }
  cpu.run(0x8010EDB8); assert.ok(selected); return selected;
}

function setup(bytes, hand, dra, equip, row, facing = 0, pose = 0, allocation = 0) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  const events = [];
  const cpu = machine([{base, bytes}], new Map([
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand);
      for (let i = 0; i < 52; i++) put((r[5] >>> 0) + i, 1, dra[equip + r[6] * 52 + i]);
      events.push({row: r[6]});
    }],
    [0x80010010, () => {}], [0x80010020, () => {}],
    [0x80010030, (r, {get}) => {
      events.push({frames: Array.from({length: 7}, (_, i) => get((r[5] >>> 0) + i * 4, 4) >>> 0), props: r[4] >>> 0}); r[2] = 0;
    }],
    [0x80010050, r => {r[2] = allocation;}], [0x80010060, () => {}], [0x80012B24, () => {}]
  ]));
  cpu.put(0x8003C788, 4, 0x80078000);
  for (const [ptr, addr] of [[0x8003C7D0, 0x80010000], [0x8003C804, 0x80010010],
    [0x8003C7DC, 0x80010020], [0x8003C814, 0x80010030], [0x8003C7B8, 0x80010050],
    [0x8003C7B4, 0x80010060]]) cpu.put(ptr, 4, addr);
  cpu.put(0x8006C3B8, 4, self);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x24, 2, 100); cpu.put(player + 0x14, 2, facing);
  cpu.put(player + 0x2C, 2, pose); cpu.put(player + 0x2E, 2, 0);
  cpu.put(player + 0xAC, 1, 65); cpu.put(0x80072F66, 2, 1);
  cpu.put(self + 0xAE, 2, row); cpu.put(self + 0x30, 2, hand << 15 | 2 << 8);
  return {cpu, base, self, player, events};
}

async function main() {
  const original = fs.readFileSync(source), hash = b => crypto.createHash('sha256').update(b).digest('hex');
  const liveHash = hash(original);
  let disc = await C.DiscImage.open(new Blob([original]));
  const liveModel = await M.loadFromDisc(disc, C.normalizeIsoName);
  if (liveModel.get(liveModel.sections.hand[H.TERMINUS].weaponId) === H.OVERLAY) {
    const reportPath = process.env.SOTN_TERMINUS_REPORT || require('node:path').join(require('node:path').dirname(source),
      'Terminus-Est-Crissaegrim-Special-ASS-2.0', 'verification.json');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(liveHash.toUpperCase(), report.result.sha256, 'Supply the prepared reference image or matching patch report.');
    const reverse = fs.readFileSync(report.reversal.path);
    assert.equal(hash(reverse).toUpperCase(), report.reversal.sha256);
    require('../tools/weapons/build-stone-sword-patch.js').apply(original, reverse);
    assert.equal(hash(original).toUpperCase(), report.source.sha256);
    disc = await C.DiscImage.open(new Blob([original]));
  }
  const initial = hash(original);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName), equip = model.tables.equip;
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(r => disc.readFile(r))), prepared = H.prepare(model, weapons);
  for (let i = 0; i < prepared.dra.length; i++) if (prepared.dra[i] !== model.files.DRA.bytes[i])
    assert.ok([15, 16, 23].some(o => i === equip + H.TERMINUS * 52 + o) ||
      i >= equip + H.SPECIAL * 52 + 8 && i < equip + (H.SPECIAL + 1) * 52);
  const opened = M.parse({...model.files, DRA: {...model.files.DRA, bytes: prepared.dra}});
  assert.deepEqual(M.rowUsers(opened, H.SPECIAL), [H.TERMINUS]);
  assert.ok(M.specialRows(opened).some(r => r.index === H.SPECIAL));
  assert.ok(!M.freeSpecialRows(opened).some(r => r.index === H.SPECIAL));
  for (const hand of [0, 1]) {
    const special = selection(prepared.dra, H.TERMINUS, hand, 'bf', 99);
    assert.equal(special.row, H.SPECIAL);
    assert.equal(special.factory >>> 16, 2 + hand * 128);
    assert.equal(special.factory & 65535, 52 + ((hand + 1) << 12));
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'none', 99).row, H.TERMINUS);
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'qcf', 99).row, H.TERMINUS);
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'bf', 0).row, H.SPECIAL);
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'bf', 99, false).row, H.SPECIAL);
    const chain = opened.get(opened.sections.equipRows[H.SPECIAL].chain);
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'bf', 99, true, chain).row, H.TERMINUS);
    assert.equal(selection(prepared.dra, H.TERMINUS, hand, 'bf', 99, true, chain, 1 - hand).row, H.SPECIAL);
    const before = weapons[hand].subarray(H.OVERLAY * H.SLOT + H.CODE, (H.OVERLAY + 1) * H.SLOT);
    const sword = weapons[hand].subarray(H.CODE, H.CODE + H.LENGTH);
    const after = prepared.weapons[hand].subarray(H.OVERLAY * H.SLOT + H.CODE, (H.OVERLAY + 1) * H.SLOT);
    for (const facing of [0, 1]) for (const pose of [0, 1, 2, 4]) {
      const normal = [setup(sword, hand, prepared.dra, equip, H.TERMINUS, facing, pose),
        setup(after, hand, prepared.dra, equip, H.TERMINUS, facing, pose)];
      for (let v = 0; v < 2; v++) normal[v].cpu.run(K.u32(v ? after : sword, 0), {4: normal[v].self});
      for (const [off, size] of [[0, 4], [4, 4], [0x14, 2], [0x24, 2], [0x34, 4], [0x40, 2],
        [0x42, 2], [0x49, 1], [0x58, 2], [0x6A, 2], [0xAC, 1], [0xAE, 2]])
        assert.equal(normal[1].cpu.get(normal[1].self + off, size), normal[0].cpu.get(normal[0].self + off, size));
      assert.equal(normal[1].cpu.get(normal[1].self + 0x54, 2), hand ? 0x8013 : 0x8011);
      assert.equal(normal[1].cpu.get(normal[1].self + 0x16, 2), 0x11E + hand * 24);
      assert.equal(normal[1].cpu.get(0x80078000 + (hand ? 0x4C : 0x44), 4) >>> 0, normal[1].base + H.BANK);
      assert.deepEqual(normal[1].events.find(e => e.frames).frames.map(a => a - normal[1].base - H.DATA + 0xEA4),
        normal[0].events.find(e => e.frames).frames.map(a => a - normal[0].base));
      const slashes = [setup(before, hand, prepared.dra, equip, H.SPECIAL, facing, pose),
        setup(after, hand, prepared.dra, equip, H.SPECIAL, facing, pose)];
      for (let frame = 0; frame < 12; frame++) {
        for (let v = 0; v < 2; v++) slashes[v].cpu.run(K.u32(v ? after : before, 0), {4: slashes[v].self});
        for (let off = 0; off < 0xBC; off++) assert.equal(slashes[1].cpu.get(slashes[1].self + off, 1), slashes[0].cpu.get(slashes[0].self + off, 1));
        for (let off = 0; off < 52; off++) assert.equal(slashes[1].cpu.get(0x80076FEC + off, 1), slashes[0].cpu.get(0x80076FEC + off, 1));
      }
      const failure = setup(after, hand, prepared.dra, equip, H.SPECIAL, facing, pose, -1);
      failure.cpu.run(K.u32(after, 0), {4: failure.self});
      assert.equal(failure.cpu.get(failure.self, 4), 0);
    }
    for (const selector of [0, 1, 2, 3, 4, 5, 6]) {
      const pal = setup(after, hand, prepared.dra, equip, H.TERMINUS);
      pal.cpu.run(K.u32(after, 0x1C), {4: selector});
      const addr = selector === 6 ? H.PAL : K.u32(before, 0xAB0 + selector * 4) - pal.base;
      for (let i = 0; i < 768; i++) assert.equal(pal.cpu.get(0x8006EDCC + hand * 768 + i, 1), after[addr + i]);
    }
    assert.deepEqual(after.subarray(0xE6C, 0x1484), before.subarray(0xE6C, 0x1484));
    assert.deepEqual(prepared.weapons[hand].subarray(0, H.SLOT), weapons[hand].subarray(0, H.SLOT));
    for (let i = 0; i < weapons[hand].length; i++) if (weapons[hand][i] !== prepared.weapons[hand][i])
      assert.ok(i >= H.OVERLAY * H.SLOT && i < (H.OVERLAY + 1) * H.SLOT);
    for (let frame = 1; frame <= 80; frame++) {
      const old = K.u32(sword, 0x40 + frame * 4) - (hand ? 0x8017D000 : 0x8017A000);
      const now = K.u32(after, H.BANK + frame * 4) - (hand ? 0x8017D000 : 0x8017A000);
      for (let y = K.u16(sword, old + 18); y < K.u16(sword, old + 22); y++)
        for (let x = K.u16(sword, old + 16); x < K.u16(sword, old + 20); x++) {
          const dst = H.OVERLAY * H.SLOT + y * 128 + (x + 128 >>> 1);
          assert.equal(prepared.weapons[hand][dst] >> (x % 2 * 4) & 15, weapons[hand][y * 128 + (x >>> 1)] >> (x % 2 * 4) & 15);
        }
      assert.equal(K.u16(after, now + 16), K.u16(sword, old + 16) + 128);
    }
    const broken = weapons[hand].slice(); broken[H.OVERLAY * H.SLOT + H.CODE + H.BANK] ^= 1;
    assert.throws(() => H.weapon(broken, hand), /Unknown/);
  }
  const r = opened.sections.equipRows[H.SPECIAL];
  for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]]) opened.set(r[key], value);
  const tuned = prepared.dra.slice(); M.apply(opened, {DRA: tuned});
  for (const hand of [0, 1]) {
    const after = prepared.weapons[hand].subarray(H.OVERLAY * H.SLOT + H.CODE, (H.OVERLAY + 1) * H.SLOT);
    const s = setup(after, hand, tuned, equip, H.SPECIAL); s.cpu.run(K.u32(after, 0), {4: s.self});
    assert.equal(s.cpu.get(s.self + 0x40, 2), 321); assert.equal(s.cpu.get(s.self + 0x42, 2), 0x2040);
    assert.equal(s.cpu.get(s.self + 0x49, 1), 7); assert.equal(s.cpu.get(s.self + 0x58, 2), 11);
  }
  for (const row of [H.TERMINUS, H.CRISSAEGRIM, 94, 114, 169, 211]) {
    assert.deepEqual(tuned.subarray(equip + row * 52, equip + (row + 1) * 52), prepared.dra.subarray(equip + row * 52, equip + (row + 1) * 52));
  }
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, tuned);
  for (const hand of [0, 1]) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
  changes.sort((a, b) => a.start - b.start);
  for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified);
  const reopened = await M.loadFromDisc(await C.DiscImage.open(C.modifiedBlob(disc.file, changes)), C.normalizeIsoName);
  assert.deepEqual(M.rowUsers(reopened, H.SPECIAL), [H.TERMINUS]);
  for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]])
    assert.equal(reopened.get(reopened.sections.equipRows[H.SPECIAL][key]), value);
  const {ppf, apply} = require('../tools/weapons/build-stone-sword-patch.js');
  const patch = ppf(changes, original.subarray(0x9320, 0x9720), 'Terminus Est test');
  const built = Buffer.from(original); apply(built, patch);
  assert.deepEqual(built, Buffer.from(await C.modifiedBlob(disc.file, changes).arrayBuffer()));
  apply(built, patch, true); assert.equal(hash(built), initial);
  assert.equal(hash(fs.readFileSync(source)), liveHash);
  console.log('Terminus Est: both hands, combo selection, native MP behavior, chain limits, original slash, Crissaegrim frame parity, palettes, artwork, private stats, exports and guards passed');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
