// Extra Hacks: unit checks, then detection and on/off round trips on real disc images when present.
// Images: SOTN_VANILLA_BIN (vanilla US track 1), SOTN_ASS_BIN (Alternate Scarlet Symphony 2.0),
// SOTN_ASS_OLD_BIN (an older ASS release), SOTN_OTHER_PPF (a different mod's PPF3, applied to vanilla in memory).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const C = require("../sotn-core.js");
const H = require("../extra-hacks-ui.js");

const DL = "C:/Users/omergilla/Downloads";
const IMAGES = {
  vanilla: process.env.SOTN_VANILLA_BIN || path.join(DL, "Castlevania - Symphony of the Night (USA)", "Castlevania - Symphony of the Night (USA) (Track 1).bin"),
  ass: process.env.SOTN_ASS_BIN || path.join(DL, "Castlevania - Alternate Scarlet Symphony 2.0.bin"),
  assOld: process.env.SOTN_ASS_OLD_BIN || path.join(DL, "Castlevania - Symphony of the Night Alter.bin")
};
const OTHER_PPF = process.env.SOTN_OTHER_PPF || "C:/Users/omergilla/Documents/Codex/2026-10-01/new-chat-3/work/reawakened/Sotn - Reawakened/02 - Track 1 + Track 2/Sotn - Reawakened - Track 1.ppf";
const CATALOG = process.env.SOTN_HACKS_CATALOG || path.join(__dirname, "..", "extra-hacks-catalog.js");

function loadCatalog() {
  const context = {window: {}};
  vm.runInNewContext(fs.readFileSync(CATALOG, "utf8"), context);
  return H.prepareCatalog(context.window.SotnExtraHacks);
}

function unitChecks() {
  assert.equal(H.crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  // addiu v0,v0,25 keeps opcode/registers, drops the immediate; a jal word is untouched.
  const words = Uint8Array.from([0x19, 0x00, 0x42, 0x24, 0x11, 0x22, 0x33, 0x0C]);
  assert.deepEqual([...H.maskedCopy(words, 0, 8)], [0, 0, 0x42, 0x24, 0x11, 0x22, 0x33, 0x0C]);
  // Words are aligned to the file, not to the copied range.
  assert.deepEqual([...H.maskedCopy(Uint8Array.from([9, 9, 9, 9, 0x19, 0x00, 0x42, 0x24]), 2, 6)], [9, 9, 0, 0, 0x42, 0x24]);

  const catalog = H.prepareCatalog({version: 2, files: {}, fingerprint: {windowLength: 4, windowTolerance: 0, windows: {}, markers: [], minMarkerVotes: 0, markerAgreement: 0.9},
    features: [
      {id: "a", label: "A", vanilla: true, edits: [{file: "X", offset: 0, off: "0000", on: "1119", tunable: [[1, 1]]}]},
      {id: "b", label: "B", vanilla: true, requires: ["a"], edits: [{file: "X", offset: 4, off: "00", on: "22"}]}
    ]});
  const files = new Map([["X", Uint8Array.from([0x11, 0x55, 0, 0, 0x22])]]);
  const a = H.featureState(catalog.features[0], files, "ass");
  assert.equal(a.state, "on", "a retuned value still reads as on");
  assert.equal(H.featureState(catalog.features[1], files, "ass").state, "on");
  files.get("X")[0] = 0x77;
  assert.equal(H.featureState(catalog.features[0], files, "ass").state, "unknown");
  files.get("X")[0] = 0x11;

  const analysis = {profile: "ass", features: [{id: "a", state: "on", context: true}, {id: "b", state: "on", context: true}]};
  const avail = H.availability(catalog, analysis);
  let selected = new Map([["a", true], ["b", true]]);
  const off = H.cascade(catalog, avail, selected, "a", false);
  assert.equal(off.selected.get("b"), false, "turning A off turns off B, which needs it");
  const edits = H.plan(catalog, analysis, off.selected);
  assert.deepEqual(edits.map(e => [e.offset, [...e.bytes]]), [[0, [0, 0]], [4, [0]]]);

  const file = {before: Uint8Array.from([0x11, 0x55, 0, 0, 0x22]), after: Uint8Array.from([0x11, 0x55, 9, 0, 0x22])};
  H.applyEdits(file, edits, "X");
  assert.deepEqual([...file.after], [0, 0, 9, 0, 0]);
  const clash = {before: Uint8Array.from([0x11, 0x55]), after: Uint8Array.from([0x13, 0x55])};
  assert.throws(() => H.applyEdits(clash, edits.slice(0, 1), "X"), error => error.extraHackConflict === true);
}

function readPpf(file) {
  const data = fs.readFileSync(file);
  assert.equal(data.subarray(0, 5).toString(), "PPF30");
  const undo = data[58], records = [];
  let pos = data[57] ? 1084 : 60;
  while (pos + 9 <= data.length) {
    const offset = Number(data.readBigUInt64LE(pos)), n = data[pos + 8];
    pos += 9;
    records.push({offset, bytes: data.subarray(pos, pos + n)});
    pos += n * (undo ? 2 : 1);
  }
  return records;
}

// A DiscImage whose file reads include a PPF3 applied in memory.
function patchedDisc(disc, records) {
  return {
    findPath: parts => disc.findPath(parts),
    async readFile(record) {
      const bytes = await disc.readFile(record);
      for (const {offset, bytes: patch} of records) {
        for (let i = 0; i < patch.length; i++) {
          const sector = Math.floor((offset + i) / disc.sectorSize), within = (offset + i) % disc.sectorSize - disc.dataOffset;
          const at = (sector - record.extent) * 2048 + within;
          if (within >= 0 && within < 2048 && at >= 0 && at < bytes.length) bytes[at] = patch[i];
        }
      }
      return bytes;
    }
  };
}

async function readFiles(catalog, disc) {
  const files = new Map();
  for (const name of H.filesUsed(catalog)) {
    try { files.set(name, await disc.readFile(await disc.findPath(name.split("/")))); } catch { /* absent */ }
  }
  return files;
}

function applyAll(catalog, analysis, files, want) {
  const avail = H.availability(catalog, analysis);
  const selected = new Map();
  for (const [id, entry] of avail) selected.set(id, entry.canToggle ? want(entry) : entry.source);
  const out = new Map([...files].map(([name, bytes]) => [name, bytes.slice()]));
  const edits = H.plan(catalog, analysis, selected);
  for (const edit of edits) {
    const bytes = out.get(edit.file);
    H.applyEdits({before: files.get(edit.file), after: bytes}, [edit], edit.file);
  }
  return {files: out, edits, selected};
}

const sameFiles = (a, b) => [...a].every(([name, bytes]) => Buffer.compare(Buffer.from(bytes), Buffer.from(b.get(name))) === 0);
// SOTN_HACKS_PARTIAL=1 checks a catalog that is still being assembled (hacks without edits are skipped).
const PARTIAL = !!process.env.SOTN_HACKS_PARTIAL;
let skip = new Set();
const entityCounts = analysis => Object.fromEntries(analysis.features.filter(item => item.entities).map(item => [item.id, item.entities]));
const states = analysis => Object.fromEntries(analysis.features.filter(item => !skip.has(item.id)).map(item => [item.id, item.state]));

async function imageChecks(catalog) {
  skip = new Set(catalog.features.filter(feature => !feature.edits.length).map(feature => feature.id));
  if (!PARTIAL) assert.deepEqual([...skip], [], "every hack has byte edits");
  const present = Object.entries(IMAGES).filter(([, file]) => fs.existsSync(file));
  if (!present.length) { console.log("Real-image checks skipped: no BINs found."); return; }
  const loaded = {};
  for (const [kind, file] of present) {
    const disc = await C.DiscImage.open(await fs.openAsBlob(file));
    loaded[kind] = {disc, files: await readFiles(catalog, disc)};
    loaded[kind].analysis = H.analyze(catalog, loaded[kind].files);
    const {print} = loaded[kind].analysis;
    console.log(`${kind}: profile=${loaded[kind].analysis.profile} windows missed ${print?.windowMisses}/${print?.windows}, votes vanilla ${print?.vanillaVotes} ass ${print?.assVotes} of ${print?.markers}`);
  }
  const total = catalog.features.length;
  if (loaded.vanilla) {
    const {analysis, files} = loaded.vanilla;
    assert.equal(analysis.profile, "vanilla");
    const vanillaSafe = new Set(catalog.features.filter(feature => feature.vanilla === true).map(feature => feature.id));
    assert.deepEqual(Object.entries(states(analysis)).filter(([id, s]) => vanillaSafe.has(id) && s !== "off"), [], `vanilla hack states ${JSON.stringify(states(analysis))}`);
    assert.ok(!Object.values(states(analysis)).includes("on"), "vanilla has no hack on");
    const on = applyAll(catalog, analysis, files, () => true);
    const again = H.analyze(catalog, on.files);
    assert.equal(again.profile, "vanilla", "vanilla with every vanilla-safe hack is still vanilla");
    for (const feature of catalog.features.filter(item => !skip.has(item.id) && vanillaSafe.has(item.id))) {
      assert.equal(states(again)[feature.id], on.selected.get(feature.id) ? "on" : "off", `vanilla + ${feature.id}`);
    }
    for (const [id, counts] of Object.entries(entityCounts(analysis))) assert.equal(counts.off, counts.total, `vanilla ${id} entities start off`);
    for (const [id, counts] of Object.entries(entityCounts(again))) assert.equal(counts.on, counts.total, `vanilla + ${id} converts every entity`);
    const back = applyAll(catalog, again, on.files, () => false);
    assert.ok(sameFiles(back.files, files), "vanilla: adding then removing every hack restores the files");
    if (catalog.features.some(item => item.id === "heal-hearts")) {
      // Adding Healing items use Hearts in a second build rewrites the shared bytes it changes.
      const first = applyAll(catalog, analysis, files, entry => entry.feature.id !== "heal-hearts");
      const second = applyAll(catalog, H.analyze(catalog, first.files), first.files, () => true);
      assert.ok(sameFiles(second.files, on.files), "vanilla: hearts added later equals adding everything at once");
    }
    console.log(`vanilla: ${[...on.selected.values()].filter(Boolean).length} of ${total} hacks can be added; add/remove round trip restores the files.`);
  }
  if (loaded.ass) {
    const {analysis, files} = loaded.ass;
    assert.equal(analysis.profile, "ass");
    // Work-in-progress hacks ship off in ASS 2.0; every other hack is on.
    const wip = new Set(catalog.features.filter(f => f.wip).map(f => f.id));
    assert.deepEqual(Object.entries(states(analysis)).filter(([id, s]) => s !== (wip.has(id) ? "off" : "on")), [], "ASS 2.0 has every finished hack on and WIP hacks off");
    const richter = catalog.features.find(feature => feature.id === "richter-ai");
    if (richter) {
      const name = "BOSS/BO6/BO6.BIN";
      const earlier = new Map(files);
      earlier.set(name, files.get(name).slice());
      for (const edit of richter.edits) if (edit.onAlt.length) earlier.get(name).set(edit.onAlt[0], edit.offset);
      assert.equal(H.featureState(richter, earlier, "ass").state, "on", "earlier Epic Richter stays recognized");
      const olderAnalysis = H.analyze(catalog, earlier);
      assert.equal(H.availability(catalog, olderAnalysis).get("richter-ai").canToggle, true);
      const olderOff = applyAll(catalog, olderAnalysis, earlier, entry => !entry.feature.wip && entry.feature.id !== "richter-ai");
      assert.equal(H.featureState(richter, olderOff.files, "ass").state, "off");
      const current = applyAll(catalog, H.analyze(catalog, olderOff.files), olderOff.files, entry => !entry.feature.wip);
      assert.ok(sameFiles(current.files, files), "re-adding Epic Richter installs the current AI");
      const damaged = new Map(files);
      damaged.set(name, files.get(name).slice());
      damaged.get(name)[0x165C] = 0x55;
      const unknown = H.analyze(catalog, damaged);
      assert.equal(H.featureState(richter, damaged, "ass").state, "unknown", "unknown Richter code is rejected");
      assert.equal(H.availability(catalog, unknown).get("richter-ai").canToggle, false);
    }
    for (const [id, counts] of Object.entries(entityCounts(analysis))) assert.ok(counts.total > 0 && counts.on === counts.total, `ASS ${id} entities ${JSON.stringify(counts)}`);
    const off = applyAll(catalog, analysis, files, () => false);
    const again = H.analyze(catalog, off.files);
    for (const [id, counts] of Object.entries(entityCounts(again))) assert.equal(counts.off, counts.total, `ASS without ${id} restores its entities`);
    assert.equal(again.profile, "ass", "ASS with every hack removed is still ASS");
    assert.deepEqual(Object.values(states(again)).filter(s => s !== "off"), [], `ASS without hacks: ${JSON.stringify(states(again))}`);
    const back = applyAll(catalog, again, off.files, entry => !entry.feature.wip);
    assert.ok(sameFiles(back.files, files), "ASS: removing then re-adding every hack restores the files");
    for (const feature of catalog.features.filter(item => !skip.has(item.id) && !wip.has(item.id))) {
      const one = applyAll(catalog, analysis, files, entry => !entry.feature.wip && entry.feature.id !== feature.id && !(feature.id && entry.feature.requires.includes(feature.id)));
      const check = H.analyze(catalog, one.files);
      assert.equal(check.profile, "ass");
      assert.equal(states(check)[feature.id], "off", `ASS minus ${feature.id}`);
    }
    console.log(`ASS 2.0: ${total - wip.size} hacks detected on, ${wip.size} WIP off; each can be removed alone; remove/re-add round trip restores the files.`);

    // Healing items use Hearts off: costs go back to MP, the L2 shortcuts read MP, MP Cost Items and Quick Items stay on.
    const u16 = (b, at) => b[at] | b[at + 1] << 8;
    const COSTS = {potion: 0x6B74, high: 0x6BA8, x: 0x6BDC, meal: 0x5960};
    if (catalog.features.some(item => item.id === "heal-hearts")) {
      const noHearts = applyAll(catalog, analysis, files, entry => !entry.feature.wip && entry.feature.id !== "heal-hearts");
      const dra = noHearts.files.get("DRA.BIN");
      assert.deepEqual(Object.values(COSTS).map(at => u16(dra, at)), [30, 70, 200, 50], "MP costs without hearts");
      const u32 = (b, at) => (u16(b, at) | u16(b, at + 2) << 16) >>> 0;
      assert.equal(u32(dra, 0x426B0), 0x8D057BB0, "L2 shortcut check reads MP again (lw $a1,0x7BB0($t0))");
      assert.equal(u32(dra, 0x42790), 0x8D057BB0, "L2 shortcut subtracts MP again");
      assert.equal(u32(dra, 0x5E8B8), 0x24C67BB0, "HasEnoughMp is vanilla again (addiu $a2,$a2,0x7BB0)");
      const check = H.analyze(catalog, noHearts.files);
      assert.equal(states(check)["heal-hearts"], "off");
      assert.equal(states(check)["mp-items"], "on");
      assert.equal(states(check)["quick-items"], "on");
      const values = new Map(H.statsValues(catalog, analysis, noHearts.selected).map(v => [v.offset, v.value]));
      assert.deepEqual(Object.values(COSTS).map(at => values.get(at)), [30, 70, 200, 50], "statsValues reports the MP costs for the Stats Editor");
      assert.ok([...values].filter(([at]) => !Object.values(COSTS).includes(at)).every(([, v]) => v === null), "other item costs are left alone");
      assert.ok(H.plan(catalog, analysis, noHearts.selected, {statsOwned: () => true}).every(edit => !edit.stats), "stats-owned costs are not byte edits");
      // Back on from that image: identical to the original.
      const back = applyAll(catalog, check, noHearts.files, entry => !entry.feature.wip);
      assert.ok(sameFiles(back.files, files), "Healing items use Hearts: off then on restores the files");
      console.log("ASS 2.0: Healing items use Hearts toggles alone; costs and the L2 shortcuts switch between hearts and MP.");
    }

    // A later ASS build that only retuned numbers and edited data must still be recognized.
    const future = new Map([...files].map(([name, bytes]) => [name, bytes.slice()]));
    const owned = new Set();
    for (const feature of catalog.features) for (const edit of feature.edits) {
      for (let i = 0; i < edit.on.length; i++) if (!edit.tunable[i]) owned.add(`${edit.file}:${edit.offset + i}`);
    }
    const put16 = (name, at, value) => { const b = future.get(name); b[at] = value & 255; b[at + 1] = value >> 8 & 255; };
    put16("DRA.BIN", 0x42848, 30);                 // Dark Metamorphosis ATK +25 -> +30
    put16("DRA.BIN", 0x88ED8, 84);                 // Agunea limit 6 -> 7 strikes
    put16("DRA.BIN", 0x6B74, 45);                  // Potion MP 30 -> 45
    future.get("DRA.BIN")[0x6B69] = 1;             // Potion made consumable again in the item table
    let changedData = 0;
    for (let at = 0xB000; at < 0xB800; at += 37) { // enemy table values
      if (!owned.has(`DRA.BIN:${at}`)) { future.get("DRA.BIN")[at] ^= 0x11; changedData++; }
    }
    for (const name of [...future.keys()].filter(name => name.startsWith("ST/"))) {
      const b = future.get(name);                  // layout/tile bytes in every stage file
      for (let at = 0x2000; at < 0x2400; at += 64) if (!owned.has(`${name}:${at}`)) { b[at] ^= 1; changedData++; }
    }
    const later = H.analyze(catalog, future);
    assert.equal(later.profile, "ass", `retuned ASS build: ${later.reason}`);
    assert.deepEqual(Object.entries(states(later)).filter(([id, s]) => s !== (wip.has(id) ? "off" : "on")), [], "retuned ASS build keeps every hack as it was");
    const darkStats = later.features.find(item => item.id === "dark-stats");
    if (darkStats?.values) assert.equal(darkStats.values.atk, 30, "the UI reads the retuned buff");
    console.log(`retuned ASS build (${changedData} data bytes and 4 values changed): still ASS, every hack as it was.`);
  }
  if (loaded.assOld) {
    const {analysis, files} = loaded.assOld;
    assert.equal(analysis.profile, "ass", "older ASS release is recognized as ASS");
    assert.deepEqual(Object.entries(states(analysis)).filter(([, s]) => s !== "on" && s !== "off"), [], "older ASS: every hack reads as on or off");
    const on = applyAll(catalog, analysis, files, () => true);
    const again = H.analyze(catalog, on.files);
    assert.equal(again.profile, "ass");
    // Hacks placed in spare space (All Cloaks give Hearts uses item-text padding ASS 2.0 freed) stay off where it isn't free.
    const blocked = [...H.availability(catalog, analysis).values()].filter(e => /spare space/.test(e.reason)).map(e => e.feature.id);
    assert.deepEqual(Object.entries(states(again)).filter(([, s]) => s !== "on").map(([id]) => id), blocked, `older ASS + every hack: ${JSON.stringify(states(again))}`);
    const present = Object.entries(states(analysis)).filter(([, s]) => s === "on").map(([id]) => id);
    console.log(`older ASS: ${present.length} hacks present (${present.join(", ")}); every other hack can be added${blocked.length ? ` except ${blocked.join(", ")} (no free space)` : ""}.`);
  }
  if (loaded.vanilla && fs.existsSync(OTHER_PPF)) {
    const other = patchedDisc(loaded.vanilla.disc, readPpf(OTHER_PPF));
    const analysis = H.analyze(catalog, await readFiles(catalog, other));
    assert.equal(analysis.profile, null, "a different mod is rejected");
    console.log(`other mod (${path.basename(OTHER_PPF)}): rejected — ${analysis.reason}`);
  }
}

(async () => {
  unitChecks();
  await imageChecks(loadCatalog());
  console.log("Extra Hacks detection, selection and round-trip checks passed.");
})().catch(error => { console.error(error); process.exit(1); });
