const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js'), M = require('../stats-model.js');
const H = require('../tools/weapons/hunter-sword.js');
const home = process.env.USERPROFILE || process.env.HOME || '';
const sources = [process.env.SOTN_ASS_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`,
  process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`];

// Follow the game's attack instructions.
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
    let pc = start >>> 0, branch = null, load = null;
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

function flight(file, hand, row, facing, crouch, special = H.SPECIAL) {
  const base = hand ? 0x8017D000 : 0x8017A000, self = 0x80075000, player = 0x800733D8;
  let destroyed = false;
  const hooks = new Map([
    [base + 0x10D4, () => {destroyed = true;}],
    [0x80010000, (r, {put}) => {
      assert.equal(r[4], hand); assert.equal(r[6], special);
      for (let i = 0; i < row.length; i++) put((r[5] >>> 0) + i, 1, row[i]);
    }],
    [0x80010010, () => {}], [0x80010020, () => {}],
    [0x800190AC, r => {r[2] = Math.round(Math.atan2(r[4], r[5]) * 2048 / Math.PI) & 0xFFF;}],
    [0x80016D68, r => {r[2] = Math.round(Math.cos((r[4] & 0xFFF) * Math.PI / 2048) * 4096);}],
    [0x80016C9C, r => {r[2] = Math.round(Math.sin((r[4] & 0xFFF) * Math.PI / 2048) * 4096);}]
  ]);
  const cpu = machine([{base, bytes: file.subarray(H.CODE, H.CODE + H.LENGTH)}], hooks);
  cpu.put(0x8003C788, 4, 0x80078000);
  cpu.put(0x8018B0D0, 4, 0x80078000);
  cpu.put(0x8003C7D0, 4, 0x80010000); cpu.put(0x8003C804, 4, 0x80010010);
  cpu.put(0x8003C7DC, 4, 0x80010020); cpu.put(0x8003C8C4, 4, 1);
  cpu.put(0x8006C3B8, 4, self);
  cpu.put(player, 4, 128 << 16); cpu.put(player + 4, 4, 120 << 16);
  cpu.put(player + 0x14, 2, facing); cpu.put(player + 0x2C, 2, crouch ? 2 : 0);
  cpu.put(player + 0x46, 1, 8); cpu.put(player + 0x47, 1, 16); cpu.put(player + 0x24, 2, 100);
  cpu.put(self + 0xAE, 2, special);
  const update = () => cpu.run(base + H.ENTRY, {4: self});
  update();
  if (special !== H.SPECIAL) {assert.equal(cpu.get(self + 0x2C, 2), 0); return;}
  assert.equal(cpu.get(self + 0x2C, 2), 1);
  assert.equal(cpu.get(self + 0x54, 2), hand ? 0x8013 : 0x8011);
  assert.equal(cpu.get(self + 0x56, 2), 1);
  assert.equal(cpu.get(0x80078000 + (hand ? 0x48 : 0x40), 4) >>> 0, base + H.BANK);
  assert.equal(cpu.get(base + H.BANK, 4) >>> 0, K.u32(file, H.CODE + 0x40));
  assert.equal(cpu.get(self + 8, 4), facing ? -0x48000 : 0x48000);
  assert.equal(cpu.get(self + 6, 2), crouch ? 112 : 104);
  for (const [off, size, rowOff] of [[0x40, 2, 8], [0x42, 2, 12], [0x49, 1, 0x1A], [0x58, 2, 0x26], [0x6A, 2, 0x2A]]) {
    assert.equal(cpu.get(self + off, size), size === 1 ? row[rowOff] : K.u16(row, rowOff));
  }
  let maxDistance = 0, frames = 0;
  while (!destroyed && frames++ < 200) {
    maxDistance = Math.max(maxDistance, Math.abs((cpu.get(self, 4) >> 16) - 128)); update();
    if (frames === 28) assert.equal(cpu.get(self + 0x2C, 2), 2);
  }
  assert.ok(destroyed, 'The sword returns and is caught.');
  assert.ok(maxDistance >= 70, 'The sword travels outward before returning.');
  assert.ok(frames > 28);
}

async function main() {
  let count = 0;
  for (const source of sources) {
    if (!fs.existsSync(source)) {console.log(`SKIP missing image: ${source}`); continue;}
    const hash = () => new Promise((resolve, reject) => {
      const digest = crypto.createHash('sha256');
      fs.createReadStream(source).on('error', reject).on('data', bytes => digest.update(bytes)).on('end', () => resolve(digest.digest('hex')));
    });
    const beforeHash = await hash(), disc = await C.DiscImage.open(await fs.openAsBlob(source));
    const model = await M.loadFromDisc(disc, C.normalizeIsoName);
    const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
    const weapons = await Promise.all(records.map(r => disc.readFile(r))), prepared = H.prepare(model, weapons);
    const equip = model.tables.equip, privateRow = () => prepared.dra.subarray(equip + H.SPECIAL * 52, equip + (H.SPECIAL + 1) * 52);
    assert.deepEqual(prepared.dra.subarray(equip + H.SHOTEL * 52, equip + (H.SHOTEL + 1) * 52), model.files.DRA.bytes.subarray(equip + H.SHOTEL * 52, equip + (H.SHOTEL + 1) * 52));
    assert.deepEqual(prepared.dra.subarray(equip + 176 * 52, equip + 177 * 52), model.files.DRA.bytes.subarray(equip + 176 * 52, equip + 177 * 52));
    for (let i = 0; i < prepared.dra.length; i++) if (prepared.dra[i] !== model.files.DRA.bytes[i]) {
      assert.ok(i === equip + H.HUNTER * 52 + 24 || i >= equip + H.SPECIAL * 52 + 8 && i < equip + (H.SPECIAL + 1) * 52);
    }
    for (const hand of [0, 1]) {
      const selected = selection(prepared.dra, H.HUNTER, hand, true, 99);
      assert.equal(selected.row, H.SPECIAL);
      assert.equal(selected.factory & 0xFFFF, 56 + ((hand + 1) << 12));
      assert.equal(selection(prepared.dra, H.HUNTER, hand, false, 99).row, H.HUNTER);
      assert.equal(selection(prepared.dra, H.HUNTER, hand, true, 0).row, K.u16(privateRow(), 0x24) ? H.HUNTER : H.SPECIAL);
      assert.equal(selection(prepared.dra, H.HUNTER, hand, true, 99, false).row, H.HUNTER);
      assert.equal(selection(prepared.dra, H.HUNTER, hand, true, 99, true, hand).row, H.HUNTER);
      assert.equal(selection(prepared.dra, H.HUNTER, hand, true, 99, true, 1 - hand).row, H.SPECIAL);
      assert.equal(selection(prepared.dra, H.SHOTEL, hand, true, 99).row, 176);
      for (const facing of [0, 1]) for (const crouch of [false, true]) flight(prepared.weapons[hand], hand, privateRow(), facing, crouch);
      flight(prepared.weapons[hand], hand, privateRow(), 0, false, 176);
      for (let i = 0; i < weapons[hand].length; i++) if (weapons[hand][i] !== prepared.weapons[hand][i]) {
        assert.ok(i >= H.CODE + 4 && i < H.CODE + 8 || i >= H.CODE + H.ENTRY && i < H.CODE + H.BANK + 0x144);
      }
      for (const [id, off] of [[0, H.CODE + H.ENTRY], [34, 34 * H.SLOT + H.CODE + 0xF60]]) {
        const damaged = weapons[hand].slice(); damaged[off] ^= 1;
        assert.throws(() => H.weapon(damaged, hand), /Unknown/);
      }
    }
    const opened = M.parse({...model.files, DRA: {...model.files.DRA, bytes: prepared.dra}}), r = opened.sections.equipRows[H.SPECIAL];
    assert.deepEqual(M.rowUsers(opened, H.SPECIAL), [H.HUNTER]);
    for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]]) opened.set(r[key], value);
    const tuned = prepared.dra.slice(); M.apply(opened, {DRA: tuned});
    assert.equal(selection(tuned, H.HUNTER, 0, true, 12).row, H.HUNTER);
    assert.equal(selection(tuned, H.HUNTER, 0, true, 13).row, H.SPECIAL);
    for (const hand of [0, 1]) flight(prepared.weapons[hand], hand, tuned.subarray(equip + H.SPECIAL * 52, equip + (H.SPECIAL + 1) * 52), 0, false);
    assert.deepEqual(tuned.subarray(equip + 176 * 52, equip + 177 * 52), prepared.dra.subarray(equip + 176 * 52, equip + 177 * 52));
    const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, tuned);
    for (const hand of [0, 1]) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
    changes.sort((a, b) => a.start - b.start);
    for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified);
    const built = C.modifiedBlob(disc.file, changes), reread = await M.loadFromDisc(await C.DiscImage.open(built), C.normalizeIsoName);
    for (const [key, value] of [['attack', 321], ['mp', 13], ['element', 0x2040], ['invFrames', 7], ['stun', 11]]) assert.equal(reread.get(reread.sections.equipRows[H.SPECIAL][key]), value);
    const ppf = new Uint8Array(await C.ppf3Blob(changes, 'Hunter Sword test').arrayBuffer());
    const replay = new Map(changes.map(c => [c.start, c.original.slice()]));
    for (let at = 60; at < ppf.length;) {
      const offset = Number(new DataView(ppf.buffer, at, 8).getBigUint64(0, true)), size = ppf[at + 8];
      replay.get(offset - offset % 2352).set(ppf.subarray(at + 9, at + 9 + size), offset % 2352); at += 9 + size;
    }
    for (const c of changes) assert.deepEqual(replay.get(c.start), c.modified);
    assert.equal(await hash(), beforeHash);
    count++; console.log(`${source}: both hands, input selection, flight/catch, independent stats, exports, guards and source preservation passed`);
  }
  assert.ok(count, 'Supply a reference image.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
