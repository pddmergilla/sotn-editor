const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const C = require("../sotn-core.js"), T = require("../title-credits.js"), A = require("../ass2-core.js");
const M = require("../stats-model.js");
const home = process.env.USERPROFILE || process.env.HOME;
const vanilla = process.env.SOTN_VANILLA_BIN || `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;
const ass = process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function pixel(bytes, x, y) {
  const tile = Math.floor(x / 256) * 4 + Math.floor(y / 128) * 2 + Math.floor((x % 256) / 128);
  return (bytes[tile * 8192 + (y % 128) * 64 + Math.floor((x % 128) / 2)] >> ((x & 1) * 4)) & 15;
}
async function graphics(disc) { return disc.readFile(await disc.findPath(["BIN", "F_TITLE1.BIN"])); }
function checkLines(before, after) {
  for (let i = 0; i < 4; i++) for (let y = 0; y < 8; y++) for (let x = 0; x < (i < 3 ? 128 : 100); x++) {
    assert.equal(pixel(after, 1664 + x, 144 + i * 16 + y), pixel(before, 128 + x, 144 + i * 8 + y), "original title line preserved");
  }
  for (let j = 0; j < 484; j++) for (let y = 0; y < 8; y++) {
    let expected = 0;
    if (j < T.URL.length * 8) {
      const c = T.URL.charCodeAt(Math.floor(j / 8));
      expected = pixel(before, 1536 + (c & 15) * 8 + j % 8, ((c >> 4) - 2) * 8 + y) ? 1 : 0;
    }
    assert.equal(pixel(after, 1664 + j % 128, 152 + Math.floor(j / 128) * 16 + y), expected, "literal URL at left edge");
  }
}
const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
const collect = source.slice(source.indexOf("  async function collectChanges("), source.indexOf("  async function saveBlob("));
function app(disc, statsModel = null) {
  const context = {C, state: {disc, discStages: new Map(), statsModel}, window: {SotnStatsModel: M, SotnTitleCredits: T}};
  vm.runInNewContext(`${collect}\nthis.collect=collectChanges;`, context);
  return context;
}

(async () => {
  assert(fs.readFileSync(require.resolve("../index.html"), "utf8").includes('<script src="title-credits.js"></script>'));
  assert(!fs.readFileSync(require.resolve("../title-credits.js"), "utf8").includes("Alternate Scarlet Symphony"), "general exports never add the ASS title");
  for (const [label, path] of [["vanilla", vanilla], ["ASS", ass]]) {
    if (!fs.existsSync(path)) { console.log(`${label} image unavailable; skipped`); continue; }
    const sourceHash = hash(fs.readFileSync(path));
    const disc = await C.DiscImage.open(await fs.openAsBlob(path));
    const before = await graphics(disc);
    const model = await M.loadFromDisc(disc, C.normalizeIsoName);
    const field = model.sections.alucard.fields.find(id => model.field(id).key === "str");
    const value = model.get(field) + 1; model.set(field, value);
    const changes = await app(disc, model).collect();
    const blob = C.modifiedBlob(disc.file, changes), edited = await C.DiscImage.open(blob);
    checkLines(before, await graphics(edited));
    assert.equal((await M.loadFromDisc(edited, C.normalizeIsoName)).get(field), value, "single stat edit survives");
    assert.deepEqual(await T.add(edited), [], "rebuild is idempotent");
    for (const change of changes) {
      const repaired = change.modified.slice(); C.repairSector(repaired, disc.dataOffset);
      assert.deepEqual(repaired, change.modified, "sector checksums valid");
    }
    const ppf = new Uint8Array(await C.ppf3Blob(changes).arrayBuffer());
    const original = fs.readFileSync(path), exported = Buffer.from(original);
    for (let pos = 60; pos < ppf.length;) {
      const off = Number(new DataView(ppf.buffer).getBigUint64(pos, true)), n = ppf[pos + 8]; pos += 9;
      exported.set(ppf.subarray(pos, pos + n), off); pos += n;
    }
    assert.equal(hash(exported), hash(new Uint8Array(await blob.arrayBuffer())), "PPF equals BIN export");
    for (const change of changes) exported.set(change.original, change.start);
    assert.equal(hash(exported), sourceHash, "reversal restores exact input");
    const sel = await disc.findPath(["ST", "SEL", "SEL.BIN"]), selBefore = await disc.readFile(sel);
    const selAfter = selBefore.slice(); selAfter[0x342c4] ^= 1;
    const sharing = await T.add(disc, await C.changedSectors(disc, sel, selBefore, selAfter));
    const sameSector = await C.DiscImage.open(C.modifiedBlob(disc.file, sharing));
    assert.equal((await sameSector.readFile(sel))[0x342c4], selAfter[0x342c4], "neighbor edit preserved");
    selAfter[0x34260] ^= 1;
    await assert.rejects(T.add(disc, await C.changedSectors(disc, sel, selBefore, selAfter)), /unsupported changes/);
    const title = await disc.findPath(["BIN", "F_TITLE1.BIN"]), occupied = before.slice();
    occupied[27 * 8192 + 16 * 64] = 1;
    await assert.rejects(T.add(disc, await C.changedSectors(disc, title, before, occupied)), /already in use/);
    await assert.rejects(app(disc).collect(), /no byte changes/);
    assert((await app(disc).collect(true)).length, "browser preview uses title credit");
    assert.equal(hash(fs.readFileSync(path)), sourceHash, "source unchanged");
    console.log(`${label}: one-stat export, footer, checksums, PPF, reversal, repeat build and guards passed`);
  }
  if (fs.existsSync(vanilla) && fs.existsSync(ass)) {
    const context = {window: {}}; vm.runInNewContext(fs.readFileSync(require.resolve("../ass2/ass2-release.js"), "utf8"), context);
    const release = context.window.SotnAss2Release;
    const ppf = A.parsePpf(fs.readFileSync(require("node:path").join(__dirname, "..", release.ppf.file)));
    const file = await fs.openAsBlob(vanilla), direct = await C.DiscImage.open(await fs.openAsBlob(ass));
    const changes = await T.add(direct);
    const expected = C.modifiedBlob(direct.file, changes);
    const chunks = [];
    const result = await A.buildWithCredits(file, ppf, {write: bytes => chunks.push(bytes)}, {expectedCrc: release.result.crc32});
    assert.equal(result.releaseCrc, release.result.crc32);
    assert.equal(hash(Buffer.concat(chunks)), hash(new Uint8Array(await expected.arrayBuffer())), "ASS builder preserves release plus URL only");
    assert.equal(result.crc, A.hex(A.crc32(Buffer.concat(chunks))));
    await assert.rejects(A.buildWithCredits(file, ppf, {write: () => {}}, {expectedCrc: "00000000"}), /release check failed/);
    console.log(`ASS builder: verified release plus credit, CRC32 ${result.crc}, failed-release guard passed`);
  }
  console.log("Title credit checks passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
