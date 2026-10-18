# System settings patch

## Selectable equipment item slots

`node tools/menu/build-system-settings-patch.js MainBIN --slots` prepares a guarded forward/reversal pair against the current MainBIN without changing it. `SOTN_ASS_BIN` can select an explicit source. The older settings-only builder below remains available.

The equipment menu gains two rows below the accessories. Unassigned rows use the empty-hand icon and **SLOT1**/**SLOT2**. Select a row, choose an owned item with Cross, or choose SLOT1/SLOT2 in the picker to clear it. Triangle returns. Eligible items have category **Food (6)** or **Medicine (10)**; **Hammer and Life Apple remain excluded**. Assignments refer to inventory and do not remove copies from it. Both rows can refer to the same item; they share its available stock.

The shared empty-slot description is `To Use：Press L２＋ Hand Button`, with fullwidth colon, digit 2 and plus encoded as Shift-JIS. `node tools/menu/build-system-settings-patch.js MainBIN --slot-description` prepares a separate guarded text-only forward/reversal pair for the installed original slot helper. Its fixed string reservation keeps all code, pointers and loader lengths unchanged. This caption update requires its own application approval; preparation leaves the source BIN untouched.

`node tools/menu/build-system-settings-patch.js MainBIN --item-slot-descriptions` prepares a separate text-only pair replacing the four legacy fixed-shortcut descriptions with their effect and current resource cost. On the reviewed image, Potion reads `Heals ５００HP ３００Hearts`, High Potion `Heals１２００HP７００Hearts`, X-Potion `Heals ３０００HP １５００Hearts`, and Meal Ticket `Random food５００Hearts`. Healing amounts come from the current image. All digits use fullwidth Shift-JIS characters; High Potion and Meal Ticket use tighter spacing to fit. Each string stays in its existing reservation; item names, costs, effects, pointers and slot code stay unchanged. Unknown descriptions or healing values, shared strings, insufficient space or a changed installed helper stop preparation.

Hold Item Shortcut (L2 by default), then press the configured Right hand action for SLOT1 or Left hand action for SLOT2. The earlier fixed Potion, High Potion, X-Potion and Meal Ticket shortcuts are bypassed. Jump and Backdash work normally while the modifier is held. Medicine uses the existing hand-use path without changing either equipped weapon; food uses the existing instant-heal helper, Meal Ticket keeps its existing thrown-food behavior, and Heart Refresh restores 500 hearts. Existing item resource costs and consumable behavior remain in effect. An exhausted assignment stays selected and becomes usable again after obtaining more stock.

The overview grows by 26 pixels and the picker becomes shorter. Normal equipment page jumps adjust to its five visible rows. Choice bytes and a marker use saved castle flags `0x2FC-0x2FF`, after the minimap flag. Old saves initialize both choices empty. The native seven equipment entries and stat calculations retain their existing layout.

This image's spare icon storage is occupied. The loader copies the new code from verified sound-header padding (`DRA 0x18D00-0x19EFF`) before sound initialization into the unused memory interval `0x8009C000-0x8009D8FF`, then flushes the instruction cache. The original sound header, program/tone records and full sample-length table stay intact. The builder checks the executable's loaded boundary and scans the loaded program files for references into the reservation. Later sound-bank loads can reuse the staging buffer without changing the installed code.

`node tests/system-settings.test.js --slots` checks loader copying, delayed loads, category filtering and both exclusions, empty labels/icons, filtered pages, assignments, both saved choices, remapped shortcuts, action suppression, resources, stock, failed uses, register preservation and unrelated bytes. The builder checks both PPF directions, both embedded undo paths, sector checksums and the unchanged source hash. These checks do not establish emulator or hardware behavior.

Fresh boot from a memory-card save is still required to verify menu appearance, menu transitions, all item effects, normal gear changes, resource/stock use and save/reload. Old savestates retain the previous code. Editor Quick Items recognition and release publication are separate follow-up work if this BIN is released.

Application requires explicit approval of the prepared pair and its recorded source/result hashes, supplied as `--apply --source-sha=<hash> --result-sha=<hash>`. Rebuilding over a different prepared pair additionally requires its existing patch hashes with `--replace-forward-sha=<hash> --replace-reverse-sha=<hash>`.

## Original settings-only patch

`node tools/menu/build-system-settings-patch.js <output-directory>` prepares guarded forward and reversal PPFs without changing the source BIN; `--apply` is for an explicitly approved pair and rejects a changed source hash.

System gains **Show minimap: Yes/No** as its last row. Left selects Yes, Right selects No, Cross toggles, and Triangle returns. It uses the minimap's existing castle flag `0x2FB` (`0x8003C0E7`), with zero meaning Yes.

Button Config gains **Item Shortcut** as its eighth action. New games already initialize this action to L2; existing saves retain their previously unused eighth mapping. All eight buttons must have distinct assignments before leaving Button Config. The panel is taller and wider to fit the new row without covering its button icon.

Hold Item Shortcut and press the configured Right hand action for Potion, Left hand for High Potion, Backdash for X-Potion, or Jump for Meal Ticket. The default combinations remain L2 + Square/Circle/Triangle/Cross. Following the action mappings keeps every item accessible when the modifier moves onto a face button. The four actions are suppressed while the modifier is held; existing item availability, resource costs, player-state checks and food behavior stay in the original routine.

The helper reserves blank equipment icons 316–319 (`DRA.BIN 0x2F124–0x2F323`); do not assign those icons to equipment. The existing minimap and neighboring helpers are retained. Native code hashes, unused-space checks, equipment checks, pointers and direct branches guard preparation.

`node tests/system-settings.test.js` executes the game instructions for all 40,320 valid button permutations, duplicate rejection, eight drawn button rows, minimap controls and the native visibility gate, and 2,048 input combinations across remapped layouts. Calls that draw text or play sound are captured; the existing complement instruction in action suppression is modeled directly because the shared instruction runner does not implement it. The builder checks both PPF directions and embedded undo, reopened DRA bytes, repaired sector checksums, unrelated sectors and the unchanged source hash.

Fresh-boot emulator verification remains necessary: inspect both menus, switch minimap, remap each action and the modifier, try all four shortcuts and normal controls, then save in a save room and reload. An old savestate retains earlier code. Extra Hacks Quick Items recognition still describes the earlier fixed-L2 routine; its catalog should be refreshed with the release if this BIN is published.

Exact source/expected hashes, both PPF hashes, decomp revision and changed byte ranges are recorded in the output's `verification.json`.
