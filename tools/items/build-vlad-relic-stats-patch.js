// Dracula's relics (Tooth/Rib/Ring/Eye of Vlad): set the stat each one gives (vanilla +10 each).
// UpdateEquipStatBonuses (DRA, src/dra/menu.c) adds a hardcoded amount to g_Status.statsEquip[stat] for each active relic
// (`addiu v0, v0, n`); only those immediates change. The patch is built against the live BIN, reading the amounts it
// holds now, and changes only the ones that differ from TARGET. Heart of Vlad grants curse immunity, not a stat.
// The installed BIN already skips the vanilla 99 cap on statsEquip, and the vanilla totals still apply
// (CON total = base + equip * 8, INT total = base + equip * 4).
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

const STAT = ['STR', 'CON', 'INT', 'LCK'];
const TARGET = {STR: 50, CON: 5, INT: 50, LCK: 50};
const stem = `Vlad-Relics-${STAT.map(s => s + TARGET[s]).join('-')}-ASS-2.0`;
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

const BASE = 0x800A0000;
const STATUS = {relics: 0x80097964, base: 0x80097BB8, equip: 0x80097BC8, total: 0x80097BD8};
// Relic id (g_Status.relics index) -> stat, and the address of its `addiu v0, v0, n`.
const RELICS = [
  {name: 'Rib of Vlad', id: 27, stat: 1, add: 0x800F4BA8},
  {name: 'Eye of Vlad', id: 29, stat: 3, add: 0x800F4BD8},
  {name: 'Tooth of Vlad', id: 26, stat: 0, add: 0x800F4C08},
  {name: 'Ring of Vlad', id: 28, stat: 2, add: 0x800F4C38}
];
const addiu = n => 0x24420000 | n; // addiu v0, v0, n
// Vanilla relic block 0x800F4B80-0x800F4C43 (guarded word for word, except the four amounts).
const BLOCK_AT = 0x800F4B80;
const BLOCK = [
  0x3C108009, 0x2610797F, 0x92020000, 0, 0x30420002, 0x10400007, 0, 0x3C028009, 0x8C427BCC, 0, addiu(0), 0x3C018009, 0xAC227BCC,
  0x3C028009, 0x90427981, 0, 0x30420002, 0x10400007, 0, 0x3C028009, 0x8C427BD4, 0, addiu(0), 0x3C018009, 0xAC227BD4,
  0x3C028009, 0x9042797E, 0, 0x30420002, 0x10400007, 0, 0x3C028009, 0x8C427BC8, 0, addiu(0), 0x3C018009, 0xAC227BC8,
  0x3C028009, 0x90427980, 0, 0x30420002, 0x10400007, 0, 0x3C028009, 0x8C427BD0, 0, addiu(0), 0x3C018009, 0xAC227BD0
];
// Code after the block that decides the final result (guarded): IsAlucart +30 LCK, the installed cap bypass, CON*8/INT*4 totals.
const GUARDS = [
  [0x800F4C44, [0x0C03D251, 0, 0x10400007, 0x00003021, 0x3C028009, 0x8C427BD4, 0, 0x2442001E, 0x3C018009, 0xAC227BD4]],
  [0x800F4C6C, [0x34080063, 0x26070259, 0x26040249, 0x26050239, 0x8C820000, 0, 0x28420064, 0x10000002, 0x24C60001, 0xAC880000]],
  [0x800F4CC8, [0x3C028009, 0x8C427BCC, 0x3C038009, 0x8C637BBC, 0x000210C0, 0x00431021, 0xAC820000]],
  [0x800F4CE4, [0x3C028009, 0x8C427BD0, 0x3C038009, 0x8C637BC0, 0x00021080, 0x00431021, 0x3C018009, 0xAC227BE0]],
  [0x800F4D24, [0x8FBF0014, 0x8FB00010, 0x27BD0018, 0x08038BA6, 0]]
];
const IS_ALUCART = 0x800F4944, TAIL = 0x800F4D30;

const words = (dra, at, n) => Array.from({length: n}, (_, i) => K.u32(dra, at - BASE + i * 4) >>> 0);
const isAdd = at => RELICS.some(r => r.add === at);
// Current amount per relic (in RELICS order).
const amounts = dra => RELICS.map(r => {
  const w = K.u32(dra, r.add - BASE) >>> 0;
  assert.equal(w & 0xFFFF8000, 0x24420000, `${r.name} amount is not addiu v0, v0, n`);
  return w & 0x7FFF;
});

function guard(dra) {
  words(dra, BLOCK_AT, BLOCK.length).forEach((w, i) => {
    const at = BLOCK_AT + i * 4;
    assert.equal(isAdd(at) ? w & 0xFFFF8000 : w, BLOCK[i] >>> 0, `Vlad relic block changed at ${at.toString(16)}`);
  });
  for (const [at, list] of GUARDS) assert.deepEqual(words(dra, at, list.length), list.map(w => w >>> 0), `Guarded code at ${at.toString(16)}`);
  RELICS.forEach((r, i) => assert.equal(STATUS.relics + r.id, [0x8009797F, 0x80097981, 0x8009797E, 0x80097980][i], r.name));
  for (const s of STAT) assert.ok(Number.isInteger(TARGET[s]) && TARGET[s] >= 0 && TARGET[s] <= 0x7FFF, `TARGET.${s}`);
}

function prepare(files) {
  const dra = files.get('DRA.BIN'), after = Uint8Array.from(dra);
  guard(dra);
  const now = amounts(dra);
  RELICS.forEach((r, i) => { if (now[i] !== TARGET[STAT[r.stat]]) K.put32(after, r.add - BASE, addiu(TARGET[STAT[r.stat]])); });
  assert.notDeepEqual(amounts(after), now, 'BIN already has the target amounts');
  return new Map([['DRA.BIN', after]]);
}

// Runs the real DRA from the relic block to the tail call (IsAlucart stubbed), returning statsEquip/statsTotal.
function stats(dra, {flags, base, equip, alucart = 0}) {
  const cpu = machine([{base: BASE, bytes: dra}]);
  cpu.hooks.set(IS_ALUCART, r => { r[2] = alucart; });
  cpu.hooks.set(TAIL, () => 'stop');
  RELICS.forEach((r, i) => cpu.put(STATUS.relics + r.id, 1, flags[i]));
  for (let i = 0; i < 4; i++) cpu.put(STATUS.base + i * 4, 4, base[i]), cpu.put(STATUS.equip + i * 4, 4, equip[i]);
  cpu.run(BLOCK_AT, {29: 0x801FEFE0});
  const read = at => [0, 1, 2, 3].map(i => cpu.get(at + i * 4, 4) | 0);
  return {equip: read(STATUS.equip), total: read(STATUS.total)};
}

function verify(files, after) {
  const before = files.get('DRA.BIN'), dra = after.get('DRA.BIN');
  const was = amounts(before), now = amounts(dra);
  RELICS.forEach((r, i) => assert.equal(now[i], TARGET[STAT[r.stat]], r.name));
  const allowed = new Set();
  RELICS.forEach((r, i) => { if (was[i] !== now[i]) for (let b = 0; b < 4; b++) allowed.add(r.add - BASE + b); });
  for (let i = 0; i < before.length; i++) if (before[i] !== dra[i]) assert.ok(allowed.has(i), `unexpected DRA change at 0x${i.toString(16)}`);
  let cases = 0, sample = null;
  // Active/inactive per relic (3 = owned+active, 1 = owned/off), plus each relic alone active without the owned bit.
  const combos = [];
  for (let m = 0; m < 16; m++) combos.push(RELICS.map((_, i) => m >> i & 1 ? 3 : 1));
  for (let i = 0; i < 4; i++) combos.push(RELICS.map((_, j) => j === i ? 2 : 0));
  for (const flags of combos) for (const alucart of [0, 1]) for (const [base, equip] of [[[10, 10, 10, 10], [0, 0, 0, 0]], [[55, 40, 30, 70], [95, 60, -5, 99]]]) {
    const expect = amount => {
      const e = equip.map((v, i) => v + (alucart && i === 3 ? 30 : 0));
      RELICS.forEach((r, i) => { if (flags[i] & 2) e[r.stat] += amount[i]; });
      return {equip: e, total: [base[0] + e[0], base[1] + e[1] * 8, base[2] + e[2] * 4, base[3] + e[3]].map(v => Math.max(v, 0))};
    };
    const patched = stats(dra, {flags, base, equip, alucart}), baseline = stats(before, {flags, base, equip, alucart});
    assert.deepEqual(patched, expect(now), `patched flags ${flags} alucart ${alucart}`);
    assert.deepEqual(baseline, expect(was), `baseline flags ${flags} alucart ${alucart}`);
    if (!sample && alucart === 0 && base[0] === 10 && flags.every(f => f === 3)) sample = {flags, before: baseline, after: patched};
    cases += 2;
  }
  return {cases, amountsBefore: Object.fromEntries(RELICS.map((r, i) => [r.name, was[i]])), amountsAfter: Object.fromEntries(RELICS.map((r, i) => [r.name, now[i]])), allFourActiveFromZero: sample};
}

function checksums(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
}

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image])), record = await disc.findPath(['DRA.BIN']);
  return {disc, files: new Map([['DRA.BIN', await disc.readFile(record)]]), records: new Map([['DRA.BIN', record]])};
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
    const reread = await inspect(live); verify(new Map([['DRA.BIN', (await inspect(original)).files.get('DRA.BIN')]]), reread.files);
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
  const label = STAT.map(s => `${s}+${TARGET[s]}`).join(' ');
  const forward = ppf(changes, block, `Vlad relics ${label}`);
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, `Reverse Vlad relics ${label}`);
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
  const was = amounts(files.get('DRA.BIN')), edits = RELICS.map((r, i) => ({relic: r.name, flag: hex(STATUS.relics + r.id), stat: STAT[r.stat], ram: hex(r.add),
    before: hex(addiu(was[i])), after: hex(addiu(TARGET[STAT[r.stat]])), changed: was[i] !== TARGET[STAT[r.stat]]}));
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: {
      file: 'DRA.BIN', function: 'UpdateEquipStatBonuses', target: TARGET, relics: edits,
      untouched: 'Heart of Vlad (curse immunity in UpdatePlayerStats, no stat bonus)',
      effect: `statsEquip per active relic: ${label} (status screen shows these); internal CON total = base + equip * 8 (+${TARGET.CON * 8}), INT total = base + equip * 4 (+${TARGET.INT * 4}). The BIN's existing cap bypass at 0x800F4C88 leaves statsEquip uncapped.`
    },
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'),
      files: ['src/dra/menu.c (UpdateEquipStatBonuses, UpdatePlayerStats)', 'include/game.h (RELIC_*_OF_VLAD, STAT_*)'],
      localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['relic block guarded word for word (amounts read from the live BIN)', 'IsAlucart bonus, cap bypass, CON*8/INT*4 totals and tail call guarded',
      'real DRA run from the relic block to the tail call for 20 relic flag sets x Alucart on/off x 2 stat sets: patched and baseline amounts, inactive/owned-only relics add nothing, totals match',
      'only the changed amount words change', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. DRA loads at boot; old savestates keep the old code. Stats refresh when the game next recalculates them (e.g. opening the menu).',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const relicName = s => RELICS.find(r => STAT[r.stat] === s).name;
  await fs.writeFile(path.resolve(directory, names[3]), `# Vlad relics: ${label}

The original BIN is unchanged until this PPF is applied.

Each active Dracula relic adds this to its stat bonus (vanilla +10 each): ${STAT.map(s => `${relicName(s)} ${s} +${TARGET[s]}`).join(', ')}. Heart of Vlad gives curse immunity, not a stat, so it is unchanged.

Built against the current BIN, whose amounts were: ${edits.map(e => `${e.relic} +${was[RELICS.findIndex(r => r.name === e.relic)]}`).join(', ')}. Changed: ${edits.filter(e => e.changed).map(e => `${e.relic} (${e.ram}) ${e.before} -> ${e.after}`).join('; ')}.

The status screen shows these bonuses as is. Internally the game still converts them as it always has: the CON total used for defense/damage is base + bonus x 8 and the INT total is base + bonus x 4, so Rib of Vlad feeds ${TARGET.CON * 8} CON and Ring of Vlad ${TARGET.INT * 4} INT into those formulas (vanilla 80 and 40). This BIN already skips the vanilla 99 cap on equipment bonuses, so the bonuses are not clamped.

Code: DRA UpdateEquipStatBonuses, \`addiu v0, v0, n\` at ${RELICS.map(r => hex(r.add)).join(', ')}. Changed sectors: ${sectors.join(', ')}.

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

Both PPFs carry undo data and block checks. No backup BIN is created. Undo patches in reverse order of installation.

After explicit approval: node tools/items/build-vlad-relic-stats-patch.js "${path.resolve(directory)}" --apply

Boot afresh; old savestates keep the loaded code.
`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {prepare, verify, guard, RELICS, TARGET};
