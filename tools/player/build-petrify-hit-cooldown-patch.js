// While petrified, Alucard can only take a hit once every 30 frames.
// Add-on to the installed "Petrification: 3 seconds, no directional escape" patch: its PlayerStepStoned entry hook
// gains a pre-hook in the 14 NOPs that patch left behind. When the stoned step is entered with a hit this frame
// (arg0 = EntityAlucard's var_s8, set only by HandleDamage result 8) or on the petrifying frame (step_s 0), it calls
// func_8010E168(1, 30): g_Player.timers[ALU_T_INVINCIBLE_CONSUMABLES] = max(timer, 30). EntityAlucard skips
// HandleDamage while that timer is nonzero, and the timer has no tick or expiry side effects.
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
const stem = 'Petrification-Hit-Cooldown-30-Frames-ASS-2.0';
const names = [`${stem}.ppf`, `Reverse-${stem}.ppf`, `${stem}.verification.json`, `${stem}.README.md`];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const revision = cwd => child.execFileSync('git', ['rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim();

const BASE = 0x800A0000, COOLDOWN = 30;
const A_ = {
  timer14: 0x80072F1C, timer13: 0x80072F1A, unk5E: 0x80072F7E, stepS: 0x80073406, hp: 0x80097BA0,
  entry: 0x80114E14, hook: 0x8011511C, pre: 0x80115160, cont: 0x80114E1C, release: 0x80115198, timerFn: 0x8010E168
};
// Installed petrification patch (guarded): entry jump, its hook, and the NOP slack it left.
const ENTRY_OLD = [0x08045447, 0x96230000];
const HOOK_WORDS = [0x3C028009, 0x1060000D, 0x8C427BA0, 0, 0x1040000A, 0x3C028007, 0x94422F7E, 0, 0x2442FFFF, 0x3C018007,
  0xA4222F7E, 0x1C400003, 0, 0x08045466, 0x00009021, 0x08045387, 0x34020001];
const SLACK = 14;
// Vanilla code this relies on (guarded).
const GUARDS = [
  [0x80114DF4, [0x27BDFFE0, 0xAFB00010, 0x00808021, 0xAFB20018, 0xAFB10014, 0x3C118007, 0x26313406, 0xAFBF001C]], // prologue: s0 = arg0, s1 = &step_s
  [0x80114ED8, [0x340200B4, 0]], // installed 3-second timer
  [0x8010E168, [0x27BDFFE0, 0xAFB00010, 0x00A08021, 0xAFB10014, 0x02008821, 0x14800000 | 0xC, 0xAFBF0018]],
  [0x8010E1B0, [0x3C048007, 0x24842F1C, 0x84830000, 0x00101400, 0x00021403, 0x0043102A, 0x14400002, 0]],
  [0x8010A620, [0x0000F021]], // var_s8 (fp) = 0 each frame
  [0x8010ADE0, [0x3C028007, 0x94422F1A, 0x3C038007, 0x94632F1C, 0, 0x00431025, 0x14400000 | ((0x8010B0B4 - 0x8010ADFC) >> 2), 0]],
  [0x8010B03C, [0x00002821, 0x8FA40018, 0x8FA20010, 0x3C018007, 0xAC222F38, 0x0C046321, 0x341E0001, 0x08042C2D, 0]], // case 8
  [0x8010B4AC, [0x0C04537D, 0x03C02021]] // PlayerStepStoned(var_s8)
];
const j = to => 0x08000000 | (to >>> 2 & 0x3FFFFFF), jal = to => 0x0C000000 | (to >>> 2 & 0x3FFFFFF);
const bne = (rs, from, to) => 0x14000000 | rs << 21 | ((to - from - 4) >> 2 & 0xFFFF);
const PRE = [
  bne(16, A_.pre, A_.pre + 0x10), 0,   // hit this frame (arg0) -> cooldown
  bne(3, A_.pre + 8, A_.hook), 0,     // step_s != 0 -> installed hook unchanged
  0x34040001,                         // ori a0, zero, 1
  jal(A_.timerFn),                    // func_8010E168(1, 30)
  0x34050000 | COOLDOWN,              // ori a1, zero, 30
  j(A_.hook),                         // back to the installed hook
  0x96230000                          // lhu v1, 0(s1)  (reload step_s)
];

const words = (dra, at, n) => Array.from({length: n}, (_, i) => K.u32(dra, at - BASE + i * 4) >>> 0);

function guard(dra) {
  assert.deepEqual(words(dra, A_.entry, 2), ENTRY_OLD, 'Petrification entry hook missing or changed');
  assert.deepEqual(words(dra, A_.hook, HOOK_WORDS.length), HOOK_WORDS, 'Petrification hook changed');
  assert.deepEqual(words(dra, A_.pre, SLACK), Array(SLACK).fill(0), 'Petrification NOP slack is not free');
  assert.deepEqual(words(dra, A_.release, 2), [0x0C043692, 0x3404003B], 'Release path changed');
  for (const [at, list] of GUARDS) assert.deepEqual(words(dra, at, list.length), list.map(w => w >>> 0), `Guarded code at ${at.toString(16)}`);
  // Nothing else in DRA branches into the slack.
  for (let p = 0; p < dra.length - 3; p += 4) {
    const w = K.u32(dra, p) >>> 0, op = w >>> 26, pc = BASE + p;
    let to = null;
    if (op === 2 || op === 3) to = ((pc + 4) & 0xF0000000 | (w & 0x3FFFFFF) << 2) >>> 0;
    else if (op === 1 || (op >= 4 && op <= 7)) to = pc + 4 + ((w << 16) >> 14);
    if (to !== null && to >= A_.pre && to < A_.pre + SLACK * 4) assert.fail(`DRA ${pc.toString(16)} branches into the slack`);
    if (w >= A_.pre && w < A_.pre + SLACK * 4) assert.fail(`DRA ${pc.toString(16)} points into the slack`);
  }
}

function prepare(files) {
  const dra = files.get('DRA.BIN'), after = Uint8Array.from(dra);
  guard(dra);
  K.put32(after, A_.entry - BASE, j(A_.pre));
  PRE.forEach((w, i) => K.put32(after, A_.pre - BASE + i * 4, w));
  return new Map([['DRA.BIN', after]]);
}

// Runs the patched entry (from the jump at 0x80114E14) through the real hooks and func_8010E168.
function entry(dra, state, arg0) {
  const cpu = machine([{base: BASE, bytes: dra}]);
  let exit = null;
  cpu.hooks.set(A_.cont, () => { exit = 'continue'; return 'stop'; });
  cpu.hooks.set(A_.release, () => { exit = 'release'; return 'stop'; });
  cpu.put(A_.stepS, 2, state.stepS); cpu.put(A_.hp, 4, state.hp); cpu.put(A_.unk5E, 2, state.unk5E);
  cpu.put(A_.timer14, 2, state.timer14); cpu.put(A_.timer13, 2, 0);
  const SAVED = {16: arg0, 17: A_.stepS, 18: 0x1234, 19: 0x1313, 20: 0x1414, 21: 0x1515, 22: 0x1616, 23: 0x1717, 30: arg0, 29: 0x801FEFE0};
  const r = cpu.run(A_.entry, {...SAVED, 31: 0x8010B4B4, 3: 0xDEAD});
  assert.ok(exit, 'Hook did not return');
  if (exit === 'release') assert.equal(r[18], 0, 'release clears newlyPetrified (s2)'), delete SAVED[18];
  for (const [n, v] of Object.entries(SAVED)) assert.equal(r[n] >>> 0, v >>> 0, `register ${n}`);
  if (exit === 'continue') assert.equal(r[3], state.stepS, 'v1 = step_s at continue'), assert.equal(r[2], 1, 'v0 = 1 at continue');
  return {exit, timer14: cpu.get(A_.timer14, 2) << 16 >> 16, unk5E: cpu.get(A_.unk5E, 2) << 16 >> 16};
}

// Frame model of EntityAlucard (timers decrement, then HandleDamage unless timers[13]|timers[14], then the step)
// with continuous enemy contact while stoned on the ground.
function timeline(dra, frames, start14 = 0) {
  let timer14 = start14, unk5E = 0xB4, hits = [], released = null;
  for (let f = 0; f < frames && released === null; f++) {
    if (timer14) timer14--;
    const hit = timer14 === 0;
    if (hit) hits.push(f);
    const out = entry(dra, {stepS: 2, hp: 500, unk5E, timer14}, hit ? 1 : 0);
    ({timer14, unk5E} = out);
    if (out.exit === 'release') released = f;
  }
  return {hits, released};
}

function verify(files, after) {
  const before = files.get('DRA.BIN'), dra = after.get('DRA.BIN');
  const allowed = new Set([...Array(4).keys()].map(i => A_.entry - BASE + i));
  for (let i = 0; i < PRE.length * 4; i++) allowed.add(A_.pre - BASE + i);
  for (let i = 0; i < before.length; i++) if (before[i] !== dra[i]) assert.ok(allowed.has(i), `unexpected DRA change at 0x${i.toString(16)}`);
  let cases = 0;
  // Unpatched: continuous contact hits every frame.
  // Patched: per-state hook behaviour.
  for (const stepS of [0, 1, 2, 3]) for (const hp of [0, 500]) for (const arg0 of [0, 1]) for (const t of [0, 4, 29, 30, 31, 300]) {
    const unk5E = 50, out = entry(dra, {stepS, hp, unk5E, timer14: t}, arg0);
    const cool = arg0 || stepS === 0;
    assert.equal(out.timer14, cool ? Math.max(t, COOLDOWN) : t, `timer s${stepS} hp${hp} a${arg0} t${t}`);
    assert.equal(out.exit, 'continue');
    assert.equal(out.unk5E, stepS && hp ? unk5E - 1 : unk5E, 'installed 3-second countdown unchanged');
    cases++;
  }
  for (const arg0 of [0, 1]) { assert.equal(entry(dra, {stepS: 2, hp: 500, unk5E: 1, timer14: 0}, arg0).exit, 'release'); cases++; }
  const run = timeline(dra, 400);
  assert.equal(run.released, 0xB4 - 1, 'still breaks free after 180 stoned frames');
  assert.deepEqual(run.hits, Array.from({length: Math.floor(run.released / COOLDOWN) + 1}, (_, i) => i * COOLDOWN), 'hits 30 frames apart');
  cases++;
  // Petrified by a hit (cooldown starts on the petrifying frame): the first stoned hit lands 30 frames later.
  const first = entry(dra, {stepS: 0, hp: 500, unk5E: 0, timer14: 0}, 0);
  assert.equal(first.timer14, COOLDOWN); cases++;
  const unpatched = timeline(before, 10);
  assert.deepEqual(unpatched.hits, [...Array(10).keys()], 'baseline: unpatched takes a hit every frame');
  cases++;
  return {cases, hitsPerStone: run.hits, releaseFrame: run.released};
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
  const forward = ppf(changes, block, 'Petrified: max one hit per 30 frames');
  const reverse = ppf(changes.map(c => ({...c, original: c.modified, modified: c.original})), block, 'Reverse petrified 30-frame hit cooldown');
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
  const report = {
    source: {path: source, size: original.length, sha256: initial}, result: {sha256: final},
    forward: {path: path.resolve(directory, names[0]), size: forward.length, sha256: sha(forward)},
    reversal: {path: path.resolve(directory, names[1]), size: reverse.length, sha256: sha(reverse)},
    sectors, records: A.parsePpf(forward).offsets.length, validation,
    edits: {
      file: 'DRA.BIN',
      entry: {ram: hex(A_.entry), before: hex(ENTRY_OLD[0]), after: hex(j(A_.pre)), note: 'PlayerStepStoned entry jump now goes to the pre-hook; delay slot lhu v1,0(s1) kept'},
      preHook: {ram: `${hex(A_.pre)}-${hex(A_.pre + PRE.length * 4 - 1)}`, words: PRE.map(hex), space: 'NOP slack left by the installed petrification patch (vanilla wiggle code); 5 NOPs remain at 0x80115184-0x80115197'},
      cooldown: `func_8010E168(1, ${COOLDOWN}) -> g_Player.timers[14] (ALU_T_INVINCIBLE_CONSUMABLES, ${hex(A_.timer14)}) = max(timer, ${COOLDOWN}) when arg0 (hit this frame) or step_s == 0 (petrifying frame)`
    },
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp'),
      files: ['src/dra/71830.c (PlayerStepStoned)', 'src/dra/692E8.c (EntityAlucard timers, invincibility skip, HandleDamage case 8 var_s8)', 'src/dra/5D5BC.c (HandleDamage: stoned returns 8, hpMax/8)', 'src/dra/6DF70.c (func_8010E168)', 'include/game.h (ALU_T_*)'],
      localChanges: 'Existing source edits preserved; exact live BIN bytes were authoritative.'},
    editor: {revision: revision(path.join(__dirname, '../..'))},
    verified: ['installed petrification patch words and NOP slack guarded', 'no DRA branch/pointer into the slack', 'vanilla prologue, func_8010E168, invincibility skip, case 8 and call site guarded',
      'hook run on the real patched DRA for step_s 0-3 x hp 0/500 x arg0 0/1 x six timer values: cooldown, max semantics, preserved registers, v0/v1 at continue, 3-second countdown unchanged',
      'continuous-contact frame model: hits exactly 30 frames apart, release still after 180 frames', 'baseline unpatched model hits every frame',
      'only the entry word and pre-hook bytes change', 'forward/reversal and both undo full-image hashes', 'changed-byte rejection', 'reopen equality', 'sector checksums', 'unrelated sectors unchanged', 'source unchanged'],
    gameplay: 'In-game emulator check remains unverified. DRA loads at boot; old savestates keep the old code.',
    application: {applied: false}
  };
  await fs.mkdir(directory, {recursive: true}); await fs.writeFile(report.forward.path, forward); await fs.writeFile(report.reversal.path, reverse);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(path.resolve(directory, names[3]), `# Petrified: one hit per 30 frames

Requires the installed "Petrification: 3 seconds, no directional escape" patch (guarded). The original BIN is unchanged until this PPF is applied.

While Alucard is petrified, a hit that lands (HandleDamage result 8, hpMax/8 damage) starts a ${COOLDOWN}-frame cooldown, and so does the petrifying frame itself. During the cooldown EntityAlucard skips damage entirely, so continuous contact hits at most once every ${COOLDOWN} frames (6 hits over the 3-second petrification instead of up to 180).

The cooldown uses the game's own no-damage timer, g_Player.timers[14] (ALU_T_INVINCIBLE_CONSUMABLES), set through func_8010E168(1, ${COOLDOWN}), which never shortens a longer timer and has no visual effect. Up to ${COOLDOWN - 1} frames of it can carry over after breaking free.

Code: DRA ${hex(A_.entry)} entry jump -> pre-hook at ${hex(A_.pre)}-${hex(A_.pre + PRE.length * 4 - 1)}, inside the NOPs the petrification patch left. Changed sectors: ${sectors.join(', ')}.

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

Both PPFs carry undo data and block checks. No backup BIN is created. Remove this patch with its reversal before reversing the petrification patch.

After explicit approval: node tools/player/build-petrify-hit-cooldown-patch.js "${path.resolve(directory)}" --apply

Boot afresh; old savestates keep the loaded code.
`);
  console.log(JSON.stringify({initial, final, forward: report.forward, reversal: report.reversal, validation, sectors, reportPath}, null, 2));
}
if (require.main === module) main().catch(error => {console.error(error); process.exitCode = 1;});
module.exports = {prepare, verify, guard, PRE};
