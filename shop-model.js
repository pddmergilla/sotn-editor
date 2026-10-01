(function (global) {
  "use strict";
  // Master Librarian's shop (src/st/lib/e_shop.c). Every table is found from
  // the code that reads it, so a LIB.BIN whose shop code was changed is
  // reported instead of guessed at.
  const K = global.SotnStatsCore || (typeof require === "function" ? require("./stats-core.js") : null);
  const CAT = global.SotnStatsCatalog || (typeof require === "function" ? require("./stats-catalog.js") : null);
  const {u16, u32} = K;
  const FILE = "ST/LIB", BASE = 0x80180000;
  const RELICS_LO = 0x7964; // g_Status.relics at 0x80097964
  const ENTRY = 8, SELL_COUNT = 7, TACTICS_COUNT = 23, DOCUMENTS = 6, SCROLLS = 5, BOSS_NAMES = 29;
  const MAX_PRICE = 99999999; // the shop draws 8 digits
  const hex = v => "0x" + (v >>> 0).toString(16).toUpperCase();

  const TEMPLATES = {
    // func_us_801B29C4 builds the visible list from InventoryItem[].
    inventory: ["lui s1,*", "addiu s1,s1,*", "sw ra,32(sp)", "sw s3,28(sp)", "sw s0,16(sp)"],
    relicCheck: ["ori v0,zero,0xff", "bne a0,v0,*", "nop", "lui v0,0x8009", "lbu v0,*(v0)"],
    scrollSpells: ["lui t3,*", "addiu t3,t3,*", "addiu t2,s3,*", "addiu a2,s1,4", "addiu a3,s2,4", "lbu v1,-3(a2)"],
    scrollLevels: ["ori v1,zero,0xff", "lui at,*", "addu at,at,a1", "lbu v1,*(at)"],
    count: ["addiu a2,a2,8", "slti v0,t0,*", "bne v0,zero,*", "addiu s1,s1,8"],
    sell: ["lui a1,*", "addiu a1,a1,*", "j *", "nop", "jal *", "nop", "sh v0,136(s2)"],
    tactics: ["sll v0,v0,3", "lui v1,*", "addiu v1,v1,*", "addu s1,v0,v1", "lhu a0,2(s1)", "nop", "srl v0,a0,3"],
    relicIds: ["sll v0,v0,1", "lui at,*", "addu at,at,v0", "lhu a0,*(at)", "lui v0,*", "lw v0,*(v0)", "nop", "jalr ra,v0", "ori a1,zero,0x2000"],
    names: ["sll v0,s2,16", "sra v0,v0,14", "lui at,*", "addu at,at,v0", "lw a3,*(at)", "j *", "addu a0,s1,zero",
      "sll v0,s2,16", "sra v0,v0,14", "lui at,*", "addu at,at,v0", "lw a3,*(at)"],
    docDescs: ["andi v1,a0,0xffff", "sll v0,v1,2", "lui at,*", "addu at,at,v0", "lw s0,*(at)", "beq v1,zero,*", "ori a0,zero,0x111"],
    menus: ["sll v0,v0,2", "lui at,*", "addu at,at,v0", "lw a0,*(at)", "nop", "lbu v0,0(a0)"],
    bossNames: ["sll v0,v1,2", "sll a2,s3,16", "sw s2,16(sp)", "lui at,*", "addu at,at,v0", "lw a3,*(at)", "jal *", "sra a2,a2,16"]
  };

  function parse(m, h) {
    const shop = m.sections.shop = {found: false};
    const file = m.files[FILE];
    if (!file) { shop.reason = "ST/LIB/LIB.BIN was not found on this disc."; return; }
    const b = file.bytes;
    const at = {};
    for (const [key, lines] of Object.entries(TEMPLATES)) {
      const hits = h.findTemplate(b, 0, b.length, lines);
      if (hits.length !== 1) throw new Error(`The library shop code (${key}) was not found in LIB.BIN (${hits.length} matches), so the shop is not editable.`);
      at[key] = hits[0];
    }
    const hiLo = (hiOff, loOff) => ((((u32(b, hiOff) & 0xFFFF) << 16) + ((u32(b, loOff) << 16) >> 16)) >>> 0);
    const local = (addr, size, what) => {
      const o = addr - BASE;
      if (o < 0 || o + size > b.length) throw new Error(`The shop's ${what} (${hex(addr)}) is outside LIB.BIN.`);
      return o;
    };
    const t = {
      inventory: local(hiLo(at.inventory, at.inventory + 4), ENTRY, "item list"),
      scrollSpells: local(hiLo(at.scrollSpells, at.scrollSpells + 4), SCROLLS * 2, "scroll spell table"),
      scrollLevels: local(hiLo(at.scrollLevels + 4, at.scrollLevels + 12), SCROLLS * 2, "scroll unlock table"),
      sell: local(hiLo(at.sell, at.sell + 4), SELL_COUNT * ENTRY, "sell list"),
      tactics: local(hiLo(at.tactics + 4, at.tactics + 8), TACTICS_COUNT * ENTRY, "tactics list"),
      relicIds: local(hiLo(at.relicIds + 4, at.relicIds + 12), 4, "relic table"),
      relicNames: local(hiLo(at.names + 8, at.names + 16), 4, "relic name"),
      docNames: local(hiLo(at.names + 36, at.names + 44), DOCUMENTS * 4, "document names"),
      docDescs: local(hiLo(at.docDescs + 8, at.docDescs + 16), DOCUMENTS * 4, "document descriptions"),
      menus: local(hiLo(at.menus + 4, at.menus + 12), 12, "menu table"),
      bossNames: local(hiLo(at.bossNames + 12, at.bossNames + 20), BOSS_NAMES * 4, "boss names")
    };
    const countOff = at.count + 4, count = (u32(b, countOff) << 16) >> 16;
    // The list's last entry is followed by the relic table; the loop never reads past it.
    const slots = Math.floor((t.relicIds - t.inventory) / ENTRY);
    if (slots < 1 || slots > 80 || count < 0 || count > slots) throw new Error(`The shop list size (${count} of ${slots}) does not look like the US layout.`);
    for (let i = 0; i < count; i++) if (b[t.inventory + i * ENTRY] > 6) throw new Error(`Shop entry ${i + 1} has category ${b[t.inventory + i * ENTRY]}; LIB.BIN does not look like the US layout.`);
    shop.tables = t;

    const ids = new Set();
    const num = (off, size, label, extra = {}) => { const id = h.intField(FILE, off, size, false, label, extra); ids.add(id); return id; };
    const ptr = off => local(u32(b, off), 1, "string");
    const starts = [];
    for (const [table, n] of [[t.relicNames, 1], [t.docNames, DOCUMENTS], [t.docDescs, DOCUMENTS], [t.bossNames, BOSS_NAMES]]) {
      for (let i = 0; i < n; i++) starts.push(ptr(table + i * 4));
    }
    starts.sort((x, y) => x - y);
    const text = (off, encoding, label) => {
      const dec = encoding === "font" ? K.decodeFont(b, off) : K.decodeSjis(b, off);
      if (!dec) return null;
      const {capacity, overlap} = K.stringCapacity(b, off, dec.length, starts);
      const id = m.add({id: `${FILE}:str:${off.toString(16)}`, kind: "text", file: FILE, off, encoding, label, original: dec.text,
        capacity: overlap ? dec.length : capacity, readOnly: overlap ? "Another table points inside this text." : null,
        expect: b.slice(off, off + dec.length)});
      ids.add(id);
      return id;
    };
    const imm = (off, label, extra) => {
      const id = m.add({id: `${FILE}:imm:${off.toString(16)}`, kind: "imm", file: FILE, off, label,
        original: ((u32(b, off) << 16) >> 16) - (extra.immBase || 0), expect: b.slice(off, off + 4), ...extra});
      ids.add(id);
      return id;
    };

    shop.count = imm(countOff, "Listed entries", {min: 0, max: slots, hint: `slti in the list builder (LIB ${hex(BASE + countOff)}).`});
    shop.slots = slots;
    shop.entries = Array.from({length: slots}, (_, i) => {
      const o = t.inventory + i * ENTRY;
      return {index: i,
        category: num(o, 1, "Category", {max: 6, ui: "shopCategory"}),
        unlock: num(o + 1, 1, "Available", {ui: "shopUnlock"}),
        item: num(o + 2, 2, "Item"),
        price: num(o + 4, 4, "Price", {max: MAX_PRICE})};
    });
    const relicCheck = u32(b, at.relicCheck + 16), owned = ((relicCheck << 16) >> 16) - RELICS_LO;
    shop.relicCheck = imm(at.relicCheck + 16, "Hide the relic entry once you own", {immBase: RELICS_LO, min: 0, max: 29, ui: "relic",
      readOnly: owned < 0 || owned > 29 ? "This check does not read a relic flag." : null,
      hint: `Entries with the relic rule stay listed until you own this relic. It is an instruction in the list builder (LIB ${hex(BASE + at.relicCheck + 16)}); vanilla checks Jewel of Open.`});
    shop.relics = [0, 1].map(i => ({slot: i, relic: num(t.relicIds + i * 2, 2, `Relic slot ${i + 1}`, {max: 29, ui: "relic"})}));
    shop.relicName = text(ptr(t.relicNames), "font", "Relic name in the list");
    shop.documents = Array.from({length: DOCUMENTS}, (_, i) => ({index: i,
      name: text(ptr(t.docNames + i * 4), "font", "Name"),
      desc: text(ptr(t.docDescs + i * 4), "sjis", "Description")}));
    shop.scrolls = Array.from({length: SCROLLS}, (_, i) => ({index: i + 1,
      spell: num(t.scrollSpells + i * 2, 2, "Teaches", {max: 7, ui: "spell"}),
      level: num(t.scrollLevels + i * 2, 1, "Unlock level", {ui: "shopLevel"})}));
    shop.sell = Array.from({length: SELL_COUNT}, (_, i) => {
      const o = t.sell + i * ENTRY;
      return {index: i, category: num(o, 2, "Category", {max: 6}), item: num(o + 2, 2, "Item", {max: 89, ui: "bodyAny"}),
        price: num(o + 4, 4, "Pays", {max: MAX_PRICE})};
    });
    shop.tactics = Array.from({length: TACTICS_COUNT}, (_, i) => {
      const o = t.tactics + i * ENTRY;
      return {index: i, boss: num(o + 2, 2, "Boss", {max: 31, ui: "boss"}), price: num(o + 4, 4, "Price", {max: MAX_PRICE})};
    });
    shop.bossNames = Array.from({length: BOSS_NAMES}, (_, i) => text(ptr(t.bossNames + i * 4), "font", `Boss ${i} name`));
    // D_us_80181340: menus for [unused on PS1, before clearing, after clearing].
    const lists = [0, 1, 2].map(i => local(u32(b, t.menus + i * 4), 1, "menu list"));
    const ends = [...lists.slice(1), t.menus];
    shop.menus = [1, 2].map(i => {
      const o = lists[i], room = Math.min(6, ends[i] - o - 1);
      if (room < 1 || b[o] > room) return null;
      return {label: i === 1 ? "Before clearing the game" : "After clearing the game",
        count: num(o, 1, "Options", {min: 1, max: room}),
        options: Array.from({length: room}, (_, k) => num(o + 1 + k, 1, `Option ${k + 1}`, {max: 5, ui: "menuOption"}))};
    }).filter(Boolean);
    shop.fieldIds = ids;
    shop.found = true;

    // A listed document past the name table or a third relic would read
    // other data as a pointer and can crash the game.
    m.checks.push(model => {
      if (![...ids].some(id => model.isChanged(id))) return null;
      const n = model.get(shop.count);
      for (const e of shop.entries.slice(0, n)) {
        const c = model.get(e.category), id = model.get(e.item), where = `Library shop entry ${e.index + 1}`;
        if (c === 0 && id >= 169) return `${where}: hand item ${id} does not exist.`;
        if (c >= 1 && c <= 4 && id >= 90) return `${where}: body item ${id} does not exist.`;
        if (c === 5 && id > 1) return `${where}: only relic slots 1 and 2 exist.`;
        if (c === 6 && id >= DOCUMENTS) return `${where}: only the castle map and magic scrolls 1-5 exist.`;
      }
      for (const menu of shop.menus) {
        const k = model.get(menu.count);
        if (!menu.options.slice(0, k).some(id => model.get(id) === 4)) return `The library menu "${menu.label}" needs an Exit option.`;
      }
      return null;
    });
  }

  // Unlock byte meanings (func_us_801B29C4). Levels 1-7 count milestones.
  function unlockLabel(v, relicName = "the relic") {
    if (v === 0) return "From the start";
    if (v >= 1 && v <= 7) return `After ${v} of 7 milestones`;
    if (v === 8) return "After clearing the game";
    if (v === 0x80) return "Until the castle map is bought";
    if (v >= 0x81 && v <= 0x85) return `Magic scroll ${v - 0x80} rule`;
    if (v === 0xFF) return `Relic rule: until you own ${relicName}`;
    return "Never listed";
  }
  const UNLOCK_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0xFF, 9];

  const api = {parse, unlockLabel, UNLOCK_VALUES, FILE, MAX_PRICE};
  global.SotnShopModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
