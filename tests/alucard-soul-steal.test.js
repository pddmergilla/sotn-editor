const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const C = require('../sotn-core.js'), K = require('../stats-core.js');
const H = require('../tools/weapons/alucard-soul-steal.js');
const base = H.BASE;
function run(bytes, start, memory, initial = {}, stops = [], calls = new Map()) {
  const r = new Int32Array(32); r[29] = 0x801FFF00; r[31] = -1;
  for (const [reg, value] of Object.entries(initial)) r[reg] = value;
  const get = (addr, size) => {
    addr >>>= 0;
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.has(addr + i) ? memory.get(addr + i) :
      addr + i >= base && addr + i < base + bytes.length ? bytes[addr + i - base] : 0) << (i * 8);
    return value;
  };
  const put = (addr, size, value) => {
    for (let i = 0; i < size; i++) memory.set((addr >>> 0) + i, value >>> (i * 8) & 255);
  };
  let pc = start >>> 0, branch = null, load = null;
  for (let step = 0; step < 2000; step++) {
    if (pc === 0xFFFFFFFF || stops.includes(pc)) return {pc, r, get, put};
    if (calls.has(pc)) {
      if (calls.get(pc)({r, get, put}) === false) return {pc, r, get, put};
      pc = r[31] >>> 0;
      continue;
    }
    const w = get(pc, 4) >>> 0, op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
    const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
    let next = null, nextLoad = null;
    if (op === 0) {
      const fn = w & 63, shift = w >>> 6 & 31;
      if (fn === 0) r[rd] = r[rt] << shift;
      else if (fn === 2) r[rd] = r[rt] >>> shift;
      else if (fn === 3) r[rd] = r[rt] >> shift;
      else if (fn === 0x21) r[rd] = r[rs] + r[rt];
      else if (fn === 0x23) r[rd] = r[rs] - r[rt];
      else if (fn === 0x24) r[rd] = r[rs] & r[rt];
      else if (fn === 0x25) r[rd] = r[rs] | r[rt];
      else if (fn === 0x26) r[rd] = r[rs] ^ r[rt];
      else if (fn === 0x27) r[rd] = ~(r[rs] | r[rt]);
      else if (fn === 0x2A) r[rd] = Number(r[rs] < r[rt]);
      else if (fn === 8) next = r[rs] >>> 0;
      else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    } else if (op === 15) r[rt] = (w & 65535) << 16;
    else if (op === 9) r[rt] = r[rs] + imm;
    else if (op === 10) r[rt] = Number(r[rs] < imm);
    else if (op === 11) r[rt] = Number((r[rs] >>> 0) < (imm >>> 0));
    else if (op === 12) r[rt] = r[rs] & (w & 65535);
    else if (op === 13) r[rt] = r[rs] | (w & 65535);
    else if ([33, 35, 36, 37].includes(op)) {
      const size = op === 35 ? 4 : op === 36 ? 1 : 2;
      const value = get(addr, size);
      nextLoad = [rt, op === 33 ? value << 16 >> 16 : value];
    } else if ([40, 41, 43].includes(op)) put(addr, op === 40 ? 1 : op === 41 ? 2 : 4, r[rt]);
    else if (op === 4) { if (r[rs] === r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 5) { if (r[rs] !== r[rt]) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 1 && rt === 1) { if (r[rs] >= 0) next = (pc + 4 + imm * 4) >>> 0; }
    else if (op === 2 || op === 3) {
      if (op === 3) r[31] = pc + 8;
      next = ((pc & 0xF0000000) | (w & 0x3FFFFFF) << 2) >>> 0;
    } else throw Error(`Unsupported instruction at ${pc.toString(16)}: ${w.toString(16)}`);
    if (load) r[load[0]] = load[1];
    r[0] = 0;
    pc = branch === null ? (pc + 4) >>> 0 : branch;
    branch = next; load = nextLoad;
  }
  throw Error('The checked game path did not finish.');
}

async function verify(dra) {
  const after = H.prepare(dra), cost = dra[0x84A8];
  let count = 0;
  function scenario({hand = 0, facing = 0, step = 0, mp = cost, combo = 255, tapped = hand ? 0x20 : 0x80,
    swords = hand ? [0, 123] : [123, 0], locked = 0, natural = false, directions = false,
    spellCost = cost, expire = false} = {}) {
    const game = after.slice(); game[0x84A8] = spellCost;
    const memory = new Map(), events = [];
    const put = (addr, size, value) => { for (let n = 0; n < size; n++) memory.set(addr + n, value >>> (n * 8) & 255); };
    put(0x800733EC, 2, facing); put(0x80073404, 2, step);
    put(0x80072EEC, 4, tapped); put(0x80072F66, 2, locked);
    put(0x80097C00, 4, swords[0]); put(0x80097C04, 4, swords[1]); put(0x80097BB0, 4, mp);
    put(0x80138FC8, 2, combo); put(0x80138FCA, 2, 15);
    if (natural) { put(0x80138FD8, 2, 7); put(0x80138FDA, 2, 24); }
    if (directions) {
      put(0x80138FC8, 4, 0);
      put(0x80072EE8, 4, facing ? 0x2000 : 0x8000);
      run(game, base + 0x7081C, memory);
      put(0x80072EE8, 4, facing ? 0x8000 : 0x2000);
      run(game, base + 0x7081C, memory);
      if (expire) for (let frame = 0; frame < 15; frame++) run(game, base + 0x7081C, memory);
    }
    const calls = new Map([
      [H.PERFORM, ({r, put}) => { events.push('Soul Steal'); put(0x80073404, 2, 37); r[8] = r[9] = r[4] = -123; }],
      [H.LEARN, ({r}) => { assert.equal(r[4], 5); events.push('Learn Soul Steal'); r[2] = 0; r[8] = -999; }]
    ]);
    const result = run(game, K.branchTarget(K.u32(game, H.HOOK), base + H.HOOK), memory,
      {16: 1234, 17: 2345, 18: 3456}, [], calls);
    assert.equal(result.r[29], 0x801FFF00 | 0); assert.equal(result.r[16], 1234);
    assert.equal(result.r[17], 2345); assert.equal(result.r[18], 3456);
    count++; return {...result, events};
  }
  for (const hand of [0, 1]) for (const facing of [0, 1]) for (const step of [0, 1]) {
    const result = scenario({hand, facing, step, directions: true});
    assert.deepEqual(result.events, ['Soul Steal', 'Learn Soul Steal']); assert.equal(result.r[2], 1);
    assert.equal(result.get(0x80097BB0, 4), 0); assert.equal(result.get(0x80138FC8, 4), 0);
  }
  for (const spec of [{mp: cost - 1}, {mp: 0}, {combo: 0}, {combo: 1}, {tapped: 0},
    {swords: [0, 0]}, {swords: [123, 0], tapped: 0x20}, {swords: [0, 123], tapped: 0x80},
    {step: 2}, {step: 3}, {step: 4}, {step: 37}, {locked: 0x8000}, {directions: true, expire: true}]) {
    const result = scenario(spec); assert.deepEqual(result.events, []); assert.equal(result.r[2], 0);
    assert.equal(result.get(0x80097BB0, 4), spec.mp ?? cost);
  }
  for (const swords of [[123, 0], [0, 123], [123, 123]]) assert.equal(scenario({swords, tapped: 0xA0}).r[2], 1);
  const natural = scenario({natural: true, combo: 0, swords: [0, 0]});
  assert.deepEqual(natural.events, ['Soul Steal', 'Learn Soul Steal']); assert.equal(natural.r[2], 1);
  assert.equal(natural.get(0x80097BB0, 4), 0);
  const expired = dra.slice(); expired[H.CAVE] = 1; assert.throws(() => H.prepare(expired));
  const wrong = dra.slice(); wrong[H.HOOK] ^= 1; assert.throws(() => H.prepare(wrong));
  const changed = [];
  for (let n = 0; n < dra.length; n++) if (dra[n] !== after[n]) {
    assert.ok(n >= H.CAVE && n < H.CAVE + H.helper().length || n >= H.HOOK && n < H.HOOK + 4); changed.push(n);
  }
  assert.ok(changed.length); assert.deepEqual(after.subarray(0x84A8, 0x84BC), dra.subarray(0x84A8, 0x84BC));
  assert.deepEqual(after.subarray(0x712AC, 0x7151C), dra.subarray(0x712AC, 0x7151C));
  for (const newCost of [0, 1, 255]) {
    const result = scenario({spellCost: newCost, mp: 255});
    assert.equal(result.r[2], 1); assert.equal(result.get(0x80097BB0, 4), 255 - newCost);
  }
  console.log(`${count} Alucard Sword and native Soul Steal paths passed; ${cost} MP.`);
  return after;
}

if (require.main === module) (async () => {
  const source = process.env.SOTN_ASS_BIN || 'C:/Users/omergilla/Downloads/Castlevania - Alternate Scarlet Symphony 2.0.bin';
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const before = hash(), disc = await C.DiscImage.open(await fs.openAsBlob(source));
  await verify(await disc.readFile(await disc.findPath(['DRA.BIN']))); assert.equal(hash(), before);
})().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {verify};
