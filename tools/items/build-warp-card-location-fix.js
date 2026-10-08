const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), M = require('../../stats-model.js');
const H = require('./warp-cards.js'), G = require('./warp-card-graphics.js'), {verify, loadFiles, verifyDestinations, arrival} = require('../../tests/warp-card-location.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Scorpion-and-noiL-Cards-Location-Fix-ASS-2.0.ppf', 'Reverse-Scorpion-and-noiL-Cards-Location-Fix-ASS-2.0.ppf'];
async function reopen(image) {
  const disc = await C.DiscImage.open(new Blob([image])), record = await disc.findPath(['DRA.BIN']);
  const bytes = await disc.readFile(record), m = M.parse({DRA: {bytes, base: H.BASE}});
  assert.equal(m.get(m.sections.hand[166].name), 'Scorpion Card');
  assert.equal(m.get(m.sections.hand[27].name), 'noiL Card');
  for (const id of [166, 27]) {
    assert.equal(m.get(m.sections.hand[id].consumable), 0); assert.equal(m.get(m.sections.hand[id].mp), 0);
    assert.equal(m.get(m.sections.hand[id].category), 10);
  }
  assert.equal(require('../../stats-core.js').u32(bytes, H.HOOK), H.jump(H.BASE + H.ACTIVATE, true));
  assert.equal(require('../../stats-core.js').u32(bytes, G.HOOK), H.jump(G.BASE + G.CAVE, true));
  assert.equal(require('../../stats-core.js').u16(bytes, H.SCORPION_RECORD + 8), H.WRP_STAGE);
  assert.equal(require('../../stats-core.js').u16(bytes, H.NOIL_RECORD + 8), H.RWRP_STAGE);
  verifyDestinations(bytes, await loadFiles(disc));
  return bytes;
}
async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.join(directory, 'verification.json');
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    await reopen(image);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const sectors = [...new Set(A.parsePpf(forward).offsets.map(off => Math.floor(off / 2352)))].sort((a, b) => a - b);
    assert.deepEqual(sectors, report.sectors);
    for (const sector of sectors) {
      const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    assert.equal(sha(await fs.readFile(source)), report.source.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of sectors) {
        const start = sector * 2352, current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
      }
      for (const sector of sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        assert.equal((await handle.write(bytes, 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    await reopen(live);
    for (const sector of sectors) {
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
  const files = await loadFiles(disc);
  const previousDestinations = {Scorpion: arrival(dra, files, 166, 0, 2), noiL: arrival(dra, files, 27, 0, 34)};
  const after = await verify(dra, files), changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image); assert.deepEqual(await reopen(image), after);
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Scorpion + noiL Card correct warp area IDs');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Scorpion + noiL Card location fix');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < original.length; at += 2352) if (!starts.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  const edits = [];
  for (let n = 0; n < dra.length;) {
    if (dra[n] === after[n]) { n++; continue; }
    const start = n; while (n < dra.length && dra[n] !== after[n]) n++;
    edits.push({offset: `0x${start.toString(16).toUpperCase()}`, before: Buffer.from(dra.subarray(start, n)).toString('hex'), after: Buffer.from(after.subarray(start, n)).toString('hex')});
  }
  assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    behavior: {Scorpion: {item: 166, stage: 'WRP', stageId: H.WRP_STAGE, room: 2, map: [59, 17], spawn: [192, 132]},
      noiL: {item: 27, stage: 'RWRP', stageId: H.RWRP_STAGE, room: 0, map: [23, 51], spawn: [64, 132]},
      reusable: true, mp: 0, icon: 'existing Library Card', originCastleIndependent: true,
      arrival: 'Inside the statue room, away from the center platform; existing card effect and fade.',
      existingRoomReturnCardPreserved: true},
    cause: 'Destination records used TOP (11) and RTOP (43), not WRP (14) and RWRP (46); earlier tests supplied warp overlays without following the disc loader.',
    previousDestinations,
    inspected: ['DRA.BIN private destination records, native area and graphics disc selection, room layer loading and final map coordinates',
      'ST/TOP/TOP.BIN room 2', 'ST/RTOP/RTOP.BIN room 0', 'ST/WRP/WRP.BIN room 2', 'ST/RWRP/RWRP.BIN room 0', 'matching graphics disc records'],
    reserved: {dra: ['0x2EF00-0x2F01F', '0x2F0B0-0x2F0E3'], icons: '311-313 and 315', pendingDestination: '0x2F010',
      destinationIndices: [H.SCORPION_INDEX, H.NOIL_INDEX], note: 'Do not assign equipment icons 311-313 or 315, or overwrite these helpers.'},
    edits,
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/dra/cd.c', 'src/dra/lba_stage.c', 'src/dra/4CE2C.c', 'src/dra/game_handlers.c', 'src/dra/5087C.c', 'include/game.h']},
    verified: ['TOP and RTOP disc requests reproduced on current bytes', '36 arrivals across both hands and nine origins',
      'native program and artwork disc requests matched ISO records', 'actual loaded room layers and entity layouts', 'final map coordinates and room bounds',
      'only two DRA bytes change; all helpers and unrelated routes preserved', 'changed-byte and hook rejection', 'forward/reversal and both embedded undo hash round trips', 'damaged-byte rejection',
      'sector checksums', 'editor names/categories on export/reopen', 'unrelated bytes/sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Warp-card location correction

The previous records used Castle Keep area IDs 11 and 43. This pair changes only two DRA bytes: Scorpion Card's stage becomes 14 (WRP), and noiL Card's stage becomes 46 (RWRP). Room offsets remain 16 (Room 2) and 0 (Room 0). All existing helpers, artwork loading, names, item properties and later BIN edits are preserved.

Scorpion Card: WRP Room 2, map (59,17), local (192,132), layer 2, entity layout 3.
noiL Card: RWRP Room 0, map (23,51), local (64,132), layer 0, entity layout 1.

Source: ${source}
Size: ${original.length}
Before SHA-256: ${initial}
Expected after SHA-256: ${final}
Forward: ${names[0]}
Forward SHA-256: ${report.forward.sha256}
Reversal: ${names[1]}
Reversal SHA-256: ${report.reversal.sha256}
Decomp revision: ${report.decomp.revision}

See verification.json for exact edited bytes and full evidence. Tests reproduce TOP/RTOP requests using actual loading instructions, then check both hands from nine origins through program/artwork disc requests, the loaded room layers, entity layouts and final map coordinates. Both guarded PPFs and embedded undo data pass full-image round trips and repaired-sector checks. The original BIN is unchanged; no backup BIN is created.

Apply only after explicit approval: node tools/items/build-warp-card-location-fix.js "${directory}" --apply

Fresh-boot emulator acceptance remains unverified. Load a memory-card save; test both cards from each castle, repeated use, normal exits and warp cycling. Existing savestates retain earlier code.
`);
  console.log(JSON.stringify({source: report.source, result: report.result, forward: report.forward, reversal: report.reversal,
    sectors: report.sectors, records: report.records, application: report.application}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
