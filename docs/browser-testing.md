# Test in the browser

Open your BIN, make edits, then select **▶ Test in browser**. The editor validates the same changes as Build BIN, including repaired sector checksums, and sends a separate patched Blob to a play tab. The source file is never written. Unchanged discs can also be tested; a bad edit stops the launch rather than silently running the original.

If you opened `index.html` directly, Test shows a message explaining how to start the local server. On Windows, double-click **Start Editor.cmd** in the editor folder and keep that window open, then reopen your BIN in the browser that opens. Export unsaved edits before switching tabs. Other systems can run `node serve.js` and open `http://127.0.0.1:8765`.

In the play tab:

1. Optionally select your own 512 KB PS1 BIOS, such as `scph5501.bin`; it is remembered in this browser. No BIOS is supplied, and booting without one is not guaranteed.
2. Optionally supply the original US Track 2 BIN, including its two-second audio pregap. This is the same two-file layout as the editor's ASS 2.0 CUE export; other multi-track layouts need an external emulator. Track 1 alone omits the separate CD audio track.
3. Optionally select **Keep this test copy for page reloads**. This stores the patched image and optional audio track locally and needs several hundred MB of free browser storage. On reload, select **Load last test copy**. Failed storage does not prevent testing in the current tab.
4. To continue from a downloaded save, select **Load memory card from file** and choose your `.srm` file before starting. This card takes priority over browser storage, including a damaged stored card; it can also be used with an edited build.
5. Select **Start game**. Connect a controller and press a button to expose it to the browser, then click the game. The emulator's Controls menu supports remapping. Standard gamepads have PlayStation face buttons, D-pad, shoulders, Start and Select mapped by position.
6. Save at an in-game save room, then select **Save & download memory card** to keep playing, or **Save & download memory card and stop** before closing the tab. Both download a dated `.srm` file to your drive. Keep that file and choose it before your next game. Close the tab before testing a new build.

The **Keyboard layout** selector works before starting or while playing and remembers your choice. **Classic** keeps arrows, Z/X/A/S face buttons, Q/E for L1/R1, W/R for L2/R2, Shift for Select and Enter for Start. **WASD + I/J/K/L** uses WASD to move, I/J/K/L for Triangle/Square/Cross/Circle, U/7/O/9 for L1/L2/R1/R2, Space for Select and Enter for Start. Switching releases held inputs and preserves controller mappings.

**⏩ Fast forward** or the backtick key (`) toggles 3× speed in either keyboard layout; press again to return to normal speed. The button shows whether it is on. Speed resets when the tab loses focus, becomes hidden, or stops; actual speed depends on your device.

**Download test BIN** saves an optional copy for external testing. Nothing is automatically written to your original BIN or a backup next to it. The ASS 2.0 tab's release Build is separate: open its resulting BIN in the editor before selecting Test.

## Memory cards and savestates

One memory card is shared by tests on the same site and browser profile, including rebuilt images. Only one play tab can run at a time to avoid competing memory-card writes. Card data is flushed every five seconds while running, when the tab becomes hidden, and explicitly before stopping. A successful sync message confirms the browser write, not an in-game save: save in a save room first. The player also keeps a checked copy of the card in its own browser storage, verifies each write, and restores it into the core before play resumes on the next launch. If the stored card cannot be read or verified, starting stops so a blank card cannot replace it. Older saves in the emulator’s storage remain available when no player copy exists.

**Save state / Load state** stores a snapshot in this browser and confirms when the write completes. Its identity includes the entire patched disc, optional audio, BIOS, disc layout, and pinned EmulatorJS version. A changed build has a different state identity, while an identical rebuilt image can reuse its state. Quick-save hotkeys are session-only in EmulatorJS 4.2.3; use the play page's Save state for persistence.

For portable memory cards, use the play page's **Save & download memory card** and **Load memory card from file**. Downloads capture the current card before trying browser storage, so they still work when browser storage is full or unavailable. If your browser blocks the automatic download, use the visible **Download memory card again** link while the tab is open. Imports accept raw 128 KB or 256 KB PS1 cards (`.srm` / `.mcr`) and check each card's header; headered external formats and savestates are rejected. A card file contains in-game saves, not a snapshot of the current scene. Import before starting, then select your save in the game's load menu. The emulator's Import Save File menu remains available for other supported formats.

For states, use the play page's **Export state / Import state**. The `.sotnstate` file includes the build identity and a payload checksum; imports reject mismatched builds, BIOS changes, or damaged data before loading. It is a player-specific wrapper, not a raw external-emulator state file. After edits, boot fresh and load the memory card instead.

Localhost and GitHub Pages have different saves, as do different local ports and browser profiles. Private browsing, browser cleanup, storage eviction or a full disk may prevent persistence. Export backups of progress you care about. Forget BIOS and Forget stored test copy affect only those files, not memory cards or states.

## Hosting and implementation

- Requires desktop Chrome/Edge, HTTPS or localhost, WebAssembly, IndexedDB, Web Locks and browser gamepad support. Run `node serve.js` locally; `file://` launches are rejected. Allow pop-ups for the editor.
- Runtime: [EmulatorJS 4.2.3](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3), loaded from `https://cdn.emulatorjs.org/4.2.3/data/`, with `pcsx_rearmed` explicitly selected and threads disabled. No cross-origin isolation headers are needed for this mode. Internet is required; this does not bundle an offline emulator.
- Disc and BIOS data are local Blob URLs and are not uploaded. The CDN supplies executable emulator code. EmulatorJS and core license/source notices remain in the player; [upstream sources](https://github.com/EmulatorJS/EmulatorJS) and [core sources](https://github.com/EmulatorJS/pcsx_rearmed) are linked from the play page.
- A small ZIP contains a stable `sotn-editor-test.cue`; the tracks are passed as Blobs through `EJS_externalFiles`. The pinned runtime converts these to byte arrays before writing them into the core's filesystem; Blob URLs here would produce unsupported buffers and silently omit the tracks. The stable disc basename keeps the core's memory card stable, while `EJS_gameName` isolates browser savestates. Each launch uses fresh URLs and disables runtime ROM caching.
- A chunked SHA-256-derived identity covers every byte without reading the entire image into a JavaScript buffer at once. The emulator still needs substantial memory for the disc and its working memory; close the play tab to release it.
- The card flush and restore use the pinned runtime's `gameManager.saveSaveFiles`, `getSaveFile`, `getSaveFilePath`, `writeFile`, `loadSaveFiles`, `FS.syncfs`, and `toggleMainLoop` APIs. Restore captures the card back from the core and checks every byte before resuming, preventing a failed restore from silently becoming a blank saved card. State controls use `getState` and `loadState` without waiting for a screenshot. Recheck these when upgrading EmulatorJS; they are upstream implementation details. The core may have compatibility or performance limits independent of editor exports.

See upstream [options](https://emulatorjs.org/docs/options/), [PlayStation support](https://emulatorjs.org/docs/systems/playstation/), and [controller mapping](https://emulatorjs.org/docs4devs/control-mapping/).
