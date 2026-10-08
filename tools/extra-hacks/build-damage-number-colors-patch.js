const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./damage-number-colors.js');
const {inspect, verify} = require('../../tests/damage-number-colors.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
function checksums(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
}

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.resolve(directory, 'verification.json');
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'Source changed; rebuild the patch pair.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    checksums(image, report.sectors);
    const before = await inspect(original), expected = H.prepare(before.files), reopened = await inspect(image);
    verify(before.files, expected);
    for (const [file, bytes] of expected) assert.deepEqual(reopened.files.get(file), bytes);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    assert.equal(sha(await fs.readFile(source)), report.source.sha256);
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
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, files, records} = await inspect(original), after = H.prepare(files), validation = verify(files, after);
  const changes = [];
  for (const [file, bytes] of after) changes.push(...await C.changedSectors(disc, records.get(file), files.get(file), bytes));
  const sectors = changes.map(c => c.start / 2352).sort((a, b) => a - b);
  assert.equal(new Set(sectors).size, sectors.length);
  const image = Buffer.from(original); changes.forEach(c => image.set(c.modified, c.start)); checksums(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Grey resistance and bright red weakness numbers');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse damage and healing affinity colors');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await inspect(image);
  for (const [file, bytes] of after) assert.deepEqual(reopened.files.get(file), bytes);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < image.length; at += 2352) if (!changed.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, 'Damage-Number-Colors-ASS-2.0.ppf'), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, 'Reverse-Damage-Number-Colors-ASS-2.0.ppf'), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: {files: [...after.keys()], ranges: ['DRA 0x5F204-0x5F207', 'DRA 0x2EAC0-0x2EB0B', 'DRA 0x2EB28-0x2EB77', 'F_GAME 0x411A2-0x411DF'],
      behavior: 'Weakness bright red; resistance grey; works for ordinary, critical and absorbed/healing enemy numbers. Weakness takes priority when both apply. Neutral damage, neutral healing and GUARD keep their original colors. Numeric damage/healing and the existing 2.5x weakness code are unchanged.',
      safeSpace: 'Unused equipment icon 304; all current item icons are lower. The space is zeroed and has no direct calls, pointers or nearby address loads from DRA or the 57 stage overlays. Reserve icon 304.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'), files: ['src/dra/5D5BC.c', 'src/st/collision.h', 'src/st/entity_damage_display.h'], localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['damage/healing amounts unchanged', 'ordinary, critical, absorption and immunity', 'color flags refreshed and copied into each entity', 'all 57 overlay hooks', 'red/grey palette channels and transparency', 'reserved space and references', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator visuals remain unverified; load a memory-card save and test weak/resisted damage and healing, neutral hits and GUARD.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Damage-number affinity colors\n\nThe original BIN is unchanged. Weakness uses bright red; resistance uses grey for ordinary, critical and absorbed/healing enemy numbers. Neutral and GUARD colors stay as loaded. Damage/healing calculations stay unchanged. Weakness takes priority when both weakness and resistance apply.\n\nSource: ${source}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${report.forward.path}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${report.reversal.path}\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp revision: ${report.decomp.revision}\nEditor revision: ${report.editor.revision}\nInspected: DRA damage calculation and color helpers, F_GAME palettes and all 57 overlay hooks; unused icon 304 is reserved. See verification.json for ranges, sectors and checks.\n\nBoth PPFs carry undo data; the application tool guards the full-image hash and changed bytes. No backup BIN is created or deleted.\n\nAfter explicit approval: node tools/extra-hacks/build-damage-number-colors-patch.js "${path.resolve(directory)}" --apply\n\nFresh-boot with a memory-card save and verify visuals; gameplay is unverified. Extra Hacks recognition/release refresh remains a separate BIN-updated step.\n`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
