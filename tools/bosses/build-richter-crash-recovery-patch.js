const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./richter-crash-recovery.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
async function inspect(image, installed) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const record = await disc.findPath(T.PATH), file = Buffer.from(await disc.readFile(record));
  if (installed) T.verify(file); else T.check(file);
  return {disc, record, file};
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
  const after = sha(work); await inspect(work, true);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Richter crash recovery crouch - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Richter crash recovery crouch - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  for (let at = 0; at < modified.length; at++) if (!T.edits().some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(modified[at], opened.file[at]);
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const name = 'Richter-Crash-Recovery-ASS-2.0', hex = v => '0x' + v.toString(16).toUpperCase();
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, `${name}.ppf`), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, `Reverse-${name}.ppf`), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    file:{path:T.PATH.join('/'), lba:opened.record.extent, size:opened.record.size, sha256Before:sha(opened.file), sha256After:sha(modified)},
    epicAiSignature:{regions:T.REGIONS.map(([s, e]) => `${hex(s)}-${hex(e)}`), sha256:T.SIGNATURE},
    behaviour:{aggressive:`D_us_801CF3E0 (${hex(T.AGGRESSIVE)}) set after the 50% talk`, hp:'Richter HP * 4 < max HP (live)', crashes:`forced subweapon id in bitmask ${hex(T.CRASHES)}: Cross 4, Bible 5, Agunea 9`, crashSteps:'BO6 steps 0x13-0x1C (Cross stands in the air, Bible and Agunea use 0x1C)', frames:T.FRAMES, sfx:hex(T.SFX), input:'padSim = Down while the AI is held in think step 0'},
    edits:T.edits().map(e => ({address:hex(T.BASE + e.off), fileOffset:hex(e.off), bytes:e.expect.length,
      original:e.original.toString('hex').toUpperCase(), patched:e.expect.toString('hex').toUpperCase()})),
    findings:'EntityRichter calls RichterThinking once per frame (0x801B6B90, vanilla jal); the Epic AI enters there and jumps to the clock finisher wrapper. The hook now calls a wrapper that runs the AI first. When the AI forces Cross, Bible or Agunea into RicCheckSubweapon (g_RicAi.force, 0x801B6992) while Richter is in a crash step, the aggressive flag is set and his HP is below 25%, a latch is set. When he is next standing, walking or crouching on the ground in think step 0 or 1 without the finisher, he plays 0x83A (BO6 RicStepHit crouching hit grunt) and holds Down for 60 frames while the AI is reset to think step 0 each frame, so it cannot choose an attack. A hit, death, cutscene, scripted think step, Alucard death or the finisher cancels the crouch. Axe (2), Rebound Stone (7), Dagger (1), Holy Water/Hydrostorm (3) and the Stopwatch finisher (6) are not included. State (timer u16, latch u8) is at 0x801CF39C. The two code areas 0x801CF278-0x801CF338 and 0x801CF354-0x801CF38C are zero in vanilla and in this BIN and are not referenced by any BO6 code or pointer.',
    inspected:['BO6 0x801B5A2C RichterThinking entry (j 0x801CE800) and its single caller 0x801B6B90', 'Epic AI g_RicAi 0x801B6980 (force +0x12) and RicCheckSubweapon 0x801BB3FC', 'finisher Think 0x801CE800, state F 0x801CF3A0, think step 0x801CF3C8/0x801CF3CC, aggressive flag 0x801CF3E0', 'Decide HP check (RIC hitPoints 0x80076316, g_Ric.unk6E 0x801D1686)', 'RicStepHit pain sounds 0x836-0x83B', 'RicDoCrash crash steps', 'references to 0x801CE000-0x801CF420 in vanilla and current BO6', 'sector 359 change from the phase-2 voice patch (outside BO6)'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/boss/bo6/richter.c', 'src/ric/pl_setstep.c (RicDoCrash)', 'src/ric/pl_steps.c (RicStepHit)', 'include/sfx.h', 'config/splat.us.bobo6.yaml', 'config/symbols.us.bobo6.txt']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'only the three edits change BO6', 'original source unchanged', 'instruction simulation (tests/richter-crash-recovery.test.js)'],
    gameplay:'Not yet played in an emulator. Boot fresh and load a memory-card save; old savestates keep the old overlay. Bring Richter past the 50% talk, then below 25% HP, and watch for Cross, Bible and Agunea crashes. He should grunt once and crouch for one second after each, then resume. Axe and Rebound Stone crashes should not cause it. Hit him during the crouch, and check the finisher below 15% HP.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Richter: crouch after item crashes\n\nIn his aggressive phase (after the 50% talk) and below 25% HP, Richter crouches for one second after each Cross, Bible or Agunea item crash, with his hurt grunt (0x83A). Then he continues fighting. Axe and Rebound Stone crashes, the dagger crash and the Stopwatch/Hydrostorm finisher are unchanged.\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-richter-crash-recovery-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
