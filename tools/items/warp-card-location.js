const assert = require('node:assert/strict');
const K = require('../../stats-core.js'), H = require('./warp-cards.js'), G = require('./warp-card-graphics.js');
function prepareInstalled(dra) {
  const expected = Buffer.alloc(H.END - H.CAVE);
  for (const {start, bytes} of H.helpers()) expected.set(bytes, start - H.CAVE);
  for (const [off, values] of [[H.SCORPION_RECORD, [192, 132, 16, 0, 11]], [H.NOIL_RECORD, [192, 132, 0, 0, 43]]])
    values.forEach((v, n) => K.put16(expected, off - H.CAVE + n * 2, v));
  assert.deepEqual(Buffer.from(dra.subarray(H.CAVE, H.END)), expected, 'Unknown installed card destinations.');
  for (const [off, target, call] of [[H.HOOK, H.ACTIVATE, true], [H.TRANSITION_HOOK, H.TRANSITION, false], [H.SELECT_HOOK, H.SELECT, false], [G.HOOK, G.CAVE, true]])
    assert.equal(K.u32(dra, off), H.jump(H.BASE + target, call));
  assert.deepEqual(Buffer.from(dra.subarray(G.CAVE, G.CAVE + G.helper().length)), G.helper());
  const after = new Uint8Array(dra);
  K.put16(after, H.SCORPION_RECORD + 8, H.WRP_STAGE);
  K.put16(after, H.NOIL_RECORD + 8, H.RWRP_STAGE);
  return after;
}
module.exports = {prepareInstalled};
