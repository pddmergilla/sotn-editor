# Alternate Scarlet Symphony -Final- changes

[← Back to the README](../README.md)

The main BIN gained 57 features after ASS 2.0.10. This page lists them for the editor v8.0 / ASS -Final- release and the Extra Hacks update. Balance changes (stat, cost, DEF/HP/attack values, element tables) are left out.

`node tools/ass2/build-final-hacks.js` rebuilds 2.0.10 from vanilla and the shipped PPF, then assigns every byte that differs in the main BIN to the newest applied PPF that wrote it. It searches next to the main BIN, `outputs/`, Downloads and the Documents/Codex session outputs. The groups are defined in `tools/ass2/final-hacks.js`. All boss AI changes share one group, and all normal-enemy AI changes share another. A later retune of a feature's own bytes stays with that feature. When a feature replaced bytes that another wrote, it is built on top of that feature and lists it under **Requires**.

For each feature it writes `ASS-Final-<feature>.ppf` (2.0.10 plus requirements → with the feature) and `Reverse-ASS-Final-<feature>.ppf` (current BIN → without it), both guarded PPF3 with undo data and repaired EDC/ECC, plus `specs/<id>.json` with Extra Hacks-style edit runs. Output goes to `MainBIN/ASS-Final-Hacks/` with a README and `ASS-Final-Hacks.verification.json`. The main BIN is only read.

Checks: 2.0.10 plus every feature in install order plus the excluded bytes reproduces every changed sector of the main BIN. Each forward and reversal PPF applies with its guards, writes valid EDC/ECC and undoes exactly. Chaining all forward PPFs from disk reproduces the main BIN except the excluded bytes. Patches that share a sector carry EDC/ECC for their own target only. When you chain them outside the editor, use a patcher that skips undo checks, then repair sector checksums. None of this was played in an emulator.

Built on 2026-10-25 against main BIN `8150DE0D72BA535CB19E966FC08DF088AC1E7746B72946A6F036409AAFD59D63`. Rerun the builder after further BIN changes. Every hack below can be toggled in the Extra Hacks tab ([details](extra-hacks.md#ass--final--hacks)). Excluded: balance 2,966 bytes, map/pickup/text content 31,471 bytes, unattributed 2 bytes. 197 bytes that no PPF wrote were joined to the neighbouring feature in the same file. They are listed under `attributedByProximity` for review.






### Boss AI

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Boss AI pack** | Olrox, Granfaloon, Scylla, Hippogryph, Richter (Epic Richter AI clock finisher), Cerberus, the Fake Trevor/Grant/Sypha, Beelzebub, Death, Medusa, The Creature, Doppleganger40, Akmodan II, Galamoth, Shaft/Dracula with a new Greater Demon final phase, Succubus and Darkwing Bat all get new attack patterns and AI. | — | 221,579 | `ASS-Final-Boss-AI-pack.ppf` |

### Enemy AI

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Enemy AI pack** | Frozen Half ice-ball/rain cycle with smoke escape; Lesser Demon scripted summon-flight pattern at 1.5x; Skull Lord teleports behind Alucard; Wereskeleton head stretch; no idling and faster charges for several enemies; Bone Ark close lightning burst; Balloon Pods fly like crows with homing seeds; Hammer, Blade and Gurkha ignore hurt reactions; Stone Skulls chase when hurt; Salome's shield resists instead of blocking; Guardian wave, barrage, shield and teleport rework; Sniper of Goth dash and arrows; faster Anti-Chapel Archers. | — | 11,024 | `ASS-Final-Enemy-AI-pack.ppf` |

### Weapons and specials

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Hunter Sword boomerang** | QCF + attack throws a rotating Hunter Sword that returns like Shotel (private special row). | — | 2,411 | `ASS-Final-Hunter-Sword-boomerang.ppf` |
| **Stone Sword Medusa Shield special** | QCF + attack casts the Medusa Shield spell without a shield. | — | 3,154 | `ASS-Final-Stone-Sword-Medusa-Shield-special.ppf` |
| **Alucard Sword Soul Steal command** | Back-forward + attack with the Alucard Sword casts Soul Steal. | — | 144 | `ASS-Final-Alucard-Sword-Soul-Steal-command.ppf` |
| **Terminus Est Crissaegrim special** | Back-forward + attack uses Crissaegrim's attack through its own editable row. | — | 7,348 | `ASS-Final-Terminus-Est-Crissaegrim-special.ppf` |
| **Elemental swords instant specials** | Heatgar, Sparkblade and Coldsteel use their brand-sword attacks with an instant (uncharged) elemental special. | — | 767 | `ASS-Final-Elemental-swords-instant-specials.ppf` |
| **Icebrand and Zero Celsius separate special stats** | Icebrand and Zero Celsius specials get independent stats. | Elemental swords instant specials | 372 | `ASS-Final-Icebrand-and-Zero-Celsius-separate-special-stats.ppf` |
| **Kidlat thunder slash** | Kidlat's instant slash plays Thunderbrand's thunder sound. | — | 310 | `ASS-Final-Kidlat-thunder-slash.ppf` |
| **Hunting Blade Heaven Sword special** | The QCF special throws a Heaven Sword flight with its artwork and afterimages. | Hunter Sword boomerang | 7,299 | `ASS-Final-Hunting-Blade-Heaven-Sword-special.ppf` |
| **Spirit Wand rework** | Down, forward + attack casts Tetra Spirit; a Holy Rod swing with white lightning as the basic attack. | — | 1,738 | `ASS-Final-Spirit-Wand-rework.ppf` |
| **Gram Pentagram special** | Gram's special casts the Pentagram spell. | — | 21,704 | `ASS-Final-Gram-Pentagram-special.ppf` |
| **Staurolite doubles all subweapons** | Staurolite doubles the base damage of every subweapon. | — | 88 | `ASS-Final-Staurolite-doubles-all-subweapons.ppf` |
| **Fire Rings** | A thrown fire ring with Chakram flight and a fire trail, costing MP per throw. | — | 95 | `ASS-Final-Fire-Rings.ppf` |
| **Real-time shield spells** | Shield spells run in real time and drain MP while held; Alucard Shield heals and lasts 16 seconds; Medusa Shield lasers expire after 5 seconds. | — | 582 | `ASS-Final-Real-time-shield-spells.ppf` |
| **Axe Armor jumps** | Axe Armor jumps like Alucard and can use a double-height jump with the Gravity Boots. | — | 1,014 | `ASS-Final-Axe-Armor-jumps.ppf` |
| **Melee and Ranged weapon categories** | Short swords, clubs and fists sort under Melee; throwing weapons under Ranged. | — | 34 | `ASS-Final-Melee-and-Ranged-weapon-categories.ppf` |

### Familiars

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Dawn familiar** | Reawakened's Dawn familiar from the Sword of Dawn wall in the inverted Castle Keep, with its own menu icon, three swords per wave and up to six active. | — | 34,023 | `ASS-Final-Dawn-familiar.ppf` |
| **Ouroboros familiar** | Reawakened's Ouroboros (Dragon Card) in the unused Sprite slot, found in the Reverse Castle Entrance; scales with CON. | Dawn familiar | 35,622 | `ASS-Final-Ouroboros-familiar.ppf` |
| **Sword Familiar QCF swap** | QCF with the Sword Familiar swaps in another familiar temporarily; "Your best friend" description. | — | 1,525 | `ASS-Final-Sword-Familiar-QCF-swap.ppf` |
| **Familiars gain a level per kill** | Each kill gives the active familiar one level. | — | 5 | `ASS-Final-Familiars-gain-a-level-per-kill.ppf` |

### Items, relics and shops

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Scorpion and noiL warp cards** | Library Card becomes the Scorpion Card (Outer Wall warp) and Takemitsu the noiL Card (inverted Castle Keep warp), reusable from either castle with the right map. | Death returns to the last save room, Shop Card | 294 | `ASS-Final-Scorpion-and-noiL-warp-cards.ppf` |
| **Duplichaos** | The Duplicator becomes Duplichaos, an accessory that grants the power of Chaos on the Mystic Pendant tick. | — | 108 | `ASS-Final-Duplichaos.ppf` |
| **Enemy food and watch drops** | Each enemy drops one healing food chosen by its size, plus the current castle's watch at a fixed 5% (exclusive with food). | — | 2,553 | `ASS-Final-Enemy-food-and-watch-drops.ppf` |
| **Library Practice and Boss cRush** | The Library shop sells boss practice fights with full death animations and no EXP; Boss cRush keeps item slots and blocks warp cards. | Familiars gain a level per kill | 980 | `ASS-Final-Library-Practice-and-Boss-cRush.ppf` |
| **Shop Card** | A Shop Card that opens the Librarian's shop from anywhere, returning to the correct castle and map. | Death returns to the last save room | 669 | `ASS-Final-Shop-Card.ppf` |
| **Life Apple auto-revive** | Life Apples revive Alucard automatically with HP equal to his max hearts, shown as a HUD of charges that refill at save points and on load. | Death returns to the last save room | 1,000 | `ASS-Final-Life-Apple-auto-revive.ppf` |
| **Equipment item slots** | Two selectable medicine/food equipment slots used by the item shortcut. | Melee and Ranged weapon categories | 2,390 | `ASS-Final-Equipment-item-slots.ppf` |
| **Faerie item use** | The Faerie heals with Potions only and lets you drink potions yourself; Antivenom and Uncurse cost 100 Hearts, including when the Faerie uses them. | — | 236 | `ASS-Final-Faerie-item-use.ppf` |
| **Reusable Mana Prism** | The Mana Prism is reusable for 1000 Hearts and limited to one copy in the shop. | Library shop order and one-copy limits | 35 | `ASS-Final-Reusable-Mana-Prism.ppf` |
| **Library shop order and one-copy limits** | The Library shop is reordered with new Hint prices, and eight items, cloaks included, can be bought only once. | — | 243 | `ASS-Final-Library-shop-order-and-one-copy-limits.ppf` |
| **Gravity Boots once per landing** | Gravity Boots can be used once until Alucard lands. | — | 386 | `ASS-Final-Gravity-Boots-once-per-landing.ppf` |
| **Bloodlust Ring permanent Dark Metamorphosis** | The Bloodlust Ring keeps Dark Metamorphosis active. | — | 61 | `ASS-Final-Bloodlust-Ring-permanent-Dark-Metamorphosis.ppf` |
| **Equipment sorting** | The equipment list sorts into eight categories, and weapons by ATK (highest first) within each type. | Melee and Ranged weapon categories | 281 | `ASS-Final-Equipment-sorting.ppf` |
| **Stats past 99** | STR, CON, INT and LCK base and gear values can go past 99. | — | 8 | `ASS-Final-Stats-past-99.ppf` |

### World and story

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Death returns to the last save room** | Death returns Alucard to the last save room he visited, refilling his Life Apple charges, with a graphics fix for returns across zones. | — | 275 | `ASS-Final-Death-returns-to-the-last-save-room.ppf` |
| **Clock Tower gear doors always open** | Both Clock Tower gear doors stay open. | — | 32 | `ASS-Final-Clock-Tower-gear-doors-always-open.ppf` |
| **Richter rescue fix and skip** | Defeating Richter goes through Shaft's orb rescue correctly, and the rescue requirement can be skipped while keeping the cutscene voices (supersedes the WIP Richter always saved hack). | Boss AI pack | 132 | `ASS-Final-Richter-rescue-fix-and-skip.ppf` |
| **Prologue skip** | New Alucard games skip the intro movie, the Richter prologue and the story scroll and start with the forest run into the castle; no prologue rewards, and boss records and the clock are reset. | — | 165 | `ASS-Final-Prologue-skip.ppf` |

### Alucard abilities and spells

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Dark Metamorphosis rework** | Casting returns control at once and keeps Alucard's form; its 1.25x speed is safe at save points, and saving (Up at a save point) clears it. | — | 27 | `ASS-Final-Dark-Metamorphosis-rework.ppf` |
| **Stat-scaled buffs** | Dark Metamorphosis, the buff potions and the Faerie's buffs add half of Alucard's base STR/CON/INT/LCK instead of flat values; the shared DEF buff is floor(CON / 10) (updates the existing Dark Metamorphosis stat buff hack). | — | 372 | `ASS-Final-Stat-scaled-buffs.ppf` |
| **Blue Metalmorphosis spell** | Transform into the Axe Lord using a spell. | — | 1,717 | `ASS-Final-Blue-Metalmorphosis-spell.ppf` |
| **Deterministic level growth** | Alucard's level-up gains are fixed instead of random. | — | 15 | `ASS-Final-Deterministic-level-growth.ppf` |
| **Down+X dropkick priority** | Down + a fresh jump press always dropkicks, even after Sky Walker jumps. | — | 8 | `ASS-Final-Down-X-dropkick-priority.ppf` |
| **Air control and hurt recovery** | Air control after leaving a ledge or transforming, recovery from airborne hurt after 60 frames, and hurt cancels into Richter's backflip and Alucard's dropkick. | — | 550 | `ASS-Final-Air-control-and-hurt-recovery.ppf` |
| **Bat form and Wing Smash** | Bat form flies twice as fast; Power of Mist makes Wing Smash unlimited. | — | 69 | `ASS-Final-Bat-form-and-Wing-Smash.ppf` |
| **Heart Refresh shortcut** | Heart Refresh runs in real time from the item shortcut with its native animation. | Melee and Ranged weapon categories, Equipment item slots | 7,121 | `ASS-Final-Heart-Refresh-shortcut.ppf` |
| **Hellfire casts in place** | Hellfire skips the teleport and its windup is under half a second. | — | 48 | `ASS-Final-Hellfire-casts-in-place.ppf` |
| **Spells scale with INT** | Spell and form attack damage is multiplied by (INT + 500) / 500 instead of a flat bonus. | — | 168 | `ASS-Final-Spells-scale-with-INT.ppf` |

### Status and damage rules

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Petrification rework** | Petrification lasts 3 seconds with no directional escape; hits while petrified have a 30-frame cooldown. | — | 127 | `ASS-Final-Petrification-rework.ppf` |
| **Poison damage over time** | Poison deals 5 HP every 10 frames for its duration. | — | 135 | `ASS-Final-Poison-damage-over-time.ppf` |
| **Percent DEF** | DEF reduces damage by a percentage instead of subtracting, replacing the separate inverted-castle +200; Walk Armor's map DEF is capped at 15. Carries the current DEF of all of Alucard's equipment and every enemy, whichever patch set it. | Damage number colors: weak and resist | 1,197 | `ASS-Final-Percent-DEF.ppf` |

### Menus and presentation

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **RES/WEAK element line** | The main menu shows Alucard's resistances and weaknesses below GOLD. | — | 409 | `ASS-Final-RES-WEAK-element-line.ppf` |
| **Minimap setting and item shortcut button** | System gains Show minimap: Yes/No; Button Config gains a remappable Item Shortcut. | — | 388 | `ASS-Final-Minimap-setting-and-item-shortcut-button.ppf` |
| **Damage number colors: weak and resist** | Weakness hits flash the GUARD colors and resisted hits are grey (update to the existing Damage Number Colors hack). | — | 40 | `ASS-Final-Damage-number-colors-weak-and-resist.ppf` |
| **Title: Alternate Scarlet Symphony -Final-** | The title screen reads Alternate Scarlet Symphony -Final-. Always included in the full ASS -Final- patch. | — | 417 | `ASS-Final-Title-Alternate-Scarlet-Symphony-Final.ppf` |

### Richter Mode

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Richter Mode overhaul** | Playable Richter rebuilt: Rest levels and milestones, healing and collection growth, four-digit hearts, Heart Regen, relic abilities, Blade Dash, Roundhouse, Rising Hurricane, default run with L2 walk, new pause pages with a guide, all Alucard bosses, and many fixes. | Boss AI pack, Death returns to the last save room, Life Apple auto-revive, Stat-scaled buffs, Damage number colors: weak and resist, Percent DEF | 29,766 | `ASS-Final-Richter-Mode-overhaul.ppf` |
