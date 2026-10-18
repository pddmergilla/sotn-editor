# Damage-number affinity colors

The exact-image tool restyles the installed Damage Number Colors hack. Plain damage numbers on a weakness flash the GUARD colors (silver and gold, CLUTs 0x1B0/0x1B1, alternating every frame), and resisted ones become grey (`#848484` upper, `#ADADAD` lower). Neutral damage, CRITICAL, heal/absorb and GUARD numbers keep their loaded colors, weak numbers keep the plain-number animation, and weakness still wins when both apply. Damage and healing values are unchanged.

Prepare without changing the input BIN:

```text
node tools/extra-hacks/build-damage-number-colors-patch.js outputs/damage-number-colors-guard-weak-2026-10-09
```

The output contains guarded forward and reversal PPFs, full hashes, inspected areas and verification results. Applying requires explicit approval for this pair; afterwards repeat the command with `--apply`. A changed source hash is rejected. No backup BIN is created or deleted.

Two ranges change, both owned by the installed hack:

- DRA `0x2EAD4`: the picker's weak case changes from `ori t0,zero,0x18D` to `addiu t0,v0,0x1B0`. Every stage calls the picker with the flash frame bit in `v0`, so the result matches the stage table's GUARD entries 6 and 7.
- F_GAME `0x411C2–0x411DF`: CLUT 0x18E becomes grey. Number glyphs sample entries 2 (outline), 4 (upper fill) and 5 (lower fill); the other entries take the same tone, and transparency and STP bits are preserved.

CLUT 0x18D stays as installed but is no longer selected. Preparation first requires every installed hack byte in DRA, F_GAME and the 57 stage overlays. It also requires each overlay's frame-bit instruction, table indexing and GUARD table entries. The flag cave's two weakness-multiplier instructions (`0x2E340`, `0x2E344`) may differ from the spec because the live image changed them.

The installed picker only reads the weak/resist flag for plain numbers. CRITICAL (`0x4000`), heal/absorb (`0x8000`) and GUARD (`0xC000`) use their stage colour tables, so this change cannot reach them.

```text
node tests/damage-number-colors.test.js
```

The checks run the loaded damage calculation, flag handoff and palette picker together for physical, elemental and mixed attacks with weakness, resistance, immunity, absorption, critical hits, stale flags and both flash frames. They also execute every overlay's palette selection through the patched picker and compare it with the unpatched result, including the animation group. Further checks cover glyph palette entries, grey channels, allowed byte ranges and rejection of changed hack bytes. The builder verifies forward/reversal and both undo hashes, guarded rejection, reopened file equality, sector checksums, unrelated sectors and the unchanged source.

Fresh-boot emulator presentation remains manual: load a memory-card save, enable the Spirit Orb, and check weak and resisted plain hits, a critical hit on a weakness, absorbed hits and GUARD. Old savestates retain loaded code and palettes. This standalone patch does not regenerate the editor catalog or the ASS release; use the skill's BIN-updated workflow when requesting that refresh.
