(function (global) {
  "use strict";
  const FORMAT = "sotn-editor-edits", VERSION = 1;
  const clone = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = message => { throw new Error(`Saved edits: ${message}`); };
  const hashes = new WeakMap();
  async function stageHash(stage) {
    if (!hashes.has(stage)) {
      const digest = await global.crypto.subtle.digest("SHA-256", stage.bytes);
      hashes.set(stage, Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""));
    }
    return hashes.get(stage);
  }
  function fieldShape(field) {
    const out = {};
    for (const key of ["kind", "file", "off", "size", "block", "pcs", "reg", "capacity", "encoding", "halfOff", "a1Off", "immBase"])
      if (field[key] !== undefined) out[key] = field[key];
    if (field.sites) out.sites = field.sites.map(site => ({file:site.file, off:site.off}));
    return clone(out);
  }
  const u16 = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
  function differences(values, original) {
    return Array.from(values, (to, index) => ({index, from:original[index], to})).filter(edit => edit.from !== edit.to);
  }
  function stageDirty(stage) {
    return stage.entitiesDirty || stage.rooms.some((room, i) => room.entityGfxId !== stage.originalRoomGfxIds[i]) ||
      [...stage.maps.values()].some(map => map.dirty) || [...stage.tiledefs.values()].some(td => td.dirty) ||
      stage.prizeDrops?.values.some((value, i) => value !== stage.prizeDrops.original[i]) || stage.templateSourceRooms?.size ||
      containerTables(stage).some(table => table.values.some((value, i) => value !== table.original[i]));
  }
  const containerTables = stage => [...(stage.containerDrops?.tables?.values() || [])];
  async function capture({name, stages, stats, hacks, area}) {
    const savedStages = [];
    for (const stage of stages.values()) {
      if (!stageDirty(stage)) continue;
      const maps = [], collisions = [];
      for (const [key, map] of stage.maps) {
        if (!map.dirty) continue;
        const edits = differences(map.values, Array.from(map.values, (_, i) => u16(stage.bytes, map.offset + i * 2)));
        if (edits.length) maps.push({key, offset:map.offset, length:map.values.length, edits});
      }
      for (const [key, td] of stage.tiledefs) {
        if (!td.dirty) continue;
        const edits = differences(td.collisions, stage.bytes.subarray(td.offsets[3], td.offsets[3] + td.collisions.length));
        if (edits.length) collisions.push({key, offset:td.offsets[3], length:td.collisions.length, edits});
      }
      const entities = [];
      if (stage.entitiesDirty) stage.entityLayouts.entities.forEach((bank, index) => {
        if (!same(bank, stage.originalEntities[index])) entities.push({index, from:clone(stage.originalEntities[index]), to:clone(bank)});
      });
      savedStages.push({code:stage.code, hash:await stageHash(stage), maps, collisions, entities,
        graphics:differences(stage.rooms.map(room => room.entityGfxId), stage.originalRoomGfxIds),
        prizes:stage.prizeDrops ? differences(stage.prizeDrops.values, stage.prizeDrops.original) : [],
        containers:containerTables(stage).map(table => ({offset:table.offset, length:table.values.length, edits:differences(table.values, table.original)}))
          .filter(table => table.edits.length),
        templates:Array.from(stage.templateSourceRooms || [])});
    }
    return {format:FORMAT, version:VERSION, sourceName:name, savedAt:new Date().toISOString(), area,
      stats:(stats?.changed() || []).map(field => ({id:field.id, shape:fieldShape(field), from:field.original, to:field.value})),
      stages:savedStages, hacks:hacks?.captureSession?.() || []};
  }
  function parse(text) {
    let saved;
    try { saved = JSON.parse(text); } catch { fail("this file is not valid JSON."); }
    if (saved?.format !== FORMAT || saved.version !== VERSION) fail("this file format is not supported.");
    for (const key of ["stats", "stages", "hacks"]) if (!Array.isArray(saved[key])) fail(`${key} is missing.`);
    return saved;
  }
  function unique(items, key, label) {
    const keys = items.map(item => item?.[key]);
    if (keys.some(value => value === undefined) || new Set(keys).size !== keys.length) fail(`${label} contains missing or repeated entries.`);
  }
  function editsPlan(edits, values, max, label, actions) {
    if (!Array.isArray(edits)) fail(`${label} is damaged.`);
    unique(edits, "index", label);
    for (const edit of edits) {
      if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index >= values.length ||
        !Number.isInteger(edit.from) || edit.from < 0 || edit.from > max ||
        !Number.isInteger(edit.to) || edit.to < 0 || edit.to > max) fail(`${label} has an invalid value.`);
      if (values[edit.index] !== edit.from && values[edit.index] !== edit.to) fail(`${label} conflicts with the loaded edits or BIN.`);
      if (values[edit.index] !== edit.to) actions.push(() => { values[edit.index] = edit.to; });
    }
  }
  function validateBank(bank) {
    if (!Array.isArray(bank) || bank.length < 2 || bank.length > 2048) fail("an entity bank is damaged.");
    for (const entity of bank) {
      for (const [key, min, max] of [["x",-32768,32767],["y",-32768,32767],["id",0,255],["flags",0,255],["slot",0,255],["spawnId",0,255],["params",0,65535]])
        if (!Number.isInteger(entity?.[key]) || entity[key] < min || entity[key] > max) fail("an entity has an invalid value.");
      if (entity.yOrder !== undefined && (!Number.isInteger(entity.yOrder) || entity.yOrder < 0 || entity.yOrder > 2048)) fail("an entity order is invalid.");
    }
    if (bank[0].x !== -2 || bank[0].y !== -2 || bank.at(-1).x !== -1 || bank.at(-1).y !== -1) fail("an entity bank has no end markers.");
    if (bank.slice(1,-1).some(entity => entity.x === -1 && entity.y === -1 || entity.x === -2 && entity.y === -2)) fail("an entity bank contains an extra end marker.");
  }
  async function prepare(saved, {stats, stages, hacks}) {
    const actions = [], touched = new Set();
    unique(saved.stats, "id", "stats"); unique(saved.stages, "code", "areas");
    for (const edit of saved.stats) {
      const field = stats?.field(edit.id);
      if (!field || field.readOnly || !same(fieldShape(field), edit.shape)) fail(`${edit.id} is unavailable or has a different layout.`);
      if (!same(field.value, edit.from) && !same(field.value, edit.to)) fail(`${field.label} conflicts with the loaded edits or BIN.`);
      const previous = field.value;
      try { stats.set(edit.id, edit.to); } finally { field.value = previous; }
      if (!same(previous, edit.to)) actions.push(() => stats.set(edit.id, edit.to));
    }
    for (const savedStage of saved.stages) {
      const stage = stages.get(savedStage.code);
      if (!stage || await stageHash(stage) !== savedStage.hash) fail(`${savedStage.code} was changed in this BIN; load the original compatible area.`);
      for (const [list, store, member, max] of [[savedStage.maps,stage.maps,"values",65535],[savedStage.collisions,stage.tiledefs,"collisions",255]]) {
        if (!Array.isArray(list)) fail(`${stage.code} has damaged map data.`);
        unique(list, "key", stage.code);
        for (const item of list) {
          const target = store.get(item.key), offset = member === "values" ? target?.offset : target?.offsets[3];
          if (!target || offset !== item.offset || target[member].length !== item.length) fail(`${stage.code} has a different map layout.`);
          const start = actions.length;
          editsPlan(item.edits, target[member], max, stage.code, actions);
          if (actions.length > start) actions.push(() => { target.dirty = true; });
        }
      }
      const gfx = stage.rooms.map(room => room.entityGfxId), start = actions.length;
      editsPlan(savedStage.graphics, gfx, 255, `${stage.code} room graphics`, actions);
      if (actions.length > start) actions.push(() => gfx.forEach((id, i) => { stage.rooms[i].entityGfxId = id; }));
      if (!Array.isArray(savedStage.prizes) || savedStage.prizes.length && !stage.prizeDrops) fail(`${stage.code} has no matching prize table.`);
      editsPlan(savedStage.prizes, stage.prizeDrops?.values || [], 65535, `${stage.code} prizes`, actions);
      // Files saved before container tables were editable have no list.
      const containers = savedStage.containers ?? [];
      if (!Array.isArray(containers)) fail(`${stage.code} container tables are damaged.`);
      unique(containers, "offset", `${stage.code} container tables`);
      for (const item of containers) {
        const table = stage.containerDrops?.tables?.get(item.offset);
        if (!table || table.values.length !== item.length) fail(`${stage.code} has no matching container table.`);
        editsPlan(item.edits, table.values, 65535, `${stage.code} container table`, actions);
      }
      if (!Array.isArray(savedStage.entities)) fail(`${stage.code} entities are damaged.`);
      unique(savedStage.entities, "index", `${stage.code} entities`);
      for (const edit of savedStage.entities) {
        const bank = stage.entityLayouts.entities[edit.index];
        if (!Number.isInteger(edit.index) || edit.index < 0 || !bank) fail(`${stage.code} has no matching entity bank.`);
        validateBank(edit.from); validateBank(edit.to);
        if (!same(stage.originalEntities[edit.index], edit.from) || !same(bank, edit.from) && !same(bank, edit.to)) fail(`${stage.code} entities conflict with the loaded edits.`);
        if (!same(bank, edit.to)) actions.push(() => { stage.entityLayouts.entities[edit.index] = clone(edit.to); stage.entitiesDirty = true; });
      }
      if (!Array.isArray(savedStage.templates)) fail(`${stage.code} templates are damaged.`);
      const templateKeys = new Set();
      for (const pair of savedStage.templates) {
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(index => !Number.isInteger(index) || index < 0 || index >= stage.rooms.length) || templateKeys.has(pair[0])) fail(`${stage.code} has an invalid template room.`);
        templateKeys.add(pair[0]);
        const current = stage.templateSourceRooms?.get(pair[0]);
        if (current !== undefined && current !== pair[1]) fail(`${stage.code} template rooms conflict with the loaded edits.`);
        actions.push(() => { stage.templateSourceRooms ??= new Map(); stage.templateSourceRooms.set(...pair); });
      }
      touched.add(stage.code);
    }
    const applyHacks = hacks?.prepareSession?.(saved.hacks);
    if (saved.hacks.length && !applyHacks) fail("Extra Hacks are unavailable.");
    return {touched, apply() {
      const values = stats ? [...stats.fields].map(([id, field]) => [id, field.value]) : [];
      const previous = [...touched].map(code => {
        const stage = stages.get(code);
        return {stage, entities:stage.entityLayouts.entities.slice(), entitiesDirty:stage.entitiesDirty,
          maps:[...stage.maps.values()].map(map => [map, map.values.slice(), map.dirty]),
          collisions:[...stage.tiledefs.values()].map(td => [td, td.collisions.slice(), td.dirty]),
          graphics:stage.rooms.map(room => room.entityGfxId), prizes:stage.prizeDrops?.values.slice(),
          containers:containerTables(stage).map(table => [table, table.values.slice()]),
          templates:stage.templateSourceRooms ? new Map(stage.templateSourceRooms) : undefined};
      });
      let restoreHacks;
      const restore = () => {
        restoreHacks?.();
        for (const [id, value] of values) stats.field(id).value = value;
        for (const item of previous) {
          const stage = item.stage;
          stage.entityLayouts.entities.splice(0, stage.entityLayouts.entities.length, ...item.entities); stage.entitiesDirty = item.entitiesDirty;
          for (const [map, values, dirty] of item.maps) { map.values.set(values); map.dirty = dirty; }
          for (const [td, values, dirty] of item.collisions) { td.collisions.set(values); td.dirty = dirty; }
          item.graphics.forEach((id, i) => { stage.rooms[i].entityGfxId = id; });
          if (item.prizes) stage.prizeDrops.values.set(item.prizes);
          for (const [table, values] of item.containers) table.values.set(values);
          stage.templateSourceRooms = item.templates;
        }
      };
      try { restoreHacks = applyHacks?.(); for (const action of actions) action(); }
      catch (error) { restore(); throw error; }
      return restore;
    }};
  }
  const api = {capture, parse, prepare};
  global.SotnEditSession = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
