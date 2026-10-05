const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const C = require("../sotn-core.js"), K = require("../stats-core.js"), M = require("../stats-model.js");
const home = process.env.USERPROFILE || process.env.HOME || "";
const sources = [process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`,
  process.env.SOTN_ASS_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`];
const swordFile = "BOSS/RBO3", base = M.OVERLAY_BASE;
const medusaOf = m => m.sections.enemies.find(e => e.index === 366);
const hash = path => new Promise((resolve, reject) => {
  const digest = crypto.createHash("sha256");
  fs.createReadStream(path).on("error", reject).on("data", data => digest.update(data)).on("end", () => resolve(digest.digest("hex")));
});

// Follow the sword's game instructions.
function slash(bytes, step, dash, tableElement = 0x43) {
  const r = new Int32Array(32), memory = new Map();
  r[4] = 0x80070000; r[16] = 0x80070100;
  const put = (addr, size, value) => { for (let i = 0; i < size; i++) memory.set((addr >>> 0) + i, value >>> (8 * i) & 255); };
  const get = (addr, size) => {
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.get((addr >>> 0) + i) || 0) << (i * 8);
    return value;
  };
  put(r[4] + 0x2C, 2, step); put(r[4] + 0x86, 1, dash); put(r[4] + 0x56, 2, 10);
  put(r[16] + 0x3C, 2, 1);
  put(r[16] + 0x42, 2, tableElement);
  let pc = base + 0x12350, branch = null, load = null;
  for (let n = 0; n < 100; n++) {
    if (pc === base + 0x12358) return {element: get(r[16] + 0x42, 2), hitbox: get(r[16] + 0x3C, 2)};
    const w = K.u32(bytes, pc - base), op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31;
    const imm = w << 16 >> 16;
    let next = null, nextLoad = null;
    if (w === 0) {}
    else if (op === 13) r[rt] = r[rs] | (w & 65535);
    else if (op === 15) r[rt] = (w & 65535) << 16;
    else if ([33, 36, 37].includes(op)) {
      const value = get(r[rs] + imm, op === 36 ? 1 : 2);
      nextLoad = [rt, op === 33 ? value << 16 >> 16 : value];
    } else if (op === 41) put(r[rs] + imm, 2, r[rt]);
    else if (op === 4 || op === 5) {
      if ((r[rs] === r[rt]) === (op === 4)) next = (pc + 4 + imm * 4) >>> 0;
    } else if (op === 2) next = ((pc & 0xF0000000) | (w & 0x3FFFFFF) << 2) >>> 0;
    else throw Error(`Unexpected sword instruction at ${pc.toString(16)}.`);
    if (load) r[load[0]] = load[1];
    r[0] = 0; pc = branch === null ? pc + 4 : branch; branch = next; load = nextLoad;
  }
  throw Error("Sword check did not finish.");
}

async function open(source) {
  const disc = await C.DiscImage.open(typeof source === "string" ? await fs.openAsBlob(source) : source);
  return {disc, model: await M.loadFromDisc(disc, C.normalizeIsoName)};
}
async function build(disc, model) {
  const targets = Object.fromEntries(model.changedFiles().map(key => [key, model.files[key].bytes.slice()]));
  M.apply(model, targets);
  const changes = [];
  for (const [key, after] of Object.entries(targets)) {
    const f = model.files[key];
    changes.push(...await C.changedSectors(disc, f.record, f.bytes, after));
  }
  changes.sort((a, b) => a.start - b.start);
  return {targets, changes, blob: C.modifiedBlob(disc.file, changes)};
}

(async () => {
  let checked = 0;
  for (const path of sources) {
    if (!fs.existsSync(path)) { console.log(`SKIP missing image: ${path}`); continue; }
    const beforeHash = await hash(path), {disc, model} = await open(path), medusa = medusaOf(model);
    const sword = medusa.attacks.find(a => a.label === "Sword slash");
    const dash = medusa.attacks.find(a => a.label === "Dashing sword slash");
    const bodyBefore = model.get(medusa.element), tableOff = model.tables.enemy + 367 * 0x28 + 8;
    assert.match(medusa.contactNote, /Body contact is separate/);
    assert.equal(sword.index, 367);
    assert.equal(model.get(medusa.attack), K.s16(model.files.DRA.bytes, model.tables.enemy + 366 * 0x28 + 6));
    if (dash) {
      const source = model.files[swordFile].bytes;
      assert.equal(slash(source, 5, 0).element, model.get(sword.element), "the override replaces the table element");
      assert.equal(slash(source, 5, 1).element, model.get(dash.element));
      assert.equal(slash(source, 3, 0).hitbox, 2, "inactive sword cannot hit");
      const disabled = source.slice(); K.put32(disabled, 0x207E0, 0);
      const tableModel = M.parse({...model.files, [swordFile]: {...model.files[swordFile], bytes: disabled}});
      const tableSword = medusaOf(tableModel).attacks[0];
      assert.equal(tableModel.field(tableSword.element).file, "DRA");
      assert.ok(!tableModel.field(tableSword.element).readOnly);
      assert.equal(medusaOf(tableModel).attacks.length, 3);
      for (const value of [0x43, 0x103, 0x2043, 0x8043]) {
        for (const variant of [0, 1]) assert.equal(slash(disabled, 5, variant, value).element, value);
        assert.equal(slash(disabled, 3, 0, value).hitbox, 2);
      }
      for (const [off, value] of [[0x207E0, 0xFFFFFFFF], [0x12350, 0], [0x494, 368]]) {
        const altered = source.slice(); K.put32(altered, off, value);
        const unknown = M.parse({...model.files, [swordFile]: {...model.files[swordFile], bytes: altered}});
        const locked = medusaOf(unknown).attacks.find(a => a.index === 367);
        assert.ok(unknown.field(locked.element).readOnly);
        assert.throws(() => unknown.set(locked.element, 0x43), /read-only/);
      }
      model.set(sword.element, model.get(sword.element) & ~0x100);
      model.set(dash.element, 0x2043);
      for (const off of [0x207E0, 0x12350, 0x494, 0x207BC]) {
        const altered = source.slice(); altered[off] ^= 1;
        assert.throws(() => M.apply(model, {[swordFile]: altered}), /changed by another patch/);
      }
      const output = await build(disc, model);
      assert.deepEqual(model.changedFiles(), [swordFile]);
      assert.equal(slash(output.targets[swordFile], 5, 0).element, model.get(sword.element));
      assert.equal(slash(output.targets[swordFile], 5, 1).element, 0x2043);
      assert.equal(slash(output.targets[swordFile], 3, 0).hitbox, 2);
      const editedOffsets = [];
      for (let i = 0; i < source.length; i++) if (source[i] !== output.targets[swordFile][i]) editedOffsets.push(i);
      assert.deepEqual(editedOffsets, [0x207BD, 0x207D5]);
      const reopened = (await open(output.blob)).model, r = medusaOf(reopened);
      assert.equal(reopened.get(r.element), bodyBefore);
      assert.equal(reopened.get(r.attacks[0].element), model.get(sword.element));
      assert.equal(reopened.get(r.attacks[1].element), 0x2043);
      assert.equal(K.u16(reopened.files.DRA.bytes, tableOff), K.u16(model.files.DRA.bytes, tableOff));
      const patch = new Uint8Array(await C.ppf3Blob(output.changes, "Medusa elements check").arrayBuffer());
      const patched = new Map(output.changes.map(c => [c.start, c.original.slice()]));
      for (let at = 60; at < patch.length;) {
        const offset = Number(new DataView(patch.buffer, at, 8).getBigUint64(0, true)), size = patch[at + 8];
        const sector = offset - offset % disc.sectorSize;
        patched.get(sector).set(patch.subarray(at + 9, at + 9 + size), offset - sector);
        at += 9 + size;
      }
      for (const change of output.changes) {
        assert.deepEqual(patched.get(change.start), change.modified);
        assert.deepEqual(C.repairSector(change.modified.slice(), disc.dataOffset), change.modified);
      }
      model.resetAll(); model.set(sword.element, 0x8143);
      const again = await build(disc, model);
      assert.equal(slash(again.targets[swordFile], 5, 0).element, 0x8143, "Curse can be restored");
      assert.equal(slash(again.targets[swordFile], 5, 1).element, model.get(dash.element), "the other slash stays unchanged");
      model.resetAll();
    } else {
      assert.equal(model.field(sword.element).file, "DRA", "the sword uses its table element");
      if (K.u32(model.files[swordFile].bytes, 0x12350) === 0x080681EC) {
        assert.equal(K.u32(model.files[swordFile].bytes, 0x207E0), 0);
        for (const value of [0x43, 0x103, 0x2043, 0x8043]) for (const variant of [0, 1]) {
          assert.equal(slash(model.files[swordFile].bytes, 5, variant, value).element, value);
        }
      }
      model.set(sword.element, 0x143);
      const reopened = (await open((await build(disc, model)).blob)).model;
      assert.equal(reopened.get(medusaOf(reopened).attacks[0].element), 0x143);
      model.resetAll();
    }
    model.set(medusa.element, (bodyBefore & 0x1F) | 0x100);
    const body = (await open((await build(disc, model)).blob)).model;
    assert.equal(body.get(medusaOf(body).element), (bodyBefore & 0x1F) | 0x100);
    assert.equal(body.get(medusaOf(body).attacks[0].element), model.get(sword.element));
    assert.equal(await hash(path), beforeHash, "source image stays unchanged");
    checked++;
    console.log(`Medusa elements: ${path} passed export, reopen, guards and source checks`);
  }
  console.log(`Enemy element tests passed (${checked} images); emulator combat remains unverified.`);
})().catch(error => {console.error(error); process.exit(1);});
