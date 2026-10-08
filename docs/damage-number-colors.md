# Damage-number affinity colors

The exact-image tool prepares grey resisted numbers and bright-red weakness numbers for ordinary, critical and absorbed/healing enemy hits. Neutral damage, neutral healing and GUARD retain their loaded colors. Weakness wins when resistance and weakness both apply, matching the installed affinity flag behavior. Damage and healing amounts, including the live image's 2.5x weakness calculation, stay unchanged.

Prepare without changing the input BIN:

```text
node tools/extra-hacks/build-damage-number-colors-patch.js outputs/damage-number-colors
```

The output contains guarded forward and reversal PPFs, full hashes, inspected areas and verification results. Applying requires explicit approval for this pair; afterwards repeat the command with `--apply`. A changed source hash is rejected. No backup BIN is created or deleted.

The patch changes the existing palette picker at DRA `0x2EAC0–0x2EB0B`, initializes each hit's affinity before immunity/absorption at `0x5F204`, and adds an 80-byte helper at `0x2EB28–0x2EB77`. Reserve unused equipment icon 304; preparation checks current item usage, zeroed space, direct calls, pointers and nearby address loads in DRA and the 57 stage overlays. Existing damage arithmetic and spawn helpers remain unchanged.

F_GAME palette 0x18D becomes red and 0x18E becomes grey, preserving transparency and dark outlines. Healing and critical numbers now use those palettes when their own hit carries weakness or resistance. Absorption by itself keeps the existing healing color.

```text
node tests/damage-number-colors.test.js
```

The checks execute the loaded damage calculation before and after modification, comparing results for physical, elemental and mixed attacks, weakness, resistance, immunity, absorption and critical hits. They also check color selection across number types and flashing frames, entity flag transfer, all existing overlay hooks, palette channels, allowed byte ranges and occupied-space rejection. The builder verifies forward/reversal and both undo hashes, guarded rejection, reopened file equality, sector checksums, unrelated sectors and the unchanged source.

Fresh-boot emulator presentation remains manual: load a memory-card save, enable the Spirit Orb, and check weak/resisted normal, critical and healing numbers, consecutive hits with different affinities, neutral hits and GUARD. Old savestates retain loaded code. This standalone patch does not regenerate the editor catalog or the ASS release; use the skill's BIN-updated workflow when requesting that refresh.
