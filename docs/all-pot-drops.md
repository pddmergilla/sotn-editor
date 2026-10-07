# Pot drop audit

The 2026-10-07 audit reads the current ASS image, both horizontal and vertical room placement copies, and the actual breakable instructions in every stage and boss overlay. It resolves all 1,398 placed breakables; the vanilla image also passes with 1,607. File Select has no stage rooms. BO0 and the five test overlays contain no placed breakables.

Eight additional pots use item IDs where the game expects prize-table slots:

| Area | Room | Position | Intended item | New slot |
|---|---:|---|---|---:|
| Death Wing's Lair | 3 | 53, 65 | Mourneblade | 0 |
| Death Wing's Lair | 3 | 101, 65 | Heart Max-Up | 1 |
| Death Wing's Lair | 3 | 149, 65 | Lunch B | 2 |
| Death Wing's Lair | 6 | 161, 497 | Hunter sword | 3 |
| Death Wing's Lair | 6 | 161, 625 | Heart Max-Up | 4 |
| Death Wing's Lair | 6 | 161, 1137 | Heart Refresh | 5 |
| Forbidden Library | 4 | 140, 344 | Shop Card | 9 |
| Reverse Caverns | 27 | 76, 97 | Sushi | 16 |

RNO2's 12-entry prize table has six currently unused slots, so the repair preserves its existing pickups in slots 6–11. Its other literal `12` call arguments set enemy steps rather than create persistent pickups. RLIB's scripted shelf pickup uses slot 6 and stays intact. RNO4's earlier six-pot repair stays intact. The new slots have independent collected flags; artwork, positions and existing pickups are preserved. Older saves may already have these slots collected; the patch does not reset progress.

The editor now recognizes RNO2 urn/jug slots, RLIB urn/bust slots and fixed jug slot 3, and BO3 urn slots and fixed jug slot 41. Recognized table boundaries are RNO2 12, RLIB 18, RNO4 32 and BO3 38. Adjacent data guards stop an unknown boundary from being used. Invalid original pots remain readable, but editing or inserting an invalid slot is rejected. BO3's unused fixed jug branch exceeds its table, so adding that jug is rejected too.

Run `node tools/map/audit-pot-drops.js <report.json>` to audit a BIN, or `node tools/map/build-all-pot-drops-patch.js <output-directory>` to prepare guarded forward/reversal PPFs. `SOTN_BIN` selects the image and `SOTN_DECOMP` selects the source checkout. Preparation does not write the source or create a backup BIN. Apply an approved pair with the same builder, directory and `--apply`; it requires the recorded source hash and every original byte, repairs sector checksums, verifies the result and checks exact reversal.

The local pair is in `outputs/all-pot-drops-2026-10-07/`, with full hashes, offsets, affected sectors, source revision, before/after audit inventories and application status. After repair the audit reports zero unsafe pots and zero editor rule mismatches. The repair applies to the current image, which already includes the earlier six-pot repair.

`tests/all-pot-drops.test.js` executes the real break and pickup routines, checks independently collected flags with existing pickups already collected, validates both placement copies, export/reopen, portable saved edits/Undo, boundary guards and unchanged unrelated bytes. The historical six-pot test reconstructs its original input in memory when that repair is already present. Local browser checks exercise the warning, rejection, valid held-item change and Undo. These checks do not prove emulator gameplay or pickup artwork: fresh-boot the edited image and use a memory-card save, not an old savestate.
