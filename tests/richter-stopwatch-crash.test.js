const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js');
const T = require('../tools/bosses/richter-stopwatch-crash.js');
const {apply} = require('../tools/weapons/build-stone-sword-patch.js');
const source = process.env.SOTN_ASS_BIN || `${process.env.USERPROFILE}/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin`;
const hash = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();

// The shared helper plus the few MIPS I instructions this code uses (unaligned stores, divide, multu, nor).
function loadMachine() {
  const file = path.join(__dirname, 'helpers/mips.js');
  let text = fs.readFileSync(file, 'utf8');
  const add = (anchor, code) => { assert.ok(text.includes(anchor), anchor); text = text.replace(anchor, code + anchor); };
  if (!text.includes('f === 0x1A')) add('else if (f === 0x12) set(rd, lo);', `else if (f === 0x1A || f === 0x1B) {
          const a = f === 0x1B ? r[rs] >>> 0 : r[rs], b = f === 0x1B ? r[rt] >>> 0 : r[rt];
          assert.notEqual(b, 0, 'Division by zero.'); lo = Math.trunc(a / b) | 0; hi = (a % b) | 0;
        }
        `);
  add('else if (f === 0x12) set(rd, lo);', `else if (f === 0x19) { const v = BigInt(r[rs] >>> 0) * BigInt(r[rt] >>> 0); lo = Number(BigInt.asIntN(32, v)); hi = Number(BigInt.asIntN(32, v >> 32n)); }
        else if (f === 0x27) set(rd, ~(r[rs] | r[rt]));
        `);
  add('else if (op === 4 || op === 5)', `else if (op === 42 || op === 46) {
        const k = addr & 3, aligned = addr - k;
        if (op === 42) for (let i = 0; i <= k; i++) put(aligned + i, 1, r[rt] >>> (8 * (3 - k + i)));
        else for (let i = 0; i <= 3 - k; i++) put(addr + i, 1, r[rt] >>> (8 * i));
      }
      `);
  const context = {module: {exports: {}}, require: require('node:module').createRequire(file)};
  vm.runInNewContext(text, context, {filename: file});
  return context.module.exports.machine;
}
const machine = loadMachine();

const P = 0x800733D8, RIC = P + 64 * 188, PRIMS = 0x80086FEC, ALLOC = 0x8000ABCE, SFX = 0x8000ABCD;
const sin = r => Math.round(Math.sin(((r[4] << 0) & 4095) * Math.PI / 2048) * 4096), cos = r => Math.round(Math.cos(((r[4] << 0) & 4095) * Math.PI / 2048) * 4096);
function services(seed) {
  let s = seed >>> 0; const log = {sounds: [], destroyed: [], factories: []};
  const hooks = new Map([
    [0x800160E4, r => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; r[2] = s >>> 16 & 0x7FFF; }],
    [0x80016C9C, r => { r[2] = sin(r); }], [0x80016D68, r => { r[2] = cos(r); }],
    [SFX, r => { log.sounds.push(r[4]); }],
    [ALLOC, (r, q) => { assert.equal(r[4], 4); r[2] = 3; for (let i = 0; i < r[5]; i++) q.put(PRIMS + (3 + i) * 52, 4, i < r[5] - 1 ? PRIMS + (4 + i) * 52 : 0); }]
  ]);
  return {hooks, log};
}
function prepare(m, e, {x, y, face, z}) {
  for (let i = 0; i < 24 * 52; i++) m.put(PRIMS + i, 1, (i * 37 + 11) & 255); // the same leftovers in both runs
  m.put(0x8003C7B8, 4, ALLOC); m.put(0x8003C7DC, 4, SFX);
  m.put(e + 2, 2, x); m.put(e + 6, 2, y); m.put(e + 0x14, 2, face); m.put(e + 0x26, 2, 0x2E);
  m.put(P + 0x24, 2, z); m.put(RIC + 0x24, 2, z);
}
function snapshot(m, e) {
  const out = [];
  for (let i = 0; i < 188; i++) out.push(m.get(e + i, 1));
  for (let i = 0; i < 20 * 52; i++) out.push(m.get(PRIMS + 3 * 52 + i, 1));
  return out;
}
// Runs one sparkle until it destroys itself.
function sparkle(code, fn, destroy, factory, setup) {
  const {hooks, log} = services(setup.seed), e = P + 100 * 188, frames = [];
  let alive = true;
  hooks.set(destroy, r => { assert.equal(r[4] >>> 0, e); log.destroyed.push(frames.length); alive = false; for (let i = 0; i < 188; i++) m.put(e + i, 1, 0); });
  if (factory) hooks.set(factory, r => { log.factories.push([r[5], m.get(e + 2, 2), m.get(e + 6, 2)]); r[2] = 0; });
  const m = machine(code, hooks);
  prepare(m, e, setup);
  while (alive && frames.length < 400) { m.run(fn, {4: e}); frames.push(snapshot(m, e)); }
  return {frames, log};
}
function sparkleEquivalence(bo6, ric) {
  const original = 0x8016F6F0;
  assert.equal(K.u32(ric, 0x8015495C - 0x8013C000 + 0x40 * 4), original, 'RIC entity 0x40 is not RicEntityCrashStopwatchDoneSparkle.');
  let compared = 0, hitboxes = 0;
  for (const setup of [{x: 128, y: 100, face: 0, z: 0x94, seed: 1}, {x: 128, y: 100, face: 1, z: 0x94, seed: 2},
    {x: 300, y: 40, face: 0, z: 0x80, seed: 77}, {x: -10, y: 230, face: 1, z: 0x10, seed: 9}, {x: 40, y: 200, face: 1, z: 0xA0, seed: 123456}]) {
    const a = sparkle([{base: 0x8013C000, bytes: ric}], original, 0x80156C60, 0x801606BC, setup);
    const b = sparkle([{base: T.BASE, bytes: bo6}], T.ENTRY.StopwatchSparkle, T.DESTROY, null, setup);
    assert.equal(b.frames.length, a.frames.length, `frames ${JSON.stringify(setup)}`);
    a.frames.forEach((frame, n) => assert.deepEqual(b.frames[n], frame, `frame ${n} ${JSON.stringify(setup)}`));
    assert.deepEqual(b.log.sounds, a.log.sounds); assert.deepEqual(a.log.sounds, [0x614]);
    assert.deepEqual(b.log.destroyed, a.log.destroyed);
    assert.ok(a.log.factories.every(([bp]) => bp === 0x49), 'The original only adds lightning hitboxes.'); hitboxes += a.log.factories.length;
    compared += a.frames.length;
  }
  assert.ok(hitboxes > 0);
  return compared;
}

// The crash controller: four stopwatch factories 17 frames apart, like RicEntityCrashStopwatch.
function controller(bo6) {
  const calls = [], e = P + 90 * 188;
  const m = machine([{base: T.BASE, bytes: bo6}], new Map([
    [0x801BBDC0, (r, q) => { assert.equal(r[4] >>> 0, e); calls.push([frame, r[5] >>> 0]);
      const f = P + (68 + calls.length) * 188; q.put(f + 0x26, 2, 1); q.put(f + 0x30, 2, r[5] & 0xFFF); r[2] = f; }],
    [T.DESTROY, (r, q) => { for (let i = 0; i < 188; i++) q.put((r[4] >>> 0) + i, 1, 0); }]
  ]));
  let frame = 0;
  m.put(e + 0x26, 2, 0x39); m.put(0x801CF3A0, 4, 1); m.put(0x801CF3A8, 4, 1);
  for (; frame < 80 && m.get(e + 0x26, 2); frame++) m.run(T.ENTRY.CrashStopwatch, {4: e});
  assert.deepEqual(calls, [[0, 0x1003F], [17, 0x2003F], [34, 0x3003F], [51, 0x4003F]]);
  assert.equal(frame, 53); assert.equal(m.get(e + 0x26, 2), 0);
  for (let i = 1; i <= 4; i++) assert.equal(m.get(P + (68 + i) * 188 + 0xB4, 4) >>> 0, 0x52494346, `factory ${i} tagged`);
  return calls.length;
}

// Four real BO6 stopwatches through the new wrapper (the finisher Clock is reduced to the native watch here).
function clocks(bo6) {
  const sounds = [], factories = [], destroyed = [], slots = [];
  let s = 5, m;
  const hooks = new Map([
    [0x800160E4, r => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; r[2] = s >>> 16 & 0x7FFF; }],
    [0x80016C9C, r => { r[2] = sin(r); }], [0x80016D68, r => { r[2] = cos(r); }],
    [SFX, r => { sounds.push(r[4]); }],
    [ALLOC, (r, q) => { r[2] = 3 * slots.length; slots.push(r[2]); for (let i = 0; i < r[5]; i++) q.put(PRIMS + (r[2] + i) * 52, 4, i < r[5] - 1 ? PRIMS + (r[2] + i + 1) * 52 : 0); }],
    [0x801BBDC0, r => { factories.push([r[4] >>> 0, r[5] >>> 0]); r[2] = 0; }],
    [T.DESTROY, (r, q) => { destroyed.push(r[4] >>> 0); for (let i = 0; i < 188; i++) q.put((r[4] >>> 0) + i, 1, 0); }],
    [T.CLOCK, r => { m.run(0x801CB664, {4: r[4]}); }]
  ]);
  m = machine([{base: T.BASE, bytes: bo6}], hooks);
  m.put(0x8003C7B8, 4, ALLOC); m.put(0x8003C7DC, 4, SFX);
  m.put(RIC, 4, 160 << 16); m.put(RIC + 4, 4, 150 << 16); m.put(RIC + 0x14, 2, 1); m.put(RIC + 0x24, 2, 0x94);
  m.put(RIC + 0x12, 2, -3); m.put(RIC + 0x47, 1, 12);
  const ric = () => [m.get(RIC, 4), m.get(RIC + 4, 4), m.get(RIC + 0x12, 2), m.get(RIC + 0x47, 1)];
  const before = ric(), watch = i => P + (110 + i) * 188, live = new Set();
  let frame = 0, timeStopEnds = [];
  for (; frame < 1400; frame++) {
    if (frame % 17 === 0 && frame <= 51) {
      const i = frame / 17 + 1, e = watch(i);
      m.put(e + 0x26, 2, 0x37); m.put(e + 0x30, 2, i << 8); m.put(e, 4, 160 << 16); m.put(e + 4, 4, 150 << 16); m.put(e + 0x14, 2, 1); live.add(i);
    }
    for (const i of [...live]) {
      const e = watch(i), step = m.get(e + 0x2C, 2);
      m.run(T.ENTRY.Stopwatch, {4: e})
      assert.deepEqual(ric(), before, 'RIC is restored after each clock.');
      if (step === 4) { assert.equal(m.get(e + 0x2C, 2), 7, 'crash clocks skip the shrink'); assert.deepEqual(factories.at(-1), [e, 0x36]); }
      if (!m.get(e + 0x26, 2)) { live.delete(i); timeStopEnds.push([i, m.get(0x800973FC, 4)]); }
    }
    if (frame === 120) {
      // Each clock trails the previous one by 16 pixels behind and 16 up.
      for (let i = 2; i <= 4; i++) {
        const a = watch(i - 1), b = watch(i);
        assert.ok(Math.abs((m.get(b, 4) - m.get(a, 4)) - (16 << 16)) < 0x8000, `x of clock ${i}`);
        assert.ok(Math.abs((m.get(b + 4, 4) - m.get(a + 4, 4)) + (16 << 16)) < 0x8000, `y of clock ${i}`);
      }
      assert.ok(Math.abs(m.get(watch(1), 4) - (168 << 16)) < 0x8000); assert.ok(Math.abs(m.get(watch(1) + 4, 4) - (135 << 16)) < 0x8000);
    }
    if (!live.size && frame > 60) break;
  }
  assert.deepEqual(timeStopEnds.map(([i]) => i), [1, 2, 3, 4]);
  assert.deepEqual(timeStopEnds.map(([, stop]) => stop), [1, 1, 1, 0], 'only the last clock ends the time stop');
  assert.deepEqual(factories.filter(([, p]) => p === 0x36).map(([e]) => e), [1, 2, 3, 4].map(watch), 'one lightning per clock');
  assert.equal(factories.filter(([, p]) => p === 0x42).length, 4, 'one crash wave per clock');
  for (let i = 0; i < 3; i++) assert.equal(m.get(T.CHAIN + i * 4, 4), 0);
  assert.equal(m.get(T.LAST, 4), 4);
  return frame;
}

// The same four clocks through the real finisher Clock: every clock counts five seconds, Alucard stays held and
// Hydrostorm waits until the last clock ends.
function finisher(bo6) {
  const F = 0x801CF3A0, G = 0x80072F80, MARK = 0x52494346, factories = [];
  let s = 9, m;
  const hooks = new Map([
    [0x800160E4, r => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; r[2] = s >>> 16 & 0x7FFF; }],
    [0x80016C9C, r => { r[2] = sin(r); }], [0x80016D68, r => { r[2] = cos(r); }],
    [SFX, () => {}],
    [ALLOC, (r, q) => { r[2] = 3 * factories.length; for (let i = 0; i < r[5]; i++) q.put(PRIMS + (r[2] + i) * 52, 4, i < r[5] - 1 ? PRIMS + (r[2] + i + 1) * 52 : 0); }],
    [0x801BBDC0, r => { factories.push([r[4] >>> 0, r[5] >>> 0]); r[2] = 0; }],
    [T.DESTROY, (r, q) => { for (let i = 0; i < 188; i++) q.put((r[4] >>> 0) + i, 1, 0); }]
  ]);
  m = machine([{base: T.BASE, bytes: bo6}], hooks);
  m.put(0x8003C7B8, 4, ALLOC); m.put(0x8003C7DC, 4, SFX);
  m.put(RIC + 0x26, 2, 0x40); m.put(RIC + 0x2C, 2, 1); m.put(RIC, 4, 160 << 16); m.put(RIC + 4, 4, 150 << 16); m.put(RIC + 0x14, 2, 1);
  m.put(F, 4, 1); m.put(F + 8, 4, 1); m.put(G, 2, 1); m.put(0x80072F82, 2, 0x5243); m.put(0x8006C3B8, 4, RIC);
  const watch = i => P + (110 + i) * 188, live = new Set(), ends = [];
  let frame = 0;
  for (; frame < 600; frame++) {
    if (frame % 17 === 0 && frame <= 51) {
      const i = frame / 17 + 1, e = watch(i);
      m.put(e + 0x26, 2, 0x37); m.put(e + 0x30, 2, i << 8); m.put(e, 4, 160 << 16); m.put(e + 4, 4, 150 << 16); m.put(e + 0x14, 2, 1); live.add(i);
      if (i === 2) m.put(F + 8, 4, 2); // Richter walks while the later clocks appear
    }
    for (const i of [...live]) {
      const e = watch(i);
      m.put(0x8006C3B8, 4, e); m.run(T.ENTRY.Stopwatch, {4: e}); m.put(0x8006C3B8, 4, RIC);
      if (m.get(e + 0x26, 2)) { if (m.get(e + 0x2C, 2) < 7) assert.equal(m.get(e + 0xA4, 4) >>> 0, MARK, `clock ${i} marked`); continue; }
      live.delete(i); ends.push({i, frame, grab: m.get(G, 2), active: m.get(F, 4), phase: m.get(F + 8, 4), stop: m.get(0x800973FC, 4)});
    }
    if (!live.size && frame > 60) break;
  }
  assert.deepEqual(ends.map(e => e.i), [1, 2, 3, 4]);
  for (const e of ends.slice(0, 3)) { assert.equal(e.grab, 1, 'Alucard stays held'); assert.equal(e.phase, 2); assert.equal(e.stop, 1); }
  assert.deepEqual(ends.map(e => e.frame - ends[0].frame), [0, 17, 34, 51]);
  assert.ok(ends[0].frame > 300 && ends[0].frame < 360, `five-second watch (${ends[0].frame})`);
  const last = ends[3]; assert.equal(last.grab, 0); assert.equal(last.active, 1); assert.equal(last.phase, 5); assert.equal(last.stop, 0);
  assert.equal(factories.filter(([, p]) => p === 0x36).length, 4);
  return last.frame;
}

// The real BO6 factory places the sparkle in a free slot and leaves Shaft's orb (entity 0x40 in fixed slot 0x70) alone.
function orbSurvives(bo6, kind) {
  const code = Buffer.from(bo6); code[T.BLUEPRINT(T.SPARKLE_BP) - T.BASE + 4] = kind;
  const m = machine([{base: T.BASE, bytes: code}], new Map([[T.DESTROY, (r, q) => { for (let i = 0; i < 188; i++) q.put((r[4] >>> 0) + i, 1, 0); }]]));
  const slot = i => P + i * 188, orb = slot(0x70), clock = slot(0x61);
  m.put(orb + 0x26, 2, 0x40); m.put(orb + 0x2C, 2, 2); m.put(clock + 0x26, 2, 0x37); m.put(clock + 2, 2, 120); m.put(clock + 6, 2, 80);
  const factory = m.run(0x801BBDC0, {4: clock, 5: T.SPARKLE_BP, 6: 0})[2] >>> 0;
  assert.ok(factory >= slot(0x44) && factory < slot(0x50), 'factory slot');
  m.put(0x8006C3B8, 4, factory); m.run(0x801BBE64, {4: factory});
  const sparkles = Array.from({length: 0x90 - 0x44}, (_, i) => 0x44 + i).filter(i => m.get(slot(i) + 0x26, 2) === 0x2E);
  return {orb: m.get(orb + 0x26, 2) === 0x40 && m.get(orb + 0x2C, 2) === 2, sparkles};
}

async function main() {
  const {code} = T.BUILD.hex ? {code: T.CODE} : {};
  assert.equal(hash(T.CODE), T.BUILD.sha256);
  assert.ok(T.CAVE + T.CODE.length <= T.CAVE_END);
  if (process.env.ZIG) assert.deepEqual(require('../tools/bosses/richter-stopwatch-crash/build.js').compile().code, code, 'The C sources rebuild the same code.');
  if (!fs.existsSync(source)) { console.log('Richter Stopwatch crash image checks skipped; supply SOTN_ASS_BIN.'); return; }
  const image = fs.readFileSync(source), disc = await C.DiscImage.open(new Blob([image]));
  const file = Buffer.from(await disc.readFile(await disc.findPath(T.PATH))), ric = Buffer.from(await disc.readFile(await disc.findPath(['BIN', 'RIC.BIN'])));
  let installed = false, base = file, pending = null;
  try { T.verify(file); installed = true; base = Buffer.from(file); for (const e of T.edits(file)) base.set(e.original, e.off); } catch {}
  // Before the sparkle slot fix is applied, test the BIN with that one byte fixed.
  if (!installed) { try { pending = require('../tools/bosses/richter-sparkle-slot.js').overlay(file); T.verify(pending); installed = true; } catch { pending = null; } }
  if (installed) {
    const report = JSON.parse(fs.readFileSync(path.join(__dirname, '../outputs/richter-stopwatch-crash-2026-10-12/verification.json'), 'utf8'));
    for (const e of report.edits) base.set(Buffer.from(e.original, 'hex'), Number(e.fileOffset));
  }
  const bo6 = pending || (installed ? file : T.overlay(file));
  if (!installed) {
    for (let at = 0; at < bo6.length; at++) if (!T.edits(file).some(e => at >= e.off && at < e.off + e.expect.length)) assert.equal(bo6[at], file[at]);
    const busy = Buffer.from(file); busy[T.CAVE - T.BASE + 0x100] ^= 1; assert.throws(() => T.overlay(busy));
    const other = Buffer.from(file); other[0x4F500] ^= 1; assert.throws(() => T.overlay(other));
  }
  const broken = orbSurvives(bo6, 5), fixed = orbSurvives(bo6, 1);
  assert.equal(broken.orb, false, "kind 5 replaces the orb"); assert.deepEqual(broken.sparkles, [0x70]);
  assert.equal(fixed.orb, true, "the orb survives the lightning"); assert.equal(fixed.sparkles.length, 1); assert.ok(fixed.sparkles[0] >= 0x60 && fixed.sparkles[0] <= 0x7F && fixed.sparkles[0] !== 0x70);
  const frames = sparkleEquivalence(bo6, ric), spawned = controller(bo6), length = clocks(bo6), release = finisher(bo6);
  const report = path.join(__dirname, '../outputs/richter-stopwatch-crash-2026-10-12/verification.json');
  if (fs.existsSync(report)) {
    const r = JSON.parse(fs.readFileSync(report, 'utf8')), work = Buffer.from(image), live = hash(work);
    if (live === r.source.sha256) { apply(work, fs.readFileSync(r.forward.path)); assert.equal(hash(work), r.result.sha256); }
    else if (live === r.result.sha256) { apply(work, fs.readFileSync(r.reversal.path)); assert.equal(hash(work), r.source.sha256); }
  }
  console.log(`Richter Stopwatch crash: sparkle matches player Richter over ${frames} frames, ${spawned} staggered clocks, chain/time stop/lightning over ${length} frames, finisher release after the fourth clock at frame ${release} (${installed ? 'installed' : 'prepared'} BIN).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
