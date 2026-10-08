# Main menu element line

The exact-image patch adds one line at the bottom of Alucard's main menu:

`RES:Fire Thunder Poison WEAK:Ice`

It reads the game's current equipment and active-buff totals after the existing menu recalculation. RES groups resistance, immunity and absorption. A weakness and resistance to the same element cancel; immunity or absorption overrides weakness. Empty lists show `-`. Equipment stats and buffs are unchanged.

Full names appear when the entire line fits within 44 characters. Larger lists use three-letter names, then two-letter names if necessary; every element stays visible. The line uses the normal menu font at x=8/y=212, within the existing 360×200 background panel. Equipment submenus retain their original drawing.

| Element | Short | Compact |
|---|---|---|
| Fire | FIR | FI |
| Ice | ICE | IC |
| Thunder | THN | TH |
| Holy | HOL | HO |
| Dark | DRK | DK |
| Water | WTR | WA |
| Poison | PSN | PS |
| Curse | CUR | CU |
| Stone | STN | ST |
| Hit | HIT | HI |
| Cut | CUT | CT |

The helper occupies unused equipment icons 289–293 in DRA.BIN; its guarded reservation extends through icon 301. Current equipment uses icons no higher than 273. Do not assign icons 289–301 to equipment while this patch is installed. Existing weapon helpers and artwork remain untouched. The browser editor does not expose a toggle for this patch; its normal exports preserve the loaded bytes.

Prepare the guarded forward and reversal patches without writing the source BIN:

```text
node tests/menu-element-line.test.js
node tools/menu/build-element-line-patch.js outputs/menu-element-line-2026-10-08
```

`SOTN_ASS_BIN` can select another input image. Preparation rejects unknown menu code, occupied helper space and conflicting icons. The output README and verification.json record the exact source, result and patch hashes, source revisions, offsets, sectors and verification results.

Only after the Dev approves this specific prepared patch pair:

```text
node tools/menu/build-element-line-patch.js outputs/menu-element-line-2026-10-08 --apply
```

Application rejects a changed source image or patch, writes only the changed sectors, verifies the result and verifies the reversal without applying it to the original. No backup BIN is created or deleted.

The tests run the new game instructions, native text drawing, native equipment/resistance calculation and the full menu path. They cover every element subset, mixed effects, active and expired Resist buffs, hardcoded shield/relic immunity, menu refresh, font termination, width, saved registers, unchanged equipment submenus and unrelated bytes. PPF preparation also verifies both directions, both undo paths, sector checksums and unchanged source bytes.

Fresh-boot emulator verification remains pending: load a memory-card save, inspect the main menu, switch gear, use and expire Resist items, combine opposing effects, test crowded lists and open/close all submenus. An old savestate retains old code.
