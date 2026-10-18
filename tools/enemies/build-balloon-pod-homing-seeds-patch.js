// Balloon Pod seeds home in on Alucard (RDAI Anti-Chapel and RNO4 Reverse Caverns overlays).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./balloon-pod-homing-seeds.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Balloon-Pod-Homing-Seeds-ASS-2.0';
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
  for (const o of T.OVERLAYS) T.verify(o, files.get(o.name));
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
    after.set(o.name, T.overlay(o, files.get(o.name)));
    changes.push(...await C.changedSectors(disc, records.get(o.name), files.get(o.name), after.get(o.name)));
  }
  const sectors = changes.map(c => c.start / 2352).sort((a, b) => a - b);
  assert.equal(new Set(sectors).size, sectors.length);
  const image = Buffer.from(original); changes.forEach(c => image.set(c.modified, c.start)); checksums(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Balloon Pod seeds home in on Alucard');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Restore falling Balloon Pod seeds');
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
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length,
    tuning: {homingFrames: T.HOMING_FRAMES, maxTurnPerFrame: hex(T.TURN) + ' (of 0x1000 = 360 degrees)', speed: `${T.SPEED}/16 px per frame`},
    files: T.OVERLAYS.map(o => ({path: o.path.join('/'), lba: records.get(o.name).extent, size: records.get(o.name).size,
      sha256Before: sha(files.get(o.name)), sha256After: sha(after.get(o.name)), seedEntity: hex(o.seedEntity),
      edits: T.edits(o, files.get(o.name)).map(e => ({address: hex(T.BASE + e.off), fileOffset: hex(e.off), bytes: e.expect.length,
        original: e.original.toString('hex').toUpperCase(), patched: e.expect.toString('hex').toUpperCase()}))})),
    findings: 'Balloon Pod (EntityRdaiUnk33, enemy 0x11D) spawns 16 seeds (EntityImpDeathParticle, enemy 0x11E) when it pops. Each seed bursts outward for 16-47 frames, then in vanilla step 2 falls at up to 0.5 px/frame while swaying (velocityX = rcos(rotate) * 8, rotate += 0x80). The same code is in RDAI (seed entity 0x34) and RNO4 (seed entity 0x5D); nothing else in either overlay creates those entities. Patched step 2 keeps the vanilla MoveEntity call, then for the first 180 frames turns the seed heading (rotate) toward Alucard (GetAngleBetweenEntities(self, PLAYER)) by at most 0x20 per frame and sets its velocity to 12 * (rcos, rsin) = 0.75 px/frame along that heading, counting frames in the seed timer (ext +0x80, zero after the burst). A seed that damages Alucard (hitFlags bit 0x80) pops through its own death path (sound 0x691, EntityExplosion). After 180 frames the unchanged vanilla fall resumes from the current heading. The code lives in the Balloon Pod\'s unreachable debug step 0xFF (39 of 41 words); its step dispatch now sends a stray step 0xFF to the Pod epilogue.',
    inspected: ['RDAI.BIN and RNO4.BIN vs vanilla US: the Balloon Pod + seed functions and GetAngleBetweenEntities are byte-identical to vanilla (no ASS edits there)',
      'RDAI 0x801C4668-0x801C4B28 / RNO4 0x801DC260-0x801DC720 (Pod steps 0-5 and 0xFF, seed steps 0-2)', 'EInit enemy IDs 0x11D / 0x11E in both overlays',
      'GetAngleBetweenEntities RDAI 0x801B85A4, RNO4 0x801CE15C', 'all creators of seed entity 0x34 (RDAI) / 0x5D (RNO4)'],
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'),
      files: ['src/st/e_rdai_unk33.h', 'src/st/e_imp_death_particle.h', 'src/st/st_common.h (GetAngleBetweenEntities)', 'src/st/rdai/e_init.c', 'src/st/rno4/e_init.c', 'config/symbols.us.strdai.txt', 'config/symbols.us.strno4.txt', 'tools/extract_overlay/enemy_defs.yaml'],
      localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['vanilla-code signatures for both overlays', 'only the three edit ranges per overlay change', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged', 'instruction simulation (tests/balloon-pod-homing-seeds.test.js)'],
    gameplay: 'Not yet played in an emulator. RDAI/RNO4 load when the stage is entered, so enter Anti-Chapel or Reverse Caverns afresh (not from an old savestate inside the stage) and pop a Balloon Pod.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Balloon Pod seeds home in on Alucard\n\nWhen a Balloon Pod pops, its 16 seeds still burst out as before. Then, instead of drifting down, each seed steers toward Alucard for ${T.HOMING_FRAMES / 60} seconds at ${T.SPEED / 16} px per frame (Alucard walks faster), turning at most ${(T.TURN * 360 / 4096).toFixed(1)} degrees per frame. A seed that hits Alucard pops. After the homing time it falls and sways as in vanilla. Seeds can still be destroyed by attacks.\n\nApplies in Anti-Chapel (RDAI) and Reverse Caverns (RNO4).\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${initial}\n\nExpected after SHA-256: ${final}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See ${names[2]} for the exact edits, inspected areas and checks.\n\nPrepare: node tools/enemies/build-balloon-pod-homing-seeds-patch.js <output-directory>\n\nAfter explicit approval: node tools/enemies/build-balloon-pod-homing-seeds-patch.js "${path.resolve(directory)}" --apply\n\n${report.gameplay}\n`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
