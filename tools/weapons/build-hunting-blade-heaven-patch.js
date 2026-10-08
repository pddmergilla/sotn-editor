const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), M = require('../../stats-model.js');
const H = require('./hunting-blade-heaven.js');
const {ppf, apply} = require('./build-hunter-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const names = ['Hunting-Blade-Heaven-Attack-ASS-2.0.ppf', 'Reverse-Hunting-Blade-Heaven-Attack-ASS-2.0.ppf'];
const revision = dir => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();

async function check(image, originalDra) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName), rows = model.sections.equipRows;
  assert.equal(model.get(rows[H.ITEM].weaponId), H.OVERLAY);
  assert.equal(model.get(rows[H.ITEM].wpal), 1);
  assert.equal(model.get(rows[H.ITEM].specialMove), H.SPECIAL);
  assert.equal(model.get(rows[H.SPECIAL].weaponId), H.OVERLAY);
  assert.equal(model.get(rows[H.SPECIAL].unk13), 50);
  assert.deepEqual(M.rowUsers(model, H.SPECIAL), [H.ITEM]);
  assert.ok(M.specialRows(model).some(r => r.index === H.SPECIAL));
  if (originalDra) for (let n = 0; n < originalDra.length; n++) if (model.files.DRA.bytes[n] !== originalDra[n])
    assert.ok([15, 16].some(off => n === model.tables.equip + H.ITEM * 52 + off) ||
      [15, 16, 19].some(off => n === model.tables.equip + H.SPECIAL * 52 + off));
  for (let hand = 0; hand < 2; hand++) {
    const b = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    assert.equal(require('../../stats-core.js').u32(b, H.OVERLAY * H.SLOT + H.CODE), (hand ? 0x8017D000 : 0x8017A000) + H.ENTRY);
  }
  return model;
}

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.join(directory, 'verification.json');
  if (applying) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const original = image.slice();
    apply(image, forward); assert.equal(sha(image), report.result.sha256);
    await check(image);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const wanted = new Set(report.sectors);
    for (let at = 0; at < image.length; at += 2352) if (!wanted.has(at / 2352))
      assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, b = image.subarray(start, start + 2352);
        assert.deepEqual(C.repairSector(b.slice(), 24), b);
        assert.equal((await handle.write(b, 0, b.length, start)).bytesWritten, b.length);
      }
      await handle.sync();
    } finally {await handle.close();}
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    await check(live);
    for (const sector of report.sectors) {
      const b = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(b.slice(), 24), b);
    }
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true, at: new Date().toISOString()};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initialHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const records = await Promise.all([0, 1].map(h => disc.findPath(['BIN', `WEAPON${h}.BIN`])));
  const weapons = await Promise.all(records.map(r => disc.readFile(r)));
  const prepared = H.prepare(model, weapons);
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, prepared.dra);
  for (let hand = 0; hand < 2; hand++) {
    for (let n = 0; n < weapons[hand].length; n++) if (prepared.weapons[hand][n] !== weapons[hand][n]) {
      const off = n - H.OVERLAY * H.SLOT;
      assert.ok(off >= 0 && off < H.SLOT, 'Only the Heaven Sword overlay may change.');
      if (off >= H.CODE) {
        const c = off - H.CODE;
        assert.ok(c < 4 || c >= 0x6AC && c < 0x6B0 || c >= 0x6B4 && c < 0x6B8 || c >= H.BANK && c < H.END);
      } else assert.ok(Math.floor(off / 128) < 96 && off % 128 >= 64 && off % 128 < 120);
    }
    changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
  }
  changes.sort((a, b) => a.start - b.start);
  assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) {assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);}
  const finalHash = sha(work);
  await check(work, model.files.DRA.bytes);
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Hunting Blade Heaven attack - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Hunting Blade Heaven attack - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), initialHash);
  apply(work, forward); assert.equal(sha(work), finalHash);
  apply(work, forward, true); assert.equal(sha(work), initialHash);
  apply(work, reverse, true); assert.equal(sha(work), finalHash);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!changed.has(at))
    assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1;
  assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), initialHash, 'Source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: initialHash}, result: {sha256: finalHash},
    forward: {path: path.resolve(directory, names[0]), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, names[1]), sha256: sha(reverse), size: reverse.length},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    edits: {item: H.ITEM, liveName: model.get(model.sections.hand[H.ITEM].name), special: H.SPECIAL, donor: H.HEAVEN,
      attack: model.get(model.sections.equipRows[H.SPECIAL].attack), mp: model.get(model.sections.equipRows[H.SPECIAL].mp),
      behavior: 'QCF special uses the native Heaven Sword single flying attack, return and afterimages; normal slash and private row 169 tuning are retained.',
      dra: 'Only row 94 weapon/palette and row 169 weapon/palette/factory change; damage, MP, element, cooldown and all other row bytes are preserved.',
      weapons: 'Overlay 13 only: normal dispatch, palette-table address, reviewed empty code 0x1C10-0x2D78, empty artwork x=128-239/y=0-95.',
      unchanged: 'Every other overlay, native Heaven Sword attack/afterimage/combo code, original artwork, original palette data, Heaven Sword/Hell Blade/dual special stats.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'),
      files: ['src/weapon/w_000.c', 'src/weapon/w_013.c', 'src/weapon/shared.h', 'src/dra/6E42C.c', 'include/game.h']},
    editor: {revision: revision(path.resolve(__dirname, '../..'))},
    verified: ['both hands', 'normal slash instruction parity', 'native flying attack instruction parity through catch',
      'native afterimage factory calls and fade parity', 'private stat edits', 'MP/input/chain gates', 'palette loading and separation', 'artwork preservation',
      'forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged',
      'export/reopen special row recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay with a memory-card save remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Hunting Blade: Heaven Sword attack\n\nThe existing private QCF special (row 169) keeps ${report.edits.attack} damage, ${report.edits.mp} MP, and all its existing combat tuning. The special now uses Heaven Sword's native single flying attack, artwork, return and afterimages. It does not use the dual-Heaven-Sword combo. The normal slash retains its artwork, hitboxes and stats. Heaven Sword, Hell Blade and the dual-sword combo retain their own stats and routines.\n\nThe live image calls item 94 "${report.edits.liveName}"; this is the Hunting Blade referred to in the request, identified by its existing private Shotel-style special.\n\nSource: ${source}\n\nSize: ${original.length}\n\nBefore SHA-256: ${initialHash}\n\nExpected after SHA-256: ${finalHash}\n\nForward: ${names[0]} (${report.forward.sha256})\n\nReversal: ${names[1]} (${report.reversal.sha256})\n\nDecomp checkout: ${report.decomp.remote} at ${report.decomp.revision}\n\nEditor checkout at preparation: ${report.editor.revision}\n\nInspected areas, changes and verification are recorded in verification.json. Both PPFs contain block checks and embedded undo data; the provided application tool also requires the exact full-image hash and every guarded byte. The original BIN remains unchanged. No backup BIN is created.\n\nAfter explicit approval, run the builder with this directory and --apply to apply this exact prepared pair. If the source changes, rebuild and review a new pair.\n\nFresh-boot from a memory-card save to test the normal slash, QCF attack in both hands and directions, afterimage appearance, return/rethrow, MP/chain limits, independent special-stat edits, switching equipment, menus and room transitions. Check Heaven Sword, Hell Blade, dual swords and the other ordinary swords. Gameplay and appearance remain unverified.\n`);
  console.log(JSON.stringify({before: initialHash, after: finalHash, sectors: report.sectors.length, forward: report.forward, reversal: report.reversal, applied: false}, null, 2));
}
if (require.main === module) main().catch(e => {console.error(e); process.exitCode = 1;});
