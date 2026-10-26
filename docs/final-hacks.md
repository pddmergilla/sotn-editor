# Alternate Scarlet Symphony -Final- changes

[← Back to the README](../README.md)

The main BIN gained 30 features after ASS 2.0.10. This page lists them for the editor v8.0 / ASS -Final- release and the Extra Hacks update. Balance changes (stat, cost, DEF/HP/attack values, element tables) are left out.

`node tools/ass2/build-final-hacks.js` reads ASS 2.0.10 (`outputs/ref/ASS-2.0.10.bin`, or vanilla plus the 2.0.10 PPF from git history), then assigns every byte that differs in the main BIN to the newest applied PPF that wrote it. It searches next to the main BIN, `outputs/`, Downloads and the Documents/Codex session outputs. The groups are defined in `tools/ass2/final-hacks.js`. All boss AI changes share one group, all normal-enemy AI changes another, and so do the weapons and the items. A later retune of a feature's own bytes stays with that feature. When a feature replaced bytes that another wrote, it is built on top of that feature and lists it under **Requires**.

For each feature it writes `ASS-Final-<feature>.ppf` (2.0.10 plus requirements → with the feature) and `Reverse-ASS-Final-<feature>.ppf` (current BIN → without it), both guarded PPF3 with undo data and repaired EDC/ECC, plus `specs/<id>.json` with Extra Hacks-style edit runs. Output goes to `MainBIN/ASS-Final-Hacks/` with a README and `ASS-Final-Hacks.verification.json`. The main BIN is only read.

Checks: 2.0.10 plus every feature in install order plus the excluded bytes reproduces every changed sector of the main BIN. Each forward and reversal PPF applies with its guards, writes valid EDC/ECC and undoes exactly. Chaining all forward PPFs from disk reproduces the main BIN except the excluded bytes. Patches that share a sector carry EDC/ECC for their own target only. When you chain them outside the editor, use a patcher that skips undo checks, then repair sector checksums. None of this was played in an emulator.

Built on 2026-10-26 against main BIN `7156BE53B54C7FCC7AED1A87EA415CF12357C29AF2D3844ED9F9B673D1E624ED`. Rerun the builder after further BIN changes. Every hack below can be toggled in the Extra Hacks tab ([details](extra-hacks.md#ass--final--hacks)). Excluded: balance 2,982 bytes, map/pickup/text content 34,559 bytes, unattributed 2 bytes. 197 bytes that no PPF wrote were joined to the neighbouring feature in the same file. They are listed under `attributedByProximity` for review.

### Boss AI

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Boss AI pack** | Bosses fight with new AI and new attack patterns. | — | 221,642 | `ASS-Final-Boss-AI-pack.ppf` |

### Enemy AI

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Enemy AI pack** | Enemies fight with new AI and new attack patterns. | — | 11,048 | `ASS-Final-Enemy-AI-pack.ppf` |

### Weapons and specials

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **New Weapons and Specials** | New weapons, and new special moves for many existing ones. | — | 47,077 | `ASS-Final-New-Weapons-and-Specials.ppf` |

### Familiars

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Dawn familiar** | Reawakened's Dawn familiar joins the castle, with its own menu icon. | — | 34,023 | `ASS-Final-Dawn-familiar.ppf` |
| **Ouroboros familiar** | Reawakened's Ouroboros familiar joins the castle and grows stronger with CON. | Dawn familiar | 35,622 | `ASS-Final-Ouroboros-familiar.ppf` |
| **Sword Familiar QCF swap** | The Sword Familiar can call in another familiar for a while. | — | 1,525 | `ASS-Final-Sword-Familiar-QCF-swap.ppf` |
| **Familiars gain a level per kill** | Familiars level up with every kill. | — | 5 | `ASS-Final-Familiars-gain-a-level-per-kill.ppf` |

### Items, relics and shops

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Items, relics and shops** | New and reworked items, relics and shop goods, including the item slots for the L2 shortcut and the Boss CRush mode. | New Weapons and Specials, Familiars gain a level per kill, No more game over | 9,337 | `ASS-Final-Items-relics-and-shops.ppf` |

### Alucard abilities and spells

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Dark Metamorphosis rework** | Dark Metamorphosis returns control at once, keeps Alucard's form and is safe at save points. | — | 27 | `ASS-Final-Dark-Metamorphosis-rework.ppf` |
| **Stat-scaled buffs** | Dark Metamorphosis, the buff potions and the Faerie's buffs grow with Alucard's stats. | — | 372 | `ASS-Final-Stat-scaled-buffs.ppf` |
| **Blue Metalmorphosis spell** | Transform into the Axe Lord using a spell. | — | 1,717 | `ASS-Final-Blue-Metalmorphosis-spell.ppf` |
| **Deterministic level growth** | Alucard's level-up gains are fixed instead of random. | — | 15 | `ASS-Final-Deterministic-level-growth.ppf` |
| **Down+X dropkick priority** | Down + jump always dropkicks, even after Sky Walker jumps. | — | 8 | `ASS-Final-Down-X-dropkick-priority.ppf` |
| **Air control and hurt recovery** | Better control in the air after leaving a ledge, transforming or getting hit. | — | 550 | `ASS-Final-Air-control-and-hurt-recovery.ppf` |
| **Bat form and Wing Smash** | Bat form flies faster, and Power of Mist makes Wing Smash unlimited. | — | 69 | `ASS-Final-Bat-form-and-Wing-Smash.ppf` |
| **Heart Refresh shortcut** | Heart Refresh runs in real time from the item shortcut. | New Weapons and Specials, Familiars gain a level per kill, No more game over, Items, relics and shops | 7,121 | `ASS-Final-Heart-Refresh-shortcut.ppf` |
| **Hellfire casts in place** | Hellfire casts where Alucard stands, with a shorter windup. | — | 48 | `ASS-Final-Hellfire-casts-in-place.ppf` |
| **Spells and subweapons scale with INT** | Spells, form attacks and subweapons grow stronger with INT. | — | 253 | `ASS-Final-Spells-and-subweapons-scale-with-INT.ppf` |

### Status and damage rules

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Petrification rework** | Petrification is shorter and harder to wiggle out of, and hits while petrified are spaced out. | — | 127 | `ASS-Final-Petrification-rework.ppf` |
| **Poison damage over time** | Poison drains HP over time. | — | 135 | `ASS-Final-Poison-damage-over-time.ppf` |
| **Percent DEF** | DEF reduces damage by a percentage. Brings the current DEF of all equipment and enemies with it. | Damage number colors: weak and resist | 1,197 | `ASS-Final-Percent-DEF.ppf` |

### Menus and presentation

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **RES/WEAK element line** | The main menu shows Alucard's resistances and weaknesses. | — | 409 | `ASS-Final-RES-WEAK-element-line.ppf` |
| **Minimap setting and item shortcut button** | System gains a setting to show or hide the minimap, and Button Config gains a remappable item shortcut. | — | 388 | `ASS-Final-Minimap-setting-and-item-shortcut-button.ppf` |
| **Damage number colors: weak and resist** | Weakness and resisted hits get their own damage number colors (adds to Damage Number Colors). | — | 40 | `ASS-Final-Damage-number-colors-weak-and-resist.ppf` |
| **Title: Alternate Scarlet Symphony -Final-** | The title screen reads Alternate Scarlet Symphony -Final-. Always included in the full ASS -Final- patch. | — | 417 | `ASS-Final-Title-Alternate-Scarlet-Symphony-Final.ppf` |

### World and story

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **No more game over** | Death just brings Alucard back to the last save point. | — | 275 | `ASS-Final-No-more-game-over.ppf` |
| **Clock Tower gear doors always open** | Both Clock Tower gear doors stay open. | — | 32 | `ASS-Final-Clock-Tower-gear-doors-always-open.ppf` |
| **Richter rescue cutscene fixes** | The Richter rescue cutscene plays correctly, with its voices. | Boss AI pack | 132 | `ASS-Final-Richter-rescue-cutscene-fixes.ppf` |
| **Prologue skip** | New Alucard games skip the Richter prologue and start with the story scroll. | — | 165 | `ASS-Final-Prologue-skip.ppf` |

### Richter Mode

| Feature | What it does | Requires | Bytes | Patch |
|---|---|---|---:|---|
| **Richter Mode overhaul** | Playable Richter rebuilt: Rest levels, growth from collecting, relic abilities, new moves, a new pause menu with a guide, and every boss Alucard faces. | Boss AI pack, New Weapons and Specials, Familiars gain a level per kill, No more game over, Items, relics and shops, Stat-scaled buffs, Damage number colors: weak and resist, Percent DEF | 29,766 | `ASS-Final-Richter-Mode-overhaul.ppf` |
