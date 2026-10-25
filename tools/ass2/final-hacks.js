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
      /^Forward\.ppf$/, /^Zwei-600/, /^Duplichaos-Price/, /^Vlad-Relics/, /^Akmodan-II-DEF145/, /^Dracula-Hands-DEF66/, /^Medusa-DEF169/,
      /^Creature-Hammer-Only-LIT/, /^Cerberus-Water-Neutral/, /^Succubus-All-Attack-Damage/, /^Succubus-Wing-Spike-Damage/,
      /^Pentagram-35MP/, /^Potions-900/, /^Librarian-/, /^Water-Enemy-Attacks/, /^Dark-Resist-Undead/, /^Enemy-Element-Only/,
      /^Ascaln-Gram-Sword-Familiar-DAR/, /^Greater-Demon-Dracula-Hands-DEF/, /^Alucard-Rebalance/,
      /^Castle-Levels-Inverted/, /^First-Castle-Level-/, /^Dop10-Dagger/]},
  {id: 'content', kind: 'content', title: 'Map, pickup and text edits', category: 'Content',
    match: [/^Restore-Exact-Lost-Maps/, /^Recover-Main-With-Death/, /^All-Pot-Drops/, /Caverns-Pot-Drops/, /^Unique-MaxUp-Pickups/, /^Unique-Cards-Heart-Max-Ups/,
      /^Life-Apple-Pickups-to-Life-MaxUps/, /^Castle-Consumable-Replacements/, /Entrance-Dracula-Tunic/, /^Power-Core-Relic-Text/]},

  // ---- Boss AI: one patch for every boss.
  {id: 'boss-ai', kind: 'hack', category: BOSS, title: 'Boss AI pack',
    match: [/^Olrox-/, /^Granfaloon-/, /^Scylla-/, /Hippogryph/, p => /^Richter-/.test(p.name) && !/Rescue/.test(p.name) && ricOnly(p),
      /Cerberus-/, /^Fake-Heroes-/, /^Beelzebub-/, /^Death-(Second-Form|Barrage|Four-Normal|Final-Form)/, /^(ASS2-)?Medusa-(?!Shield-Laser)/,
      /Creature-(?!Hammer-Only)/, /^Doppleganger40-/, /^Akmodan-II-(Behavior|Scheduled|Attack)/, /Galamoth-/,
      /^Dracula-(?!Hands-DEF)/, /^Greater-Demon-Random-Angles/, /^Succubus-/, /Darkwing-Bat/],
    about: 'Olrox, Granfaloon, Scylla, Hippogryph, Richter (Epic Richter AI clock finisher), Cerberus, the Fake Trevor/Grant/Sypha, Beelzebub, Death, Medusa, The Creature, Doppleganger40, Akmodan II, Galamoth, Shaft/Dracula with a new Greater Demon final phase, Succubus and Darkwing Bat all get new attack patterns and AI.'},

  // ---- Normal enemies: one patch.
  {id: 'enemy-ai', kind: 'hack', category: ENEMY, title: 'Enemy AI pack',
    match: [/^Frozen-Half-/, /^Lesser-Demon-/, /^Skull-Lord-/, /^Wereskeleton-/, /^Enemy-No-Idle/, /^Bone-Ark-/, /^Balloon-Pod-/,
      /^Stone-Skull-/, /^Salome-/, /^Guardian-/, /^Sniper-/, /^Archer-/, /^Hammer-Blade-Gurkha/],
    about: 'Frozen Half ice-ball/rain cycle with smoke escape; Lesser Demon scripted summon-flight pattern at 1.5x; Skull Lord teleports behind Alucard; Wereskeleton head stretch; no idling and faster charges for several enemies; Bone Ark close lightning burst; Balloon Pods fly like crows with homing seeds; Hammer, Blade and Gurkha ignore hurt reactions; Stone Skulls chase when hurt; Salome\'s shield resists instead of blocking; Guardian wave, barrage, shield and teleport rework; Sniper of Goth dash and arrows; faster Anti-Chapel Archers.'},

  // ---- Weapons.
  {id: 'hunter-sword', kind: 'hack', category: WEAPON, title: 'Hunter Sword boomerang', match: [/^Hunter-Sword-/],
    about: 'QCF + attack throws a rotating Hunter Sword that returns like Shotel (private special row).'},
  {id: 'stone-sword', kind: 'hack', category: WEAPON, title: 'Stone Sword Medusa Shield special', match: [/^Stone-Sword-/],
    about: 'QCF + attack casts the Medusa Shield spell without a shield.'},
  {id: 'alucard-sword', kind: 'hack', category: WEAPON, title: 'Alucard Sword Soul Steal command', match: [/^Alucard-Sword-Soul-Steal/],
    about: 'Back-forward + attack with the Alucard Sword casts Soul Steal.'},
  {id: 'terminus-est', kind: 'hack', category: WEAPON, title: 'Terminus Est Crissaegrim special', match: [/^Terminus-Est-/],
    about: 'Back-forward + attack uses Crissaegrim\'s attack through its own editable row.'},
  {id: 'elemental-swords', kind: 'hack', category: WEAPON, title: 'Elemental swords instant specials', match: [/^Elemental-Swords-/],
    about: 'Heatgar, Sparkblade and Coldsteel use their brand-sword attacks with an instant (uncharged) elemental special.'},
  {id: 'ice-specials', kind: 'hack', category: WEAPON, title: 'Icebrand and Zero Celsius separate special stats', match: [/^Icebrand-Zero-Cel/],
    about: 'Icebrand and Zero Celsius specials get independent stats.'},
  {id: 'kidlat', kind: 'hack', category: WEAPON, title: 'Kidlat thunder slash', match: [/^Kidlat-/],
    about: 'Kidlat\'s instant slash plays Thunderbrand\'s thunder sound.'},
  {id: 'hunting-blade', kind: 'hack', category: WEAPON, title: 'Hunting Blade Heaven Sword special', match: [/^Hunting-Blade-/],
    about: 'The QCF special throws a Heaven Sword flight with its artwork and afterimages.'},
  {id: 'spirit-wand', kind: 'hack', category: WEAPON, title: 'Spirit Wand rework', match: [/^Spirit-Wand-/],
    about: 'Down, forward + attack casts Tetra Spirit; a Holy Rod swing with white lightning as the basic attack.'},
  {id: 'gram-pentagram', kind: 'hack', category: WEAPON, title: 'Gram Pentagram special', match: [/Gram-Pentagram-Special/],
    about: 'Gram\'s special casts the Pentagram spell.'},
  {id: 'staurolite', kind: 'hack', category: WEAPON, title: 'Staurolite doubles all subweapons', match: [/^Staurolite-/],
    about: 'Staurolite doubles the base damage of every subweapon.'},
  {id: 'fire-rings', kind: 'hack', category: WEAPON, title: 'Fire Rings', match: [/^Fire-Rings-/],
    about: 'A thrown fire ring with Chakram flight and a fire trail, costing MP per throw.'},
  {id: 'shield-spells', kind: 'hack', category: WEAPON, title: 'Real-time shield spells', match: [/^Shield-Spells-/, /^Alucard-Shield-/, /^Medusa-Shield-Laser/],
    about: 'Shield spells run in real time and drain MP while held; Alucard Shield heals and lasts 16 seconds; Medusa Shield lasers expire after 5 seconds.'},
  {id: 'axe-armor', kind: 'hack', category: WEAPON, title: 'Axe Armor jumps', match: [/^Axe-Armor-/],
    about: 'Axe Armor jumps like Alucard and can use a double-height jump with the Gravity Boots.'},
  {id: 'melee-ranged', kind: 'hack', category: WEAPON, title: 'Melee and Ranged weapon categories', match: [/^Melee-Ranged-/],
    about: 'Short swords, clubs and fists sort under Melee; throwing weapons under Ranged.'},

  // ---- Familiars.
  {id: 'dawn', kind: 'hack', category: FAMILIAR, title: 'Dawn familiar', match: [/^Dawn-/],
    about: 'Reawakened\'s Dawn familiar from the Sword of Dawn wall in the inverted Castle Keep, with its own menu icon, three swords per wave and up to six active.'},
  {id: 'ouroboros', kind: 'hack', category: FAMILIAR, title: 'Ouroboros familiar', match: [/^Ouroboros-/, /^Oroboros-/],
    about: 'Reawakened\'s Ouroboros (Dragon Card) in the unused Sprite slot, found in the Reverse Castle Entrance; scales with CON.'},
  {id: 'sword-familiar', kind: 'hack', category: FAMILIAR, title: 'Sword Familiar QCF swap', match: [/Sword-Familiar-/],
    about: 'QCF with the Sword Familiar swaps in another familiar temporarily; "Your best friend" description.'},
  {id: 'familiar-level', kind: 'hack', category: FAMILIAR, title: 'Familiars gain a level per kill', match: [/^Familiar-One-Level/],
    about: 'Each kill gives the active familiar one level.'},

  // ---- Items, relics and shops.
  {id: 'warp-cards', kind: 'hack', category: ITEM, title: 'Scorpion and noiL warp cards', match: [/Scorpion-and-noiL/, /^noiL-Card/],
    about: 'Library Card becomes the Scorpion Card (Outer Wall warp) and Takemitsu the noiL Card (inverted Castle Keep warp), reusable from either castle with the right map.'},
  {id: 'duplichaos', kind: 'hack', category: ITEM, title: 'Duplichaos', match: [/^Duplichaos-ASS/],
    about: 'The Duplicator becomes Duplichaos, an accessory that grants the power of Chaos on the Mystic Pendant tick.'},
  {id: 'drops', kind: 'hack', category: ITEM, title: 'Enemy food and watch drops', match: [/Enemy-Watches/, /Food-Drops-Healing/, /Food-By-Enemy-Size/],
    about: 'Each enemy drops one healing food chosen by its size, plus the current castle\'s watch at a fixed 5% (exclusive with food).'},
  {id: 'library-practice', kind: 'hack', category: ITEM, title: 'Library Practice and Boss cRush', match: [/^Library-Practice/, /^Practice-Block/, /^Boss-cRush-/i],
    about: 'The Library shop sells boss practice fights with full death animations and no EXP; Boss cRush keeps item slots and blocks warp cards.'},
  {id: 'shop-card', kind: 'hack', category: ITEM, title: 'Shop Card', match: [/Shop ?Card/i],
    about: 'A Shop Card that opens the Librarian\'s shop from anywhere, returning to the correct castle and map.'},
  {id: 'life-apple', kind: 'hack', category: ITEM, title: 'Life Apple auto-revive', match: [/^Life-Apple-(Revive|Full|Auto|Max)/],
    about: 'Life Apples revive Alucard automatically with HP equal to his max hearts, shown as a HUD of charges that refill at save points and on load.'},
  {id: 'death-return', kind: 'hack', category: WORLD, title: 'Death returns to the last save room', match: [/^Death-Return-/],
    about: 'Death returns Alucard to the last save room he visited, refilling his Life Apple charges, with a graphics fix for returns across zones.'},
  {id: 'item-slots', kind: 'hack', category: ITEM, title: 'Equipment item slots', match: [/^Equipment-Item-Slot/],
    about: 'Two selectable medicine/food equipment slots used by the item shortcut.'},
  {id: 'faerie-items', kind: 'hack', category: ITEM, title: 'Faerie item use', match: [/^Faerie-/, /^Antivenom-Uncurse/],
    about: 'The Faerie heals with Potions only and lets you drink potions yourself; Antivenom and Uncurse cost 100 Hearts, including when the Faerie uses them.'},
  {id: 'mana-prism', kind: 'hack', category: ITEM, title: 'Reusable Mana Prism', match: [/^Mana-Prism-/, /^Manna-Prism-/],
    about: 'The Mana Prism is reusable for 1000 Hearts and limited to one copy in the shop.'},
  {id: 'shop-limits', kind: 'hack', category: ITEM, title: 'Library shop order and one-copy limits', match: [/^Cloaks-One-Copy/, /^Library-Shop-Order/],
    about: 'The Library shop is reordered with new Hint prices, and eight items, cloaks included, can be bought only once.'},
  {id: 'gravity-boots', kind: 'hack', category: ITEM, title: 'Gravity Boots once per landing', match: [/^Gravity-Boots-/],
    about: 'Gravity Boots can be used once until Alucard lands.'},
  {id: 'bloodlust-ring', kind: 'hack', category: ITEM, title: 'Bloodlust Ring permanent Dark Metamorphosis', match: [/^Bloodlust-Ring-/],
    about: 'The Bloodlust Ring keeps Dark Metamorphosis active.'},
  {id: 'equip-sort', kind: 'hack', category: ITEM, title: 'Equipment sorting', match: [/^Weapons-Sort-/, /Equip-Sort-/],
    about: 'The equipment list sorts into eight categories, and weapons by ATK (highest first) within each type.'},
  {id: 'stats-past-99', kind: 'hack', category: ITEM, title: 'Stats past 99', match: [/^Stats-Past-99/],
    about: 'STR, CON, INT and LCK base and gear values can go past 99.'},

  // ---- Alucard.
  {id: 'dark-metamorphosis', kind: 'hack', category: ALUCARD, title: 'Dark Metamorphosis rework', match: [/^Dark-Metamorphosis-(Instant|1\.25x)/, /^Save-Up-Cancel-Dark/],
    about: 'Casting returns control at once and keeps Alucard\'s form; its 1.25x speed is safe at save points, and saving (Up at a save point) clears it.'},
  {id: 'scaled-buffs', kind: 'hack', category: ALUCARD, title: 'Stat-scaled buffs', match: [/^Dark-Metamorphosis-(Scaled|DEF-CON|Base-Stat)/, /^Buff-Potions-Faerie/, /^Shared-DEF-Buff/],
    about: 'Dark Metamorphosis, the buff potions and the Faerie\'s buffs add half of Alucard\'s base STR/CON/INT/LCK instead of flat values; the shared DEF buff is floor(CON / 10) (updates the existing Dark Metamorphosis stat buff hack).'},
  {id: 'blue-metalmorphosis', kind: 'hack', category: ALUCARD, title: 'Blue Metalmorphosis spell', match: [/^Blue-Metalmorphosis/],
    // Public text stays cryptic on purpose: the input is a secret for players to find.
    about: 'Transform into the Axe Lord using a spell.'},
  {id: 'level-growth', kind: 'hack', category: ALUCARD, title: 'Deterministic level growth', match: [/^Alucard-Level-Growth/],
    about: 'Alucard\'s level-up gains are fixed instead of random.'},
  {id: 'dropkick', kind: 'hack', category: ALUCARD, title: 'Down+X dropkick priority', match: [/^Down-X-Dropkick/],
    about: 'Down + a fresh jump press always dropkicks, even after Sky Walker jumps.'},
  {id: 'air-control', kind: 'hack', category: ALUCARD, title: 'Air control and hurt recovery',
    match: [/^Air-Hurt-Cancel/, /^Alucard-(Ledge-Jump|Transform)-Air-Control/, /^Alucard-Air-Hurt-Recovery/],
    about: 'Air control after leaving a ledge or transforming, recovery from airborne hurt after 60 frames, and hurt cancels into Richter\'s backflip and Alucard\'s dropkick.'},
  {id: 'bat-form', kind: 'hack', category: ALUCARD, title: 'Bat form and Wing Smash', match: [/^Bat-Form-/, /^Wing-Smash-/, /^Power-of-Mist-Infinite/],
    about: 'Bat form flies twice as fast; Power of Mist makes Wing Smash unlimited.'},
  {id: 'heart-refresh', kind: 'hack', category: ALUCARD, title: 'Heart Refresh shortcut', match: [/^Heart-Refresh-/],
    about: 'Heart Refresh runs in real time from the item shortcut with its native animation.'},
  {id: 'hellfire', kind: 'hack', category: ALUCARD, title: 'Hellfire casts in place', match: [/^Hellfire-/],
    about: 'Hellfire skips the teleport and its windup is under half a second.'},
  {id: 'spell-int', kind: 'hack', category: ALUCARD, title: 'Spells scale with INT', match: [/^Spell-INT-/],
    about: 'Spell and form attack damage is multiplied by (INT + 500) / 500 instead of a flat bonus.'},

  // ---- Status and damage rules.
  {id: 'petrification', kind: 'hack', category: MECHANIC, title: 'Petrification rework', match: [/^Petrification-/],
    about: 'Petrification lasts 3 seconds with no directional escape; hits while petrified have a 30-frame cooldown.'},
  {id: 'poison', kind: 'hack', category: MECHANIC, title: 'Poison damage over time', match: [/^Poison-/],
    about: 'Poison deals 5 HP every 10 frames for its duration.'},
  {id: 'percent-def', kind: 'hack', category: MECHANIC, title: 'Percent DEF', match: [/^Percent-DEF-/, /^Walk-Armor-/],
    about: 'DEF reduces damage by a percentage instead of subtracting, replacing the separate inverted-castle +200; Walk Armor\'s map DEF is capped at 15. Carries the current DEF of all of Alucard\'s equipment and every enemy, whichever patch set it.'},
  {id: 'second-castle-attacks', kind: 'balance', category: 'Balance', title: 'Second-castle attack helper', match: []},

  // ---- Menus.
  {id: 'element-line', kind: 'hack', category: MENU, title: 'RES/WEAK element line', match: [/^Menu-RES-WEAK/],
    about: 'The main menu shows Alucard\'s resistances and weaknesses below GOLD.'},
  {id: 'system-settings', kind: 'hack', category: MENU, title: 'Minimap setting and item shortcut button', match: [/^System-Settings/],
    about: 'System gains Show minimap: Yes/No; Button Config gains a remappable Item Shortcut.'},
  {id: 'damage-colors-weak', kind: 'hack', category: MENU, title: 'Damage number colors: weak and resist', match: [/^Damage-Number-(Colors|Helper)-/],
    about: 'Weakness hits flash the GUARD colors and resisted hits are grey (update to the existing Damage Number Colors hack).'},
  {id: 'title-final', kind: 'hack', category: MENU, title: 'Title: Alternate Scarlet Symphony -Final-', match: [/^Title-Alternate/, /Title-Placement/],
    about: 'The title screen reads Alternate Scarlet Symphony -Final-. Always included in the full ASS -Final- patch.'},

  // ---- World.
  {id: 'clock-tower-doors', kind: 'hack', category: WORLD, title: 'Clock Tower gear doors always open', match: [/^Clock-Towers-/],
    about: 'Both Clock Tower gear doors stay open.'},
  {id: 'richter-rescue', kind: 'hack', category: WORLD, title: 'Richter rescue fix and skip', match: [/^Richter-(Boss-)?Rescue-/],
    about: 'Defeating Richter goes through Shaft\'s orb rescue correctly, and the rescue requirement can be skipped while keeping the cutscene voices (supersedes the WIP Richter always saved hack).'},
  {id: 'prologue-skip', kind: 'hack', category: WORLD, title: 'Prologue skip', match: [/Prologue/, /Forest-Bridge-Start/],
    about: 'New Alucard games skip the intro movie, the Richter prologue and the story scroll and start with the forest run into the castle; no prologue rewards, and boss records and the clock are reset.'},

  // ---- Richter Mode (playable Richter). One patch: the parts share code caves and build on each other.
  {id: 'richter-mode', kind: 'hack', category: RICHTER, title: 'Richter Mode overhaul', match: [/^Richter-/],
    about: 'Playable Richter rebuilt: Rest levels and milestones, healing and collection growth, four-digit hearts, Heart Regen, relic abilities, Blade Dash, Roundhouse, Rising Hurricane, default run with L2 walk, new pause pages with a guide, all Alucard bosses, and many fixes.'}
];

function classify(ppf) {
  const p = {...ppf, name: ppf.name || require('node:path').basename(ppf.file).replace(/^(Reverse|Undo)-/, '')};
  for (const f of FEATURES) for (const m of f.match) if (typeof m === 'function' ? m(p) : m.test(p.name)) return f.id;
  return null;
}

module.exports = {FEATURES, classify};
