# Scorpion Card and noiL Card

`node tools/items/build-warp-cards-patch.js <output-directory>` prepares an exact-image forward/reversal PPF pair without changing the original ASS 2.0 BIN. `--apply` requires the user's explicit approval of that prepared pair and checks its full source hash.

Library Card (item 166) becomes **Scorpion Card**, targeting the normal Outer Wall scorpion warp room, WRP room 2. Takemitsu (item 27) becomes **noiL Card**, targeting the inverted Castle Keep reverse lion warp room, RWRP room 0. Both use the existing card icon/effect, cost zero MP, and remain reusable. Existing inventory, shops and pickups keep their item IDs. Owning noiL Card allows travel to the reverse castle without another unlock requirement.

Use the card in either hand while standing, walking or crouching. Each card targets its own castle regardless of the origin castle. Spawn positions avoid the warp platform's automatic arrival behavior: Scorpion at (192,132), noiL at (64,132). Ordinary room exits and the separate existing room-return card are preserved.

The helper and private destination records occupy verified unused equipment-icon space at DRA `0x2EF00-0x2F01F`; reserve icons 311-313. The graphics helper occupies `0x2F0B0-0x2F0E3` inside unused icon 315; reserve that icon too. The native teleport table is unchanged. Existing helpers at `0x2EC00`, `0x2EDA4`, `0x2EE00` and the existing room-return code remain unchanged. The browser stats model reads the updated names, descriptions, icons and categories directly from the patched image; no site release is refreshed by this task.

The first applied version selected the correct stage and room but skipped the stage graphics request for both private destination indices. Its tests omitted the graphics loading step. `node tools/items/build-warp-card-graphics-fix.js <output-directory>` prepares a guarded correction against an image with that version installed, preserving later edits. Its reversal restores only this correction. Explicit approval is required before `--apply`. The full card builder now includes this correction for new installations.

`node tests/warp-card-graphics.test.js` reproduces both skipped graphics requests, executes the corrected native loading branch and complete activation-to-position path, verifies WRP Room 2 and RWRP Room 0, checks loading waits, and compares 70 existing graphics routes. It does not establish emulator acceptance.

`node tests/warp-cards.test.js` executes actual card-use, inventory, stage transition, destination selection and position instructions. It checks both hands, origins in both castles, grounded and airborne cases, zero MP, repeated-route setup, native teleport modes, existing room-return routing, occupied-space rejection and unchanged unrelated DRA bytes. The builder verifies both PPFs and their embedded undo data by full image hashes, repaired sector checksums, export/reopen and unchanged input bytes.

Fresh-boot emulator acceptance remains required: load a memory-card save, test both cards from each castle, confirm the statue rooms, landing and control, repeat use, icons/names, inventory and MP, ordinary room exits/warp cycling, and the existing room-return card. Instruction checks do not prove animation or gameplay.
