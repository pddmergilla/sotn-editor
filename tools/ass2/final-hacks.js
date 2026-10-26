// Feature groups for the changes made to the main BIN after ASS 2.0.10 (Alternate Scarlet Symphony -Final-).
// Each applied PPF found next to the main BIN, in outputs/ or in Downloads is assigned to exactly one group by
// its file name (first match wins). `kind` decides what gets a separate patch:
//   hack     a feature or behaviour change that gets its own guarded PPF pair
//   balance  stats, costs, DEF/HP/attack values or element tables only (no separate patch, left out of the list)
//   content  map, room, pickup placement or text edits (no separate patch, listed separately)
// All boss AI changes share one group and all normal-enemy AI changes another, as requested for the Final release.

const BOSS = 'Boss AI', ENEMY = 'Enemy AI', WEAPON = 'Weapons and specials', FAMILIAR = 'Familiars',
  ITEM = 'Items, relics and shops', ALUCARD = 'Alucard abilities and spells', MECHANIC = 'Status and damage rules',
  MENU = 'Menus and presentation', RICHTER = 'Richter Mode', WORLD = 'World and story';

// A Richter patch that wrote the BO6 boss overlay and not BIN/RIC.BIN (or the stage relic code) is the boss fight;
// the rest is Richter Mode.
const ricOnly = p => { const f = Object.keys(p.files || {}); return f.some(x => /BO6\.BIN/.test(x)) && !f.some(x => /RIC\.BIN|NO0\.BIN/.test(x)); };

const FEATURES = [
  // Balance first, so tuning-only patches inside a feature's name family are not mistaken for the feature.
  {id: 'balance', kind: 'balance', title: 'Balance and stat values', category: 'Balance',
    match: [/^Boss-DEF-Retune/, /^Enemy-HP-Percent-DEF-Retune/, /^Equipment-DEF-99/, /^Inverted-Bosses-DEF/, /^Inverted-Exclusive-Plus1000/,
      /^Forward\.ppf$/, /^Zwei-600/, /^Duplichaos-Price/, /^Vlad-Relics/, /^Akmodan-II-DEF145/, /^Akmodan-II-WAT-Weakness/, /Half-Food-Heals/, /^Dracula-Hands-DEF66/, /^Medusa-DEF169/,
      /^Creature-Hammer-Only-LIT/, /^Cerberus-Water-Neutral/, /^Succubus-All-Attack-Damage/, /^Succubus-Wing-Spike-Damage/,
      /^Pentagram-35MP/, /^Potions-900/, /^Librarian-/, /^Water-Enemy-Attacks/, /^Dark-Resist-Undead/, /^Enemy-Element-Only/,
      /^Ascaln-Gram-Sword-Familiar-DAR/, /^Greater-Demon-Dracula-Hands-DEF/, /^Alucard-Rebalance/,
      /^Castle-Levels-Inverted/, /^First-Castle-Level-/, /^Dop10-Dagger/]},
  {id: 'content', kind: 'content', title: 'Map, pickup and text edits', category: 'Content',
    match: [/^Restore-Exact-Lost-Maps/, /^Recover-Main-With-Death/, /^All-Pot-Drops/, /Caverns-Pot-Drops/, /^Unique-MaxUp-Pickups/, /^Unique-Cards-Heart-Max-Ups/,
      /^Life-Apple-Pickups-to-Life-MaxUps/, /^Castle-Consumable-Replacements/, /Entrance-Dracula-Tunic/, /^Power-Core-Relic-Text/, /^Credits-Oy-Final/, /^Credits-Centered/, /^Prologue-Welcome-/]},

  // ---- Boss AI: one patch for every boss.
  {id: 'boss-ai', kind: 'hack', category: BOSS, title: 'Boss AI pack',
    match: [/^Olrox-/, /^Granfaloon-/, /^Scylla-/, /Hippogryph/, p => /^Richter-/.test(p.name) && !/Rescue/.test(p.name) && ricOnly(p),
      /Cerberus-/, /^Fake-Heroes-/, /^Beelzebub-/, /^Death-(Second-Form|Barrage|Four-Normal|Final-Form)/, /^(ASS2-)?Medusa-(?!Shield-Laser)/,
      /Creature-(?!Hammer-Only)/, /^Doppleganger40-/, /^Akmodan-II-(Behavior|Scheduled|Attack|Grab)/, /Galamoth-/,
      /^Dracula-(?!Hands-DEF)/, /^Greater-Demon-Random-Angles/, /^Succubus-/, /Darkwing-Bat/],
    about: 'Bosses fight with new AI and new attack patterns.'},

  // ---- Normal enemies: one patch.
  {id: 'enemy-ai', kind: 'hack', category: ENEMY, title: 'Enemy AI pack',
    match: [/^Frozen-Half-/, /^Lesser-Demon-/, /^Skull-Lord-/, /^Wereskeleton-/, /^Enemy-No-Idle/, /^Bone-Ark-/, /^Balloon-Pod-/,
      /^Stone-Skull-/, /^Salome-/, /^Guardian-/, /^Sniper-/, /^Archer-/, /^Hammer-Blade-Gurkha/],
    about: 'Enemies fight with new AI and new attack patterns.'},

  // ---- Weapons: one patch.
  {id: 'weapons', kind: 'hack', category: WEAPON, title: 'New Weapons and Specials',
    match: [/^Hunter-Sword-/, /^Stone-Sword-/, /^Alucard-Sword-Soul-Steal/, /^Terminus-Est-/, /^Elemental-Swords-/, /^Icebrand-Zero-Cel/,
      /^Kidlat-/, /^Hunting-Blade-/, /^Spirit-Wand-/, /Gram-Pentagram-Special/, /^Staurolite-/, /^Fire-Rings-/,
      /^Shield-Spells-/, /^Alucard-Shield-/, /^Medusa-Shield-Laser/, /^Axe-Armor-/, /^Melee-Ranged-/, /^Ranged-Weapon-Subweapons/],
    about: 'New weapons, and new special moves for many existing ones.'},

  // ---- Familiars.
  {id: 'dawn', kind: 'hack', category: FAMILIAR, title: 'Dawn familiar', match: [/^Dawn-/],
    about: 'Reawakened\'s Dawn familiar joins the castle, with its own menu icon.'},
  {id: 'ouroboros', kind: 'hack', category: FAMILIAR, title: 'Ouroboros familiar', match: [/^Ouroboros-/, /^Oroboros-/],
    about: 'Reawakened\'s Ouroboros familiar joins the castle and grows stronger with CON.'},
  {id: 'sword-familiar', kind: 'hack', category: FAMILIAR, title: 'Sword Familiar QCF swap', match: [/Sword-Familiar-/],
    about: 'The Sword Familiar can call in another familiar for a while.'},
  {id: 'familiar-level', kind: 'hack', category: FAMILIAR, title: 'Familiars gain a level per kill', match: [/^Familiar-One-Level/],
    about: 'Familiars level up with every kill.'},

  // ---- Items, relics and shops: one patch.
  {id: 'items', kind: 'hack', category: ITEM, title: 'Items, relics and shops',
    match: [/Scorpion-and-noiL/, /^noiL-Card/, /^Duplichaos-ASS/, /Enemy-Watches/, /Food-Drops-Healing/, /Food-By-Enemy-Size/,
      /^Library-Practice/, /^Practice-Block/, /^Boss-cRush-/i, /Shop ?Card/i, /^Life-Apple-(Revive|Full|Auto|Max)/, /^Equipment-Item-Slot/,
      /^Faerie-/, /^Antivenom-Uncurse/, /^Mana-Prism-/, /^Manna-Prism-/, /^Cloaks-One-Copy/, /^Library-Shop-Order/, /^Gravity-Boots-/,
      /^Bloodlust-Ring-/, /^Weapons-Sort-/, /Equip-Sort-/, /^Stats-Past-99/],
    about: 'New and reworked items, relics and shop goods, including the item slots for the L2 shortcut and the Boss CRush mode.'},

  // ---- Alucard.
  {id: 'dark-metamorphosis', kind: 'hack', category: ALUCARD, title: 'Dark Metamorphosis rework', match: [/^Dark-Metamorphosis-(Instant|1\.25x)/, /^Save-Up-Cancel-Dark/],
    about: 'Dark Metamorphosis returns control at once, keeps Alucard\'s form and is safe at save points.'},
  {id: 'scaled-buffs', kind: 'hack', category: ALUCARD, title: 'Stat-scaled buffs', joinInto: 'dark-stats', match: [/^Dark-Metamorphosis-(Scaled|DEF-CON|Base-Stat)/, /^Buff-Potions-Faerie/, /^Shared-DEF-Buff/],
    about: 'Dark Metamorphosis, the buff potions and the Faerie\'s buffs grow with Alucard\'s stats.'},
  {id: 'blue-metalmorphosis', kind: 'hack', category: ALUCARD, title: 'Blue Metalmorphosis spell', match: [/^Blue-Metalmorphosis/],
    // Public text stays cryptic on purpose: the input is a secret for players to find.
    about: 'Transform into the Axe Lord using a spell.'},
  {id: 'level-growth', kind: 'hack', category: ALUCARD, title: 'Deterministic level growth', match: [/^Alucard-Level-Growth/],
    about: 'Alucard\'s level-up gains are fixed instead of random.'},
  {id: 'dropkick', kind: 'hack', category: ALUCARD, title: 'Down+X dropkick priority', joinInto: 'sky-walker', match: [/^Down-X-Dropkick/],
    about: 'Down + jump always dropkicks, even after Sky Walker jumps.'},
  {id: 'air-control', kind: 'hack', category: ALUCARD, title: 'Air control and hurt recovery',
    match: [/^Air-Hurt-Cancel/, /^Alucard-(Ledge-Jump|Transform)-Air-Control/, /^Alucard-Air-Hurt-Recovery/],
    about: 'Better control in the air after leaving a ledge, transforming or getting hit.'},
  {id: 'bat-form', kind: 'hack', category: ALUCARD, title: 'Bat form and Wing Smash', match: [/^Bat-Form-/, /^Wing-Smash-/, /^Power-of-Mist-Infinite/],
    about: 'Bat form flies faster, and Power of Mist makes Wing Smash unlimited.'},
  {id: 'heart-refresh', kind: 'hack', category: ALUCARD, title: 'Heart Refresh shortcut', match: [/^Heart-Refresh-/],
    about: 'Heart Refresh runs in real time from the item shortcut.'},
  {id: 'hellfire', kind: 'hack', category: ALUCARD, title: 'Hellfire casts in place', match: [/^Hellfire-/],
    about: 'Hellfire casts where Alucard stands, with a shorter windup.'},
  {id: 'spell-int', kind: 'hack', category: ALUCARD, title: 'Spells and subweapons scale with INT', match: [/^Spell-INT-/, /^Subweapon-Spell-INT-/],
    about: 'Spells, form attacks and subweapons grow stronger with INT.'},

  // ---- Status and damage rules.
  {id: 'petrification', kind: 'hack', category: MECHANIC, title: 'Petrification rework', match: [/^Petrification-/],
    about: 'Petrification is shorter and harder to wiggle out of, and hits while petrified are spaced out.'},
  {id: 'poison', kind: 'hack', category: MECHANIC, title: 'Poison damage over time', match: [/^Poison-/],
    about: 'Poison drains HP over time.'},
  {id: 'percent-def', kind: 'hack', category: MECHANIC, title: 'Percent DEF', match: [/^Percent-DEF-/, /^Walk-Armor-/],
    about: 'DEF reduces damage by a percentage. Brings the current DEF of all equipment and enemies with it.'},
  {id: 'second-castle-attacks', kind: 'balance', category: 'Balance', title: 'Second-castle attack helper', match: []},

  // ---- Menus.
  {id: 'element-line', kind: 'hack', category: MENU, title: 'RES/WEAK element line', match: [/^Menu-RES-WEAK/],
    about: 'The main menu shows Alucard\'s resistances and weaknesses.'},
  {id: 'system-settings', kind: 'hack', category: MENU, title: 'Minimap setting and item shortcut button', match: [/^System-Settings/],
    about: 'System gains a setting to show or hide the minimap, and Button Config gains a remappable item shortcut.'},
  {id: 'damage-colors-weak', kind: 'hack', category: MENU, title: 'Damage number colors: weak and resist', match: [/^Damage-Number-(Colors|Helper)-/],
    about: 'Weakness and resisted hits get their own damage number colors (adds to Damage Number Colors).'},
  {id: 'title-final', kind: 'hack', category: MENU, title: 'Title: Alternate Scarlet Symphony -Final-', match: [/^Title-Alternate/, /Title-Placement/],
    about: 'The title screen reads Alternate Scarlet Symphony -Final-. Always included in the full ASS -Final- patch.'},

  // ---- World.
  {id: 'death-return', kind: 'hack', category: WORLD, title: 'No more game over', match: [/^Death-Return-/],
    about: 'Death just brings Alucard back to the last save point.'},
  {id: 'clock-tower-doors', kind: 'hack', category: WORLD, title: 'Clock Tower gear doors always open', match: [/^Clock-Towers-/],
    about: 'Both Clock Tower gear doors stay open.'},
  {id: 'richter-rescue', kind: 'hack', category: WORLD, title: 'Richter rescue cutscene fixes', match: [/^Richter-(Boss-)?Rescue-/],
    about: 'The Richter rescue cutscene plays correctly, with its voices.'},
  {id: 'prologue-skip', kind: 'hack', category: WORLD, title: 'Prologue skip', match: [/Prologue/, /Forest-Bridge-Start/],
    about: 'New Alucard games skip the Richter prologue and start with the story scroll.'},

  // ---- Richter Mode (playable Richter). One patch: the parts share code caves and build on each other.
  {id: 'richter-mode', kind: 'hack', category: RICHTER, title: 'Richter Mode overhaul', match: [/^Richter-/],
    about: 'Playable Richter rebuilt: Rest levels, growth from collecting, relic abilities, new moves, a new pause menu with a guide, and every boss Alucard faces.'}
];

// PPFs that carry two features: each byte goes to the feature of the file it is in.
const SPLITS = [
  // The Stone Skull death fix is enemy code in the stage overlays; Patek's 100% drop is the Items drop hook in DRA.
  {match: /^Guardian-Stone-Skull-Patek/, features: ['enemy-ai', 'items'], feature: file => /^ST\//.test(file) ? 'enemy-ai' : 'items'},
];

function classify(ppf) {
  const p = {...ppf, name: ppf.name || require('node:path').basename(ppf.file).replace(/^(Reverse|Undo)-/, '')};
  for (const f of FEATURES) for (const m of f.match) if (typeof m === 'function' ? m(p) : m.test(p.name)) return f.id;
  return null;
}

module.exports = {FEATURES, SPLITS, classify};
