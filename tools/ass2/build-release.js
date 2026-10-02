// Build the Alternate Scarlet Symphony 2.0 release for the [Alternate Scarlet Symphony 2.0] tab:
//   ass2/Alternate-Scarlet-Symphony-2.0.ppf  PPF3 from vanilla US Track 1 to the ASS 2.0 BIN (block check + undo data)
//   ass2/ass2-release.js                     hashes, sizes and the headline numbers the tab shows
// Rerun after changing the ASS 2.0 BIN. Neither BIN is modified.
//
// usage: node tools/ass2/build-release.js [--vanilla PATH] [--ass PATH]
//   defaults: SOTN_VANILLA_BIN / SOTN_ASS_BIN, else the usual Downloads paths.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..", "..");
const C = require(path.join(root, "sotn-core.js"));
const M = require(path.join(root, "stats-model.js"));

const home = process.env.USERPROFILE || process.env.HOME || "";
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const VANILLA = arg("--vanilla") || process.env.SOTN_VANILLA_BIN ||
  `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;
const ASS = arg("--ass") || process.env.SOTN_ASS_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const OUT = path.join(root, "ass2");
const PPF_NAME = "Alternate-Scarlet-Symphony-2.0.ppf";
const SECTOR = 2352, GAP = 4, BLOCK_CHECK = 0x9320;

// Enemy table rows shown in the boss table (index into g_EnemyDefs).
const BOSSES = [[379, "Dracula"], [351, "Shaft"], [361, "Death"], [198, "Galamoth"], [324, "Beelzebub"], [307, "Richter Belmont"],
  [280, "Karasuman"], [366, "Medusa"], [267, "Akmodan II"], [50, "Olrox"], [342, "Succubus"], [328, "Fake Trevor"]];

function buildPpf(v, a) {
  const runs = [];
  for (let s = 0; s < v.length; s += SECTOR) {
    const end = Math.min(s + SECTOR, v.length);
    if (v.subarray(s, end).equals(a.subarray(s, end))) continue;
    for (let p = s; p < end; p++) {
      if (v[p] === a[p]) continue;
      const last = runs[runs.length - 1];
      if (last && p - last[1] <= GAP && p - last[0] < 255) last[1] = p + 1;
      else runs.push([p, p + 1]);
    }
  }
  const records = [];
  for (let [x, y] of runs) while (x < y) { const z = Math.min(y, x + 255); records.push([x, z]); x = z; }
  const head = Buffer.alloc(60 + 1024, 0x20);
  head.write("PPF30", 0, "ascii"); head[5] = 2;
  head.write("Alternate Scarlet Symphony 2.0", 6, "ascii");
  head[56] = 0; head[57] = 1; head[58] = 1; head[59] = 0; // BIN image, block check, undo data
  v.copy(head, 60, BLOCK_CHECK, BLOCK_CHECK + 1024);
  const parts = [head];
  for (const [x, y] of records) {
    const h = Buffer.alloc(9); h.writeBigUInt64LE(BigInt(x), 0); h[8] = y - x;
    parts.push(h, a.subarray(x, y), v.subarray(x, y));
  }
  // Round trip: the records turn vanilla into ASS 2.0.
  const check = Buffer.from(v);
  for (const [x, y] of records) a.copy(check, x, x, y);
  if (!check.equals(a)) throw new Error("PPF round trip failed");
  return {ppf: Buffer.concat(parts), records: records.length,
    sectors: new Set(records.flatMap(([x, y]) => [Math.floor(x / SECTOR), Math.floor((y - 1) / SECTOR)])).size};
}

async function loadModel(file) {
  const disc = await C.DiscImage.open(await fs.openAsBlob(file));
  return {disc, model: await M.loadFromDisc(disc, C.normalizeIsoName)};
}

async function changedFiles(dv, v, a) {
  const out = [];
  const stages = await dv.listStages();
  let total = 0;
  async function walk(dir, prefix) {
    for (const entry of await dv.readDirectory(dir)) {
      const name = prefix + C.normalizeIsoName(entry.name);
      if (entry.isDirectory) { await walk(entry, name + "/"); continue; }
      total++;
      // File data only (XA/STR streams run in Form 2 sectors, so compare their raw sectors' data part).
      const first = entry.extent, count = Math.ceil(entry.size / 2048);
      let differs = false;
      for (let s = first; s < Math.min(first + count, v.length / SECTOR) && !differs; s++)
        differs = !v.subarray(s * SECTOR + 24, s * SECTOR + 2072).equals(a.subarray(s * SECTOR + 24, s * SECTOR + 2072));
      if (differs) out.push(name);
    }
  }
  await walk(dv.root, "");
  return {changed: out, total, stages: stages.length};
}

(async () => {
  for (const f of [VANILLA, ASS]) if (!fs.existsSync(f)) throw new Error(`missing ${f}`);
  const v = fs.readFileSync(VANILLA), a = fs.readFileSync(ASS);
  if (v.length !== a.length) throw new Error("The two BINs differ in size; a PPF3 cannot resize the image.");
  const sha = b => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();
  const crc = b => (zlib.crc32(b) >>> 0).toString(16).toUpperCase().padStart(8, "0");
  const {ppf, records, sectors} = buildPpf(v, a);
  fs.mkdirSync(OUT, {recursive: true});
  fs.writeFileSync(path.join(OUT, PPF_NAME), ppf);

  const V = await loadModel(VANILLA), A = await loadModel(ASS);
  const vm = V.model, am = A.model;
  const pair = (id, vid = id) => [vm.get(vid), am.get(id)];
  const byKey = (m, s) => Object.fromEntries(m.sections[s].fields.map(id => [m.field(id).key || m.field(id).label, id]));
  const sec = s => [byKey(vm, s), byKey(am, s)];
  const [va, aa] = sec("alucard"), [vv, av] = sec("vessels");
  const alucard = Object.fromEntries(["hpMax", "mpMax", "heartsMax", "str", "con", "int", "lck"].map(k => [k, [vm.get(va[k]), am.get(aa[k])]]));
  const pickups = Object.fromEntries(["hpMaxUp", "heartMaxUp", "smallHeart", "bigHeart"].map(k => [k, [vm.get(vv[k]), am.get(av[k])]]));
  const potions = [[0x9F, "Potion"], [0xA0, "High Potion"], [0xA1, "X-Potion"]].map(([i, name]) => {
    const vh = vm.sections.hand[i].heal, ah = am.sections.hand[i].heal;
    const cost = am.sections.hand[i].mp ? am.get(am.sections.hand[i].mp) : 0; // bit 0x8000: hearts
    return {name, vanilla: vh ? vm.get(vh) : null, ass: ah ? am.get(ah) : null, cost: cost & 0x7FFF, costHearts: !!(cost & 0x8000)};
  });
  const bosses = BOSSES.map(([i, name]) => {
    const ve = vm.sections.enemies.find(e => e.index === i), ae = am.sections.enemies.find(e => e.index === i);
    return ve && ae ? {name, hp: pair(ae.hp, ve.hp), attack: pair(ae.attack, ve.attack)} : null;
  }).filter(Boolean);
  const subweapons = am.sections.alucardSubweapons.map(s => {
    const w = vm.sections.alucardSubweapons.find(x => x.id === s.id);
    return {name: s.name, cost: pair(s.cost, w.cost), attack: pair(s.attack, w.attack)};
  });
  const spells = am.sections.spells.filter(s => s.mp).map(s => {
    const w = vm.sections.spells.find(x => x.name === s.name);
    return {name: s.name, mp: pair(s.mp, w.mp), attack: s.attack ? pair(s.attack, w.attack) : null};
  });
  let changedValues = 0;
  for (const id of am.fields.keys()) if (vm.field(id) && vm.get(id) !== am.get(id)) changedValues++;
  const rowsChanged = s => am.sections[s].filter((row, i) => Object.values(row).some(f => typeof f === "string" &&
    am.field(f) && vm.field(f) && am.get(f) !== vm.get(f))).length;
  const mist = am.sections.forms?.fields?.[0];
  const files = await changedFiles(V.disc, v, a);

  const release = {
    title: "Alternate Scarlet Symphony 2.0",
    built: new Date().toISOString().slice(0, 10),
    ppf: {file: `ass2/${PPF_NAME}`, name: PPF_NAME, size: ppf.length, sha256: sha(ppf), records, sectors},
    vanilla: {name: path.basename(VANILLA), size: v.length, sha256: sha(v), crc32: crc(v)},
    result: {name: "Castlevania - Alternate Scarlet Symphony 2.0 (Track 1).bin", size: a.length, sha256: sha(a), crc32: crc(a)},
    disc: {filesChanged: files.changed.length, filesTotal: files.total,
      stagesChanged: files.changed.filter(f => /^(ST|BOSS)\//.test(f)).length},
    numbers: {
      changedValues, enemies: [rowsChanged("enemies"), am.sections.enemies.length], hand: [rowsChanged("hand"), am.sections.hand.length],
      spellRows: [rowsChanged("spells"), am.sections.spells.length], alucard, pickups, potions,
      soulSteal: pair("stage:soulSteal"), mistDrain: mist ? pair(mist) : null, bosses, subweapons, spells
    }
  };
  fs.writeFileSync(path.join(OUT, "ass2-release.js"),
    "// Generated by tools/ass2/build-release.js from the vanilla US and ASS 2.0 BINs. Do not edit by hand.\n" +
    `window.SotnAss2Release = ${JSON.stringify(release, null, 1)};\n`);
  console.log(`PPF ${PPF_NAME}: ${ppf.length} bytes, ${records} records, ${sectors} sectors, SHA-256 ${release.ppf.sha256}`);
  console.log(`vanilla ${release.vanilla.sha256}  ->  ASS 2.0 ${release.result.sha256} (CRC32 ${release.result.crc32})`);
  console.log(`${changedValues} changed stat values; ${files.changed.length} of ${files.total} disc files differ.`);
})().catch(e => { console.error(e); process.exit(1); });
