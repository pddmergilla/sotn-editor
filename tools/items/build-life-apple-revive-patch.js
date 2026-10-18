const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), K = require('../../stats-core.js');
const H = require('./life-apple-revive.js'), {verify} = require('../../tests/life-apple-revive.test.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || path.join(__dirname, '../../MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const decomp = process.env.SOTN_DECOMP || 'D:/AAA/GitHub/sotn-decomp';
const v1 = 'C:/Users/omergilla/Documents/Codex/2026-10-12/referenced-chatgpt-conversation-this-is-an/outputs/Life-Apple-Auto-Revives-ASS-2.0.ppf';
const directory = process.argv[2];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();
const names = ['Life-Apple-Revive-v2-Flash-HUD-ASS-2.0.ppf', 'Reverse-Life-Apple-Revive-v2-Flash-HUD-ASS-2.0.ppf'];
const hex = n => `0x${n.toString(16).toUpperCase()}`;
async function reopen(image) {
  const disc = await C.DiscImage.open(new Blob([image])), bytes = await disc.readFile(await disc.findPath(['DRA.BIN']));
  const {code, labels} = H.helper(bytes);
  assert.deepEqual(Buffer.from(bytes.subarray(H.CAVE, H.CAVE_END)), code);
  for (const [key, [off]] of Object.entries(H.HOOKS)) assert.equal(K.u32(bytes, off), H.hookWord(key, labels));
  return bytes;
}
// Other overlays must not reach into the helper or its variables (stage overlays call icon 303's helper).
async function overlays(disc, vars = H.VARS) {
  const found = [], walk = async (record, prefix) => {
    for (const e of await disc.readDirectory(record)) {
      if (e.isDirectory) { await walk(e, prefix + e.name + '/'); continue; }
      if (!/\.BIN;?\d*$/i.test(e.name) || /^DRA\.BIN/i.test(e.name) || e.size > 4e6) continue;
      const b = await disc.readFile(e);
      for (let off = 0; off + 4 <= b.length; off += 4) {
        const w = K.u32(b, off), op = w >>> 26;
        if (w >= vars && w < vars + 8) found.push(`${prefix}${e.name}@${off.toString(16)} (data pointer)`);
        const t = op === 2 || op === 3 ? (0x80000000 | (w & 0x3FFFFFF) << 2) >>> 0 : null;
        if (t !== null && t >= H.BASE + H.CAVE && t < H.BASE + H.CAVE_END) found.push(`${prefix}${e.name}@${off.toString(16)}`);
        if (op !== 15 || ![0x800C, 0x800D].includes(w & 0xFFFF)) continue;
        for (let n = 1; n <= 8 && off + n * 4 + 4 <= b.length; n++) {
          const x = K.u32(b, off + n * 4);
          if ((x >>> 21 & 31) !== (w >>> 16 & 31) || ![9, 13, 32, 33, 35, 36, 37, 40, 41, 43].includes(x >>> 26)) continue;
          const addr = ((w << 16) + (x << 16 >> 16)) >>> 0;
          if ((addr >= H.BASE + H.CAVE && addr < H.BASE + H.CAVE_END) || (addr >= vars && addr < vars + 8))
            found.push(`${prefix}${e.name}@${(off + n * 4).toString(16)}`);
        }
      }
    }
  };
  await walk(disc.root, ''); return found;
}
// Prepare only PPF files for the current image's fresh-load state overlap. This mode
// preserves all other mods, including the code occupying the old state address.
const FRESH = {
  sha256: '92FAF13CF993B899A7BB85D8D4733C20D4FE85F2633B3216591F91279BCC5113', verify: 'verifyLoadFix', cases: '2147 MIPS cases',
  names: ['Life-Apple-Full-On-Memcard-Load-ASS-2.0.ppf', 'Reverse-Life-Apple-Full-On-Memcard-Load-ASS-2.0.ppf'],
  titles: ['Life Apple full on memory-card load - ASS 2.0', 'Reverse Life Apple full on memory-card load - ASS2']};
// Revive at min(max hearts, max HP) keeping MP, or full HP/MP with the Faerie summoned. PPFs go next to the main BIN.
const HEARTS = {
  sha256: '61B0FFC10A0A5AD872EF40C8938FCF4223678A2BA2309D2149F5F4D8E256CE5D', verify: 'verifyHeartsRevive', cases: '2351 MIPS cases',
  names: ['Life-Apple-Revive-Hearts-HP-Faerie-Full-ASS-2.0.ppf', 'Reverse-Life-Apple-Revive-Hearts-HP-Faerie-Full-ASS-2.0.ppf'],
  titles: ['Life Apple revive: HP = max hearts, Faerie full', 'Reverse Life Apple revive hearts HP / Faerie full'],
  ppfDirectory: path.join(__dirname, '../../MainBIN')};
async function mainFreshLoad(mode = FRESH) {
  assert.ok(directory, 'Supply an output directory.');
  const original = await fs.readFile(source), initial = sha(original);
  assert.equal(initial, mode.sha256, 'The source image changed since this patch was inspected.');
  const disc = await C.DiscImage.open(new Blob([original])); assert.equal(disc.sectorSize, 2352);
  assert.deepEqual(await overlays(disc, H.LOAD_VARS), [], 'An overlay references the Life Apple helper/state space.');
  const record = await disc.findPath(['DRA.BIN']), dra = await disc.readFile(record);
  const after = require('../../tests/life-apple-revive.test.js')[mode.verify](dra);
  const changes = await C.changedSectors(disc, record, dra, after), work = Buffer.from(original);
  for (const c of changes) {
    assert.deepEqual(C.repairSector(c.modified.slice(), 24), c.modified); work.set(c.modified, c.start);
  }
  const final = sha(work), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, mode.titles[0]);
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, mode.titles[1]);
  const check = async image => {
    const d = await C.DiscImage.open(new Blob([image]));
    assert.deepEqual(Buffer.from(await d.readFile(await d.findPath(['DRA.BIN']))), Buffer.from(after));
    for (const c of changes) assert.deepEqual(C.repairSector(image.subarray(c.start, c.start + 2352).slice(), 24), image.subarray(c.start, c.start + 2352));
  };
  await check(work);
  apply(work, reverse); assert.equal(sha(work), initial);
  apply(work, forward); assert.equal(sha(work), final);
  apply(work, forward, true); assert.equal(sha(work), initial);
  apply(work, reverse, true); assert.equal(sha(work), final);
  const changed = new Set(changes.map(c => c.start));
  for (let off = 0; off < work.length; off += 2352) if (!changed.has(off))
    assert.deepEqual(work.subarray(off, off + 2352), original.subarray(off, off + 2352));
  apply(work, reverse); work[A.parsePpf(forward).offsets[0]] ^= 1;
  assert.throws(() => apply(work, forward));
  const paths = mode.names.map(name => path.resolve(mode.ppfDirectory ?? directory, name));
  if (process.argv.includes('--apply')) {
    // Explicit user approval is required to invoke this mode. Validate both
    // prepared files, the live full hash and all affected sectors before writes.
    assert.deepEqual(await fs.readFile(paths[0]), forward); assert.deepEqual(await fs.readFile(paths[1]), reverse);
    const live = await fs.readFile(source); assert.equal(sha(live), initial);
    apply(live, forward); assert.equal(sha(live), final); await check(live);
    const handle = await fs.open(source, 'r+');
    try {
      for (const c of changes) {
        const current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, c.start)).bytesRead, 2352);
        assert.deepEqual(current, Buffer.from(c.original));
      }
      for (const c of changes) assert.equal((await handle.write(c.modified, 0, 2352, c.start)).bytesWritten, 2352);
      await handle.sync();
    } finally { await handle.close(); }
    const saved = await fs.readFile(source); assert.equal(sha(saved), final); await check(saved);
    apply(saved, reverse); assert.equal(sha(saved), initial);
  } else {
    assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
    await fs.mkdir(path.dirname(paths[0]), {recursive: true});
    await fs.writeFile(paths[0], forward); await fs.writeFile(paths[1], reverse);
  }
  const edits = [];
  for (let n = 0; n < dra.length;) {
    if (dra[n] === after[n]) { n++; continue; }
    const start = n; while (n < dra.length && dra[n] !== after[n]) n++;
    edits.push({offset: hex(start), length: n - start});
  }
  const summary = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: paths[0], size: forward.length, sha256: sha(forward)},
    reversal: {path: paths[1], size: reverse.length, sha256: sha(reverse)},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    state: {old: hex(H.VARS), new: hex(H.LOAD_VARS), bytes: 8},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git',
      revision: child.execFileSync('git', ['-c', `safe.directory=${decomp}`, 'rev-parse', 'HEAD'], {cwd: decomp, encoding: 'utf8'}).trim()},
    edits, editor: {revision: revision(path.join(__dirname, '../..')), note: 'The working tree also had uncommitted changes.'},
    verified: [mode.cases, 'full-image forward/reversal and both undo round trips', 'changed-byte rejection',
      'sector checksums', 'unrelated bytes preserved', 'all overlay references checked'],
    applied: process.argv.includes('--apply'), gameplay: 'Fresh-boot emulator acceptance remains unverified.'
  };
  if (mode === HEARTS) {
    summary.behavior = {revive: `HP = min(max hearts, max HP), MP unchanged; with the Faerie summoned (g_Servant == ${H.FAERIE}) HP and MP are full`,
      cost: 'one Life Apple charge either way; Life Apples are not consumed and the Faerie still never uses one herself (v1 TT_002 change)'};
    summary.inspected = ['installed fresh-load v2 helper DRA 0x2E624-0x2EAA3 and all eight hooks', 'old load/init wrappers 0x2E358/0x2E368 (still reach reset_load/reset_init, unmoved)',
      'g_Status.heartsMax 0x80097BAC and g_Servant 0x8006CBC4 uses in this DRA', 'every overlay for references into the helper and state'];
    await fs.mkdir(directory, {recursive: true});
    await fs.writeFile(path.join(directory, 'verification.json'), JSON.stringify(summary, null, 2) + '\n');
  }
  console.log(JSON.stringify(summary, null, 2));
}
async function main() {
  if (process.argv.includes('--hearts')) return mainFreshLoad(HEARTS);
  if (process.argv.includes('--fresh-load')) return mainFreshLoad();
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
  const stray = await overlays(disc); assert.deepEqual(stray, [], 'Another overlay references the Life Apple helper.');
  // v1's data bytes must all be present (later mods may share its sectors, so EDC/ECC bytes are not compared);
  // TT_002's v1 hook stays as it is.
  const old = A.parsePpf(await fs.readFile(v1));
  old.offsets.forEach((off, i) => { for (let n = 0; n < old.lengths[i]; n++) {
    const at = (off + n) % 2352; if (at < 24 || at >= 24 + 2048) continue;
    assert.equal(original[off + n], old.bytes[old.data[i] + n], `v1 byte at ${off + n} differs.`);
  } });
  const after = verify(dra), changes = await C.changedSectors(disc, record, dra, after);
  const image = Buffer.from(original);
  for (const change of changes) {
    assert.deepEqual(C.repairSector(change.modified.slice(), 24), change.modified); image.set(change.modified, change.start);
  }
  const final = sha(image); assert.deepEqual(Buffer.from(await reopen(image)), Buffer.from(after));
  const block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Life Apple revive v2: flash + 5-apple HUD - ASS2');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Life Apple revive v2 - ASS 2.0');
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
    edits.push({offset: hex(start), length: n - start});
  }
  assert.equal(sha(await fs.readFile(source)), initial, 'Source changed during preparation.');
  const {labels} = H.helper(dra), editor = revision(path.join(__dirname, '../..')), decompRevision = revision(decomp);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    replaces: {path: v1, sha256: sha(await fs.readFile(v1)), note: 'v1 (2026-10-12) stays applied underneath; this patch rewrites its DRA helper in place. Its TT_002 hook (Faerie skips her own Life Apple) is unchanged.'},
    sectors: changes.map(c => c.start / 2352), records: A.parsePpf(forward).offsets.length,
    behavior: {
      charges: `min(Life Apples held, ${H.MAX}) minus revives used since the last save point, load or new game`,
      revive: {trigger: 'PlayerStepKill (both copies) once step_s > 0, when unk28 is free and a charge is left',
        flash: `full-screen additive white G4 (priority 0x1C0, under the HUD) starting ${H.FLASH} frames after death, rising 4/frame to 128 over ${H.PEAK} frames, then falling 2/frame`,
        restore: `HP = max HP, MP = max MP and entities 8-63 destroyed at the flash peak, as the Faerie's Life Apple does`,
        standUp: `unk28 released at flash frame ${H.FINISH} (about ${((H.FLASH + H.FINISH) / 60).toFixed(1)} s after death); vanilla PlayerStepUnk17 then stands Alucard up with its white blink`,
        apples: 'not consumed; Faerie Life Apple use stays disabled by v1'},
      hud: {icons: `${H.MAX} x 8x8 Life Apple (icon ${H.ICON}, palette ${H.PAL}) at x ${H.HUD.x}+${H.HUD.step}n, y ${H.HUD.y}`,
        gold: 'remaining charges', grey: 'used charges', hidden: 'beyond min(held, 5)',
        vram: `equip-icon slot ${H.HUD.gold} (texture + gold CLUT index ${hex(0x1D0 + H.HUD.gold)}), slot ${H.HUD.grey}'s CLUT (grey, index ${hex(0x1D0 + H.HUD.grey)}, rewritten if another LoadEquipIcon replaces it)`,
        fix: 'v1 stored the raw GPU CLUT 0x3F8E in prim->clut, which RenderPrimitives uses as a g_ClutIds index, so the icons drew with an unrelated palette at 16x16'}},
    inspected: ['DRA PlayerStepKill (0x801153A0, 0x80115F54), PlayerStepUnk17 (0x80115BB0), DrawHud end (0x80101A68), DrawHudSubweapon end (0x801024C0)',
      'LoadEquipIcon (0x800EB534), AllocPrimitives/AllocPrimitivesReverse/FreePrimitives, DestroyEntity, RenderPrimitives G4/GT4 paths',
      'HUD sprite tables at DRA 0x2EE8 (ASS moved the HUD up 14 px)', 'v1 helper, its hooks and RAM variables; icon-space ownership 275-319 against vanilla',
      'all LoadEquipIcon callers on the disc', 'every overlay for references into the helper and variables', 'TT_002 Faerie UpdateServantUseLifeApple / UpdateSubEntityUseLifeApple'],
    reserved: {dra: `${hex(H.CAVE)}-${hex(H.CAVE_END - 1)} (icons 294-302, full)`, vars: `${hex(H.VARS)}-${hex(H.VARS + 7)} (RAM in icon 275)`,
      entries: Object.fromEntries(Object.entries(labels).filter(([k]) => /^(check|tick|hud_init|hud_tick|draw|reset_load|reset_init|reset_save|grey)$/.test(k)).map(([k, v]) => [k, hex(v)])),
      hooks: Object.fromEntries(Object.entries(H.HOOKS).map(([k, [off]]) => [k, hex(off)])), iconSlots: [H.HUD.grey, H.HUD.gold]},
    edits,
    editor: {path: path.resolve(__dirname, '../..'), revision: editor, note: 'The working tree also had uncommitted changes when this was built.'},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: decompRevision,
      files: ['src/dra/71830.c', 'src/dra/5F60C.c', 'src/dra/4AEA4.c', 'src/dra/4DA70.c', 'src/dra/5087C.c', 'src/servant/tt_002/faerie.c', 'include/primitive.h', 'include/game.h']},
    verified: ['2,139 emulated cases with the actual patched DRA: both death checks (unk28/step_s/revive/apples/used), full revive timelines with and without a flash prim, HUD init for Alucard/Richter/ST0, HUD draw for 0-7 apples x 0-6 used (gold/grey/hidden, UVs, CLUTs, corners), grey CLUT upload and re-upload, the three recharge hooks',
      'callee-saved registers, stack and the hook delay slots preserved; R3000 load-delay and branch-delay hazards reviewed', 'v1 bytes match exactly before patching',
      'no other DRA code or overlay references the helper or its variables', 'forward/reversal and both embedded undo hash round trips', 'damaged-byte rejection', 'sector checksums',
      'unrelated DRA bytes and sectors unchanged', 'source unchanged'],
    gameplay: 'Fresh-boot emulator gameplay remains unverified.', application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.join(directory, 'README.md'), `# Life Apple revive v2: flash and 5-apple HUD

Fixes the Life Apple auto-revive added on 2026-10-12 (v1, already in the BIN). Apply this on top of v1.

**HUD.** Up to ${H.MAX} small (8x8) Life Apple icons sit under the HP/MP/hearts box. Gold apples are charges you still have; grey ones were used. They turn gold again at a save point, on load or on a new game. Holding more than ${H.MAX} apples still shows (and gives) ${H.MAX} charges. v1's icons used the wrong colour table and were 16x16, which is why they showed background colours and looked big.

**Revive.** When Alucard dies with a charge left he freezes, the screen softly glows white, HP and MP refill at the brightest point, the glow fades and he stands up with the game's white blink, about ${((H.FLASH + H.FINISH) / 60).toFixed(1)} seconds in all. Apples are not used up. The Faerie still does not use Life Apples herself (v1's change).

Source: ${source}
Size: ${original.length}
Before SHA-256: ${initial}
Expected after SHA-256: ${final}
Forward: ${names[0]}
Forward SHA-256: ${report.forward.sha256}
Reversal: ${names[1]}
Reversal SHA-256: ${report.reversal.sha256}
Editor revision: ${editor} (with uncommitted changes)
Decomp revision: ${decompRevision}

See verification.json for the exact edited ranges, sectors and checks. The source BIN is unchanged and no backup BIN was created. Both PPFs have block checks and undo bytes; the reversal restores v1 exactly.

The helper fills DRA ${report.reserved.dra} exactly (v1's space plus blank icon 302); there is no spare room there. Do not assign equipment icons 294-302 to items. During play the HUD uses equip-icon slots ${H.HUD.grey}-${H.HUD.gold}.

Apply only after explicit approval: node tools/items/build-life-apple-revive-patch.js "${directory}" --apply

Fresh-boot the patched BIN and load a memory-card save; old savestates keep earlier code. Check the apples' position and colours with 0, 1, 3 and 6+ Life Apples, die once to see the flash and an apple turn grey, then rest at a save point to see it turn gold. Gameplay remains unverified.
`);
  console.log(JSON.stringify({source: report.source, result: report.result, forward: report.forward, reversal: report.reversal,
    sectors: report.sectors, records: report.records, application: report.application}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
