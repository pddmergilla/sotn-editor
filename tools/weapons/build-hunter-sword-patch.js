const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), H = require('./hunter-sword.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Hunter-Sword-Boomerang-ASS-2.0.ppf', 'Reverse-Hunter-Sword-Boomerang-ASS-2.0.ppf'];

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
  assert.equal(model.get(model.sections.hand[H.HUNTER].specialMove), H.SPECIAL);
  assert.deepEqual(M.rowUsers(model, H.SPECIAL), [H.HUNTER]);
  assert.equal(model.get(model.sections.hand[H.SHOTEL].specialMove), 176);
  for (let hand = 0; hand < 2; hand++) {
    const file = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    assert.equal(require('../../stats-core.js').u32(file, H.CODE + 4), (hand ? 0x8017D000 : 0x8017A000) + H.ENTRY);
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
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Hunter Sword private boomerang special - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), original.subarray(0x9320, 0x9720), 'Reverse Hunter Sword boomerang - ASS 2.0');
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
    edits: {hunter: 94, privateSpecial: 169, originalShotelSpecial: 176, initialSpecial: {damage: 230, mp: 5, element: 64, cooldown: 30},
      draOffsets: ['0x5E34 (Hunter special pointer)', '0x6D58-0x6D8B (private row)'],
      weaponOffsets: ['0x4004 (throw entry)', '0x5800-0x5D23 (throw code and separate sprite bank)'],
      behavior: 'Original normal slash; Shotel boomerang movement using the sword artwork; one throw per hand.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/weapon/w_000.c', 'src/weapon/w_034.c', 'src/weapon/shared.h', 'src/dra/6E42C.c', 'src/dra/cd.c']},
    verified: ['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums',
      'unrelated sectors unchanged', 'editor private-row recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay remains unverified; test both hands, facing directions, crouching, rethrow and insufficient MP.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Hunter Sword boomerang\n\nHunter Sword keeps its original slash, stats and artwork. On the ground, ↓↘→ + attack throws a rotating sword with Shotel's outbound and return movement. Each hand allows one throw. The new special uses private row 169; Shotel keeps row 176 unchanged.\n\nEdit Hunter sword under Stats Editor → Hand items → Special: ↓↘→ + attack, or edit row 169 under Weapon specials. Initial values copy the current Shotel special: 230 damage, 5 MP, Cut, 30-frame hit cooldown. Normal slashes remain usable while the sword is flying.\n\nSource: ${source}\n\nBefore SHA-256: ${initialHash}\n\nExpected after SHA-256: ${finalHash}\n\nForward: ${names[0]} (${report.forward.sha256})\n\nReversal: ${names[1]} (${report.reversal.sha256})\n\nThe source BIN has not been changed. No backup BIN is created. Both patches contain block checks and undo data; the application tool additionally checks the full-image hash and every changed byte. Ordinary PPF tools may not enforce those guards. See verification.json for offsets, hashes, source revision and verification.\n\nFresh-boot the patched image and load a memory-card save to check normal slash, both hands, both facing directions, grounded/crouched throws, return/catch, rethrow, insufficient MP, editing special stats, and unchanged Shotel. An old savestate retains old code. Gameplay remains unverified.\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) {
  if (!directory) throw Error('Supply an output directory.');
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
module.exports = {ppf, apply};
