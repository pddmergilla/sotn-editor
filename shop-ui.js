(() => {
  "use strict";
  const CAT = window.SotnStatsCatalog, M = window.SotnStatsModel, S = window.SotnShopModel;
  const K = window.SotnStatsCore;
  let ui = null;
  const shop = () => ui.model.sections.shop;
  const BODY_GROUPS = [["head", 1, "Head gear"], ["armor", 2, "Armor"], ["cloak", 3, "Cloaks"], ["accessory", 4, "Accessories"]];

  // ---- names
  const relicName = r => (M.relicChoices(ui.model).find(c => c.value === r)?.label || `Relic #${r}`).replace(/ \(#\d+\)$/, "");
  const spellName = i => ui.model.sections.spells?.[i]?.name || `Spell ${i}`;
  const bossName = i => (shop().bossNames[i] && ui.val(shop().bossNames[i]).trim()) || CAT.TACTICS_BOSSES[i] || `Boss ${i}`;
  const docName = i => (shop().documents[i] && ui.val(shop().documents[i].name)) || CAT.SHOP_DOCUMENTS[i] || `Document ${i}`;
  function bodyItem(index) { return Object.values(ui.model.sections.body).flat().find(b => b.index === index); }
  function itemOf(category, id) {
    const m = ui.model;
    if (category === 0) return m.sections.hand[id] ? {name: ui.textOf(m.sections.hand[id].name), item: m.sections.hand[id]} : null;
    if (category >= 1 && category <= 4) { const b = bodyItem(id); return b ? {name: ui.textOf(b.name), item: b} : null; }
    if (category === 5) { const r = ui.val(shop().relics[id]?.relic ?? ""); return shop().relics[id] ? {name: relicName(r), relic: r} : null; }
    if (category === 6) return id < 6 ? {name: docName(id), doc: id} : null;
    return null;
  }
  const entryName = e => itemOf(ui.val(e.category), ui.val(e.item))?.name?.trim() ||
    `${CAT.SHOP_CATEGORIES[ui.val(e.category)] || "Category " + ui.val(e.category)} #${ui.val(e.item)}`;

  // ---- icons: equipment icons from DRA, relic icons from the relic table, documents 0x111/0x112.
  function iconFor(category, id) {
    const m = ui.model, it = itemOf(category, id);
    if (!it) return null;
    if (it.item) return [ui.val(it.item.icon), ui.val(it.item.palette)];
    if (it.relic !== undefined) {
      const o = m.tables.relic + it.relic * 16, dra = m.files.DRA.bytes;
      return [K.u16(dra, o + 8), K.u16(dra, o + 10)];
    }
    return [it.doc ? 0x112 : 0x111, 0x118];
  }
  function entryIcon(e) {
    const canvas = ui.el("canvas", {width: 16, height: 16, class: "itemIcon static"});
    const draw = () => { const ic = iconFor(ui.val(e.category), ui.val(e.item)); ui.drawIcon(canvas, ic?.[0], ic?.[1]); };
    ui.bind(e.item, canvas, draw);
    ui.bind(e.category, canvas, draw);
    return canvas;
  }

  // ---- controls
  const lazy = (id, groups, labelOf) => ui.optionSelect(id, groups, labelOf);
  const CONTROLS = {
    relic: id => lazy(id, () => [{group: "Relics", items: M.relicChoices(ui.model)}], v => relicName(v)),
    spell: id => lazy(id, () => [{group: "Spells", items: (ui.model.sections.spells || []).map(s => ({value: s.index, label: s.name}))}], v => spellName(v)),
    boss: id => lazy(id, () => [{group: "Bosses", items: CAT.TACTICS_BOSSES.map((_, i) => ({value: i, label: `${i} ${bossName(i)}`}))}], v => `${v} ${bossName(v)}`),
    menuOption: id => lazy(id, () => [{group: "Menu options", items: CAT.SHOP_MENU_OPTIONS.map((label, value) => ({value, label}))}], v => CAT.SHOP_MENU_OPTIONS[v] || `Option ${v}`),
    shopUnlock: id => lazy(id, () => [{group: "Listed", items: S.UNLOCK_VALUES.map(value => ({value, label: unlockText(value)}))}], v => unlockText(v)),
    shopLevel: id => lazy(id, () => [{group: "Unlock level", items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(value => ({value, label: S.unlockLabel(value)}))}], v => S.unlockLabel(v)),
    bodyAny: id => lazy(id, () => ui.itemOptions("bodyAny"), v => ui.itemLabel("bodyAny", v, id))
  };
  const unlockText = v => S.unlockLabel(v, relicName(ui.val(shop().relicCheck)));

  // One select sets both the category and the item ID of a buy-list entry.
  function entryItemSelect(e) {
    const {el, val} = ui;
    const select = el("select", {class: "sfSelect"});
    const key = () => `${val(e.category)}:${val(e.item)}`;
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      select.replaceChildren();
      const m = ui.model, group = (label, items) => el("optgroup", {label}, ...items.map(o => el("option", {value: o.value, text: o.label})));
      select.append(group("Hand items", m.sections.hand.map(h => ({value: `0:${h.index}`, label: `${h.index} ${ui.textOf(h.name)}`}))));
      for (const [kind, cat, label] of BODY_GROUPS) {
        select.append(group(label, (m.sections.body[kind] || []).map(b => ({value: `${cat}:${b.index}`, label: `${b.index} ${ui.textOf(b.name)}`}))));
      }
      select.append(group("Relics (the shop's relic slots)", shop().relics.map(r => ({value: `5:${r.slot}`, label: `Relic slot ${r.slot + 1}: ${relicName(val(r.relic))}`}))));
      select.append(group("Documents", CAT.SHOP_DOCUMENTS.map((_, i) => ({value: `6:${i}`, label: docName(i)}))));
      if (![...select.options].some(o => o.value === key())) select.append(el("option", {value: key(), text: `${entryName(e)} (current, unlisted)`}));
      select.value = key();
    };
    ["mousedown", "focus", "keydown"].forEach(t => select.addEventListener(t, fill));
    select.addEventListener("change", () => {
      const [cat, id] = select.value.split(":").map(Number);
      const pairs = [[e.category, cat], [e.item, id]].filter(([f, v]) => val(f) !== v);
      if (ui.commitMany(pairs, `shop entry ${e.index + 1} item`)) ui.render();
    });
    const sync = () => {
      if (!filled) select.replaceChildren(el("option", {value: key(), text: entryName(e)}));
      select.value = key();
      const changed = ui.model.isChanged(e.category) || ui.model.isChanged(e.item);
      select.classList.toggle("changed", changed);
      select.title = changed ? `Original: ${itemOf(ui.model.field(e.category).original, ui.model.field(e.item).original)?.name || "?"}` : "";
    };
    ui.bind(e.item, select, sync);
    ui.bind(e.category, select, sync);
    return select;
  }

  // ---- sections
  function renderBuy() {
    const {el, sf, grid, card, val} = ui;
    const s = shop();
    if (!s?.found) return [ui.el("p", {class: "statsEmpty", text: s?.reason || "The library shop was not found."})];
    const count = val(s.count);
    const intro = card(el("strong", {text: "How the list works"}), `${count} of ${s.slots} entries listed`,
      grid(sf("Listed entries", s.count, {note: `The game lists entries 1-${count}. Entry ${s.slots} is unused in vanilla.`})),
      el("p", {class: "statHint", text: "Entries show in this order once they are available. Levels 1-7 count how many of these you have done, in any order:"}),
      el("ol", {class: "shopMilestones"}, ...CAT.SHOP_MILESTONES.map(t => el("li", {text: t}))),
      el("p", {class: "statHint", text: "Clearing the game sets the level to 8, so level-8 entries appear only after a clear. Equipment stock is 99 minus what you own; relics and documents sell once."}));
    const list = s.entries.filter(e => ui.matches(entryName(e), e.index + 1));
    return [el("div", {class: "wideHint"}, intro), ...list.map(e => entryCard(e, count))];
  }
  function entryCard(e, count) {
    const {el, sf, grid, card, val} = ui;
    const listed = e.index < count, cat = val(e.category), id = val(e.item);
    const warn = [];
    if (cat >= 1 && cat <= 4) {
      const b = bodyItem(id);
      if (b && b.type + 1 !== cat) warn.push(`${ui.textOf(b.name)} is ${["head gear", "armor", "a cloak", "an accessory"][b.type]}, but this entry is filed as ${CAT.SHOP_CATEGORIES[cat].toLowerCase()}; the stat preview compares it with the wrong slot.`);
    }
    if (cat === 5 && id === 1) warn.push("Relic slot 2 has no name of its own; the shop shows the castle map's name for it.");
    const u = val(e.unlock);
    if (u >= 0x81 && u <= 0x85 && !(cat === 6 && id === u - 0x80)) warn.push(`The magic scroll ${u - 0x80} rule hides this entry once that scroll's spell is learned.`);
    if (u === 0xFF && cat !== 5) warn.push("The relic rule hides this entry once you own the relic chosen under Relic and documents.");
    return card(el("span", {class: "itemTitle"}, entryIcon(e), el("strong", {text: entryName(e)})),
      `#${e.index + 1}${listed ? "" : " · not listed"}`,
      el("label", {class: "sf wide"}, el("span", {class: "sfLabel", text: "Item"}), entryItemSelect(e)),
      grid(sf("Price", e.price), sf("Available", e.unlock, {wide: true})),
      ...warn.map(t => el("p", {class: "statWarn", text: t})),
      listed ? null : el("p", {class: "statHint", text: "Past the listed entries: raise Listed entries to show it."}));
  }

  function renderRelicDocs() {
    const {el, sf, grid, card, val} = ui;
    const s = shop();
    if (!s?.found) return [];
    const relic = card(el("strong", {text: "Relic for sale"}), "D_us_801814D4",
      grid(sf("Relic slot 1", s.relics[0].relic, {wide: true}), sf("Name in the list", s.relicName, {wide: true}),
        sf("Hide entries with the relic rule once you own", s.relicCheck, {wide: true}),
        sf("Relic slot 2", s.relics[1].relic, {wide: true, note: "Shown under the castle map's name, since the game has one relic name."})),
      el("p", {class: "statHint", text: "The relic's description and icon come from the relic itself. Match the name and the hide rule to the relic you sell."}));
    const docs = s.documents.map(d => {
      const scroll = s.scrolls.find(x => x.index === d.index);
      return card(el("span", {class: "itemTitle"}, docIcon(d.index), ui.control(d.name, {big: true})), d.index ? `magic scroll ${d.index}` : "castle map",
        sf("Description", d.desc, {wide: true}),
        scroll ? grid(sf("Teaches", scroll.spell, {wide: true}), sf("Unlock level", scroll.level, {wide: true})) : null,
        el("p", {class: "statHint", text: d.index ? `Used when a buy entry has the "Magic scroll ${d.index} rule": listed from this level until the spell is learned.` :
          "Buying it reveals the castle map. With the castle map rule, the entry disappears once bought."}));
    });
    return [relic, ...docs];
  }
  function docIcon(i) {
    const canvas = ui.el("canvas", {width: 16, height: 16, class: "itemIcon static"});
    ui.drawIcon(canvas, i ? 0x112 : 0x111, 0x118);
    return canvas;
  }

  function renderSell() {
    const {el, sf, card, val} = ui;
    const s = shop();
    if (!s?.found) return [];
    return [el("p", {class: "statHint wideHint", text: "Sell gem lists these seven items and what the librarian pays for each. Any head gear, armor, cloak or accessory can be sold; hand items cannot."}),
      ...s.sell.map(x => card(el("strong", {text: ui.itemLabel("bodyAny", val(x.item), x.item).replace(/^\d+ /, "")}), `#${x.index + 1}`,
        el("div", {class: "dropGrid"}, sf("Item", x.item), sf("Pays", x.price)),
        val(x.category) !== 4 ? el("p", {class: "statWarn", text: `Category is ${val(x.category)}; the sell screen counts stock correctly only for category 4.`}) : null))];
  }

  function renderTactics() {
    const {el, sf, card, rows} = ui;
    const s = shop();
    if (!s?.found) return [];
    return [card(el("strong", {text: "Tactics list"}), `${s.tactics.length} entries`,
      el("p", {class: "statHint", text: "Each entry is listed once you have fought that boss. Buying it unlocks the boss's tactics demo."}),
      rows("Entries", s.tactics.map(t => ({label: `#${t.index + 1}`, cells: [sf("Boss", t.boss), sf("Price", t.price)]})))),
    card(el("strong", {text: "Boss names"}), "shown in Tactics",
      rows("Names", s.bossNames.map((id, i) => ({label: `#${i}`, cells: [id ? ui.control(id) : el("span", {class: "sfMissing", text: "not found"})]}))))];
  }

  function renderMenus() {
    const {el, sf, card, grid, val} = ui;
    const s = shop();
    if (!s?.found) return [];
    return s.menus.map(menu => card(el("strong", {text: menu.label}), "library menu",
      grid(sf("Options", menu.count), ...menu.options.map((id, k) => {
        const node = sf(`Option ${k + 1}`, id);
        if (k >= val(menu.count)) node.classList.add("unused");
        return node;
      })),
      el("p", {class: "statHint", text: "Options past the count are not shown. Keep an Exit option."})));
  }

  function sections(u) {
    ui = u;
    return [
      {id: "buy", group: "Library shop", title: "Buy list", render: renderBuy, search: true, fields: s => s.shop?.entries && [s.shop.entries, s.shop.count]},
      {id: "relics", group: "Library shop", title: "Relic and documents", render: renderRelicDocs,
        fields: s => s.shop?.found && [s.shop.relics, s.shop.relicName, s.shop.relicCheck, s.shop.documents, s.shop.scrolls]},
      {id: "sell", group: "Library shop", title: "Sell gem", render: renderSell, fields: s => s.shop?.sell},
      {id: "tactics", group: "Librarian", title: "Tactics", render: renderTactics, fields: s => s.shop?.found && [s.shop.tactics, s.shop.bossNames]},
      {id: "menus", group: "Librarian", title: "Menu", render: renderMenus, fields: s => s.shop?.menus}
    ];
  }

  const view = window.SotnEditorView.createView({prefix: "shop", noun: "shop", sections, controls: CONTROLS,
    available: m => !!m.sections.shop?.found,
    unavailable: m => { document.getElementById("shopEmptyText").textContent = m.sections.shop?.reason || "The library shop was not found in this BIN."; },
    notes: () => [],
    rerender: f => f.file === S.FILE && (f.ui === "shopUnlock" || f.label === "Listed entries" || f.ui === "relic")});
  window.SotnShopUI = view;
})();
