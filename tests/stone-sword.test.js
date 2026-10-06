const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js'), M = require('../stats-model.js');
const H = require('../tools/weapons/stone-sword.js');
const home = process.env.USERPROFILE || process.env.HOME || '';
const source = process.env.SOTN_ASS_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;

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

function selection(dra, item, hand, combo, mp, grounded = true, busyHand = null) {
  let selected = null;
  const hooks = new Map([
    [0x8010EB5C, r => {r[2] = -1;}],
    [0x800FD688, r => {r[2] = 1;}],
    [0x800E2BA0, () => {}],
    [0x8011AAFC, r => {selected = {row: r[6], factory: r[5]}; return 'stop';}]
  ]);
  const cpu = machine([{base: 0x800A0000, bytes: dra}], hooks);
  cpu.put(0x80072EEC, 4, hand ? 0x20 : 0x80);
  cpu.put(0x80097C00 + hand * 4, 4, item);
  cpu.put(0x80097BB0, 4, mp);
  cpu.put(0x80072F20, 4, grounded ? 1 : 0);
  cpu.put(0x80138FC4, 2, combo ? 0xFF : 0);
  if (busyHand !== null) {
    cpu.put(0x80073F98 + 0xAE, 2, H.SPECIAL);
    cpu.put(0x80073F98 + 0x30, 2, busyHand ? 0x8000 : 0);
  }
  cpu.run(0x8010EDB8); assert.ok(selected);
  return selected;
}

function setup(bytes, hand, dra, equip, row = H.STONE) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  const events = [];
  const hooks = new Map([
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand);
      for (let i = 0; i < 52; i++) put((r[5] >>> 0) + i, 1, dra[equip + r[6] * 52 + i]);
    }],
    [0x80010010, () => {}], [0x80010020, () => {}],
    [0x80010030, (r, {get}) => {
      events.push({frames: Array.from({length: 7}, (_,i) => get((r[5] >>> 0) + i * 4, 4) >>> 0), props: r[4] >>> 0});
      r[2] = 0;
    }],
    [0x80010040, r => {events.push({factory: r[5] >>> 0}); r[2] = 0x80076000;}],
    [0x80010050, r => {r[2] = 0;}],
    [0x80012B24, () => {}]
  ]);
  const cpu = machine([{base, bytes}], hooks);
  cpu.put(0x8003C788, 4, 0x80078000);
  for (const [ptr, addr] of [[0x8003C7D0, 0x80010000], [0x8003C804, 0x80010010],
    [0x8003C7DC, 0x80010020], [0x8003C814, 0x80010030], [0x8003C7F4, 0x80010040], [0x8003C7B8, 0x80010050]]) cpu.put(ptr, 4, addr);
  cpu.put(0x8006C3B8, 4, self);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x24, 2, 100);
  cpu.put(self + 0xAE, 2, row); cpu.put(self + 0x30, 2, hand << 15 | 3 << 8);
  cpu.put(0x80072F66, 2, 1); cpu.put(player + 0xAC, 1, 167);
  return {cpu, base, self, player, events};
}

async function main() {
  const original = fs.readFileSync(source);
  const hash = b => crypto.createHash('sha256').update(b).digest('hex');
  const initial = hash(original), disc = await C.DiscImage.open(new Blob([original]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName), equip = model.tables.equip;
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(r => disc.readFile(r))), prepared = H.prepare(model, weapons);
  for (let i = 0; i < prepared.dra.length; i++) if (prepared.dra[i] !== model.files.DRA.bytes[i])
    assert.ok(i === equip + H.STONE * 52 + 15 || i === equip + H.STONE * 52 + 24);
  for (const hand of [0, 1]) {
    assert.equal(selection(prepared.dra, H.STONE, hand, true, 70).row, H.SPECIAL);
    assert.equal(selection(prepared.dra, H.STONE, hand, true, 69).row, H.STONE);
    assert.equal(selection(prepared.dra, H.STONE, hand, false, 99).row, H.STONE);
    assert.equal(selection(prepared.dra, H.STONE, hand, true, 99, false).row, H.STONE);
    assert.equal(selection(prepared.dra, H.STONE, hand, true, 99, true, hand).row, H.STONE);
    assert.equal(selection(prepared.dra, H.STONE, hand, true, 99, true, 1 - hand).row, H.SPECIAL);
    const special = selection(prepared.dra, H.STONE, hand, true, 70);
    assert.equal(special.factory & 65535, 86 + ((hand + 1) << 12));
    const before = weapons[hand].subarray(H.MEDUSA * H.SLOT + H.CODE, (H.MEDUSA + 1) * H.SLOT);
    const sword = weapons[hand].subarray(H.SWORD * H.SLOT + H.CODE, (H.SWORD + 1) * H.SLOT);
    const after = prepared.weapons[hand].subarray(H.MEDUSA * H.SLOT + H.CODE, (H.MEDUSA + 1) * H.SLOT);
    for (const facing of [0, 1]) for (const pose of [0, 1, 2, 4]) {
      const states = [setup(sword, hand, prepared.dra, equip), setup(after, hand, prepared.dra, equip)];
      for (let version = 0; version < 2; version++) {
        const s = states[version]; s.cpu.put(s.player + 0x14, 2, facing);
        s.cpu.put(s.player + 0x2C, 2, pose); s.cpu.put(s.player + 0x28, 2, 1);
        s.cpu.run(K.u32(version ? after : sword, 0), {4: s.self});
        assert.equal(s.cpu.get(s.self + 0x2C, 2), 1);
        assert.equal(s.events.length, 1);
      }
      for (const [off, size] of [[0,4],[4,4],[0x14,2],[0x24,2],[0x34,4],[0x40,2],[0x42,2],
        [0x49,1],[0x58,2],[0x6A,2],[0xAC,1],[0xAE,2]])
        assert.equal(states[1].cpu.get(states[1].self + off,size), states[0].cpu.get(states[0].self + off,size));
      assert.equal(states[1].cpu.get(states[1].self + 0x54,2), hand ? 0x8013 : 0x8011);
      assert.equal(states[1].cpu.get(states[1].self + 0x16,2), 0x124 + hand * 24);
      assert.equal(states[1].cpu.get(0x80078000 + (hand ? 0x4C : 0x44),4) >>> 0, states[1].base + H.BANK);
      assert.deepEqual(states[1].events[0].frames.map(addr => addr - states[1].base - H.DATA + 0x5A4),
        states[0].events[0].frames.map(addr => addr - states[0].base));
    }
    const paletteStates = [setup(before,hand,prepared.dra,equip),setup(after,hand,prepared.dra,equip)];
    for (const s of paletteStates) s.cpu.run(K.u32(s === paletteStates[0] ? before : after,0x1C), {4:0});
    for (let i = 0; i < 768; i++) {
      const addr = 0x8006EDCC + hand * 768 + i;
      assert.equal(paletteStates[1].cpu.get(addr,1), i >= 640 && i < 672 ? sword[0x504 + i - 640] : paletteStates[0].cpu.get(addr,1));
    }
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i])
      assert.ok(i < 4 || i >= 0xE00 && i < 0xE08 || i >= H.BANK);
    assert.deepEqual(after.subarray(0x1638,0x26E8), before.subarray(0x1638,0x26E8));
    const spell = setup(after,hand,prepared.dra,equip,H.SPECIAL);
    spell.cpu.put(spell.self + 0x30,2,hand << 15);
    spell.cpu.run(K.u32(after,0x20),{4:spell.self});
    assert.equal(spell.cpu.get(spell.self + 0x2C,2),1);
    spell.cpu.put(spell.self + 0x2C,2,3); spell.cpu.put(spell.self + 0x82,2,152);
    spell.cpu.run(K.u32(after,0x20),{4:spell.self});
    assert.ok(spell.events.some(e=>e.factory === 98 + ((hand+1)<<14)));
    const damage = setup(after,hand,prepared.dra,equip,H.SPECIAL), parent = 0x80076000;
    damage.cpu.put(damage.self + 0x8C,4,parent); damage.cpu.put(parent + 0x26,2,0xE9 + hand * 16);
    damage.cpu.put(parent + 0xAE,2,H.SPECIAL);
    damage.cpu.run(K.u32(after,0x28),{4:damage.self});
    assert.equal(damage.cpu.get(damage.self + 0xAE,2),H.SPECIAL);
    assert.equal(damage.cpu.get(damage.self + 0x40,2),model.get(model.sections.equipRows[H.SPECIAL].attack));
    assert.equal(damage.cpu.get(damage.self + 0x42,2),model.get(model.sections.equipRows[H.SPECIAL].element));
    for (let y=0;y<40;y++) assert.deepEqual(prepared.weapons[hand].subarray(H.MEDUSA*H.SLOT+(y+80)*128+64,H.MEDUSA*H.SLOT+(y+80)*128+124),
      weapons[hand].subarray(H.SWORD*H.SLOT+y*128,H.SWORD*H.SLOT+y*128+60));
    const damaged=weapons[hand].slice(); damaged[H.MEDUSA*H.SLOT+H.CODE+H.BANK]^=1;
    assert.throws(()=>H.weapon(damaged,hand),/Unknown/);
  }
  const changes=await C.changedSectors(disc,model.files.DRA.record,model.files.DRA.bytes,prepared.dra);
  for(const hand of [0,1]) changes.push(...await C.changedSectors(disc,records[hand],weapons[hand],prepared.weapons[hand]));
  for(const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(),24),c.modified);
  const reopened=await M.loadFromDisc(await C.DiscImage.open(C.modifiedBlob(disc.file,changes)),C.normalizeIsoName);
  assert.equal(reopened.get(reopened.sections.hand[H.STONE].specialMove),H.SPECIAL);
  assert.equal(reopened.get(reopened.sections.hand[H.STONE].weaponId),H.MEDUSA);
  assert.ok(M.specialRows(reopened).some(r=>r.index===H.SPECIAL));
  assert.ok(!M.freeSpecialRows(reopened).some(r=>r.index===H.SPECIAL));
  assert.deepEqual(M.comboSpells(reopened).find(s=>s.index===H.SPECIAL).casters,[13]);
  const spellRow = reopened.sections.equipRows[H.SPECIAL];
  reopened.set(spellRow.mp,13); reopened.set(spellRow.attack,321);
  const tuned=prepared.dra.slice(); M.apply(reopened,{DRA:tuned});
  assert.equal(selection(tuned,H.STONE,0,true,12).row,H.STONE);
  assert.equal(selection(tuned,H.STONE,0,true,13).row,H.SPECIAL);
  const spare=M.freeSpecialRows(reopened)[0].index;
  for(const [id,value] of M.planRowCopy(reopened,H.SPECIAL,spare)) reopened.set(id,value);
  reopened.set(reopened.sections.hand[H.STONE].specialMove,spare);
  const privateDra=prepared.dra.slice(); M.apply(reopened,{DRA:privateDra});
  assert.equal(selection(privateDra,H.STONE,0,true,13).row,spare);
  assert.deepEqual(privateDra.subarray(equip+H.SPECIAL*52,equip+(H.SPECIAL+1)*52),tuned.subarray(equip+H.SPECIAL*52,equip+(H.SPECIAL+1)*52));
  assert.equal(hash(fs.readFileSync(source)),initial);
  console.log('Stone Sword: input, MP, chain limits, both hands, slash, palette, spell spawn, damage, artwork, guards, export and source preservation passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

