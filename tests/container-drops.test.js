// Globe tables, relic containers and blue flame tables in NZ0/RNZ0.
// Uses real images when present (SOTN_VANILLA_BIN, SOTN_BIN); the synthetic checks always run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const C = require("../sotn-core.js");
const S = require("../disc-stage.js");
const EC = require("../entity-catalog.js");
const E = require("../edit-session.js");

const put32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >>> 8 & 255; b[o + 2] = v >>> 16 & 255; b[o + 3] = v >>> 24 & 255; };
const u16 = (b, o) => b[o] | b[o + 1] << 8;

// Synthetic overlay: update table at 0x100 for IDs 1-3, persistent drop 12, relic orb 11.
const ids = {E_GLOBE_TABLE: 1, E_RELIC_CONTAINER: 2, E_BLUE_FLAME_TABLE: 3, E_PERSISTENT_ITEM_DROP: 12, E_RELIC_ORB: 11};
function synthetic() {
  const b = new Uint8Array(0x400);
  [0x80180200, 0x80180240, 0x801802C0].forEach((p, i) => put32(b, 0x100 + i * 4, p));
  const code = (at, words) => words.forEach((w, i) => put32(b, at + i * 4, w));
  // child->params = lookup[self->params], with an unrelated load in the delay slot
  code(0x200, [0x3404000C, 0x96020030, 0x9603002C, 0x00021040, 0x3C018018, 0x00220821, 0x94220080, 0x24630001, 0xA60200EC, 0x03E00008, 0]);
  // params < 2 ? persistent drop : relic orb; both read lookup[self->params]
  code(0x240, [0x96220030, 0, 0x2C420002, 0x3404000C, 0x3404000B, 0x96220030, 0, 0x00021040, 0x3C018018, 0x00220821, 0x94220090, 0, 0xA62200EC, 0x03E00008, 0]);
  // child->params = self->params
  code(0x2C0, [0x3404000C, 0x96020030, 0, 0xA60200EC, 0x03E00008, 0]);
  return b;
}
{
  const b = synthetic();
  assert.deepEqual(S.findContainerDrops(b, ids), {
    E_GLOBE_TABLE: {kind: "lookup", offset: 0x80},
    E_RELIC_CONTAINER: {kind: "lookup", offset: 0x90, relicFrom: 2},
    E_BLUE_FLAME_TABLE: {kind: "direct"}
  });
  put32(b, 0x2CC, 0x2442FFFF); // addiu v0,v0,-1 replaces the store
  assert.equal(S.findContainerDrops(b, ids), null, "an unrecognized function rejects the whole stage");
  assert.equal(S.findContainerDrops(synthetic(), {E_GLOBE_TABLE: 1}), null, "needs the persistent drop ID");

  const stage = {bytes: synthetic(), originalEntities: [[
    {x: -2, y: -2, id: 0, params: 0}, {x: 8, y: 8, id: 1, params: 2}, {x: 9, y: 9, id: 2, params: 3},
    {x: 9, y: 9, id: 2, params: 0}, {x: 7, y: 7, id: 3, params: 5}, {x: -1, y: -1, id: 0, params: 0}]]};
  [3, 4, 5].forEach((v, i) => { stage.bytes[0x80 + i * 2] = v; });
  [7, 8, 18, 6].forEach((v, i) => { stage.bytes[0x90 + i * 2] = v; });
  S.initContainerDrops(stage, ids);
  assert.deepEqual([...stage.containerDrops.tables.keys()], [0x80, 0x90]);
  assert.deepEqual([...stage.containerDrops.tables.get(0x80).values], [3, 4, 5], "length from the highest original Params");
  assert.deepEqual(S.dropRule("NZ0", "E_GLOBE_TABLE", 1, stage), {kind: "slot", slot: 4, lookup: {offset: 0x80, index: 1}, symbol: "E_GLOBE_TABLE"});
  assert.equal(S.dropRule("NZ0", "E_GLOBE_TABLE", 3, stage), null, "past the known table");
  assert.deepEqual(S.dropRule("NZ0", "E_RELIC_CONTAINER", 3, stage), {kind: "relic", relic: 6, lookup: {offset: 0x90, index: 3}, symbol: "E_RELIC_CONTAINER"});
  assert.equal(S.dropRule("NZ0", "E_RELIC_CONTAINER", 1, stage).slot, 8);
  assert.deepEqual(S.dropRule("NZ0", "E_BLUE_FLAME_TABLE", 5, stage), {kind: "slot", slot: 5, symbol: "E_BLUE_FLAME_TABLE"});
  assert.equal(S.dropRule("NZ0", "E_GLOBE_TABLE", 1), null, "no stage, no container rule");
  assert.equal(S.prizeDropsDirty(stage), false);
  stage.containerDrops.tables.get(0x90).values[3] = 12;
  assert.equal(S.prizeDropsDirty(stage), true);
}

const home = process.env.USERPROFILE || process.env.HOME || "";
const images = [
  ["vanilla", process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`],
  ["modded", process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`]
].filter(([, path]) => fs.existsSync(path));

async function load(disc, code) {
  const stage = S.parseOverlay(await disc.readFile(await disc.findPath(["ST", code, `${code}.BIN`])));
  stage.code = code;
  S.initContainerDrops(stage, Object.fromEntries(EC.areaTypes(code).map(t => [t.symbol, t.id])));
  return stage;
}
const placements = (stage, symbol) => stage.originalEntities.flat().filter(e => EC.typeFor(stage.code, e.id).symbol === symbol);

(async () => {
  for (const [label, path] of images) {
    const disc = await C.DiscImage.open(await fs.openAsBlob(path));
    // src/st/nz0: D_80180F10[] = {0, 1, 2, 6, 10, 0}; D_80180F9C[] = {7, 8, 18, 6} in vanilla.
    const nz0 = await load(disc, "NZ0");
    assert.deepEqual(nz0.containerDrops.rules, {
      E_GLOBE_TABLE: {kind: "lookup", offset: 0xF10},
      E_RELIC_CONTAINER: {kind: "lookup", offset: 0xF9C, relicFrom: 2},
      E_BLUE_FLAME_TABLE: {kind: "lookup", offset: 0xF9C}
    }, label);
    assert.deepEqual([...nz0.containerDrops.tables.get(0xF10).values], [0, 1, 2, 6, 10], label);
    const relics = [...nz0.containerDrops.tables.get(0xF9C).values];
    assert.deepEqual(relics, label === "vanilla" ? [7, 8, 18, 6] : [7, 8, 7, 18], label); // ASS moves Form of Mist and Bat Card
    assert.deepEqual(placements(nz0, "E_GLOBE_TABLE").map(e => S.dropRule("NZ0", "E_GLOBE_TABLE", e.params, nz0).slot), [2, 1, 0, 10, 6]);
    for (const e of placements(nz0, "E_RELIC_CONTAINER"))
      assert.equal(S.dropRule("NZ0", "E_RELIC_CONTAINER", e.params, nz0).kind, "relic");
    assert.deepEqual(placements(nz0, "E_BLUE_FLAME_TABLE").map(e => S.dropRule("NZ0", "E_BLUE_FLAME_TABLE", e.params, nz0).slot), [7, 8]);

    const rnz0 = await load(disc, "RNZ0");
    for (const symbol of ["E_GLOBE_TABLE", "E_RELIC_CONTAINER", "E_BLUE_FLAME_TABLE"]) {
      assert.deepEqual(rnz0.containerDrops.rules[symbol], {kind: "direct"}, `${label} RNZ0 ${symbol}`);
      for (const e of placements(rnz0, symbol)) assert.equal(S.dropRule("RNZ0", symbol, e.params, rnz0).slot, e.params);
    }
    assert.equal(rnz0.containerDrops.tables.size, 0);

    // A relic edit writes only its lookup entry.
    nz0.containerDrops.tables.get(0xF9C).values[3] = 4; // Soul of Wolf
    const out = S.buildOverlay(nz0, false);
    const diff = [...out].map((v, i) => v !== nz0.bytes[i] ? i : -1).filter(i => i >= 0);
    assert.deepEqual(diff, relics[3] === 4 ? [] : [0xFA2], label);
    assert.equal(u16(out, 0xFA2), 4);
    const reread = S.parseOverlay(out); reread.code = "NZ0";
    S.initContainerDrops(reread, Object.fromEntries(EC.areaTypes("NZ0").map(t => [t.symbol, t.id])));
    assert.equal(S.dropRule("NZ0", "E_RELIC_CONTAINER", 3, reread).relic, 4);

    // Saved edits round trip, reject a different table and restore on undo.
    const saved = E.parse(JSON.stringify(await E.capture({name: "x.bin", stages: new Map([["NZ0", nz0]]), area: "NZ0"})));
    assert.deepEqual(saved.stages[0].containers, [{offset: 0xF9C, length: 4, edits: [{index: 3, from: relics[3], to: 4}]}]);
    const fresh = await load(disc, "NZ0");
    const undo = (await E.prepare(saved, {stages: new Map([["NZ0", fresh]])})).apply();
    assert.equal(fresh.containerDrops.tables.get(0xF9C).values[3], 4);
    undo();
    assert.equal(fresh.containerDrops.tables.get(0xF9C).values[3], relics[3]);
    const legacy = JSON.parse(JSON.stringify(saved)); delete legacy.stages[0].containers;
    await E.prepare(legacy, {stages: new Map([["NZ0", await load(disc, "NZ0")]])});
    const wrong = JSON.parse(JSON.stringify(saved)); wrong.stages[0].containers[0].offset = 0xF10;
    await assert.rejects(E.prepare(wrong, {stages: new Map([["NZ0", await load(disc, "NZ0")]])}), /container table/);

    nz0.bytes = nz0.bytes.slice(); nz0.bytes[0xFA2] ^= 1;
    assert.throws(() => S.buildOverlay(nz0, false), /container table does not match/);
  }
  console.log(`container-drops tests passed (synthetic${images.map(([label]) => `, ${label}`).join("")})`);
})().catch(error => { console.error(error); process.exit(1); });
