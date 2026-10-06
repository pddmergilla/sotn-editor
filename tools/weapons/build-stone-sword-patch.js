const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), H = require('./stone-sword.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Stone-Sword-Medusa-Special-ASS-2.0.ppf', 'Reverse-Stone-Sword-Medusa-Special-ASS-2.0.ppf'];

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
    assert.deepEqual(image.subarray(offset, offset + size),
      Buffer.from(p.bytes.subarray(at + (undo ? 0 : size), at + (undo ? size : size * 2))), `Guarded bytes at ${offset.toString(16)}`);
  });
  p.offsets.forEach((offset, i) => {
    const size = p.lengths[i], at = p.data[i];
    image.set(p.bytes.subarray(at + (undo ? size : 0), at + (undo ? size * 2 : size)), offset);
  });
}

async function check(image) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  assert.equal(model.get(model.sections.hand[H.STONE].specialMove), H.SPECIAL);
  assert.deepEqual(M.rowUsers(model, H.SPECIAL), [H.STONE]);
  assert.equal(model.get(model.sections.hand[13].weaponId), H.MEDUSA);
  assert.equal(model.get(model.sections.hand[H.STONE].weaponId), H.MEDUSA);
  for (let hand = 0; hand < 2; hand++) {
    const file = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    assert.equal(require('../../stats-core.js').u32(file, H.MEDUSA * H.SLOT + H.CODE), (hand ? 0x8017D000 : 0x8017A000) + H.ENTRY);
  }
  return {disc, model};
}

async function main() {
  if (applying) {
    const reportPath = path.join(directory, 'verification.json'), report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    apply(image, forward); assert.equal(sha(image), report.result.sha256);
    await check(image);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
        assert.equal((await handle.write(bytes, 0, bytes.length, start)).bytesWritten, bytes.length);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    await check(live);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application, null, 2)); return;
  }
  const original = await fs.readFile(source), initialHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(record => disc.readFile(record)));
  const prepared = H.prepare(model, weapons);
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, prepared.dra);
  for (let hand = 0; hand < 2; hand++) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
  changes.sort((a, b) => a.start - b.start);
  assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) {
    assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);
  }
  const finalHash = sha(work); await check(work);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Stone Sword actual Medusa Shield special - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), original.subarray(0x9320, 0x9720), 'Reverse Stone Sword Medusa spell - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), initialHash);
  apply(work, forward); assert.equal(sha(work), finalHash);
  apply(work, forward, true); assert.equal(sha(work), initialHash);
  apply(work, reverse, true); assert.equal(sha(work), finalHash);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!changed.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1;
  assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), initialHash, 'The source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: initialHash}, result: {sha256: finalHash},
    forward: {path: path.resolve(directory, names[0]), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, names[1]), sha256: sha(reverse), size: reverse.length},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    edits: {stone: 114, sharedSpecial: 211, shield: 13,
      initialSpecial: {damage: model.get(model.sections.equipRows[211].attack), mp: model.get(model.sections.equipRows[211].mp), element: model.get(model.sections.equipRows[211].element)},
      draOffsets: ['0x623B (Stone Sword overlay)', '0x6244 (Stone Sword QCF special)'],
      weaponOffsets: ['overlay 27: artwork x128-247/y80-119', 'overlay 27: normal entry', 'overlay 27: palette loop 0xE00', 'overlay 27: padding 0x26F0-0x2FBF'],
      behavior: 'Original Stone Sword slash; QCF uses the actual Medusa Shield spell and shared row 211.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/weapon/w_027.c', 'src/weapon/w_037.c', 'src/weapon/shared.h', 'src/dra/6E42C.c', 'src/dra/7879C.c', 'src/dra/47BB8.c']},
    verified: ['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums',
      'unrelated sectors unchanged', 'editor shared-special recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay remains unverified; test both hands, facing directions, slashes, spell beams, repeated casting, MP and the original shield combo.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Stone Sword Medusa special

Stone Sword keeps its normal slash, stats and sword artwork. On the ground, ↓↘→ + attack casts the actual Medusa Shield spell, including its shield animation and beams, without requiring a shield or Shield Rod. It shares row 211 with Medusa Shield: initially 170 damage and 70 MP on this exact image. Later edits to that row affect both. One active spell per hand follows the shared row's chain limit.

The Stone Sword loads overlay 27. Its normal attack selects a relocated copy of the original sword slash only for item 114. The original Medusa spell and its child routines stay unchanged. Sword artwork uses unused texture space, a separate sprite bank, and palette 20. Medusa Shield keeps its existing normal attack and combo. Short Sword and Jewel Sword retain overlay 37.

Source BIN: ${source}

Before SHA-256: ${initialHash}

Expected after SHA-256: ${finalHash}

Forward: ${names[0]} (${report.forward.sha256})

Reversal: ${names[1]} (${report.reversal.sha256})

Source checkout: Xeeynamo/sotn-decomp at ${report.decomp.revision}. Editor checkout at preparation: 77937fb634edf81dc643f00a3aba23ee09671a61. See verification.json for sectors, hashes, byte ranges and checks.

The source BIN has not been changed. No backup BIN is created. Both patches contain undo bytes and block checks. The guarded application tool checks the full-image hash and every changed byte; ordinary PPF tools may not enforce these checks.

Prepare: node tools/weapons/build-stone-sword-patch.js <output-directory>
Apply after explicit approval: repeat with --apply.

Fresh-boot the patched image and load a memory-card save. Check normal slash standing, crouching and airborne; both hands and facing directions; QCF shield animation, beams, damage and MP; insufficient MP, active-spell limits and repeated casts; opening menus, switching gear and room transitions; the original Medusa Shield + Shield Rod/Mablung combo; Short Sword and Jewel Sword. Old savestates retain old overlays. Gameplay remains unverified.
`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) {
  if (!directory) throw Error('Supply an output directory.');
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
module.exports = {ppf, apply};
