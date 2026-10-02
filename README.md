# SOTN Editor v6.1

Create your own *Castlevania: Symphony of the Night* ROM hack in a standalone browser editor.

**[Open SOTN Editor](https://pddmergilla.github.io/sotn-editor/)**

The editor changes stage maps, collisions, entity placements, game stats, the Library shop, and selected gameplay hacks. It reads a user-supplied US PlayStation disc image entirely in the browser, includes no game assets, never uploads the image, and never overwrites the source file.

## Main features

- Paint foreground and background tiles using the stage's real artwork.
- Edit collision, room entities, item drops, relic orbs, and object graphics banks.
- Change player, enemy, item, spell, familiar, pickup, and Richter statistics.
- Edit Library shop items and prices.
- Toggle 30 optional gameplay hacks for supported vanilla and Alternate Scarlet Symphony images.
- Build a new BIN or export a PPF3 patch containing only your changes.
- Undo map, entity, stat, shop, and hack edits in the browser.
- Download Alternate Scarlet Symphony 2.0 as a PPF3, or build it from your vanilla US BIN in the browser.

## Compatibility and safety

- Designed for the US PS1 release and Alternate Scarlet Symphony 1.3.1/2.0 layouts.
- Accepts 2048-byte sector ISO and 2352-byte sector BIN images.
- Unsupported or changed data is rejected instead of guessed.
- Raw-sector outputs receive updated EDC/ECC data.
- Generated images and patches should be tested in an emulator before distribution.

## Use the editor

Open the [hosted editor](https://pddmergilla.github.io/sotn-editor/), select **Open SOTN BIN**, and choose your disc image. Everything runs locally in your browser.

To run the project locally instead, start the included server and open its address in desktop Chrome or Edge:

Run the included local web server in this folder, then open its address in desktop Chrome or Edge:

```text
node serve.js
http://127.0.0.1:8765
```

Select **Open SOTN BIN**, choose a 2048-byte sector ISO or 2352-byte sector BIN, then choose a castle area and room. The editor reads the selected stage overlay and graphics directly from `ST/<AREA>/` in the image. No decomp asset folder or separate `F_<AREA>.BIN` is needed. An already modded BIN can be the input; the PPF will contain only differences made in this editor relative to that BIN.

Paint foreground or background tile IDs with the real stage art. Entities mode lists the current room's placements by area header name, highlights a selected marker, and edits its type and room-local X/Y. Named types come from the matching `EntityID` enum in [Xeeynamo/sotn-decomp](https://github.com/Xeeynamo/sotn-decomp).

In Entities mode, **Graphics and templates from room** selects another room in the same stage. The current room then uses that room's object graphics-bank ID, and the Add and Change Type menus show templates found in the selected room. **Current graphics** restores the current room's original bank and v5's same-bank template list. This changes object graphics, not the map's tile art. Changing banks may make existing objects incompatible; the editor warns when an entity ID is absent from all original rooms using the chosen bank. Test the result in-game.

A template supplies entity ID, upper flags, and parameters. A new instance gets an unused stage entity slot and a separate persistence index when the template uses one. The existing entity's position and slot are retained on Change Type. `E_PRIZE_DROP` params select a direct `ITEMDROP` ID; `E_EQUIP_ITEM_DROP` params select equipment using IDs beginning at `0x80`; `E_PERSISTENT_ITEM_DROP` params are a stage-local `PrizeDrops[]` index.

**Holds item** (Persistent Item Drop) chooses what the pickup gives. It edits the stage's `PrizeDrops[]` entry for the pickup's slot (its Params), found from the code of `EntityPersistentItemDrop` in each stage overlay. The list is grouped: **Progression** (Life Max-Up, Heart Max-Up, Holy glasses, Spike Breaker, Gold Ring, Silver Ring), hearts and gold, subweapons, hand items, head gear, armor, cloaks, and accessories, using the loaded BIN's item names. Each slot has its own "collected" castle flag, so placements that share a slot hold the same item and disappear together; the panel says when that happens. Breakable walls and scripted objects can also spawn a slot. Relics are not persistent drops: a **Relic Orb** has its own **Holds relic** list (Params low 15 bits). Place each relic once; an orb for a relic you already own disappears. The entity list shows what every pickup and orb holds. Both apply with **Apply Changes** and can be undone.

Entity coordinates are local to the room. Drag a marker or edit its local X/Y to move it. Add and Duplicate are available only when the fixed stage layout-data span can hold the changed X/Y banks and a free entity slot exists. The editor reuses byte-identical banks and updates their pointers; it does not grow the stage file. Asset-folder layouts do not support insertion because their BIN capacity is unknown.

**Copy Tile** selects the visible foreground or background tile from the next map click, switches the paint layer to match, and turns itself off so painting can resume.

In Collision mode, choose a layer and use **Copy Collision** to sample a tile's collision value from the next map click. It then turns off, leaving that value ready to paint. Esc cancels either copy mode. Right-drag the map view to pan in any mode.

Use the up/down buttons beside zoom to move through tall rooms. Ctrl+C arms Copy Tile outside text fields; Esc cancels it.

Use the toolbar Undo button or Ctrl+Z to reverse edits. A tile brush stroke is one undo step. Undo history is cleared when opening another BIN or saving asset-folder edits.

**Build BIN** writes a new image with the edits. **Export PPF3** writes a PPF 3.0 patch against the loaded image. The source file is never overwritten. For raw 2352-byte sectors, changed sectors receive updated Mode 1 or Mode 2 Form 1 EDC/ECC before either output is made.

## Alternate Scarlet Symphony 2.0 tab

The **Alternate Scarlet Symphony 2.0** tab presents the mod: its features, boss and stat numbers, every gameplay hack, screenshots, and downloads.

- **Download the PPF.** `ass2/Alternate-Scarlet-Symphony-2.0.ppf` is a PPF3 from the US Track 1 BIN to ASS 2.0. It has a block check and undo data, so PPF3 patchers can verify the input and undo it. The tab lists the input, output and patch SHA-256 hashes.
- **Build it here.** Open the vanilla US Track 1 with **Open SOTN BIN**. The tab compares every patched region with the patch's undo bytes, so it says whether the BIN is untouched vanilla, already ASS 2.0, or something else. **Build** streams the patched image to the file you choose in 8 MB windows. It saves only when the output CRC32 matches the release. Your BIN is only read, and unsaved editor changes are not included. A `.cue` that pairs the new Track 1 with the vanilla Track 2 can be downloaded.
- **Release data.** The numbers on the page come from `ass2/ass2-release.js`, and the hack list comes from the Extra Hacks catalog. After changing the ASS 2.0 BIN, rebuild the PPF and the data with:

  ```text
  node tools/ass2/build-release.js [--vanilla PATH] [--ass PATH]
  ```

  The builder checks that the PPF turns vanilla into the ASS BIN byte for byte. Most of the patch is the Form 2 (XA/STR) sector EDC, which differs in about 173,000 sectors. Keeping it makes the result an exact copy of ASS 2.0.
- **Screenshots.** Put images in `ass2/screenshots/` and list them in `ass2/screenshots/screenshots.json` as `[{"file": "castle.png", "caption": "..."}]`. The gallery stays hidden while the list is empty.
- The build needs the page served over http (`node serve.js` or the hosted editor). From a `file://` page only the download link works.

## Extra Hacks (v6.1)

The **Extra Hacks** tab lists the optional hacks of Alternate Scarlet Symphony (ASS) 2.0. Each checkbox shows whether that hack is in the loaded BIN: a vanilla US BIN starts with every box unchecked, the current ASS 2.0 BIN with every box checked. Uncheck a hack to remove it, or check one to add it; **Build BIN** and **Export PPF3** include the change together with any map, stats or shop edits. The loaded BIN is never modified.

Recognition does not depend on the whole-image hash, so a later ASS build where you only changed stat values, item tables, text or maps is still accepted:

- **Which game is this?** About 1,700 regions of `DRA.BIN` and `BIN/RIC.BIN` code that vanilla and ASS share must match (a handful may differ), and about 700 places where ASS changed vanilla vote vanilla or ASS. Immediate operands (`addiu`, `ori`, `slti` …) are ignored, so retuned numbers in code don't count as a change. The Stats Editor's starting-stats code is skipped.
- **Is this hack present?** Every hack owns a list of byte runs with its *on* and *off* bytes. Balance numbers inside a hack (Dark Metamorphosis +25, the Agunea strike limit, detection ranges, Richter AI damage and weights, item MP costs) are marked tunable and may hold any value.
- An image that is neither vanilla US nor ASS (for example another mod) shows **This imported BIN doesn't support this feature.** and the whole tab is locked. A hack whose bytes were changed by something else is locked the same way, on its own.
- ASS 1.3.1 is recognized too: hacks it already had read as on, the 2.0 additions as off.

Hacks with a dependency move together: **Quick Items** and **Healing items use Hearts** need **MP Cost Items**, so checking either checks MP Cost Items, and unchecking MP Cost Items unchecks both. Dark Metamorphosis stat buff, SpeedUp and Agunea Limit show the values read from the loaded BIN (for example +25 ATK, +25 INT, +25 DEF, capped at 999). A hack edit that collides with a map, stats or shop edit on the same byte stops the build with a message naming the file and offset.

| Hack | Where | Unchecked on an ASS BIN means | On vanilla |
|---|---|---|---|
| MiniMap | DRA minimap routine + MainGame hook (ported from Reawakened) | no minimap | adds it |
| Fast Warp | WRP / RWRP fade and platform speeds | vanilla warp speed | adds it |
| Swap Power of Mist and Gas Cloud | relic-orb params in RCAT and LIB | the two relics trade pedestals back | swaps the Castle Keep and Floating Catacombs relics |
| Aggressive Enemy | 94 detection constants in 23 stage overlays | vanilla ranges | adds it |
| No Flinch Karasuman / Slogra / Dopplegangers / Richter | hit-reaction calls in NZ1, NZ0, BO4 + RBO5, BO6 | vanilla flinching (Slogra also gets Gaibon's carry combo back) | adds it |
| No Flinch and Faster Succubus | DRE flinch check, animation and timer data | 1.3.1 Succubus | adds it |
| Epic Richter AI | BO6 `RichterThinking` and helpers | vanilla AI (Richter-Save, room and stats stay) | adds it, with knife/vibhuti/rebound damage from Richter's Cross |
| Quick Items (L2) | L2 handler, thrown-food entity | no L2 shortcuts | adds it (with MP Cost Items) |
| MP Cost Items | MP gate + item-table consumable flags and MP costs | potions, Meal Ticket, Library Card used up again, no MP | adds it, and makes ASS's reusable throwing items reusable |
| Healing items use Hearts instead of MP | `HasEnoughMp` (a cost with bit `0x8000` is charged to hearts), the cost flag on Potion, High Potion, X-Potion and Meal Ticket, and the L2 shortcut check/subtract | the four items cost 30 / 70 / 200 / 50 MP; the L2 shortcuts spend MP | adds it, with ASS's 300 / 700 / 1500 / 500 heart costs (lower them for vanilla) |
| Subweapon use MP instead of Hearts | two pointers: the subweapon cost check and Agunea's follow-up strike | subweapons and Agunea spend hearts | adds it; Richter still uses hearts |
| Agunea Limit | three instructions in `EntitySubwpnAgunea` | unlimited strikes while hearts last | adds it |
| No Jump Wolf Transformation | one store in `WolfStepS_8` | the transformation hop returns | adds it |
| Subweapon Attached to Weapon | DRA mapping and menu-icon code, 72-entry table, SLUS/RIC input code, 34 candles (125 on vanilla) | 1.3.1: DOWN+TRIANGLE cycling and subweapon candles; Richter keeps the L1/R1 he had in 1.3.1 | adds it, including Richter's L1/R1 |
| Dark Metamorphosis stat buff / SpeedUp | unused `DebugCaptureVideo` body + hooks | no bonus / normal speed | adds it |
| Sky Walker | Leap Stone check and dive-kick input | single double jump, Down+Cross dive kick | adds it (relic text unchanged) |
| Damage Number Colors | DRA hook and caves in blank icon space, `F_GAME` palettes, two hooks and a colour table in every stage (ported from Reawakened) | vanilla damage numbers | adds it |
| Richter always saved | one jump in BO6 | defeating Richter needs the Holy Glasses route again | adds it |
| Instant Food | Meal Ticket and food entities in `WEAPON0/1`, DRA food roll | food is thrown and caught as in vanilla | adds it (also checks Quick Items, whose food routines it calls) |
| Eat Food on Pickup | DRA pickup and `AddToInventory` hooks | picked-up food goes to the inventory | adds it (also checks Quick Items) |
| Hint items have no attack | category check in the attack calculation | Hint items (category 2) get weapon attack again | not available (vanilla category 2 is Heaven Sword, Shakram, Runesword) |
| Stopwatch slows bosses | Stopwatch timer, boss Stopwatch checks, six enemy-table flag bytes | 5-tick freeze; those bosses ignore the Stopwatch | adds it |
| Richter-style Holy Water | jump at the Holy Water entity entry, plus a replacement entity in zero padding after the first DRA sound bank | the bottle drops and burns in one spot (4 flames) | adds it; blocked where that padding is not free |
| All Cloaks give Hearts | Blood Cloak check plus a divider in spare text padding | only the Blood Cloak gives hearts, one per point of damage | not available (the spare space holds description text in vanilla and 1.3.1) |
| Heart Regeneration | DRA frame hook and a cave in dead debug code | no heart regeneration | adds it |
| Faerie Behavior | `SERVANT/TT_002.BIN` item checks, item use and on-hit hook, DRA helpers in dead debug code | the Faerie uses up Hammers, Uncurses, Antivenoms and potions again and gives no buffs | adds it |

A few hacks need another one only on vanilla (the food hacks call routines that Quick Items installs there; ASS keeps them in place anyway), and a hack that lives in spare space, such as All Cloaks give Hearts in freed item-text padding, locks itself in an image where that space holds other data.

Some bytes depend on two hacks at once. The L2 shortcut code (Quick Items) and the MP gate (MP Cost Items) have a hearts form that is written only while Healing items use Hearts is checked too. The item costs those hacks set are not written as raw bytes: checking or unchecking them updates the costs in the Stats Editor straight away (shown there as **Heart cost** while Healing items use Hearts is on, otherwise **MP cost**), and the build writes them from there, so a cost you then change in the Stats Editor is kept. While Subweapon use MP is checked, Alucard's subweapon costs read **MP cost**. Item descriptions such as "Costs 300 Hearts" are text and are not changed by these toggles.

Candle conversions are found by stage, position, entity type and slot, not by offset, so they still apply after the map editor re-packs a stage. A candle you moved or retyped is left alone and counted in the card. The Swap Power of Mist and Gas Cloud records are read at fixed offsets; if a later map edit re-packs RCAT or LIB, that one hack locks itself.

`extra-hacks-catalog.js` is generated by `tools/extra-hacks/build_catalog.py` from one research spec per hack in `tools/extra-hacks/specs/`. Each spec records the PPFs, decomp functions and before/after bytes it came from, and the builder checks every byte against the reference images. Rebuild it only when a hack is added or changed. None of the hacks were play-tested in an emulator by this tool.

The Asset folder tools menu keeps the v2 decomp asset workflow available separately.

## Stats Editor (v6.0)

The **Stats Editor** tab reads the loaded BIN's own values, so an already modded image shows its numbers, not vanilla ones. Every edit is checked against the byte range it came from before export, and the **Build BIN** and **Export PPF3** buttons include stat edits together with map edits. The toolbar Undo button and Ctrl+Z also undo stat edits. Changed fields are outlined; hover one to see its original value.

| Section | Editable values | Where they live |
|---|---|---|
| Alucard starting stats | Max HP (and the no-hit prologue variant), Max MP, hearts, max hearts, STR, CON, INT, LCK | `InitStatsAndGear` code in `DRA.BIN` |
| Pickups | Small Heart and Big Heart hearts, HP Max Up and Heart Max Up amounts | `c_HeartPrizes`, `CollectLifeVessel` / `CollectHeartVessel` in every stage overlay |
| Healing | HP healed by Potion, High Potion and Elixir (X-Potion in ASS; 0 = all HP), Soul Steal orbs and Dark Metamorphosis blood drops | DRA item-use entity (or the ASS potion helper), `EntitySoulStealOrb` / blood droplets in every stage overlay |
| Alucard starting gear | the seven equipment slots (two hands, head, armor, cloak, two accessories) | `InitStatsAndGear` |
| Prologue bonus items | the item given when Maria rescued Richter, when he ran out of hearts, when he kept more than 40 hearts, and for the AXEARMOR name after a clear; any hand or body item | `AddToInventory` calls in `InitStatsAndGear` |
| Weapon specials | every row past the hand items (weapon specials, two-weapon combos, spare rows): damage, MP cost, element, soul steal, stun, critical rate, hit type, invincibility frames, chain limit, lock, raw attack bytes; with the weapons that use each row | `g_EquipDefs` rows 169-216 |
| Transformations | Mist MP drain without Power of Mist | `HandleTransformationMP` |
| Luck mode | HP, Max HP, MP, Max MP, hearts, max hearts, STR, CON, INT, LCK, accessory 2 | same function, `X-X!V''Q` branch |
| Spells | MP cost, damage, element | `g_SpellDefs` |
| Alucard subweapons | heart (or MP) cost, damage, how many can be out at once, hit cooldown, element, related hits (Holy Water flames, Cross beam, Agunea bolt), Agunea follow-up lightning cost | `g_SubwpnDefs`, `EntitySubwpnAgunea` |
| Richter starting stats | HP, Max HP, MP, Max MP, hearts, max hearts, STR, CON, INT, LCK | `InitStatsAndGear` |
| Richter attacks and skills | Whip, Slide, Slide kick, High-jump attack, Blade Dash, Hydro Storm: damage, hit cooldown, element | `BIN/RIC.BIN` `subweapons_def` |
| Richter subweapons and crashes | heart cost, damage, how many can be out at once, hit cooldown, element, crash heart cost, crash damage rows, Agunea follow-up cost | `subweapons_def`, `RicEntitySubwpnAgunea` |
| Familiars | name, base damage and element of each attack | menu strings, `g_SpellDefs` rows 7 and 15-27 |
| Enemies | name, HP, LVL, EXP, DEF, contact damage and element, weaknesses/resistances, both drops and drop rates, each attack's damage and element | `g_EnemyDefs` |
| Hand items | name, icon, icon palette, description, ATK, DEF, MP cost (shown as heart cost when the cost has bit `0x8000`, the Healing items use Hearts flag), critical rate, how many can be out at once (thrown weapons, bombs and food), stun frames, element, hit cooldown and whether hits steal souls (weapons and their specials), special effect; for weapons a moveset: basic attack, category, the ↓↘→ and ←→ specials with their damage, MP cost and element | `g_EquipDefs` rows 0-168, specials in rows 169-216 |
| Head gear, armor, cloaks, accessories | name, icon, icon palette, description, ATK, DEF, STR, CON, INT, LCK, weak/resist/immune/absorb, special effect | `g_AccessoryDefs` |
| Special effects | which item grants each coded effect | `CheckEquipmentItemCount` calls in DRA and every stage/boss overlay |

Click an item's icon to pick from all 320 item icons in the BIN.

### Weapon movesets

- **Basic attack** copies another weapon's attack bytes: the weapon overlay (`weaponId`, the weapon's graphics and code), its palette, Alucard's animation, the attack behavior, the weapon entity and its variant, lock duration and chain limit. Stats, element, name and icon stay the weapon's own.
- A **special** is another `g_EquipDefs` row that the game attacks with when you enter ↓↘→ + attack (`specialMove`) or ←→ + attack (`unk17`). Icebrand's is row 181, Rapier's row 191. A special's damage, MP cost and element live in that row, so weapons sharing a row share them.
- **Make a private copy** duplicates a shared special into a spare row so it can have its own numbers. Spare rows are special rows no weapon points to; a vanilla US DRA has four (169, 199, 200, 201). The copy clears the two-weapon combo bits so it cannot take over shield or Heaven sword combos.
- **Copy another weapon's whole moveset** sets the basic attack and both specials to that weapon's, sharing its special rows.
- A special runs code from the overlay of the weapon you are holding, not from its own row. Pick a special made for a different overlay and the card warns you; match the basic attack to that special's weapon (for example Short sword with Rapier's basic attack and special) or it may look wrong or crash.

### How values are found and written

- Tables are located through DRA's `g_api` pointer header (enemies, equipment, accessories, relics) and the `config_us.h` table order (subweapons, menu strings, spells). Richter's table is `RIC.BIN` offset `0x18688`.
- Starting stats are immediates inside `InitStatsAndGear`, found at the header's function pointer. The game shares one register between several stats (for example Richter's STR, CON, INT and LCK are one instruction, and luck mode's CON and INT are hard-wired to zero). To edit them separately the editor rewrites that short run of `ori`/`sw` instructions in place. It refuses when a branch lands inside the run, and restores any register that later code still reads. Blocks it rewrote are recognized again when the edited BIN is reopened.
- Starting gear is one `ori`/`sw` pair per `g_Status.equipment` slot. Death's scene still takes the vanilla Alucard items by ID, so gear you swap in is not taken. Bonus items are the `a0` (item) and `a1` (kind: 0 hand, 1 head, 2 armor, 3 cloak, 4 accessory) of each `AddToInventory` call; picking another kind rewrites both. ASS 2.0 sets the three prologue rewards to ID `0x17F`, past the hand-item list, which the editor shows as unlisted.
- Hit cooldown is how many frames an enemy stays unhittable by that attack after a hit: `nFramesInvincibility` (+0x07) in subweapon, Richter skill and crash rows, and the equipment row's byte +0x1A for weapons, thrown items and specials. Related hits (Holy Water flames, crash beams) have their own rows. An enemy keeps a separate cooldown for each attacking entity (subweapon entities take attacker IDs 7–10 in turn), so a vanilla Holy Water bottle (4 flames) can hit about 16 times, and with Richter-style Holy Water each bottle leaves about 20 traveling flames. The Holy Water card states which applies, following the Extra Hacks selection.
- Soul steal is the hit effect (row `+0x2A`, low 7 bits): 2 drops a soul orb on every hit (vanilla Mourneblade); 6 drops one only from enemies whose hitbox state has bit `0x20` (what ASS uses). Bit `0x80` picks the stab hit sound and is kept.
- Small and Big Heart amounts are each stage's `c_HeartPrizes` pair (signed bytes, so at most 127), found from the `lb` in `CollectHeart`. Soul Steal and blood-drop heals are the `healAmount` constants in each stage. Potion and High Potion use `GetStatusAilmentTimer(4/5, amount)` in vanilla (+50% with the "Longer status timers" accessory); ASS replaces that call with a helper at DRA `0x800E2DE0` holding 300 and 800, which the editor edits instead. The Elixir slot loads max HP in vanilla and a constant in ASS (2500 for X-Potion); entering 0 restores the max-HP load. The potion values also appear on the Potion, High Potion and Elixir item cards.
- The HP Max Up and Heart Max Up amounts are the `a0` immediates of `g_api.func_800FE044(amount, 0x8000)` and `(amount, 0x4000)` in each stage's `CollectLifeVessel` and `CollectHeartVessel` (vanilla 5 and 5; current ASS 50 and 5). Each stage has its own copy, so the editor finds all 50 retail ones and rewrites them together. A stage whose value differs from the most common one keeps its value and is listed under the card. `MAD` and `TE1`–`TE5` use the beta `g_api` layout and are not touched. Richter gains twice the HP amount; his Heart Max Up only refills 30 hearts and is not exposed.
- Agunea's follow-up lightning cost is the hard-coded `5` in `EntitySubwpnAgunea` (DRA `0x89000`); the compiler also stored the one-Heart-Broach value (`5 / 2`), which is updated to half the new cost. Richter's copy is at RIC `0x30AD4`/`0x30AE8`. The `heartCost` field of DRA subweapon row 10 is not read by the game.
- A special effect is every `CheckEquipmentItemCount(item, slot)` call that the code checks for it, for example Dragon Helm's "halves enemy DEF". The editor proves the item ID is a constant on every code path to each call, then rewrites all of those loads together. Moving an effect gives it to the new item and removes it from the old one. "No item" disables it. Axe Lord armor is read-only because other code compares its ID directly. One Bloodstone check in `BOSS/BO6` could not be verified and keeps its item.
- Names and descriptions are rewritten in place. A field accepts only as many bytes as the original string plus its alignment padding, and the counter shows the limit. Names use the game font; bytes with no editable glyph appear as `⟨HH⟩` and must be kept. Text shared by several entries (for example the enemy and familiar "Bat") shows **shared** and changes everywhere it is used.
- Familiar damage is the base value; the game multiplies it by `level × 4 ÷ 95 + 1`. Enemy drop rates are compared with a random number out of 256 before LCK and Ring of Arcana adjustments.

### Stats Editor limits

- Built for the US PS1 layout. Tables or code that do not match are shown as not found rather than guessed.
- Strings cannot grow past their original space, and no new special effects or item slots can be added. New weapon specials are limited to the spare rows, and a prize table cannot grow past the slots its stage's rooms already use.
- Byte-level round trips and PPF3 reproduction were verified against a vanilla US image and the Alternate Scarlet Symphony 2.0 image; the edits were not playtested in an emulator. Test gameplay changes before distributing a BIN or PPF.

## Map Editor scope and limits

- Stage layout parsing follows the PS1 stage header, rooms, layers, tile definitions, and 53-entry entity layout table documented by [Xeeynamo/sotn-decomp](https://github.com/Xeeynamo/sotn-decomp/tree/master/tools/sotn-assets/assets).
- Named entity types are taken from the matching local stage header; IDs without a matching name are never labeled as enemies.
- The source-room selector offers only entities originally placed in that source room. It does not import enemies from other stages, and matching a graphics-bank ID does not guarantee that every scripted condition or sprite will behave identically in another room.
- v5.1 changes the stage room's object graphics-bank ID; it does not copy a graphics bank or tile art into the image. The selected bank must already exist in the loaded stage.
- Added entities use stage slots below 96 to avoid the common dynamic entity pools. The editor rejects insertion when no slot or fixed layout-data space remains.
- Room resizing and stage-file growth are not supported.
- Special stage effects and animated or runtime changed tiles are not simulated.
- The parser was checked against a US disc image and a modded variant; in-memory tile, collision, entity, and PPF3 edits round tripped on both. Verify a saved BIN and PPF in your emulator before distributing a patch.

## Tests

```text
node tests/core.test.js
node tests/disc-stage.test.js
node tests/copy-tile.test.js
node tests/entity-editor.test.js
node tests/entity-templates.test.js
node tests/entity-repack.test.js
node tests/room-gfx.test.js
node tests/stats-core.test.js
node tests/prize-drops.test.js
node tests/stats-bin.test.js
node tests/extra-hacks-ui.test.js
node tests/ass2.test.js
```

`ass2.test.js` checks the PPF parser and windowed builder on a synthetic image, that the shipped PPF matches the release data, and, when the images are present, that vanilla builds to the exact ASS 2.0 BIN.

`extra-hacks-ui.test.js` runs its unit checks always. With the reference images present it also checks:

- detection on vanilla, ASS 2.0 and ASS 1.3.1;
- add and remove round trips that must restore the files byte for byte;
- removing each hack on its own, and Healing items use Hearts off then on (costs and the L2 shortcuts switch to MP and back; adding it in a second build gives the same bytes as adding everything at once);
- a simulated later ASS build with retuned values and edited data;
- that another mod (the Reawakened PPF) is rejected.

Set `SOTN_VANILLA_BIN`, `SOTN_ASS_BIN`, `SOTN_ASS_OLD_BIN` and `SOTN_OTHER_PPF` to choose the files. `stats-bin.test.js` needs real disc images and skips without them; `prize-drops.test.js` runs its synthetic checks either way. Set `SOTN_BIN` to a US BIN and `SOTN_VANILLA_BIN` to an unmodified US Track 1 to choose which images it checks.
