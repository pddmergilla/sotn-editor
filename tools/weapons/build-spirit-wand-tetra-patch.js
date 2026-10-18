const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./spirit-wand-tetra.js'), K = require('../../stats-core.js');
const {ppf, apply} = require('./build-stone-sword-patch.js');
const {verify} = require('../../tests/spirit-wand-tetra.test.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const decomp = process.env.SOTN_DECOMP || 'C:/Users/omergilla/Documents/Codex/2026-10-02/so/work/sotn-decomp';
const directory = process.argv[2];
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const names = ['Spirit-Wand-Tetra-Spirit-ASS-2.0.ppf', 'Reverse-Spirit-Wand-Tetra-Spirit-ASS-2.0.ppf'];

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  if (process.argv.includes('--apply')) {
    const reportPath = path.join(directory, 'verification.json');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const parsed = A.parsePpf(forward), sectorSet = new Set(parsed.offsets.map(off => Math.floor(off / 2352)));
    assert.deepEqual([...sectorSet].sort((a, b) => a - b), report.sectors);
    for (const sector of report.sectors) {
      const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    const backup = source.replace(/\.bin$/i, ' - backup before Spirit-Wand-Tetra.bin');
    await fs.copyFile(source, backup, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(await fs.readFile(backup)), report.source.sha256, 'Backup verification failed.');
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        const current = Buffer.alloc(2352); assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
        assert.equal((await handle.write(bytes, 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    const disc = await C.DiscImage.open(new Blob([live]));
    assert.equal(K.u32(await disc.readFile(await disc.findPath(['DRA.BIN'])), H.HOOK), H.jump(H.BASE + H.CAVE, true));
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true, backup};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const record = await disc.findPath(['DRA.BIN']), dra = await disc.readFile(record);
  const after = await verify(dra);
  const changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Spirit Wand down-forward casts Tetra Spirit');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Spirit Wand Tetra Spirit command');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await C.DiscImage.open(new Blob([image]));
  assert.deepEqual(await reopened.readFile(await reopened.findPath(['DRA.BIN'])), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < original.length; at += 2352) if (!starts.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
  const end = H.CAVE + H.helper().length - 1, icon = off => Math.floor((off - 0x25324) / 128);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    edits: {file: 'DRA.BIN', hook: '0x718A8 (Tetra Spirit slot of CheckSpecialMoveInputs)',
      helper: `0x${H.CAVE.toString(16).toUpperCase()}-0x${end.toString(16).toUpperCase()}`,
      mp: dra[0x8470], spell: H.SPELL, item: H.WAND,
      behavior: 'Down then forward (or down, down-forward, forward) plus the Spirit Wand hand\'s attack, standing, walking or crouching; native Tetra Spirit casting, MP and learning; insufficient MP falls back to the ordinary attack.',
      safeSpace: `Blank equipment icon slots ${icon(H.CAVE)}-${icon(end)} (vanilla and ASS zero from 0x2ECD8 to 0x2F323); every equipment icon is below ${icon(H.CAVE)}; no DRA branch references the space. Alucard Sword Soul Steal helper (0x2EC00-0x2ECD7) is untouched.`},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision(decomp),
      files: ['src/dra/704D0.c', 'src/dra/6E42C.c', 'src/dra/5D5BC.c', 'src/dra/4AEA4.c', 'src/dra/dra.h', 'include/game.h', 'config/splat.us.dra.yaml']},
    editor: {revision: revision(path.join(__dirname, '../..')),
      files: ['tools/weapons/spirit-wand-tetra.js', 'tools/weapons/build-spirit-wand-tetra-patch.js', 'tests/spirit-wand-tetra.test.js']},
    verified: ['native QCF tracker run frame by frame', 'down-forward and full QCF motions', 'held down beyond the native 20-frame timeout',
      'both hands', 'both facing directions', 'stand/walk/crouch eligibility', 'back, up-forward, late and missing inputs rejected',
      'wrong weapon and wrong attack button', 'MP cost, edited cost and insufficient MP', 'airborne, spell and locked states rejected',
      'native QCF state unchanged without the wand', 'register and stack preservation', 'native routines match vanilla',
      'forward/reversal and embedded undo hashes', 'damaged-byte rejection', 'export/reopen', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Spirit Wand Tetra Spirit\n\nWith the Spirit Wand equipped, press down, then forward + that hand's attack to cast native Tetra Spirit. The full down, down-forward, forward motion also works. Forward follows the direction Alucard faced when down was pressed. Attack within about 20 frames of releasing down. It works standing, walking or crouching. It spends the spell's configured MP (currently ${report.edits.mp}) and learns Tetra Spirit like ordinary casting. With too little MP, or without the motion, the wand attacks normally. The native Tetra Spirit command is unchanged.\n\nThis special uses the native spell, not a weapon-special row. Edit its damage, element and MP under Stats Editor → Spells → Tetra Spirit; those edits also change the ordinary spell.\n\nThe helper is in unused equipment icon slots ${icon(H.CAVE)}-${icon(end)}. Don't assign those icons to equipment or replace the helper bytes. The Alucard Sword Soul Steal helper is next to it and isn't changed.\n\nSource: ${source}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${names[0]} (${report.forward.sha256})\nReversal: ${names[1]} (${report.reversal.sha256})\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}. Editor: ${report.editor.revision}.\n\nBoth patches include block checks and undo bytes. The builder also checks the full source hash and every changed byte. Ordinary PPF tools may not run those checks. Apply only after explicit approval: node tools/weapons/build-spirit-wand-tetra-patch.js "${directory}" --apply\n\nFresh-boot the patched image from a memory-card save, since an old savestate keeps the old code. Test both hands and facing directions, the down→forward and down, down-forward, forward motions, the cast from standing and crouching, normal wand attacks, insufficient MP, the native Tetra Spirit command, and gear and room changes. Gameplay hasn't been tested in an emulator.\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
