const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
const BASE = 0x800A0000, CAVE = 0x2F124, LIMIT = 0x2F324;
const FLAG = 0x8003C0E7, MASK = 0x8003CA26;
const NATIVE = [
  [0x44B14, 0x44B54, 'f5b01180b95b80a84be21b474096b89d69fa4cb18eda24553acc712e4c34e2ca'],
  [0x5483C, 0x54944, '326ebd77669d5a9190d93b59c6c5c530d3f4035934cfe64775b82c8ef6b6671c'],
  [0x56FA4, 0x570DC, 'dfb6d9103615272b774cd0753d456c677be9b12745743f9fd2ecd6cb114e28a3'],
  [0x58374, 0x584CC, '5b1135f88f391d34e24aa469f6f964e6437a80087afbbb7fd9fee2d4f0971075'],
  [0x5C478, 0x5C728, 'ddcafc089e4bbb79cf67404ac5debd9349ea7c4fb14f06690deb409556565292'],
  [0x425B8, 0x427EC, '5597b8ed0448edd18423db264b9193f28a068a883bc70917615d76c4721f6418'],
  [0x42F3C, 0x43264, '396f4cff4face1538dafd46f0c95aa1c4b21f35b84f6752ba7e497534b91abb1']
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const i = (op, rs, rt, imm) => ((op << 26) | (rs << 21) | (rt << 16) | (imm & 65535)) >>> 0;
const r = (fn, rs, rt, rd) => ((rs << 21) | (rt << 16) | (rd << 11) | fn) >>> 0;
const jump = (addr, call = false) => ((call ? 0x0C000000 : 0x08000000) | (addr >>> 2 & 0x3FFFFFF)) >>> 0;
const font = str => Buffer.from([...str].map(ch => ch.charCodeAt(0) - 32).concat([255, 0]));

function helper() {
  const words = [], labels = {}, branches = [], pointers = [];
  const emit = (...w) => words.push(...w);
  const label = name => { labels[name] = words.length * 4; };
  const branch = (op, rs, rt, name, slot = 0) => { branches.push([words.length, name]); emit(i(op, rs, rt, 0), slot); };
  const pointer = (reg, name) => { pointers.push([words.length, reg, name]); emit(0, 0); };
  const go = at => emit(jump(BASE + at), 0);
  label('draw');
  emit(i(15, 0, 8, 0x8004), i(36, 8, 8, 0xC0E7));
  pointer(4, 'yes'); branch(4, 8, 0, 'drawText'); pointer(4, 'no');
  label('drawText');
  emit(i(13, 0, 5, 18), i(13, 0, 6, 144), jump(0x800F67EC, true), r(0x21, 16, 0, 7), i(35, 29, 31, 0x28), i(35,29,17,0x24)); go(0x584BC);
  label('input');
  emit(jump(0x800F9808, true), i(13, 0, 4, 2), i(35, 16, 8, 0), i(13, 0, 9, 6));
  branch(4, 8, 9, 'mapInput'); go(0x5C4C8);
  label('mapInput');
  pointer(4, 'help'); emit(i(13, 0, 5, 2), jump(0x800F99B8, true), r(0x21, 0, 0, 6));
  emit(i(15, 0, 8, 0x8009), i(37, 8, 9, 0x7494), i(37, 8, 10, 0x7496), i(12, 9, 11, 0x10));
  branch(4, 11, 0, 'adjust'); go(0x5C568);
  label('adjust');
  emit(i(15, 0, 8, 0x8004), i(36, 8, 11, 0xC0E7), i(12, 9, 9, 0x40));
  branch(4, 9, 0, 'arrows'); emit(i(14, 11, 11, 1)); branch(4, 0, 0, 'store');
  label('arrows'); emit(i(12, 10, 9, 0x8000));
  branch(4, 9, 0, 'right'); emit(r(0x21, 0, 0, 11)); branch(4, 0, 0, 'store');
  label('right'); emit(i(12, 10, 9, 0x2000)); branch(4, 9, 0, 'exit'); emit(i(13, 0, 11, 1));
  label('store'); emit(i(40, 8, 11, 0xC0E7), jump(0x801347F8, true), i(13, 0, 4, 0x633));
  label('exit'); go(0x5D344);
  label('button'); emit(i(13, 0, 8, 7)); branch(5, 19, 8, 'buttonDraw'); pointer(4, 'item');
  label('buttonDraw'); emit(jump(0x800F67EC), 0);
  label('shortcut');
  emit(i(15, 0, 15, 0x8004), i(37, 15, 15, 0xCA26), 0, r(0x24, 9, 15, 9));
  branch(5, 9, 0, 'shortcutContinue'); go(0x427A4);
  label('shortcutContinue');
  emit(r(0x21,10,0,14),r(0x21,0,0,10),i(15,0,11,0x8004));
  for (const [n,mask] of [128,32,64,16].entries()) {
    emit(i(37,11,15,0xCA18+n*2),0,r(0x24,14,15,12)); branch(4,12,0,`next${n}`); emit(i(13,10,10,mask)); label(`next${n}`);
  }
  go(0x42608);
  const parts = [];
  for (const [name, str] of [['yes', 'Show minimap: Yes'], ['no', 'Show minimap: No'], ['item', 'Item Shortcut'], ['help', 'Show minimap: Left Yes / Right No']]) {
    labels[name] = words.length * 4 + parts.reduce((n,b) => n + b.length, 0); parts.push(name === 'help' ? Buffer.from(str+'\0','ascii') : font(str));
  }
  for (const [at, name] of branches) words[at] = K.withImmediate(words[at], (labels[name] - at * 4 - 4) / 4);
  for (const [at, reg, name] of pointers) { const addr = BASE + CAVE + labels[name]; words[at] = i(15, 0, reg, addr >>> 16); words[at + 1] = i(13, reg, reg, addr); }
  const code = Buffer.alloc(words.length * 4); words.forEach((w,n) => code.writeUInt32LE(w, n*4));
  const bytes = Buffer.concat([code, ...parts]); assert.ok(CAVE + bytes.length <= LIMIT, 'Settings space is full.');
  return {bytes, labels};
}

function prepare(dra) {
  for (const [a,z,h] of NATIVE) assert.equal(sha(dra.subarray(a,z)), h, `Settings code changed at ${a.toString(16)}.`);
  assert.ok(dra.subarray(CAVE,LIMIT).every(v => v === 0), 'Settings space is occupied.');
  const m = M.parse({DRA: {bytes: dra, base: BASE}});
  assert.ok([...m.sections.equipRows,...Object.values(m.sections.body).flat()].every(row => m.get(row.icon) < 316 || m.get(row.icon) > 319), 'An item uses settings artwork space.');
  for (let a = 0; a < 0x962A8; a += 4) {
    const w = K.u32(dra,a), op = w >>> 26;
    if (op === 2 || op === 3 || (a >= 0x42000 && [1,4,5,6,7].includes(op))) { const t = K.branchTarget(w,BASE+a); assert.ok(t < BASE+CAVE || t >= BASE+LIMIT, `Code uses settings space at ${a.toString(16)}.`); }
    assert.ok(w < BASE+CAVE || w >= BASE+LIMIT, 'A pointer uses settings space.');
  }
  const out = dra.slice(), h = helper(); out.set(h.bytes,CAVE);
  for (const [at, name, call] of [[0x584B4,'draw',false],[0x5C4C0,'input',false],[0x56FF4,'button',true],[0x42600,'shortcut',false]]) {
    K.put32(out,at,jump(BASE+CAVE+h.labels[name],call)); if (!call) K.put32(out,at+4,0);
  }
  K.put32(out,0x5487C,i(10,3,2,8)); K.put32(out,0x54888,jump(BASE+0x548C0)); K.put32(out,0x5488C,0);
  K.put32(out,0x57068,i(10,19,2,8)); K.put32(out,0x5C698,i(13,0,5,8)); K.put32(out,0x5C4B4,i(13,0,5,7));
  K.put32(out,0x56FB4,i(13,0,23,128)); K.put32(out,0x57088,i(13,0,2,108));
  K.put32(out,0x4261C,i(13,0,13,4)); K.put32(out,0x4262C,i(13,0,15,1));
  assert.equal(K.u16(out,0x2E72),112); K.put16(out,0x2E72,128); K.put16(out,0x2E6C,124); K.put16(out,0x2E70,224);
  return out;
}
module.exports = {BASE,CAVE,LIMIT,FLAG,MASK,NATIVE,helper,prepare,sha,jump};
