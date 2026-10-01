const assert = require("node:assert/strict");
const K = require("../stats-core.js");
const M = require("../stats-model.js");

// Font strings: "Dagger" = 0x24 0x41 0x47 0x47 0x45 0x52, terminated by FF 00.
const dagger = Uint8Array.from([0x24, 0x41, 0x47, 0x47, 0x45, 0x52, 0xFF, 0x00, 0, 0]);
assert.deepEqual(K.decodeFont(dagger, 0), {text: "Dagger", length: 8});
assert.deepEqual([...K.encodeFont("Dagger")], [...dagger.slice(0, 8)]);
assert.throws(() => K.encodeFont("é"), /no "é"/);
// Bytes without an editable glyph survive as tokens.
const odd = Uint8Array.from([0x1B, 0x21, 0xFF, 0x9E, 0xFF, 0x00]);
const oddText = K.decodeFont(odd, 0).text;
assert.equal(oddText, "⟨1B⟩A⟨FF9E⟩");
assert.deepEqual([...K.encodeFont(oddText)], [...odd]);

// Shift-JIS descriptions round-trip, including full-width text.
const desc = K.encodeSjis("Up＋L２ to use， ok");
assert.equal(K.decodeSjis(Uint8Array.from([...desc]), 0).text, "Up＋L２ to use， ok");
assert.deepEqual([...K.encodeSjis(K.decodeSjis(Uint8Array.from([0x41, 0x80, 0x42, 0]), 0).text)], [0x41, 0x80, 0x42, 0]);

// Capacity: the string plus zero padding to the next 4-byte boundary, never past a known start.
const pool = Uint8Array.from([0x41, 0x42, 0xFF, 0x00, 0x43, 0xFF, 0x00, 0x00, 0x44]);
assert.equal(K.stringCapacity(pool, 0, 4, [0, 4, 8]).capacity, 4);
assert.equal(K.stringCapacity(pool, 4, 3, [0, 4, 8]).capacity, 4);
assert.equal(K.stringCapacity(pool, 4, 3, [0, 4, 7]).capacity, 3);

// MIPS: a constant reaching a call on every path, loaded separately on each path.
const program = words => {
  const b = new Uint8Array(words.length * 4);
  words.forEach((w, i) => K.put32(b, i * 4, w));
  return b;
};
const code = program([
  0x10400002, // 00 beq v0,zero,+2 (-> 0x0C)
  0x34040036, // 04 ori a0,zero,0x36 (delay slot: taken path)
  0x34040036, // 08 ori a0,zero,0x36 (fall-through path)
  0x0C000200, // 0C jal 0x800
  0x34050003, // 10 ori a1,zero,3
  0x03E00008, // 14 jr ra
  0x00000000
]);
const c = new K.Code(code, 0x80000000);
const a0 = c.callArg(0x8000000C, 4), a1 = c.callArg(0x8000000C, 5);
assert.deepEqual([a0.value, a0.pcs], [0x36, [0x80000004, 0x80000008]]);
assert.deepEqual([a1.value, a1.kind], [3, "ori"]);
K.put32(code, 0x08, 0x34040037); // the paths now disagree
assert.equal(new K.Code(code, 0x80000000).callArg(0x8000000C, 4), null);
// A call between the load and the site clobbers a0.
const clobber = new K.Code(program([0x34040005, 0x0C000100, 0x00000000, 0x0C000200, 0x00000000]), 0x80000000);
assert.equal(clobber.callArg(0x8000000C, 4), null);
assert.equal(c.liveAt(0x80000010, 4), false);
assert.equal(c.liveAt(0x80000010, 2), true, "v0 is the return value at jr ra");

// Templates.
const tpl = M.findTemplate(code, 0, code.length, ["ori a0,zero,*", "jal *", "ori a1,zero,3"]);
assert.deepEqual(tpl, [0x08]);
assert.equal(M.pattern("sw v0,0x7ba0(at)").value, 0xAC227BA0);

console.log("stats-core tests passed");
