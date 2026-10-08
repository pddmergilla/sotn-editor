const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), M = require('../../stats-model.js');
const H = require('./warp-cards.js'), G = require('./warp-card-graphics.js'), {verify} = require('../../tests/warp-card-graphics.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Scorpion-and-noiL-Cards-Graphics-Fix-ASS-2.0.ppf', 'Reverse-Scorpion-and-noiL-Cards-Graphics-Fix-ASS-2.0.ppf'];
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
  const record = await disc.findPath(['DRA.BIN']), dra = await disc.readFile(record), warps = {};
  for (const name of ['WRP', 'RWRP']) warps[name] = await disc.readFile(await disc.findPath(['ST', name, `${name}.BIN`]));
  const after = await verify(dra, warps), changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image); assert.deepEqual(await reopen(image), after);
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Scorpion + noiL Card missing warp graphics fix');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Scorpion + noiL Card graphics fix');
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
    behavior: {Scorpion: {item: 166, stage: 'WRP', stageId: 11, room: 2, map: [59, 17], spawn: [192, 132]},
      noiL: {item: 27, stage: 'RWRP', stageId: 43, room: 0, map: [23, 51], spawn: [64, 132]},
      reusable: true, mp: 0, icon: 'existing Library Card', originCastleIndependent: true,
      arrival: 'Inside the statue room, away from the center platform; existing card effect and fade.',
      existingRoomReturnCardPreserved: true},
    inspected: ['DRA.BIN equipment rows 27/166, names/descriptions, card dispatch, native inventory reduction, stage transition, stage selection, position conversion, existing room-return helpers, unused icon space',
      'ST/WRP/WRP.BIN room 2', 'ST/RWRP/RWRP.BIN room 0'],
    reserved: {dra: '0x2F0B0-0x2F0E3', icons: '315', pendingDestination: '0x2F010',
      destinationIndices: [H.SCORPION_INDEX, H.NOIL_INDEX], note: 'Do not assign equipment icon 315 or overwrite this helper.'},
    edits,
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/dra/6E42C.c', 'src/dra/5087C.c', 'src/dra/7E4BC.c', 'src/dra/71830.c', 'src/dra/4AEA4.c', 'src/st/wrp/warp.c', 'src/st/rwrp/warp.c', 'include/game.h']},
    verified: ['both skipped graphics loads reproduced', 'native stage artwork loading requests', 'full card activation to room position', '70 existing graphics routes', 'loading wait preserves the previous request',
      'occupied-space and changed-hook rejection', 'forward/reversal and both embedded undo hash round trips', 'damaged-byte rejection',
      'sector checksums', 'editor names/categories on export/reopen', 'unrelated bytes/sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Scorpion Card and noiL Card graphics fix\n\nLibrary Card becomes Scorpion Card and returns to the normal Outer Wall scorpion warp room. Takemitsu becomes noiL Card and returns to the inverted Castle Keep reverse lion warp room. Both are reusable, cost zero MP, use the existing Library Card icon/effect, and work from either castle. They have no attack/defense bonus. Existing Takemitsu pickups and ownership become noiL Card; Library Card purchases and pickups become Scorpion Card. No new shop entries or pickups are added.\n\nUse an equipped card while standing, walking or crouching. Arrival is inside the statue room, away from the center platform. Scorpion lands at (192,132) in WRP room 2; noiL at (64,132) in RWRP room 0. The latter uses the game's normal coordinate mirroring. The separate existing room-return card stays intact. No castle-unlock restriction is added, so owning noiL Card permits reverse-castle travel.\n\nSource: ${source}\nSize: ${original.length}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${names[0]}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${names[1]}\nReversal SHA-256: ${report.reversal.sha256}\nDecomp revision: ${report.decomp.revision}\n\nSee verification.json for the exact edited bytes, sectors and checks. The source BIN is unchanged and no backup BIN was created. Both PPFs have block checks and undo bytes; this builder additionally checks the full image hash and every changed byte.\n\nThis correction adds the missing stage graphics request for both private destinations. The original room records already target WRP Room 2 and RWRP Room 0. Only the graphics dispatch and unused icon 315 space change; item data, destination records and earlier helpers are preserved. Do not assign equipment icon 315. Other installed helpers, original destination records, both warp overlays, shops and pickup placements are preserved.\n\nApply only after explicit approval: node tools/items/build-warp-card-graphics-fix.js "${directory}" --apply\n\nFresh-boot the patched BIN and load a memory-card save. Test both cards in both hands from each castle; confirm exact names/icons, statue rooms, landing/control, repeated use, unchanged inventory/MP, airborne rejection, ordinary exits/warp cycling and the existing room-return card. Gameplay and animation remain unverified; old savestates keep earlier code.\n`);
  console.log(JSON.stringify({source: report.source, result: report.result, forward: report.forward, reversal: report.reversal,
    sectors: report.sectors, records: report.records, application: report.application}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
