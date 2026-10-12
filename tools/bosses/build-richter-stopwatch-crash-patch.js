const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./richter-stopwatch-crash.js');
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
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Richter real Stopwatch crash - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Richter real Stopwatch crash - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  for (let at = 0; at < modified.length; at++) if (!T.edits(opened.file).some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(modified[at], opened.file[at]);
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const name = 'Richter-Stopwatch-Crash-ASS-2.0', hex = v => '0x' + v.toString(16).toUpperCase();
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, `${name}.ppf`), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, `Reverse-${name}.ppf`), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    file:{path:T.PATH.join('/'), lba:opened.record.extent, size:opened.record.size, sha256Before:sha(opened.file), sha256After:sha(modified)},
    finisherSignature:{regions:T.REGIONS.map(([s, e]) => `${hex(s)}-${hex(e)}`), sha256:T.SIGNATURE},
    build:{compiler:T.BUILD.compiler, flags:T.BUILD.flags, linker:'tools/bosses/richter-stopwatch-crash/link.ld', sources:T.BUILD.sources, sha256:T.BUILD.sha256, size:T.BUILD.size, entries:T.BUILD.entries},
    behaviour:{controller:'entity 0x39: four BP 0x3F stopwatch factories with crash index 1-4, 17 frames apart (player RicEntityCrashStopwatch)', clocks:'entity 0x37: crash clocks follow the previous clock 16 pixels behind and 16 up, each spawns the native crash wave (BP 0x42); only the last clock ends the time stop and releases Alucard', lightning:'each crash clock skips the shrink and spawns the player Stopwatch crash sparkle and lightning (entity 0x2E via BP 0x36); the lightning has no hitbox', removed:'the old four-clock primitive copy at 0x801CF0A0-0x801CF278 (now zero)'},
    edits:T.edits(opened.file).map(e => ({name:e.name, address:hex(T.BASE + e.off), fileOffset:hex(e.off), bytes:e.expect.length,
      original:e.original.toString('hex').toUpperCase(), patched:e.expect.toString('hex').toUpperCase()})),
    findings:'BO6 entity 0x39 (func_us_801CA340) only created one stopwatch (FACTORY(0x3F, 1)), and BO6 EntityStopWatch (0x801CB664) has no crash chain and always ends with the shrink; player Richter entity 0x40 (the crash sparkle and lightning) is the Shaft orb in BO6. The new code (Zig 0.13.0 from tools/bosses/richter-stopwatch-crash/*.c, 4468 bytes) replaces boss Richter code that can never run: the thrown Agunea (entity 0x2C), its enemy hit (0x2D), the Vibhuti crash cloud (0x2F) and the Vibhuti crash (0x2E), 0x801C7408-0x801C8590. Neither the AI nor the stock subweapon choice selects Agunea for a throw or Vibhuti for a crash. These bytes are vanilla in this BIN, nothing calls or branches into them, and the only pointers are their entity slots and the thrown Agunea jump table. Their slots now destroy any such entity. Clock chain state is in unreferenced BSS 0x801CF3B4-0x801CF3C4. The code uses $gp as a scratch register; no SotN code (main executable, DRA, RIC, BO6) uses $gp. Caution, not caused by this patch: BO6 RicStepDead stores a 32x80 VRAM image into 0x801CF3E8-0x801D07E8, which overlaps the earlier finisher code at 0x801CF400-0x801CFE90.',
    inspected:['player sotn-decomp src/ric/319C4.c: RicEntityCrashStopwatch, RicEntitySubwpnStopwatch, RicEntityCrashStopwatchDoneSparkle, RicEntityStopwatchCrashLightning', 'BO6 entity table 0x8018158C (0x45 entries) and blueprints 0x801816A0', 'BO6 EntityStopWatch 0x801CB664 follow, countdown and ending code', 'BO6 0x801CA340 crash stub', 'RIC.BIN entity table 0x8015495C and sparkle 0x8016F6F0', 'references to 0x801C7408-0x801C8590 and BSS 0x801CF3C8-0x801D16E8 in vanilla and current BO6', 'StoreImage use of 0x801CF3E8 in BO6 RicStepDead', '$gp use in SLUS_000.67, DRA.BIN, RIC.BIN and BO6.BIN'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/ric/319C4.c', 'src/ric/pl_blueprints.c', 'src/ric/ric_shared.h', 'src/ric/pl_steps.c', 'src/boss/bo6/us_3E79C.c', 'config/splat.us.bobo6.yaml', 'config/symbols.us.bobo6.txt']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'only the six edits change BO6', 'original source unchanged', 'sparkle frame-by-frame equal to the RIC.BIN original', 'controller timing', 'clock chain, time stop, waves and lightning on the native BO6 clock', 'finisher marking, 5-second countdowns and release after the fourth clock (tests/richter-stopwatch-crash.test.js)', 'no load-delay, hi/lo or MIPS II instructions'],
    gameplay:'Not yet played in an emulator. Boot fresh and load a memory-card save; old savestates keep the old overlay. Bring Richter below 15% HP: four clocks should appear one after another behind him, each with its wave, then each ends with a lightning bolt before Alucard is released and Hydrostorm starts.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Richter: the real Stopwatch crash\n\nRichter's finisher now uses player Richter's Stopwatch item crash: four clocks appear 17 frames apart and trail behind him, each with its own wave, and each clock ends with the crash sparkle and lightning bolt. Alucard stays held until the fourth clock ends, then Hydrostorm follows as before. The old four-clock drawing copy is removed.\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-richter-stopwatch-crash-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
