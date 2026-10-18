const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), M = require('../../stats-model.js'), A = require('../../ass2-core.js');
const T = require('./scylla-wyrm-respawn.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
async function inspect(image, installed) {
  const disc = await C.DiscImage.open(new Blob([image])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const record = await disc.findPath(T.PATH), file = Buffer.from(await disc.readFile(record));
  if (installed) T.verify(file);
  const dra = model.files.DRA.bytes, hp = id => Buffer.from(dra).readInt16LE(model.tables.enemy + id * 0x28 + 4);
  return {disc, model, record, file, hp: {scylla: hp(T.SCYLLA), scyllawyrm: hp(0x126)}};
}
async function main() {
  if (!directory) throw Error('Supply an output directory.');
  const reportPath = path.resolve(directory, 'verification.json');
  if (applying) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    apply(image, forward); assert.equal(sha(image), report.result.sha256); await inspect(image, true);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      assert.equal(sha(await handle.readFile()), report.source.sha256, 'The source changed before writing.');
      for (const sector of report.sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
        assert.equal((await handle.write(bytes, 0, bytes.length, start)).bytesWritten, bytes.length);
      }
      await handle.sync();
    } finally {await handle.close();}
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256); await inspect(live, true);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    const readme = path.resolve(directory, 'README.md');
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('The original BIN is unchanged.', 'Applied with explicit user approval; the live hash, checksums and exact reversal passed.'));
    console.log(JSON.stringify(report.application, null, 2)); return;
  }
  const original = await fs.readFile(source), before = sha(original), opened = await inspect(original, false);
  const modified = T.overlay(opened.file);
  const changes = await C.changedSectors(opened.disc, opened.record, opened.file, modified);
  const work = Buffer.from(original);
  for (const c of changes) {assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);}
  const after = sha(work), result = await inspect(work, true);
  assert.deepEqual(result.model.files.DRA.bytes, opened.model.files.DRA.bytes);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Scylla: no flinch, wyrms respawn once at half HP');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Scylla wyrm respawn');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const name = 'Scylla-Wyrm-Respawn-ASS-2.0', hex = v => '0x' + v.toString(16).toUpperCase();
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, `${name}.ppf`), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, `Reverse-${name}.ppf`), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    file:{path:T.PATH.join('/'), lba:opened.record.extent, size:opened.record.size, sha256Before:sha(opened.file), sha256After:sha(modified)},
    hp:{...opened.hp, threshold:`respawn when Scylla HP * 2 < ${opened.hp.scylla} (read live from the enemy table)`},
    edits:T.edits(opened.file).map(e => ({address:hex(T.BASE + e.off), fileOffset:hex(e.off), bytes:e.expect.length,
      original:e.original.toString('hex').toUpperCase(), patched:e.expect.toString('hex').toUpperCase()})),
    findings:'Scylla (entity 0x31, enemy 0x11F) creates three wyrm controllers (entity 0x3A, params 1-3) at her slots +2, +15 and +28 when the fight starts; each wyrm owns 13 slots and frees all of them when it dies. Her idle step ran "if (hitFlags & 3) SetStep(5)", her only flinch. Those 7 words now hold the respawn check, so she no longer flinches. Below half HP (live current HP * 2 < max HP from the enemy table) she recreates every wyrm whose slot is free, with the vanilla position (0x48, 0x90), params and zPriority, and sets unused fight-state bit 0x80 at 0x80180D48 so it never happens again. While all three wyrms are alive the check stays armed; while a wyrm is still dying it waits. Living wyrms are left as they are. The code lives in her unreachable debug step 0xFF (0x801A358C, 43 of 44 words; the hook uses the free register at for the flag store). Nothing in BO3 sets step 0xFF, and her hurt step 5 is left in place but is no longer entered.',
    inspected:['BO3.BIN vs vanilla: ASS edits at 0x80180A1A-0x80190F87 (data), 0x8019D845/63, 0x801A07B0, 0x801A74E4, 0x801A78F2, 0x801A80C4, 0x801AB48C/DC, 0x801B0CD0, 0x801B1200; none overlap this patch', 'Scylla 0x801A2AEC-0x801A3658 (steps 0-6 and 0xFF)', 'wyrm controller 0x801A5338, neck 0x801A57A4, head 0x801A5948, helpers 0x801A4FB8-0x801A5334', 'InitializeEntity 0x801AA82C (enemy table stride 0x28, HP +4; zPriority kept when nonzero)', 'CreateEntityFromEntity 0x801A8DF0', 'room 28 layout: Scylla slot 0x10 -> g_Entities[80], wyrms 82-120', 'all 0x80180D48 users (bits 0x01-0x40)', 'DRA enemy rows 0x11F and 0x126'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/boss/bo3/unk_1CEEC.c (INCLUDE_ASM only)', 'src/boss/bo3/e_init.c', 'config/splat.us.bobo3.yaml', 'config/symbols.us.bobo3.txt']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'DRA unchanged', 'original source unchanged', 'instruction simulation (tests/scylla-wyrm-respawn.test.js)'],
    gameplay:'Not yet played in an emulator. Fresh-boot and load a memory-card save (old savestates keep the old overlay), kill one or more wyrms, then bring Scylla below half HP; also try with all wyrms alive at half HP (the next one killed should return) and with a wyrm mid-death.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Scylla: no flinch, wyrms respawn once\n\n- Scylla no longer plays her hurt animation when hit. She still takes damage.\n- When her HP first drops below half (${opened.hp.scylla} max in this BIN, read live), every wyrm that has been killed comes back, once per fight. If all three are alive at that point, the respawn waits until one has died. Living wyrms are left alone, and a wyrm that is still dying is waited for. Respawned wyrms rise with the original delays (48, 96 and 144 frames).\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-scylla-wyrm-respawn-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
