// Builds the guarded PPF pair for all of Maria's requested voices (tools/player/maria-voices-full.js).
// node tools/player/build-maria-voices-full-patch.js [--apply]
// Writes the forward and reversal PPFs, a verification JSON and a README next to the main BIN. --apply writes the
// forward patch to the main BIN; use it only after explicit approval.
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('./maria-voices-full.js'), V = require('./maria-voices.js');
const {parseBank} = require('../audio/sound-check.js');
const {ppf} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const dir = path.join(__dirname, '../../MainBIN');
// Main BIN with Maria-Kick-Voice-48BD8FEC applied (2026-10-31; the kick voice works in game).
const INPUT_SHA = 'DA575EEE98E9A190F299D8177993E26C4636FF45C580A1E5CE2ECFDD6F8952E8';
const base = `Maria-Voices-Full-${INPUT_SHA.slice(0, 8)}`;
const NAMES = [`${base}.ppf`, `Reverse-${base}.ppf`, `${base}.verification.json`, `${base}.README.md`];
const BANKS = ['SERVANT/SD_FAIRY', 'ST/NZ1/SD_ZKNZ1', 'BOSS/RBO5/SD_ZRBO5'];
const LOAD_TABLE = 0x800ACC74, DRA_BASE = 0x800A0000, MAD_VH_REC = 0x18334;
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const git = cwd => child.execFileSync('git', ['-c', `safe.directory=${cwd}`, 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const sectorsOf = n => Math.ceil(n / 2048);

async function imageHash(replacements = []) {
  const h = crypto.createHash('sha256'); let at = 0;
  for await (const chunk of fs.createReadStream(source, {highWaterMark: 1 << 20})) {
    for (const c of replacements) { const s = Math.max(at, c.start), e = Math.min(at + chunk.length, c.start + c.modified.length); if (s < e) chunk.set(c.modified.subarray(s - c.start, e - c.start), s - at); }
    h.update(chunk); at += chunk.length;
  }
  return h.digest('hex').toUpperCase();
}
async function files(disc) {
  const read = async (lba, n) => Buffer.from(await disc.readUserData(lba, n * 2048));
  const rec = p => disc.findPath(p.split('/'));
  const dra = await rec('DRA.BIN'), mad = await rec('ST/MAD/MAD.BIN');
  const f = {stream: await read(M.STREAM_LBA, M.STREAM_SECTORS), draLba: dra.extent, dra: await read(dra.extent, sectorsOf(dra.size)),
    mad: Buffer.from(await disc.readFile(mad)), area: await read(M.VH_LBA, M.AREA_SECTORS)};
  const vbAt = (M.VB_LBA - M.VH_LBA) * 2048;
  f.banks = {maria: {vh: f.area.subarray(0, M.VH_SIZE), vb: f.area.subarray(vbAt, vbAt + M.VB_SIZE), vbLba: M.PICKED_VB_LBA}};
  for (const b of BANKS) {
    const h = await rec(b + '.VH'), v = await rec(b + '.VB');
    f.banks[b] = {vh: Buffer.from(await disc.readFile(h)), vb: Buffer.from(await disc.readFile(v)), vbLba: v.extent};
  }
  return f;
}
async function sectors(disc, lba, before, after) {
  const out = [];
  for (let k = 0; k * 2048 < after.length; k++) {
    const a = before.subarray(k * 2048, k * 2048 + 2048), b = after.subarray(k * 2048, k * 2048 + 2048);
    if (a.equals(b)) continue;
    const start = (lba + k) * 2352, original = Buffer.from(await disc.file.slice(start, start + 2352).arrayBuffer());
    assert.deepEqual(Buffer.from(C.repairSector(Uint8Array.from(original), 24)), original, `Sector ${lba + k} is not a clean Mode 2 Form 1 sector.`);
    const modified = Buffer.from(original); b.copy(modified, 24);
    out.push({start, original, modified: Buffer.from(C.repairSector(Uint8Array.from(modified), 24))});
  }
  return out;
}
function replay(from, patch, block, undo = false) {
  const p = A.parsePpf(patch), out = from.map(c => ({start: c.start, modified: Buffer.from(c.modified)}));
  assert.deepEqual(Buffer.from(p.blockCheck), block);
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at + p.lengths[n] <= c.start + 2352); assert.ok(c); const i = at - c.start, off = p.data[n], len = p.lengths[n];
    assert.deepEqual(c.modified.subarray(i, i + len), Buffer.from(p.bytes.subarray(off + (undo ? 0 : len), off + (undo ? len : 2 * len)))); });
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at < c.start + 2352), off = p.data[n], len = p.lengths[n];
    c.modified.set(p.bytes.subarray(off + (undo ? len : 0), off + (undo ? 2 * len : len)), at - c.start); });
  return out;
}
const rawOffset = disc => (lba, off) => (lba + Math.floor(off / 2048)) * disc.sectorSize + disc.dataOffset + off % 2048;
const args = (disc, f) => ({stream: f.stream, dra: f.dra, mad: f.mad, area: f.area, banks: f.banks, rawOffset: rawOffset(disc)});

async function prepare() {
  const disc = await C.DiscImage.open(await fs.openAsBlob(source)), f = await files(disc);
  const result = M.apply(args(disc, f));
  assert.equal(result.applied, false, "Maria's full voices are already applied.");
  const changes = [
    ...await sectors(disc, M.STREAM_LBA, f.stream, result.stream), ...await sectors(disc, f.draLba, f.dra, result.dra),
    ...await sectors(disc, M.VH_LBA, f.area, result.area)].sort((x, y) => x.start - y.start);
  return {disc, f, result, changes};
}

// Load slot 1 the way DRA does (VH record, then the following sectors sized by D_800ACC74[unkF]) and resolve
// every new sound to its sample.
async function check(disc, result) {
  const f = await files(disc), mad = f.mad.subarray(MAD_VH_REC, MAD_VH_REC + 16);
  const loc = mad.readUInt32LE(0), size = mad.readUInt32LE(8), unkF = mad[15];
  const vbRec = f.dra.readUInt32LE(LOAD_TABLE + unkF * 4 - DRA_BASE) - DRA_BASE, vbSize = f.dra.readUInt32LE(vbRec + 8);
  assert.equal(loc, M.VH_LBA); assert.equal(vbSize, M.VB_READ);
  const vh = Buffer.from(await disc.readUserData(loc, size)), vb = Buffer.from(await disc.readUserData(loc + sectorsOf(size), vbSize));
  const b = parseBank(vh, vb, {name: 'slot 1'});
  const total = b.samples.reduce((a, s) => Math.max(a, s ? s.offset + s.size : 0), 0);
  assert.ok(total <= vbSize && Math.ceil(total / 0x800) === Math.ceil(vbSize / 0x800), 'VB total and read size end in different chunks.');
  const resolved = V.sfxEntries().map(e => {
    const o = V.SFX_TABLE + (e.id - 0x600) * 7, c = [...f.dra.subarray(o, o + 7)];
    assert.deepEqual(c, e.new);
    const pair = b.programs.get(c[1]).tones.slice(c[5], c[5] + 2);
    assert.equal(pair.length, 2); assert.equal(pair[0].sample, pair[1].sample);
    const s = b.samples[pair[0].sample], want = result.bank.samples.find(x => x.name === e.name), len = parseInt(want.kept, 16);
    assert.equal(sha(vb.subarray(s.offset, s.offset + len)), want.sha256, e.name);
    assert.ok(vb.subarray(s.offset + len, s.offset + s.size).every(x => x === 0));
    return {id: hex(e.id), name: e.name, entry: c, sample: pair[0].sample, centre: pair[0].center, rateHz: Math.round(44100 * 2 ** ((c[2] - pair[0].center) / 12))};
  });
  assert.equal(M.apply(args(disc, f)).applied, true);
  return {vhLba: loc, vbLba: loc + sectorsOf(size), declaredVb: hex(total), vbRead: hex(vbSize), resolved};
}

async function main() {
  const {disc, result, changes} = await prepare();
  assert.equal(await imageHash(), INPUT_SHA, "Main BIN changed; rebuild Maria's full voices.");
  const block = Buffer.from(await disc.file.slice(0x9320, 0x9720).arrayBuffer());
  const patches = [ppf(changes, block, 'Maria voices full'), ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Maria voices full')];
  const original = changes.map(c => ({start: c.start, modified: Buffer.from(c.original)}));
  const forward = replay(original, patches[0], block), reverse = replay(forward, patches[1], block);
  const undo = replay(forward, patches[0], block, true), reverseUndo = replay(original, patches[1], block, true);
  for (let i = 0; i < changes.length; i++) {
    assert.deepEqual(forward[i].modified, changes[i].modified); assert.deepEqual(reverse[i].modified, original[i].modified);
    assert.deepEqual(undo[i].modified, original[i].modified); assert.deepEqual(reverseUndo[i].modified, forward[i].modified);
  }
  const corrupt = original.map(c => ({...c, modified: Buffer.from(c.modified)})); corrupt[0].modified[A.parsePpf(patches[0]).offsets[0] - corrupt[0].start] ^= 1;
  assert.throws(() => replay(corrupt, patches[0], block));
  const expected = await imageHash(forward);
  assert.equal(await imageHash(reverse), INPUT_SHA); assert.equal(await imageHash(undo), INPUT_SHA); assert.equal(await imageHash(reverseUndo), expected);
  const virtual = {size: disc.file.size, type: '', slice(b = 0, e = disc.file.size) { return {arrayBuffer: async () => {
    const out = Buffer.from(await disc.file.slice(b, e).arrayBuffer());
    for (const c of forward) { const s = Math.max(b, c.start), t = Math.min(e, c.start + 2352); if (s < t) out.set(c.modified.subarray(s - c.start, t - c.start), s - b); }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length); }}; }};
  const loaded = await check(await C.DiscImage.open(virtual), result);
  const paths = NAMES.map(n => path.join(dir, n));
  for (let i = 0; i < 2; i++) {
    try { assert.deepEqual(await fsp.readFile(paths[i]), patches[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.writeFile(paths[i], patches[i], {flag: 'wx'}); }
    assert.deepEqual(await fsp.readFile(paths[i]), patches[i]);
  }
  const report = {
    source: {path: source, size: disc.file.size, sha256: INPUT_SHA}, result: expected,
    patches: paths.slice(0, 2).map((p, i) => ({path: p, sha256: sha(patches[i])})), sectors: changes.map(c => c.start / 2352),
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: git(decomp)}, editor: {revision: git(path.join(__dirname, '../..'))},
    bank: {used: hex(result.bank.used), declared: hex(result.bank.total), samples: result.bank.samples}, slot1AsLoaded: loaded, voices: result.voices, sfx: result.sfx, edits: result.edits,
    verified: 'Guarded forward/reversal, both undo paths, corrupt-input rejection, sector EDC/ECC, streaming full-image hashes; slot 1 re-read the way DRA loads it, declared VB total ends in the last 0x800 read chunk, every new sound resolved to its trimmed sample. Not yet played in an emulator.'};
  await fsp.writeFile(paths[2], JSON.stringify(report, null, 2) + '\n');
  const row = s => `| ${s.name} | \`${hex(V.SOUNDS.find(x => x[0] === s.name)[3])}\` | ${s.from} | ${s.kept} |`;
  await fsp.writeFile(paths[3], `# Maria voices, full set (ASS 2.0)

On top of Maria-Kick-Voice-48BD8FEC, which proved the slot-1 layout in game (VH at F_TE4 LBA ${M.VH_LBA}, VB right
after it at ${M.VB_LBA}). Maria mode only.

Her voice bank now holds these 15 sounds (each cut after its last sample above about -42 dBFS). The VH declares
exactly ${hex(M.VB_SIZE)} bytes (the last slot is padded) so the 0xE190 read ends in the same chunk and loading
cannot stall. Her old attack/pain/death voice samples are gone.

| Sound | Sample (BIN offset when picked) | Source | Size |
|---|---|---|---|
${result.bank.samples.map(row).join('\n')}

MarPlaySfx keeps its effect remap (kick swish, hit sounds, Byakko fire) and then plays a voice from this lookup
(0x8014FA20):

| Maria ID | Plays |
|---|---|
${result.voices.map(v => `| ${v.key} | ${v.what}: ${v.ids.join(' / ')}${v.ids.length > 1 ? ' (random)' : ''} |`).join('\n')}

Also: the High Jump (0x8013E3B8) and running kick / Dash Kick (0x8013C824) voice calls are back on, Four Holy Beasts
gets its voice, Energy Shot 3 plays its new launch sound and Energy Shot 4 plays its sound when fired. The slide
swish and the heart-paid heal sound from Maria-No-Voices stay.

## Files

- \`${NAMES[0]}\`: forward patch. Input SHA-256 \`${INPUT_SHA}\`, result \`${expected}\`.
- \`${NAMES[1]}\`: reversal, restores the input image exactly.
- \`${NAMES[2]}\`: edits, hashes and checks.
- Builder: \`tools/player/build-maria-voices-full-patch.js\`, patch logic \`tools/player/maria-voices-full.js\`.

Checked statically. Not yet played in an emulator.
`);
  if (process.argv.includes('--apply')) {
    assert.equal(await imageHash(), INPUT_SHA);
    const handle = await fsp.open(source, 'r+');
    try {
      for (const c of changes) { const cur = Buffer.alloc(2352); assert.equal((await handle.read(cur, 0, 2352, c.start)).bytesRead, 2352); assert.deepEqual(cur, c.original); }
      for (const c of changes) assert.equal((await handle.write(c.modified, 0, 2352, c.start)).bytesWritten, 2352);
      await handle.sync();
    } finally { await handle.close(); }
    assert.equal(await imageHash(), expected);
    const back = replay(changes.map(c => ({start: c.start, modified: Buffer.from(c.modified)})), patches[1], block);
    assert.equal(await imageHash(back), INPUT_SHA);
  }
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), input: INPUT_SHA, result: expected, sectors: changes.length, patches: report.patches,
    declared: report.bank.declared, used: report.bank.used, edits: result.edits.map(e => `${e.at} ${e.what}`)}, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = {prepare, check, INPUT_SHA, NAMES};
