const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), H = require('./elemental-weapons.js'), X = require('../../weapon-special-rows.js');
const {ppf, apply} = require('./build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
async function check(image) {
  const disc = await C.DiscImage.open(new Blob([image])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  for (const c of H.CONFIG) {
    const item = model.sections.hand[c.item], row = model.sections.equipRows[c.special];
    assert.equal(model.get(item.unk17), c.special); assert.equal(model.get(item.weaponId), c.overlay);
    assert.equal(model.get(item.specialMove), 0); assert.equal(model.get(row.unk11), 1);
    assert.deepEqual(M.rowUsers(model, c.special), [c.item]);
    assert.ok(M.specialRows(model).some(r => r.index === c.special));
  }
  return {disc, model};
}
async function main() {
  const reportPath = path.resolve(directory, 'verification.json');
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
      assert.equal(sha(await handle.readFile()), report.source.sha256, 'The source changed before writing.');
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
    const readme = path.resolve(directory, 'README.md');
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('The original BIN is unchanged.', 'The original BIN was patched with explicit user approval; its hash and exact reversal passed verification.'));
    console.log(JSON.stringify(report.application, null, 2)); return;
  }
  const original = await fs.readFile(source), beforeHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(record => disc.readFile(record))), prepared = H.prepare(model, weapons);
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, prepared.dra);
  for (const hand of [0, 1]) changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], prepared.weapons[hand]));
  changes.sort((a, b) => a.start - b.start); assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) { assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start); }
  const afterHash = sha(work), opened = await check(work);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'Elemental swords: brand basics, instant specials');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), original.subarray(0x9320, 0x9720), 'Reverse elemental sword attacks');
  apply(work, reverse); assert.equal(sha(work), beforeHash);
  apply(work, forward); assert.equal(sha(work), afterHash);
  apply(work, forward, true); assert.equal(sha(work), beforeHash);
  apply(work, reverse, true); assert.equal(sha(work), afterHash);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!changed.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), beforeHash, 'The source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: beforeHash}, result: {sha256: afterHash},
    forward: {path: path.resolve(directory, 'Elemental-Swords-Instant-Specials-ASS-2.0.ppf'), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, 'Reverse-Elemental-Swords-Instant-Specials-ASS-2.0.ppf'), sha256: sha(reverse), size: reverse.length},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    weapons: H.CONFIG.map(c => ({...c, initialSpecial: Object.fromEntries(['attack', 'mp', 'element', 'invFrames', 'stun', 'chain'].map(key => [key, opened.model.get(opened.model.sections.equipRows[c.special][key])]))})),
    inspected: {dra: ['equipment table 0x4B04', 'sound header 0x1407C', 'padding 0x15100-0x154FF', ...X.sites.map(s => '0x' + s[0].toString(16))],
      weapons: ['both hands: overlays 48, 49 and 50', '48: charge branch 0x1528, padding 0x23C0', '50: charge branch 0x1560, padding 0x2E90']},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision(path.resolve(__dirname, '../../../sotn-decomp')),
      files: ['src/weapon/w_048.c', 'src/weapon/w_049.c', 'src/weapon/w_050.c', 'src/weapon/shared.h', 'src/dra/6E42C.c', 'src/dra/5D5BC.c', 'src/dra/menu.c', 'src/dra/71830.c', 'src/dra/sound.c']},
    editor: {revision: revision(path.resolve(__dirname, '../..'))},
    verified: ['forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection', 'sector checksums', 'unrelated sectors unchanged', 'editor private-special recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay remains unverified; test both hands, directions, normal attacks, instant specials, original brands, Marsil, menus and room changes.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Elemental sword attacks

Heatgar uses Firebrand's normal attack and Marsil's ordinary fire slash for ←→ + attack. Sparkblade uses Thunderbrand's normal attack and its lightning special slash without charge. Coldsteel uses Icebrand's normal attack and its ice special slash without charge. Normal weapon names, icons and stats are preserved. Original brand specials and Marsil are preserved.

Private special rows are Heatgar 217 (${report.weapons[0].initialSpecial.attack} damage, ${report.weapons[0].initialSpecial.mp} MP), Sparkblade 200 (${report.weapons[1].initialSpecial.attack} damage, ${report.weapons[1].initialSpecial.mp} MP), and Coldsteel 201 (${report.weapons[2].initialSpecial.attack} damage, ${report.weapons[2].initialSpecial.mp} MP). The editor exposes each weapon's Special: ←→ + attack and its Weapon specials row, including damage, MP, element, hit cooldown, soul effect and other row properties. Initial special stats copy their respective donors; future edits are independent. Back-forward retains native MP behavior: it spends the configured cost when sufficient MP is available and does not refuse the attack when MP is low.

Only two ordinary spare rows remained. A guarded row 217 resides after the declared second sound header, in padding at DRA 0x15100. Twelve small helpers redirect runtime reads for that extra row, preserving the accessory table and all existing rows. Other rows keep their original reads. Lightning/ice charge effects are bypassed only for rows 200/201. Their slash effects and child entities still use private properties.

Source BIN: ${source}

Before SHA-256: ${beforeHash}

Expected after SHA-256: ${afterHash}

Forward SHA-256: ${report.forward.sha256}

Reversal SHA-256: ${report.reversal.sha256}

Decomp checkout: ${report.decomp.remote} at ${report.decomp.revision}. Editor revision at preparation: ${report.editor.revision}. See verification.json for paths, hashes, inspected ranges and checks.

The original BIN is unchanged. Both PPFs contain undo bytes and block checks. The application tool guards the full input hash and changed bytes; ordinary patchers may not enforce these guards. No backup BIN is created.

Prepare: node tools/weapons/build-elemental-weapons-patch.js <output-directory>

Apply only after explicit approval: repeat with --apply.

Fresh-boot the patched image and load a memory-card save. Test all normal attacks standing, crouching and airborne, both hands/directions, instant fire/lightning/ice slashes, private damage/MP/element edits, repeat attacks, original brand charges, Marsil, menus, gear and room changes. Gameplay remains unverified.
`);
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) {
  if (!directory) throw Error('Supply an output directory.');
  main().catch(error => {console.error(error); process.exitCode = 1;});
}
module.exports = {check};
