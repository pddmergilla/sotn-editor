const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js');
const T = require('./shopcard-return-state.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const MAIN = path.resolve(__dirname, '../../MainBIN');
const source = process.env.SOTN_ASS_BIN || path.join(MAIN, 'Castlevania - Alternate Scarlet Symphony 2.0.bin');
const directory = process.argv[2] || MAIN, applying = process.argv.includes('--apply');
const NAME = 'ShopCard-State-Second-Castle-Crash-Fix-ASS-2.0';
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const hex = v => '0x' + v.toString(16).toUpperCase();
async function inspect(image, installed) {
  const disc = await C.DiscImage.open(new Blob([image]));
  const record = await disc.findPath(T.PATH), file = Buffer.from(await disc.readFile(record));
  if (installed) T.verify(file); else T.check(file);
  return {disc, record, file};
}
async function main() {
  const reportPath = path.resolve(directory, `${NAME}.verification.json`);
  if (applying) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const image = await fs.readFile(source); assert.equal(sha(image), report.source.sha256, 'The source BIN changed.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    apply(image, forward); assert.equal(sha(image), report.result.sha256); await inspect(image, true);
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
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256); await inspect(live, true);
    for (const sector of report.sectors) {
      const bytes = live.subarray(sector * 2352, (sector + 1) * 2352);
      assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
    }
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    const readme = path.resolve(directory, `${NAME}.README.md`);
    await fs.writeFile(readme, (await fs.readFile(readme, 'utf8')).replace('The original BIN is unchanged.', 'Applied with explicit user approval; the live hash, checksums and exact reversal passed.'));
    console.log(JSON.stringify(report.application, null, 2)); return;
  }
  const original = await fs.readFile(source), before = sha(original), opened = await inspect(original, false);
  const modified = T.overlay(opened.file);
  const changes = await C.changedSectors(opened.disc, opened.record, opened.file, modified);
  const work = Buffer.from(original);
  for (const c of changes) {assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);}
  const after = sha(work); await inspect(work, true);
  const forward = ppf(changes, original.subarray(0x9320, 0x9720), 'ShopCard state / 2nd castle crash fix - ASS 2.0');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), original.subarray(0x9320, 0x9720), 'Reverse ShopCard state crash fix - ASS 2.0');
  apply(work, reverse); assert.equal(sha(work), before);
  apply(work, forward); assert.equal(sha(work), after);
  apply(work, forward, true); assert.equal(sha(work), before);
  apply(work, reverse, true); assert.equal(sha(work), after);
  const starts = new Set(changes.map(c => c.start));
  for (let at = 0; at < work.length; at += 2352) if (!starts.has(at)) assert.deepEqual(work.subarray(at, at + 2352), original.subarray(at, at + 2352));
  for (let at = 0; at < modified.length; at++) if (!T.edits().some(e => at >= e.off && at < e.off + 4)) assert.equal(modified[at], opened.file[at]);
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(work, forward));
  assert.equal(sha(await fs.readFile(source)), before, 'The source changed during preparation.');
  const report = {
    source: {path: source, size: original.length, sha256: before}, result: {sha256: after},
    forward: {path: path.resolve(directory, `${NAME}.ppf`), sha256: sha(forward), size: forward.length},
    reversal: {path: path.resolve(directory, `Reverse-${NAME}.ppf`), sha256: sha(reverse), size: reverse.length},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    file: {path: T.PATH.join('/'), lba: opened.record.extent, size: opened.record.size, sha256Before: sha(opened.file), sha256After: sha(modified)},
    state: {old: `${hex(T.OLD)}-${hex(T.OLD + T.SIZE - 1)} (blank icon 275, shared with the attack helper)`, new: `${hex(T.NEW)}-${hex(T.NEW + T.SIZE - 1)} (zero tail of icon 308, after the Shop Card reader)`},
    attackHelper: {range: `${hex(T.HELPER)}-${hex(T.HELPER_END - 1)}`, sha256: T.HELPER_SHA, unchanged: true},
    edits: T.edits().map((e, i) => ({address: hex(T.BASE + e.off), fileOffset: hex(e.off), use: T.SITES[i].op,
      original: e.original.toString('hex').toUpperCase(), patched: e.expect.toString('hex').toUpperCase()})),
    findings: 'Freeze in the inverted castle (first seen walking from the TOP->RTOP teleporter toward the reverse throne room, map 0x20,0x37). Reproduced in PCSX-ReARMed from the user\'s state and from a clean memory-card load (Castle Keep save room, then the castle teleporter). A trap at address 0 caught ra=0x801A2E48: RTOP hit detection\'s "jal 0x800CDCA4" (second-castle enemy attack helper) jumped to 0. RAM at 0x800CDCB0-0x800CDCBB held 0x0C, 0x27, 0x09 (stage TOP+1, room 0x27,0x09) instead of the helper\'s nop / sltiu at,at,6 / bne at,zero: the Shop Card inverted-castle return recorder (hooked at 0x80105428 -> 0x800CE21C) stores its return room there, decoding as syscall / nor / jalr zero. Every inverted-castle overlay (RNO0-RNO4, RNZ0, RNZ1, RLIB, RCAT, RCHI, RDAI, RCEN, RARE, RTOP, RWRP, RBO6-RBO8) calls the helper, so any hit check after the recorder has stored a room crashes. A save made after the recorder ran keeps crashing; a save from before it (zeros there) does not. The fix moves the three state words to 0x800CED8C-0x800CED97, which is zero in vanilla, the Oct 4 ASS image and this BIN and is referenced by no file on the disc. Emulator check: with the eight retargeted instructions in RAM, the same clean-load route records to the new words, the helper stays intact and Alucard passes the freeze point.',
    inspected: ['RTOP hit detection 0x801A2E40/0x801A2EA4 (jal 0x800CDCA4) and DRA helper 0x800CDCA4-0x800CDD13', 'Shop Card recorder 0x800CE21C (hook 0x80105428) and reader 0x800CED04 (hook 0x800F4748)', 'old Life Apple load/init clears 0x800CE35C/0x800CE36C (unreferenced)', 'all lui/offset references into 0x800CDCB0-0x800CDCBB and 0x800CED8C-0x800CEDA3 across every code file on the disc', 'jal/j into the attack helper across every overlay', 'user state RAM, crash RAM and the last two frames before the freeze'],
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision(path.resolve(__dirname, '../../../sotn-decomp')), files: ['src/dra/5087C.c (func_80105428 caller, func_800F16D0)', 'src/st/collision.h (HitDetection)', 'include/game.h (Tilemap, PlayerStatus)']},
    editor: {revision: revision(path.resolve(__dirname, '../..'))}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, `${NAME}.README.md`), [
    '# Shop Card state / second-castle crash fix', '',
    'Fixes the freeze in the inverted castle (for example walking from the castle teleporter toward the reverse throne room).', '',
    'Cause: the Shop Card inverted-castle return recorder stores its return room in DRA `0x800CDCB0-0x800CDCBB`, but the second-castle enemy attack helper was later written over `0x800CDCA4-0x800CDD13`. Once a room is recorded (for example after saving in the Castle Keep save room) the helper\'s instructions become `syscall / nor / jalr zero`, and the next enemy hit check in any inverted-castle area jumps to address 0.', '',
    `Fix: moves the three Shop Card state words to the unreferenced, zero-filled \`${hex(T.NEW)}-${hex(T.NEW + T.SIZE - 1)}\` (8 DRA instructions retargeted). The attack helper, Shop Card behaviour and every other mod are unchanged.`, '',
    `Source: ${source}`, `Size: ${original.length}`, `Before SHA-256: ${before}`, `Expected after SHA-256: ${after}`,
    `Forward: ${NAME}.ppf (SHA-256 ${report.forward.sha256})`, `Reversal: Reverse-${NAME}.ppf (SHA-256 ${report.reversal.sha256})`, '',
    'Both PPFs carry the block check and undo data, are guarded against the exact pre-patch bytes, and pass full-image round trips and repaired-sector checks. The original BIN is unchanged.', '',
    'Existing savestates keep the corrupted helper in RAM; after applying, boot fresh and load a memory-card save.', '',
    `Apply only after explicit approval: node tools/items/build-shopcard-return-state-patch.js "${directory}" --apply`, ''].join('\n'));
  console.log(JSON.stringify({source: report.source, result: report.result, forward: report.forward, reversal: report.reversal, sectors: report.sectors, records: report.records}, null, 2));
}
if (require.main === module) main().catch(e => {console.error(e); process.exit(1);});
module.exports = {inspect, NAME};
