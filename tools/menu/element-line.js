const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js');
const M = require('../../stats-model.js');

const BASE = M.DRA_BASE, CAVE = 0x2E3A4, LIMIT = 0x2EA24;
const HOOK = 0x57B38, CONTINUE = 0x57B40, DRAW_STATS = 0x574B4;
const DRAW_TEXT = 0x800F67EC, BG = 0x8013763A, X = 16, Y = 216, MAX_CHARS = 43;
const ELEMENTS = [
  [0x8000, 'FLA', 'Fire'], [0x2000, 'ICE', 'Ice'],
  [0x4000, 'LIT', 'Thunder'], [0x1000, 'HOL', 'Holy'],
  [0x0800, 'DAR', 'Dark'], [0x0400, 'WTR', 'Water'],
  [0x0080, 'PSN', 'Poison'], [0x0100, 'CUR', 'Curse'],
  [0x0200, 'STN', 'Stone'], [0x0020, 'HIT', 'Hit'],
  [0x0040, 'CUT', 'Cut']
];
const NATIVE = [
  [0x574B4, 0x57B60, 'e4cfa389283d692767436e5c109fe6d90cfa1c281c71e7308ee8033843e79279'],
  [0x54FD0, 0x553A4, 'eb2dc7e06dcf76b2c77392f0962cfab18c31d2b9cd013ae9ff7edc0a48a83f51'],
  [0x553A4, 0x553D4, '6c070ba87c5b4b1af50193a63f49a440ad5202088ec5ab935f8f154564bfba96'],
  [0x567EC, 0x568F4, '679ad0d58d12d1637c2398a5f1cd489f97709fc2f65d9d47e9fa6860f2b33279']
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const legacy = require('./element-line-v1.json');
const LEGACY = Buffer.from(legacy.base64, 'base64');
assert.equal(sha(LEGACY), legacy.sha256);
const previous = require('./element-line-v2.json');
const V2 = Buffer.from(previous.base64, 'base64');
assert.equal(sha(V2), previous.sha256);
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const r = (fn, rs, rt, rd) => ((rs << 21) | (rt << 16) | (rd << 11) | fn) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;
const font = str => Buffer.from([...str].map(ch => ch.charCodeAt(0) - 32));

// Add the current elements below the main menu.
function helper() {
  const words = [], labels = new Map(), branches = [], calls = [], pointers = [];
  const emit = (...values) => words.push(...values);
  const label = name => labels.set(name, words.length * 4);
  const branch = (op, rs, rt, name, slot = 0) => { branches.push([words.length, name]); emit(i(op, rs, rt, 0), slot); };
  const call = name => { calls.push([words.length, name]); emit(0, 0); };
  const pointer = (reg, name) => { pointers.push([words.length, reg, name]); emit(0, 0); };
  emit(i(9, 29, 29, -112), i(15, 0, 8, BG >>> 16), i(13, 8, 8, BG & 65535));
  branch(5, 18, 8, 'finish');
  emit(i(15, 0, 8, 0x8009), i(37, 8, 9, 0x7C28), i(37, 8, 10, 0x7C2A),
    i(37, 8, 11, 0x7C2C), i(37, 8, 12, 0x7C2E), i(14, 9, 13, 65535),
    r(0x24, 10, 13, 19), r(0x25, 11, 12, 11), r(0x25, 19, 11, 19),
    r(0x25, 10, 11, 10), i(14, 10, 10, 65535), r(0x24, 9, 10, 20),
    i(12, 19, 19, 0xFFE0), i(12, 20, 20, 0xFFE0),
    i(13, 0, 17, 3), i(13, 0, 21, 2));
  label('build');
  emit(i(9, 29, 16, 16), r(0x21, 19, 0, 4));
  pointer(5, 'res'); emit(i(13, 0, 6, 4)); call('group');
  emit(r(0x21, 20, 0, 4)); pointer(5, 'weak'); emit(i(13, 0, 6, 6), i(13, 0, 8, 5));
  branch(5, 21, 8, 'weakPrefix');
  emit(i(9, 5, 5, 1), i(9, 6, 6, -1));
  label('weakPrefix'); call('group');
  emit(i(9, 29, 8, 16), r(0x23, 16, 8, 8), i(11, 8, 8, MAX_CHARS + 1));
  branch(5, 8, 0, 'draw');
  branch(5, 17, 0, 'compact');
  emit(i(13, 0, 17, 3)); branch(4, 0, 0, 'build', i(13, 0, 21, 2));
  label('compact');
  emit(i(13, 0, 17, 3)); branch(4, 0, 0, 'build', i(13, 0, 21, 5));
  label('draw');
  emit(i(13, 0, 8, 255), i(40, 16, 8, 0), i(40, 16, 0, 1),
    i(9, 29, 4, 16), i(13, 0, 5, X), i(13, 0, 6, Y), jump(DRAW_TEXT, true), r(0x21, 18, 0, 7));
  label('finish');
  emit(i(9, 29, 29, 112), i(35, 29, 31, 48), i(35, 29, 21, 44), jump(BASE + CONTINUE), 0);
  label('group');
  label('prefix');
  emit(i(36, 5, 8, 0), i(9, 5, 5, 1), i(40, 16, 8, 0), i(9, 16, 16, 1), i(9, 6, 6, -1));
  branch(5, 6, 0, 'prefix');
  branch(5, 4, 0, 'list');
  emit(i(13, 0, 8, 13), i(40, 16, 8, 0), 0x03E00008, i(9, 16, 16, 1));
  label('list');
  pointer(9, 'elements'); emit(i(13, 0, 10, 11), i(13, 0, 14, 0));
  label('element');
  emit(i(37, 9, 8, 0), 0, r(0x24, 8, 4, 8));
  branch(4, 8, 0, 'next');
  branch(4, 14, 0, 'copy');
  emit(i(13, 0, 8, 5)); branch(4, 21, 8, 'copy');
  emit(i(40, 16, 0, 0), i(9, 16, 16, 1));
  label('copy');
  emit(r(0x21, 9, 21, 11), i(36, 9, 12, 7));
  branch(4, 17, 0, 'character');
  emit(r(0x21, 17, 0, 12));
  label('character');
  emit(i(36, 11, 8, 0), i(9, 11, 11, 1), i(40, 16, 8, 0), i(9, 16, 16, 1), i(9, 12, 12, -1));
  branch(5, 12, 0, 'character'); emit(i(13, 0, 14, 1));
  label('next');
  emit(i(9, 9, 9, 16), i(9, 10, 10, -1));
  branch(5, 10, 0, 'element'); emit(0x03E00008, 0);
  label('elements');
  const table = Buffer.alloc(ELEMENTS.length * 16);
  ELEMENTS.forEach(([mask, abbreviation], n) => {
    table.writeUInt16LE(mask, n * 16); table.set(font(abbreviation), n * 16 + 2);
    table.set(font(abbreviation), n * 16 + 5);
  });
  const tail = Buffer.concat([table, font('RES:'), font(' WEAK:')]);
  labels.set('res', words.length * 4 + table.length);
  labels.set('weak', words.length * 4 + table.length + 4);
  for (const [at, name] of branches) words[at] = K.withImmediate(words[at], (labels.get(name) - at * 4 - 4) / 4);
  for (const [at, name] of calls) words[at] = jump(BASE + CAVE + labels.get(name), true);
  for (const [at, reg, name] of pointers) {
    const addr = BASE + CAVE + labels.get(name);
    words[at] = i(15, 0, reg, addr >>> 16); words[at + 1] = i(13, reg, reg, addr & 65535);
  }
  const code = Buffer.alloc(words.length * 4); words.forEach((w, n) => code.writeUInt32LE(w, n * 4));
  const bytes = Buffer.concat([code, tail]); assert.ok(CAVE + bytes.length <= LIMIT, 'Helper exceeds reserved icons.');
  return bytes;
}

function withoutLine(dra) {
  const original = dra.slice();
  if (K.u32(dra, HOOK) === jump(BASE + CAVE) && K.u32(dra, HOOK + 4) === 0) {
    const known = [LEGACY, V2, helper()].find(bytes => Buffer.from(dra.subarray(CAVE, CAVE + bytes.length)).equals(bytes) && dra.subarray(CAVE + bytes.length, LIMIT).every(v => v === 0));
    assert.ok(known, 'Unrecognized installed menu line.');
    original.fill(0, CAVE, LIMIT); K.put32(original, HOOK, 0x8FBF0030); K.put32(original, HOOK + 4, 0x8FB5002C);
  }
  assert.equal(K.u32(original, HOOK), 0x8FBF0030); assert.equal(K.u32(original, HOOK + 4), 0x8FB5002C);
  assert.ok(original.subarray(CAVE, LIMIT).every(v => v === 0), 'Reserved menu space is occupied.');
  for (const [start, end, hash] of NATIVE) {
    const code = original.subarray(start, end);
    if (start === DRAW_STATS && sha(code) === '735b77f9b38d05ccb15a92d1190df396597462e2ea90530abf22242c8106e579') {
      const reviewed = Buffer.from(code);
      for (const offset of [0x57AEC, 0x57B10]) {
        assert.equal(K.u32(original, offset), 0x2665004C);
        K.put32(reviewed, offset - start, 0x26650044);
      }
      assert.equal(sha(reviewed), hash);
    } else assert.equal(sha(code), hash, `Unrecognized menu code at ${start.toString(16)}.`);
  }
  return original;
}

function prepare(dra) {
  const original = withoutLine(dra), bytes = helper();
  const m = M.parse({DRA: {bytes: original, base: BASE}}), firstIcon = (CAVE - 0x25324) / 128;
  assert.ok([...m.sections.equipRows, ...Object.values(m.sections.body).flat()].every(row => m.get(row.icon) < firstIcon), 'Equipment uses reserved menu icons.');
  for (let at = 0; at < 0x962A8; at += 4) {
    const w = K.u32(original, at), op = w >>> 26;
    if (op === 2 || op === 3) {
      const target = K.branchTarget(w, BASE + at) - BASE;
      assert.ok(target < CAVE || target >= LIMIT, `Existing code calls reserved space at ${at.toString(16)}.`);
    }
    assert.ok(w < BASE + CAVE || w >= BASE + LIMIT, `Existing pointer uses reserved space at ${at.toString(16)}.`);
  }
  const after = original; after.set(bytes, CAVE); K.put32(after, HOOK, jump(BASE + CAVE)); K.put32(after, HOOK + 4, 0);
  return after;
}

module.exports = {prepare, helper, withoutLine, LEGACY, V2, BASE, CAVE, LIMIT, HOOK, CONTINUE, DRAW_STATS, DRAW_TEXT, BG, X, Y, MAX_CHARS, ELEMENTS, NATIVE, jump, sha};
