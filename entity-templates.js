(() => {
  "use strict";

  const ITEM_SYMBOLS = new Set(["E_PRIZE_DROP", "E_EQUIP_ITEM_DROP", "E_PERSISTENT_ITEM_DROP", "E_RELIC_ORB"]);
  const isEntry = e => e && e.x !== -2 && e.x !== -1 && e.y !== -2 && e.y !== -1 && e.id > 0;
  const entries = stage => stage?.entityLayouts?.entities?.flatMap(bank => bank.filter(isEntry)) || [];

  function templates(stage, roomIndex, areaCode, catalog, selectedRoomIndex = null) {
    const room = stage?.rooms?.[roomIndex];
    if (!room || !stage.originalEntities || (selectedRoomIndex !== null && !stage.rooms[selectedRoomIndex])) return [];
    const choices = new Map();
    for (const [sourceRoomIndex, sourceRoom] of stage.rooms.entries()) {
      if (selectedRoomIndex !== null) {
        if (sourceRoomIndex !== selectedRoomIndex) continue;
      } else if (sourceRoom.entityGfxId !== room.entityGfxId) continue;
      const bankIndex = stage.entityLayouts.indices[sourceRoom.entityLayoutId];
      const bank = stage.originalEntities[bankIndex];
      if (!bank) continue;
      for (const entity of bank) {
        if (!isEntry(entity) || ![0, 0xA0].includes(entity.flags & 0xE0) || (entity.flags & 3) !== 0) continue;
        const type = catalog.typeFor(areaCode, entity.id);
        if (!type.documented) continue;
        const key = `${entity.id}:${entity.flags}:${entity.params}:${entity.spawnId ? 1 : 0}`;
        const current = choices.get(key);
        if (current && current.sourceRoomIndex === roomIndex) continue;
        choices.set(key, {
          key, entity: {...entity}, sourceRoomIndex, type,
          group: ITEM_SYMBOLS.has(type.symbol) ? "Items" : "Stage entities"
        });
      }
    }
    return [...choices.values()].sort((a, b) => a.group.localeCompare(b.group) || a.type.name.localeCompare(b.type.name) || a.entity.params - b.entity.params);
  }

  function freeSlot(stage, omit = null) {
    const used = new Set(entries(stage).filter(e => e !== omit).map(e => e.slot));
    for (let slot = 1; slot < 96; slot++) if (!used.has(slot)) return slot;
    return null;
  }

  function freePersistenceIndex(stage, omit = null) {
    const used = new Set(entries(stage).filter(e => e !== omit).map(e => e.spawnId));
    for (let id = 1; id < 256; id++) if (!used.has(id)) return id;
    return null;
  }

  function makeEntity(stage, choice, x, y) {
    if (!choice?.entity || !Number.isInteger(x) || !Number.isInteger(y) || x < -32768 || x > 32767 || y < -32768 || y > 32767) return null;
    const slot = freeSlot(stage);
    const spawnId = choice.entity.spawnId ? freePersistenceIndex(stage) : 0;
    if (slot === null || spawnId === null) return null;
    const {id, flags, params} = choice.entity;
    return {x, y, id, flags, slot, spawnId, params};
  }

  function changeType(stage, entity, choice) {
    if (!entity || !choice?.entity) return null;
    const {id, flags, params} = choice.entity;
    const spawnId = choice.entity.spawnId ? (entity.spawnId || freePersistenceIndex(stage, entity)) : 0;
    if (spawnId === null) return null;
    return {...entity, id, flags, params, spawnId};
  }

  const api = {templates, freeSlot, freePersistenceIndex, makeEntity, changeType};
  const root = typeof window !== "undefined" ? window : globalThis;
  root.SotnEntityTemplates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
