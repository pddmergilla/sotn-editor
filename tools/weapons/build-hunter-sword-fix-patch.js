// Repairs an image that already has the Hunter Sword boomerang: the throw wrote its sprite
// bank to slot 0x10 but drew from slot 0x11, so the flying sword rendered through an unset
// bank. Also appends "you can throw it" to the Hunter Sword description.
// Usage: node tools/weapons/build-hunter-sword-fix-patch.js <output dir> [--apply]
// Without --apply only the guarded forward/reversal PPF pair is built; the BIN is untouched.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const M = require('../../stats-model.js'), H = require('./hunter-sword.js');
const {ppf, apply} = require('./build-hunter-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2], applying = process.argv.includes('--apply');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const names = ['Hunter-Sword-Throw-Fix-ASS-2.0.ppf', 'Reverse-Hunter-Sword-Throw-Fix-ASS-2.0.ppf'];
const ADDITION = 'you can throw it';
const lines = [];
const log = text => { console.log(text); lines.push(text); };

function describe(model) {
  const row = model.sections.equipRows[H.HUNTER], field = model.field(row.desc);
  assert.ok(field && !field.readOnly, 'Hunter Sword description is not editable.');
  assert.deepEqual(field.usedBy, [`Hand item #${H.HUNTER}`], 'Hunter Sword description is shared with another entry.');
  const current = model.get(row.desc);
  if (current.includes(ADDITION)) return {field, current, next: current};
  assert.match(current, /^\.\{CUT/, `Unexpected Hunter Sword description: ${current}`);
  // Keep the original width (it was padded with spaces) so the menu box is cleared the same way.
  let next = `${current.trimEnd()} ${ADDITION}`;
  next = next.padEnd(current.length, ' ');
  assert.equal(M.validate(field, next), null);
  return {field, current, next};
}

async function check(image, expectFixed) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  assert.equal(model.get(model.sections.equipRows[H.HUNTER].specialMove), H.SPECIAL);
  assert.deepEqual(M.rowUsers(model, H.SPECIAL), [H.HUNTER]);
  assert.equal(model.get(model.sections.equipRows[H.SHOTEL].specialMove), 176);
  if (expectFixed) assert.ok(model.get(model.sections.equipRows[H.HUNTER].desc).includes(ADDITION));
  for (let hand = 0; hand < 2; hand++) {
    const file = await disc.readFile(await disc.findPath(['BIN', `WEAPON${hand}.BIN`]));
    assert.equal(H.installState(file, hand), expectFixed ? 'fixed' : 'buggy');
  }
}

async function build() {
  const original = await fs.readFile(source), initialHash = sha(original);
  log(`Source: ${source}\nSize: ${original.length}\nBefore SHA-256: ${initialHash}`);
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  const model = await M.loadFromDisc(disc, C.normalizeIsoName);
  await check(original, false);
  const records = await Promise.all([0, 1].map(hand => disc.findPath(['BIN', `WEAPON${hand}.BIN`])));
  const weapons = await Promise.all(records.map(record => disc.readFile(record)));
  const fixed = weapons.map((file, hand) => H.upgrade(file, hand));
  const text = describe(model);
  log(`Description: "${text.current}" -> "${text.next}"`);
  model.set(text.field.id, text.next);
  const dra = model.files.DRA.bytes.slice(); M.apply(model, {DRA: dra});
  for (let i = 0; i < dra.length; i++) if (dra[i] !== model.files.DRA.bytes[i])
    assert.ok(i >= text.field.off && i < text.field.off + text.field.capacity, `Unexpected DRA change at ${i.toString(16)}`);
  const changes = await C.changedSectors(disc, model.files.DRA.record, model.files.DRA.bytes, dra);
  for (let hand = 0; hand < 2; hand++) {
    for (let i = 0; i < weapons[hand].length; i++) if (weapons[hand][i] !== fixed[hand][i])
      assert.ok(i >= H.CODE + H.BANK_CALL && i < H.CODE + H.BANK_CALL + 4, `Unexpected weapon change at ${i.toString(16)}`);
    changes.push(...await C.changedSectors(disc, records[hand], weapons[hand], fixed[hand]));
  }
  changes.sort((a, b) => a.start - b.start);
  assert.equal(new Set(changes.map(c => c.start)).size, changes.length);
  const work = Buffer.from(original);
  for (const c of changes) { assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start); }
  const finalHash = sha(work); await check(work, true);
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Hunter Sword throw sprite fix - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Hunter Sword throw fix - ASS 2.0');
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
    edits: {
      cause: 'The throw called the sword SetSpriteBank1 (slot 0x10) but set animSet ANIMSET_OVL(0x11), so it drew through an unset sprite bank.',
      weapon: 'WEAPON0/1.BIN slot 0 code +0x1878: jal SetSpriteBank1 (+0x11D8) -> jal SetSpriteBank2 (+0x1200)',
      description: {offset: `0x${text.field.off.toString(16)}`, before: text.current, after: text.next}},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5',
      files: ['src/weapon/shared.h', 'src/weapon/w_000.c', 'src/weapon/w_034.c']},
    verified: ['installed bug signature (both hands)', 'forward', 'reversal', 'forward undo', 'reversal undo', 'guarded rejection',
      'sector checksums', 'unrelated sectors unchanged', 'editor recognition', 'original source unchanged'],
    gameplay: 'Fresh-boot gameplay remains unverified.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  log(`Expected after SHA-256: ${finalHash}\nForward: ${report.forward.path} (${report.forward.sha256})\nReversal: ${report.reversal.path} (${report.reversal.sha256})\nSectors: ${report.sectors.join(', ')}\nPPF pair verified. The BIN has not been changed.`);
  return report;
}

async function applyToSource(report) {
  const prompt = readline.createInterface({input: process.stdin, output: process.stdout});
  const answer = (await prompt.question('\nType APPLY to write the fix into the BIN (anything else cancels): ')).trim();
  prompt.close();
  if (answer !== 'APPLY') { log('Cancelled. The BIN was not changed.'); return; }
  const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
  const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
  assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
  apply(image, forward); assert.equal(sha(image), report.result.sha256);
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
  await check(live, true);
  for (const sector of report.sectors) {
    const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
  apply(live, reverse); assert.equal(sha(live), report.source.sha256);
  report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true, at: new Date().toISOString()};
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  log(`Applied. Live SHA-256: ${report.result.sha256}. Reversal PPF verified against the patched image.`);
}

async function main() {
  try {
    const report = await build();
    if (applying) await applyToSource(report);
  } catch (error) {
    log(`FAILED: ${error.stack || error}`); process.exitCode = 1;
  } finally {
    await fs.mkdir(directory, {recursive: true});
    await fs.writeFile(path.join(directory, 'run.log'), lines.join('\n') + '\n');
  }
}
if (require.main === module) {
  if (!directory) throw Error('Supply an output directory.');
  main();
}
