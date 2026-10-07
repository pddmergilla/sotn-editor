# Tests

[← Back to the README](../README.md)

Run each file with Node.js 22 or later from the repository root:

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
node tests/hunter-sword.test.js
node tests/stone-sword.test.js
node tests/terminus-est.test.js
node tests/alucard-soul-steal.test.js
node tests/enemy-elements.test.js
node tests/spell-mp.test.js
node tests/file-picker.test.js
node tests/safe-save.test.js
node tests/edit-session.test.js
node tests/extra-hacks-ui.test.js
node tests/richter-save.test.js
node tests/stat-buffs.test.js
node tests/ass2.test.js
node tests/title-credits.test.js
node tests/ass2-downloads.test.js
node tests/play.test.js
node tests/play-page.test.js
node tests/play-card.test.js
```

`file-picker.test.js` checks native and fallback file selection, cancel/retry, downloads, source-file protection for non-BIN exports, and BIN replacement wiring. `safe-save.test.js` checks backup-before-write ordering, verification before deletion, every-byte checks across read windows, stale source references, repeat builds, existing backups, new and empty destinations, failed reads/writes/closes, damaged output, backup cleanup failure, filename guards, and both builders. `tests/safe-save-harness.html` uses real browser-storage file handles with small synthetic files to check the save dialog, source replacement, failed verification and cancellation without opening user images. Manually verify native folder selection and full-size working-copy replacement in Chrome/Edge, and Open SOTN BIN, Build BIN and Export PPF3 downloads in Firefox.

Browser-verified locally on 2026-10-07: the new dialog replaces a synthetic working BIN through real browser-storage file handles, removes the backup after a byte-for-byte output check, keeps the open source readable, and rejects deliberately damaged output while retaining the verified original backup. The destination-folder picker is simulated in this harness; native Windows folder permissions and full-size browser saves still need manual acceptance.

`edit-session.test.js` checks saving from memory after source-file access fails, preservation of changes that cannot currently build, all edit types, reloading onto a fresh compatible BIN, merging, conflict and damaged-file rejection without partial application, grouped Undo, hack bonuses and dependencies, and repeat saves after restoration. Image checks use `SOTN_BIN`, `SOTN_VANILLA_BIN`, and `SOTN_ASS_OLD_BIN` when available. Browser acceptance: save edits, reopen a BIN, load the saved JSON, review each edited tab, Undo, load again, and build; also save after a file-read failure without refreshing the page.

Verified locally on 2026-10-06: saved/restored stats and maps produce identical changed sectors on vanilla US, the current ASS BIN, and ASS 1.3.1, without changing any input image. Hack selection round trips pass on vanilla and ASS 1.3.1; bonus and dependency checks also pass with controlled fixtures. The current ASS BIN's Extra Hacks rejection (unexpected `BOSS/RBO3/RBO3.BIN` size) also occurs with the unchanged editor and remains a separate issue. In the browser harness, STR 50 → 51 survives a simulated source-read failure: Save current edits captures the JSON, reopening the BIN resets STR to 50, loading the saved file restores 51, Undo restores 50, and reloading/building succeeds with one changed sector. The toolbar fits without overlap at 1280 pixels, and the editor fills the remaining height. Native save dialogs and completed browser downloads to disk remain manual checks. `tests/edit-session-harness.html` provides standard file selection, captured save output, and a lost-access simulation for that check.

`copy-tile.test.js` checks rectangle capture on release, reverse drags, selection cancellation, zoom, foreground and background chunks, empty tiles, edge clipping, overlapping stamps, preview bounds, grouped undo, single-tile reset, and clearing chunks when a room uses different tile definitions. Browser-verified locally on 2026-10-04 with the current ASS BIN: a 4 × 4 rectangle copies on release, its artwork appears in the cursor preview, clicking and dragging paint the chunk, and one Undo restores the clean map after either action.

`spell-mp.test.js` checks exported spell-cost bytes and runs the recognized CastSpell instructions on vanilla and the current modded BIN: Soul Steal at 1 MP accepts 29 current MP and spends 1, with max MP still 29. It also checks insufficient MP, zero cost, and increased costs. This does not verify combo input or emulator loading; boot the edited BIN afresh and load a memory-card save rather than an old savestate.

`alucard-soul-steal.test.js` executes the actual back-forward input and native Soul Steal MP checks for both hands and facing directions, standing/walking, insufficient MP, wrong weapons/buttons, expired commands, existing spell input, edited costs and register preservation; animation and learning services are simulated. `node tools/weapons/build-alucard-soul-steal-patch.js <output-directory>` prepares guarded forward/reversal PPFs, verifies all four hash round trips, sector checksums, export/reopen and unchanged unrelated sectors, and leaves the original BIN untouched. `--apply` requires explicit approval for that prepared pair and rejects a changed source hash. The added command uses the shared Soul Steal spell settings; normal slash and the existing QCF special stay unchanged. Fresh-boot gameplay, healing, animation and gear/room transitions remain manual checks.

`stone-sword.test.js` uses the exact current ASS image to check Stone Sword's grounded QCF selection, MP and active-spell limits, both hands and facing directions, preserved slash properties, relocated animations and artwork, palette loading, the unchanged Medusa spell and beam-damage routines, shared row 211, private copies, export/reopen, occupied-code rejection and unchanged source hashes. `node tools/weapons/build-stone-sword-patch.js <output-directory>` prepares guarded forward/reversal PPFs and full-hash verification without writing a BIN; `--apply` requires explicit user approval and the exact recorded source hash. Fresh-boot gameplay, spell presentation and gear/room transitions remain manual checks.

Browser-verified locally on 2026-10-06 with the prepared DRA preview: Stone Sword selects row 211 and shows the Medusa Shield sharing warning; raising its special MP cost from 70 to 71 updates the shared spell, while a private copy into row 186 can change cost without changing Medusa Shield's row 211. The preview uses extracted DRA data and does not write the source BIN.

`enemy-elements.test.js` checks Medusa's body and sword elements independently on vanilla and the current ASS BIN. It reproduces the ASS sword's hardcoded Curse despite the body's Hit element, executes the actual sword instructions with branch/load delays after removing/restoring Curse, checks both slash variants and inactive hitboxes, rejects unknown or changed code, and verifies BIN/PPF exports, reopen, sector checksums, and unchanged source hashes. Set `SOTN_VANILLA_BIN` and `SOTN_ASS_BIN` to choose images; missing images skip.

Verified locally on 2026-10-05: the browser shows Sword slash as Cut + Curse and Dashing sword slash as Cut + Fire; clearing Curse changes only Sword slash, Undo restores it, and PPF export reports one changed sector. The in-app browser did not expose a completed download event, so disk download remains unverified. Emulator combat still needs a fresh boot and a memory-card save; an old savestate keeps its existing enemy elements.

The later Medusa Table Elements patch disables the forced element store at `BOSS/RBO3/RBO3.BIN` offset `0x207E0`, preserving the rest of the routine. The element tests execute both slash variants with several table elements, retain inactive hitboxes, recognize the disabled write, and export/reopen table edits. `node tools/extra-hacks/build-medusa-element-patch.js <output-directory>` prepares a guarded forward/reversal PPF pair and verification report without writing a BIN; adding `--apply` applies an already prepared pair only to its recorded full-image hash, then checks the live hash, instruction, checksums, editor support, and reversal. Original-BIN application requires the user's explicit instruction.

The current reference images also reproduce three existing failures with the pre-change stats model: `stats-bin.test.js` cannot locate the prologue bonus-item fields, `stat-buffs.test.js` fails current-image Extra Hacks recognition, and `title-credits.test.js` finds that the shipped ASS release differs from the current main BIN. These failures are separate from Medusa's element checks.

`ass2.test.js` checks the PPF parser and windowed builder on a synthetic image, that the shipped PPF matches the release data, and, when the images are present, that vanilla builds to the exact ASS 2.0 BIN.

`title-credits.test.js` checks the actual export collector with one stat edit on vanilla and ASS, the literal link at the left edge, existing lettering, the ASS title in the requested area beneath the subtitle, unchanged link position, upgrades from centered and earlier aligned editor exports, repeated builds without drift, PPF/BIN equality, reversal, sector checksums, neighboring edits, and rejection of unknown code or occupied artwork. It also verifies that the ASS browser builder produces the shipped release with the new title layout and credit, and rejects a failed release check. Set `SOTN_VANILLA_BIN` and `SOTN_BIN` to supply the images; image checks skip when absent. Boot both results afresh to check title-screen placement.

Verified locally on 2026-10-04: fresh emulator boots show the full editor link at the bottom left, and the revised ASS title sits in the user's marked area beneath Symphony of the Night, starting at x=190 and y=146, with Press Start visible and no stray line. Vanilla exports keep the earlier layout; both new and earlier ASS exports pass the layout and repeat-build checks. The ASS builder passes release verification with output CRC32 6D7156D4. Both input image hashes remain unchanged.

`ass2-downloads.test.js` checks matching release downloads, total counts across older and current releases, pagination, duplicate assets, zero counts, unpublished builds retaining the historical total, failed history reads, rate limits, network errors, mismatched patches, and publishing/retry behavior without contacting GitHub. `node tools/ass2/publish-release.js --check` verifies the shipped patch without publishing. After pushing, confirm the release workflow succeeds and the ASS tab retains the total across all builds; try a download and check GitHub's updated count. Browser builds and untracked downloads are excluded.

Verified locally on 2026-10-04 for ASS 2.0.10: the release PPF builds vanilla to the exact updated main BIN (CRC32 3487DEAF), undo restores vanilla, all 29 finished hacks remain recognized, and configured bonus removal/re-addition round trips pass. Title checks include a main BIN that already contains the current title layout and link. Migration fixtures reconstruct the earlier title code and artwork before testing upgrades; bonus checks read installed values rather than assuming every image still uses vanilla bonuses. Gameplay for this release remains emulator-unverified.

All 16 sectors changed since 2.0.09 have valid checksums. Across the entire release patch, 1,082 Form 1 and 172,972 Form 2 sectors pass checksum checks; 158 Form 1 sectors retain earlier checksum mismatches and are byte-for-byte unchanged from 2.0.09. The exact-image release preserves them rather than altering the supplied main BIN.

`play.test.js` checks disc/BIOS archives, all-byte build identities, source preservation, controller defaults, origin/source/token checks, popup handling, and failed builds. `tests/play-harness.html` exercises the real disc parser and browser handoff using an ordinary file input for automation environments that cannot operate the editor's native picker.

`play-page.test.js` checks the fast-forward button and backtick shortcut in both keyboard layouts, repeated-key and typing guards, focus/stop reset, player setup, saved-state round trips, mismatched/corrupt state rejection, retained-copy storage failure, memory-card lock contention, failed sync/retry, and saving before stop with a simulated emulator.

`play-card.test.js` checks durable card capture, reload into a fresh core, legacy-card fallback, damaged cards, failed writes and restore failures. The player checks also reopen a saved card in a new page, including a changed build and core save path, and prevent failed card restores from starting autosaves.

Browser acceptance: test an unchanged disc and an edited disc; verify a change in gameplay; save in a save room, stop, rebuild and load the card; save/load a browser state and verify changed builds have separate states; export/import both kinds of saves; reload an optionally stored test copy; test a controller and BIOS, CDN failure, storage failure, and a second simultaneous play tab. Unit checks alone do not establish gameplay or persistence.

Verified locally on 2026-10-03: the fast-forward button and backtick shortcut toggle the real core at the title screen in both keyboard layouts; stopping saves the card and hides the speed control. The supplied ASS 2.0 BIN boots to its title screen through the browser handoff, the player confirms a memory-card filesystem sync, a stored test image reloads, and a savestate restores after a page reload with the real core. Controller hardware, supplied BIOS/Track 2, an actual save-room recovery, and downloaded backup files still need manual acceptance in Chrome/Edge.

The explicit memory-card copy and restore added on 2026-10-03 passed the automated checks, but real save-room recovery after closing the tab remained unverified and was reported failing. The file workflow added on 2026-10-04 checks exact downloaded bytes, import into fresh and edited builds, invalid-card rejection, failed core restores, and downloads despite browser storage failure. Save-room recovery with the real core still requires acceptance.

Verified locally on 2026-10-04 with the real EmulatorJS core: the unchanged ASS BIN boots, a distinct raw card file imports through the file chooser, and a fresh core passes the byte-for-byte card restore check. Both download controls expose a dated `.srm` link. The in-app browser's download event timed out for automatic downloads and the explicit link, so completed downloads to disk and an actual save-room save recovered from a downloaded card remain manual Chrome/Edge checks.

Investigated locally on 2026-10-05 with the supplied 128 KB external `.srm`: its directory checksums and four SotN save headers pass inspection, the player imports it, and the real core boots without a BIOS. A held controller input reaches File Select, where card reading stalls. The player now warns about memory-card compatibility without a real BIOS, following the [core's BIOS guidance](https://docs.libretro.com/library/pcsx_rearmed/#bios). No BIOS was available for comparison, so loading those saves with a BIOS and actual save-room recovery remain unverified. The warning is guidance, not a core crash fix.

`extra-hacks-ui.test.js` runs its unit checks always. With the reference images present it also checks:

- detection on vanilla, ASS 2.0 and ASS 1.3.1;
- current and earlier Epic Richter AI detection, upgrade after re-adding, and rejection of unknown AI bytes;
- CON-based and earlier fixed Heart Regeneration detection, preservation while selected, upgrade after re-adding, version-specific tuning guards, and exported bytes without changing the source;
- add and remove round trips that must restore the files byte for byte;
- removing each hack on its own, and Healing items use Hearts off then on (costs and the L2 shortcuts switch to MP and back; adding it in a second build gives the same bytes as adding everything at once);
- a simulated later ASS build with retuned values and edited data;
- that another mod (the Reawakened PPF) is rejected.

`richter-save.test.js` checks the rescue fix on vanilla US, ASS 1.3.1 and the current ASS BIN. It executes the actual Richter and orb instructions with PlayStation branch/load delays, reproduces the old missing signal, checks the saved pose, one-time rescue actor creation, one-update rescue signal, stock/Epic AI handoff, native dialogue handoff, and orb cleanup. Normal orb damage and Holy Glasses defeat retain their paths. Add/remove, earlier-version preservation and upgrade, incomplete/unknown-code rejection, unrelated bytes, exports and sector checksums also pass. Game services are simulated; this does not prove emulator dialogue or progression.

Verified in the local browser on 2026-10-05: the current ASS BIN recognizes the rescue hack as off, checking it shows **Build: adds it**, and the revised card explains the pending gameplay test. Boot a new test copy from a memory-card save before Richter, defeat him without Holy Glasses, confirm the full dialogue and Inverted Castle access, and repeat the normal Holy Glasses orb route with stock and Epic Richter AI. An old savestate cannot verify changed game code.

`node tools/extra-hacks/build-richter-save-patch.js <output-directory>` builds a separate exact-image forward/reversal PPF pair and a verification report, without writing a BIN. It checks hashes, both patch directions and embedded undo, guarded rejection, checksums, and unrelated hack states. Rebuild if the source BIN changes before application; applying to the original requires explicit approval.

`stat-buffs.test.js` checks independent Sunstone/Moonstone bonuses, zero/one/two-stone stacking, configured Dark Metamorphosis export/reopen and removal, unknown/partial helper rejection, unchanged source bytes, and Extra Hacks recognition on vanilla, ASS 1.3.1 and ASS 2.0. It executes the emitted helpers with PlayStation branch/load delays to check expiry, repeated refreshes, STR before attack and CON before defense, zero attacks and the ATK cap. Original stat recalculation and attack/defense calls are simulated; emulator gameplay remains a manual check. `tests/stat-buffs-harness.html` opens the full editor with an ordinary file picker for browser automation.

`hunter-sword.test.js` checks the guarded Hunter Sword boomerang patch on the current ASS image and vanilla US image when present. It simulates both hands, combo and MP gating, grounded/crouched throws, return flight, independent special-row stats, PPF replay, source preservation, and rejection of changed weapon code. Emulator gameplay remains a manual check.

`terminus-est.test.js` checks Terminus Est's ←→ selection, unchanged native MP behavior, chain limits, both hands and facing directions, normal slash parity, Crissaegrim attack-frame parity, allocation failure, palette loading, sword artwork, private row 186, stat export/reopen, guarded PPF replay and source preservation. `node tools/weapons/build-terminus-est-patch.js <output-directory>` prepares a guarded forward/reversal pair and report; `--apply` requires explicit approval and the recorded full-image hash. After application, the test can reconstruct the source in memory using the matching report in Downloads, or `SOTN_TERMINUS_REPORT`. Fresh-boot combat, gear changes and room transitions remain manual checks.

Browser-verified locally on 2026-10-06 after approved application: Terminus Est's ←→ picker selects its own row 186, with 199 special damage, 15 MP, Cut and 14-frame hit cooldown. Raising special damage to 201 leaves the normal ATK at 199; Undo restores the special to 199. The existing prologue-bonus warning remains present and is separate from these fields. Byte checks, both-hand instruction checks, private stat exports, all 24 changed-sector checksums and exact reversal pass; emulator gameplay remains unverified.

Set `SOTN_VANILLA_BIN`, `SOTN_ASS_BIN`, `SOTN_ASS_OLD_BIN` and `SOTN_OTHER_PPF` to choose the files. `stats-bin.test.js` needs real disc images and skips without them; `prize-drops.test.js` runs its synthetic checks either way. Set `SOTN_BIN` to a US BIN and `SOTN_VANILLA_BIN` to an unmodified US Track 1 to choose which images it checks.
