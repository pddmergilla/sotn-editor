// The ASS 2.0 release PPF: parses, recognises vanilla / ASS 2.0 / other BINs, and builds ASS 2.0 exactly.
// Uses real images when present (SOTN_VANILLA_BIN, SOTN_BIN); the synthetic checks always run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const A = require("../ass2-core.js");

global.window = {};
require("../ass2/ass2-release.js");
const release = window.SotnAss2Release;
const ppfPath = path.join(__dirname, "..", release.ppf.file);

const home = process.env.USERPROFILE || process.env.HOME || "";
const vanilla = process.env.SOTN_VANILLA_BIN ||
  `${home}/Downloads/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;
const modded = process.env.SOTN_BIN || `${home}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const sha = b => crypto.createHash("sha256").update(b).digest("hex").toUpperCase();

function collector() {
  const parts = [];
  return {parts, write: chunk => { parts.push(Buffer.from(chunk)); }, bytes: () => Buffer.concat(parts)};
}

(async () => {
  // Synthetic: a 3-record patch over a 20 MB image (records straddle the 8 MB windows).
  const size = 20 << 20, base = new Uint8Array(size);
  for (let i = 0; i < size; i += 4099) base[i] = i & 0xFF;
  const recs = [[5, [1, 2, 3]], [(8 << 20) - 2, [9, 9, 9, 9]], [size - 1, [7]]];
  const head = new Uint8Array(1084).fill(32);
  head.set([..."PPF30"].map(c => c.charCodeAt(0))); head[5] = 2; head[56] = 0; head[57] = 1; head[58] = 1; head[59] = 0;
  head.set(base.subarray(0x9320, 0x9320 + 1024), 60);
  const parts = [head];
  for (const [off, data] of recs) {
    const h = new Uint8Array(9); new DataView(h.buffer).setBigUint64(0, BigInt(off), true); h[8] = data.length;
    parts.push(h, Uint8Array.from(data), base.slice(off, off + data.length));
  }
  const ppf = A.parsePpf(Buffer.concat(parts));
  assert.equal(ppf.offsets.length, 3);
  const blob = new Blob([base]);
  assert.equal((await A.inspect(blob, ppf, {size})).status, "vanilla");
  const out = collector();
  const crc = await A.build(blob, ppf, out);
  const expected = Buffer.from(base);
  for (const [off, data] of recs) expected.set(data, off);
  assert.ok(out.bytes().equals(expected));
  assert.equal(crc, A.hex(A.crc32(expected)));
  assert.equal((await A.inspect(new Blob([expected]), ppf, {size})).status, "patched");
  const other = Buffer.from(base); other[6] = 0xEE;
  assert.equal((await A.inspect(new Blob([other]), ppf, {size})).status, "other");
  assert.equal((await A.inspect(new Blob([base.subarray(1)]), ppf, {size})).status, "size");
  console.log("synthetic PPF: parse, inspect and windowed build passed");

  // The shipped patch matches the release data.
  const shipped = fs.readFileSync(ppfPath);
  assert.equal(shipped.length, release.ppf.size);
  assert.equal(sha(shipped), release.ppf.sha256);
  const real = A.parsePpf(shipped);
  assert.equal(real.offsets.length, release.ppf.records);
  console.log(`${release.ppf.name}: ${real.offsets.length} records, SHA-256 matches the release data`);

  if (fs.existsSync(vanilla)) {
    const v = await fs.openAsBlob(vanilla);
    const r = await A.inspect(v, real, {size: release.vanilla.size});
    assert.equal(r.status, "vanilla");
    const sink = collector();
    const crc = await A.build(v, real, sink);
    assert.equal(crc, release.result.crc32);
    assert.equal(sha(sink.bytes()), release.result.sha256);
    console.log(`vanilla BIN -> ASS 2.0: CRC32 ${crc}, SHA-256 matches`);
  }
  if (fs.existsSync(modded)) {
    const m = await fs.openAsBlob(modded);
    const r = await A.inspect(m, real, {size: release.vanilla.size});
    console.log(`current ASS BIN: ${r.status} (${r.patchedMismatch} of ${r.records} records differ from the release)`);
    assert.notEqual(r.status, "vanilla");
  }
  console.log("ASS 2.0 release tests passed.");
})().catch(e => { console.error(e); process.exit(1); });
