# Stats Editor

[← Back to the README](../README.md)

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
| Enemies | name, HP, LVL, EXP, DEF, contact damage and element, weaknesses/resistances, both drops and drop rates, each attack's damage and element | `g_EnemyDefs`; recognized ASS Medusa sword elements in `BOSS/RBO3/RBO3.BIN` |
| Hand items | name, icon, icon palette, description, ATK, DEF, MP cost (shown as heart cost when the cost has bit `0x8000`, the Healing items use Hearts flag), critical rate, how many can be out at once (thrown weapons, bombs and food), stun frames, element, hit cooldown and whether hits steal souls (weapons and their specials), special effect; for weapons a moveset: basic attack, category, the ↓↘→ and ←→ specials with their damage, MP cost and element | `g_EquipDefs` rows 0-168, specials in rows 169-216 |
| Head gear, armor, cloaks, accessories | name, icon, icon palette, description, ATK, DEF, STR, CON, INT, LCK, weak/resist/immune/absorb, special effect | `g_AccessoryDefs` |
| Special effects | which item grants each coded effect | `CheckEquipmentItemCount` calls in DRA and every stage/boss overlay |
| Sunstone and Moonstone | separate STR, CON, INT and LCK bonuses per stone (0–99), on their accessory cards and under Special effects | guarded day/night hooks and a bonus table in unused sound-bank padding |

Click an item's icon to pick from all 320 item icons in the BIN.

**Medusa's body contact and sword slashes are separate hits.** In the recognized ASS sword code, **Sword slash** reads Cut + Curse and **Dashing sword slash** reads Cut + Fire, even when her body-contact element is Hit. Remove Curse from **Sword slash** to stop that slash from cursing; changing the body-contact element does not change her sword. Both slashes share damage row #367 but have independent elements. Vanilla uses the sword's ordinary table element. Unknown sword code locks its element rather than exporting an ineffective edit.

The **Medusa Table Elements** PPF disables only the forced sword-element write, preserving the mod's slash activation and movement. With that patch installed, both sword slashes use **Sword slash (#367)** from the enemy table; the separate dashing-element control disappears. Body contact still uses #366. The editor recognizes this exact disabled write and allows table edits.

**Stats up by day** (Sunstone, 6:00–18:00) and **Stats up by night** (Moonstone, 18:00–6:00) each expose four independent bonuses. Two equipped stones grant twice their configured bonuses. The effect can still be assigned to another accessory. Values initially read +5 per stat; exported images reopen with their edited values. Equipment bonuses still follow the game's existing cap and CON/INT scaling.

**Dark Metamorphosis stat buff**, in Extra Hacks, exposes ATK and DEF bonuses (0–999) and STR, CON, INT and LCK bonuses (0–99). Enable that hack to edit its controls. Existing ATK/INT/DEF values are read from the loaded image; STR/CON/LCK initially read zero. STR and CON apply before attack and defense are calculated; INT updates both its displayed and effective values. Bonuses refresh when the spell starts or ends and do not accumulate on repeated refreshes. Undo also covers these edits.

## Weapon movesets

- **Basic attack** copies another weapon's attack bytes: the weapon overlay (`weaponId`, the weapon's graphics and code), its palette, Alucard's animation, the attack behavior, the weapon entity and its variant, lock duration and chain limit. Stats, element, name and icon stay the weapon's own.
- A **special** is another `g_EquipDefs` row that the game attacks with when you enter ↓↘→ + attack (`specialMove`) or ←→ + attack (`unk17`). Icebrand's is row 181, Rapier's row 191. A special's damage, MP cost and element live in that row, so weapons sharing a row share them.
- **Make a private copy** duplicates a shared special into a spare row so it can have its own numbers. Spare rows are special rows no weapon points to; a vanilla US DRA has four (169, 199, 200, 201). The copy clears the two-weapon combo bits so it cannot take over shield or Heaven sword combos.
- **Copy another weapon's whole moveset** sets the basic attack and both specials to that weapon's, sharing its special rows.
- A special runs code from the overlay of the weapon you are holding, not from its own row. Pick a special made for a different overlay and the card warns you; match the basic attack to that special's weapon (for example Short sword with Rapier's basic attack and special) or it may look wrong or crash.

The Hunter Sword boomerang patch uses its own private special row (169), so its ↓↘→ + attack damage, MP cost, element, hit cooldown and other effect values can be edited without changing Shotel's row (176). Hunter Sword keeps its ordinary slash and uses the sword overlay for the throw.

The Stone Sword Medusa special patch keeps the sword's ordinary slash and artwork. Grounded ↓↘→ + attack casts the actual Medusa Shield spell through overlay 27, without needing a shield or Shield Rod. It shares row 211 with Medusa Shield (initially 170 damage and 70 MP on the inspected ASS image). The special card shows that shared shield; edits affect both, or **Make a private copy** separates Stone Sword's values. Installed combo rows remain available in the special picker. Fresh-boot gameplay remains unverified.

The Terminus Est Crissaegrim special patch keeps its ordinary slash and artwork. **←→ + attack** uses Crissaegrim's actual slash burst, with its own row 186 (initially 199 damage and 15 MP on the inspected ASS image). Edit **Special damage**, **Special MP cost**, **Special element** and **Special hit cooldown** on Terminus Est's card, or the full row under **Weapon specials**; these values do not change the normal sword or Crissaegrim. The patch preserves the game's existing ←→ behavior, including no extra MP check. Fresh-boot gameplay remains unverified.

## How values are found and written

- Tables are located through DRA's `g_api` pointer header (enemies, equipment, accessories, relics) and the `config_us.h` table order (subweapons, menu strings, spells). Richter's table is `RIC.BIN` offset `0x18688`.
- Starting stats are immediates inside `InitStatsAndGear`, found at the header's function pointer. The game shares one register between several stats (for example Richter's STR, CON, INT and LCK are one instruction, and luck mode's CON and INT are hard-wired to zero). To edit them separately the editor rewrites that short run of `ori`/`sw` instructions in place. It refuses when a branch lands inside the run, and restores any register that later code still reads. Blocks it rewrote are recognized again when the edited BIN is reopened.
- Starting gear is one `ori`/`sw` pair per `g_Status.equipment` slot. Death's scene still takes the vanilla Alucard items by ID, so gear you swap in is not taken. Bonus items are the `a0` (item) and `a1` (kind: 0 hand, 1 head, 2 armor, 3 cloak, 4 accessory) of each `AddToInventory` call; picking another kind rewrites both. ASS 2.0 sets the three prologue rewards to ID `0x17F`, past the hand-item list, which the editor shows as unlisted.
- Hit cooldown is how many frames an enemy stays unhittable by that attack after a hit: `nFramesInvincibility` (+0x07) in subweapon, Richter skill and crash rows, and the equipment row's byte +0x1A for weapons, thrown items and specials. Related hits (Holy Water flames, crash beams) have their own rows. An enemy keeps a separate cooldown for each attacking entity (subweapon entities take attacker IDs 7–10 in turn), so a vanilla Holy Water bottle (4 flames) can hit about 16 times, and with Richter-style Holy Water each bottle leaves about 20 traveling flames. The Holy Water card states which applies, following the Extra Hacks selection.
- Soul steal is the hit effect (row `+0x2A`, low 7 bits): 2 drops a soul orb on every hit (vanilla Mourneblade); 6 drops one only from enemies whose hitbox state has bit `0x20` (what ASS uses). Bit `0x80` picks the stab hit sound and is kept.
- Small and Big Heart amounts are each stage's `c_HeartPrizes` pair (signed bytes, so at most 127), found from the `lb` in `CollectHeart`. Soul Steal and blood-drop heals are the `healAmount` constants in each stage. Potion and High Potion use `GetStatusAilmentTimer(4/5, amount)` in vanilla (+50% with the "Longer status timers" accessory); ASS replaces that call with a helper at DRA `0x800E2DE0` holding 300 and 800, which the editor edits instead. The Elixir slot loads max HP in vanilla and a constant in ASS (2500 for X-Potion); entering 0 restores the max-HP load. The potion values also appear on the Potion, High Potion and Elixir item cards.
- The HP Max Up and Heart Max Up amounts are the `a0` immediates of `g_api.func_800FE044(amount, 0x8000)` and `(amount, 0x4000)` in each stage's `CollectLifeVessel` and `CollectHeartVessel` (5 and 5 in vanilla). Each stage has its own copy, so the editor finds all 50 retail ones and rewrites them together. A stage whose value differs from the most common one keeps its value and is listed under the card. `MAD` and `TE1`–`TE5` use the beta `g_api` layout and are not touched. Richter gains twice the HP amount; his Heart Max Up only refills 30 hearts and is not exposed.
- Agunea's follow-up lightning cost is the hard-coded `5` in `EntitySubwpnAgunea` (DRA `0x89000`); the compiler also stored the one-Heart-Broach value (`5 / 2`), which is updated to half the new cost. Richter's copy is at RIC `0x30AD4`/`0x30AE8`. The `heartCost` field of DRA subweapon row 10 is not read by the game.
- A special effect is every `CheckEquipmentItemCount(item, slot)` call that the code checks for it, for example Dragon Helm's "halves enemy DEF". The editor proves the item ID is a constant on every code path to each call, then rewrites all of those loads together. Moving an effect gives it to the new item and removes it from the old one. "No item" disables it. Axe Lord armor is read-only because other code compares its ID directly. One Bloodstone check in `BOSS/BO6` could not be verified and keeps its item.
- Names and descriptions are rewritten in place. A field accepts only as many bytes as the original string plus its alignment padding, and the counter shows the limit. Names use the game font; bytes with no editable glyph appear as `⟨HH⟩` and must be kept. Text shared by several entries (for example the enemy and familiar "Bat") shows **shared** and changes everywhere it is used.
- Familiar damage is the base value; the game multiplies it by `level × 4 ÷ 95 + 1`. Enemy drop rates are compared with a random number out of 256 before LCK and Ring of Arcana adjustments.

## Limits

- Built for the US PS1 layout. Tables or code that do not match are shown as not found rather than guessed.
- Strings cannot grow past their original space, and no new special effects or item slots can be added. New weapon specials are limited to the spare rows, and a prize table cannot grow past the slots its stage's rooms already use.
- Byte-level round trips and PPF3 reproduction were verified against a vanilla US image and the Alternate Scarlet Symphony 2.0 image; the edits were not playtested in an emulator. Test gameplay changes before distributing a BIN or PPF.
