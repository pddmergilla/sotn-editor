# Reverse Caverns pot drops

RNO4 urns and jugs both spawn `E_PERSISTENT_ITEM_DROP` using `Params & 0x1FF`. The editor previously omitted RNO4 from its breakable rules, so it showed an inventory item for the same number instead of the prize-table entry. A pot labeled Ham and eggs had `0x70B0`: the game read slot 176 outside the actual table. Room 7's purported upgrades used slots 12 and 23, sharing collected flags with other placements and holding Life Max-Up and Hell Blade respectively.

The recognized vanilla and current ASS overlay has 32 prize entries at `0x1620`. The next table begins at `0x1660`; its eight entries guard that boundary. The editor now uses **Holds item**, shows invalid slots, rejects new invalid entity edits/exports, and preserves unchanged original placements. Other stages retain their existing table-length calculation.

The screenshot-specific repair assigns Room 6's pot at (32, 881) to slot 22 with Ham and eggs. Room 7's tanks use slots 27–31, containing three Heart Max-Ups and two Life Max-Ups in the screenshot's order. These slots have no existing placement users; the stage's pot branch is the persistent-drop creation path. Existing slot 12 and 23 pickups stay intact, and positions, artwork types, runtime code, and unrelated tables stay unchanged.

Run `node tests/reverse-caverns-drops.test.js` for the vanilla/current-image checks, actual pickup-instruction simulation, separate collected flags, changed-source rejection, table bounds, both placement copies, export/reopen, saved edits and Undo, and unrelated-byte/source preservation. The related prize/container, entity/editor/template/repack, disc-stage and saved-edit checks also pass.

Browser-verified locally on 2026-10-07 against the unchanged current ASS image: Room 6 shows slot 176 outside slots 0–31; editing a safe slot restores Ham and eggs; all five Room 7 tanks show the intended upgrades; Undo restores the prior item. The check uses a separate local tab and simulated file selection; the user's existing editor tab stays untouched.

Prepare guarded forward/reversal PPFs with `node tools/map/build-reverse-caverns-drops-patch.js <output-directory>`. Add `--apply` only after explicit approval of that prepared pair; the tool verifies full hashes, original bytes, both undo directions, sector checksums, and reversal. Preparation never writes a BIN. Fresh-boot emulator gameplay remains unverified; load a memory-card save instead of an old savestate.

An additional original Room 9 urn at (76, 97) uses `0x70BE`, or invalid slot 190. It is outside the two screenshot rooms and remains unchanged by this repair.
