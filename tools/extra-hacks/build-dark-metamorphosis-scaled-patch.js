const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./dark-metamorphosis-scaled.js');
const {inspect, verify} = require('../../tests/dark-metamorphosis-scaled.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Dark-Metamorphosis-Scaled-Buff-ASS-2.0';
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
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
  const reportPath = path.resolve(directory, names[2]);
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
  const forward = ppf(changes, block, 'Dark Metamorphosis buff scales with base stats');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Restore fixed +25 Dark Metamorphosis buff');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await inspect(image);
  for (const [file, bytes] of reopened.files) assert.deepEqual(bytes, after.get(file) || files.get(file), file);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < image.length; at += 2352) if (!changed.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: {files: ['DRA.BIN'], ranges: validation.ranges,
      formula: {ATK: 'statsBase[STR] / 2 (added to every non-zero CalcAttack result, cap 999)', DEF: 'statsBase[CON] / 2 (after CalcDefense, cap 999)', INT: 'statsBase[INT] / 2 (shown and effective)', LCK: 'statsBase[LCK] / 2 (shown and effective)', CON: '+2 (before attack/defense are calculated)', STR: 'no bonus'},
      previous: 'ATK +25, INT +25, DEF +25 (cap 999); STR +0, CON +3, LCK +0',
      rounding: 'Halves round down (base 7 gives +3).',
      ownership: 'Only the installed Dark Metamorphosis stat buff code bodies change; entry points 0x800E282C, 0x800E2864 and 0x800E2E98 and all nine hook words stay as installed. Unused tail words become nop.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'), files: ['include/game.h (PlayerStatus)', 'src/dra/menu.c (make_all, UpdateEquipStatBonuses)', 'src/dra/6E42C.c (PerformDarkMetamorphosis)', 'config/symbols.us.txt (SquareRoot0)'], localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['installed +25 buff bytes and hook words guarded', 'live make_all executed (real UpdateEquipStatBonuses and CalcDefense) reproduces +25 ATK/INT/DEF and CON +3', 'patched make_all: INT/LCK +base/2 in equip and total, CON +2, STR unchanged, ATK +base STR/2, DEF +base CON/2 after CON-boosted CalcDefense', 'timer 0 or negative matches the live BIN exactly', 'repeated refreshes do not stack', 'zero attack stays zero; ATK and DEF cap at 999', 'only the three code bodies change', 'no jumps or pointers into the bodies other than the existing entry points', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. DRA loads at boot, so old savestates keep the old code; the bonus is recalculated when Dark Metamorphosis starts or ends.',
    editorRecognition: 'The Extra Hacks catalog still describes the +25 version; refresh it in a separate BIN-updated step.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Dark Metamorphosis: stat-scaled buff\n\nThe original BIN is unchanged. While Dark Metamorphosis is active:\n\n- ATK +base STR / 2 (cap 999)\n- DEF +base CON / 2 (cap 999)\n- INT +base INT / 2\n- LCK +base LCK / 2\n- CON +2\n- STR no bonus\n\nHalves round down. Previously: ATK/INT/DEF +25, CON +3. Only the installed Dark Metamorphosis stat buff code in DRA changes; its entry points and hooks stay the same.\n\nSource: ${source}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${report.forward.path}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${report.reversal.path}\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp revision: ${report.decomp.revision}\nEditor revision: ${report.editor.revision}\nSee ${names[2]} for ranges, sectors and checks.\n\nBoth PPFs carry undo data; the application tool guards the full-image hash and changed bytes. No backup BIN is created or deleted.\n\nAfter explicit approval: node tools/extra-hacks/build-dark-metamorphosis-scaled-patch.js "${path.resolve(directory)}" --apply\n\nBoot afresh with a memory-card save; old savestates keep the loaded code. Extra Hacks recognition/release refresh remains a separate BIN-updated step.\n`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
