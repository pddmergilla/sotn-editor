const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./richter-sparkle-slot.js'), W = require('./richter-stopwatch-crash.js');
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
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Richter crash sparkle keeps Shaft orb - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Richter crash sparkle orb fix - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  for (let at = 0; at < modified.length; at++) if (!T.edits().some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(modified[at], opened.file[at]);
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const name = 'Richter-Sparkle-Orb-Fix-ASS-2.0', hex = v => '0x' + v.toString(16).toUpperCase();
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, `${name}.ppf`), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, `Reverse-${name}.ppf`), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    file:{path:T.PATH.join('/'), lba:opened.record.extent, size:opened.record.size, sha256Before:sha(opened.file), sha256After:sha(modified)},
    finisherSignature:{regions:W.REGIONS.map(([s, e]) => `${hex(s)}-${hex(e)}`), sha256:W.SIGNATURE},
    behaviour:{blueprint:'0x36 (Stopwatch crash sparkle)', kind:{before:T.OLD_KIND, after:T.KIND}, effect:'the lightning sparkle takes a free slot in 0x60-0x7F instead of fixed slot 0x70, where the Shaft orb lives'},
    edits:T.edits().map(e => ({name:e.name, address:hex(T.BASE + e.off), fileOffset:hex(e.off), bytes:e.expect.length,
      original:e.original.toString('hex').toUpperCase(), patched:e.expect.toString('hex').toUpperCase()})),
    findings:'BO6 RicEntityFactory searches a slot range for most factory kinds (table 0x80181868), but kind 4 always uses g_Entities[0x5F] and kind 5 always uses g_Entities[0x70]. The Shaft orb (entity 0x40, blueprint 0x48, kind 5) lives in slot 0x70. The Stopwatch crash sparkle blueprint copied blueprint 0x48 and so destroyed the orb with the first lightning. After any finisher, lethal damage still sat Richter down (step 0x70) through the Richter-saved hack, but no orb remained to create Shaft and the rescue cutscene, so the game was stuck. Kind 1 searches free slots 0x60-0x7F, the range of the crash clocks.',
    inspected:['RicEntityFactory 0x801BBE64 kind handling and range table 0x80181868', 'RicGetFreeEntity 0x801BB21C', 'blueprints 0x36, 0x3F, 0x48, 0x49, 0x4B', 'Shaft orb func_us_801C03E8 (death steps 20-21) and the Richter-saved hack at 0x801B53DC/0x801C0420', 'EntityShaft and the rescue cutscene actors', 'Richter entity loop func_us_801BBBD0 off-screen cleanup (the orb has FLAG_UNK_10000000)'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/boss/bo6/us_3E79C.c', 'src/boss/bo6/us_39144.c', 'src/boss/bo6/richter.c', 'src/boss/bo6/e_cutscene_actors.c', 'src/ric/pl_blueprints.c']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'only one byte changes', 'original source unchanged', 'real BO6 factory: kind 5 replaces the orb, kind 1 keeps it (tests/richter-stopwatch-crash.test.js)'],
    gameplay:'Not yet played in an emulator. Boot fresh and load a memory-card save; old savestates keep the old overlay and an already-deleted orb. Let the finisher run, then defeat Richter: Shaft and the rescue cutscene should follow.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Richter: Stopwatch crash lightning no longer deletes the Shaft orb\n\nThe finisher's lightning used the Shaft orb's fixed entity slot, so after the finisher the orb was gone and defeating Richter left him sitting with no rescue cutscene. The lightning now uses a free slot, and the orb survives.\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal restores the exact source hash.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for the exact edits, inspected areas and checks.\n\nPrepare: node tools/bosses/build-richter-sparkle-slot-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
