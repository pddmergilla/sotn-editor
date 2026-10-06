(() => {
  "use strict";
  const K = window.SotnStatsCore, CAT = window.SotnStatsCatalog, M = window.SotnStatsModel;
  const $ = id => document.getElementById(id);
  // One StatsModel backs every view (Stats Editor, Library Shop Editor).
  let model = null;
  const views = [];
  const iconCache = new Map();
  // Set from the Extra Hacks selection: subweaponMp = Alucard's subweapons spend MP instead of hearts,
  // holyWaterRichter = Richter-style Holy Water (traveling flames).
  const modes = {subweaponMp: false, holyWaterRichter: false};
  // Item costs: bit 0x8000 makes the cost hearts (Healing items use Hearts), the rest is the amount.
  const HEART_COST = 0x8000;
  const costLabel = (id, prefix = "") => `${prefix}${model?.field(id) && model.get(id) & HEART_COST ? "Heart cost" : "MP cost"}`;
  const subweaponCostLabel = (prefix = "") => `${prefix}${modes.subweaponMp ? "MP cost" : "Heart cost"}`;

  // A view is one tab's nav + cards. DOM ids are `${prefix}Nav`, `${prefix}Content`, ...
  function createView(cfg) {
    const $$ = name => $(cfg.prefix + name);
    let hooks = {}, current = null, query = "";
    const bound = new Map(); // field id -> [{input, sync}]

    const SLOT_OF_TYPE = [1, 2, 3, 4]; // accessory equipType -> CheckEquipmentItemCount slot
    const BODY_KEYS = {1: "head", 2: "armor", 3: "cloak", 4: "accessory"};

    // ------------------------------------------------------------ DOM helpers
    function el(tag, attrs = {}, ...children) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      }
      for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
      return node;
    }
    const F = id => model.field(id);
    const val = id => model.get(id);
    const textOf = (id, fallback = "") => (id && F(id) ? val(id) : fallback);
    const hex = (v, n = 2) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");

    function bind(id, input, sync) {
      if (!bound.has(id)) bound.set(id, []);
      bound.get(id).push({input, sync});
      sync();
    }
    function syncField(id) {
      for (const b of bound.get(id) || []) if (b.input.isConnected) b.sync();
      updateBadges();
    }
    function commit(id, value, input) {
      const f = F(id), before = f.value;
      if (value === before) { syncField(id); return; }
      try { model.set(id, value); } catch (error) {
        input?.classList.add("invalid");
        input?.setAttribute("title", error.message);
        hooks.setStatus?.(error.message);
        return;
      }
      input?.classList.remove("invalid");
      const rerender = f.kind === "effect" || cfg.rerender?.(f);
      const refresh = () => rerender ? render() : syncField(id);
      hooks.pushUndo?.(`${f.label} edit`, () => { f.value = before; refresh(); });
      if (rerender) setTimeout(render, 0); else syncField(id);
      hooks.onChange?.();
    }
    function commitMany(pairs, label) {
      if (!pairs.length) return true;
      const before = pairs.map(([id]) => [id, F(id).value]);
      try { for (const [id, v] of pairs) model.set(id, v); } catch (error) {
        for (const [id, v] of before) F(id).value = v;
        hooks.setStatus?.(error.message);
        return false;
      }
      hooks.pushUndo?.(label, () => { for (const [id, v] of before) F(id).value = v; render(); });
      hooks.onChange?.();
      return true;
    }
    function markChanged(node, id) {
      const f = F(id), changed = f.value !== f.original;
      node.classList.toggle("changed", changed);
      const orig = f.kind === "text" ? `"${f.original}"` : f.ui === "elements" ? elementNames(f.original) :
        f.ui === "cost" ? `${f.original & 0x7FFF} ${f.original & HEART_COST ? "hearts" : "MP"}` : f.original;
      node.title = [f.readOnly ? `Read-only: ${f.readOnly}` : null, changed ? `Original: ${orig}` : null, f.hint].filter(Boolean).join("\n");
    }

    // ------------------------------------------------------------ controls
    function control(id, opts = {}) {
      if (!id || !F(id)) return el("span", {class: "sfMissing", text: "not found"});
      const f = F(id);
      if (f.kind === "text") return textControl(id, opts);
      if (f.ui === "elements") return elementsControl(id);
      if (f.ui === "drop") return itemSelect(id, "drop");
      if (f.kind === "effect") return itemSelect(id, f.slot === 0 ? "hand" : `slot${f.slot}`);
      if (f.ui === "bodyItem") return itemSelect(id, "slot4");
      if (f.ui?.startsWith("item:")) return itemSelect(id, f.ui.slice(5));
      if (f.ui === "gift") return giftSelect(id);
      const custom = cfg.controls?.[f.ui];
      if (custom) return custom(id, opts);
      if (f.ui === "cost") return costControl(id);
      const input = el("input", {type: "number", min: f.min, max: f.max, step: 1, class: "sfNum", disabled: !!f.readOnly});
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (input.value.trim() === "" || !Number.isInteger(v)) { input.classList.add("invalid"); return; }
        commit(id, v, input);
      });
      bind(id, input, () => { if (document.activeElement !== input) input.value = f.value; markChanged(input, id); });
      return input;
    }
    // An item cost: the number without the hearts flag, which an edit keeps.
    function costControl(id) {
      const f = F(id);
      const input = el("input", {type: "number", min: 0, max: 0x7FFF, step: 1, class: "sfNum", disabled: !!f.readOnly});
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (input.value.trim() === "" || !Number.isInteger(v) || v < 0 || v > 0x7FFF) { input.classList.add("invalid"); return; }
        commit(id, (f.value & HEART_COST) | v, input);
      });
      bind(id, input, () => { if (document.activeElement !== input) input.value = f.value & 0x7FFF; markChanged(input, id); });
      return input;
    }
    function textControl(id, opts) {
      const f = F(id);
      const input = el("input", {type: "text", class: `sfText ${opts.big ? "big" : ""}`, disabled: !!f.readOnly, spellcheck: "false"});
      const counter = el("span", {class: "sfCount"});
      const update = () => {
        let used = null;
        try { used = (f.encoding === "font" ? K.encodeFont(input.value) : K.encodeSjis(input.value)).length - (f.encoding === "font" ? 2 : 1); } catch { used = null; }
        const max = M.maxChars(f);
        counter.textContent = used === null ? "unsupported character" : `${used}/${max}`;
        counter.classList.toggle("over", used === null || used > max);
      };
      input.addEventListener("input", update);
      input.addEventListener("change", () => commit(id, input.value, input));
      bind(id, input, () => { if (document.activeElement !== input) input.value = f.value; markChanged(input, id); update(); });
      const shared = model.refs.get(id) > 1 ? el("span", {class: "sfShared", text: `shared ×${model.refs.get(id)}`,
        title: `This text is stored once and shown by ${(f.usedBy || []).join(", ") || "several entries"}. Editing it changes all of them.`}) : null;
      return el("span", {class: "sfTextWrap"}, input, counter, shared);
    }
    function elementNames(mask) {
      const names = CAT.ELEMENTS.filter(e => mask & e.bit).map(e => e.name);
      return names.length ? names.join(", ") : "None";
    }
    function elementsControl(id) {
      const f = F(id);
      const summary = el("summary", {class: "sfElSummary"});
      const box = el("details", {class: "sfElements"}, summary);
      let built = false;
      box.addEventListener("toggle", () => {
        if (!box.open || built) return;
        built = true;
        const grid = el("div", {class: "sfElGrid"});
        for (const e of CAT.ELEMENTS) {
          const cb = el("input", {type: "checkbox", disabled: !!f.readOnly});
          cb.addEventListener("change", () => commit(id, cb.checked ? (f.value | e.bit) : (f.value & ~e.bit), summary));
          bind(id, cb, () => { cb.checked = !!(f.value & e.bit); });
          grid.append(el("label", {class: `el el-${e.name.toLowerCase()}`}, cb, e.name));
        }
        box.append(grid);
      });
      bind(id, summary, () => {
        summary.textContent = elementNames(f.value);
        markChanged(summary, id);
        const low = f.value & 0x1F;
        if (low) summary.title = [summary.title, `Other flag bits ${hex(low)} are kept.`].filter(Boolean).join("\n");
      });
      return box;
    }

    function itemOptions(kind) {
      if (kind === "drop") return M.dropChoices(model);
      if (kind === "hand") return [{group: "Hand items", items: model.sections.hand.map(h => ({value: h.index, label: `${h.index} ${textOf(h.name)}`}))}];
      if (kind === "bodyAny") return [1, 2, 3, 4].map(slot => itemOptions(`slot${slot}`)[0]);
      const slot = Number(kind.slice(4));
      const list = (model.sections.body[BODY_KEYS[slot]] || []);
      return [{group: {1: "Head gear", 2: "Armor", 3: "Cloaks", 4: "Accessories"}[slot], items: list.map(b => ({value: b.index, label: `${b.index} ${textOf(b.name)}`}))}];
    }
    function itemLabel(kind, value, id) {
      if (F(id)?.kind === "effect" && value === 0xFFFF) return "No item (effect disabled)";
      for (const g of itemOptions(kind)) for (const it of g.items) if (it.value === value) return it.label;
      return `${hex(value)} (unlisted)`;
    }
    const itemSelect = (id, kind) => optionSelect(id, () => itemOptions(kind), v => itemLabel(kind, v, id));
    // AddToInventory(id, kind): any hand or body item; the value is kind << 16 | id.
    const giftKind = kind => kind === 0 ? "hand" : `slot${kind}`;
    const giftSelect = id => optionSelect(id, () => [0, 1, 2, 3, 4].map(kind => {
      const g = itemOptions(giftKind(kind))[0];
      return {group: g.group, items: g.items.map(it => ({value: kind << 16 | it.value, label: it.label}))};
    }), v => itemLabel(giftKind(v >>> 16), v & 0xFFFF, id));
    // Options are filled when the list is opened so hundreds of selects stay cheap.
    function optionSelect(id, groups, labelOf, onPick) {
      const f = F(id);
      const select = el("select", {class: "sfSelect", disabled: !!f.readOnly});
      let filled = false;
      const fill = () => {
        if (filled) return;
        filled = true;
        const value = f.value;
        select.replaceChildren();
        if (f.kind === "effect") select.append(el("option", {value: 0xFFFF, text: "No item (effect disabled)"}));
        let found = f.kind === "effect" && value === 0xFFFF;
        for (const g of groups()) {
          const og = el("optgroup", {label: g.group || "Items"});
          for (const it of g.items) { og.append(el("option", {value: it.value, text: it.label})); if (it.value === value) found = true; }
          select.append(og);
        }
        if (!found) select.append(el("option", {value, text: `${hex(value)} (current, unlisted)`}));
        select.value = String(value);
      };
      select.addEventListener("mousedown", fill);
      select.addEventListener("focus", fill);
      select.addEventListener("keydown", fill);
      select.addEventListener("change", () => onPick ? onPick(Number(select.value), select) : commit(id, Number(select.value), select));
      bind(id, select, () => {
        if (!filled) select.replaceChildren(el("option", {value: f.value, text: labelOf(f.value)}));
        select.value = String(f.value);
        markChanged(select, id);
      });
      return select;
    }

    function sf(label, id, opts = {}) {
      const f = id && F(id);
      return el("label", {class: `sf ${opts.wide ? "wide" : ""} ${f?.readOnly ? "ro" : ""}`},
        el("span", {class: "sfLabel", text: label ?? f?.label ?? "", title: label ?? f?.label ?? ""}), control(id, opts),
        opts.note ? el("span", {class: "sfNote", text: opts.note}) : null);
    }
    const grid = (...kids) => el("div", {class: "sfGrid"}, ...kids);
    function card(title, meta, ...body) {
      return el("article", {class: "statCard"}, el("header", {class: "statCardHead"}, title, meta ? el("span", {class: "statMeta", text: meta}) : null), ...body);
    }
    function rows(title, items) {
      if (!items.length) return null;
      return el("div", {class: "sfRows"}, el("h4", {text: title}), ...items.map(r =>
        el("div", {class: "sfRow"}, el("span", {class: "sfRowLabel", text: r.label, title: r.note || ""}), ...r.cells)));
    }
    function plainSelect(options, value, onChange, attrs = {}) {
      const select = el("select", {class: "sfSelect", ...attrs});
      for (const o of options) select.append(el("option", {value: o.value, text: o.label, title: o.title || null}));
      if (!options.some(o => String(o.value) === String(value))) select.append(el("option", {value, text: `${value} (current)`}));
      select.value = String(value);
      select.addEventListener("change", () => onChange(select.value));
      return select;
    }

    // ------------------------------------------------------------ icons
    function iconData(icon, palette) {
      const key = `${icon}:${palette}`;
      if (!iconCache.has(key)) iconCache.set(key, K.renderIcon(model.files.DRA.bytes, model.icons.gfx, model.icons.pal, icon, palette));
      return iconCache.get(key);
    }
    function drawIcon(canvas, icon, palette) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, 16, 16);
      const rgba = Number.isInteger(icon) && Number.isInteger(palette) ? iconData(icon, palette) : null;
      if (rgba) ctx.putImageData(new ImageData(rgba, 16, 16), 0, 0);
    }
    function iconControl(item) {
      const canvas = el("canvas", {width: 16, height: 16, class: "itemIcon", title: "Choose icon"});
      const redraw = () => drawIcon(canvas, val(item.icon), val(item.palette));
      bind(item.icon, canvas, redraw);
      bind(item.palette, canvas, redraw);
      canvas.addEventListener("click", () => openIconPicker(item));
      return canvas;
    }
    function openIconPicker(item) {
      const dialog = $("iconPicker"), grid = $("iconPickerGrid"), palInput = $("iconPickerPalette");
      const cols = 20, scale = 2, size = 16 * scale;
      grid.width = cols * size; grid.height = Math.ceil(model.icons.count / cols) * size;
      const ctx = grid.getContext("2d");
      const paint = () => {
        ctx.clearRect(0, 0, grid.width, grid.height);
        ctx.imageSmoothingEnabled = false;
        const tmp = document.createElement("canvas"); tmp.width = 16; tmp.height = 16;
        const pal = Number(palInput.value);
        for (let i = 0; i < model.icons.count; i++) {
          const rgba = iconData(i, pal);
          if (!rgba) continue;
          tmp.getContext("2d").putImageData(new ImageData(rgba, 16, 16), 0, 0);
          ctx.drawImage(tmp, (i % cols) * size, Math.floor(i / cols) * size, size, size);
        }
        const cur = val(item.icon);
        ctx.strokeStyle = "#ffd45a"; ctx.lineWidth = 2;
        ctx.strokeRect((cur % cols) * size + 1, Math.floor(cur / cols) * size + 1, size - 2, size - 2);
      };
      palInput.value = val(item.palette);
      palInput.oninput = paint;
      grid.onclick = e => {
        const r = grid.getBoundingClientRect();
        const i = Math.floor((e.clientY - r.top) * grid.height / r.height / size) * cols + Math.floor((e.clientX - r.left) * grid.width / r.width / size);
        if (i < 0 || i >= model.icons.count) return;
        commit(item.icon, i);
        const pal = Number(palInput.value);
        if (Number.isInteger(pal) && pal !== val(item.palette)) commit(item.palette, pal);
        dialog.close();
      };
      $("iconPickerTitle").textContent = `Icon for ${textOf(item.name, "item")}`;
      paint();
      dialog.showModal();
    }

    // ------------------------------------------------------------ stats sections
    function notFound(what) { return el("p", {class: "statsEmpty", text: `${what} could not be located in this BIN, so it is not editable.`}); }

    function renderStart(section) {
      const s = model.sections[section];
      if (!s || !s.fields.length) return [notFound("This starting-stat code")];
      const order = ["hp", "hpMax", "hpMaxBonus", "mp", "mpMax", "hearts", "heartsMax", "str", "con", "int", "lck", "acc2"];
      const fields = s.fields.slice().sort((a, b) => order.indexOf(F(a).key) - order.indexOf(F(b).key));
      const title = {alucard: "Alucard", luck: "Alucard, luck mode", richter: "Richter"}[section];
      return [card(el("strong", {text: title}), null,
        grid(...fields.map(id => sf(F(id).label, id, {wide: F(id).key === "acc2"}))),
        el("p", {class: "statHint", text: s.note}),
        section !== "alucard" ? null : el("p", {class: "statHint", text: "Current HP and MP start equal to their maximums."})),
        ...(section === "alucard" ? [...renderGear(), ...renderVessels()] : [])];
    }

    // Values that live in code or data: per-stage copies (pickups, Soul Steal, blood) and the potion helper.
    function valueCard(title, meta, ids, labelOf) {
      if (!ids.length) return null;
      const notes = ids.map(id => F(id).hint && !/^Set in \d+ stages?\.$/.test(F(id).hint) ? `${labelOf(id)}: ${F(id).hint}` : null);
      return card(el("strong", {text: title}), meta,
        grid(...ids.map(id => sf(labelOf(id), id))),
        ...ids.map(id => F(id).desc ? el("p", {class: "statHint", text: `${labelOf(id)}: ${F(id).desc}`}) : null),
        ...notes.map(text => text ? el("p", {class: "statHint", text}) : null));
    }
    function renderGear() {
      const gear = model.sections.gear?.fields || [], bonus = model.sections.bonusItems?.fields || [];
      return [
        gear.length ? card(el("strong", {text: "Starting gear"}), "InitStatsAndGear",
          grid(...gear.map(id => sf(F(id).label, id, {wide: true}))),
          el("p", {class: "statHint", text: "Death's scene still takes the vanilla Alucard items (Alucard Sword and Shield, Dragon Helm, Alucard Mail, Twilight Cloak, Necklace of J) if you have them; other gear is not taken."})) : notFound("Alucard's starting gear"),
        bonus.length ? card(el("strong", {text: "Prologue bonus items"}), "added to the inventory",
          grid(...bonus.map(id => sf(F(id).label, id, {wide: true}))),
          ...bonus.map(id => el("p", {class: "statHint", text: `${F(id).label}: ${F(id).desc}`})),
          el("p", {class: "statHint", text: "Any hand or body item can be picked. The prologue stat bonuses are unchanged."})) : notFound("The prologue bonus items")
      ];
    }
    function renderVessels() {
      const pickups = model.sections.vessels?.fields || [], healing = model.sections.healing?.fields || [];
      const itemName = id => F(id).item !== undefined ? textOf(model.sections.hand[F(id).item]?.name, "Potion").trim() : F(id).label;
      return [
        valueCard("Pickups", "every stage", pickups, id => F(id).label.replace(/ amount$/, "")),
        valueCard("Healing", null, healing, itemName),
        valueCard("Transformations", null, model.sections.forms?.fields || [], id => F(id).label)
      ].filter(Boolean);
    }

    function renderSpells() {
      return [...model.sections.spells.map(s => card(el("strong", {text: s.name}), `spell ${s.index}`,
        grid(sf("MP cost", s.mp), sf("Damage", s.attack), sf("Element", s.element, {wide: true})))),
      ...shieldSpellCards()];
    }

    // ---- shield spells (Shield rod + shield) and two-weapon combos
    const isShield = i => val(equipRows()[i].category) === M.SHIELD_CATEGORY;
    const nameList = (list, max = 3) => list.length <= max ? list.map(rowName).join(", ") :
      `${list.slice(0, max).map(rowName).join(", ")} and ${list.length - max} more`;
    function shieldSpellCards() {
      const spells = M.comboSpells(model);
      if (!spells.length) return [];
      return [el("h3", {class: "statSubhead", text: "Shield spells and weapon combos"}),
        el("p", {class: "statHint wideHint", text: "Hold a shield in one hand and a Shield rod in the other, then press both attack buttons. " +
          "Each spell's code is in its shield's weapon overlay, so the effect follows the overlay. The MP cost, damage and element come from the spell's own row."}),
        ...spells.map(spellCard)];
    }
    function spellCard(s) {
      const r = equipRows()[s.index], wid = val(r.weaponId);
      const title = s.shield ? (s.casters.length ? `${nameList(s.casters)} spell` : "Shield spell (no shield)") :
        `${s.casters.length ? nameList(s.casters) : "Unused"} combo`;
      const body = [grid(sf("MP cost", r.mp), sf("Damage", r.attack), sf("Element", r.element, {wide: true}))];
      const effectText = CAT.SHIELD_SPELL_EFFECTS[wid];
      if (s.shield) {
        const overlays = M.shieldOverlays(model);
        const currentOwner = overlays.find(o => o.weaponId === wid)?.owners[0];
        const effect = plainSelect(overlays.map(o => ({value: o.owners[0], label: `${rowName(o.owners[0])}'s effect · overlay ${o.weaponId}`,
          title: CAT.SHIELD_SPELL_EFFECTS[o.weaponId] || ""})), currentOwner ?? `overlay ${wid}`, v => {
          const owner = Number(v);
          if (!Number.isInteger(owner)) return;
          if (commitMany(M.planSpellEffect(model, s.index, owner), `${title} effect`)) {
            hooks.setStatus?.(`${title} now uses ${rowName(owner)}'s effect${s.casters.length ? `; ${nameList(s.casters)} load its overlay` : ""}.`);
            render();
          }
        });
        if (model.isChanged(r.weaponId)) effect.classList.add("changed");
        const shields = model.sections.hand.filter(h => isShield(h.index));
        const attach = plainSelect([{value: "", label: "No shield"}, ...shields.map(h => ({value: h.index, label: `${h.index} ${rowName(h.index)}`}))],
          s.casters[0] ?? "", v => {
            const target = v === "" ? null : Number(v);
            const pairs = M.planAttach(model, s.index, target);
            if (!pairs.length) return;
            if (commitMany(pairs, `${title} shield`)) {
              hooks.setStatus?.(target === null ? `${title} is no longer cast by any shield.` :
                `${rowName(target)} now casts this spell${s.casters.length ? `; ${nameList(s.casters)} took ${rowName(target)}'s old spell` : ""}.`);
              render();
            }
          });
        if (s.casters.some(c => model.isChanged(equipRows()[c].comboSub))) attach.classList.add("changed");
        body.push(el("div", {class: "movesetGrid"},
          el("label", {class: "sf"}, el("span", {class: "sfLabel", text: "Effect"}), effect),
          el("label", {class: "sf"}, el("span", {class: "sfLabel", text: "Attached to"}), attach)),
          el("p", {class: "statHint", text: `What it does: ${effectText || `overlay ${wid} is not catalogued`}`}));
        if (s.casters.length > 1) body.push(el("p", {class: "statHint", text: `Cast by ${nameList(s.casters, 8)}; they share these numbers.`}));
        for (const c of s.casters) {
          const own = val(equipRows()[c].weaponId);
          if (own !== wid) body.push(el("p", {class: "statWarn", text: `${rowName(c)} loads overlay ${own}, but this spell is set to overlay ${wid}. ` +
            `The game runs ${rowName(c)}'s overlay, so it performs ${CAT.SHIELD_SPELL_EFFECTS[own] ? `"${CAT.SHIELD_SPELL_EFFECTS[own]}"` : `overlay ${own}'s spell`}.`}));
        }
        body.push(el("p", {class: "statHint", text: s.triggers.length ? `Cast with: ${nameList(s.triggers)}.` : "No item can trigger it (no comboMain bit)."}));
      } else {
        body.push(el("p", {class: "statHint", text: `${s.casters.length ? nameList(s.casters) : "No item"} with ${s.triggers.length ? nameList(s.triggers) : "no partner"}` +
          `${effectText ? `: ${effectText}` : "."}`}));
      }
      body.push(el("details", {class: "sfMore"}, el("summary", {text: "Raw bytes"}),
        grid(sf("Hit type", r.hitType), sf("Hit effect", r.hitEffect), sf("Invincibility frames", r.invFrames), sf("Weapon overlay", r.weaponId),
          sf("Combo bits (sub)", r.comboSub), sf("Stun frames", r.stun)),
        el("p", {class: "statHint", text: "A hit type of 0 means the spell has no hitbox, so its damage is unused."})));
      return card(el("strong", {text: title}), `row ${s.index}`, ...body);
    }
    // Compact spell box on each shield's Hand items card.
    function shieldSpellBox(it) {
      const s = M.comboSpells(model).find(x => x.casters.includes(it.index));
      if (!s) return el("div", {class: "effectBox"}, el("h4", {text: "Shield spell"}), el("p", {class: "statHint", text: "None: no spell row matches this shield's combo bits."}));
      const r = equipRows()[s.index];
      return el("div", {class: "effectBox"}, el("h4", {text: "Shield spell"}),
        grid(sf("Spell MP cost", r.mp), sf("Spell damage", r.attack), sf("Spell element", r.element, {wide: true})),
        el("p", {class: "statHint", text: `Row ${s.index}. ${CAT.SHIELD_SPELL_EFFECTS[val(r.weaponId)] || ""} Change its effect or shield under Alucard · Spells.`}));
    }

    function subRow(r, cost = false) {
      return {label: r.label, note: r.note, cells: [
        cost ? sf("Heart cost", r.cost) : null, sf("Damage", r.attack), sf("Element", r.element), sf("Hit cooldown", r.cooldown)].filter(Boolean)};
    }
    // An enemy keeps one cooldown per attacking entity (subweapon entities take attacker IDs 7-10 in
    // turn), so a subweapon that spawns several hitting entities hits that much more often.
    const MULTI_HIT = {3: () => (modes.holyWaterRichter ?
      "Richter-style Holy Water: the fire travels along the ground for about 80 frames and leaves a flame every 4th frame (about 20 flames per bottle). The enemy keeps a separate cooldown for each flame, so every flame that reaches it can hit it." :
      "Each bottle spawns 4 flames, and the enemy keeps a separate cooldown for each flame, so one bottle can hit about 16 times (more with several bottles out).") +
      " A flame's hitbox is only on every 4th frame, so a flame cooldown below 4 changes nothing."};
    function renderAlucardSubweapons() {
      return [el("p", {class: "statHint wideHint", text: "Hit cooldown is counted per attacking entity: an enemy can be hit by two different flames, bolts or projectiles back to back."}),
        ...model.sections.alucardSubweapons.map(s => card(el("strong", {text: s.name}), `g_SubwpnDefs[${s.id}]`,
        grid(sf(subweaponCostLabel(), s.cost), sf("Damage", s.attack), sf("Max on screen", s.chain), sf("Hit cooldown", s.cooldown, {note: "frames before the same enemy can be hit again"}), sf("Element", s.element, {wide: true}),
          s.followUp ? sf(`Follow-up lightning ${modes.subweaponMp ? "MP" : "heart"} cost`, s.followUp, {wide: true, note: "Charged for each extra strike while you hold Up + attack."}) : null),
        rows("Related hits", s.extras.map(x => subRow(x))),
        MULTI_HIT[s.id] ? el("p", {class: "statHint", text: MULTI_HIT[s.id]()}) : null))];
    }

    function renderRichterSkills() {
      if (!model.sections.richterSkills) return [notFound("RIC.BIN")];
      return [card(el("strong", {text: "Richter's attacks"}), "RIC subweapons_def",
        rows("Damage per hit", model.sections.richterSkills.map(r => subRow(r))))];
    }
    function renderRichterSubweapons() {
      if (!model.sections.richterSubweapons) return [notFound("RIC.BIN")];
      return model.sections.richterSubweapons.map(s => card(el("strong", {text: s.name}), `subweapons_def[${s.id}]`,
        grid(sf("Heart cost", s.cost), sf("Damage", s.attack), sf("Max on screen", s.chain), sf("Hit cooldown", s.cooldown, {note: "frames before the same enemy can be hit again"}), sf("Element", s.element, {wide: true}),
          s.followUp ? sf("Follow-up lightning heart cost", s.followUp, {wide: true}) : null),
        rows("Related hits", s.extras.map(x => subRow(x))),
        s.crash ? el("div", {class: "crashBox"}, el("h4", {text: "Item crash"}),
          grid(sf("Crash heart cost", s.crash.cost, {note: `Row ${s.crash.entry}`}), sf("Crash hit cooldown", s.crash.cooldown)),
          rows("Crash damage", s.crash.damage.map(x => subRow(x)))) : null));
    }

    function renderFamiliars() {
      return model.sections.familiars.map(f => card(f.name ? control(f.name, {big: true}) : el("strong", {text: f.fallback}), null,
        f.attacks.length ? rows("Attacks", f.attacks.map(a => ({label: a.label, note: a.note, cells: [sf("Damage", a.attack), sf("Element", a.element)]}))) :
          el("p", {class: "statHint", text: "No attack of its own; it uses items and spells to support you."}),
        f.attacks.length ? el("p", {class: "statHint", text: "Base damage; the game multiplies it by (level × 4 ÷ 95 + 1)."}) : null));
    }

    const matches = (...texts) => !query || texts.some(t => String(t ?? "").toLowerCase().includes(query));
    function renderEnemies() {
      return model.sections.enemies.filter(e => matches(textOf(e.name), e.label, e.index)).map(e => card(
        control(e.name, {big: true}), `#${e.index}${e.label && e.label !== textOf(e.name) ? ` · ${e.label}` : ""}`,
        grid(sf("HP", e.hp), sf("LVL", e.level), sf("EXP", e.exp), sf("DEF", e.defense),
          sf("Contact damage", e.attack), sf("Element", e.element, {wide: true})),
        e.contactNote ? el("p", {class: "statHint", text: e.contactNote}) : null,
        el("details", {class: "sfMore"}, el("summary", {text: "Weaknesses and resistances"}),
          grid(sf("Weak to", e.weak, {wide: true}), sf("Resists", e.resist, {wide: true}), sf("Immune to", e.immune, {wide: true}), sf("Absorbs", e.absorb, {wide: true}))),
        el("div", {class: "sfDrops"}, el("h4", {text: "Drops"}),
          el("div", {class: "dropGrid"}, sf("Item 1 (rare)", e.drop1), sf("Rate /256", e.rate1), sf("Item 2 (uncommon)", e.drop2), sf("Rate /256", e.rate2))),
        rows("Attacks", e.attacks.map(a => ({label: `#${a.index} ${/^Attack #/.test(a.label) ? "Unnamed attack" : a.label}`, cells: [sf("Damage", a.attack), sf("Element", a.element)]})))));
    }

    function slotOfItem(kind, item) { return kind === "hand" ? 0 : SLOT_OF_TYPE[item.type]; }
    function effectsFor(slot, index) { return (model.effects || []).filter(id => F(id).slot === slot && val(id) === index); }
    function effectBlock(kind, item) {
      const slot = slotOfItem(kind, item), held = effectsFor(slot, item.index);
      const blocks = held.map(id => el("div", {class: "effectRow"},
        el("div", {}, el("strong", {text: F(id).label}), el("span", {class: "sfNote", text: F(id).desc || ""})),
        sf("Held by", id),
        F(id).bonuses ? grid(...F(id).bonuses.map(bonus => sf(F(bonus).label, bonus))) : null));
      const others = (model.effects || []).filter(id => F(id).slot === slot && val(id) !== item.index && !F(id).readOnly);
      let add = null;
      if (others.length) {
        add = el("select", {class: "sfSelect"}, el("option", {value: "", text: "Give this item another effect…"}),
          ...others.map(id => el("option", {value: id, text: `${F(id).label} (now: ${val(id) === 0xFFFF ? "no item" : itemLabel(kind === "hand" ? "hand" : `slot${slot}`, val(id), id).replace(/^\d+ /, "")})`})));
        add.addEventListener("change", () => { if (add.value) commit(add.value, item.index); });
      }
      return el("div", {class: "effectBox"}, el("h4", {text: "Special effect"}),
        held.length ? blocks : el("p", {class: "statHint", text: "None found in the game code."}), add);
    }
    // ---- weapon movesets
    const WEAPON_CATEGORIES = new Set([0, 1, 2, 3, 4, 5, 7, 8]); // not Food, Shield or Medicine
    const equipRows = () => model.sections.equipRows || [];
    const isWeapon = it => it.index > 0 && it.index < M.HAND_ITEMS && WEAPON_CATEGORIES.has(val(it.category)) && val(it.weaponId) !== 0xFF;
    const rowName = i => textOf(equipRows()[i]?.name, `Item ${i}`).trim();
    const specialUsers = index => [...new Set([...M.rowUsers(model, index),
      ...(M.comboSpells(model).find(s => s.index === index)?.casters || [])])].filter(i => i < M.HAND_ITEMS);
    // Include shields sharing this spell.
    function specialLabel(index, self) {
      if (!index) return "None";
      const users = specialUsers(index);
      const others = users.filter(i => i !== self).map(rowName);
      const what = others.length ? `${others.join(", ")} special${users.includes(self) ? " (shared)" : ""}` :
        users.includes(self) ? "this weapon's own special" : `spare row (overlay ${val(equipRows()[index].weaponId)})`;
      return `Row ${index} · ${what}`;
    }
    function styleGroups() {
      const groups = new Map();
      for (const h of model.sections.hand) {
        if (!isWeapon(h)) continue;
        const key = M.styleKey(model, h.index);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h.index);
      }
      return groups;
    }
    // hitEffect (row +0x2A): low 7 bits 2 = a soul orb on every hit (vanilla Mourneblade), 6 = a soul orb only
    // from enemies whose hitbox state has bit 0x20 (used by ASS); bit 0x80 picks the stab hit sound.
    const SOUL_EVERY = 2, SOUL_SOME = 6;
    function soulField(id) {
      if (!id || !F(id)) return null;
      const f = F(id), plain = v => [SOUL_EVERY, SOUL_SOME].includes(v & 0x7F) ? ([SOUL_EVERY, SOUL_SOME].includes(f.original & 0x7F) ? 1 : f.original & 0x7F) : v & 0x7F;
      const options = () => [{value: plain(f.value), label: "No"}, {value: SOUL_EVERY, label: "Yes, every hit"}, {value: SOUL_SOME, label: "Yes, enemy-dependent (effect 6)"}];
      const pick = plainSelect(options(), f.value & 0x7F, v => commit(id, (f.value & 0x80) | Number(v), pick));
      bind(id, pick, () => {
        pick.replaceChildren(...options().map(o => el("option", {value: o.value, text: o.label})));
        pick.value = String(f.value & 0x7F);
        markChanged(pick, id);
      });
      return el("label", {class: "sf wide"}, el("span", {class: "sfLabel", text: "Steals souls"}), pick);
    }

    function specialPanel(it, key, title) {
      const slot = it[key], index = val(slot), label = rowName(it.index);
      const options = [{value: 0, label: "None"}, ...M.specialRows(model).map(r => ({value: r.index, label: specialLabel(r.index, it.index)}))];
      const picker = plainSelect(options, index, v => { if (commitMany([[slot, Number(v)]], `${label} ${title}`)) render(); });
      markChanged(picker, slot);
      const box = el("div", {class: "specialBox"}, el("label", {class: "sf wide"}, el("span", {class: "sfLabel", text: title}), picker));
      if (!index) return box;
      const r = equipRows()[index];
      if (!r) return box;
      const others = specialUsers(index).filter(i => i !== it.index).map(rowName);
      box.append(grid(sf("Special damage", r.attack), sf("Special MP cost", r.mp), sf("Special element", r.element, {wide: true}), sf("Special hit cooldown", r.invFrames), soulField(r.hitEffect)));
      if (others.length) box.append(el("p", {class: "statHint", text: `Shared with ${others.join(", ")}: editing these numbers changes theirs too.`}));
      if (val(r.weaponId) !== val(it.weaponId)) {
        const match = model.sections.hand.find(h => isWeapon(h) && h.index !== it.index && val(h.weaponId) === val(r.weaponId));
        box.append(el("p", {class: "statWarn", text: `Row ${index} was made for weapon overlay ${val(r.weaponId)}, but this weapon loads overlay ${val(it.weaponId)}. ` +
          `The special runs this weapon's overlay code, so it may look wrong or crash.${match ? ` Set the basic attack to ${rowName(match.index)} to match.` : ""}`}));
      }
      if (!others.length) {
        box.append(el("p", {class: "statHint", text: "Private special: these numbers only affect this weapon."}));
        return box;
      }
      const free = M.freeSpecialRows(model).filter(f => f.index !== index);
      const copy = el("button", {type: "button", class: "smallButton", disabled: !free.length,
        title: free.length ? `Spare rows: ${free.map(f => f.index).join(", ")}` : "No spare special rows are left.",
        text: free.length ? `Make a private copy (row ${free[0].index})` : "No spare rows for a private copy"});
      copy.addEventListener("click", () => {
        const target = M.freeSpecialRows(model).find(f => f.index !== index);
        if (!target) return;
        if (commitMany([...M.planRowCopy(model, index, target.index), [slot, target.index]], `${label} private special`)) {
          hooks.setStatus?.(`${label} now uses row ${target.index}, a copy of row ${index}.`);
          render();
        }
      });
      box.append(copy);
      return box;
    }
    function movesetBox(it) {
      const label = rowName(it.index), groups = styleGroups(), current = M.styleKey(model, it.index);
      const styleOptions = [...groups].map(([key, members]) => {
        const others = members.filter(i => i !== it.index);
        const name = others.length ? `${rowName(others[0])}${others.length > 1 ? ` +${others.length - 1} more` : ""}` : "This weapon's own";
        return {value: key, label: `${name} · overlay ${val(equipRows()[members[0]].weaponId)}${others.length && members.includes(it.index) ? " (current)" : ""}`,
          title: members.map(rowName).join(", ")};
      });
      const basic = plainSelect(styleOptions, current, key => {
        const from = groups.get(key)?.[0];
        if (from !== undefined && commitMany(M.planStyleCopy(model, from, it.index), `${label} basic attack`)) render();
      });
      M.STYLE_KEYS.some(k => model.isChanged(it[k])) && basic.classList.add("changed");
      const weapons = model.sections.hand.filter(h => isWeapon(h) && h.index !== it.index);
      const copyFrom = plainSelect([{value: "", label: "Copy another weapon's whole moveset…"}, ...weapons.map(h => ({value: h.index, label: `${h.index} ${rowName(h.index)}`}))], "", v => {
        if (v === "") return;
        const from = equipRows()[Number(v)];
        const pairs = [...M.planStyleCopy(model, from.index, it.index), [it.specialMove, val(from.specialMove)], [it.unk17, val(from.unk17)]]
          .filter(([id, value]) => val(id) !== value);
        if (commitMany(pairs, `${label} moveset`)) { hooks.setStatus?.(`${label} now attacks like ${rowName(from.index)}; its own stats are unchanged.`); render(); }
      });
      const categories = CAT.CATEGORIES.map((name, value) => ({value, label: name}));
      const category = plainSelect(categories, val(it.category), v => commit(it.category, Number(v)));
      bind(it.category, category, () => { category.value = String(val(it.category)); markChanged(category, it.category); });
      return el("div", {class: "movesetBox"}, el("h4", {text: "Moveset"}),
        el("div", {class: "movesetGrid"},
          el("label", {class: "sf"}, el("span", {class: "sfLabel", text: "Basic attack (animation and weapon graphics)"}), basic),
          el("label", {class: "sf"}, el("span", {class: "sfLabel", text: "Category"}), category)),
        copyFrom,
        specialPanel(it, "specialMove", "Special: ↓↘→ + attack"),
        specialPanel(it, "unk17", "Special: ←→ + attack"),
        el("details", {class: "sfMore"}, el("summary", {text: "Raw attack bytes"}),
          grid(...M.STYLE_KEYS.map(k => sf(F(it[k]).label, it[k])), sf("Invincibility frames", it.invFrames), sf("Hit type", it.hitType), sf("Hit effect", it.hitEffect))));
    }

    // Throw 1, Bomb, Throw 2 and Food items fly as separate entities; chainLimit caps how many are out
    // at once. Melee weapons use 0x80 ("one attack at a time") and keep it under Raw attack bytes.
    const THROWN_CATEGORIES = new Set([2, 6, 7, 8]);
    const isThrown = it => THROWN_CATEGORIES.has(val(it.category)) && !(val(it.chain) & 0x80);
    // Every row past the hand items: weapon specials, two-weapon combo rows, Axe Armor and spare rows.
    function renderSpecials() {
      const rows = equipRows().slice(M.HAND_ITEMS);
      return rows.map(r => {
        const users = model.sections.equipRows.filter(u => u.index < M.HAND_ITEMS && (val(u.specialMove) === r.index || val(u.unk17) === r.index))
          .map(u => `${rowName(u.index)} (${val(u.specialMove) === r.index ? "↓↘→" : "←→"})`);
        const kind = users.length ? `Special of ${users.join(", ")}` : val(r.comboSub) ? "Two-weapon combo row" :
          M.specialRows(model).some(x => x.index === r.index) ? "Spare row" : "Other row";
        return {r, kind, users};
      }).filter(({r, kind}) => matches(kind, r.index)).map(({r, kind, users}) => card(el("strong", {text: `Row ${r.index}`}), kind,
        grid(sf("Damage", r.attack), sf("MP cost", r.mp), sf("Element", r.element, {wide: true}), soulField(r.hitEffect),
          sf("Stun frames", r.stun), sf("Critical rate", r.crit), sf("Hit type", r.hitType), sf("Hit cooldown", r.invFrames, {note: "frames before the same enemy can be hit again"}),
          sf("Chain limit", r.chain, {note: "128 = one at a time"}), sf("Lock duration", r.lock)),
        users.length > 1 ? el("p", {class: "statHint", text: "Shared: editing this row changes the special of every weapon listed."}) : null,
        el("details", {class: "sfMore"}, el("summary", {text: "Raw attack bytes"}),
          grid(...M.STYLE_KEYS.map(k => sf(F(r[k]).label, r[k])), sf("Hit effect", r.hitEffect)))));
    }

    function renderItems(kind) {
      const list = kind === "hand" ? model.sections.hand : (model.sections.body[kind] || []);
      return list.filter(it => matches(textOf(it.name), it.index, textOf(it.desc))).map(it => card(
        el("span", {class: "itemTitle"}, iconControl(it), control(it.name, {big: true})), `#${it.index}`,
        sf("Description", it.desc, {wide: true}),
        grid(sf("Icon", it.icon), sf("Icon palette", it.palette), sf("ATK", it.attack), sf("DEF", it.defense),
          ...(kind === "hand" ? [sf(costLabel(it.mp), it.mp), it.heal ? sf("HP healed", it.heal) : null, isThrown(it) ? sf("Max on screen", it.chain, {note: "Counted per hand."}) : null, isWeapon(it) || isThrown(it) ? sf("Hit cooldown", it.invFrames, {note: "frames before the same enemy can be hit again"}) : null, isWeapon(it) ? soulField(it.hitEffect) : null, sf("Critical rate", it.crit), sf("Stun frames", it.stun), sf("Element", it.element, {wide: true})] :
            [sf("STR", it.str), sf("CON", it.con), sf("INT", it.int), sf("LCK", it.lck)])),
        kind === "hand" ? null : grid(sf("Weak to", it.weak, {wide: true}), sf("Resists", it.resist, {wide: true}),
          sf("Immune to", it.immune, {wide: true}), sf("Absorbs", it.absorb, {wide: true})),
        kind === "hand" && isWeapon(it) ? movesetBox(it) : null,
        kind === "hand" && isShield(it.index) ? shieldSpellBox(it) : null,
        effectBlock(kind, it)));
    }

    function renderEffects() {
      const list = (model.effects || []).filter(id => matches(F(id).label, F(id).desc));
      const slotName = ["Hand", "Head", "Armor", "Cloak", "Accessory"];
      return [
        el("p", {class: "statHint wideHint", text: "Each effect is code that checks for one item ID. Pick which item grants it; the checks are rewritten in every place they were verified."}),
        ...list.map(id => card(el("strong", {text: F(id).label}), `${slotName[F(id).slot]} · ${F(id).sites.length} check${F(id).sites.length === 1 ? "" : "s"}`,
          el("p", {class: "statHint", text: F(id).desc || ""}),
          grid(sf("Granted by", id, {wide: true})),
          F(id).bonuses ? grid(...F(id).bonuses.map(bonus => sf(F(bonus).label, bonus))) : null,
          F(id).hint ? el("p", {class: "statWarn", text: F(id).hint}) : null,
          F(id).readOnly ? el("p", {class: "statWarn", text: F(id).readOnly}) : null)),
        model.unverifiedSites?.length ? el("p", {class: "statWarn wideHint", text: `Unverified equipment checks left unchanged: ${model.unverifiedSites.map(s => `${s.file} ${hex(s.call, 5)}`).join(", ")}.`}) : null
      ];
    }

    const STATS_SECTIONS = [
      {id: "alucard", group: "Alucard", title: "Starting stats", render: () => renderStart("alucard"), fields: s => [s.alucard, s.gear, s.bonusItems, s.vessels, s.healing, s.forms]},
      {id: "luck", group: "Alucard", title: "Luck mode", render: () => renderStart("luck"), fields: s => s.luck},
      {id: "spells", group: "Alucard", title: "Spells", render: renderSpells,
        fields: s => [s.spells, M.comboSpells(model).map(c => [s.equipRows[c.index], c.casters.map(i => s.equipRows[i].comboSub)])]},
      {id: "asub", group: "Alucard", title: "Subweapons", render: renderAlucardSubweapons, fields: s => s.alucardSubweapons},
      {id: "richter", group: "Richter", title: "Starting stats", render: () => renderStart("richter"), fields: s => s.richter},
      {id: "rskills", group: "Richter", title: "Attacks and skills", render: renderRichterSkills, fields: s => s.richterSkills},
      {id: "rsub", group: "Richter", title: "Subweapons and crashes", render: renderRichterSubweapons, fields: s => s.richterSubweapons},
      {id: "familiars", group: "Allies and enemies", title: "Familiars", render: renderFamiliars, fields: s => s.familiars},
      {id: "enemies", group: "Allies and enemies", title: "Enemies", render: renderEnemies, search: true, fields: s => s.enemies},
      {id: "hand", group: "Equipment", title: "Hand items", render: () => renderItems("hand"), search: true, fields: s => [s.hand, (s.equipRows || []).slice(169)]},
      {id: "head", group: "Equipment", title: "Head gear", render: () => renderItems("head"), search: true, fields: s => s.body.head},
      {id: "armor", group: "Equipment", title: "Armor", render: () => renderItems("armor"), search: true, fields: s => s.body.armor},
      {id: "cloak", group: "Equipment", title: "Cloaks", render: () => renderItems("cloak"), search: true, fields: s => s.body.cloak},
      {id: "accessory", group: "Equipment", title: "Accessories", render: () => renderItems("accessory"), search: true, fields: s => s.body.accessory},
      {id: "specials", group: "Equipment", title: "Weapon specials", render: renderSpecials, search: true, fields: s => (s.equipRows || []).slice(M.HAND_ITEMS)},
      {id: "effects", group: "Equipment", title: "Special effects", render: renderEffects, search: true, fields: () => model.effects}
    ];

    const ui = {el, F, val, textOf, hex, sf, grid, card, rows, control, commit, commitMany, plainSelect, optionSelect, itemOptions, itemLabel,
      markChanged, bind, render: () => render(), matches, notFound, drawIcon, rowName,
      setStatus: msg => hooks.setStatus?.(msg), get model() { return model; }, get query() { return query; }};
    const SECTIONS = cfg.sections ? cfg.sections(ui) : STATS_SECTIONS;

    // ------------------------------------------------------------ frame
    function sectionIds(id) {
      const ids = [];
      const walk = v => {
        if (typeof v === "string" && model.fields.has(v)) { ids.push(v); F(v).bonuses?.forEach(walk); }
        else if (v instanceof Set) v.forEach(walk);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(SECTIONS.find(s => s.id === id)?.fields?.(model.sections));
      return [...new Set(ids)];
    }
    const idCache = new Map();
    function sectionFieldIds(id) {
      // The spells section follows which shields hold which rows, so it is not cached.
      if (id === "spells" || !idCache.has(id)) idCache.set(id, sectionIds(id));
      return idCache.get(id);
    }
    const changedIn = id => sectionFieldIds(id).filter(fid => model.isChanged(fid)).length;
    function updateBadges() {
      if (!model) return;
      for (const b of $$("Nav").querySelectorAll(".statsNavItem")) {
        const n = changedIn(b.dataset.section);
        b.querySelector(".navCount").textContent = n ? String(n) : "";
      }
      const mine = new Set(SECTIONS.flatMap(s => sectionFieldIds(s.id)));
      const total = [...mine].filter(id => model.isChanged(id)).length;
      $$("Summary").textContent = total ? `${total} ${cfg.noun} change${total === 1 ? "" : "s"}` : `No ${cfg.noun} changes`;
      $$("Badge").textContent = String(total);
      $$("Badge").classList.toggle("hidden", !total);
      $$("RevertSection").disabled = !changedIn(current);
    }
    function renderNav() {
      const nav = $$("Nav");
      nav.replaceChildren();
      let group = null;
      for (const s of SECTIONS) {
        if (s.group !== group) { group = s.group; nav.append(el("div", {class: "statsNavGroup", text: group})); }
        nav.append(el("button", {type: "button", class: `statsNavItem ${s.id === current ? "active" : ""}`, "data-section": s.id,
          onclick: () => { current = s.id; query = ""; $$("Search").value = ""; renderNav(); render(); $$("Content").scrollTop = 0; }},
        el("span", {text: s.title}), el("span", {class: "navCount"})));
      }
    }
    function render() {
      const content = $$("Content");
      if (!model) return;
      bound.clear();
      const s = SECTIONS.find(x => x.id === current) || SECTIONS[0];
      current = s.id;
      $$("Title").textContent = `${s.group} · ${s.title}`;
      $$("Search").classList.toggle("hidden", !s.search);
      const nodes = s.render().filter(Boolean);
      content.replaceChildren(...(nodes.length ? nodes : [el("p", {class: "statsEmpty", text: query ? "Nothing matches that filter." : "Nothing to edit here."})]));
      updateBadges();
    }

    function init(options) {
      hooks = options || {};
      $$("Search").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
      $$("RevertSection").addEventListener("click", () => {
        const ids = sectionIds(current).filter(id => model.isChanged(id));
        if (!ids.length) return;
        const before = ids.map(id => [id, F(id).value]);
        ids.forEach(id => model.reset(id));
        hooks.pushUndo?.(`${cfg.noun} section revert`, () => { for (const [id, v] of before) F(id).value = v; render(); });
        render(); hooks.onChange?.();
      });
    }
    function setModel(next) {
      model = next;
      idCache.clear(); iconCache.clear();
      current = SECTIONS[0].id;
      const available = !!model && (!cfg.available || cfg.available(model));
      $$("EmptyState").classList.toggle("hidden", available);
      $$("Layout").classList.toggle("hidden", !available);
      if (model && !available) cfg.unavailable?.(model);
      if (!available) { $$("Badge").classList.add("hidden"); return; }
      const notes = cfg.notes ? cfg.notes(model) : [...model.notes];
      $$("Notes").textContent = notes.join(" ");
      $$("Notes").classList.toggle("hidden", !notes.length);
      renderNav(); render();
    }
    function refresh() {
      if (!model || $$("Layout").classList.contains("hidden")) return;
      for (const id of bound.keys()) syncField(id);
      updateBadges();
    }
    const view = {init, setModel, refresh, render: () => { if (model && !$$("Layout").classList.contains("hidden")) render(); }, get model() { return model; }};
    views.push(view);
    return view;
  }

  // setModes({subweaponMp, holyWaterRichter}): relabels costs and hints to match the Extra Hacks selection.
  window.SotnEditorView = {createView, refreshAll: () => views.forEach(v => v.refresh()),
    setModes(next) { Object.assign(modes, next); views.forEach(v => v.render()); }};
  window.SotnStatsUI = createView({prefix: "stats", noun: "stat"});
  const init = window.SotnStatsUI.init;
  window.SotnStatsUI.init = options => {
    init(options);
    $("iconPickerClose").addEventListener("click", () => $("iconPicker").close());
  };
})();
