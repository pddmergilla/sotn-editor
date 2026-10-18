const assert = require('node:assert/strict');
const S = require('../../disc-stage.js');
const EC = require('../../entity-catalog.js');
// Max-Up pickups that shared a collected flag with another placement, or that
// respawned because a candle named the item directly (no flag). Each target
// gets an unused prize slot of its own stage. RNO2's look-0 candles can only
// drop direct items, so they become persistent pickups (as the editor's Change
// Type does: template flags 0 and spawn ID 0; position and entity slot kept). Slots were checked against every
// placement (both copies), container lookups, BO3's NO4 mirror (slots 2, 13, 14,
// 21) and NO4's scripted Succubus drop (slot 10, src/st/no4/48248.c).
// symbol: entity type (becomes toSymbol); from: current params; to: new params; was: current
// PrizeDrops[slot]; item: new PrizeDrops[slot] (12 Heart Max-Up, 23 Life Max-Up).
const P = 'E_PERSISTENT_ITEM_DROP', B = 'E_BREAKABLE';
const STAGES = {
  NO3: {prizeTable: 0x1C8C, length: 10, flagBase: 0x30, targets: [
    {room: 14, x: 96, y: 169, symbol: P, from: 0, to: 3, slot: 3, was: 12, item: 12}]},
  NP3: {prizeTable: 0x1618, length: 10, flagBase: 0x30, targets: [
    {room: 14, x: 96, y: 169, symbol: P, from: 0, to: 3, slot: 3, was: 12, item: 12}]},
  NO4: {prizeTable: 0x1928, length: 38, flagBase: 0x40, reserved: [10], targets: [
    {room: 25, x: 1479, y: 310, symbol: P, from: 0, to: 3, slot: 3, was: 214, item: 12},
    {room: 25, x: 1516, y: 309, symbol: P, from: 0, to: 8, slot: 8, was: 309, item: 12}]},
  RNO2: {prizeTable: 0xD40, length: 12, flagBase: 0x178, targets: [
    {room: 3, x: 101, y: 65, symbol: B, toSymbol: P, from: 0x17, to: 2, slot: 2, was: 180, item: 23},
    {room: 3, x: 149, y: 65, symbol: B, toSymbol: P, from: 0x0C, to: 1, slot: 1, was: 12, item: 12},
    {room: 6, x: 161, y: 497, symbol: B, toSymbol: P, from: 0x0C, to: 4, slot: 4, was: 12, item: 12},
    {room: 6, x: 167, y: 623, symbol: B, toSymbol: P, from: 0x17, to: 3, slot: 3, was: 222, item: 23}]}
};
const u32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
// EntityPersistentItemDrop: lhu rX,0x30(self); addiu rY,rX,HEART_DROP_CASTLE_FLAG; ... sh 0xB4(self)
function flagBases(b) {
  const out = [];
  for (let o = 0; o + 28 <= b.length; o += 4) {
    const w = u32(b, o);
    if (w >>> 26 !== 37 || (w & 0xFFFF) !== 0x30) continue;
    let base = null;
    for (let k = 1; k <= 6; k++) {
      const p = u32(b, o + 4 * k);
      if (p >>> 26 === 9 && (p >>> 21 & 31) === (w >>> 16 & 31) && base === null) base = p & 0xFFFF;
      if (p >>> 26 === 41 && (p & 0xFFFF) === 0xB4) { out.push(base ?? 0); break; }
    }
  }
  return out;
}
function slotOf(code, stage, symbol, params) {
  const rule = S.dropRule(code, symbol, params, stage);
  return rule?.kind === 'slot' || rule?.kind === 'fixed' ? rule.slot : null;
}
function repair(stage) {
  const code = String(stage.code).toUpperCase(), spec = STAGES[code];
  assert(spec, `No Max-Up repair for ${code}.`);
  assert.equal(stage.prizeTableOffset, spec.prizeTable, `${code} prize table moved.`);
  assert.deepEqual(flagBases(stage.bytes), [spec.flagBase], `${code} collected-flag base changed.`);
  const b = Buffer.from(stage.bytes), ids = Object.fromEntries(EC.areaTypes(code).map(t => [t.symbol, t.id]));
  const original = Uint16Array.from({length: spec.length}, (_, i) => b.readUInt16LE(spec.prizeTable + i * 2));
  const used = new Map();
  stage.entityLayouts.entities.forEach(bank => bank.forEach(e => {
    if (e.x < 0) return;
    const slot = slotOf(code, stage, EC.typeFor(code, e.id).symbol, e.params);
    if (slot !== null) used.set(slot, (used.get(slot) || 0) + 1);
  }));
  const edits = spec.targets.map(t => {
    const room = stage.rooms[t.room];
    const bank = stage.entityLayouts.entities[stage.entityLayouts.indices[room.entityLayoutId]];
    const matches = bank.filter(e => e.id === ids[t.symbol] && e.x === t.x && e.y === t.y);
    assert.equal(matches.length, 1, `Expected one ${t.symbol} in ${code} room ${t.room} at ${t.x}, ${t.y}.`);
    assert.equal(matches[0].params, t.from, `The ${code} pickup at ${t.x}, ${t.y} changed.`);
    assert(t.slot < spec.length && !used.has(t.slot) && !(spec.reserved || []).includes(t.slot), `${code} slot ${t.slot} is in use.`);
    assert.equal(original[t.slot], t.was, `${code} PrizeDrops[${t.slot}] changed.`);
    assert.equal(slotOf(code, stage, t.toSymbol || t.symbol, t.to), t.slot);
    return {t, entity: matches[0]};
  });
  stage.prizeDrops = {offset: spec.prizeTable, original, values: original.slice()};
  for (const {t, entity} of edits) {
    if (t.toSymbol) Object.assign(entity, {id: ids[t.toSymbol], flags: 0, spawnId: 0});
    entity.params = t.to; stage.prizeDrops.values[t.slot] = t.item;
  }
  stage.entitiesDirty = true;
  return spec.targets.map(t => ({code, ...t, flag: spec.flagBase + t.slot}));
}
module.exports = {repair, STAGES, flagBases, slotOf};
