// Builds the guarded PPF pair for Maria's kick voice (tools/player/maria-attack-voice.js).
// node tools/player/build-maria-attack-voice-patch.js [--apply]
// Writes the forward and reversal PPFs, a verification JSON and a README next to the main BIN. --apply writes the
// forward patch to the main BIN; use it only after explicit approval.
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('./maria-attack-voice.js');
const {parseBank} = require('../audio/sound-check.js');
const {ppf} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const dir = path.join(__dirname, '../../MainBIN');
// Main BIN after reverting Maria-Kick-Voice-F4C4D32B (Richter-Flame-Whip kept, 2026-10-31).
const INPUT_SHA = '48BD8FECA758A242C8D5EC5E04DF964AC6BB623A096E3A6F77C73EB0CB39C69D';
const base = `Maria-Kick-Voice-${INPUT_SHA.slice(0, 8)}`;
const NAMES = [`${base}.ppf`, `Reverse-${base}.ppf`, `${base}.verification.json`, `${base}.README.md`];
const LOAD_TABLE = 0x800ACC74, DRA_BASE = 0x800A0000;     // D_800ACC74: CdFile pointers by g_LoadFile
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const git = cwd => child.execFileSync('git', ['-c', `safe.directory=${cwd}`, 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

async function imageHash(replacements = []) {
  const h = crypto.createHash('sha256'); let at = 0;
  for await (const chunk of fs.createReadStream(source, {highWaterMark: 1 << 20})) {
    for (const c of replacements) { const s = Math.max(at, c.start), e = Math.min(at + chunk.length, c.start + c.modified.length); if (s < e) chunk.set(c.modified.subarray(s - c.start, e - c.start), s - at); }
    h.update(chunk); at += chunk.length;
  }
  return h.digest('hex').toUpperCase();
}
const sectorsOf = n => Math.ceil(n / 2048);
async function files(disc) {
  const read = async (lba, n) => Buffer.from(await disc.readUserData(lba, n * 2048));
  const rec = p => disc.findPath(p.split('/'));
  const dra = await rec('DRA.BIN'), mad = await rec('ST/MAD/MAD.BIN'), te4 = await rec('ST/TE4/F_TE4.BIN');
  const fvh = await rec('SERVANT/SD_FAIRY.VH'), fvb = await rec('SERVANT/SD_FAIRY.VB');
  assert.equal(te4.extent, M.VH_LBA); assert.ok(M.AREA_SECTORS * 2048 <= te4.size);
  return {
    stream: await read(M.STREAM_LBA, M.STREAM_SECTORS), draLba: dra.extent, dra: await read(dra.extent, sectorsOf(dra.size)),
    madLba: mad.extent, mad: await read(mad.extent, sectorsOf(mad.size)), area: await read(M.VH_LBA, M.AREA_SECTORS),
    fairyVh: Buffer.from(await disc.readFile(fvh)), fairyVb: Buffer.from(await disc.readFile(fvb)), fairyVbLba: fvb.extent,
  };
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
const args = (disc, f) => ({stream: f.stream, dra: f.dra, mad: f.mad, area: f.area, fairyVh: f.fairyVh, fairyVb: f.fairyVb,
  fairyVbLba: f.fairyVbLba, mariaVh: Buffer.from(f.mad.subarray(0, 0)), rawOffset: rawOffset(disc)});

async function prepare() {
  const disc = await C.DiscImage.open(await fs.openAsBlob(source)), f = await files(disc);
  const a = args(disc, f); a.mariaVh = Buffer.from(await disc.readUserData(M.OLD_VH_LBA, M.VH_SIZE));
  const result = M.apply(a);
  assert.equal(result.applied, false, "Maria's kick voice is already applied.");
  const changes = [
    ...await sectors(disc, M.STREAM_LBA, f.stream, result.stream), ...await sectors(disc, f.draLba, f.dra, result.dra),
    ...await sectors(disc, f.madLba, f.mad, result.mad), ...await sectors(disc, M.VH_LBA, f.area, result.area)].sort((x, y) => x.start - y.start);
  return {disc, f, result, changes};
}

// Load slot 1 the way DRA does: VH from the MAD.BIN record, then the following sectors as the VB, sized by
// D_800ACC74[vh.unkF]; then resolve sound 0x841 through the loaded bank.
async function check(disc) {
  const f = await files(disc), mad = f.mad.subarray(M.MAD_VH_REC, M.MAD_VH_REC + 16);
  const loc = mad.readUInt32LE(0), size = mad.readUInt32LE(8), unkF = mad[15];
  const vbRec = f.dra.readUInt32LE(LOAD_TABLE + unkF * 4 - DRA_BASE) - DRA_BASE, vbSize = f.dra.readUInt32LE(vbRec + 8);
  assert.equal(loc, M.VH_LBA); assert.equal(vbSize, M.VB_READ);
  const vh = Buffer.from(await disc.readUserData(loc, size)), vb = Buffer.from(await disc.readUserData(loc + sectorsOf(size), vbSize));
  const b = parseBank(vh, vb, {name: 'slot 1'}), o = M.SFX_TABLE + (M.ID - 0x600) * 7, e = [...f.dra.subarray(o, o + 7)];
  assert.deepEqual(e, M.NEW_SFX);
  const pair = b.programs.get(e[1]).tones.slice(e[5], e[5] + 2);
  assert.equal(pair.length, 2); assert.equal(pair[0].sample, M.SLOT); assert.equal(pair[1].sample, M.SLOT);
  // libsnd accepts VB data until the VH's declared total; DRA sends VB_READ bytes in 0x800 chunks, so the total must
  // arrive in the last chunk (otherwise later chunks return -1 and the loader retries forever).
  const total = b.samples.reduce((a, s) => Math.max(a, s ? s.offset + s.size : 0), 0);
  assert.ok(total <= vbSize && Math.ceil(total / 0x800) === Math.ceil(vbSize / 0x800), 'VB total and read size end in different chunks.');
  return {vhLba: loc, vhSize: hex(size), vbLba: loc + sectorsOf(size), vbSize: hex(vbSize), vbFrom: `D_800ACC74[${unkF}]`, entry: e,
    declaredVb: hex(total), sample: {slot: M.SLOT, offset: hex(b.samples[M.SLOT].offset), sha256: sha(vb.subarray(b.samples[M.SLOT].offset, b.samples[M.SLOT].offset + b.samples[M.SLOT].size))},
    rateHz: Math.round(44100 * 2 ** ((e[2] - pair[0].center) / 12)), centre: pair[0].center};
}

async function main() {
  const {disc, f, result, changes} = await prepare();
  assert.equal(await imageHash(), INPUT_SHA, "Main BIN changed; rebuild Maria's kick voice.");
  const block = Buffer.from(await disc.file.slice(0x9320, 0x9720).arrayBuffer());
  const patches = [ppf(changes, block, 'Maria kick voice'), ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Maria kick voice')];
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
  const vdisc = await C.DiscImage.open(virtual), loaded = await check(vdisc);
  assert.equal(loaded.sample.sha256, sha(Buffer.concat([result.bank.data, Buffer.alloc(result.bank.slot.size - result.bank.kept)])));
  const vf = await files(vdisc), va = args(vdisc, vf); assert.equal(M.apply(va).applied, true);
  const paths = NAMES.map(n => path.join(dir, n));
  for (let i = 0; i < 2; i++) {
    try { assert.deepEqual(await fsp.readFile(paths[i]), patches[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.writeFile(paths[i], patches[i], {flag: 'wx'}); }
    assert.deepEqual(await fsp.readFile(paths[i]), patches[i]);
  }
  const report = {
    source: {path: source, size: disc.file.size, sha256: INPUT_SHA}, result: expected,
    patches: paths.slice(0, 2).map((p, i) => ({path: p, sha256: sha(patches[i])})), sectors: changes.map(c => c.start / 2352),
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: git(decomp)}, editor: {revision: git(path.join(__dirname, '../..'))},
    sample: {...M.SAMPLE, bin: hex(M.SAMPLE.bin), size: hex(result.bank.size), kept: hex(result.bank.kept)}, sound: {id: hex(M.ID), entry: M.NEW_SFX},
    slot1AsLoaded: loaded, edits: result.edits,
    verified: 'Guarded forward/reversal, both undo paths, corrupt-input rejection, sector EDC/ECC, streaming full-image hashes; slot 1 re-read the way DRA loads it (VH record, then the following sectors sized by D_800ACC74[unkF]) and sound 0x841 resolved to the Faerie sample. Not yet played in an emulator.'};
  await fsp.writeFile(paths[2], JSON.stringify(report, null, 2) + '\n');
  await fsp.writeFile(paths[3], `# Maria kick voice (ASS 2.0)

One Faerie voice (sample 7, BIN \`${hex(M.SAMPLE.bin)}\`) when Maria starts a kick. Maria mode only.

**Why her voices were static:** DRA loads a voice bank by reading its VH, then simply keeps reading the next
sectors as the VB; the VB record's location is never used, only the size of DRA's SD_RIH VB record (0xE190).
MAD.BIN points the VH at F_TE5 LBA 42137, but the samples were at F_TE4 LBA 41726, so slot 1 was filled with
unrelated F_TE5 data. Every voice from her bank (and every bank built on it) played as noise.

**Why Maria-Kick-Voice-F4C4D32B hung the loading screen (reverted):** libsnd accepts VB data only up to the total
its VH declares. That VH declared 0xB30 while DRA sends 0xE190, so the later chunks failed and the loader retried
forever.

**Fix:** her own VH, byte for byte (0xE180 declared, ending in the same 0x800 chunk as the 0xE190 read), and her VB
back to back at the start of ST/TE4/F_TE4.BIN (unused debug stage): VH LBA ${M.VH_LBA}, VB LBA ${M.VB_LBA}. Only the
MAD.BIN VH record's LBA changes. The Faerie sample replaces her sample ${M.SLOT} inside its slot.

- Sound ${hex(M.ID)} (SFX_UNUSED_SHAFT_ATTACK_B, used by nothing): vab 1, program 2, tone 2 (sample ${M.SLOT}), note 61
  (her tone centre is 84, the Faerie's 83).
- MarPlaySfx voice half (0x8014F340): Maria ID 0x71F (kick start) also plays ${hex(M.ID)}; the kick swish still plays.
- No other voice plays (Maria-No-Voices stays in effect).

## Files

- \`${NAMES[0]}\`: forward patch. Input SHA-256 \`${INPUT_SHA}\`, result \`${expected}\`.
- \`${NAMES[1]}\`: reversal, restores the input image exactly.
- \`${NAMES[2]}\`: edits, hashes and checks.
- Builder: \`tools/player/build-maria-attack-voice-patch.js\`, patch logic \`tools/player/maria-attack-voice.js\`.

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
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), input: INPUT_SHA, result: expected, sectors: changes.length, patches: report.patches, slot1: loaded, edits: result.edits}, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = {prepare, check, INPUT_SHA, NAMES};
