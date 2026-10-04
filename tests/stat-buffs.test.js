const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const C = require("../sotn-core.js"), K = require("../stats-core.js"), M = require("../stats-model.js");
const H = require("../extra-hacks-ui.js"), B = require("../stats-buffs-data.js");
const context = {window: {}};
vm.runInNewContext(fs.readFileSync(require.resolve("../extra-hacks-catalog.js"), "utf8"), context);
const catalog = H.prepareCatalog(context.window.SotnExtraHacks), dark = catalog.features.find(f => f.id === "dark-stats");
const base = 0x800A0000, equip = 0x80097BC8, total = equip + 16, timer = 0x80072F16, defense = 0x80097C24;
const sources = [process.env.SOTN_VANILLA_BIN || "C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin",
  process.env.SOTN_ASS_BIN || "C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin",
  process.env.SOTN_ASS_OLD_BIN || "C:/Users/omergilla/Downloads/Castlevania - Symphony of the Night Alter.bin"];

// Check the generated game code.
function run(dra, start, memory, initial = {}, calls = new Map()) {
  const r = new Int32Array(32); r[29] = 0x801fff00; r[31] = -1;
  for (const [reg, value] of Object.entries(initial)) r[reg] = value;
  let pc = start >>> 0, branch = null, load = null;
  const read = (addr, size) => {
    const offset = (addr >>> 0) - base;
    return offset >= 0 && offset + size <= dra.length ? (size === 2 ? K.s16(dra, offset) : K.u32(dra, offset)) : memory.get(addr >>> 0) || 0;
  };
  for (let step = 0; step < 2000; step++) {
    if (pc === 0xffffffff) return r;
    if (calls.has(pc)) { calls.get(pc)(r, memory); pc = r[31] >>> 0; continue; }
    const w = K.u32(dra, pc - base), op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
    const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
    let next = null, nextLoad = null;
    if (op === 0) {
      if ((w & 63) === 0) r[rd] = r[rt] << (w >>> 6 & 31);
      else if ((w & 63) === 0x21) r[rd] = r[rs] + r[rt];
      else if ((w & 63) === 8) next = r[rs] >>> 0;
      else throw Error(`Unsupported helper instruction ${w.toString(16)}`);
    } else if (op === 15) r[rt] = (w & 65535) << 16;
    else if (op === 9) r[rt] = r[rs] + imm;
    else if (op === 10) r[rt] = Number(r[rs] < imm);
    else if (op === 33 || op === 35) nextLoad = [rt, read(addr, op === 33 ? 2 : 4)];
    else if (op === 43) memory.set(addr, r[rt]);
    else if (op === 4) { if (r[rs] === r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 5) { if (r[rs] !== r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 6) { if (r[rs] <= 0) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 2 || op === 3) {
      if (op === 3) r[31] = pc + 8;
      next = ((pc & 0xf0000000) | (w & 0x3ffffff) << 2) >>> 0;
    } else throw Error(`Unsupported helper instruction ${w.toString(16)}`);
    if (load) r[load[0]] = load[1];
    r[0] = 0;
    pc = branch === null ? (pc + 4) >>> 0 : branch;
    branch = next; load = nextLoad;
  }
  throw Error("Stat helper did not return.");
}

function analyze(dra, profile) {
  const files = new Map([["DRA.BIN", dra]]), info = H.featureState(dark, files, profile);
  return {profile, features: [{id: dark.id, ...info, values: H.readValues(dark, files)}]};
}
function edited(dra, analysis, selected, tuning) {
  const file = {before: dra, after: dra.slice()};
  H.applyEdits(file, H.plan(catalog, analysis, selected, {tuning}), "DRA.BIN");
  return file.after;
}

(async () => {
  let count = 0;
  for (const source of sources) {
    if (!fs.existsSync(source)) { console.log(`Missing image; skipped: ${source}`); continue; }
    const disc = await C.DiscImage.open(await fs.openAsBlob(source)), record = await disc.findPath(["DRA.BIN"]), dra = await disc.readFile(record);
    const model = M.parse({DRA: {bytes: dra, base}}), original = dra.slice();
    assert.equal(model.stoneBuffs.found, true);
    for (const [group, bonuses] of [["sunstone", [1, 2, 3, 4]], ["moonstone", [9, 8, 7, 6]]]) {
      for (const [n, key] of ["str", "con", "int", "lck"].entries()) {
        const id = `stone:${group}:${key}`;
        assert.equal(model.get(id), 5);
        model.set(id, bonuses[n]);
        assert.throws(() => model.set(id, 100));
        assert.throws(() => model.set(id, -1));
      }
    }
    const stones = dra.slice(); M.apply(model, {DRA: stones});
    const reopened = M.parse({DRA: {bytes: stones, base}});
    assert.equal(reopened.stoneBuffs.added, true);
    for (const group of ["sunstone", "moonstone"]) for (const key of ["str", "con", "int", "lck"]) {
      assert.equal(reopened.get(`stone:${group}:${key}`), model.get(`stone:${group}:${key}`));
    }
    for (const [table, bonuses] of [[B.table, [1, 2, 3, 4]], [B.table + 8, [9, 8, 7, 6]]]) for (const n of [0, 1, 2]) {
      const mem = new Map(Array.from({length: 4}, (_, k) => [equip + k * 4, 10]));
      run(stones, base + B.helper, mem, {2: n, 4: base + table});
      assert.deepEqual(Array.from({length: 4}, (_, k) => mem.get(equip + k * 4)), bonuses.map(b => 10 + b * n));
      assert.equal(mem.has(equip + 16), false, "Stone helper writes exactly four stats");
    }
    const profile = source === sources[0] ? "vanilla" : "ass", analysis = analyze(stones, profile);
    if (analysis.features[0].state === "on") {
      const legacy = edited(stones, analysis, new Map([[dark.id, true]]), new Map([[dark.id, {atk: 0, int: 0, def: 0}]]));
      assert.deepEqual(legacy.subarray(0x42e98, 0x42f14), stones.subarray(0x42e98, 0x42f14), "Editing existing bonuses preserves the original helper version");
      assert.equal(K.s16(legacy, 0x42894), 0); assert.equal(K.s16(legacy, 0x428a4), 0);
    }
    const tune = new Map([[dark.id, {atk: 11, def: 16, int: 12, str: 13, con: 14, lck: 15}]]);
    const selected = new Map([[dark.id, true]]), after = edited(stones, analysis, selected, tune);
    const configured = analyze(after, profile);
    assert.equal(configured.features[0].state, "on");
    assert.deepEqual({...configured.features[0].values}, {atk: 11, int: 12, def: 16, cap: 999, str: 13, con: 14, lck: 15});
    assert.equal(H.plan(catalog, configured, selected).length, 0, "Reopen preserves a configured hack");
    const fullFiles = new Map();
    for (const name of H.filesUsed(catalog)) fullFiles.set(name, name === "DRA.BIN" ? after : await disc.readFile(await disc.findPath(name.split("/"))));
    const fullAnalysis = H.analyze(catalog, fullFiles);
    assert.equal(fullAnalysis.profile, profile, "Export stays recognized by Extra Hacks");
    assert.equal(fullAnalysis.features.find(f => f.id === dark.id).state, "on");
    assert.equal(H.plan(catalog, configured, new Map([[dark.id, false]]), {tuning: tune}).some(e => e.offset === 0x42848), false);
    assert.throws(() => H.plan(catalog, analysis, selected, {tuning: new Map([[dark.id, {str: 100}]])}));
    const damaged = after.slice(); damaged[0x42e98] ^= 1;
    assert.equal(analyze(damaged, profile).features[0].state, "unknown");
    const partial = after.slice(); partial.set(original.subarray(0x553ac, 0x553b0), 0x553ac);
    assert.equal(analyze(partial, profile).features[0].state, "unknown");
    const hooks = new Map([
      [0x800f4994, (r, mem) => { for (let k = 0; k < 4; k++) { mem.set(equip + k * 4, 5); mem.set(total + k * 4, 10); } }],
      [0x800f4f48, (r, mem) => {
        const attack = run(after, 0x800e282c, mem, {2: 100 + mem.get(total)});
        mem.set(0x80097c20, attack[2]);
      }],
      [0x800f4fd0, (r, mem) => mem.set(defense, Math.floor(Math.sqrt(mem.get(total + 4))))],
      [0x801092e8, () => {}]
    ]);
    const mem = new Map([[timer, 120]]);
    for (const active of [120, 120, 0, -1, 120]) {
      mem.set(timer, active);
      run(after, 0x800e28e0, mem, {}, hooks);
      const extras = active > 0 ? [13, 14, 12, 15] : [0, 0, 0, 0];
      assert.deepEqual(Array.from({length: 4}, (_, k) => mem.get(equip + k * 4)), extras.map(v => 5 + v));
      assert.deepEqual(Array.from({length: 4}, (_, k) => mem.get(total + k * 4)), extras.map(v => 10 + v));
      assert.equal(mem.get(0x80097c20), 110 + extras[0] + (active > 0 ? 11 : 0), "STR applies before attack calculation");
      assert.equal(mem.get(defense), Math.floor(Math.sqrt(10 + extras[1])) + (active > 0 ? 16 : 0), "CON applies before defense calculation");
    }
    assert.equal(run(after, 0x800e282c, new Map([[timer, 120]]), {2: 0})[2], 0);
    assert.equal(run(after, 0x800e282c, new Map([[timer, 120]]), {2: 995})[2], 999);
    const removed = edited(after, configured, new Map([[dark.id, false]]));
    assert.equal(analyze(removed, profile).features[0].state, "off");
    for (const e of dark.edits) assert.deepEqual(removed.subarray(e.offset, e.offset + e.off.length), e.off);
    const changes = await C.changedSectors(disc, record, dra, after);
    const exported = await C.DiscImage.open(C.modifiedBlob(disc.file, changes));
    assert.deepEqual(await exported.readFile(await exported.findPath(["DRA.BIN"])), after);
    const patch = new Uint8Array(await C.ppf3Blob(changes, "Stat bonuses").arrayBuffer());
    const patched = new Map(changes.map(c => [c.start, c.original.slice()]));
    for (let offset = 60; offset < patch.length;) {
      const at = Number(new DataView(patch.buffer, offset, 8).getBigUint64(0, true)), n = patch[offset + 8];
      const start = at - at % disc.sectorSize;
      assert(patched.has(start));
      patched.get(start).set(patch.subarray(offset + 9, offset + 9 + n), at - start);
      offset += 9 + n;
    }
    for (const change of changes) assert.deepEqual(patched.get(change.start), change.modified, "PPF reproduces every rebuilt sector");
    assert.deepEqual(await disc.readFile(record), original, "Source disc stays unchanged");
    for (let n = 0; n < dra.length; n++) if (after[n] !== dra[n]) {
      assert([...B.edits, ...dark.edits].some(e => n >= Number(e.offset) && n < Number(e.offset) + e.on.length / (typeof e.on === "string" ? 2 : 1)), `Unrelated byte ${n.toString(16)}`);
    }
    console.log(`Stat bonuses: helper behavior, expiry, guards, export and reopen passed: ${source}`); count++;
  }
  if (!count) console.log("Stat bonus image checks skipped; set SOTN_VANILLA_BIN, SOTN_ASS_BIN and SOTN_ASS_OLD_BIN.");
})().catch(error => { console.error(error); process.exitCode = 1; });
