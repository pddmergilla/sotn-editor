# Main menu element line

The exact-image patch adds one line at the bottom of Alucard's main menu:

`RES:FLA LIT PSN WEAK:ICE`

It reads the game's current equipment and active-buff totals after the existing menu recalculation. RES groups resistance, immunity and absorption. A weakness and resistance to the same element cancel; immunity or absorption overrides weakness. Empty lists show `-`. Equipment stats and buffs are unchanged.

Every element uses a three-letter abbreviation. When a list exceeds 44 characters, spaces between element codes are removed; codes stay three letters and every element remains visible. The line uses the normal menu font at x=8/y=216, four pixels lower than v1. The live mod draws GOLD at y=208, so its eight-pixel glyphs end before the new line starts. Both rows fit within the existing background panel. Equipment submenus retain their original drawing.

| Element | Abbreviation |
|---|---|
| Fire | FLA |
| Ice | ICE |
| Thunder | LIT |
| Holy | HOL |
| Dark | DAR |
| Water | WTR |
| Poison | PSN |
| Curse | CUR |
| Stone | STN |
| Hit | HIT |
| Cut | CUT |

The helper occupies unused equipment icons 289–293 in DRA.BIN; its guarded reservation extends through icon 301. Current equipment uses icons no higher than 273. Do not assign icons 289–301 to equipment while this patch is installed. Existing weapon helpers and artwork remain untouched. The browser editor does not expose a toggle for this patch; its normal exports preserve the loaded bytes.

Prepare the guarded forward and reversal patches without writing the source BIN:

```text
node tests/menu-element-line.test.js
node tools/menu/build-element-line-patch.js outputs/menu-element-line-fix-2026-10-09
```

`SOTN_ASS_BIN` can select another input image. Preparation accepts an empty reservation or an exactly matching reviewed menu helper, allowing an upgrade from v1. It rejects unknown menu code, changed helper bytes, occupied space and conflicting icons. `element-line-v1.json` preserves the reviewed v1 bytes for exact recognition. The output README and verification.json record the exact source, result and patch hashes, source revisions, offsets, sectors and verification results.

Only after the Dev approves this specific prepared patch pair:

```text
node tools/menu/build-element-line-patch.js outputs/menu-element-line-fix-2026-10-09 --apply
```

Application rejects a changed source image or patch, writes only the changed sectors, verifies the result and verifies the reversal without applying it to the original. An upgrade's reversal restores the exact prior menu line and preserves unrelated mods. No backup BIN is created or deleted.

The tests run the new game instructions, native text drawing, native equipment/resistance calculation and the full menu path. They cover every element subset, three-letter codes in crowded lists, mixed effects, active and expired Resist buffs, hardcoded shield/relic immunity, menu refresh, font termination, width, the live GOLD position, saved registers, unchanged equipment submenus, v1 upgrades and unrelated bytes. PPF preparation also verifies both directions, both undo paths, sector checksums and unchanged source bytes.

Fresh-boot emulator verification remains pending: load a memory-card save, inspect the main menu, switch gear, use and expire Resist items, combine opposing effects, test crowded lists and open/close all submenus. An old savestate retains old code.
