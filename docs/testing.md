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
node tests/spell-mp.test.js
node tests/file-picker.test.js
node tests/extra-hacks-ui.test.js
node tests/ass2.test.js
node tests/play.test.js
node tests/play-page.test.js
```

`file-picker.test.js` checks native and fallback file selection, cancel/retry, downloads, and source-file protection. Manually verify Open SOTN BIN, Build BIN and Export PPF3 in Firefox.

`spell-mp.test.js` checks exported spell-cost bytes and runs the recognized CastSpell instructions on vanilla and the current modded BIN: Soul Steal at 1 MP accepts 29 current MP and spends 1, with max MP still 29. It also checks insufficient MP, zero cost, and increased costs. This does not verify combo input or emulator loading; boot the edited BIN afresh and load a memory-card save rather than an old savestate.

`ass2.test.js` checks the PPF parser and windowed builder on a synthetic image, that the shipped PPF matches the release data, and, when the images are present, that vanilla builds to the exact ASS 2.0 BIN.

`play.test.js` checks disc/BIOS archives, all-byte build identities, source preservation, controller defaults, origin/source/token checks, popup handling, and failed builds. `tests/play-harness.html` exercises the real disc parser and browser handoff using an ordinary file input for automation environments that cannot operate the editor's native picker.

`play-page.test.js` checks player setup, saved-state round trips, mismatched/corrupt state rejection, retained-copy storage failure, memory-card lock contention, failed sync/retry, and saving before stop with a simulated emulator.

Browser acceptance: test an unchanged disc and an edited disc; verify a change in gameplay; save in a save room, stop, rebuild and load the card; save/load a browser state and verify changed builds have separate states; export/import both kinds of saves; reload an optionally stored test copy; test a controller and BIOS, CDN failure, storage failure, and a second simultaneous play tab. Unit checks alone do not establish gameplay or persistence.

Verified locally on 2026-10-03: the supplied ASS 2.0 BIN boots to its title screen through the browser handoff, the player confirms a memory-card filesystem sync, a stored test image reloads, and a savestate restores after a page reload with the real core. Controller hardware, supplied BIOS/Track 2, an actual save-room recovery, and downloaded backup files still need manual acceptance in Chrome/Edge.

`extra-hacks-ui.test.js` runs its unit checks always. With the reference images present it also checks:

- detection on vanilla, ASS 2.0 and ASS 1.3.1;
- add and remove round trips that must restore the files byte for byte;
- removing each hack on its own, and Healing items use Hearts off then on (costs and the L2 shortcuts switch to MP and back; adding it in a second build gives the same bytes as adding everything at once);
- a simulated later ASS build with retuned values and edited data;
- that another mod (the Reawakened PPF) is rejected.

Set `SOTN_VANILLA_BIN`, `SOTN_ASS_BIN`, `SOTN_ASS_OLD_BIN` and `SOTN_OTHER_PPF` to choose the files. `stats-bin.test.js` needs real disc images and skips without them; `prize-drops.test.js` runs its synthetic checks either way. Set `SOTN_BIN` to a US BIN and `SOTN_VANILLA_BIN` to an unmodified US Track 1 to choose which images it checks.
