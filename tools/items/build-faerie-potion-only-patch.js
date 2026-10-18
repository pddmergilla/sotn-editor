// The Faerie heals only with Potions, never High Potions.
// SERVANT/TT_002.BIN (decomp src/servant/tt_002/faerie.c):
// - g_PotionItemsParamMap {ITEM_POTION, 16, ITEM_HIGH_POTION, 17} at 0x801724C4: the second entry (used when the HP loss
//   asks for the big heal, params 1) becomes {ITEM_POTION, 16}, so both heal sizes check for and play the Potion effect.
// - CheckForValidAbility's stock check `equipHandCount[POTION] | equipHandCount[HIGH_POTION]` at 0x80174570 reads the
//   Potion count twice, so High Potions alone no longer start a heal attempt (she shows the vanilla no-potion reaction once).
// The on-hit buff path (params >= 2) never reads the table and is unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), K = require('../../stats-core.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const {machine} = require('../../tests/helpers/mips.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Faerie-Potion-Only-ASS-2.0';
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

const FILE = 'SERVANT/TT_002.BIN', BASE = 0x80170000;
const POTION = 0x9F, HIGH_POTION = 0xA0, COUNTS = 0x8009798A;
const MAP = 0x801724C4, CHECK = 0x80174570;
const EDITS = [
  {ram: MAP + 4, before: [HIGH_POTION, 0, 17, 0], after: [POTION, 0, 16, 0], what: 'g_PotionItemsParamMap[1]: {HIGH_POTION, 17} -> {POTION, 16}'},
  {ram: CHECK, before: [0x2A, 0x7A, 0x63, 0x90], after: [0x29, 0x7A, 0x63, 0x90], what: 'CheckForValidAbility: lbu v1,equipHandCount[HIGH_POTION] -> lbu v1,equipHandCount[POTION]'}
];
// Code this relies on (guarded, all vanilla in this BIN).
const GUARDS = [
  [MAP, [0x0010009F]], // map[0] = {POTION, 16}
  [0x80174564, [0x3C028009, 0x90427A29, 0x3C038009]], // lui v0; lbu v0,count[POTION]; lui v1
  [0x80174574, [0, 0x00431025, 0x10400039, 0, 0x0C005839]], // or; beqz no-potion branch; jal rand
  [0x80176304, [0, 0x00031080, 0x3C018017, 0x00220821, 0x842224C4, 0x3C018009, 0x00220821, 0x9022798A, 0x3C048017, 0x248424C4, 0x14400012, 0x2C620001,
    0xA6020030, 0x96020030, 0, 0x00021080, 0x00441021, 0x84420000, 0x3C018009, 0x00220821, 0x9022798A, 0, 0x14400007]], // UsePotion step 2
  [0x801763E8, [0x00021080, 0x3C018017, 0x00220821, 0x842324C4]] // step 3 item index
];
const word = (tt, at) => K.u32(tt, at - BASE) >>> 0;

function guard(tt) {
  for (const e of EDITS) assert.deepEqual([...tt.subarray(e.ram - BASE, e.ram - BASE + 4)], e.before, `Unexpected bytes at ${e.ram.toString(16)} (${e.what})`);
  for (const [at, list] of GUARDS) list.forEach((w, i) => assert.equal(word(tt, at + i * 4), w >>> 0, `Guarded word at ${(at + i * 4).toString(16)}`));
  // Step 3 effect lookup: lh a1, 0x24C6(at).
  assert.equal(word(tt, 0x8017642C), 0x842524C6, 'Step 3 effect lookup');
  // Hooks installed by the Faerie Behavior hack (present in this BIN) stay outside the edited bytes.
  assert.equal(word(tt, 0x80176300) >>> 26, 2, 'Faerie Behavior step-2 hook (j 0x800E29E4) missing');
  assert.equal(word(tt, 0x80176414), 0, 'Faerie Behavior free-potion nop missing');
  // Only the three known readers touch the table.
  const refs = [];
  for (let p = 0; p < tt.length - 3; p += 4) { const lo = K.u32(tt, p) & 0xFFFF; if (lo >= 0x24C4 && lo < 0x24CC && (K.u32(tt, p) >>> 26) !== 0) refs.push(BASE + p); }
  assert.deepEqual(refs, [0x80176314, 0x80176328, 0x801763F4, 0x8017642C], 'Unexpected references to g_PotionItemsParamMap');
}

function prepare(files) {
  const tt = files.get(FILE), after = Uint8Array.from(tt);
  guard(tt);
  for (const e of EDITS) after.set(e.after, e.ram - BASE);
  return new Map([[FILE, after]]);
}

// CheckForValidAbility stock check: 0x80174564 -> 0x80174584 (has potions, rolls healChance) or 0x80174664 (none).
function stock(tt, potion, high) {
  const cpu = machine([{base: BASE, bytes: tt}]);
  let out = null;
  cpu.hooks.set(0x80174584, () => { out = true; return 'stop'; });
  cpu.hooks.set(0x80174664, () => { out = false; return 'stop'; });
  cpu.put(COUNTS + POTION, 1, potion); cpu.put(COUNTS + HIGH_POTION, 1, high);
  cpu.run(0x80174564);
  assert.notEqual(out, null);
  return out;
}

// UsePotion step 2 from 0x80176308 (v1 = params) -> 0x80176378/0x8017637C (item found) or 0x80176364 (no-medicine),
// then the item and effect step 3 would use (map[params*2], map[params*2+1]).
function choose(tt, potion, high, params) {
  const cpu = machine([{base: BASE, bytes: tt}]), self = 0x800733D8;
  let found = null;
  cpu.hooks.set(0x80176378, () => { found = true; return 'stop'; });
  cpu.hooks.set(0x8017637C, () => { found = true; return 'stop'; }); // after the swap (delay slot already set a0)
  cpu.hooks.set(0x80176364, () => { found = false; return 'stop'; });
  cpu.put(COUNTS + POTION, 1, potion); cpu.put(COUNTS + HIGH_POTION, 1, high); cpu.put(self + 0x30, 2, params);
  cpu.run(0x80176308, {3: params, 16: self});
  assert.notEqual(found, null);
  const p = cpu.get(self + 0x30, 2);
  return {found, item: found ? cpu.get(MAP + p * 4, 2) : null, effect: found ? cpu.get(MAP + p * 4 + 2, 2) : null};
}

function verify(files, after) {
  const before = files.get(FILE), tt = after.get(FILE);
  const allowed = new Set(EDITS.flatMap(e => [0, 1, 2, 3].map(i => e.ram - BASE + i)));
  for (let i = 0; i < before.length; i++) if (before[i] !== tt[i]) assert.ok(allowed.has(i), `unexpected TT_002 change at 0x${i.toString(16)}`);
  let cases = 0, baselineHigh = 0;
  for (const potion of [0, 1, 9]) for (const high of [0, 1, 9]) {
    assert.equal(stock(before, potion, high), Boolean(potion || high), 'baseline stock check');
    assert.equal(stock(tt, potion, high), Boolean(potion), `stock check P${potion} H${high}`);
    cases += 2;
    for (const params of [0, 1]) {
      const old = choose(before, potion, high, params), now = choose(tt, potion, high, params);
      if (old.item === HIGH_POTION) baselineHigh++;
      assert.equal(now.found, Boolean(potion), `step 2 P${potion} H${high} p${params}`);
      if (now.found) assert.deepEqual([now.item, now.effect], [POTION, 16], `uses Potion P${potion} H${high} p${params}`);
      cases += 2;
    }
  }
  assert.ok(baselineHigh > 0, 'baseline model picks High Potion somewhere');
  return {cases, baselineHighPotionUses: baselineHigh};
}

function checksums(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
}

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image])), record = await disc.findPath(FILE.split('/'));
  return {disc, files: new Map([[FILE, await disc.readFile(record)]]), records: new Map([[FILE, record]])};
}

async function main() {
  assert.ok(directory, 'Supply an output directory.');
  const reportPath = path.resolve(directory, names[2]);
  if (process.argv.includes('--apply')) {
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(path.resolve(source), path.resolve(report.source.path));
    const original = await fs.readFile(source); assert.equal(sha(original), report.source.sha256, 'Source changed; rebuild the patch pair.');
    const forward = await fs.readFile(report.forward.path), reverse = await fs.readFile(report.reversal.path);
    assert.equal(sha(forward), report.forward.sha256); assert.equal(sha(reverse), report.reversal.sha256);
    const image = Buffer.from(original); apply(image, forward); assert.equal(sha(image), report.result.sha256);
    checksums(image, report.sectors);
    apply(image, reverse); assert.equal(sha(image), report.source.sha256);
    apply(image, reverse, true); assert.equal(sha(image), report.result.sha256);
    const handle = await fs.open(source, 'r+');
    try {
      for (const sector of report.sectors) {
        const start = sector * 2352, current = Buffer.alloc(2352);
        assert.equal((await handle.read(current, 0, 2352, start)).bytesRead, 2352);
        assert.deepEqual(current, original.subarray(start, start + 2352));
      }
      for (const sector of report.sectors) {
        const start = sector * 2352;
        assert.equal((await handle.write(image.subarray(start, start + 2352), 0, 2352, start)).bytesWritten, 2352);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const live = await fs.readFile(source); assert.equal(sha(live), report.result.sha256); checksums(live, report.sectors);
    const reread = await inspect(live); verify(new Map([[FILE, (await inspect(original)).files.get(FILE)]]), reread.files);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, files, records} = await inspect(original), after = prepare(files), validation = verify(files, after);
  const changes = [];
  for (const [file, bytes] of after) changes.push(...await C.changedSectors(disc, records.get(file), files.get(file), bytes));
  const sectors = changes.map(c => c.start / 2352).sort((a, b) => a - b);
  const image = Buffer.from(original); changes.forEach(c => image.set(c.modified, c.start)); checksums(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Faerie heals with Potions only');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse Faerie Potions only');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await inspect(image);
  for (const [file, bytes] of reopened.files) assert.deepEqual(bytes, after.get(file), file);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < image.length; at += 2352) if (!changed.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial);
  const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const bytesHex = b => Buffer.from(b).toString('hex');
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: EDITS.map(e => ({file: FILE, offset: '0x' + (e.ram - BASE).toString(16).toUpperCase(), ram: hex(e.ram), before: bytesHex(e.before), after: bytesHex(e.after), what: e.what})),
    vanilla: 'Both edited words are identical to vanilla US in this BIN; no existing mod owns them. The Faerie Behavior hooks in TT_002 (0x6300, 0x63C4, 0x63E0, 0x6414, 0x3E64, ...) are untouched and guarded.',
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'),
      files: ['src/servant/tt_002/faerie.c (g_PotionItemsParamMap, CheckForValidAbility, UpdateServantUsePotion)', 'include/items.h (ITEM_POTION 0x9F, ITEM_HIGH_POTION 0xA0)'],
      localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['edited bytes and surrounding vanilla code guarded', 'Faerie Behavior hooks present and untouched', 'only the four known table readers exist',
      'stock check run on the real patched TT_002 for Potion/High Potion counts 0/1/9: starts only with Potions; baseline starts with either',
      'UsePotion step 2 run for params 0/1 x counts: always picks ITEM_POTION + effect 16 when Potions exist, no-medicine otherwise; baseline picks High Potion',
      'only the 8 edited bytes change', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. TT_002 loads when the Faerie is summoned; resummon or reload after applying.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Faerie heals with Potions only

The original BIN is unchanged until this PPF is applied.

The Faerie no longer uses High Potions. Both of her heal sizes (the small heal and the big heal she picks after heavy damage or at low HP) now check for and play the Potion (pink effect 16). High Potions in the inventory are ignored. With no Potions she shows the vanilla no-potion reaction once, as she does with no potions at all. Her on-hit buffs and her Hammer/Uncurse/Antivenom are unchanged. The installed Faerie Behavior hack still keeps the Potion: she needs one in the inventory, but it is not used up.

Edits (${FILE}, sectors ${sectors.join(', ')}):
${report.edits.map(e => `- ${e.offset} (${e.ram}): ${e.before} -> ${e.after}. ${e.what}`).join('\n')}

Source: ${source}
Before SHA-256: ${initial}
Expected after SHA-256: ${final}
Forward: ${report.forward.path}
Forward SHA-256: ${report.forward.sha256}
Reversal: ${report.reversal.path}
Reversal SHA-256: ${report.reversal.sha256}

Decomp revision: ${report.decomp.revision}
Editor revision: ${report.editor.revision}
See ${names[2]} for checks.

Both PPFs carry undo data and block checks. No backup BIN is created. These sectors also hold Faerie Behavior bytes; remove this patch with its reversal before reversing any other Faerie patch.

After explicit approval: node tools/items/build-faerie-potion-only-patch.js "${path.resolve(directory)}" --apply

Resummon the Faerie or boot afresh; old savestates keep the loaded code.
`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {prepare, verify, guard, EDITS};
