// Skeleton/undead enemies resist Dark; ghost/demon enemies are immune to Dark.
// Only g_EnemyDefs element masks in DRA.BIN change (weak +0x0E, resist +0x10, immune +0x12, absorb +0x14).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), K = require('../../stats-core.js');
const M = require('../../stats-model.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || 'D:/AAA/GitHub/sotn-editor/MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin';
const directory = process.argv[2];
const stem = 'Dark-Resist-Undead-Immune-Ghosts-ASS-2.0';
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

const DARK = 0x800, STRIDE = 0x28, DRA_BASE = 0x800A0000, API_ENEMY = 0x8003C808 - 0x8003C770;
const WEAK = 0x0E, RESIST = 0x10, IMMUNE = 0x12, ABSORB = 0x14;
// [g_EnemyDefs index, in-game name]. Names are checked against the BIN before anything changes.
const UNDEAD = [
  [11, 'Skelerang'], [13, 'Bloody Zombie'], [14, 'Flying Zombie'], [15, 'Flying Zombie'], [43, 'White Dragon'],
  [45, 'Bone Ark'], [46, 'Bone Ark'], [61, 'Wereskeleton'], [68, 'Flail Guard'], [70, 'Blood Skeleton'],
  [75, 'Skeleton'], [81, 'Spittle Bone'], [83, 'Skeleton Ape'], [90, 'Bone Pillar'], [102, 'Bone Musket'],
  [105, 'Bone Scimitar'], [108, 'Bone Archer'], [110, 'Zombie'], [116, "Jack O'Bones"], [118, 'Bone Halberd'],
  [120, 'Yorick'], [121, 'Skull'], [122, 'Blade Master'], [124, 'Blade Soldier'], [126, 'Nova Skeleton'],
  [128, 'Winged Guard'], [141, 'Orobourous'], [144, 'Dragon Rider'], [146, 'Dhuron'], [178, 'Slinger'],
  [183, 'Bone Pillar'], [211, 'Paranthropus'], [267, 'Akmodan II'], [328, 'Fake Trevor'], [334, 'Fake Grant'],
  [337, 'Fake Sypha'], [356, 'Death'], [361, 'Death']
];
const GHOSTS = [
  [23, 'Lesser Demon'], [67, 'Phantom Skull'], [79, 'Fire Demon'], [88, 'Ectoplasm'], [99, 'Frozen Shade'],
  [129, 'Spectral Sword'], [130, 'Poltergeist'], [136, 'Spectral Sword'], [137, 'Puppet Sword'], [138, 'Spectral Sword'],
  [139, 'Spear'], [140, 'Shield'], [156, 'Ghost'], [172, 'Greater Demon'], [216, 'Ghost Dancer'], [225, 'Gremlin'],
  [233, 'Ctulhu'], [243, 'Slogra'], [254, 'Gaibon'], [261, 'Skull Lord'], [284, 'Imp'], [324, 'Beezelbub'], [342, 'Succubus']
];
// The installed ASS DealDamage strength/weakness hook: strength halves damage, then weakness adds half.
const DEAL_DAMAGE = 0x800FF128, HOOK_AT = 0x800FF248, HOOK = 0x800CE300;
const HOOK_WORDS = [0x3C08800D, 0xA100E3A0, 0x96820010, 0, 0x00A21024, 0x00621024, 0x14820005, 0, 0x00139842, 0x34080002,
  0x3C09800D, 0xA128E3A0, 0x9682000E, 0, 0x00C21024, 0x10400005, 0x00134042, 0x02689821, 0x34080001, 0x3C09800D,
  0xA128E3A0, 0x0803FC9F];
// Immune and absorb checks before the hook (vanilla order).
const IMMUNE_WORDS = [0x96820012, 0x00C51824, 0x00602021, 0x00A21024, 0x00621024, 0x14820003, 0, 0x0803FD0E, 0x3411C000,
  0x96820014, 0, 0x00A21024, 0x00621024, 0x14820003, 0x34028000, 0x0803FD0E, 0x02628821, 0x080338C0];

async function inspect(image) {
  const disc = await C.DiscImage.open(new Blob([image])), record = await disc.findPath(['DRA.BIN']);
  return {disc, files: new Map([['DRA.BIN', await disc.readFile(record)]]), records: new Map([['DRA.BIN', record]])};
}

function table(dra) {
  assert.equal(K.u32(dra, 0x8003C828 - 0x8003C770), DEAL_DAMAGE, 'g_api.DealDamage moved');
  const words = (at, n) => Array.from({length: n}, (_, i) => K.u32(dra, at - DRA_BASE + i * 4));
  assert.deepEqual(words(0x800FF204, IMMUNE_WORDS.length), IMMUNE_WORDS, 'DealDamage immune/absorb/strength code changed');
  assert.deepEqual(words(HOOK, HOOK_WORDS.length), HOOK_WORDS, 'ASS strength/weakness hook changed');
  assert.equal(K.u32(dra, HOOK_AT - DRA_BASE), 0x080338C0);
  return K.u32(dra, API_ENEMY) - DRA_BASE;
}

function enemyName(dra, at) { return K.decodeFont(dra, K.u32(dra, at) - DRA_BASE)?.text.trim(); }

// Undead: resist Dark, drop any Dark weakness (it would add half back); keep an existing Dark immunity or absorb.
// Ghosts/demons: immune to Dark (checked first by DealDamage); clear Dark from the other three masks.
function prepare(files) {
  const dra = files.get('DRA.BIN'), after = Uint8Array.from(dra), base = table(dra), rows = [];
  const edit = (list, group) => {
    for (const [index, name] of list) {
      const at = base + index * STRIDE;
      assert.equal(enemyName(dra, at), name, `enemy #${index}`);
      const read = bytes => ({weak: K.u16(bytes, at + WEAK), resist: K.u16(bytes, at + RESIST), immune: K.u16(bytes, at + IMMUNE), absorb: K.u16(bytes, at + ABSORB)});
      const before = read(dra), next = {...before};
      if (group === 'undead') {
        next.weak &= ~DARK;
        if (!((before.immune | before.absorb) & DARK)) next.resist |= DARK;
      } else {
        next.weak &= ~DARK; next.resist &= ~DARK; next.absorb &= ~DARK; next.immune |= DARK;
      }
      K.put16(after, at + WEAK, next.weak); K.put16(after, at + RESIST, next.resist);
      K.put16(after, at + IMMUNE, next.immune); K.put16(after, at + ABSORB, next.absorb);
      rows.push({index, name, group, dra: '0x' + (at + WEAK).toString(16).toUpperCase(), before, after: read(after),
        changed: JSON.stringify(before) !== JSON.stringify(read(after))});
    }
  };
  edit(UNDEAD, 'undead'); edit(GHOSTS, 'ghost');
  assert.equal(new Set(rows.map(r => r.index)).size, rows.length);
  return {after: new Map([['DRA.BIN', after]]), rows};
}

// Damage model of the installed DealDamage up to the defense step (no crit): returns 'immune', 'absorb' or a multiplier.
function outcome(m, element) {
  const mask = element & 0xFF80 ? 0xFF80 : 0x7F, e = element & mask;
  if ((e & m.immune & mask) === e) return 'immune';
  if ((e & m.absorb & mask) === e) return 'absorb';
  let d = 1000;
  if ((e & m.resist & mask) === e) d >>>= 1;
  if (element & m.weak) d += d >>> 1;
  return d / 1000;
}

function verify(files, after, rows) {
  const dra = files.get('DRA.BIN'), next = after.get('DRA.BIN'), base = table(dra), allowed = new Set();
  for (const r of rows) for (let i = 0; i < 8; i++) allowed.add(base + r.index * STRIDE + WEAK + i);
  for (let i = 0; i < dra.length; i++) if (dra[i] !== next[i]) assert.ok(allowed.has(i), `unexpected DRA change at 0x${i.toString(16)}`);
  let cases = 0;
  for (const r of rows) {
    for (const element of [DARK, DARK | 0x40, DARK | 0x20]) {
      const got = outcome(r.after, element);
      if (r.group === 'ghost') assert.equal(got, 'immune', `${r.name} #${r.index}`);
      else if ((r.before.immune & DARK)) assert.equal(got, 'immune', `${r.name} #${r.index}`);
      else if ((r.before.absorb & DARK)) assert.equal(got, 'absorb', `${r.name} #${r.index}`);
      // A Hit/Cut weakness still adds half to a mixed Dark+Hit/Cut hit; Dark itself never does.
      else assert.equal(got, element & r.after.weak ? 0.75 : 0.5, `${r.name} #${r.index}`);
      assert.equal(r.after.weak & DARK, 0);
      cases++;
    }
    // Non-Dark elements are unaffected.
    for (const element of [0x20, 0x40, 0x1000, 0x8000, 0x2000, 0x4000]) { assert.deepEqual(outcome(r.after, element), outcome(r.before, element)); cases++; }
  }
  return {cases, changedRows: rows.filter(r => r.changed).length};
}

function checksums(image, sectors) {
  for (const sector of sectors) {
    const bytes = image.subarray(sector * 2352, (sector + 1) * 2352);
    assert.deepEqual(C.repairSector(bytes.slice(), 24), bytes);
  }
}

async function editorView(image, rows) {
  const disc = await C.DiscImage.open(new Blob([image])), model = await M.loadFromDisc(disc, C.normalizeIsoName);
  for (const r of rows) {
    const e = model.sections.enemies.find(x => x.index === r.index);
    assert.ok(e, `editor enemy #${r.index}`);
    assert.deepEqual([model.get(e.weak), model.get(e.resist), model.get(e.immune), model.get(e.absorb)],
      [r.after.weak, r.after.resist, r.after.immune, r.after.absorb], `editor view #${r.index}`);
  }
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
    await editorView(live, report.rows);
    apply(live, reverse); assert.equal(sha(live), report.source.sha256);
    report.application = {applied: true, liveSha256: report.result.sha256, reversalVerified: true};
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.application)); return;
  }
  const original = await fs.readFile(source), initial = sha(original);
  const {disc, files, records} = await inspect(original), {after, rows} = prepare(files), validation = verify(files, after, rows);
  const changes = [];
  for (const [file, bytes] of after) changes.push(...await C.changedSectors(disc, records.get(file), files.get(file), bytes));
  const sectors = changes.map(c => c.start / 2352).sort((a, b) => a - b);
  assert.equal(new Set(sectors).size, sectors.length);
  const image = Buffer.from(original); changes.forEach(c => image.set(c.modified, c.start)); checksums(image, sectors);
  const final = sha(image), block = original.subarray(0x9320, 0x9720);
  const forward = ppf(changes, block, 'Undead resist Dark, ghosts/demons immune to Dark');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Restore enemy Dark element masks');
  apply(image, reverse); assert.equal(sha(image), initial);
  apply(image, forward); assert.equal(sha(image), final);
  apply(image, forward, true); assert.equal(sha(image), initial);
  apply(image, reverse, true); assert.equal(sha(image), final);
  const reopened = await inspect(image);
  for (const [file, bytes] of reopened.files) assert.deepEqual(bytes, after.get(file) || files.get(file), file);
  await editorView(image, rows);
  const changed = new Set(changes.map(c => c.start));
  for (let at = 0; at < image.length; at += 2352) if (!changed.has(at)) assert.deepEqual(image.subarray(at, at + 2352), original.subarray(at, at + 2352));
  apply(image, reverse); image[A.parsePpf(forward).offsets[0]] ^= 1; assert.throws(() => apply(image, forward));
  assert.equal(sha(await fs.readFile(source)), initial);
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: {files: ['DRA.BIN'], table: `g_EnemyDefs at DRA 0x${table(files.get('DRA.BIN')).toString(16).toUpperCase()} (stride 0x28)`,
      rules: {undead: 'resist |= Dark; weak &= ~Dark; existing Dark immune/absorb kept', ghost: 'immune |= Dark; weak/resist/absorb &= ~Dark'},
      damage: 'Installed ASS DealDamage: immune (all attack elements in mask) returns 0 first; absorb next; resist halves; any weakness then adds half (hook at 0x800CE300). Dark+Hit/Cut attacks count as Dark; Dark mixed with another non-physical element is only stopped if that element is also covered.'},
    rows,
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'), files: ['include/game.h (EnemyDef, ELEMENT_DARK)', 'src/dra/5D5BC.c (DealDamage)', 'config/symbols.us.txt (g_api_DealDamage)'], localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['enemy names at every edited index', 'DealDamage immune/absorb code and ASS strength/weakness hook bytes guarded', 'Dark, Dark+Hit, Dark+Cut outcomes per edited enemy under the installed damage model', 'non-Dark outcomes unchanged', 'only element-mask bytes of listed rows change', 'Stats Editor reads the new masks', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. DRA loads at boot; old savestates keep the old table.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  const line = r => `- #${r.index} ${r.name}${r.changed ? '' : ' (already; unchanged)'}`;
  await fs.writeFile(path.resolve(directory, names[3]), `# Dark: undead resist, ghosts and demons immune\n\nThe original BIN is unchanged. Only enemy element masks in DRA.BIN's g_EnemyDefs change.\n\n## Skeleton/undead: resist Dark (half damage)\n\nAny Dark weakness is removed. Enemies already immune to or absorbing Dark keep that.\n\n${rows.filter(r => r.group === 'undead').map(line).join('\n')}\n\n## Ghost/demon: immune to Dark\n\nDark weakness, resistance and absorption are cleared; immunity is checked first.\n\n${rows.filter(r => r.group === 'ghost').map(line).join('\n')}\n\nDark attacks that also carry Hit or Cut count as Dark. Dark mixed with another non-physical element is only blocked or halved if the enemy also covers that element.\n\nSource: ${source}\nBefore SHA-256: ${initial}\nExpected after SHA-256: ${final}\nForward: ${report.forward.path}\nForward SHA-256: ${report.forward.sha256}\nReversal: ${report.reversal.path}\nReversal SHA-256: ${report.reversal.sha256}\n\nDecomp revision: ${report.decomp.revision}\nEditor revision: ${report.editor.revision}\nSee ${names[2]} for rows, sectors and checks.\n\nBoth PPFs carry undo data; the application tool guards the full-image hash and changed bytes. No backup BIN is created or deleted.\n\nAfter explicit approval: node tools/enemies/build-dark-element-undead-patch.js "${path.resolve(directory)}" --apply\n\nBoot afresh with a memory-card save; old savestates keep the loaded table.\n`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath,
    changed: rows.filter(r => r.changed).map(r => `${r.group} #${r.index} ${r.name}`)}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {prepare, verify, outcome, UNDEAD, GHOSTS};
