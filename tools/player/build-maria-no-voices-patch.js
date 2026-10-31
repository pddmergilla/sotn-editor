// Maria mode: no voices, effects kept. Replaces Maria-Voices-Rebuild-D8D9264A (its voices played as noise in game).
// node tools/player/build-maria-no-voices-patch.js [--apply]
// - Undoes the voice rebuild (voice bank, sound entries 0x841-0x862, voice lookup, re-enabled voice calls).
// - MarPlaySfx (0x8014F2E8) keeps its effect remap and never runs its voice half: the bank check call at 0x8014F340
//   is removed and the voice-table branch at 0x8014F34C always skips.
// - Keeps the non-voice changes: slide plays SFX_WEAPON_SWISH_C (common sample 48), the heart-paid heal plays
//   SFX_HEALTH_PICKUP (Alucard's potion sound).
// Writes the forward and reversal PPFs, a verification JSON and a README next to the main BIN. --apply writes the
// forward patch to the main BIN; use it only after explicit approval.
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const R1 = require('./maria-effects-repair.js');
const {ppf} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const dir = path.join(__dirname, '../../MainBIN');
// Main BIN with Maria-Voices-Rebuild-D8D9264A applied (2026-10-30).
const INPUT_SHA = 'D253A43C327530C1033947D916FC849916CAD6C07C441560DA35D95AEAB938AA';
const BEFORE_REBUILD = 'D8D9264A57108BA979480FE91F6C36768D34167EF129C78A573B28BA3B40BEB4';
const REBUILD_REVERSE = path.join(dir, 'Reverse-Maria-Voices-Rebuild-D8D9264A.ppf');
const base = `Maria-No-Voices-${INPUT_SHA.slice(0, 8)}`;
const NAMES = [`${base}.ppf`, `Reverse-${base}.ppf`, `${base}.verification.json`, `${base}.README.md`];
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const git = cwd => child.execFileSync('git', ['-c', `safe.directory=${cwd}`, 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

// [ram, before the rebuild, new, what]; stream words of Maria's player overlay.
const WORDS = [
  [0x8014F340, 0x0C053CFC, 0x00000000, 'MarPlaySfx: no voice bank check'],
  [0x8014F34C, 0x10400015, 0x10000015, 'MarPlaySfx: always skip the voice table (effects still play)'],
  [0x8013C6FC, 0x0C053CBA, 0x0C04B3AF, 'slide: play directly'],
  [0x8013C700, 0x24040617, 0x2404060C, 'slide: SFX_WEAPON_SWISH_C (common sample 48)'],
  [0x8012BC68, 0x3404068F, 0x3404068E, 'heart-paid heal: SFX_HEALTH_PICKUP (Alucard potion sound)'],
];

async function imageHash(replacements = []) {
  const h = crypto.createHash('sha256'); let at = 0;
  for await (const chunk of fs.createReadStream(source, {highWaterMark: 1 << 20})) {
    for (const c of replacements) { const s = Math.max(at, c.start), e = Math.min(at + chunk.length, c.start + c.modified.length); if (s < e) chunk.set(c.modified.subarray(s - c.start, e - c.start), s - at); }
    h.update(chunk); at += chunk.length;
  }
  return h.digest('hex').toUpperCase();
}
// Applies a PPF to raw sectors {start, modified}; checks the guarded bytes first.
function replay(from, patch, block, undo = false) {
  const p = A.parsePpf(patch), out = from.map(c => ({start: c.start, modified: Buffer.from(c.modified)}));
  assert.deepEqual(Buffer.from(p.blockCheck), block);
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at + p.lengths[n] <= c.start + 2352); assert.ok(c, `No sector for ${hex(at)}`); const i = at - c.start, off = p.data[n], len = p.lengths[n];
    assert.deepEqual(c.modified.subarray(i, i + len), Buffer.from(p.bytes.subarray(off + (undo ? 0 : len), off + (undo ? len : 2 * len)))); });
  p.offsets.forEach((at, n) => { const c = out.find(c => at >= c.start && at < c.start + 2352), off = p.data[n], len = p.lengths[n];
    c.modified.set(p.bytes.subarray(off + (undo ? len : 0), off + (undo ? 2 * len : len)), at - c.start); });
  return out;
}

async function prepare() {
  const disc = await C.DiscImage.open(await fs.openAsBlob(source));
  const block = Buffer.from(await disc.file.slice(0x9320, 0x9720).arrayBuffer());
  const raw = async lba => Buffer.from(await disc.file.slice(lba * 2352, lba * 2352 + 2352).arrayBuffer());
  const rebuildReverse = await fsp.readFile(REBUILD_REVERSE);
  const touched = [...new Set(A.parsePpf(rebuildReverse).offsets.map(o => Math.floor(o / 2352)))];
  // Every stream sector, plus the sectors the rebuild touched outside it.
  const lbas = [...new Set([...Array.from({length: R1.STREAM_SECTORS}, (_, i) => R1.STREAM_LBA + i), ...touched])].sort((a, b) => a - b);
  const current = await Promise.all(lbas.map(async l => ({start: l * 2352, modified: await raw(l)})));
  const target = replay(current, rebuildReverse, block);                 // the image before the rebuild
  const pre = target.map(c => ({start: c.start, modified: Buffer.from(c.modified)}));
  const stream = Buffer.concat(lbas.filter(l => l >= R1.STREAM_LBA && l < R1.STREAM_LBA + R1.STREAM_SECTORS)
    .map(l => target.find(c => c.start === l * 2352).modified.subarray(24, 2072)));
  const edits = [];
  for (const [ram, old, w, what] of WORDS) {
    const at = R1.streamOffset(ram), cur = stream.readUInt32LE(at);
    assert.equal(cur, old, `${hex(ram)} (${what}) is ${hex(cur)}, expected ${hex(old)}.`);
    stream.writeUInt32LE(w, at); edits.push({at: hex(ram), old: hex(old), new: hex(w), what});
  }
  for (const c of target) {
    const l = c.start / 2352, k = l - R1.STREAM_LBA;
    if (k < 0 || k >= R1.STREAM_SECTORS) continue;
    stream.copy(c.modified, 24, k * 2048, k * 2048 + 2048);
    c.modified = Buffer.from(C.repairSector(Uint8Array.from(c.modified), 24));
  }
  const changes = target.map((c, i) => ({start: c.start, original: current[i].modified, modified: c.modified})).filter(c => !c.original.equals(c.modified));
  return {disc, block, changes, edits, stream, current, pre};
}

async function main() {
  const {disc, block, changes, edits, current, pre} = await prepare();
  assert.equal(await imageHash(), INPUT_SHA, 'Main BIN changed; rebuild the no-voices patch.');
  const patches = [ppf(changes, block, 'Maria no voices'), ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Maria no voices')];
  const original = changes.map(c => ({start: c.start, modified: Buffer.from(c.original)}));
  const forward = replay(original, patches[0], block), reverse = replay(forward, patches[1], block);
  const undo = replay(forward, patches[0], block, true), reverseUndo = replay(original, patches[1], block, true);
  for (let i = 0; i < changes.length; i++) {
    assert.deepEqual(forward[i].modified, changes[i].modified); assert.deepEqual(reverse[i].modified, original[i].modified);
    assert.deepEqual(undo[i].modified, original[i].modified); assert.deepEqual(reverseUndo[i].modified, forward[i].modified);
  }
  const corrupt = original.map(c => ({...c, modified: Buffer.from(c.modified)})); corrupt[0].modified[A.parsePpf(patches[0]).offsets[0] - corrupt[0].start] ^= 1;
  assert.throws(() => replay(corrupt, patches[0], block));
  for (const c of forward) assert.deepEqual(Buffer.from(C.repairSector(Uint8Array.from(c.modified), 24)), c.modified);
  const expected = await imageHash(forward);
  assert.equal(await imageHash(reverse), INPUT_SHA); assert.equal(await imageHash(undo), INPUT_SHA); assert.equal(await imageHash(reverseUndo), expected);
  // Outside the sectors holding the five stream words, the result equals the image before the rebuild.
  const wordSectors = new Set(WORDS.map(([ram]) => R1.STREAM_LBA + Math.floor(R1.streamOffset(ram) / 2048)));
  for (const c of pre) {
    const f = forward.find(f => f.start === c.start), now = f ? f.modified : current.find(x => x.start === c.start).modified;
    if (!wordSectors.has(c.start / 2352)) assert.deepEqual(now, c.modified, `Sector ${c.start / 2352} differs from the pre-rebuild image.`);
  }
  const paths = NAMES.map(n => path.join(dir, n));
  for (let i = 0; i < 2; i++) {
    try { assert.deepEqual(await fsp.readFile(paths[i]), patches[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.writeFile(paths[i], patches[i], {flag: 'wx'}); }
    assert.deepEqual(await fsp.readFile(paths[i]), patches[i]);
  }
  const report = {
    source: {path: source, size: disc.file.size, sha256: INPUT_SHA}, result: expected, beforeRebuild: BEFORE_REBUILD,
    patches: paths.slice(0, 2).map((p, i) => ({path: p, sha256: sha(patches[i])})), sectors: changes.map(c => c.start / 2352),
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: git(decomp)}, editor: {revision: git(path.join(__dirname, '../..'))},
    edits, verified: 'Guarded forward/reversal, both undo paths, corrupt-input rejection, sector EDC/ECC, streaming full-image hashes; every changed sector except the word edits equals the image before Maria-Voices-Rebuild. Not yet played in an emulator.'};
  await fsp.writeFile(paths[2], JSON.stringify(report, null, 2) + '\n');
  await fsp.writeFile(paths[3], `# Maria no voices (ASS 2.0)

Replaces Maria-Voices-Rebuild-D8D9264A, whose voices played as noise in game and could cut off other sounds.

- Undoes the rebuild: her original voice bank, sound entries 0x841-0x862 (back to unused), the voice lookup and the
  re-enabled voice calls.
- Maria never plays a voice: MarPlaySfx (0x8014F2E8) keeps its effect remap (kick swish, hit sounds, Byakko fire,
  spell sounds) and skips its voice half.
- Kept: the slide plays SFX_WEAPON_SWISH_C (common sample 48); the heart-paid heal plays SFX_HEALTH_PICKUP.
- Energy Shot 3/4 keep their original sounds (the new ones were in the voice bank).

## Files

- \`${NAMES[0]}\`: forward patch. Input SHA-256 \`${INPUT_SHA}\`, result \`${expected}\`.
- \`${NAMES[1]}\`: reversal, restores the input image exactly.
- \`${NAMES[2]}\`: edits, hashes and checks.
- Builder: \`tools/player/build-maria-no-voices-patch.js\`.

Checked statically. Not yet played in an emulator.
`);
  if (process.argv.includes('--apply')) {
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
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), input: INPUT_SHA, result: expected, sectors: changes.length, patches: report.patches, edits}, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = {prepare, INPUT_SHA, NAMES, WORDS};
