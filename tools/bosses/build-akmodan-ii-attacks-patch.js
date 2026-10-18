// Akmodan II attack tuning (RBO7, Death Wing's Lair): 6 aimed shots 2 s apart, 3-frame barrage, screen-wide arm stretch,
// 8-flame trail bursts and the vanilla pain burst restored.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./akmodan-ii-attacks.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Akmodan-II-Attack-Tuning-ASS-2.0';
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const hex = v => '0x' + v.toString(16).toUpperCase();

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image])), files = new Map(), records = new Map();
  for (const o of T.OVERLAYS) {
    const record = await disc.findPath(o.path);
    records.set(o.name, record); files.set(o.name, Buffer.from(await disc.readFile(record)));
  }
  return {disc, files, records};
}

function checksums(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
}

async function installedIn(image) {
  const {files} = await inspect(image);
  for (const o of T.OVERLAYS) T.verify(files.get(o.name));
}

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.resolve(directory, names[2]);
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'Source changed; rebuild the patch pair.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    checksums(image, report.sectors); await installedIn(image);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
      }
      for (const sector of report.sectors) {
        const start = sector * 2352;
        assert.equal((await handle.write(image.subarray(start, start + 2352), 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256); checksums(live, report.sectors);
    await installedIn(live);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    const readme = path.resolve(directory, names[3]);
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('The original BIN is unchanged.', 'Applied with explicit user approval; the live hash, checksums and exact reversal passed.'));
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, files, records} = await inspect(original), after = new Map(), changes = [];
  for (const o of T.OVERLAYS) {
    after.set(o.name, T.overlay(files.get(o.name)));
    changes.push(...await C.changedSectors(disc, records.get(o.name), files.get(o.name), after.get(o.name)));
  }
  const sectors = changes.map(c => c.start / 2352).sort((a, b) => a - b);
  assert.equal(new Set(sectors).size, sectors.length);
  const image = Buffer.from(original); changes.forEach(c => image.set(c.modified, c.start)); checksums(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Akmodan II attack tuning');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Restore ASS 2.0 Akmodan II attacks');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await inspect(image);
  for (const [name, bytes] of reopened.files) assert.deepEqual(bytes, after.get(name), name);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < image.length; at += 2352) if (!changed.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial);
  const rbo7 = files.get('RBO7');
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length,
    tuning: {aimedShots: T.AIMED_SHOTS, aimedGapFrames: T.AIMED_GAP, barrageEveryFrames: T.BARRAGE_EVERY, barrageShots: 180 / T.BARRAGE_EVERY,
      flamesPerRoll: T.FLAME_TILES * 2, flameOffsetsPx: [-4, -3, -2, -1, 1, 2, 3, 4].map(n => n * T.TILE),
      armRows: T.ARM.map(([x, y, w, h]) => ({offX: x, offY: y, halfWidth: w, halfHeight: h, aheadPx: w - x, behindPx: Math.max(0, w + x)}))},
    files: T.OVERLAYS.map(o => ({path: o.path.join('/'), lba: records.get(o.name).extent, size: records.get(o.name).size,
      sha256Before: sha(files.get(o.name)), sha256After: sha(after.get(o.name)),
      edits: T.edits(rbo7).map(e => ({name: e.name, address: hex(e.at), fileOffset: hex(e.off), bytes: e.expect.length,
        original: e.original.toString('hex').toUpperCase(), patched: e.expect.toString('hex').toUpperCase()}))})),
    findings: 'Akmodan II (EntityAkmodanII 0x801940B4, enemy 0x10B) runs the ASS 2.0 attack controller 0x801A2CEC each frame. Phase 0 starts the lunge grab (step 5) with a 241-frame cooldown; phases 1..N-1 each fire one aimed shot (0x801A2F44: E_UNK_1C params 1, enemy 0x10D, 6 px/frame toward Alucard) and reset the cooldown; phase N starts the step-9 barrage (180 frames, random-angle shots). Changes: N 4 -> 7 and the post-shot cooldown 240 -> 120, so six aimed shots 2 s apart fill the same window and the barrage still starts 961 frames after the grab; the barrage fires when timer % 3 == 0 (60 shots, was every 4 frames / 45), its shot call moved to 4 dead vanilla words at 0x801944D8. ASS 2.0 jumps from step 3 (after the walk timer) straight to the epilogue, skipping the vanilla arm-stretch distance trigger, the pain check and the grab-distance trigger; the jump now goes to the vanilla pain check (hitFlags & 3 -> SetStep(6): 8 E_UNK_1C bursts, params 0, which the ASS projectile code still routes to the vanilla burst) and then to the epilogue, so both distance triggers stay off. The flame trail (vanilla 1-in-16 roll per walking frame) now spawns 8 flames (E_UNK_1D, enemy 0x10D) at 16-64 px on both sides instead of one 6 px behind. Arm-stretch hitbox rows 1-5 grow to a 255 half-width around a centre 32 px ahead; HitDetection skips hitboxes whose centre is off screen (x <= -32 or >= 288), so the centre cannot be pushed further out.',
    inspected: ['RBO7.BIN vs vanilla US: ASS 2.0 changed AI words 0x8019410C, 0x801941A4, 0x801942F0, 0x80194440, 0x801944D4, 0x80195650-0x80195713, 0x80195AB0, data 0x80180640-0x80180663 and 0x80180750-0x80180763, and appended 0x801A2CEC-0x801A2FE3',
      'Flame block 0x80194394-0x8019441B and words 0x801944D8-0x801944E7 are vanilla bytes; no branch, jump or data word outside 0x80194394-0x8019451F targets them',
      'EntityAkmodanII prologue saves s0-s7/fp/ra; s0/s1 are scratch in step 3 (vanilla overwrote both there)', 'HitDetection centre-on-screen bounds (src/st/collision.h)',
      'EInit enemy IDs 0x10B/0x10C/0x10D'],
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'), upstream: 'origin/master bdcc06fdf4880c700b5a0801b975be5c4326d734 (read with git show; local tree untouched)',
      files: ['src/boss/rbo7/e_akmodan_ii.c', 'src/boss/rbo7/e_init.c', 'include/enemies.h', 'include/entity.h (ET_AkmodanII)', 'src/st/collision.h', 'config/symbols.us.borbo7.txt'],
      localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['ASS 2.0 signatures for the AI, controller and hitbox tables', 'exact original bytes at every edit site', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged', 'instruction simulation (tests/akmodan-ii-attacks.test.js)'],
    gameplay: 'Not yet played in an emulator. Enter Death Wing\'s Lair afresh (no savestate inside RBO7). Flames, aimed shots, barrage shots and pain bursts share entity slots 160-191; when the slots are full, new ones are skipped (no crash).',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Akmodan II attack tuning\n\n- Aimed fireball: ${T.AIMED_SHOTS} shots, ${T.AIMED_GAP / 60} s apart (was 3 shots, 4 s apart). The first still comes about 4 s after the grab, and the barrage still starts at the same point in the cycle.\n- Barrage: one shot every ${T.BARRAGE_EVERY} frames (60 shots in 3 s; was every 4 frames, 45 shots).\n- Arm stretch: the hitbox grows with the arm. When the arm is fully out, it spans the whole screen: 287 px ahead and 223 px behind. The centre stays 32 px ahead because the game ignores hitboxes centred off screen. The arm graphic is unchanged.\n- Flame trail: each roll (1 in 16 per walking frame, as before) spawns 8 flames, one per 16 px tile at 16-64 px ahead and behind.\n- Pain burst restored: a hit while he walks fires the vanilla 8-shot burst again. The vanilla distance triggers for the arm stretch and grab stay off.\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${initial}\n\nExpected after SHA-256: ${final}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision} (Akmodan source from ${report.decomp.upstream}). Editor: ${report.editor.revision}. See ${names[2]} for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-akmodan-ii-attacks-patch.js <output-directory>\n\nAfter explicit approval: node tools/bosses/build-akmodan-ii-attacks-patch.js "${path.resolve(directory)}" --apply\n\n${report.gameplay}\n`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
