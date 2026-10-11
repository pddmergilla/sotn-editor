const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const K = require('../stats-core.js');
const T = require('../tools/bosses/richter-crash-recovery.js'), {inspect} = require('../tools/bosses/build-richter-crash-recovery-patch.js');
const {machine} = require('./helpers/mips.js'), {apply} = require('../tools/weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || `${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const SFX_HOOK = 0x8000ABCE, MAX = 4000, STEP = T.RIC + 0x2C, HP = T.RIC + 0x3E;
// One EntityRichter frame: the hooked AI writes its own think step and pad, then the patched wrapper runs.
function fight(file) {
  const sounds = [], ai = {think: 0, pad: 0x2000, calls: 0};
  const cpu = machine([{base: T.BASE, bytes: file}], new Map([
    [T.THINKING, (r, {put}) => {
      ai.calls++; put(T.THINK, 4, ai.think); put(T.THINK_S, 4, 1); put(T.PAD_SIM, 4, ai.pad);
      for (const reg of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 24, 25]) r[reg] = 0x5A5A0000 + reg;
    }],
    [SFX_HOOK, r => {sounds.push(r[4]);}]
  ]));
  cpu.put(T.PLAY_SFX, 4, SFX_HOOK); cpu.put(T.MAX_HP, 2, MAX);
  const state = ({step = 1, hp = 900, aggressive = 1, force = 0, ground = 1, finisher = 0, think = 0} = {}) => {
    cpu.put(STEP, 2, step); cpu.put(HP, 2, hp); cpu.put(T.AGGRESSIVE, 4, aggressive); cpu.put(T.FORCE, 1, force);
    cpu.put(T.VRAM_FLAG, 4, ground); cpu.put(T.FINISHER, 4, finisher); ai.think = think;
  };
  const tick = (s = {}) => {
    state(s); const calls = ai.calls;
    const init = Object.fromEntries(Array.from({length: 31}, (_, n) => [n + 1, 0x12340000 + n])); init[29] = 0x801FF000; init[31] = -1;
    const r = cpu.run(T.CALL, init);
    assert.equal(ai.calls, calls + 1, 'The AI runs every frame.');
    for (const reg of [16, 17, 18, 19, 20, 21, 22, 23, 30]) assert.equal(r[reg], 0x12340000 + reg - 1);
    assert.equal(r[29] >>> 0, 0x801FF000);
    return {pad: cpu.get(T.PAD_SIM, 4), think: cpu.get(T.THINK, 4), timer: cpu.get(T.STATE, 2), latch: cpu.get(T.STATE + 2, 1)};
  };
  return {cpu, tick, sounds, ai};
}
// Runs from the hooked call site: "jal wrapper" plus a stop after its delay slot.
function harness(file) {
  const code = Buffer.from(file);
  const f = fight(code); f.cpu.hooks.set(T.CALL + 8, () => 'stop'); return f;
}
function crouchAfter(file, force, crashStep) {
  const f = harness(file);
  let s = f.tick({step: 1, force}); assert.equal(s.latch, 0); assert.equal(s.pad, 0x2000);
  s = f.tick({step: crashStep, force, think: 1}); assert.equal(s.latch, 1); assert.equal(s.pad, 0x2000); assert.equal(s.think, 1);
  if (crashStep === 0x13) {
    s = f.tick({step: 4, ground: 0}); assert.equal(s.latch, 1); assert.equal(s.pad, 0x2000);
    s = f.tick({step: 1, ground: 0}); assert.equal(s.latch, 1); assert.equal(s.pad, 0x2000);
  }
  let held = 0;
  for (let frame = 0; frame < 80; frame++) {
    s = f.tick({step: frame ? 3 : 1, think: frame === 5 ? 1 : 0, hp: 5000});
    if (s.pad === T.DOWN) {held++; assert.equal(s.think, 0); assert.equal(f.cpu.get(T.THINK_S, 4), 0);}
    else {assert.equal(s.pad, 0x2000); assert.equal(s.think, 0); break;}
  }
  assert.equal(held, T.FRAMES); assert.deepEqual(f.sounds, [T.SFX]); assert.equal(s.timer, 0); assert.equal(s.latch, 0);
  for (let frame = 0; frame < 5; frame++) assert.equal(f.tick({step: 1}).pad, 0x2000);
  assert.equal(f.sounds.length, 1);
}
function behaviour(file) {
  crouchAfter(file, 4, 0x13); crouchAfter(file, 5, 0x1C); crouchAfter(file, 9, 0x1C);
  // Excluded crashes, phases and HP.
  for (const [force, step, extra] of [[2, 0x13], [7, 0x1C], [1, 0x16], [3, 0x15], [6, 0x1C], [4, 0x13, {aggressive: 0}],
    [5, 0x1C, {hp: MAX / 4}], [9, 0x1C, {hp: 1200}], [4, 1], [5, 3], [9, 0x0B]]) {
    const f = harness(file);
    f.tick({step, force, ...extra});
    for (let frame = 0; frame < 4; frame++) assert.equal(f.tick({step: 1}).pad, 0x2000);
    assert.equal(f.sounds.length, 0, `force ${force} step ${step}`);
  }
  // A hit, a scripted think step or the finisher cancels the crouch.
  for (const cancel of [{step: 0x0B}, {step: 0x11}, {think: 0x32}, {finisher: 1}, {step: 0x50}]) {
    const f = harness(file);
    f.tick({step: 0x1C, force: 5, hp: 100}); assert.equal(f.tick({step: 1}).pad, T.DOWN);
    for (let frame = 0; frame < 10; frame++) assert.equal(f.tick({step: 3}).pad, T.DOWN);
    const s = f.tick(cancel); assert.equal(s.pad, 0x2000); assert.equal(s.timer, 0); assert.equal(s.latch, 0);
    for (let frame = 0; frame < 3; frame++) assert.equal(f.tick({step: 1}).pad, 0x2000);
    assert.equal(f.sounds.length, 1);
  }
  // The finisher drops a pending latch; a hit before landing keeps it until he is back on his feet.
  let f = harness(file); f.tick({step: 0x1C, force: 9, hp: 100}); assert.equal(f.tick({step: 1, finisher: 1}).latch, 0);
  assert.equal(f.tick({step: 1}).pad, 0x2000);
  f = harness(file); f.tick({step: 0x13, force: 4, hp: 100}); assert.equal(f.tick({step: 0x0B, ground: 0}).latch, 1);
  assert.equal(f.tick({step: 1, think: 2}).pad, 0x2000); assert.equal(f.tick({step: 1}).pad, T.DOWN);
  // Back-to-back crashes in one fight each earn a crouch.
  f = harness(file);
  for (const force of [4, 5, 9]) {
    f.tick({step: force === 4 ? 0x13 : 0x1C, force, hp: 100});
    for (let frame = 0; frame < T.FRAMES; frame++) assert.equal(f.tick({step: frame ? 3 : 1}).pad, T.DOWN);
    assert.equal(f.tick({step: 3}).pad, 0x2000);
  }
  assert.deepEqual(f.sounds, [T.SFX, T.SFX, T.SFX]);
}
async function main() {
  const {cave, tail} = T.program();
  assert.ok(T.CAVE + cave.length * 4 <= T.CAVE_END && T.TAIL + tail.length * 4 <= T.STATE);
  if (!fs.existsSync(source)) {console.log('Richter crash recovery image checks skipped; supply SOTN_ASS_BIN.'); return;}
  const original = fs.readFileSync(source);
  let opened = await inspect(original, false).catch(() => null), installed = false;
  if (!opened) {
    opened = await inspect(original, true); installed = true;
  } else if (K.u32(opened.file, T.CALL - T.BASE) !== 0x0C06D68B) {
    installed = true; T.verify(opened.file);
  }
  const file = installed ? opened.file : T.overlay(opened.file);
  behaviour(file);
  // Unrelated bytes and the guards.
  const base = installed ? Buffer.from(file) : opened.file;
  if (installed) for (const e of T.edits()) base.set(e.original, e.off);
  for (let at = 0; at < file.length; at++) if (!T.edits().some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(file[at], base[at]);
  assert.deepEqual(T.overlay(base), file);
  const busy = Buffer.from(base); busy[T.TAIL - T.BASE + 8] = 1; assert.throws(() => T.overlay(busy));
  const other = Buffer.from(base); other[T.THINKING - T.BASE + 0x100] ^= 1; assert.throws(() => T.overlay(other));
  const report = process.env.SOTN_RICHTER_CRASH_REPORT || path.join(__dirname, '../outputs/richter-crash-recovery-2026-10-12/verification.json');
  if (fs.existsSync(report)) {
    const r = JSON.parse(fs.readFileSync(report, 'utf8')), image = Buffer.from(original), live = hash(image);
    if (live === r.source.sha256) {apply(image, fs.readFileSync(r.forward.path)); assert.equal(hash(image), r.result.sha256); await inspect(image, true);}
    else if (live === r.result.sha256) {apply(image, fs.readFileSync(r.reversal.path)); assert.equal(hash(image), r.source.sha256); await inspect(image, false);}
  }
  console.log(`Richter crash recovery: Cross/Bible/Agunea crouch with grunt for ${T.FRAMES} frames, exclusions, cancels and guards passed (${installed ? 'installed' : 'prepared'} BIN).`);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
