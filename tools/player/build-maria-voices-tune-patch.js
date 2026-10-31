// Builds the guarded PPF pair for swapping Maria's attack/hurt voices and lowering her voices 10%
// (tools/player/maria-voices-tune.js).
// node tools/player/build-maria-voices-tune-patch.js [--apply]
// Writes the forward and reversal PPFs, a verification JSON and a README next to the main BIN. --apply writes the
// forward patch to the main BIN; use it only after explicit approval.
const assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('./maria-voices-tune.js'), O = require('./maria-voices-own.js'), V = require('./maria-voices.js');
const {parseBank} = require('../audio/sound-check.js');
const {ppf} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const dir = path.join(__dirname, '../../MainBIN');
// Main BIN with Maria-Voices-Own-1A5D642F applied (2026-10-31).
const INPUT_SHA = 'F0F0B97C280745607625347293A573503A1328CA4E03ADCFB31745B97DAEE6AA';
const base = `Maria-Voices-Tune-${INPUT_SHA.slice(0, 8)}`;
const NAMES = [`${base}.ppf`, `Reverse-${base}.ppf`, `${base}.verification.json`, `${base}.README.md`];
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
async function files(disc) {
  const read = async (lba, n) => Buffer.from(await disc.readUserData(lba, n * 2048));
  const dra = await disc.findPath(['DRA.BIN']);
  return {stream: await read(M.STREAM_LBA, M.STREAM_SECTORS), draLba: dra.extent, dra: await read(dra.extent, sectorsOf(dra.size)),
    vhArea: await read(M.VH_LBA, sectorsOf(M.VH_SIZE))};
}
const run = f => M.apply({stream: f.stream, dra: f.dra, vh: f.vhArea.subarray(0, M.VH_SIZE)});

async function main() {
  const disc = await C.DiscImage.open(await fs.openAsBlob(source)), f = await files(disc), result = run(f);
  assert.equal(result.applied, false, 'Already applied.');
  assert.equal(await imageHash(), INPUT_SHA, 'Main BIN changed; rebuild.');
  const vhArea = Buffer.from(f.vhArea); result.vh.copy(vhArea);
  const changes = [...await sectors(disc, M.STREAM_LBA, f.stream, result.stream), ...await sectors(disc, f.draLba, f.dra, result.dra),
    ...await sectors(disc, M.VH_LBA, f.vhArea, vhArea)].sort((x, y) => x.start - y.start);
  const block = Buffer.from(await disc.file.slice(0x9320, 0x9720).arrayBuffer());
  const patches = [ppf(changes, block, 'Maria voices tune'), ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Maria voices tune')];
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
  // Re-read: the bank keeps its samples; every voice of hers plays 10% lower.
  const virtual = {size: disc.file.size, type: '', slice(b = 0, e = disc.file.size) { return {arrayBuffer: async () => {
    const out = Buffer.from(await disc.file.slice(b, e).arrayBuffer());
    for (const c of forward) { const s = Math.max(b, c.start), t = Math.min(e, c.start + 2352); if (s < t) out.set(c.modified.subarray(s - c.start, t - c.start), s - b); }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length); }}; }};
  const vf = await files(await C.DiscImage.open(virtual));
  assert.equal(run(vf).applied, true);
  const before = parseBank(f.vhArea.subarray(0, M.VH_SIZE), Buffer.alloc(0xE180), {name: 'before'});
  const after = parseBank(vf.vhArea.subarray(0, M.VH_SIZE), Buffer.alloc(0xE180), {name: 'after'});
  assert.deepEqual(after.samples, before.samples);
  const pitch = O.LAYOUT.filter(l => l[1] === 'maria' && l[5]).map(([name, , , prog, tone, id]) => {
    const o = V.SFX_TABLE + (id - 0x600) * 7, note0 = f.dra[o + 2], note1 = vf.dra[o + 2];
    const t0 = before.programs.get(prog).tones[tone], t1 = after.programs.get(prog).tones[tone];
    const st = (note1 + t1.fine / 128) - (note0 + t0.fine / 128);
    assert.ok(Math.abs(st - 12 * Math.log2(0.9)) < 0.02, name);
    return {id: hex(id), name, semitones: +st.toFixed(3), ratio: +(2 ** (st / 12)).toFixed(4)};
  });
  const paths = NAMES.map(n => path.join(dir, n));
  for (let i = 0; i < 2; i++) {
    try { assert.deepEqual(await fsp.readFile(paths[i]), patches[i]); } catch (e) { if (e.code !== 'ENOENT') throw e; await fsp.writeFile(paths[i], patches[i], {flag: 'wx'}); }
    assert.deepEqual(await fsp.readFile(paths[i]), patches[i]);
  }
  const report = {source: {path: source, size: disc.file.size, sha256: INPUT_SHA}, result: expected,
    patches: paths.slice(0, 2).map((p, i) => ({path: p, sha256: sha(patches[i])})), sectors: changes.map(c => c.start / 2352),
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: git(decomp)}, editor: {revision: git(path.join(__dirname, '../..'))},
    voices: result.voices, pitch, edits: result.edits,
    verified: 'Guarded forward/reversal, both undo paths, corrupt-input rejection, sector EDC/ECC, streaming full-image hashes; bank re-read with unchanged samples, every voice of hers at 0.9x pitch. Not yet played in an emulator.'};
  await fsp.writeFile(paths[2], JSON.stringify(report, null, 2) + '\n');
  await fsp.writeFile(paths[3], `# Maria voices: swapped and 10% lower (ASS 2.0)

On top of Maria-Voices-Own-1A5D642F. Maria mode only.

- Attack calls (kick start, running kick, Energy Shot fire: one time in three; High Jump and Dash Kick: always)
  play her PAIN_B/C/D samples. Damage and grab reactions play her attack grunts (8E6, ATTACK_C, 8E8, 8E9).
- All her voices (summons, grunts, pains) play 10% lower: note 60 -> 58 and each tone's fine tune +22/128
  (-1.83 semitones, x0.90). The Energy Shot sounds are unchanged.

| Maria ID | Plays |
|---|---|
${result.voices.map(v => `| ${v.key} | ${v.what}: ${v.ids.join(' / ')}${v.ids.length > 1 ? ' (random)' : ''} |`).join('\n')}

## Files

- \`${NAMES[0]}\`: forward patch. Input SHA-256 \`${INPUT_SHA}\`, result \`${expected}\`.
- \`${NAMES[1]}\`: reversal, restores the input image exactly.
- \`${NAMES[2]}\`: edits, hashes and checks.
- Builder: \`tools/player/build-maria-voices-tune-patch.js\`, patch logic \`tools/player/maria-voices-tune.js\`.

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
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), input: INPUT_SHA, result: expected, sectors: changes.length,
    patches: report.patches, voices: result.voices.map(v => `${v.key} ${v.ids.join('/')}`), pitch}, null, 2));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
