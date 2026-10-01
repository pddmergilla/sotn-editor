// End-to-end check against real disc images. Skips when they are not present.
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
const stat = (m, section, key) => m.sections[section].fields.find(id => m.field(id).key === key);
const values = (m, section) => Object.fromEntries(m.sections[section].fields.map(id => [m.field(id).key, m.get(id)]));

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
  return changes.sort((a, b) => a.start - b.start);
}

(async () => {
  if (fs.existsSync(vanilla)) {
    const {model} = await open(vanilla);
    assert.deepEqual(values(model, "alucard"), {hpMax: 70, hpMaxBonus: 75, mpMax: 20, hearts: 10, heartsMax: 50, str: 6, con: 6, int: 6, lck: 6});
    assert.deepEqual(values(model, "luck"), {hp: 25, hpMax: 25, mp: 1, mpMax: 1, hearts: 5, heartsMax: 5, str: 1, con: 0, int: 0, lck: 99, acc2: 70});
    assert.deepEqual(values(model, "richter"), {hp: 50, hpMax: 50, mp: 20, mpMax: 20, hearts: 30, heartsMax: 99, str: 10, con: 10, int: 10, lck: 10});
    assert.equal(model.get(model.sections.alucardSubweapons[8].followUp), 5);
    assert.equal(model.get(model.sections.richterSubweapons[8].followUp), 5);
    assert.equal(model.get(model.sections.spells[0].mp), 10);
    assert.equal(model.effects.length, 28);
    assert.deepEqual(M.freeSpecialRows(model).map(r => r.index), [169, 199, 200, 201]);
    // LIFE_VESSEL_INCREASE / HEART_VESSEL_INCREASE in every retail stage (MAD and TE* use the beta API).
    for (const key of ["hpMaxUp", "heartMaxUp"]) {
      const f = model.field(`vessel:${key}`);
      assert.equal(f.original, 5, key);
      assert.equal(f.sites.length, 50, key);
      assert.ok(!/differs/.test(f.hint), key);
    }
    // c_HeartPrizes {1, 5}, Soul Steal / blood heal 8, potions 50 / 100 / full HP.
    assert.deepEqual(["stage:smallHeart", "stage:bigHeart", "stage:soulSteal", "stage:bloodDrop"].map(id => model.get(id)), [1, 5, 8, 8]);
    assert.deepEqual([0x9F, 0xA0, 0xA1].map(i => model.get(model.sections.hand[i].heal)), [50, 100, 0]);
    // Starting gear and the prologue bonus items (Potion, Heart Refresh, Neutron bomb, Axe Lord armor).
    assert.equal(model.sections.gear.fields.length, 7);
    assert.equal(model.get(model.sections.forms.fields[0]), 10, "Mist drains 10 MP");
    // nFramesInvincibility: Holy Water 32 with 16-frame flames, Dagger 4.
    const holy = model.sections.alucardSubweapons.find(w => w.name === "Holy Water");
    assert.deepEqual([model.get(holy.cooldown), model.get(holy.extras[0].cooldown), model.get(model.sections.alucardSubweapons[0].cooldown)], [32, 16, 4]);
    const mourne = model.sections.hand.find(h => model.get(h.name).trim() === "Mourneblade");
    assert.equal(model.get(mourne.hitEffect) & 0x7F, 2, "Mourneblade's hits drop soul orbs");
    assert.equal(model.get(model.sections.hand[model.get(model.sections.gear.fields[0])].name), "Alucard sword");
    assert.deepEqual(model.sections.bonusItems.fields.map(id => model.get(id)), [0x9F, 0x8E, 0x47, 2 << 16 | 0x19]);
    console.log("vanilla BIN: starting stats, Agunea costs and effects match the decomp");
  } else console.log("vanilla BIN not found; skipped");

  if (!fs.existsSync(modded)) { console.log("modded BIN not found; skipped"); return; }
  const {disc, model} = await open(modded);
  const before = {alucard: values(model, "alucard"), luck: values(model, "luck"), richter: values(model, "richter")};
  const edits = [["alucard", "str", 12], ["alucard", "con", 7], ["alucard", "hpMax", 1234], ["luck", "con", 3], ["luck", "mp", 2],
    ["richter", "hp", 60], ["richter", "hpMax", 70], ["richter", "lck", 0]];
  for (const [s, k, v] of edits) model.set(stat(model, s, k), v);
  const helm = model.sections.body.head.find(i => model.get(i.name) === "Dragon helm");
  const wizard = model.sections.body.head.find(i => model.get(i.name) === "Wizard hat");
  model.set(helm.name, "Dragon helmet");
  model.set(helm.defense, 42);
  model.set(model.effects.find(id => model.field(id).group === "dragonhelm"), wizard.index);
  model.set(model.effects.find(id => model.field(id).group === "bloodstone"), 61);
  model.set(model.sections.alucardSubweapons[8].followUp, 50);
  model.set(model.sections.richterSubweapons[8].followUp, 7);
  model.set(model.sections.enemies[0].hp, 999);
  model.set(model.sections.spells[5].element, 0x1000);
  const vesselsBefore = {hp: model.get("vessel:hpMaxUp"), heart: model.get("vessel:heartMaxUp")};
  model.set("vessel:hpMaxUp", 37);
  model.set("vessel:heartMaxUp", 8);
  const heals = [["stage:smallHeart", 12], ["stage:bigHeart", 60], ["stage:soulSteal", 70], ["stage:bloodDrop", 71],
    [model.sections.hand[0x9F].heal, 333], [model.sections.hand[0xA0].heal, 888], [model.sections.hand[0xA1].heal, 0]];
  for (const [id, v] of heals) model.set(id, v);
  // How many can be out at once: Dagger (subweapon row +6) and Shuriken (equipment row +0x16).
  const shuriken = model.sections.hand.find(h => model.get(h.name).trim() === "Shuriken");
  const chains = [[model.sections.alucardSubweapons[0].chain, 3], [shuriken.chain, 2]];
  if (model.sections.richterSubweapons) chains.push([model.sections.richterSubweapons[0].chain, 4]);
  for (const [id, v] of chains) model.set(id, v);
  // Start with a Short sword and the Twilight cloak's slot empty; Maria's rescue gives Alucard mail (armor kind 2).
  const shortSwordIndex = model.sections.hand.find(h => model.get(h.name).trim() === "Short sword").index;
  const gearEdits = [[model.sections.gear.fields[0], shortSwordIndex], [model.sections.gear.fields[4], model.field(model.sections.gear.fields[4]).original === 0x30 ? 0x31 : 0x30],
    [model.sections.bonusItems.fields[0], 2 << 16 | 0x0F], [model.sections.bonusItems.fields[3], 0x9F]];
  for (const [id, v] of gearEdits) model.set(id, v);
  // Mist drain, and soul steal on the Short sword and its ↓↘→ special row.
  const shortSwordRow = model.sections.equipRows[shortSwordIndex];
  const soulEdits = [[model.sections.forms.fields[0], 3], [shortSwordRow.hitEffect, (model.get(shortSwordRow.hitEffect) & 0x80) | 2]];
  for (const [id, v] of soulEdits) model.set(id, v);
  const holyWater = model.sections.alucardSubweapons.find(w => w.name === "Holy Water");
  const cooldowns = [[holyWater.cooldown, 20], [holyWater.extras[0].cooldown, 6], [shortSwordRow.invFrames, 7]];
  if (model.sections.richterSkills) cooldowns.push([model.sections.richterSkills[0].cooldown, 9]);
  const crashed = model.sections.richterSubweapons?.find(w => w.crash);
  if (crashed) cooldowns.push([crashed.crash.cooldown, 11]);
  for (const [id, v] of cooldowns) model.set(id, v);
  assert.throws(() => model.set(helm.name, "Dragon helm of the ancients"), /fits 14 bytes/);
  // Moveset: Short sword attacks like Rapier, with a private copy of Rapier's special.
  const rows = model.sections.equipRows, byName = n => model.sections.hand.find(h => model.get(h.name).trim() === n);
  const shortSword = byName("Short sword"), rapier = byName("Rapier");
  const spare = M.freeSpecialRows(model)[0].index, rapierSpecial = model.get(rapier.specialMove);
  for (const [id, v] of M.planStyleCopy(model, rapier.index, shortSword.index)) model.set(id, v);
  for (const [id, v] of M.planRowCopy(model, rapierSpecial, spare)) model.set(id, v);
  model.set(shortSword.specialMove, spare);
  model.set(rows[spare].attack, 123);

  const changes = await buildChanges(disc, model);
  assert.ok(changes.length > 0);
  // Every rebuilt raw sector carries valid EDC/ECC: repairing it again changes nothing.
  for (const c of changes) assert.deepEqual(C.repairSector(c.modified.slice(), disc.dataOffset), c.modified);

  const built = C.modifiedBlob(disc.file, changes);
  const again = await open(built);
  const m2 = again.model;
  for (const [s, k, v] of edits) assert.equal(m2.get(stat(m2, s, k)), v, `${s}.${k}`);
  for (const s of Object.keys(before)) for (const [k, v] of Object.entries(before[s])) {
    if (!edits.some(e => e[0] === s && e[1] === k)) assert.equal(m2.get(stat(m2, s, k)), v, `${s}.${k} kept`);
  }
  const helm2 = m2.sections.body.head.find(i => i.index === helm.index);
  assert.equal(m2.get(helm2.name), "Dragon helmet");
  assert.equal(m2.get(helm2.defense), 42);
  assert.equal(m2.get(m2.effects.find(id => m2.field(id).group === "dragonhelm")), wizard.index);
  assert.equal(m2.get(m2.effects.find(id => m2.field(id).group === "bloodstone")), 61);
  assert.equal(m2.get(m2.sections.alucardSubweapons[8].followUp), 50);
  assert.equal(m2.get(m2.sections.richterSubweapons[8].followUp), 7);
  assert.equal(m2.get(m2.sections.enemies[0].hp), 999);
  assert.equal(m2.get(m2.sections.spells[5].element), 0x1000);
  assert.equal(m2.get("vessel:hpMaxUp"), 37);
  assert.equal(m2.get("vessel:heartMaxUp"), 8);
  for (const [id, v] of heals) assert.equal(m2.get(id), v, id);
  for (const [id, v] of chains) assert.equal(m2.get(id), v, id);
  for (const [id, v] of gearEdits) assert.equal(m2.get(id), v, id);
  for (const [id, v] of soulEdits) assert.equal(m2.get(id), v, id);
  for (const [id, v] of cooldowns) assert.equal(m2.get(id), v, id);
  assert.equal(m2.field("vessel:hpMaxUp").sites.length, model.field("vessel:hpMaxUp").sites.length);
  console.log(`modded BIN: Max Up amounts ${vesselsBefore.hp}/${vesselsBefore.heart} -> 37/8 in ${model.field("vessel:hpMaxUp").sites.length} stages`);
  assert.equal(m2.changed().length, 0);
  const r2 = m2.sections.equipRows;
  assert.equal(M.styleKey(m2, shortSword.index), M.styleKey(m2, rapier.index));
  assert.equal(m2.get(r2[shortSword.index].specialMove), spare);
  assert.equal(m2.get(r2[spare].attack), 123);
  assert.equal(m2.get(r2[rapierSpecial].attack), model.field(rows[rapierSpecial].attack).original);
  assert.equal(m2.get(r2[spare].weaponId), m2.get(r2[rapierSpecial].weaponId));
  assert.equal(m2.get(r2[spare].comboSub), 0);
  assert.ok(!M.freeSpecialRows(m2).some(r => r.index === spare));

  // The PPF3 patch reproduces exactly the rebuilt sectors.
  const ppf = new Uint8Array(await C.ppf3Blob(changes, "SOTN Editor v6.0").arrayBuffer());
  assert.equal(new TextDecoder().decode(ppf.subarray(0, 5)), "PPF30");
  const patched = new Map(changes.map(c => [c.start, c.original.slice()]));
  for (let o = 60; o < ppf.length;) {
    const at = Number(new DataView(ppf.buffer, ppf.byteOffset + o, 8).getBigUint64(0, true)), n = ppf[o + 8];
    const start = at - (at % disc.sectorSize), sector = patched.get(start);
    assert.ok(sector, "PPF only touches rebuilt sectors");
    sector.set(ppf.subarray(o + 9, o + 9 + n), at - start);
    o += 9 + n;
  }
  for (const c of changes) assert.deepEqual(patched.get(c.start), c.modified);
  console.log(`modded BIN: ${changes.length} sectors rebuilt; BIN and PPF3 round-trip the stat edits`);
})().catch(error => { console.error(error); process.exit(1); });
