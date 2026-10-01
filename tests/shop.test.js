// Library shop and shield spells against real disc images. Skips when they are not present.
// SOTN_BIN: a (possibly modded) US BIN. SOTN_VANILLA_BIN: an unmodified US Track 1.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const C = require("../sotn-core.js");
const M = require("../stats-model.js");

const home = process.env.USERPROFILE || process.env.HOME || "";
const modded = process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const vanilla = process.env.SOTN_VANILLA_BIN ||
  `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;

async function open(source) {
  const disc = await C.DiscImage.open(typeof source === "string" ? await fs.openAsBlob(source) : source);
  return {disc, model: await M.loadFromDisc(disc, C.normalizeIsoName)};
}
async function buildChanges(disc, model) {
  const files = new Map(), targets = {};
  for (const key of model.changedFiles()) {
    const entry = model.files[key];
    const file = {record: entry.record, before: entry.bytes, after: entry.bytes.slice()};
    files.set(entry.record.extent, file);
    targets[key] = file.after;
  }
  M.apply(model, targets);
  const changes = [];
  for (const f of files.values()) changes.push(...await C.changedSectors(disc, f.record, f.before, f.after));
  return {changes: changes.sort((a, b) => a.start - b.start), targets};
}
const vals = (m, list, key) => list.map(x => m.get(x[key]));

(async () => {
  if (fs.existsSync(vanilla)) {
    const {model: m} = await open(vanilla);
    const s = m.sections.shop;
    assert.ok(s.found, s.reason);
    // Values match src/st/lib/e_shop.c.
    assert.equal(m.get(s.count), 48);
    assert.equal(s.slots, 49);
    const entry = i => ["category", "unlock", "item", "price"].map(k => m.get(s.entries[i][k]));
    assert.deepEqual(entry(0), [5, 0xFF, 0, 500]);        // Jewel of Open
    assert.deepEqual(entry(1), [0, 0, 159, 800]);         // Potion
    assert.deepEqual(entry(41), [4, 8, 84, 500000]);      // Duplicator, after clearing
    assert.deepEqual(entry(42), [6, 0x80, 0, 103]);       // Castle map
    assert.deepEqual(entry(48), [6, 0, 10, 1000000]);     // unused last entry
    assert.deepEqual(vals(m, s.relics, "relic"), [16, 0]);
    assert.equal(m.get(s.relicCheck), 16);
    assert.equal(m.get(s.relicName), "Jewel of Open");
    assert.deepEqual(vals(m, s.scrolls, "spell"), [0, 1, 2, 3, 5]);
    assert.deepEqual(vals(m, s.scrolls, "level"), [0, 1, 2, 5, 6]);
    assert.deepEqual(vals(m, s.sell, "item"), [63, 64, 65, 66, 67, 68, 69]);
    assert.deepEqual(vals(m, s.sell, "price"), [150, 800, 1500, 3000, 5000, 8000, 20000]);
    assert.deepEqual([m.get(s.tactics[0].boss), m.get(s.tactics[0].price), m.get(s.tactics[22].boss), m.get(s.tactics[22].price)], [0, 200, 28, 10000]);
    assert.equal(m.get(s.bossNames[0]), "Dracula");
    assert.deepEqual(s.menus.map(x => x.options.slice(0, m.get(x.count)).map(id => m.get(id))), [[0, 5, 1, 2, 4], [0, 5, 1, 2, 3, 4]]);
    assert.equal(m.get(s.documents[0].desc), "Basic map of Dracula’s castle");

    // Shield spells: rows 203-215, one per shield; row 202 is the Heaven sword pair.
    const spells = M.comboSpells(m), by = i => spells.find(x => x.index === i);
    assert.equal(spells.length, 14);
    assert.deepEqual(by(202).casters, [119]);
    assert.equal(by(202).shield, false);
    assert.deepEqual(by(211).casters, [13]);            // Medusa shield
    assert.deepEqual(by(211).triggers, [4, 124]);        // Shield rod, Mablung Sword
    // Attaching Medusa's spell to the Leather shield swaps the two shields' spells and overlays.
    for (const [id, v] of M.planAttach(m, 211, 5)) m.set(id, v);
    const rows = m.sections.equipRows;
    assert.deepEqual(M.comboSpells(m).find(x => x.index === 211).casters, [5]);
    assert.deepEqual(M.comboSpells(m).find(x => x.index === 203).casters, [13]);
    assert.deepEqual([m.get(rows[5].weaponId), m.get(rows[13].weaponId)], [27, 8]);
    assert.equal(m.get(rows[5].attack), m.field(rows[5].attack).original, "the shield keeps its own stats");
    // Giving the Leather shield's spell (now on the Medusa shield) the Alucard shield's effect.
    for (const [id, v] of M.planSpellEffect(m, 203, 16)) m.set(id, v);
    assert.deepEqual([m.get(rows[203].weaponId), m.get(rows[13].weaponId)], [52, 52]);
    console.log("vanilla BIN: library shop and shield spells match the decomp");
  } else console.log("vanilla BIN not found; skipped");

  if (!fs.existsSync(modded)) { console.log("modded BIN not found; skipped"); return; }
  const {disc, model} = await open(modded);
  const s = model.sections.shop;
  assert.ok(s.found, s.reason);
  const set = (id, v) => model.set(id, v);
  set(s.entries[1].price, 1234);
  set(s.entries[2].category, 4); set(s.entries[2].item, 63);   // Zircon
  set(s.entries[3].unlock, 8);
  set(s.count, 49);
  set(s.entries[48].category, 0); set(s.entries[48].item, 1);
  set(s.relicCheck, model.get(s.relics[0].relic));             // hide once you own the relic actually sold
  set(s.scrolls[4].spell, 4);
  set(s.documents[5].desc, "Contains ””Wing Smash””");
  set(s.sell[0].price, 999);
  set(s.tactics[0].price, 1);
  const pre = s.menus[0];
  set(pre.count, 6); set(pre.options[4], 3); set(pre.options[5], 4); // Sound test before clearing
  assert.throws(() => set(s.documents[5].desc, "Contains ””Wing Smash and more””"), /fits/);

  // Listed documents past the name table and menus without Exit are refused at build time.
  set(s.entries[5].category, 6); set(s.entries[5].item, 7);
  assert.throws(() => M.apply(model, {"ST/LIB": model.files["ST/LIB"].bytes.slice()}), /castle map and magic scrolls/);
  model.reset(s.entries[5].category); model.reset(s.entries[5].item);
  set(pre.options[5], 0);
  assert.throws(() => M.apply(model, {"ST/LIB": model.files["ST/LIB"].bytes.slice()}), /Exit/);
  set(pre.options[5], 4);

  assert.deepEqual(model.changedFiles(), ["ST/LIB"]);
  const {changes, targets} = await buildChanges(disc, model);
  for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), disc.dataOffset), c.modified);
  // Only the shop tables and the two list-builder instructions changed.
  const lib = model.files["ST/LIB"].bytes, out = targets["ST/LIB"], t = s.tables;
  const allowed = [[t.inventory, s.slots * 8], [t.scrollSpells, 10], [t.sell, 56], [t.tactics, 184],
    [model.field(s.count).off, 4], [model.field(s.relicCheck).off, 4], [model.field(s.documents[5].desc).off, 28], [model.field(pre.count).off, 7]];
  for (let i = 0; i < lib.length; i++) if (lib[i] !== out[i]) {
    assert.ok(allowed.some(([o, n]) => i >= o && i < o + n), `unexpected LIB change at 0x${i.toString(16)}`);
  }

  const {model: m2} = await open(C.modifiedBlob(disc.file, changes));
  const s2 = m2.sections.shop, g = id => m2.get(id);
  assert.equal(g(s2.entries[1].price), 1234);
  assert.deepEqual([g(s2.entries[2].category), g(s2.entries[2].item)], [4, 63]);
  assert.equal(g(s2.entries[3].unlock), 8);
  assert.equal(g(s2.count), 49);
  assert.deepEqual([g(s2.entries[48].category), g(s2.entries[48].item)], [0, 1]);
  assert.equal(g(s2.relicCheck), model.get(s.relics[0].relic));
  assert.equal(g(s2.scrolls[4].spell), 4);
  assert.equal(g(s2.documents[5].desc), "Contains ””Wing Smash””");
  assert.equal(g(s2.sell[0].price), 999);
  assert.equal(g(s2.tactics[0].price), 1);
  assert.deepEqual(s2.menus[0].options.slice(0, g(s2.menus[0].count)).map(g), [0, 5, 1, 2, 3, 4]);
  assert.equal(m2.changed().length, 0);
  console.log(`modded BIN: ${changes.length} LIB sectors rebuilt; shop edits round-trip`);
})().catch(error => { console.error(error); process.exit(1); });
