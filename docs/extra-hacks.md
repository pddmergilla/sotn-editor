# Extra Hacks

[← Back to the README](../README.md)

The **Extra Hacks** tab lists the optional hacks of Alternate Scarlet Symphony (ASS) 2.0. Each checkbox shows whether that hack is in the loaded BIN: a vanilla US BIN starts with every box unchecked, and the ASS 2.0 BIN with every finished hack checked. Work-in-progress hacks carry a **WIP** badge and ship unchecked in ASS 2.0. Uncheck a hack to remove it, or check one to add it; **Build BIN** and **Export PPF3** include the change together with any map, stats or shop edits. The loaded BIN is never modified.

Recognition does not depend on the whole-image hash, so a later ASS build where you only changed stat values, item tables, text or maps is still accepted:

- **Which game is this?** About 1,700 regions of `DRA.BIN` and `BIN/RIC.BIN` code that vanilla and ASS share must match (a handful may differ), and about 700 places where ASS changed vanilla vote vanilla or ASS. Immediate operands (`addiu`, `ori`, `slti` …) are ignored, so retuned numbers in code don't count as a change. The Stats Editor's starting-stats code is skipped.
- **Is this hack present?** Every hack owns a list of byte runs with its *on* and *off* bytes. Balance numbers inside a hack (Dark Metamorphosis +25, the Agunea strike limit, detection ranges, Richter AI damage and weights, item MP costs) are marked tunable and may hold any value.
- An image that is neither vanilla US nor ASS (for example another mod) shows **This imported BIN doesn't support this feature.** and the whole tab is locked. A hack whose bytes were changed by something else is locked the same way, on its own.
- ASS 1.3.1 is recognized too: hacks it already had read as on, the 2.0 additions as off.

**Epic Richter AI** recognizes the updated code in ASS 2.0.06 and its earlier supported AI versions. Leaving it checked preserves the loaded version; removing and re-adding it installs the current AI. Its toggle preserves the separate No Flinch Richter hack, room edits and stats. Unknown code changes still lock the checkbox.

**Richter always saved** now sends lethal Richter damage through Shaft's orb death sequence, which creates the rescue actors and signals Richter's AI. The earlier patch only made Richter sit down. Both stock and Epic Richter AI pass instruction checks, but dialogue and Inverted Castle access still require a fresh-boot gameplay test, so the shipped ASS release keeps this WIP hack off. An earlier sitting-only patch remains recognized; remove it, rebuild and reopen the BIN, then add it again to install the fix. Incomplete or unknown code stays locked.

**Heart Regeneration** in ASS 2.0.07 restores `floor(total CON / 20) + 1` hearts every 60 gameplay frames, including equipment bonuses and capped at maximum hearts: CON 0–19 gives 1, 20–39 gives 2, and 40–59 gives 3. Earlier fixed-gain versions remain recognized. Leaving the checkbox checked preserves the loaded version; removing and re-adding installs the CON version. Each version guards its own code and allows only its reviewed tuning values to change. Existing HUD pause and regeneration-disable behavior is retained. Gameplay still needs emulator verification.

**Dark Metamorphosis stat buff** has editable ATK, DEF, INT, STR, CON and LCK bonuses. Its controls are disabled while the hack is unchecked. Existing images keep their original code until edited; configuring STR/CON/LCK installs a guarded helper that applies these bonuses before attack and defense calculations. Removing the hack also removes that helper. Other Dark Metamorphosis hacks remain independent.

The helper occupies DRA `0x42E98–0x42F13`, within the unused US `DebugEditColorChannel` routine. The Sunstone/Moonstone helper and bonus tables occupy `0x13E10–0x13E67`, in sound-bank padding after Richter-style Holy Water's helper (`0x1392C–0x13E03`) and before the next sound bank (`0x1407C`). These areas and the new hook matched all three reference images; a scan found no external direct jumps, pointers or nearby address-loading pairs into either allocation. Unknown helper bytes lock the affected controls. The generator's source is `tools/extra-hacks/stat_buffs.py`; run `build_catalog.py` to regenerate both catalogs. These checks do not establish emulator gameplay.

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
| Richter always saved (WIP) | Richter lethal-damage route and orb death check in BO6 | defeating Richter needs the Holy Glasses route again | adds the rescue trigger fix; fresh-boot dialogue and Inverted Castle verification are pending, so ASS 2.0 ships with it off |
| Instant Food | Meal Ticket and food entities in `WEAPON0/1`, DRA food roll | food is thrown and caught as in vanilla | adds it (also checks Quick Items, whose food routines it calls) |
| Eat Food on Pickup | DRA pickup and `AddToInventory` hooks | picked-up food goes to the inventory | adds it (also checks Quick Items) |
| Hint items have no attack | category check in the attack calculation | Hint items (category 2) get weapon attack again | not available (vanilla category 2 is Heaven Sword, Shakram, Runesword) |
| Stopwatch slows bosses | Stopwatch timer, boss Stopwatch checks, six enemy-table flag bytes | 5-tick freeze; those bosses ignore the Stopwatch | adds it |
| Richter-style Holy Water | jump at the Holy Water entity entry, plus a replacement entity in zero padding after the first DRA sound bank | the bottle drops and burns in one spot (4 flames) | adds it; blocked where that padding is not free |
| All Cloaks give Hearts | Blood Cloak check plus a divider in spare text padding | only the Blood Cloak gives hearts, one per point of damage | not available (the spare space holds description text in vanilla and 1.3.1) |
| Heart Regeneration | DRA frame hook and a cave in dead debug code; gain uses total CON including equipment | no heart regeneration | adds CON-based regeneration |
| Faerie Behavior | `SERVANT/TT_002.BIN` item checks, item use and on-hit hook, DRA helpers in dead debug code | the Faerie uses up Hammers, Uncurses, Antivenoms and potions again and gives no buffs | adds it |

A few hacks need another one only on vanilla (the food hacks call routines that Quick Items installs there; ASS keeps them in place anyway), and a hack that lives in spare space, such as All Cloaks give Hearts in freed item-text padding, locks itself in an image where that space holds other data.

Some bytes depend on two hacks at once. The L2 shortcut code (Quick Items) and the MP gate (MP Cost Items) have a hearts form that is written only while Healing items use Hearts is checked too. The item costs those hacks set are not written as raw bytes: checking or unchecking them updates the costs in the Stats Editor straight away (shown there as **Heart cost** while Healing items use Hearts is on, otherwise **MP cost**), and the build writes them from there, so a cost you then change in the Stats Editor is kept. While Subweapon use MP is checked, Alucard's subweapon costs read **MP cost**. Item descriptions such as "Costs 300 Hearts" are text and are not changed by these toggles.

Candle conversions are found by stage, position, entity type and slot, not by offset, so they still apply after the map editor re-packs a stage. A candle you moved or retyped is left alone and counted in the card. The Swap Power of Mist and Gas Cloud records are read at fixed offsets; if a later map edit re-packs RCAT or LIB, that one hack locks itself.

`extra-hacks-catalog.js` is generated by `tools/extra-hacks/build_catalog.py` from one research spec per hack in `tools/extra-hacks/specs/`. Each spec records the PPFs, decomp functions and before/after bytes it came from, and the builder checks every byte against the reference images. Rebuild it only when a hack is added or changed. None of the hacks were play-tested in an emulator by this tool.
