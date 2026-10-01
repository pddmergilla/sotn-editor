const assert = require("node:assert/strict");
const fs = require("node:fs");
const C = require("../sotn-core.js");
const S = require("../disc-stage.js");

const put32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = v >>> 8 & 255; b[o + 2] = v >>> 16 & 255; b[o + 3] = v >>> 24 & 255; };

// Synthetic EntityPersistentItemDrop lookup: PrizeDrops at 0x80181234.
const code = new Uint8Array(0x2000);
[0x3C018018, 0x00220821, 0x94241234, 0x00000000, 0x2C820080].forEach((w, i) => put32(code, 0x100 + i * 4, w));
assert.equal(S.findPrizeTable(code), 0x1234);
put32(code, 0x200, 0x3C018018); put32(code, 0x204, 0x94241300); put32(code, 0x208, 0x2C820080);
assert.equal(S.findPrizeTable(code), -1, "two candidate tables are ambiguous");

// Breakables: most looks drop params & 0xFFF; urns, jugs and busts use a prize slot in some stages.
assert.deepEqual(S.dropRule("NO3", "E_BREAKABLE", 0x0011), {kind: "direct", value: 0x11, look: 0, symbol: "E_BREAKABLE"});
assert.deepEqual(S.dropRule("NO3", "E_BREAKABLE", 0x1000 | 0x80 + 25), {kind: "direct", value: 0x80 + 25, look: 1, symbol: "E_BREAKABLE"});
assert.equal(S.dropRule("LIB", "E_BREAKABLE", 0x7005).slot, 5);
assert.equal(S.dropRule("LIB", "E_BREAKABLE", 0x7005).kind, "slot");
assert.deepEqual([S.dropRule("LIB", "E_BREAKABLE", 0x8005).kind, S.dropRule("LIB", "E_BREAKABLE", 0x8005).slot], ["fixed", 3]);
assert.equal(S.dropRule("NZ1", "E_BREAKABLE", 0x7001).slot, 0x28);
assert.equal(S.dropRule("NZ1", "E_BREAKABLE", 0x0001).kind, "direct");
assert.deepEqual(S.dropRule("NZ0", "E_SUBWPN_CONTAINER", 3), {kind: "subweapon", index: 3, symbol: "E_SUBWPN_CONTAINER"});
assert.equal(S.dropRule("NO3", "E_PERSISTENT_ITEM_DROP", 300), null);
assert.equal(S.dropRule("NO3", "E_BAT", 3), null);
const table = new Uint8Array(64);
[18, 17, 15, 21, 19, 14, 16, 20, 22].forEach((v, i) => put32(table, 8 + i * 4, v));
assert.deepEqual(S.findSubweaponTable(table), [18, 17, 15, 21, 19, 14, 16, 20, 22]);
put32(table, 8, 23);
assert.equal(S.findSubweaponTable(table), null);

const home = process.env.USERPROFILE || process.env.HOME || "";
const vanilla = process.env.SOTN_VANILLA_BIN ||
  `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;
(async () => {
  if (!fs.existsSync(vanilla)) { console.log("prize-drops synthetic tests passed; vanilla BIN not found"); return; }
  const disc = await C.DiscImage.open(await fs.openAsBlob(vanilla));
  const read = async code => S.parseOverlay(await disc.readFile(await disc.findPath(["ST", code, `${code}.BIN`])));
  // Tables match src/st/no3/d_prize_drops.c and src/st/nz0/d_prize_drops.c.
  const no3 = await read("NO3"), nz0 = await read("NZ0");
  assert.equal(no3.prizeTableOffset, 0x1C8C);
  assert.equal(nz0.prizeTableOffset, 0x13B0);
  const at = (stage, i) => stage.bytes[stage.prizeTableOffset + i * 2] | stage.bytes[stage.prizeTableOffset + i * 2 + 1] << 8;
  assert.deepEqual([0, 1, 2, 5, 9].map(i => at(no3, i)), [0x0C, 0x17, 0x112, 0x13B, 0xED]);
  assert.deepEqual([0, 3, 10].map(i => at(nz0, i)), [0x12B, 0x17, 0x11F]);

  const original = Uint16Array.from([0, 1, 2], i => at(no3, i));
  no3.prizeDrops = {offset: no3.prizeTableOffset, original, values: original.slice()};
  assert.equal(S.prizeDropsDirty(no3), false);
  no3.prizeDrops.values[1] = 0x80 + 169 + 34; // Holy glasses
  assert.equal(S.prizeDropsDirty(no3), true);
  const out = S.buildOverlay(no3, false);
  assert.equal(out[0x1C8E] | out[0x1C8F] << 8, 0x14B);
  const diff = [...out].map((v, i) => v !== no3.bytes[i] ? i : -1).filter(i => i >= 0);
  assert.deepEqual(diff, [0x1C8E, 0x1C8F]);
  // src/st/e_subweapon_container.h: subweapon_params[] = {22, 20, 16, 14, 19, 21, 15, 17, 18}.
  assert.deepEqual(S.findSubweaponTable(nz0.bytes), [22, 20, 16, 14, 19, 21, 15, 17, 18]);
  console.log("prize-drops tests passed (synthetic and vanilla NO3/NZ0)");
})().catch(error => { console.error(error); process.exit(1); });
