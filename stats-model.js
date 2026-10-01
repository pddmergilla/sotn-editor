(function (global) {
  "use strict";
  const K = global.SotnStatsCore || (typeof require === "function" ? require("./stats-core.js") : null);
  const CAT = global.SotnStatsCatalog || (typeof require === "function" ? require("./stats-catalog.js") : null);
  const {u16, s16, u32, put16, put32} = K;

  const DRA_BASE = 0x800A0000, RIC_BASE = 0x8013C000, OVERLAY_BASE = 0x80180000;
  const DRA_TEXT = 0x42398;
  const API = symbol => symbol - 0x8003C770; // DRA header offset of a g_api member
  const API_CHECK_EQUIP = 0x8003C864;
  const ICON_GFX = 0x25324, ICON_PAL = 0x388D4, ICON_COUNT = 320;
  const HAND_ITEMS = 169, BODY_ITEMS = 90, ENEMIES = 400, SPELLS = 28, SUBWEAPONS_DRA = 13, SUBWEAPONS_RIC = 31;
  const EQUIP_STRIDE = 0x34, ACC_STRIDE = 0x20, ENEMY_STRIDE = 0x28, SPELL_STRIDE = 0x1C, SUBWPN_STRIDE = 0x14;
  const STATUS = {hp: 0x7BA0, hpMax: 0x7BA4, hearts: 0x7BA8, heartsMax: 0x7BAC, mp: 0x7BB0, mpMax: 0x7BB4,
    str: 0x7BB8, con: 0x7BBC, int: 0x7BC0, lck: 0x7BC4, gold: 0x7BF0, acc2: 0x7C18};
  const STATUS_BY_OFFSET = new Map(Object.entries(STATUS).map(([k, v]) => [v, k]));
  const STAT_LABELS = {hp: "HP", hpMax: "Max HP", hearts: "Hearts", heartsMax: "Max hearts", mp: "MP", mpMax: "Max MP",
    str: "STR", con: "CON", int: "INT", lck: "LCK", gold: "Gold", acc2: "Accessory 2"};
  const SLOT_NAMES = ["hand", "head", "armor", "cloak", "accessory"];
  const hex = (v, n = 0) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");

  // ------------------------------------------------------------ templates
  // Tiny assembler for the instruction patterns below. "*" leaves the
  // immediate (or jump target / branch offset) free.
  const R = K.REG;
  function pattern(text) {
    const [mn, rest = ""] = text.trim().split(/\s+(.*)/);
    const a = rest.split(",").map(s => s.trim()).filter(Boolean);
    const reg = s => { if (!(s in R)) throw new Error(`Bad register ${s}`); return R[s]; };
    const imm = s => s === "*" ? null : Number(s) & 0xFFFF;
    const mem = s => { const m = /^(.+)\((\w+)\)$/.exec(s); return {imm: imm(m[1]), base: reg(m[2])}; };
    const I = (o, s, t, i) => ({value: ((o << 26) | (s << 21) | (t << 16) | (i ?? 0)) >>> 0, mask: i === null ? 0xFFFF0000 : 0xFFFFFFFF});
    switch (mn) {
      case "nop": return {value: 0, mask: 0xFFFFFFFF};
      case "*": return {value: 0, mask: 0};
      case "lui": return I(15, 0, reg(a[0]), imm(a[1]));
      case "ori": return I(13, reg(a[1]), reg(a[0]), imm(a[2]));
      case "addiu": return I(9, reg(a[1]), reg(a[0]), imm(a[2]));
      case "slti": return I(10, reg(a[1]), reg(a[0]), imm(a[2]));
      case "sltiu": return I(11, reg(a[1]), reg(a[0]), imm(a[2]));
      case "andi": return I(12, reg(a[1]), reg(a[0]), imm(a[2]));
      case "beq": return I(4, reg(a[0]), reg(a[1]), imm(a[2]));
      case "bne": return I(5, reg(a[0]), reg(a[1]), imm(a[2]));
      case "sw": case "lw": case "sh": case "lh": case "lhu": case "lbu": {
        const m = mem(a[1]);
        return I({sw: 43, lw: 35, sh: 41, lh: 33, lhu: 37, lbu: 36}[mn], m.base, reg(a[0]), m.imm);
      }
      case "j": return {value: (2 << 26) >>> 0, mask: 0xFC000000};
      case "jal": return {value: (3 << 26) >>> 0, mask: 0xFC000000};
      case "jalr": return {value: ((reg(a[1]) << 21) | (reg(a[0]) << 11) | 9) >>> 0, mask: 0xFFFFFFFF};
      case "addu": return {value: ((reg(a[1]) << 21) | (reg(a[2]) << 16) | (reg(a[0]) << 11) | 0x21) >>> 0, mask: 0xFFFFFFFF};
      case "sll": case "srl": case "sra":
        return {value: ((reg(a[1]) << 16) | (reg(a[0]) << 11) | ((Number(a[2]) & 31) << 6) | {sll: 0, srl: 2, sra: 3}[mn]) >>> 0, mask: 0xFFFFFFFF};
      default: throw new Error(`Unsupported template instruction ${text}`);
    }
  }
  function findTemplate(bytes, start, end, lines) {
    const pats = lines.map(pattern), hits = [];
    for (let o = start & ~3; o + pats.length * 4 <= end; o += 4) {
      let ok = true;
      for (let i = 0; i < pats.length && ok; i++) ok = ((u32(bytes, o + i * 4) & pats[i].mask) >>> 0) === pats[i].value;
      if (ok) hits.push(o);
    }
    return hits;
  }

  // ------------------------------------------------------------ model
  class StatsModel {
    constructor(files) {
      this.files = files; // key -> {bytes, base, label}
      this.fields = new Map();
      this.refs = new Map();
      this.blocks = [];
      this.notes = [];
    }
    add(field) {
      if (this.fields.has(field.id)) { this.refs.set(field.id, (this.refs.get(field.id) || 1) + 1); return field.id; }
      field.value = field.original;
      this.fields.set(field.id, field);
      this.refs.set(field.id, 1);
      return field.id;
    }
    field(id) { return this.fields.get(id); }
    get(id) { return this.fields.get(id)?.value; }
    set(id, value) {
      const f = this.fields.get(id);
      if (!f) throw new Error(`Unknown field ${id}`);
      if (f.readOnly) throw new Error(`${f.label} is read-only: ${f.readOnly}`);
      const error = validate(f, value);
      if (error) throw new Error(error);
      f.value = value;
    }
    isChanged(id) { const f = this.fields.get(id); return !!f && f.value !== f.original; }
    changed() { return [...this.fields.values()].filter(f => f.value !== f.original); }
    dirty() { return this.changed().length > 0; }
    reset(id) { const f = this.fields.get(id); if (f) f.value = f.original; }
    resetAll() { for (const f of this.fields.values()) f.value = f.original; }
    changedFiles() { return [...new Set(this.changed().flatMap(f => fieldFiles(this, f)))]; }
  }

  function validate(f, value) {
    if (f.kind === "text") {
      if (typeof value !== "string") return `${f.label} must be text.`;
      let bytes;
      try { bytes = f.encoding === "font" ? K.encodeFont(value) : K.encodeSjis(value); } catch (e) { return e.message; }
      if (bytes.length > f.capacity) return `${f.label} fits ${maxChars(f)} bytes; this text needs ${bytes.length - (f.encoding === "font" ? 2 : 1)}.`;
      return null;
    }
    if (!Number.isInteger(value)) return `${f.label} must be a whole number.`;
    if (value < f.min || value > f.max) return `${f.label} must be between ${f.min} and ${f.max}.`;
    return null;
  }
  const maxChars = f => f.capacity - (f.encoding === "font" ? 2 : 1);

  function fieldFiles(model, f) {
    if (f.kind === "effect") return [...new Set(f.sites.map(s => s.file))];
    if (f.kind === "stat") return [model.blocks[f.block].file];
    if (f.kind === "sites") return [...new Set(f.sites.map(s => s.file))];
    return [f.file];
  }

  // ------------------------------------------------------------ parse
  function parse(files) {
    const dra = files.DRA?.bytes;
    if (!(dra instanceof Uint8Array) || dra.length < 0x42398) throw new Error("DRA.BIN was not found or is too small.");
    const m = new StatsModel(files);
    const ptr = (sym, what, size) => {
      const addr = u32(dra, API(sym)), off = addr - DRA_BASE;
      if (off < 0 || off + size > dra.length) throw new Error(`DRA.BIN ${what} pointer ${hex(addr)} is invalid.`);
      return off;
    };
    const t = {
      equip: ptr(0x8003C830, "equipment table", EQUIP_STRIDE * HAND_ITEMS),
      acc: ptr(0x8003C834, "accessory table", ACC_STRIDE * BODY_ITEMS),
      enemy: ptr(0x8003C808, "enemy table", ENEMY_STRIDE * ENEMIES),
      relic: ptr(0x8003C850, "relic table", 0x10 * 30)
    };
    // config_us.h lays these out back to back.
    t.subwpn = t.equip - SUBWEAPONS_DRA * SUBWPN_STRIDE;
    t.menu = t.acc + ACC_STRIDE * BODY_ITEMS;
    t.spell = t.relic - SPELLS * SPELL_STRIDE;
    m.tables = t;
    m.icons = {gfx: ICON_GFX, pal: ICON_PAL, count: ICON_COUNT};

    const known = collectStringStarts(dra, t);
    const ctx = {m, dra, t, known};
    const spellsOk = [0, 1, 2].every(i => /^[ -~]{3,}$/.test(K.decodeSjis(dra, u32(dra, t.spell + i * SPELL_STRIDE) - DRA_BASE)?.text || ""));
    const subwpnOk = t.subwpn >= 0 && Array.from({length: SUBWEAPONS_DRA}, (_, i) => dra[t.subwpn + i * SUBWPN_STRIDE + 0x10]).every(c => c < SUBWEAPONS_DRA);
    if (!spellsOk) m.notes.push("The spell table does not look like the US layout; spells and familiar attacks are hidden.");
    if (!subwpnOk) m.notes.push("The subweapon table does not look like the US layout; Alucard's subweapons are hidden.");
    m.sections = {
      alucard: null, luck: null, richter: null,
      spells: spellsOk ? parseSpells(ctx) : [], alucardSubweapons: subwpnOk ? parseAlucardSubweapons(ctx) : [],
      familiars: spellsOk ? parseFamiliars(ctx) : [], enemies: parseEnemies(ctx), body: parseBodyItems(ctx),
      relics: parseRelics(ctx)
    };
    m.sections.hand = parseHandItems(ctx);
    parseStartingStats(ctx);
    if (files.RIC?.bytes) {
      try {
        const r = parseRichter(ctx, files.RIC.bytes);
        m.sections.richterSkills = r.skills;
        m.sections.richterSubweapons = r.subweapons;
      } catch (error) { m.notes.push(error.message); }
    } else m.notes.push("BIN/RIC.BIN was not found, so Richter's attacks are unavailable.");
    parseEffects(ctx);
    parseStageValues(ctx);
    parsePotions(ctx);
    parseForms(ctx);
    const SHOP = global.SotnShopModel || (typeof require === "function" ? require("./shop-model.js") : null);
    m.checks = [];
    if (SHOP) {
      try { SHOP.parse(m, {findTemplate, intField: (...a) => intField(ctx, ...a)}); } catch (error) {
        m.sections.shop = {found: false, reason: error.message};
      }
    }
    return m;
  }

  function collectStringStarts(dra, t) {
    const set = new Set();
    const addPtr = p => { const o = p - DRA_BASE; if (o > 0 && o < dra.length) set.add(o); };
    for (let i = 0; i < 217; i++) { addPtr(u32(dra, t.equip + i * EQUIP_STRIDE)); addPtr(u32(dra, t.equip + i * EQUIP_STRIDE + 4)); }
    for (let i = 0; i < BODY_ITEMS; i++) { addPtr(u32(dra, t.acc + i * ACC_STRIDE)); addPtr(u32(dra, t.acc + i * ACC_STRIDE + 4)); }
    for (let i = 0; i < ENEMIES; i++) addPtr(u32(dra, t.enemy + i * ENEMY_STRIDE));
    for (let i = 0; i < SPELLS; i++) for (let k = 0; k < 3; k++) addPtr(u32(dra, t.spell + i * SPELL_STRIDE + k * 4));
    for (let i = 0; i < 30; i++) { addPtr(u32(dra, t.relic + i * 16)); addPtr(u32(dra, t.relic + i * 16 + 4)); }
    for (let o = t.menu; o < t.spell; o += 4) addPtr(u32(dra, o));
    return [...set].sort((a, b) => a - b);
  }

  // ---- field helpers
  function intField(ctx, file, off, size, signed, label, extra = {}) {
    const b = ctx.m.files[file].bytes;
    let v = size === 1 ? b[off] : size === 2 ? u16(b, off) : u32(b, off);
    if (extra.bonus8) v = v > 128 ? v - 256 : v;
    else if (signed) v = size === 1 ? (v << 24) >> 24 : (v << 16) >> 16;
    const [min, max] = extra.bonus8 ? [-127, 128] : signed ? (size === 1 ? [-128, 127] : [-32768, 32767]) :
      (size === 1 ? [0, 255] : size === 2 ? [0, 65535] : [0, 0xFFFFFFFF]);
    return ctx.m.add({id: `${file}:${off.toString(16)}:${size}`, kind: "int", file, off, size, signed, label,
      original: v, min: extra.min ?? min, max: extra.max ?? max, ui: extra.ui || "number", bonus8: !!extra.bonus8,
      expect: b.slice(off, off + size), hint: extra.hint});
  }
  function maskField(ctx, file, off, label) { return intField(ctx, file, off, 2, false, label, {ui: "elements"}); }
  function textField(ctx, ptrValue, encoding, label, owner) {
    const {dra, known, m} = ctx;
    const off = ptrValue - DRA_BASE;
    if (off <= 0 || off >= dra.length) return null;
    const dec = encoding === "font" ? K.decodeFont(dra, off) : K.decodeSjis(dra, off);
    if (!dec) return null;
    const {capacity, overlap} = K.stringCapacity(dra, off, dec.length, known);
    const id = `DRA:str:${off.toString(16)}`;
    const readOnly = dec.text === "" ? "Empty strings are shared by many entries." :
      overlap ? "Another table points inside this string." : null;
    const added = m.add({id, kind: "text", file: "DRA", off, encoding, label, original: dec.text, capacity: overlap ? dec.length : capacity,
      readOnly, expect: dra.slice(off, off + dec.length)});
    if (owner) (m.field(added).usedBy ??= []).push(owner);
    return added;
  }

  function parseSpells(ctx) {
    const {dra, t} = ctx, list = [];
    for (let i = 0; i < 8; i++) {
      const o = t.spell + i * SPELL_STRIDE;
      const name = K.decodeSjis(dra, u32(dra, o) - DRA_BASE)?.text || `Spell ${i}`;
      list.push({index: i, name,
        mp: intField(ctx, "DRA", o + 0x0C, 1, false, "MP cost"),
        attack: intField(ctx, "DRA", o + 0x18, 2, true, "Damage"),
        element: maskField(ctx, "DRA", o + 0x16, "Element")});
    }
    return list;
  }

  function subweaponRow(ctx, file, table, entry, labelPrefix = "") {
    const o = table + entry * SUBWPN_STRIDE;
    return {entry,
      cost: intField(ctx, file, o + 2, 2, true, `${labelPrefix}Heart cost`, {min: 0}),
      attack: intField(ctx, file, o, 2, true, `${labelPrefix}Damage`),
      element: maskField(ctx, file, o + 4, `${labelPrefix}Element`),
      // chainLimit: how many of this subweapon can be out at once (subweapons share 16 entity slots).
      chain: intField(ctx, file, o + 6, 1, false, `${labelPrefix}Max on screen`, {max: 16}),
      // nFramesInvincibility: frames an enemy can't be hit again by this row after a hit.
      cooldown: intField(ctx, file, o + 7, 1, false, `${labelPrefix}Hit cooldown`),
      crashId: ctx.m.files[file].bytes[o + 0x10]};
  }

  function parseAlucardSubweapons(ctx) {
    const {dra, t, m} = ctx, list = [];
    for (let id = 1; id <= 9; id++) {
      const row = subweaponRow(ctx, "DRA", t.subwpn, id);
      const extras = (CAT.ALUCARD_SUBWEAPON_EXTRAS[id] || []).map(x => ({...subweaponRow(ctx, "DRA", t.subwpn, x.entry), label: x.label, note: x.note}));
      list.push({id, name: CAT.SUBWEAPONS[id], ...row, extras});
    }
    // Agunea follow-up lightning (EntitySubwpnAgunea): heartCost = 5, then /2 folded to a constant.
    const hits = findTemplate(dra, DRA_TEXT, dra.length, ["ori s0,zero,*", "ori a0,zero,*", "jal *", "ori a1,zero,4",
      "addu v1,v0,zero", "ori v0,zero,1", "bne v1,v0,*", "ori v0,zero,2", "ori s0,zero,*"]);
    const agunea = list.find(s => s.id === 9);
    if (hits.length === 1) {
      const o = hits[0];
      agunea.followUp = m.add({id: `DRA:agunea:${o.toString(16)}`, kind: "agunea", file: "DRA", off: o, halfOff: o + 32,
        label: "Follow-up lightning heart cost", original: u16(dra, o), min: 0, max: 32767,
        hint: `Hard-coded in EntitySubwpnAgunea (DRA ${hex(o)}); one Heart Broach halves it (${hex(o + 32)}).`,
        expect: dra.slice(o, o + 36)});
    } else m.notes.push(`Agunea's follow-up heart cost was not found in DRA.BIN (${hits.length} matches).`);
    return list;
  }

  function parseFamiliars(ctx) {
    const {dra, t} = ctx;
    return CAT.FAMILIARS.map(f => {
      const p = u32(dra, t.menu + f.menu * 4);
      const name = textField(ctx, p, "font", "Name", `Familiar ${f.fallback}`);
      return {name, fallback: f.fallback, attacks: f.attacks.map(a => {
        const o = t.spell + a.spell * SPELL_STRIDE;
        return {label: a.label, spell: a.spell, note: a.note,
          attack: intField(ctx, "DRA", o + 0x18, 2, true, "Damage"),
          element: maskField(ctx, "DRA", o + 0x16, "Element")};
      })};
    });
  }

  function parseEnemies(ctx) {
    const {dra, t} = ctx, list = [];
    let current = null;
    for (let i = 0; i < ENEMIES; i++) {
      const o = t.enemy + i * ENEMY_STRIDE, p = u32(dra, o);
      const dec = K.decodeFont(dra, p - DRA_BASE);
      const named = !!dec && dec.text.trim() !== "";
      const stats = {index: i,
        attack: intField(ctx, "DRA", o + 0x06, 2, true, "Damage"),
        element: maskField(ctx, "DRA", o + 0x08, "Element")};
      if (named) {
        current = {...stats, name: textField(ctx, p, "font", "Name", `Enemy #${i}`), nameText: dec.text,
          hp: intField(ctx, "DRA", o + 0x04, 2, true, "HP"),
          defense: intField(ctx, "DRA", o + 0x0A, 2, true, "DEF"),
          level: intField(ctx, "DRA", o + 0x16, 2, false, "LVL"),
          exp: intField(ctx, "DRA", o + 0x18, 2, false, "EXP"),
          weak: maskField(ctx, "DRA", o + 0x0E, "Weak to"),
          resist: maskField(ctx, "DRA", o + 0x10, "Resists"),
          immune: maskField(ctx, "DRA", o + 0x12, "Immune to"),
          absorb: maskField(ctx, "DRA", o + 0x14, "Absorbs"),
          drop1: intField(ctx, "DRA", o + 0x1A, 2, false, "Rare drop", {ui: "drop"}),
          drop2: intField(ctx, "DRA", o + 0x1C, 2, false, "Uncommon drop", {ui: "drop"}),
          rate1: intField(ctx, "DRA", o + 0x1E, 2, false, "Rare drop rate", {hint: "Out of 256, before LCK and Ring of Arcana."}),
          rate2: intField(ctx, "DRA", o + 0x20, 2, false, "Uncommon drop rate", {hint: "Out of 256, before LCK."}),
          label: CAT.ENEMY_LABELS[i], attacks: []};
        list.push(current);
      } else if (current && i >= 6) {
        current.attacks.push({...stats, label: CAT.ENEMY_LABELS[i] || `Attack #${i}`,
          hp: intField(ctx, "DRA", o + 0x04, 2, true, "HP")});
      }
    }
    return list;
  }

  // Every g_EquipDefs row, including rows 169-216 that hold weapon specials,
  // shield spells and Axe Armor. All 42 data bytes are fields so a row can be copied.
  const ROW_LAYOUT = [
    ["attack", 0x08, 2, true, "ATK"], ["defense", 0x0A, 2, true, "DEF"], ["element", 0x0C, 2, false, "Element", {ui: "elements"}],
    ["category", 0x0E, 1, false, "Category"], ["weaponId", 0x0F, 1, false, "Weapon overlay"], ["wpal", 0x10, 1, false, "Weapon palette"],
    ["unk11", 0x11, 1, false, "Attack behavior"], ["playerAnim", 0x12, 1, false, "Alucard animation"], ["unk13", 0x13, 1, false, "Weapon entity"],
    ["unk14", 0x14, 1, false, "Entity variant"], ["lock", 0x15, 1, false, "Lock duration"], ["chain", 0x16, 1, false, "Chain limit"],
    ["unk17", 0x17, 1, false, "←→ special row"], ["specialMove", 0x18, 1, false, "↓↘→ special row"], ["consumable", 0x19, 1, false, "Consumable"],
    ["invFrames", 0x1A, 1, false, "Enemy invincibility frames"], ["unk1B", 0x1B, 1, false, "Unknown 0x1B"],
    ["comboSub", 0x1C, 4, false, "Combo bits (sub)"], ["comboMain", 0x20, 4, false, "Combo bits (main)"],
    ["mp", 0x24, 2, false, "MP cost", {ui: "cost"}], ["stun", 0x26, 2, false, "Stun frames"], ["hitType", 0x28, 2, false, "Hit type"],
    ["hitEffect", 0x2A, 2, false, "Hit effect"], ["icon", 0x2C, 2, false, "Icon", {max: ICON_COUNT - 1}],
    ["palette", 0x2E, 2, false, "Icon palette", {max: ICON_COUNT - 1}], ["crit", 0x30, 2, false, "Critical rate"]
  ];
  const EQUIP_ROWS = 217;
  function parseHandItems(ctx) {
    const {dra, t, m} = ctx, rows = [];
    for (let i = 0; i < EQUIP_ROWS; i++) {
      const o = t.equip + i * EQUIP_STRIDE, row = {index: i, effects: []};
      if (i < HAND_ITEMS) {
        row.name = textField(ctx, u32(dra, o), "font", "Name", `Hand item #${i}`);
        row.desc = textField(ctx, u32(dra, o + 4), "sjis", "Description", `Hand item #${i}`);
      }
      for (const [key, off, size, signed, label, extra] of ROW_LAYOUT) row[key] = intField(ctx, "DRA", o + off, size, signed, label, extra);
      rows.push(row);
    }
    m.sections.equipRows = rows;
    return rows.slice(0, HAND_ITEMS);
  }

  function parseRelics(ctx) {
    const {dra, t} = ctx, list = [];
    for (let i = 0; i < 30; i++) {
      const p = u32(dra, t.relic + i * 16);
      list.push({index: i, name: textField(ctx, p, "sjis", "Name", `Relic #${i}`), text: K.decodeSjis(dra, p - DRA_BASE)?.text?.trim() || CAT.RELICS[i]});
    }
    return list;
  }

  function parseBodyItems(ctx) {
    const {dra, t} = ctx, groups = {head: [], armor: [], cloak: [], accessory: []};
    const typeName = ["head", "armor", "cloak", "accessory"];
    for (let i = 0; i < BODY_ITEMS; i++) {
      const o = t.acc + i * ACC_STRIDE, type = u16(dra, o + 0x1C);
      const item = {index: i, type,
        name: textField(ctx, u32(dra, o), "font", "Name", `${["Head gear", "Armor", "Cloak", "Accessory"][type] || "Body item"} #${i}`),
        desc: textField(ctx, u32(dra, o + 4), "sjis", "Description", `${["Head gear", "Armor", "Cloak", "Accessory"][type] || "Body item"} #${i}`),
        icon: intField(ctx, "DRA", o + 0x18, 2, false, "Icon", {max: ICON_COUNT - 1}),
        palette: intField(ctx, "DRA", o + 0x1A, 2, false, "Icon palette", {max: ICON_COUNT - 1}),
        attack: intField(ctx, "DRA", o + 0x08, 2, true, "ATK"),
        defense: intField(ctx, "DRA", o + 0x0A, 2, true, "DEF"),
        str: intField(ctx, "DRA", o + 0x0C, 1, false, "STR", {bonus8: true}),
        con: intField(ctx, "DRA", o + 0x0D, 1, false, "CON", {bonus8: true}),
        int: intField(ctx, "DRA", o + 0x0E, 1, false, "INT", {bonus8: true}),
        lck: intField(ctx, "DRA", o + 0x0F, 1, false, "LCK", {bonus8: true}),
        weak: maskField(ctx, "DRA", o + 0x10, "Weak to"),
        resist: maskField(ctx, "DRA", o + 0x12, "Resists"),
        immune: maskField(ctx, "DRA", o + 0x14, "Immune to"),
        absorb: maskField(ctx, "DRA", o + 0x16, "Absorbs"),
        effects: []};
      (groups[typeName[type]] || (groups.other ??= [])).push(item);
    }
    return groups;
  }

  // ---- starting stats (InitStatsAndGear)
  const isBlockWord = w => w === 0 || w === 0x3C018009 || (K.loadImmediate(w) && ((w >>> 16) & 31) !== 1) ||
    ((w >>> 26) === 43 && ((w >>> 21) & 31) === 1);

  function findStoreBlocks(code, start, end) {
    const blocks = [];
    let o = start;
    while (o < end) {
      const pc = code.pc(o);
      if (!isBlockWord(code.word(pc)) || code.isDelaySlot(pc)) { o += 4; continue; }
      let e = o;
      while (e < end && isBlockWord(code.word(code.pc(e))) && !(e > o && code.isDelaySlot(code.pc(e)))) e += 4;
      const block = simulateBlock(code, o, e);
      if (block && block.stores.some(s => s.key)) blocks.push(block);
      o = Math.max(e, o + 4);
    }
    return blocks;
  }

  function simulateBlock(code, start, end) {
    let at = null;
    const regs = new Map(), stores = [], defs = [];
    for (let o = start; o < end; o += 4) {
      const pc = code.pc(o), w = code.word(pc);
      if (w === 0) continue;
      if (w === 0x3C018009) { at = 0x80090000; continue; }
      const li = K.loadImmediate(w);
      if (li) { const d = {reg: li.reg, value: li.value, off: o, feeds: []}; regs.set(li.reg, d); defs.push(d); continue; }
      if (at === null) return null;
      const reg = (w >>> 16) & 31, offset = (w << 16) >> 16, addr = (at + offset) >>> 0;
      let src;
      if (reg === 0) src = {value: 0, zero: true};
      else if (regs.has(reg)) src = regs.get(reg);
      else {
        const ext = code.resolveConst(code.pc(start), reg);
        src = ext ? {value: ext.value, external: true, reg} : {value: null, reg};
      }
      const store = {off: o, offset: offset & 0xFFFF, key: (addr >>> 16) === 0x8009 ? STATUS_BY_OFFSET.get(addr & 0xFFFF) || null : null,
        value: src.value, src};
      if (src.feeds) src.feeds.push(store);
      stores.push(store);
    }
    const targets = code.targets();
    let interior = false;
    for (const tpc of targets.keys()) {
      const to = tpc - code.base;
      if (to > start && to < end) { interior = true; break; }
    }
    const lastDefs = new Map();
    for (const d of defs) lastDefs.set(d.reg, d);
    const live = new Map();
    for (const reg of new Set([...lastDefs.keys(), 2])) live.set(reg, code.liveAt(code.pc(end), reg));
    // The rewrite uses v0 as scratch, so v0 must be defined here or dead afterwards.
    const scratchFree = lastDefs.has(2) || !live.get(2);
    const rewritable = !interior && scratchFree && stores.every(s => s.value !== null);
    return {start, end, length: (end - start) / 4, stores, defs, lastDefs, live, rewritable, interior};
  }

  function parseStartingStats(ctx) {
    const {m, dra} = ctx;
    const init = u32(dra, API(0x8003C854)) - DRA_BASE;
    const code = new K.Code(dra, DRA_BASE, DRA_TEXT, dra.length);
    m.code = {DRA: code};
    if (init < DRA_TEXT || init >= dra.length) { m.notes.push("InitStatsAndGear was not found."); return; }
    const end = Math.min(dra.length, init + 0x1400);
    const blocks = findStoreBlocks(code, init, end);
    const has = (b, ...keys) => keys.every(k => b.stores.some(s => s.key === k));
    const richter = blocks.find(b => has(b, "hp", "str", "hearts"));
    const alucard = richter && blocks.find(b => b.start > richter.start && has(b, "str") && !has(b, "hp") && !has(b, "hpMax"));
    const hpHits = findTemplate(dra, alucard ? alucard.end : init, end, ["lui v1,0x8009", "addiu v1,v1,0x7ba4", "ori v0,zero,*", "bne s0,zero,*",
      "sw v0,0(v1)", "ori v0,zero,*", "sw v0,0(v1)", "ori v0,zero,*", "lui at,0x8009", "sw v0,0x7ba8(at)", "ori v0,zero,*",
      "lui at,0x8009", "sw v0,0x7bac(at)", "lui v0,0x8014", "lw v0,*(v0)", "ori v1,zero,*", "lui at,0x8009", "sw v1,0x7bb4(at)"]);
    const hpAt = hpHits.length === 1 ? hpHits[0] : null;
    const luck = blocks.find(b => b.start > (hpAt ?? alucard?.end ?? init) && has(b, "lck", "hpMax", "heartsMax", "acc2"));

    const blockFields = (block, section, keys) => {
      if (!block) return [];
      const index = m.blocks.push({...block, file: "DRA", section}) - 1;
      const out = [];
      for (const key of keys) {
        const store = block.stores.find(s => s.key === key);
        if (!store) continue;
        const shared = block.stores.filter(s => s.src === store.src && s !== store && !store.src.zero && !store.src.external).map(s => STAT_LABELS[s.key] || hex(s.offset));
        out.push(m.add({id: `DRA:stat:${section}:${key}`, kind: "stat", block: index, key, offset: store.offset,
          label: STAT_LABELS[key], original: store.value, min: 0, max: 65535,
          readOnly: store.value === null ? "The value is not a constant." : (!block.rewritable && (shared.length || store.src.zero || store.src.external)) ?
            "This code block cannot be rewritten safely." : null,
          hint: shared.length && !block.rewritable ? `Shares one instruction with ${shared.join(", ")}.` : undefined}));
      }
      return out;
    };
    const hpField = (off, label, key, hint) => m.add({id: `DRA:const:${off.toString(16)}`, kind: "const", file: "DRA", off, pcs: [off],
      reg: (u32(dra, off) >>> 16) & 31, label, key, original: u16(dra, off), min: 0, max: 65535, hint, expect: dra.slice(off, off + 4)});

    m.sections.richter = {fields: blockFields(richter, "richter", ["hp", "hpMax", "mp", "mpMax", "hearts", "heartsMax", "str", "con", "int", "lck"]),
      found: !!richter, note: "Prologue and Richter mode (InitStatsAndGear)."};
    const alu = [];
    if (hpAt !== null) {
      alu.push(hpField(hpAt + 8, "Max HP", "hpMax", "HP starts full."),
        hpField(hpAt + 20, "Max HP (no-hit prologue)", "hpMaxBonus", "Used instead of Max HP when Richter took no damage in the prologue."),
        hpField(hpAt + 60, "Max MP", "mpMax", "MP starts full."),
        hpField(hpAt + 28, "Hearts", "hearts"), hpField(hpAt + 40, "Max hearts", "heartsMax"));
    }
    alu.push(...blockFields(alucard, "alucard", ["str", "con", "int", "lck"]));
    m.sections.alucard = {fields: alu, found: hpAt !== null && !!alucard,
      note: "Prologue results add small bonuses on top (InitStatsAndGear)."};
    m.sections.luck = {fields: blockFields(luck, "luck", ["hp", "hpMax", "mp", "mpMax", "hearts", "heartsMax", "str", "con", "int", "lck", "acc2"]),
      found: !!luck, note: "Save name X-X!V''Q. These replace the normal values."};
    const acc2 = m.sections.luck.fields.find(id => m.field(id).key === "acc2");
    if (acc2) Object.assign(m.field(acc2), {label: "Accessory 2", ui: "bodyItem", max: 0xFF});
    parseStartingGear(ctx, init, end, luck);
  }

  // ---- Alucard's starting gear and the prologue bonus items (InitStatsAndGear)
  // Gear: one ori v0 / sw v0 pair per g_Status.equipment slot (0x80097C00 + 4 * slot). Hand slots hold
  // hand item IDs, the others body item IDs. Death still takes the vanilla Alucard items by ID.
  const GEAR_SLOTS = [["hand1", 0x7C00, "Hand 1", "hand"], ["hand2", 0x7C04, "Hand 2", "hand"], ["head", 0x7C08, "Head", "slot1"],
    ["armor", 0x7C0C, "Armor", "slot2"], ["cloak", 0x7C10, "Cloak", "slot3"], ["acc1", 0x7C14, "Accessory 1", "slot4"], ["acc2", 0x7C18, "Accessory 2", "slot4"]];
  const GEAR_CODE = [...GEAR_SLOTS.slice(0, 6).flatMap(([, off]) => ["ori v0,zero,*", "lui at,0x8009", `sw v0,${off}(at)`]),
    "ori v0,zero,*", "lui at,0x8009", "sw zero,0x7bfc(at)", "lui at,0x8009", "sw v0,0x7c18(at)"];
  const BONUS_ITEMS = [
    {key: "rescued", label: "Rescued by Maria", desc: "Given when Maria had to save Richter in the prologue (vanilla Potion)."},
    {key: "noHearts", label: "Ran out of hearts", desc: "Given when Richter ended the prologue with 0 hearts (vanilla Heart Refresh)."},
    {key: "manyHearts", label: "More than 40 hearts", desc: "Given when Richter ended the prologue with more than 40 hearts; also INT +1 (vanilla Neutron Bomb)."},
    {key: "axeArmor", label: "AXEARMOR name", desc: "Given on a cleared save named AXEARMOR (vanilla Axe Lord Armor)."}
  ];
  function parseStartingGear(ctx, init, end, luck) {
    const {m, dra} = ctx;
    m.sections.gear = {fields: [], found: false};
    m.sections.bonusItems = {fields: [], found: false};
    const hits = findTemplate(dra, init, end, GEAR_CODE);
    if (hits.length === 1) {
      const o = hits[0];
      GEAR_SLOTS.forEach(([key, , label, kind], i) => {
        const off = o + i * 12;
        m.sections.gear.fields.push(m.add({id: `DRA:gear:${off.toString(16)}`, kind: "const", file: "DRA", off, pcs: [off], reg: 2, key, label,
          original: u16(dra, off), min: 0, max: kind === "hand" ? HAND_ITEMS - 1 : BODY_ITEMS - 1, ui: `item:${kind}`, expect: dra.slice(off, off + 4)}));
      });
      m.sections.gear.found = true;
    } else m.notes.push(`Alucard's starting gear code was not found (${hits.length} matches).`);
    // AddToInventory(id, kind): a0 loaded right before the jal, a1 in its delay slot.
    const add = u32(dra, API(0x8003C84C));
    const calls = [];
    for (let o = init; o + 8 <= end; o += 4) {
      const w = u32(dra, o);
      if ((w >>> 26) !== 3 || ((w & 0x03FFFFFF) * 4 + 0x80000000) !== add) continue;
      const a0 = K.loadImmediate(u32(dra, o - 4)), a1w = u32(dra, o + 4), a1 = K.loadImmediate(a1w);
      const kind = a1w === 0x00002821 ? 0 : a1 && a1.reg === 5 ? a1.value : null; // move a1,zero
      if (a0 && a0.reg === 4 && kind !== null && kind <= 4) calls.push({call: o, a0: o - 4, a1: o + 4, id: a0.value, kind});
    }
    const gearAt = hits.length === 1 ? hits[0] : null;
    const prologue = calls.filter(c => c.call > (m.blocks.find(b => b.section === "alucard")?.end ?? init) && gearAt !== null && c.call < gearAt);
    const axe = luck ? calls.find(c => c.call > luck.end && c.call < luck.end + 0x100) : null;
    if (prologue.length === 3 && axe) {
      [...prologue, axe].forEach((c, i) => {
        const b = BONUS_ITEMS[i];
        m.sections.bonusItems.fields.push(m.add({id: `DRA:gift:${c.call.toString(16)}`, kind: "gift", file: "DRA", off: c.a0, a1Off: c.a1,
          key: b.key, label: b.label, desc: b.desc, original: c.kind << 16 | c.id, min: 0, max: 0x4FFFF, ui: "gift",
          expect: dra.slice(c.a0, c.a0 + 12)}));
      });
      m.sections.bonusItems.found = true;
    } else m.notes.push(`The prologue bonus items were not found (${prologue.length} calls${axe ? "" : ", no AXEARMOR call"}).`);
  }

  // ---- per-stage values (Max Up pickups, heart pickups, Soul Steal and blood heals)
  // Each stage overlay has its own copy of this code or data, so one field writes every stage
  // that holds the most common value; a stage that differs keeps its value and is listed.
  function stageField(m, section, id, key, label, desc, sites, range) {
    if (!sites.length) { m.notes.push(`The ${label} was not found in any stage.`); return; }
    const counts = new Map();
    for (const site of sites) counts.set(site.value, (counts.get(site.value) || 0) + 1);
    const original = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const used = sites.filter(x => x.value === original), odd = sites.filter(x => x.value !== original);
    m.sections[section].fields.push(m.add({id, kind: "sites", key, label, desc, sites: used, original, ...range,
      hint: `Set in ${used.length} stage${used.length === 1 ? "" : "s"}.` + (odd.length ?
        ` Left unchanged where it differs: ${odd.map(x => `${x.file} (${x.value})`).join(", ")}.` : "")}));
  }
  const overlays = m => Object.entries(m.files).filter(([, file]) => file.overlay);

  // CollectLifeVessel / CollectHeartVessel: g_api.func_800FE044(amount, 0x8000 or 0x4000).
  const VESSEL_CALL = ["*", "lui v0,0x8004", "lw v0,0xc848(v0)", "nop", "jalr ra,v0", "ori a1,zero,*"];
  const VESSELS = [
    {type: 0x8000, key: "hpMaxUp", label: "HP Max Up amount", desc: "Max HP gained per Life Max Up (Richter gets twice this)."},
    {type: 0x4000, key: "heartMaxUp", label: "Heart Max Up amount", desc: "Max hearts gained per Heart Max Up (Alucard only; Richter's vessel just refills hearts)."}
  ];
  // Soul Steal orbs and Dark Metamorphosis blood drops: healKind = 1; healAmount = N.
  const HEALS = [
    {key: "soulSteal", label: "Soul Steal orb heal", at: 8, desc: "HP each Soul Steal orb restores.",
      pattern: ["ori v0,zero,1", "sh v0,0(v1)", "ori v0,zero,*", "lui at,0x8007", "sh v0,0x2f78(at)"]},
    {key: "bloodDrop", label: "Blood drop heal", at: 16, desc: "HP each drop of blood restores during Dark Metamorphosis (doubled with the Bloodstone effect).",
      pattern: ["ori v0,zero,1", "sh v0,0(v1)", "lui v1,0x8004", "lw v1,0xc864(v1)", "ori v0,zero,*", "lui at,0x8007", "sh v0,0x2f78(at)"]}
  ];
  // CollectHeart: hearts += c_HeartPrizes[size], an s8 pair {small, big} read with
  // lui at,hi / addu at,at,size / lb v0,lo(at) right after loading &g_Status.hearts.
  function heartPrizeTable(b) {
    const found = new Set();
    for (let o = 16; o + 4 <= b.length; o += 4) {
      const w = u32(b, o);
      if ((w >>> 26) !== 32 || ((w >>> 21) & 31) !== 1) continue;
      const hi = u32(b, o - 8), add = u32(b, o - 4);
      if ((hi >>> 26) !== 15 || ((hi >>> 16) & 31) !== 1 || (add & 0xFFE0FFFF) !== 0x00200821) continue;
      let hearts = false;
      for (let k = 3; k <= 6 && !hearts; k++) hearts = u32(b, o - 4 * k) === 0x24A57BA8; // addiu a1,a1,0x7BA8
      if (!hearts) continue;
      const off = (((hi & 0xFFFF) << 16) + ((w << 16) >> 16) - OVERLAY_BASE) >>> 0;
      if (off + 2 <= b.length) found.add(off);
    }
    return found.size === 1 ? [...found][0] : null;
  }
  function parseStageValues(ctx) {
    const {m} = ctx;
    m.sections.vessels = {fields: []};
    m.sections.healing = m.sections.healing || {fields: []};
    const vessels = Object.fromEntries(VESSELS.map(v => [v.type, []]));
    const heals = Object.fromEntries(HEALS.map(h => [h.key, []]));
    const small = [], big = [];
    for (const [key, file] of overlays(m)) {
      const b = file.bytes;
      for (const o of findTemplate(b, 0, b.length, VESSEL_CALL)) {
        const type = u32(b, o + 20) & 0xFFFF, li = K.loadImmediate(u32(b, o));
        if (vessels[type] && li && li.reg === 4) vessels[type].push({file: key, off: o, reg: 4, value: li.value});
      }
      for (const h of HEALS) {
        const hits = findTemplate(b, 0, b.length, h.pattern);
        if (hits.length === 1) heals[h.key].push({file: key, off: hits[0] + h.at, reg: 2, value: u32(b, hits[0] + h.at) & 0xFFFF});
      }
      const table = heartPrizeTable(b);
      if (table !== null) {
        small.push({file: key, off: table, byte: true, value: (b[table] << 24) >> 24});
        big.push({file: key, off: table + 1, byte: true, value: (b[table + 1] << 24) >> 24});
      }
    }
    const hearts = {min: 0, max: 127};
    stageField(m, "vessels", "stage:smallHeart", "smallHeart", "Small Heart", "Hearts from a small heart.", small, hearts);
    stageField(m, "vessels", "stage:bigHeart", "bigHeart", "Big Heart", "Hearts from a big heart.", big, hearts);
    for (const v of VESSELS) stageField(m, "vessels", `vessel:${v.key}`, v.key, v.label, v.desc, vessels[v.type], {min: 0, max: 9999});
    for (const h of HEALS) stageField(m, "healing", `stage:${h.key}`, h.key, h.label, h.desc, heals[h.key], {min: 0, max: 9999});
  }

  // ---- HandleTransformationMP: Mist without Power of Mist checks mp - N > 0 and stores the same
  // mp - N every 8 frames (vanilla N = 10).
  const MIST_DRAIN = ["lui a0,0x8009", "addiu a0,a0,0x7bb0", "lw v0,0(a0)", "nop", "addiu v1,v0,*"];
  function parseForms(ctx) {
    const {m, dra} = ctx;
    m.sections.forms = {fields: []};
    const hits = findTemplate(dra, DRA_TEXT, dra.length, MIST_DRAIN);
    if (hits.length !== 1) { m.notes.push(`The Mist MP drain was not found in DRA.BIN (${hits.length} matches).`); return; }
    const off = hits[0] + 16;
    m.sections.forms.fields.push(m.add({id: `DRA:neg:${off.toString(16)}`, kind: "negImm", file: "DRA", off, label: "Mist MP drain",
      desc: "MP taken every 8 frames in Mist without Power of Mist; Mist needs more MP than this.", original: -s16(dra, off),
      min: 0, max: 32767, expect: dra.slice(off, off + 4)}));
  }

  // ---- potions (item-use entity in src/dra/7E4BC.c, cases 0x84-0x86)
  // Vanilla: Potion GetStatusAilmentTimer(4, 50), High Potion (5, 100), Elixir hpMax. ASS calls a helper
  // (ori v0,300 / a0 == 5 ? 800) instead and loads a constant for the Elixir slot (X-Potion 2500).
  const POTION_SWITCH = ["ori a0,zero,4", "j *", "ori a1,zero,*", "ori a0,zero,5", "ori a1,zero,*", "ori v0,zero,1", "lui at,0x8007",
    "sh v0,0x2f76(at)", "jal *", "nop", "lui at,0x8007", "sh v0,0x2f78(at)", "j *", "nop", "lui v1,0x8009", "*"];
  const POTION_HELPER = ["ori v0,zero,*", "ori v1,zero,5", "bne a0,v1,*", "nop", "ori v0,zero,*"];
  const LHU_HP_MAX = 0x94637BA4; // lhu v1,0x7BA4(v1)
  function parsePotions(ctx) {
    const {m, dra} = ctx;
    m.sections.healing = m.sections.healing || {fields: []};
    const hits = findTemplate(dra, DRA_TEXT, dra.length, POTION_SWITCH);
    if (hits.length !== 1) { m.notes.push(`The potion healing code was not found in DRA.BIN (${hits.length} matches).`); return; }
    const o = hits[0], target = (u32(dra, o + 32) & 0x03FFFFFF) * 4 + 0x80000000 - DRA_BASE; // jal target
    const helper = target > 0 && target + 28 <= dra.length && findTemplate(dra, target, target + 20, POTION_HELPER)[0] === target &&
      u32(dra, target + 20) === 0x03E00008;
    const imm = (off, label, hint) => m.add({id: `DRA:imm:${off.toString(16)}`, kind: "imm", file: "DRA", off, label,
      original: u16(dra, off), min: 0, max: 9999, hint, expect: dra.slice(off, off + 4)});
    const bonus = "The game adds 50% with the accessory the \"Longer status timers\" effect checks (Special effects).";
    const [pot, high] = helper ? [target, target + 16] : [o + 8, o + 16];
    const potion = imm(pot, "HP healed", helper ? undefined : bonus);
    const hiPotion = imm(high, "HP healed", helper ? undefined : bonus);
    const w = u32(dra, o + 60), li = K.loadImmediate(w);
    const full = w === LHU_HP_MAX;
    const elixir = full || (li && li.reg === 3) ? m.add({id: `DRA:heal:${(o + 60).toString(16)}`, kind: "healConst", file: "DRA", off: o + 60,
      label: "HP healed", original: full ? 0 : li.value, min: 0, max: 9999, hint: "0 restores all HP (vanilla Elixir).",
      expect: dra.slice(o + 60, o + 64)}) : null;
    const items = [[0x9F, potion], [0xA0, hiPotion], [0xA1, elixir]];
    for (const [index, id] of items) {
      if (!id) continue;
      const item = m.sections.hand?.[index];
      if (item) item.heal = id;
      m.field(id).item = index;
      m.sections.healing.fields.unshift(id);
    }
    m.sections.healing.fields.sort((a, b) => (m.field(a).item ?? 999) - (m.field(b).item ?? 999));
  }

  // ---- Richter (RIC.BIN)
  function parseRichter(ctx, ric) {
    const {m} = ctx;
    const table = 0x18688;
    if (ric.length < table + SUBWEAPONS_RIC * SUBWPN_STRIDE) throw new Error("RIC.BIN is too small.");
    for (let i = 0; i < SUBWEAPONS_RIC; i++) {
      if (ric[table + i * SUBWPN_STRIDE + 0x10] >= SUBWEAPONS_RIC) throw new Error("RIC.BIN's subweapon table does not look like the US layout.");
    }
    const rows = new Map();
    const row = (entry, prefix) => {
      const key = `${entry}:${prefix || ""}`;
      if (!rows.has(key)) rows.set(key, subweaponRow(ctx, "RIC", table, entry, prefix));
      return rows.get(key);
    };
    const skills = CAT.RICHTER_SKILLS.map(s => ({...row(s.entry), label: s.label, note: s.note}));
    const subweapons = [];
    for (let id = 1; id <= 9; id++) {
      const main = row(id), crashId = main.crashId;
      subweapons.push({id, name: CAT.SUBWEAPONS[id], ...main,
        extras: (CAT.RICHTER_EXTRAS[id] || []).map(x => ({...row(x.entry), label: x.label})),
        crash: crashId > 0 && crashId < SUBWEAPONS_RIC ? {entry: crashId, cost: row(crashId, "Crash ").cost, cooldown: row(crashId, "Crash ").cooldown,
          damage: (CAT.RICHTER_CRASH_DAMAGE[id] || []).map(x => ({...row(x.entry), label: x.label}))} : null});
    }
    const hits = findTemplate(ric, 0, ric.length, ["lw v1,0(a3)", "nop", "slti v0,v1,*", "bne v0,zero,*", "*", "*", "*",
      "addiu v0,v1,*", "jal *", "sw v0,0(a3)"]).filter(o => {
      const n = (u32(ric, o + 8) << 16) >> 16, sub = (u32(ric, o + 28) << 16) >> 16;
      if (n <= 0 || sub !== -n) return false;
      for (let k = 1; k <= 12; k++) if (u32(ric, o - k * 4) === 0x24E77BA8 && u32(ric, o - k * 4 - 4) === 0x3C078009) return true;
      return false;
    });
    const agunea = subweapons.find(s => s.id === 9);
    if (hits.length === 1) {
      const o = hits[0];
      agunea.followUp = m.add({id: `RIC:agunea:${o.toString(16)}`, kind: "ricAgunea", file: "RIC", off: o,
        label: "Follow-up lightning heart cost", original: s16(ric, o + 8), min: 1, max: 32767,
        hint: `Hard-coded in RicEntitySubwpnAgunea (RIC ${hex(o + 8)} and ${hex(o + 28)}).`, expect: ric.slice(o, o + 40)});
    } else m.notes.push(`Richter's Agunea follow-up cost was not found (${hits.length} matches).`);
    return {skills, subweapons};
  }

  // ---- special effects (CheckEquipmentItemCount call sites)
  function effectMeta() {
    const byGroup = new Map();
    for (const meta of [...Object.values(CAT.DRA_EFFECTS), ...Object.values(CAT.OVERLAY_EFFECTS)]) {
      if (meta.label) byGroup.set(meta.group, meta);
    }
    return byGroup;
  }

  function parseEffects(ctx) {
    const {m, dra} = ctx;
    const code = m.code.DRA, metas = effectMeta();
    const fn = u32(dra, API(API_CHECK_EQUIP));
    const groups = new Map();
    const addSite = (group, meta, site) => {
      if (!groups.has(group)) groups.set(group, {group, ...meta, sites: [], unverified: []});
      groups.get(group)[site.pcs.length ? "sites" : "unverified"].push(site);
    };
    const unlisted = site => ({label: "Unlisted equipment check",
      desc: `${site.file} code at ${hex(site.call)} checks this item (added by a mod or not catalogued).`});
    m.unverifiedSites = [];
    const place = (site, group) => {
      const resolved = site.pcs.length && site.slot !== undefined && site.slot <= 4;
      if (!resolved) { site.pcs = []; m.unverifiedSites.push(site); }
      if (group) addSite(group, metas.get(group), site);
      else if (resolved) addSite(`${site.file}-${site.call.toString(16)}`, unlisted(site), site);
    };
    for (let o = code.start; o + 4 <= code.end; o += 4) {
      const w = u32(dra, o);
      if ((w >>> 26) !== 3 || K.branchTarget(w, code.pc(o)) !== fn) continue;
      const pc = code.pc(o), a0 = code.callArg(pc, 4), a1 = code.callArg(pc, 5);
      place({file: "DRA", call: o, pcs: a0 ? a0.pcs.map(p => p - DRA_BASE) : [], item: a0?.value, slot: a1?.value},
        CAT.DRA_EFFECTS[o]?.group);
    }
    for (const [key, file] of Object.entries(m.files)) {
      if (!file.overlay) continue;
      const known = CAT.OVERLAY_SITES[key] || {};
      for (const site of scanApiSites(new K.Code(file.bytes, file.base), key)) {
        place(site, CAT.OVERLAY_EFFECTS[known[site.call]]?.group);
      }
    }
    // One item ID per effect; every verified call site gets rewritten together.
    m.effects = [];
    for (const g of groups.values()) {
      if (!g.sites.length) continue;
      const slot = g.sites[0].slot, item = g.sites[0].item;
      const consistent = g.sites.every(s => s.slot === slot && s.item === item);
      const field = m.add({id: `effect:${g.group}`, kind: "effect", group: g.group, slot, label: g.label, desc: g.desc,
        sites: g.sites, original: item, min: 0, max: 0xFFFF, ui: slot === 0 ? "handItem" : "bodyItem",
        readOnly: g.readOnly || (!consistent ? "Its checks disagree on the item." : null),
        hint: g.unverified.length ? `${g.unverified.length} check(s) in ${[...new Set(g.unverified.map(s => s.file))].join(", ")} could not be verified; they keep the current item.` : undefined});
      m.effects.push(field);
      const target = slot === 0 ? m.sections.hand[item] : findBody(m, item);
      if (target && (slot === 0 || bodySlotOf(m, item) === slot)) target.effects.push(field);
    }
  }
  const findBody = (m, index) => Object.values(m.sections.body).flat().find(i => i.index === index);
  const bodySlotOf = (m, index) => { const it = findBody(m, index); return it ? [1, 2, 3, 4][it.type] : null; };

  function scanApiSites(code, key) {
    const out = [];
    for (let o = code.start; o + 4 <= code.end; o += 4) {
      const w = u32(code.b, o);
      if ((w >>> 26) !== 0 || (w & 63) !== 9) continue;
      const r = (w >>> 21) & 31, pc = code.pc(o);
      let ok = false;
      for (let k = 1; k <= 10 && !ok; k++) {
        const x = code.word(pc - 4 * k);
        if (x === null) break;
        if (!K.regsWritten(x).includes(r)) continue;
        if ((x >>> 26) === 35) {
          const base = (x >>> 21) & 31, imm = (x << 16) >> 16;
          for (let j = 1; j <= 6; j++) {
            const y = code.word(pc - 4 * k - 4 * j);
            if (y === null) break;
            if (!K.regsWritten(y).includes(base)) continue;
            ok = (y >>> 26) === 15 && ((((y & 0xFFFF) << 16) + imm) >>> 0) === API_CHECK_EQUIP;
            break;
          }
        }
        break;
      }
      if (!ok) continue;
      const a0 = code.callArg(pc, 4), a1 = code.callArg(pc, 5);
      out.push({file: key, call: o, pcs: a0 ? a0.pcs.map(p => p - code.base) : [], item: a0?.value, slot: a1?.value});
    }
    return out;
  }

  // ------------------------------------------------------------ drop lists
  // ITEMDROP IDs: 0x00-0x17 prizes, 0x80 + hand item, 0x80 + 169 + body item.
  const DROP_GROUPS = ["Progression", "Hearts and gold", "Subweapons", "Hand items", "Head gear", "Armor", "Cloaks", "Accessories"];
  function dropChoices(m) {
    const name = (id, fallback) => ((id && m.field(id) ? m.get(id) : "").trim() || fallback);
    const hx = v => hex(v, 2);
    const progression = new Set(CAT.PROGRESSION_DROPS);
    const bodyGroup = ["Head gear", "Armor", "Cloaks", "Accessories"];
    const items = [];
    for (let v = 0; v <= 0x17; v++) {
      items.push({value: v, label: `${CAT.PRIZE_DROPS[v]} (${hx(v)})`,
        group: progression.has(v) ? "Progression" : v >= 0x0E && v <= 0x16 ? "Subweapons" : "Hearts and gold"});
    }
    for (const h of m.sections.hand) items.push({value: 0x80 + h.index, label: `${name(h.name, `Hand item ${h.index}`)} (${hx(0x80 + h.index)})`, group: "Hand items"});
    for (const b of Object.values(m.sections.body).flat().sort((a, c) => a.index - c.index)) {
      const v = 0x80 + HAND_ITEMS + b.index, group = bodyGroup[b.type] || "Accessories";
      items.push({value: v, label: `${name(b.name, `Body item ${b.index}`)} (${hx(v)}${progression.has(v) ? `, ${group.toLowerCase()}` : ""})`,
        group: progression.has(v) ? "Progression" : group});
    }
    return DROP_GROUPS.map(group => ({group, items: items.filter(i => i.group === group)})).filter(g => g.items.length);
  }
  function relicChoices(m) {
    return (m.sections.relics || []).map(r => ({value: r.index, label: `${(r.name && m.get(r.name) || r.text || CAT.RELICS[r.index]).trim()} (#${r.index})`}));
  }

  // ------------------------------------------------------------ weapon movesets
  // Basic attack: the overlay (weaponId) plus the pose, behavior and entity bytes.
  // Specials: specialMove (down, down-forward, forward + attack) and unk17 (back,
  // forward + attack) name another g_EquipDefs row that is used as the attack.
  const STYLE_KEYS = ["weaponId", "wpal", "unk11", "playerAnim", "unk13", "unk14", "lock", "chain"];
  const AXE_ARMOR_ROW = 0xD8;
  const rowOf = (m, i) => m.sections.equipRows?.[i];
  function rowUsers(m, index) {
    return (m.sections.equipRows || []).filter(r => r.index !== index &&
      (m.get(r.specialMove) === index || m.get(r.unk17) === index)).map(r => r.index);
  }
  // Rows usable as a special: past the hand items, not Axe Armor, and not a
  // two-weapon combo target (menu.c scans rows 0xAA-0xD8 for comboSub bits).
  function specialRows(m) {
    return (m.sections.equipRows || []).filter(r => r.index >= HAND_ITEMS && r.index !== AXE_ARMOR_ROW && m.get(r.comboSub) === 0);
  }
  function freeSpecialRows(m) {
    return specialRows(m).filter(r => !rowUsers(m, r.index).length && m.get(r.comboMain) === 0);
  }
  function styleKey(m, index) { const r = rowOf(m, index); return STYLE_KEYS.map(k => m.get(r[k])).join(","); }
  function planStyleCopy(m, from, to) {
    const src = rowOf(m, from), dst = rowOf(m, to);
    return STYLE_KEYS.map(k => [dst[k], m.get(src[k])]).filter(([id, v]) => m.get(id) !== v);
  }
  // A copied special keeps every byte of its source except the combo and chain bytes.
  function planRowCopy(m, from, to) {
    const src = rowOf(m, from), dst = rowOf(m, to);
    return ROW_LAYOUT.map(([key]) => [dst[key], ["comboSub", "unk17", "specialMove"].includes(key) ? 0 : m.get(src[key])])
      .filter(([id, v]) => m.get(id) !== v);
  }

  // ------------------------------------------------------------ shield spells
  // CheckWeaponCombo (menu.c): with both attack buttons pressed, the game uses
  // the first row 0xAA-0xD8 whose comboSub shares a bit with
  // (left.comboSub & right.comboMain) | (left.comboMain & right.comboSub).
  // The spell runs in the hand holding the comboSub item, so a shield spell is
  // EntityWeaponShieldSpell in that shield's own overlay.
  const COMBO_FIRST = 0xAA, COMBO_LAST = 0xD8, SHIELD_CATEGORY = 9;
  function comboRowFor(m, bits) {
    const rows = m.sections.equipRows || [];
    for (let i = COMBO_FIRST; i <= COMBO_LAST; i++) if (rows[i] && (m.get(rows[i].comboSub) & bits)) return i;
    return null;
  }
  function comboSpells(m) {
    const rows = m.sections.equipRows || [], hand = rows.slice(0, HAND_ITEMS);
    const rowOfItem = new Map();
    for (const h of hand) {
      const bits = m.get(h.comboSub) >>> 0;
      const r = bits ? comboRowFor(m, bits) : null;
      if (r !== null) rowOfItem.set(h.index, r);
    }
    const out = [];
    for (let i = COMBO_FIRST; i <= COMBO_LAST; i++) {
      const r = rows[i], bits = r ? m.get(r.comboSub) >>> 0 : 0;
      if (!bits) continue;
      const casters = hand.filter(h => rowOfItem.get(h.index) === i).map(h => h.index);
      const triggers = hand.filter(h => (m.get(h.comboMain) & bits) !== 0).map(h => h.index);
      const isShield = h => m.get(rows[h].category) === SHIELD_CATEGORY;
      const shield = casters.length ? casters.every(isShield) :
        hand.some(h => isShield(h.index) && m.get(h.weaponId) === m.get(r.weaponId));
      out.push({index: i, bits, casters, triggers, shield});
    }
    return out;
  }
  // Overlays that carry a shield spell: one entry per weaponId shields use.
  function shieldOverlays(m) {
    const groups = new Map();
    for (const h of (m.sections.equipRows || []).slice(0, HAND_ITEMS)) {
      if (m.get(h.category) !== SHIELD_CATEGORY) continue;
      const w = m.get(h.weaponId);
      if (!groups.has(w)) groups.set(w, []);
      groups.get(w).push(h.index);
    }
    return [...groups].map(([weaponId, owners]) => ({weaponId, owners}));
  }
  const latest = pairs => [...new Map(pairs).entries()];
  // Attach a spell row to another shield. The shields swap spells, and each takes
  // the other's overlay bytes so the effect follows the spell.
  function planAttach(m, rowIndex, target) {
    const rows = m.sections.equipRows, row = rows[rowIndex];
    const spell = comboSpells(m).find(s => s.index === rowIndex);
    const old = (spell?.casters || []).filter(c => c !== target);
    const pairs = [];
    if (target === null) {
      for (const c of old) pairs.push([rows[c].comboSub, 0]);
    } else {
      const t = rows[target], targetBits = m.get(t.comboSub);
      const styleFrom = old[0] ?? rows.slice(0, HAND_ITEMS).find(h => h.index !== target && m.get(h.weaponId) === m.get(row.weaponId))?.index;
      pairs.push([t.comboSub, m.get(row.comboSub)]);
      if (styleFrom !== undefined) pairs.push(...planStyleCopy(m, styleFrom, target));
      for (const c of old) {
        pairs.push([rows[c].comboSub, targetBits]);
        if (targetBits) pairs.push(...planStyleCopy(m, target, c));
      }
    }
    return latest(pairs).filter(([id, v]) => m.get(id) !== v);
  }
  // Give a spell another shield overlay's effect; its shields load that overlay.
  function planSpellEffect(m, rowIndex, owner) {
    const rows = m.sections.equipRows, spell = comboSpells(m).find(s => s.index === rowIndex);
    const pairs = [[rows[rowIndex].weaponId, m.get(rows[owner].weaponId)]];
    for (const c of spell?.casters || []) if (c !== owner) pairs.push(...planStyleCopy(m, owner, c));
    return latest(pairs).filter(([id, v]) => m.get(id) !== v);
  }

  // ------------------------------------------------------------ build
  // files: key -> Uint8Array to modify in place (copies of the original files).
  function apply(model, targets) {
    const changed = model.changed();
    const touched = new Set();
    const need = key => {
      const b = targets[key];
      if (!(b instanceof Uint8Array)) throw new Error(`${key} is not available for writing.`);
      touched.add(key);
      return b;
    };
    const check = (f, b) => {
      if (!f.expect) return;
      for (let i = 0; i < f.expect.length; i++) if (b[f.off + i] !== f.expect[i]) {
        throw new Error(`${f.label} (${f.file} ${hex(f.off)}) was changed by another patch; stats were not written.`);
      }
    };
    for (const check of model.checks || []) {
      const error = check(model);
      if (error) throw new Error(error);
    }
    const blocks = new Map();
    for (const f of changed) {
      if (f.readOnly) throw new Error(`${f.label} is read-only: ${f.readOnly}`);
      const error = validate(f, f.value);
      if (error) throw new Error(error);
      if (f.kind === "stat") { if (!blocks.has(f.block)) blocks.set(f.block, []); blocks.get(f.block).push(f); continue; }
      if (f.kind === "effect") { writeEffect(model, f, need); continue; }
      if (f.kind === "sites") { writeSites(model, f, need); continue; }
      const b = need(f.file);
      check(f, b);
      if (f.kind === "int") {
        const v = f.bonus8 ? (f.value < 0 ? f.value + 256 : f.value) : f.value;
        if (f.size === 1) b[f.off] = v & 255; else if (f.size === 2) put16(b, f.off, v); else put32(b, f.off, v);
      } else if (f.kind === "text") {
        const bytes = f.encoding === "font" ? K.encodeFont(f.value) : K.encodeSjis(f.value);
        b.fill(0, f.off, f.off + f.capacity);
        b.set(bytes, f.off);
      } else if (f.kind === "const") {
        for (const off of f.pcs) put32(b, off, K.loadConst(f.reg, f.value));
      } else if (f.kind === "agunea") {
        put32(b, f.off, K.withImmediate(u32(b, f.off), f.value));
        put32(b, f.halfOff, K.withImmediate(u32(b, f.halfOff), Math.floor(f.value / 2)));
      } else if (f.kind === "imm") {
        put32(b, f.off, K.withImmediate(u32(b, f.off), f.value + (f.immBase || 0)));
      } else if (f.kind === "gift") {
        const kind = f.value >>> 16, a1 = K.loadImmediate(u32(b, f.a1Off));
        put32(b, f.off, K.ori(4, f.value & 0xFFFF));
        if (kind !== ((a1 && a1.reg === 5) ? a1.value : 0)) put32(b, f.a1Off, K.ori(5, kind));
      } else if (f.kind === "negImm") {
        put32(b, f.off, K.withImmediate(u32(b, f.off), -f.value));
      } else if (f.kind === "healConst") {
        put32(b, f.off, f.value === 0 ? LHU_HP_MAX : K.ori(3, f.value));
      } else if (f.kind === "ricAgunea") {
        put32(b, f.off + 8, K.withImmediate(u32(b, f.off + 8), f.value));
        put32(b, f.off + 28, K.withImmediate(u32(b, f.off + 28), -f.value));
      } else throw new Error(`Unknown field kind ${f.kind}.`);
    }
    for (const [index, fields] of blocks) writeBlock(model, model.blocks[index], fields, need);
    return [...touched];
  }

  function writeEffect(model, f, need) {
    for (const site of f.sites) {
      const b = need(site.file);
      const base = model.files[site.file].base;
      for (const off of site.pcs) {
        const w = u32(b, off), li = K.loadImmediate(w);
        const zero = (w >>> 26) === 0 && ((w & 63) === 0x21 || (w & 63) === 0x25) && ((w >>> 11) & 31) === 4;
        if (!(li && li.reg === 4 && li.value === f.original) && !(zero && f.original === 0)) {
          throw new Error(`${f.label}: ${site.file} ${hex(base + off)} no longer loads item ${f.original}.`);
        }
        put32(b, off, K.ori(4, f.value));
      }
    }
  }

  function writeSites(model, f, need) {
    for (const site of f.sites) {
      const b = need(site.file);
      const changed = () => new Error(`${f.label}: ${site.file} ${hex(model.files[site.file].base + site.off)} was changed by another patch.`);
      if (site.byte) {
        if (((b[site.off] << 24) >> 24) !== f.original) throw changed();
        b[site.off] = f.value & 255;
        continue;
      }
      const li = K.loadImmediate(u32(b, site.off));
      if (!(li && li.reg === site.reg && li.value === f.original)) throw changed();
      put32(b, site.off, K.withImmediate(u32(b, site.off), f.value));
    }
  }

  function writeBlock(model, block, fields, need) {
    const b = need(block.file);
    const start = block.start;
    for (let o = start, i = 0; o < block.end; o += 4, i++) {
      if (u32(b, o) !== u32(model.files[block.file].bytes, o)) throw new Error(`Starting stats code at ${hex(o)} was changed by another patch.`);
    }
    const next = new Map(fields.map(f => [f.key, f.value]));
    // Minimal patch when every edited value has its own load instruction.
    const inPlace = fields.every(f => {
      const s = block.stores.find(x => x.key === f.key);
      return s && s.src.feeds && s.src.feeds.length === 1 && !(block.lastDefs.get(s.src.reg) === s.src && block.live.get(s.src.reg));
    });
    if (inPlace) {
      for (const f of fields) {
        const s = block.stores.find(x => x.key === f.key);
        put32(b, s.src.off, K.loadConst(s.src.reg, f.value));
      }
      return;
    }
    if (!block.rewritable) throw new Error("This starting-stat code cannot be rewritten safely.");
    const words = [0x3C018009];
    let v0 = null;
    const valueOf = s => (s.key && next.has(s.key)) ? next.get(s.key) : s.value;
    for (const s of block.stores) {
      const v = valueOf(s);
      if (v === 0) { words.push(K.sw(0, s.offset, 1)); continue; }
      if (v0 !== v) { words.push(K.loadConst(2, v)); v0 = v; }
      words.push(K.sw(2, s.offset, 1));
    }
    for (const [reg, def] of block.lastDefs) {
      if (reg === 1 || !block.live.get(reg)) continue;
      const v = def.feeds.length ? valueOf(def.feeds.at(-1)) : def.value;
      if (reg === 2 && v0 === v) continue;
      words.push(K.loadConst(reg, v));
      if (reg === 2) v0 = v;
    }
    if (words.length > block.length) throw new Error(`New starting stats need ${words.length} instructions; only ${block.length} fit.`);
    while (words.length < block.length) words.push(0);
    words.forEach((w, i) => put32(b, start + i * 4, w));
  }

  // Reads DRA.BIN, BIN/RIC.BIN and every ST/BOSS overlay from a SotnCore.DiscImage.
  async function loadFromDisc(disc, normalize = s => String(s).replace(/;[0-9]+$/, "").toUpperCase(), progress = () => {}) {
    const files = {};
    const dra = await disc.findPath(["DRA.BIN"]);
    progress("Reading DRA.BIN...");
    files.DRA = {record: dra, bytes: await disc.readFile(dra), base: DRA_BASE, label: "DRA.BIN"};
    try {
      const ric = await disc.findPath(["BIN", "RIC.BIN"]);
      files.RIC = {record: ric, bytes: await disc.readFile(ric), base: RIC_BASE, label: "BIN/RIC.BIN"};
    } catch { /* RIC.BIN is optional */ }
    for (const group of ["ST", "BOSS"]) {
      let dirs = [];
      try { dirs = (await disc.readDirectory(await disc.findPath([group]))).filter(e => e.isDirectory); } catch { continue; }
      for (const dir of dirs) {
        const code = normalize(dir.name);
        const rec = (await disc.readDirectory(dir)).find(e => !e.isDirectory && normalize(e.name) === `${code}.BIN`);
        if (!rec) continue;
        progress(`Reading ${group}/${code}...`);
        files[`${group}/${code}`] = {record: rec, bytes: await disc.readFile(rec), base: OVERLAY_BASE, overlay: true, label: `${group}/${code}/${code}.BIN`};
      }
    }
    return parse(files);
  }

  const api = {dropChoices, relicChoices, STYLE_KEYS, rowUsers, specialRows, freeSpecialRows, styleKey, planStyleCopy, planRowCopy, HAND_ITEMS,
    comboSpells, shieldOverlays, planAttach, planSpellEffect, SHIELD_CATEGORY,
    parse, apply, loadFromDisc, findTemplate, pattern, StatsModel, validate, STATUS, DRA_BASE, RIC_BASE, OVERLAY_BASE, SLOT_NAMES, maxChars};
  global.SotnStatsModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
