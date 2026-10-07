const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), M = require('../../stats-model.js'), A = require('../../ass2-core.js');
const H = require('./elemental-weapons.js'), T = require('./kidlat-thunder.js');
const {ppf, apply} = require('./build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
async function inspect(image, installed) {
  const disc = await C.DiscImage.open(new Blob([image])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const item = model.sections.hand[86], row = model.sections.equipRows[T.ROW];
  assert.equal(model.get(item.name).trim(), 'Kidlat'); assert.equal(model.get(item.weaponId), T.OVERLAY);
  assert.equal(model.get(item.unk17), T.ROW); assert.equal(model.get(row.unk14), 1); assert.equal(model.get(row.unk11), 1);
  assert.deepEqual(M.rowUsers(model, T.ROW), [86]);
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(record => disc.readFile(record)));
  if (installed) weapons.forEach((w, hand) => T.verify(w.subarray(T.OVERLAY * H.SLOT + H.CODE, (T.OVERLAY + 1) * H.SLOT), hand));
  return {disc, model, records, weapons};
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
  const modified = opened.weapons.map(T.weapon), changes = [];
  for (const hand of [0, 1]) changes.push(...await C.changedSectors(opened.disc, opened.records[hand], opened.weapons[hand], modified[hand]));
  changes.sort((a, b) => a.start - b.start);
  assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) {assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);}
  const after = sha(work), result = await inspect(work, true);
  assert.deepEqual(result.model.files.DRA.bytes, opened.model.files.DRA.bytes);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Kidlat instant slash: Thunderbrand thunder sound');
  const reverse = ppf(changes.map(c => ({...c, original:c.modified, modified:c.original})), original.subarray(0x9320, 0x9720), 'Reverse Kidlat thunder sound');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const report = {
    source:{path:source, size:original.length, sha256:before}, result:{sha256:after},
    forward:{path:path.resolve(directory, 'Kidlat-Thunder-Slash-ASS-2.0.ppf'), sha256:sha(forward), size:forward.length},
    reversal:{path:path.resolve(directory, 'Reverse-Kidlat-Thunder-Slash-ASS-2.0.ppf'), sha256:sha(reverse), size:reverse.length},
    sectors:changes.map(c => c.start / 2352), records:A.parsePpf(forward).offsets.length,
    findings:'Thunderbrand charge effect plays SFX_THUNDER_B (0x665). Kidlat skips that effect. The added call plays the same sound once at its slash pose, only for private row 200; existing swish, slash effects, names and all stats are preserved.',
    inspected:['DRA rows 86, 112, 178, 200', 'both hands overlay 48: slash gate 0x16B4-0x16E8', 'charge bypass 0x23C0', 'sound call 0x21B0-0x21C0', 'padding 0x2400-0x24CB'],
    decomp:{remote:'https://github.com/Xeeynamo/sotn-decomp.git', revision:revision(path.resolve(__dirname, '../../../sotn-decomp')), files:['src/weapon/w_048.c', 'include/sfx.h']},
    editor:{revision:revision(path.resolve(__dirname, '../..'))},
    verified:['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'DRA and editor stats unchanged', 'original source unchanged'],
    gameplay:'Sound playback remains unverified in an emulator; fresh-boot and load a memory-card save to test both hands, repeated slashes, normal attacks and original Thunderbrand special.',
    application:{applied:false}
  };
  await fs.mkdir(directory, {recursive:true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Kidlat thunder slash\n\n${report.findings}\n\nThe original BIN is unchanged. Both guarded PPFs contain undo bytes; no backup BIN is created. The reversal removes only this sound addition.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${before}\n\nExpected after SHA-256: ${after}\n\nForward: ${report.forward.path}\n\nForward SHA-256: ${report.forward.sha256}\n\nReversal: ${report.reversal.path}\n\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}. See verification.json for inspected areas and checks.\n\nPrepare: node tools/weapons/build-kidlat-thunder-patch.js <output-directory>\n\nAfter explicit approval, repeat with --apply. The application tool rejects a changed live image or changed patch.\n\n${report.gameplay}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {inspect};
