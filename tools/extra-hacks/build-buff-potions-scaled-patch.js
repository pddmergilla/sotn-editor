const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./buff-potions-scaled.js');
const {inspect, verify} = require('../../tests/buff-potions-scaled.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Buff-Potions-Faerie-Scaled-ASS-2.0';
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
  const forward = ppf(changes, block, 'Potion/Faerie buffs scale with base stats');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Restore +20 potion/Faerie buffs');
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
      formula: {STR: 'buff: statsBase[STR] / 2', INT: 'buff: statsBase[INT] / 2 (equip and total; not multiplied x4)', LCK: 'buff: statsBase[LCK] / 2', ATK: 'buff: statsBase[STR] / 2 (non-zero attacks, cap 9999)', DEF: 'buff: statsBase[CON] / 2 (cap 999)',
        stacking: 'Each buff adds again on top of Dark Metamorphosis (ATK STR/2, DEF CON/2, INT INT/2, LCK LCK/2, CON +2).'},
      previous: 'Buffs: STR/LCK +20, INT +20 equip (+80 total via the vanilla x4), ATK +20, DEF +20. Dark Metamorphosis ATK capped at 999 although ASS CalcAttack caps at 9999.',
      fixes: ['Dark Metamorphosis INT/LCK/CON bonuses were lost whenever GetEquipProperties (every weapon swing) re-ran UpdateEquipStatBonuses; they are now applied at its end.', 'ATK bonus cap follows the 9999 CalcAttack cap instead of lowering attacks above 999.'],
      hooks: 'make_all is vanilla again; UpdateEquipStatBonuses and CalcDefense epilogues jump to the helpers; CalcAttack epilogue hook unchanged.',
      ownership: 'Code stays inside the Dark Metamorphosis hack ranges (0x4282C-0x428DF, 0x42E98-0x42F13) plus the five vanilla buff sites; refreshBonus 0x800E28E0 and the dead entry stub are unchanged.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'), files: ['include/game.h (PlayerStatus, SBT_*)', 'src/dra/menu.c (UpdateEquipStatBonuses, CalcAttack, CalcDefense, make_all)', 'src/dra/5D5BC.c (GetEquipProperties, GiveStatBuff)', 'src/dra/7E4BC.c (EntityPlayerPinkEffect)', 'src/servant/tt_002/faerie.c'], localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['installed scaled Dark Metamorphosis code, CalcAttack hook and vanilla buff sites guarded', 'real make_all, UpdateEquipStatBonuses, CalcAttack and CalcDefense executed for 3 weapon setups x 6 base-stat sets x all 64 Dark Metamorphosis/STR/INT/LCK/ATK/DEF combinations', 'no buffs and Dark Metamorphosis alone match the live BIN exactly', 'each buff adds statsBase/2 and stacks with Dark Metamorphosis', 'bonuses survive the UpdateEquipStatBonuses call made on every weapon swing (the live BIN loses them)', 'repeated refreshes do not stack', 'zero attack stays zero; ATK cap 9999, DEF cap 999', 'only the listed ranges change', 'no other code jumps into the rewritten ranges', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. DRA loads at boot, so old savestates keep the old code; buffs are recalculated on the same refreshes as the vanilla +20.',
    editorRecognition: 'The Extra Hacks catalog still describes the +25 version and the old make_all hooks; refresh it in a separate BIN-updated step.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Potion and Faerie buffs: stat-scaled, stacking with Dark Metamorphosis

The original BIN is unchanged. The five buffs the Faerie casts (the same timers as the STR/INT/LCK/Attack/Shield potions) now give:

- STR +base STR / 2
- INT +base INT / 2 (straight to INT, not through the x4 equipment multiplier)
- LCK +base LCK / 2
- ATK +base STR / 2 (cap 9999)
- DEF +base CON / 2 (cap 999)

Each adds on top of Dark Metamorphosis (ATK +STR/2, DEF +CON/2, INT +INT/2, LCK +LCK/2, CON +2). Halves round down.

Also fixed: Dark Metamorphosis INT/LCK/CON no longer drop after a weapon swing, and its ATK bonus no longer lowers attacks above 999.

Source: ${source}
Before SHA-256: ${initial}
Expected after SHA-256: ${final}
Forward: ${report.forward.path}
Forward SHA-256: ${report.forward.sha256}
Reversal: ${report.reversal.path}
Reversal SHA-256: ${report.reversal.sha256}

Decomp revision: ${report.decomp.revision}
Editor revision: ${report.editor.revision}
See ${names[2]} for ranges, sectors and checks.

Both PPFs carry undo data; the application tool guards the full-image hash and changed bytes. No backup BIN is created or deleted.

After explicit approval: node tools/extra-hacks/build-buff-potions-scaled-patch.js "${path.resolve(directory)}" --apply

Boot afresh with a memory-card save; old savestates keep the loaded code. Extra Hacks recognition/release refresh remains a separate BIN-updated step.
`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
