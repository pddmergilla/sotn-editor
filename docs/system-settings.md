# System settings patch

`node tools/menu/build-system-settings-patch.js <output-directory>` prepares guarded forward and reversal PPFs without changing the source BIN; `--apply` is for an explicitly approved pair and rejects a changed source hash.

System gains **Show minimap: Yes/No** as its last row. Left selects Yes, Right selects No, Cross toggles, and Triangle returns. It uses the minimap's existing castle flag `0x2FB` (`0x8003C0E7`), with zero meaning Yes.

Button Config gains **Item Shortcut** as its eighth action. New games already initialize this action to L2; existing saves retain their previously unused eighth mapping. All eight buttons must have distinct assignments before leaving Button Config. The panel is taller and wider to fit the new row without covering its button icon.

Hold Item Shortcut and press the configured Right hand action for Potion, Left hand for High Potion, Backdash for X-Potion, or Jump for Meal Ticket. The default combinations remain L2 + Square/Circle/Triangle/Cross. Following the action mappings keeps every item accessible when the modifier moves onto a face button. The four actions are suppressed while the modifier is held; existing item availability, resource costs, player-state checks and food behavior stay in the original routine.

The helper reserves blank equipment icons 316–319 (`DRA.BIN 0x2F124–0x2F323`); do not assign those icons to equipment. The existing minimap and neighboring helpers are retained. Native code hashes, unused-space checks, equipment checks, pointers and direct branches guard preparation.

`node tests/system-settings.test.js` executes the game instructions for all 40,320 valid button permutations, duplicate rejection, eight drawn button rows, minimap controls and the native visibility gate, and 2,048 input combinations across remapped layouts. Calls that draw text or play sound are captured; the existing complement instruction in action suppression is modeled directly because the shared instruction runner does not implement it. The builder checks both PPF directions and embedded undo, reopened DRA bytes, repaired sector checksums, unrelated sectors and the unchanged source hash.

Fresh-boot emulator verification remains necessary: inspect both menus, switch minimap, remap each action and the modifier, try all four shortcuts and normal controls, then save in a save room and reload. An old savestate retains earlier code. Extra Hacks Quick Items recognition still describes the earlier fixed-L2 routine; its catalog should be refreshed with the release if this BIN is published.

Exact source/expected hashes, both PPF hashes, decomp revision and changed byte ranges are recorded in the output's `verification.json`.
