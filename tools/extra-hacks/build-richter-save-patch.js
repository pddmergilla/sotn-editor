const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), H = require('../../extra-hacks-ui.js');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
if (!directory) throw Error('Supply an output directory for the patch pair.');

function ppf(changes, block, description) {
  const header = Buffer.alloc(60); header.write('PPF30'); header[5] = 2;
  header.fill(32, 6, 56); header.write(description.slice(0, 50), 6, 'ascii'); header[57] = header[58] = 1;
  const parts = [header, block];
  for (const {start, original, modified} of changes) {
    for (let i = 0; i < modified.length;) {
      if (original[i] === modified[i]) { i++; continue; }
      const first = i;
      while (i < modified.length && original[i] !== modified[i] && i - first < 255) i++;
      const record = Buffer.alloc(9); record.writeBigUInt64LE(BigInt(start + first)); record[8] = i - first;
      parts.push(record, modified.slice(first, i), original.slice(first, i));
    }
  }
  return Buffer.concat(parts);
}

function apply(image, patch, undo = false) {
  const parsed = A.parsePpf(patch), after = Buffer.from(image);
  assert.deepEqual(after.subarray(0x9320, 0x9320 + 1024), Buffer.from(parsed.blockCheck));
  parsed.offsets.forEach((offset, i) => {
    const size = parsed.lengths[i], at = parsed.data[i];
    const old = Buffer.from(parsed.bytes.subarray(at + (undo ? 0 : size), at + (undo ? size : size * 2)));
    const next = parsed.bytes.subarray(at + (undo ? size : 0), at + (undo ? size * 2 : size));
    assert.deepEqual(after.subarray(offset, offset + size), old, `Guarded bytes at ${offset.toString(16)}`);
    after.set(next, offset);
  });
  return after;
}

(async () => {
  const original = await fs.readFile(source), initialHash = sha(original);
  const disc = await C.DiscImage.open(new Blob([original]));
  assert.equal(disc.sectorSize, 2352);
  const context = {window: {}};
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../../extra-hacks-catalog.js'), 'utf8'), context);
  const catalog = H.prepareCatalog(context.window.SotnExtraHacks), feature = catalog.features.find(f => f.id === 'richter-save');
  const files = new Map();
  for (const name of H.filesUsed(catalog)) files.set(name, await disc.readFile(await disc.findPath(name.split('/'))));
  const analysis = H.analyze(catalog, files), info = analysis.features.find(f => f.id === feature.id);
  assert.equal(analysis.profile, 'ass'); assert(['off', 'on'].includes(info.state)); assert.equal(info.context, true);
  const selected = new Map(analysis.features.map(f => [f.id, f.state === 'on']));
  selected.set(feature.id, false);
  const removed = files.get('BOSS/BO6/BO6.BIN').slice();
  H.applyEdits({before: files.get('BOSS/BO6/BO6.BIN'), after: removed}, H.plan(catalog, analysis, selected), 'BOSS/BO6/BO6.BIN');
  const offFiles = new Map(files); offFiles.set('BOSS/BO6/BO6.BIN', removed);
  selected.set(feature.id, true);
  const after = removed.slice();
  H.applyEdits({before: removed, after}, H.plan(catalog, H.analyze(catalog, offFiles), selected), 'BOSS/BO6/BO6.BIN');
  const record = await disc.findPath(['BOSS', 'BO6', 'BO6.BIN']);
  const changes = await C.changedSectors(disc, record, files.get('BOSS/BO6/BO6.BIN'), after);
  assert(changes.length > 0, 'The source already contains this fix');
  const expected = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), disc.dataOffset), change.modified);
    expected.set(change.modified, change.start);
  }
  const block = original.subarray(0x9320, 0x9320 + 1024);
  const forward = ppf(changes, block, 'Richter rescue cutscene fix - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Richter rescue cutscene fix - ASS 2.0');
  assert.deepEqual(apply(original, forward), expected);
  assert.deepEqual(apply(expected, reverse), original);
  assert.deepEqual(apply(original, reverse, true), expected);
  assert.deepEqual(apply(expected, forward, true), original);
  const mismatched = Buffer.from(original); mismatched[A.parsePpf(forward).offsets[0]] ^= 1;
  assert.throws(() => apply(mismatched, forward));
  const resultFiles = new Map(files); resultFiles.set('BOSS/BO6/BO6.BIN', after);
  const resultAnalysis = H.analyze(catalog, resultFiles);
  assert.equal(resultAnalysis.features.find(f => f.id === feature.id).state, 'on');
  for (const state of analysis.features.filter(f => f.id !== feature.id)) {
    assert.equal(resultAnalysis.features.find(f => f.id === state.id).state, state.state);
  }
  assert.equal(sha(await fs.readFile(source)), initialHash, 'The source BIN stayed unchanged');
  const forwardName = 'Richter-Rescue-Cutscene-Fix-ASS-2.0.ppf', reverseName = 'Reverse-Richter-Rescue-Cutscene-Fix-ASS-2.0.ppf';
  const evidence = {
    source: {path: source, size: original.length, sha256: initialHash}, result: {sha256: sha(expected)},
    forward: {path: path.resolve(directory, forwardName), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, reverseName), sha256: sha(reverse), size: reverse.length},
    overlay: {path: 'BOSS/BO6/BO6.BIN', extent: record.extent, size: record.size},
    edits: feature.edits.map(e => ({offset: '0x' + e.offset.toString(16), length: e.on.length, off: Buffer.from(e.off).toString('hex'), on: Buffer.from(e.on).toString('hex')})),
    sectors: changes.map(c => c.start / disc.sectorSize), records: A.parsePpf(forward).offsets.length,
    verified: ['guarded forward', 'guarded reversal', 'forward undo', 'reversal undo', 'sector checksums', 'other hack states unchanged', 'source BIN unchanged'],
    gameplay: 'Fresh-boot dialogue and Inverted Castle access remain unverified',
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: '0f45b7e61907d8dd5ebc32517bfca9d5954bb3e5', files: ['src/boss/bo6/richter.c', 'src/boss/bo6/us_3E79C.c', 'src/boss/bo6/e_cutscene_actors.c']}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(evidence.forward.path, forward); await fs.writeFile(evidence.reversal.path, reverse);
  await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Richter rescue cutscene fix\n\nThe old patch only put Richter into his saved pose. This version makes Shaft's orb process lethal Richter damage through its original death sequence, creating the rescue actors and sending the rescue signal to the installed Richter AI. It changes only BO6 code and the checksums of two sectors. It does not set the castle-unlock flag early.\n\nThe original BIN has not been written and no backup BIN was created. Apply only after approving this exact patch and confirming the current source hash. Use the reversal to restore only this patch.\n\nSource: \`${source}\`\n\nBefore SHA-256: \`${initialHash}\`\n\nExpected after SHA-256: \`${evidence.result.sha256}\`\n\nForward PPF: [${forwardName}](${forwardName}), SHA-256 \`${evidence.forward.sha256}\`\n\nReversal PPF: [${reverseName}](${reverseName}), SHA-256 \`${evidence.reversal.sha256}\`\n\nDecomp revision: \`${evidence.decomp.revision}\` from ${evidence.decomp.remote}; inspected RicMain, orb death, AI rescue handoff, and cutscene actor creation.\n\nVerified forward/reverse/undo round trips, guarded rejection, sector checksums, unchanged unrelated bytes and hack states, and source hash. See [verification.json](verification.json) for exact bytes, sectors and records.\n\nInstruction regression checks pass on vanilla US, ASS 1.3.1 and the current ASS BIN, including the old failure, rescue actors created once, one-update signal, both AI variants, and the native dialogue handoff. These checks simulate game services and do not prove emulator dialogue or progression.\n\nBoot the edited BIN afresh, load a memory-card save before Richter, defeat him without Holy Glasses, and check the full dialogue, return of control and Inverted Castle access. Also test the normal orb defeat with Holy Glasses and both stock/Epic Richter AI. Do not use an old savestate. The shipped release stays WIP/off until gameplay acceptance; the website release has not been refreshed or pushed.\n`);
  console.log(JSON.stringify(evidence, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
