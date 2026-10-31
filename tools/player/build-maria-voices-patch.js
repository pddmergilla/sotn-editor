// Builds the guarded PPF pair for Maria's rebuilt voices (tools/player/maria-voices.js).
// node tools/player/build-maria-voices-patch.js [--apply]
// Writes the forward and reversal PPFs, a verification JSON and a README next to the main BIN. --apply writes the
// forward patch to the main BIN; use it only after explicit approval.
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('./maria-voices.js');
const R1 = require('./maria-effects-repair.js');
const {parseBank} = require('../audio/sound-check.js');
const {ppf} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const dir = path.join(__dirname, '../../MainBIN');
// Main BIN after Reverse-Maria-Voices-Recovery-Pickups-D8D9264A (2026-10-30).
const INPUT_SHA = 'D8D9264A57108BA979480FE91F6C36768D34167EF129C78A573B28BA3B40BEB4';
const tag = INPUT_SHA.slice(0, 8), base = `Maria-Voices-Rebuild-${tag}`;
const NAMES = [`${base}.ppf`, `Reverse-${base}.ppf`, `${base}.verification.json`, `${base}.README.md`];
const BANKS = ['SERVANT/SD_FAIRY', 'ST/NZ1/SD_ZKNZ1', 'BOSS/RBO5/SD_ZRBO5'];
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
const rawOffset = disc => (lba, off) => (lba + Math.floor(off / 2048)) * disc.sectorSize + disc.dataOffset + off % 2048;
async function record(disc, p) { return disc.findPath(p.split('/')); }
// Whole sectors of user data for each area the patch touches, plus the source banks.
async function files(disc) {
  const read = async (lba, n) => Buffer.from(await disc.readUserData(lba, sectorsOf(n) * 2048));
  const draRec = await record(disc, 'DRA.BIN'), madRec = await record(disc, 'ST/MAD/MAD.BIN');
  const out = {
    stream: await read(M.STREAM_LBA, M.STREAM_SECTORS * 2048), draLba: draRec.extent, dra: await read(draRec.extent, draRec.size),
    vh: await read(M.VH.lba, M.VH.size), vb: await read(M.VB.lba, M.VB.size), mad: Buffer.from(await disc.readFile(madRec)),
  };
  out.banks = {maria: {vh: out.vh.subarray(0, M.VH.size), vb: out.vb.subarray(0, M.VB.size), vbLba: M.VB.lba}};
  for (const b of BANKS) {
    const h = await record(disc, b + '.VH'), v = await record(disc, b + '.VB');
    out.banks[b] = {vh: Buffer.from(await disc.readFile(h)), vb: Buffer.from(await disc.readFile(v)), vbLba: v.extent};
  }
  return out;
}
// Raw 2352-byte sectors whose user data changed, with fresh EDC/ECC.
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
// Guarded bytes, both directions, both undo paths, corrupt input rejected.
function replay(from, patch, block, undo = false) {
  const p = A.parsePpf(patch), out = from.map(c => ({start: c.start, modified: Buffer.from(c.modified)}));
  assert.deepEqual(Buffer.from(p.blockCheck), block);
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at + p.lengths[n] <= c.start + 2352); assert.ok(c); const i = at - c.start, off = p.data[n], len = p.lengths[n];
    assert.deepEqual(c.modified.subarray(i, i + len), Buffer.from(p.bytes.subarray(off + (undo ? 0 : len), off + (undo ? len : 2 * len)))); });
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at < c.start + 2352), off = p.data[n], len = p.lengths[n];
    c.modified.set(p.bytes.subarray(off + (undo ? len : 0), off + (undo ? 2 * len : len)), at - c.start); });
  return out;
}

async function prepare() {
  const liveSha = await imageHash();
  const disc = await C.DiscImage.open(await fs.openAsBlob(source));
  const f = await files(disc);
  const result = M.apply({stream: f.stream, dra: f.dra, vh: f.banks.maria.vh, vb: f.banks.maria.vb, mad: f.mad, banks: f.banks, rawOffset: rawOffset(disc)});
  assert.equal(result.applied, false, "Maria's rebuilt voices are already applied.");
  const vh = Buffer.from(f.vh), vb = Buffer.from(f.vb);
  result.vh.copy(vh); result.vb.copy(vb);
  const changes = [
    ...await sectors(disc, M.STREAM_LBA, f.stream, result.stream), ...await sectors(disc, f.draLba, f.dra, result.dra),
    ...await sectors(disc, M.VH.lba, f.vh, vh), ...await sectors(disc, M.VB.lba, f.vb, vb)].sort((a, b) => a.start - b.start);
  return {liveSha, disc, f, result, changes};
}

// Read the patched image back like the game: bank from the loader records, sound entries, stream words.
async function check(disc, result) {
  const f = await files(disc);
  assert.equal(M.apply({stream: f.stream, dra: f.dra, vh: f.banks.maria.vh, vb: f.banks.maria.vb, mad: f.mad, banks: f.banks, rawOffset: rawOffset(disc)}).applied, true);
  assert.deepEqual(f.stream, result.stream);
  const vhRec = f.mad.readUInt32LE(M.MAD_VH_REC), vbRec = f.mad.readUInt32LE(M.MAD_VB_REC);
  const bank = parseBank(Buffer.from(await disc.readUserData(vhRec, f.mad.readUInt32LE(M.MAD_VH_REC + 8))),
    Buffer.from(await disc.readUserData(vbRec, f.mad.readUInt32LE(M.MAD_VB_REC + 8))), {name: 'Maria voices'});
  const resolved = M.sfxEntries().map(e => {
    const o = M.SFX_TABLE + (e.id - 0x600) * 7, c = [...f.dra.subarray(o, o + 7)];
    assert.deepEqual(c, e.new);
    const pair = bank.programs.get(c[1]).tones.slice(c[5], c[5] + 2);
    assert.equal(pair.length, 2); assert.equal(pair[0].sample, pair[1].sample);
    const s = bank.samples[pair[0].sample], want = result.bank.samples.find(x => x.name === e.name);
    assert.equal(sha(bank.vb.subarray(s.offset, s.offset + s.size)), want.sha256, e.name);
    return {id: hex(e.id), name: e.name, entry: c, sample: pair[0].sample, centre: pair[0].center, rateHz: Math.round(44100 * 2 ** ((c[2] - pair[0].center) / 12))};
  });
  assert.ok(bank.samples.at(-1).offset + bank.samples.at(-1).size <= M.VB.size);
  return resolved;
}

function readme(report) {
  const row = s => `| ${s.name} | \`${hex(M.SOUNDS.find(x => x[0] === s.name)[3])}\` | ${s.from} | ${s.size} -> ${s.kept} |`;
  return `# Maria voices rebuild (ASS 2.0)

Replaces the reverted Maria-Voices-Recovery-Pickups-D8D9264A. Maria mode only.

- **Why her voices were silent:** MarPlaySfx (0x8014F2E8) played voices only after checking that the loaded bank
  matched a stored fingerprint, then swapped Richter's sound slots 0x6F9-0x708 to a Maria config. Otherwise those
  slots kept Richter's notes (5-89), which on her bank play about 80 semitones low (an inaudible rumble).
- **Why the reverted patch broke audio:** it hooked DRA's PlaySfx for every sound in the game and kept the fragile
  slot swap. It also treated the spell voices (0x5CC, 0x5D0-0x5D3) as damage voices. This build leaves DRA's
  sound code, the common bank and Maria's effects bank (slot 2, kicks, Byakko fire) untouched.
- **Space:** sound RAM is full in Maria mode, so her slot-1 voice bank is rebuilt with exactly these 15 sounds.
  Each is cut after its last sample above about -42 dBFS. Together they use ${hex(report.bank.used)} of the
  ${hex(M.VB.size)} bytes the loader already reads. Her old attack/pain/death voice samples are gone.

| Sound | Sample (BIN offset) | Source | Size |
|---|---|---|---|
${report.bank.samples.map(row).join('\n')}

Each sound has a fixed entry in an ID nothing on the disc plays (${report.sfx.map(s => hex(s.id)).join(', ')}).
MarPlaySfx keeps its effect remap (kick swish, hit sounds, Byakko fire). Its voice half now calls a lookup at
0x8014FA20 (dead old voice code):

| Maria ID | Plays |
|---|---|
${report.voices.map(v => `| ${v.key} | ${v.what}: ${v.ids.join(' / ')}${v.ids.length > 1 ? ' (random)' : ''} |`).join('\n')}

Also: the High Jump (0x8013E3B8) and running kick / Dash Kick (0x8013C824) voice calls are back on. Four Holy Beasts
gets its voice. The slide plays SFX_WEAPON_SWISH_C (common sample 48, \`0x18B538\`). Energy Shot 3 plays its new
sound at launch and Energy Shot 4 when it is fired. The heart-paid heal plays SFX_HEALTH_PICKUP (Alucard's potion
sound).

Not in this patch: food and Life/Heart Max-Up pickup sounds. Those are played by every stage overlay (and DRA), so
they need a separate, carefully scoped change.

## Files

- \`${NAMES[0]}\`: forward patch. Input SHA-256 \`${report.source.sha256}\`, result \`${report.result}\`.
- \`${NAMES[1]}\`: reversal, restores the input image exactly.
- \`${NAMES[2]}\`: edits, hashes and checks.
- Builder: \`tools/player/build-maria-voices-patch.js\`, patch logic \`tools/player/maria-voices.js\`.

Checked statically (guarded words, PPF round trips, EDC/ECC, bank re-read through the loader records, every new
sound ID resolved to its sample). Not yet played in an emulator.
`;
}

async function main() {
  const plan = await prepare(), {liveSha, disc, changes, result} = plan;
  assert.equal(liveSha, INPUT_SHA, "Main BIN changed; rebuild Maria's voices.");
  const block = Buffer.from(await disc.file.slice(0x9320, 0x9720).arrayBuffer());
  const patches = [ppf(changes, block, 'Maria voices rebuild'), ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Maria voices rebuild')];
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
  const resolved = await check(await C.DiscImage.open(virtual), result);
  const areas = [[M.STREAM_LBA, M.STREAM_SECTORS], [plan.f.draLba, sectorsOf(plan.f.dra.length)], [M.VH.lba, sectorsOf(M.VH.size)], [M.VB.lba, sectorsOf(M.VB.size)]];
  for (const c of changes) { const l = c.start / 2352; assert.ok(areas.some(([a, n]) => l >= a && l < a + n), `Sector ${l} is outside the patched areas.`); }
  const paths = NAMES.map(n => path.join(dir, n));
  for (let i = 0; i < 2; i++) {
    try { assert.deepEqual(await fsp.readFile(paths[i]), patches[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.writeFile(paths[i], patches[i], {flag: 'wx'}); }
    assert.deepEqual(await fsp.readFile(paths[i]), patches[i]);
  }
  const report = {
    source: {path: source, size: disc.file.size, sha256: INPUT_SHA}, result: expected,
    patches: paths.slice(0, 2).map((p, i) => ({path: p, sha256: sha(patches[i])})),
    sectors: changes.map(c => c.start / 2352), decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: git(decomp)},
    editor: {revision: git(path.join(__dirname, '../..'))},
    bank: {used: result.bank.used, samples: result.bank.samples}, sfx: result.sfx, resolved, voices: result.voices, edits: result.edits,
    verified: 'Guarded forward/reversal, both undo paths, corrupt-input rejection, sector EDC/ECC, streaming full-image hashes, bank re-read through the MAD.BIN loader records, every new sound ID resolved to its trimmed sample, word guards. Not yet played in an emulator.'};
  await fsp.writeFile(paths[2], JSON.stringify(report, null, 2) + '\n');
  await fsp.writeFile(paths[3], readme(report));
  if (process.argv.includes('--apply')) {
    assert.equal(await imageHash(), INPUT_SHA);
    const handle = await fsp.open(source, 'r+');
    try {
      for (const c of changes) { const cur = Buffer.alloc(2352); assert.equal((await handle.read(cur, 0, 2352, c.start)).bytesRead, 2352); assert.deepEqual(cur, c.original); }
      for (const c of changes) assert.equal((await handle.write(c.modified, 0, 2352, c.start)).bytesWritten, 2352);
      await handle.sync();
    } finally { await handle.close(); }
    assert.equal(await imageHash(), expected);
    const live = await C.DiscImage.open(await fs.openAsBlob(source));
    for (const c of changes) { const b = Buffer.from(await live.file.slice(c.start, c.start + 2352).arrayBuffer()); assert.deepEqual(b, c.modified); }
    const back = replay(changes.map(c => ({start: c.start, modified: Buffer.from(c.modified)})), patches[1], block);
    assert.equal(await imageHash(back), INPUT_SHA);
  }
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), input: INPUT_SHA, result: expected, sectors: changes.length,
    patches: report.patches, verification: paths[2], bankUsed: hex(result.bank.used), edits: result.edits.length, resolved}, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = {prepare, check, INPUT_SHA, NAMES};
