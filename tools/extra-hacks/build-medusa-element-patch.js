const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), K = require('../../stats-core.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
if (!directory) throw Error('Supply an output directory.');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Medusa-Table-Elements-ASS-2.0.ppf', 'Reverse-Medusa-Table-Elements-ASS-2.0.ppf'];

function ppf(changes, block, description) {
  const header = Buffer.alloc(60); header.write('PPF30'); header[5] = 2;
  header.fill(32, 6, 56); header.write(description.slice(0, 50), 6, 'ascii'); header[57] = header[58] = 1;
  const parts = [header, block];
  for (const {start, original, modified} of changes) for (let i = 0; i < modified.length;) {
    if (original[i] === modified[i]) { i++; continue; }
    const first = i;
    while (i < modified.length && original[i] !== modified[i] && i - first < 255) i++;
    const record = Buffer.alloc(9); record.writeBigUInt64LE(BigInt(start + first)); record[8] = i - first;
    parts.push(record, modified.slice(first, i), original.slice(first, i));
  }
  return Buffer.concat(parts);
}

function apply(image, patch, undo = false) {
  const p = A.parsePpf(patch);
  assert.deepEqual(image.subarray(0x9320, 0x9720), Buffer.from(p.blockCheck));
  p.offsets.forEach((offset, i) => {
    const size = p.lengths[i], at = p.data[i];
    const old = Buffer.from(p.bytes.subarray(at + (undo ? 0 : size), at + (undo ? size : size * 2)));
    assert.deepEqual(image.subarray(offset, offset + size), old, `Guarded bytes at ${offset.toString(16)}`);
  });
  p.offsets.forEach((offset, i) => {
    const size = p.lengths[i], at = p.data[i];
    image.set(p.bytes.subarray(at + (undo ? size : 0), at + (undo ? size * 2 : size)), offset);
  });
  return image;
}

(async () => {
  if (applying) {
    const reportPath = path.join(directory, 'verification.json');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source);
    assert.equal(sha(image), report.source.sha256, 'The source BIN changed since patch preparation.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    apply(image, forward); assert.equal(sha(image), report.result.sha256);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
        const {bytesWritten} = await handle.write(bytes, 0, bytes.length, start);
        assert.equal(bytesWritten, bytes.length);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source);
    assert.equal(sha(live), report.result.sha256);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    const disc = await C.DiscImage.open(new Blob([live]));
    const model = await M.loadFromDisc(disc, C.normalizeIsoName);
    const sword = model.sections.enemies.find(e => e.index === 366).attacks[0];
    assert.equal(model.field(sword.element).file, 'DRA'); assert.ok(!model.field(sword.element).readOnly);
    assert.equal(K.u32(model.files['BOSS/RBO3'].bytes, 0x207E0), 0);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256,
      verified: ['live hash', 'written instruction', 'sector checksums', 'editor table support', 'reversal restores original hash']};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application, null, 2));
    return;
  }
  const original = await fs.readFile(source), initialHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const medusa = model.sections.enemies.find(e => e.index === 366), sword = medusa.attacks[0];
  assert.equal(model.field(sword.element).kind, 'imm', 'Recognized Medusa override is required.');
  assert.equal(medusa.attacks[1].label, 'Dashing sword slash');
  const record = model.files['BOSS/RBO3'].record, before = model.files['BOSS/RBO3'].bytes;
  assert.equal(K.u32(before, 0x207E0), 0xA60A0042);
  const after = before.slice(); K.put32(after, 0x207E0, 0);
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) assert(i >= 0x207E0 && i < 0x207E4);
  const reread = M.parse({...model.files, 'BOSS/RBO3': {...model.files['BOSS/RBO3'], bytes: after}});
  const tableSword = reread.sections.enemies.find(e => e.index === 366).attacks[0];
  assert.equal(reread.field(tableSword.element).file, 'DRA'); assert.ok(!reread.field(tableSword.element).readOnly);
  assert.equal(reread.get(tableSword.element) & 0x100, 0, 'The live sword table must not contain Curse.');
  const changes = await C.changedSectors(disc, record, before, after); assert.equal(changes.length, 1);
  const work = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), disc.dataOffset), change.modified);
    work.set(change.modified, change.start);
  }
  const finalHash = sha(work), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Medusa sword uses table elements - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Medusa table elements - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), initialHash);
  apply(work, forward); assert.equal(sha(work), finalHash);
  apply(work, forward, true); assert.equal(sha(work), initialHash);
  apply(work, reverse, true); assert.equal(sha(work), finalHash);
  for (let at = 0; at < work.length; at += 2352) if (!changes.some(c => c.start === at)) {
    assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  }
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1;
  assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), initialHash);
  const report = {
    source: {path: source, size: original.length, sha256: initialHash}, result: {sha256: finalHash},
    forward: {path: path.resolve(directory, names[0]), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, names[1]), sha256: sha(reverse), size: reverse.length},
    overlay: {path: 'BOSS/RBO3/RBO3.BIN', extent: record.extent, size: record.size},
    edit: {offset: '0x207E0', before: '0xA60A0042', after: '0x00000000',
      purpose: 'Disable the forced sword element write; keep slash activation and attack behavior.'},
    table: {bodyElement: model.get(medusa.element), swordElement: reread.get(tableSword.element)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    verified: ['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums',
      'unrelated sectors unchanged', 'only the forced element write changed', 'editor table support', 'source unchanged during preparation'],
    gameplay: 'Fresh-boot Medusa combat remains unverified.',
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/boss/rbo3/rbo3.c', 'src/boss/rbo3/e_init.c', 'src/st/st_common.h']},
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Medusa table elements\n\nDisables the ASS sword routine's forced element write. Both normal and dashing sword slashes now retain enemy attack row #367's element. Body contact remains row #366. Slash activation, damage, movement, and other attacks are preserved. No backup BIN is created.\n\nSource BIN: ${source}\n\nBefore SHA-256: ${initialHash}\n\nAfter SHA-256: ${finalHash}\n\nForward patch: ${names[0]}\n\nReversal: ${names[1]}\n\nThe PPFs include block checks and undo bytes. The guarded application tool also requires the exact full-image hash; ordinary PPF patchers may not enforce every guard. See verification.json for patch hashes, offsets, sectors, source revision, checks, and application status.\n\nIn the editor, use Sword slash (#367) for both sword slashes and Contact damage (#366) for the body. Fresh-boot the resulting image and load a memory-card save before Medusa; an old savestate retains its existing enemy elements. Emulator combat remains unverified.\n`);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
