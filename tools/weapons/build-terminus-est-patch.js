const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), K = require('../../stats-core.js');
const H = require('./terminus-est.js');
const {ppf, apply} = require('./build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Terminus-Est-Crissaegrim-Special-ASS-2.0.ppf', 'Reverse-Terminus-Est-Crissaegrim-Special-ASS-2.0.ppf'];
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

async function check(image) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const item = model.sections.hand[H.TERMINUS];
  assert.equal(model.get(item.unk17), H.SPECIAL);
  assert.equal(model.get(item.weaponId), H.OVERLAY); assert.equal(model.get(item.wpal), 6);
  assert.deepEqual(M.rowUsers(model, H.SPECIAL), [H.TERMINUS]);
  assert.equal(model.get(model.sections.equipRows[H.SPECIAL].weaponId), H.OVERLAY);
  for (const hand of [0, 1]) {
    const file = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    assert.equal(K.u32(file, H.OVERLAY * H.SLOT + H.CODE), (hand ? 0x8017D000 : 0x8017A000) + H.ENTRY);
  }
  return {disc, model};
}

async function main() {
  const reportPath = path.join(directory, 'verification.json');
  if (applying) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    apply(image, forward); assert.equal(sha(image), report.result.sha256); await check(image);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      const live = await handle.readFile(); assert.equal(sha(live), report.source.sha256, 'The source changed before writing.');
      for (const sector of report.sectors) {
        const start = sector * 2352, bytes = image.subarray(start, start + 2352);
        assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
        assert.equal((await handle.write(bytes, 0, bytes.length, start)).bytesWritten, bytes.length);
      }
      await handle.sync();
    } finally {await handle.close();}
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256); await check(live);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    const readmePath = path.join(directory, 'README.md');
    const readme = await fs.readFile(readmePath, 'utf8');
    await fs.writeFile(readmePath, readme.replace('The original BIN is unchanged.',
      `The original BIN was patched with explicit user approval; its live SHA-256 is ${report.result.sha256}, and the reversal restores the exact pre-patch hash in memory.`));
    console.log(JSON.stringify(report.application, null, 2)); return;
  }
  const original = await fs.readFile(source), initialHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(record => disc.readFile(record)));
  const prepared = H.prepare(model, weapons);
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, prepared.dra);
  for (const hand of [0, 1]) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
  changes.sort((a, b) => a.start - b.start);
  assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) {
    assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);
  }
  const finalHash = sha(work); await check(work);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Terminus Est back-forward Crissaegrim special');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), original.subarray(0x9320, 0x9720), 'Reverse Terminus Est Crissaegrim special');
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
    edits: {weapon: H.TERMINUS, privateSpecial: H.SPECIAL, donor: H.CRISSAEGRIM,
      initialSpecial: Object.fromEntries(['attack', 'mp', 'element', 'invFrames', 'stun', 'chain'].map(key => [key, model.get(model.sections.equipRows[H.SPECIAL][key])])),
      draOffsets: ['0x62A3 (Terminus Est overlay)', '0x62A4 (palette)', '0x62AB (back-forward special)', '0x70CC-0x70FF (private row 186)'],
      weaponOffsets: ['overlay 12: artwork x128-239/y0-95', 'overlay 12: normal entry', 'overlay 12: palette table references 0xB4C/0xB54', 'overlay 12: padding 0x1B30-0x2CAB'],
      behavior: 'Original Terminus Est slash; back-forward selects a private Crissaegrim attack row; no new MP check.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('../sotn-decomp'),
      files: ['src/weapon/w_000.c', 'src/weapon/w_012.c', 'src/weapon/shared.h', 'src/dra/6E42C.c', 'src/dra/7879C.c']},
    editor: {revision: revision('.')},
    verified: ['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums',
      'unrelated sectors unchanged', 'editor private-special recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay remains unverified; test both hands, facing directions, normal slashes, combo bursts, repeated casts, room transitions and original Crissaegrim.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Terminus Est Crissaegrim special

Terminus Est keeps its normal slash and artwork. Back-forward + attack uses Crissaegrim's actual attack routine and factory through private row 186. The row starts at ${report.edits.initialSpecial.attack} damage and ${report.edits.initialSpecial.mp} MP; damage, MP cost, element, hit cooldown and other attack properties are editable independently under Terminus Est's Special: ←→ + attack and Weapon specials row 186. No new MP check is added: the game's existing back-forward input and spending behavior remain intact.

The sword loads overlay 12 with its own palette selector 6. Its ordinary attack uses a relocated copy of overlay 0's sword routine, animations, hitboxes and artwork. Crissaegrim's attack routine stays unchanged. The original Crissaegrim, Vorpal Blade and Chakram retain their routines, artwork and palette selectors. Hunter Sword and Stone Sword changes are preserved.

Source BIN: ${source}

Before SHA-256: ${initialHash}

Expected after SHA-256: ${finalHash}

Forward: ${names[0]} (${report.forward.sha256})

Reversal: ${names[1]} (${report.reversal.sha256})

Source checkout: Xeeynamo/sotn-decomp at ${report.decomp.revision}. Editor checkout at preparation: ${report.editor.revision}. See verification.json for inspected ranges, changed sectors and verification.

The original BIN is unchanged. Both PPFs contain undo bytes and a block check. The application tool checks the full-image hash and all changed bytes before writing; ordinary PPF tools may not enforce those checks.

Prepare: node tools/weapons/build-terminus-est-patch.js <output-directory>

Apply after explicit approval: repeat with --apply.

Fresh-boot the patched image and load a memory-card save. Test the normal slash standing, crouching and airborne, both hands and facing directions, back-forward slash bursts, private damage and element edits, repeated attacks and chain limits, gear changes, menus and room transitions. Check original Crissaegrim, Vorpal Blade, Chakram, Hunter Sword and Stone Sword. Gameplay remains unverified.
`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) {
  if (!directory) throw Error('Supply an output directory.');
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
