const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./richter-dagger-pause.js'), W = require('./richter-stopwatch-crash.js');
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
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Richter 1s stance before daggers - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Richter 1s stance before daggers - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  for (let at = 0; at < modified.length; at++) if (!T.edits().some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(modified[at], opened.file[at]);
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const name = 'Richter-Dagger-Pause-ASS-2.0', hex = v => '0x' + v.toString(16).toUpperCase();
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, `${name}.ppf`), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, `Reverse-${name}.ppf`), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    file:{path:T.PATH.join('/'), lba:opened.record.extent, size:opened.record.size, sha256Before:sha(opened.file), sha256After:sha(modified)},
    finisherSignature:{regions:W.REGIONS.map(([s, e]) => `${hex(s)}-${hex(e)}`), sha256:W.SIGNATURE, note:'stance immediate at 0x4ED58 masked'},
    behaviour:{stanceFrames:{before:T.OLD_FRAMES, after:T.FRAMES}, effect:'Richter holds the laughing Up stance for one second before the dagger crash, so the four clocks and their waves have finished spawning'},
    edits:T.edits().map(e => ({name:e.name, address:hex(T.BASE + e.off), fileOffset:hex(e.off), bytes:e.expect.length,
      original:e.original.toString('hex').toUpperCase(), patched:e.expect.toString('hex').toUpperCase()})),
    findings:'The finisher Think (compiled C in spec finisher.source) holds phase 4 until ++F.stance >= 30, compiled as sltiu at,v1,30 at 0x801CED58 (F.stance is 0x801CF3B0). Only that immediate changes, to 60. If the dagger crash cannot start (no free factory slot), phase 4 already retries every frame. The four clocks spawn over 51 frames and each wave lives about 31 frames, so with the old half-second stance the daggers could start while those effects still held entity slots.',
    inspected:['finisher Think phase 4 at 0x801CED40-0x801CED64', 'F state 0x801CF3A0-0x801CF3B4', 'clock and wave lifetimes (tests/richter-stopwatch-crash.test.js)'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/ric/pl_steps.c (RicStepThrowDaggers)', 'src/boss/bo6/richter.c']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'only one instruction changes', 'original source unchanged'],
    gameplay:'Not yet played in an emulator. Boot fresh and load a memory-card save. Below 15% HP, Richter should laugh in his Up stance for a full second, then the dagger crash should appear every time.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Richter: one-second stance before the dagger crash\n\nAfter the Stopwatch crash grabs Alucard, Richter now holds his laughing Up stance for one second (was half a second) before the dagger crash.\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-richter-dagger-pause-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
