const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./alucard-soul-steal.js'), K = require('../../stats-core.js');
const {ppf, apply} = require('./build-stone-sword-patch.js');
const {verify} = require('../../tests/alucard-soul-steal.test.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const names = ['Alucard-Sword-Soul-Steal-ASS-2.0.ppf', 'Reverse-Alucard-Sword-Soul-Steal-ASS-2.0.ppf'];

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
    assert.equal(sha(await fs.readFile(source)), report.source.sha256);
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
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const record = await disc.findPath(['DRA.BIN']), dra = await disc.readFile(record);
  const after = await verify(dra);
  for (let off = 0x42398; off < 0x962A8; off += 4) {
    const target = K.branchTarget(K.u32(dra, off), H.BASE + off);
    assert.ok(!(target >= H.BASE + H.CAVE && target < H.BASE + H.CAVE + 512), 'Existing code references helper space.');
  }
  const changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Alucard Sword back-forward casts Soul Steal');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Alucard Sword Soul Steal command');
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
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    edits: {file: 'DRA.BIN', hook: '0x718B8', helper: `0x2EC00-0x${(H.CAVE + H.helper().length - 1).toString(16).toUpperCase()}`,
      mp: dra[0x84A8], spell: 5, item: 123, behavior: 'Back then forward plus the equipped sword attack, standing or walking; native Soul Steal casting and learning; normal and QCF attacks preserved.',
      safeSpace: 'Read-only blank equipment icon slots above index 304; all current equipment icons are at most 273. LoadEquipIcon only reads this area. No original DRA text branches reference the helper.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/dra/704D0.c', 'src/dra/5D5BC.c', 'src/dra/6E42C.c', 'src/dra/4AEA4.c', 'src/dra/d_24CEC.c', 'include/game.h']},
    verified: ['actual back-forward input both directions', 'both hands', 'stand/walk eligibility', 'wrong weapon and wrong attack', 'MP cost and insufficient MP',
      'combo timeout', 'native spell fallback', 'register and stack preservation', 'forward/reversal and embedded undo hashes', 'damaged-byte rejection',
      'export/reopen', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Alucard Sword Soul Steal\n\nBack then forward + the equipped Alucard Sword attack casts native Soul Steal while standing or walking. The command follows facing direction, reversing to right-left while facing left. It spends the spell's configured MP (currently ${report.edits.mp}) and learns Soul Steal as ordinary casting does. Insufficient MP falls back to ordinary attacks. Crouching, airborne and locked attacks retain native spell restrictions. Normal slash and the existing QCF special remain unchanged.\n\nThis command uses native Soul Steal rather than a weapon-special row, so edit its damage, element and MP under Stats Editor → Spells → Soul Steal. It will not appear as a separate weapon-special row in the editor.\n\nThe helper occupies unused icon padding. Do not assign icons 305 through 307 to equipment or replace the helper bytes. See verification.json for exact offsets, input/output hashes, PPF hashes and source revision. The original BIN is unchanged; no backup BIN was created.\n\nSource: ${source}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward SHA-256: ${report.forward.sha256}\nReversal SHA-256: ${report.reversal.sha256}\nDecomp revision: ${report.decomp.revision}\n\nBoth patches include block checks and undo bytes. This builder also enforces the full source hash and all changed-byte guards. Apply only after explicit approval: node tools/weapons/build-alucard-soul-steal-patch.js "${directory}" --apply\n\nFresh-boot the patched image from a memory-card save and test both hands and facing directions, normal slash, existing QCF special, the Soul Steal animation, damage and healing, repeated casting, insufficient MP and gear/room changes. Gameplay remains unverified; an old savestate retains the old code.\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
