const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const H = require('./element-line.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const {verify} = require('../../tests/menu-element-line.test.js');
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const names = ['Menu-RES-WEAK-Elements-ASS-2.0.ppf', 'Reverse-Menu-RES-WEAK-Elements-ASS-2.0.ppf'];

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image]));
  assert.equal(disc.sectorSize, 2352);
  const record = await disc.findPath(['DRA.BIN']);
  return {disc, record, dra: await disc.readFile(record)};
}

function sectorsValid(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes, `Sector ${sector}.`);
  }
}

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.resolve(directory, 'verification.json');
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'The source BIN changed; prepare a new patch pair.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    sectorsValid(image, report.sectors);
    assert.deepEqual([...new Set(A.parsePpf(forward).offsets.map(off => Math.floor(off / 2352)))].sort((a, b) => a - b), report.sectors);
    const result = await inspect(image), before = await inspect(original);
    assert.deepEqual(result.dra, await verify(before.dra));
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    assert.equal(sha(await fs.readFile(source)), report.source.sha256, 'The live BIN changed before writing.');
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
        assert.equal((await handle.write(image.subarray(start, start + 2352), 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256);
    sectorsValid(live, report.sectors);
    assert.deepEqual((await inspect(live)).dra, result.dra);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, record, dra} = await inspect(original), after = await verify(dra);
  const changes = await C.changedSectors(disc, record, dra, after), sectors = changes.map(change => change.start / 2352).sort((a, b) => a - b);
  const image = Buffer.from(original); changes.forEach(change => image.set(change.modified, change.start));
  sectorsValid(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Main menu current RES and WEAK elements');
  const reverse = ppf(changes.map(change => ({...change, original: change.modified, modified: change.original})), block, 'Reverse main menu RES and WEAK elements');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  assert.deepEqual((await inspect(image)).dra, after);
  const starts = new Set(changes.map(change => change.start));
  for (let at = 0; at < original.length; at += 2352) if (!starts.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
  const end = H.CAVE + H.helper().length - 1, icon = off => Math.floor((off - 0x25324) / 128);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length,
    edits: {file: 'DRA.BIN', extent: record.extent, size: record.size,
      hook: '0x57B38-0x57B3F (MenuDrawStats return path)', helper: `0x${H.CAVE.toString(16).toUpperCase()}-0x${end.toString(16).toUpperCase()}`,
      coordinates: {x: H.X, y: H.Y, glyph: '8x8', maximumCharacters: 44},
      readOnlyTotals: '0x80097C28 (weak), 0x80097C2A (resist), 0x80097C2C (immune), 0x80097C2E (absorb)',
      behavior: 'Main menu only, after the existing equipment and active-buff recalculation; full element names, then 3-letter or 2-letter names when needed; - for an empty list.',
      effectiveResistance: '(resist & ~weak) | immune | absorb', effectiveWeakness: 'weak & ~(resist | immune | absorb)',
      elements: H.ELEMENTS.map(([mask, short, compact, name]) => ({mask: `0x${mask.toString(16).toUpperCase()}`, name, short, compact})),
      safeSpace: `Zeroed unused equipment icons ${icon(H.CAVE)}-${icon(end)}; all current equipment uses icons 0-273. No existing direct jumps, calls or aligned pointers target the reserved range. The patch uses 606 bytes and reserves icons 289-301. Do not assign those icons to equipment.`,
      native: H.NATIVE.map(([start, finish, hash]) => ({start: `0x${start.toString(16).toUpperCase()}`, endExclusive: `0x${finish.toString(16).toUpperCase()}`, sha256: hash}))},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision(decomp),
      files: ['src/dra/menu.c', 'src/dra/5D5BC.c', 'include/game.h', 'config/splat.us.dra.yaml'],
      existingLocalChanges: 'The source menu.c already excludes Potion/High Potion consumable counts; it was not changed for this patch. Live modded bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..')), files: ['tools/menu/element-line.js', 'tools/menu/build-element-line-patch.js', 'tests/menu-element-line.test.js', 'docs/menu-element-line.md']},
    verified: ['native menu return, text drawing and font termination', 'all 2048 element subsets on each side and all complementary subsets',
      '500 mixed weak/resist/immune/absorb cases', 'all 11 elements', 'resist/weak cancellation and immunity/absorption priority',
      '44-character width and 212-220 vertical bounds', 'native CalcDefense with all seven Resist buffs individually and together',
      'buff expiry', 'five body slots and hardcoded Medusa/Fire Shield immunity', 'Heart of Vlad immunity',
      'native full menu preserves all existing drawing calls and adds one line after recalculation', 'equipment overview is unchanged',
      'stack and saved registers restored', 'only helper and hook bytes change within DRA', 'occupied space and altered native code rejected',
      'forward, reversal and both undo full-image hashes', 'guarded altered-byte rejection', 'export/reopen', 'sector checksums',
      'unrelated sectors unchanged', 'source BIN unchanged'],
    gameplay: 'Fresh-boot emulator presentation and gameplay remain unverified; use a memory-card save.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, 'README.md'), `# Main menu RES / WEAK line\n\nPrepared for the exact current image; the original BIN is unchanged.\n\nExample: RES:Fire Thunder Poison WEAK:Ice\n\nFull element names appear when they fit. Longer lists use the abbreviations in verification.json, keeping all elements on one line. RES includes resistance, immunity and absorption; equal weakness and resistance cancel. No gear or buff values are changed. Empty lists show -. Only the main menu background receives this line, at x=8/y=212.\n\nSource: ${source}\nSize: ${original.length}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${report.forward.path}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${report.reversal.path}\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp: ${report.decomp.remote} at ${report.decomp.revision}\nEditor at preparation: ${report.editor.revision}\n\nDRA.BIN: extent ${record.extent}, size ${record.size}; hook ${report.edits.hook}; helper ${report.edits.helper}. Repaired sectors: ${sectors.join(', ')}. The detailed verification report records all inspected sources, native code hashes and checks.\n\nBoth patches contain undo bytes and block checks. The application tool checks the complete image hash and every changed byte; mismatches are rejected. No backup BIN is created or deleted. Applying the reversal removes only this menu addition.\n\nAfter explicit approval, apply with:\nnode tools/menu/build-element-line-patch.js "${path.resolve(directory)}" --apply\n\nFresh-boot with a memory-card save and check the menu, different equipment combinations, active/expired Resist buffs, weakness cancellation, immunity and absorption, crowded lists, menus opening/closing and equipment submenus. Emulator presentation and gameplay remain unverified.\n`);
  console.log(JSON.stringify({sourceSha256: initial, expectedSha256: final, forward: report.forward, reversal: report.reversal, sectors, reportPath}, null, 2));
}

if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1; });
