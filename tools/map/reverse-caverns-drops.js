const assert = require('node:assert/strict');
const S = require('../../disc-stage.js');
const EC = require('../../entity-catalog.js');
const targets = [
  {room:6, x:32, y:881, from:0x70B0, slot:22, item:0xB0},
  {room:7, x:32, y:369, from:0x700C, slot:27, item:12},
  {room:7, x:32, y:305, from:0x700C, slot:28, item:12},
  {room:7, x:32, y:241, from:0x7017, slot:29, item:23},
  {room:7, x:224, y:305, from:0x700C, slot:30, item:12},
  {room:7, x:224, y:241, from:0x7017, slot:31, item:23}
];
function repair(stage) {
  assert.equal(stage.code, 'RNO4');
  assert.equal(S.prizeTableLength(stage, 190), 32);
  const b = Buffer.from(stage.bytes);
  assert.equal(b.readUInt32LE(0x44474+7*4), 0x801C4CBC);
  assert.equal(b.readUInt32LE(0x44474+8*4), 0x801C4CBC);
  assert.equal(b.readUInt32LE(0x44CE8), 0x3404000C);
  assert.equal(b.readUInt32LE(0x44D00), 0x304201FF);
  assert.equal(b.readUInt32LE(0x44D04), 0xA6020030);
  const used = new Set(stage.entityLayouts.entities.flatMap(bank => bank.map(e =>
    S.dropRule('RNO4', EC.typeFor('RNO4', e.id).symbol, e.params, stage))
    .filter(r => r?.kind === 'slot').map(r => r.slot)));
  const edits = targets.map(t => {
    const room = stage.rooms[t.room];
    const bank = stage.entityLayouts.entities[stage.entityLayouts.indices[room.entityLayoutId]];
    const matches = bank.filter(e => e.id === 1 && e.x === t.x && e.y === t.y);
    assert.equal(matches.length, 1, `Expected one pot in room ${t.room} at ${t.x}, ${t.y}`);
    assert.equal(matches[0].params, t.from, 'The reported pot changed.');
    assert(!used.has(t.slot), `Prize slot ${t.slot} is already used.`);
    assert.equal(b.readUInt16LE(stage.prizeTableOffset+t.slot*2), t.slot === 22 ? 195 : 164);
    return {...t, entity:matches[0]};
  });
  const original = Uint16Array.from({length:32}, (_,i) => b.readUInt16LE(stage.prizeTableOffset+i*2));
  stage.prizeDrops = {offset:stage.prizeTableOffset, original, values:original.slice()};
  for (const t of edits) {
    t.entity.params = 0x7000 | t.slot;
    stage.prizeDrops.values[t.slot] = t.item;
  }
  stage.entitiesDirty = true;
  return targets.map(t => ({...t, to:0x7000|t.slot}));
}
module.exports = {repair, targets};
