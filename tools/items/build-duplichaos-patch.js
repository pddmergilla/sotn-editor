const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), K = require('../../stats-core.js'), M = require('../../stats-model.js');
const H = require('./duplichaos.js'), {verify} = require('../../tests/duplichaos.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const names = ['Duplichaos-ASS-2.0.ppf', 'Reverse-Duplichaos-ASS-2.0.ppf'];
async function reopen(image) {
  const disc = await C.DiscImage.open(new Blob([image])), bytes = await disc.readFile(await disc.findPath(['DRA.BIN']));
  const m = M.parse({DRA: {bytes, base: H.BASE}}), row = m.sections.body.accessory.find(r => r.index === H.ITEM);
  assert.equal(m.get(row.name), H.NAME); assert.equal(m.get(row.desc), H.DESC);
  for (const key of ['attack', 'defense', 'str', 'con', 'int', 'lck', 'weak', 'resist', 'immune', 'absorb']) assert.equal(m.get(row[key]), 0);
  const effect = group => m.get(m.effects.find(e => m.field(e).group === group));
  assert.equal(effect('duplicator'), 0xFFFF); assert.equal(effect('mysticpendant'), H.MYSTIC);
  assert.deepEqual(Buffer.from(bytes.subarray(H.CAVE, H.CAVE + H.helper().length)), H.helper());
  assert.equal(K.u32(bytes, H.HOOK), H.jump(H.BASE + H.CAVE, true)); assert.equal(K.u32(bytes, H.HOOK + 4), 0);
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
    const readme = path.join(directory, 'README.md');
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('The source BIN is unchanged', 'Applied with explicit user approval; the live hash, checksums and exact reversal passed. The source BIN was unchanged before application'));
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const record = await disc.findPath(['DRA.BIN']), dra = await disc.readFile(record);
  const after = verify(dra), changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image); assert.deepEqual(Buffer.from(await reopen(image)), Buffer.from(after));
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Duplichaos: +30 MP on the pendant tick - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Duplichaos - ASS 2.0');
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
  const editor = revision(path.join(__dirname, '../..')), decompRevision = revision(decomp);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    behavior: {item: {kind: 'accessory', index: H.ITEM, name: H.NAME, description: H.DESC, icon: 'unchanged (250, palette 250)',
      attack: 0, defense: 0, str: 0, con: 0, int: 0, lck: 0, weak: 0, resist: 0, immune: 0, absorb: 0},
      mp: {bonus: H.BONUS, tick: 'g_GameTimer & 0x3F == 0x1F (every 64 frames, the Mystic Pendant tick)', clamp: 'existing MP max clamp runs after it',
        gate: 'existing D_80097BF8 bit 0 gate', stacksWithMysticPendant: true, twoEquipped: 'same +30 as one, like Mystic Pendant'},
      infiniteItems: 'removed: the Infinite items effect now checks No item (0xFFFF), so consumables are used up normally',
      unchanged: ['Mystic Pendant (+3 on the same tick)', 'base MP regeneration (+1 every 32 frames)', 'ASS CON-based HP regeneration', 'shop entries and pickups']},
    inspected: ['DRA.BIN HUD MP regeneration (0x61D20-0x61DD4), the ASS regeneration helper at 0x800E2B08, CheckEquipmentItemCount (0x800FD7C0), ReduceWeapon (0x800FDD44)',
      'DRA.BIN accessory row 84 and its name/description strings, every equipment icon, pointers and branch targets in icon 314',
      'every CheckEquipmentItemCount site on the disc (DRA, stage and boss overlays) for items 76 and 84', 'Extra Hacks and stat-buff edit ranges'],
    reserved: {dra: `0x${H.ICON_START.toString(16).toUpperCase()}-0x${(H.ICON_END - 1).toString(16).toUpperCase()}`,
      helper: `0x${H.CAVE.toString(16).toUpperCase()}-0x${(H.CAVE + H.helper().length - 1).toString(16).toUpperCase()}`, icons: [H.ICON],
      hook: `0x${H.HOOK.toString(16).toUpperCase()}`, note: 'Do not assign equipment icon 314 or overwrite this helper. Warp cards keep icons 311-313.'},
    edits,
    editor: {path: path.resolve(__dirname, '../..'), revision: editor, note: 'The working tree also had uncommitted changes when this was built.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: decompRevision,
      files: ['src/dra/5F60C.c', 'src/dra/5D5BC.c', 'src/dra/d_24CEC.c', 'src/dra/4AEA4.c', 'include/game.h']},
    extraHacks: 'Checked on DRA.BIN: fingerprint code-window misses unchanged; ASS marker votes 384 -> 382 (Duplicator row and strings), vanilla votes 1.',
    verified: ['48,384 emulated MP-regeneration cases across gates, timers, accessory pairs and MP states, using the actual ASS helper',
      '144 emulated ReduceWeapon cases: Duplichaos now matches no accessory', 'Mystic Pendant and unequipped results identical to the original',
      'callee-saved registers and stack preserved', 'occupied-space, pointer, icon and changed-code rejection',
      'forward/reversal and both embedded undo hash round trips', 'damaged-byte rejection', 'sector checksums',
      'editor names/stats/effects on export/reopen', 'unrelated DRA fields, bytes and sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Duplichaos\n\nDuplicator (accessory 84) becomes **Duplichaos**: "${H.DESC}". It keeps the Duplicator icon and has 0 ATK, DEF, STR, CON, INT and LCK, with no weaknesses, resistances, immunities or absorptions.\n\nIt acts like Mystic Pendant: on the pendant's tick (every 64 frames), Duplichaos adds ${H.BONUS} MP, then the game's usual clamp stops MP at max. The original infinite-items effect is removed, so consumables are used up normally while it is equipped. Mystic Pendant keeps its +3 and stacks with Duplichaos. Base regeneration and ASS's CON-based HP regeneration are unchanged.\n\nSource: ${source}\nSize: ${original.length}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${names[0]}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${names[1]}\nReversal SHA-256: ${report.reversal.sha256}\nEditor revision: ${editor} (with uncommitted changes)\nDecomp revision: ${decompRevision}\n\nSee verification.json for the exact edited bytes, sectors and checks. The source BIN is unchanged and no backup BIN was created. Both PPFs have block checks and undo bytes; this builder additionally checks the full image hash and every changed byte.\n\nThe helper is in blank equipment icon 314 (DRA ${report.reserved.helper}), after the warp-card helpers in icons 311-313. Do not assign icon 314 to an item. In the editor, **Infinite items** now shows "No item (effect disabled)". The +30 MP check is a guarded helper the editor does not list.\n\nApply only after explicit approval: node tools/items/build-duplichaos-patch.js "${directory}" --apply\n\nFresh-boot the patched BIN and load a memory-card save; old savestates keep earlier code. Check the name, description, icon and zero stats in the equipment menu. Equip Duplichaos in either accessory slot, spend MP, and confirm about +30 MP every second up to max. Then check Mystic Pendant alone and together with Duplichaos, and confirm a food item is used up while Duplichaos is equipped. Gameplay remains unverified.\n`);
  console.log(JSON.stringify({source: report.source, result: report.result, forward: report.forward, reversal: report.reversal,
    sectors: report.sectors, records: report.records, application: report.application}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
