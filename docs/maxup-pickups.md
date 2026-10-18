# Unique Max-Up pickups

A persistent pickup's collected flag is `HEART_DROP_CASTLE_FLAG + Params` (`EntityPersistentItemDrop`, `src/st/e_collect.h`). Two placements with the same prize slot share one flag, so collecting one hides the other permanently. A breakable whose params name an item directly creates an `E_PRIZE_DROP` with no flag. The game clears the respawn bits on every room change (`src/dra/5087C.c`), so that drop refills each time the room is re-entered.

The 2026-10-09 scan of the current ASS image covers every stage and boss overlay and both placement copies. It reads each overlay's flag base from its code; all match the decomp. It found these problems:

- Castle Entrance (NO3, and NP3 for later visits): room 14 (96, 169) shared slot 0 with room 0 (32, 679). NO3 and NP3 share their whole flag range by design.
- Underground Caverns (NO4): room 25 (1479, 310) and (1516, 309) shared slot 0 with room 8 (128, 169).
- Death Wing's Lair (RNO2): candles in room 3 (101, 65) and (149, 65), and room 6 (161, 497) and (167, 623), dropped Life/Heart Max-Ups directly. RNO2 candles (look 0, DRA sprite set 3) only drop direct items. Urns use sprite set 9, which is loaded only in rooms with graphics bank 3; room 6 uses bank 6.

The repair keeps the first placement of each shared pair on its slot and gives the others unused slots. The NO3/NP3 copy uses slot 3, which already holds a Heart Max-Up. NO4 uses slots 3 and 8, set to Heart Max-Up. The four RNO2 candles become persistent Max-Up pickups at the same positions, as **Change Type** would make them: template flags 0 and spawn ID 0, with the entity slot kept. They use slots 1–4, with the same items as before. The chosen slots have no placement users. They avoid NO4's scripted Succubus drop (slot 10, `src/st/no4/48248.c`) and Scylla's BO3 mirror of NO4 slots 2, 13, 14 and 21.

Run `node tests/maxup-pickups.test.js`. It rebuilds the four overlays in memory and checks both placement copies. It confirms the original candles took the direct-drop path in the real break routine. It runs each stage's real `EntityPersistentItemDrop`: every new pickup appears with all other flags set and disappears once its own flag is set. Every Max-Up in the edited stages has its own flag. A changed source pickup is rejected. Only the intended bytes change, and the source BIN is not modified.

Prepare guarded forward/reversal PPFs with `node tools/map/build-maxup-pickups-patch.js <output-directory>`. Add `--apply` only after explicit approval of that prepared pair. Existing saves keep their collected flags; a Max-Up hidden by its former twin becomes available. Emulator gameplay is unverified: fresh-boot the image and load a memory-card save, not an old savestate.
