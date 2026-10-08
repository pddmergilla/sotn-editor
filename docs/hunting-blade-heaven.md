# Hunting Blade: Heaven Sword attack

The Hunting Blade QCF special uses Heaven Sword's single flying attack, artwork,
return and afterimages. It keeps the existing private row 169, including its
damage, MP cost, element, hit cooldown and other combat settings. The inspected
image names this weapon `Hunter sword` (item 94), with 460 special damage and
5 MP. This patch does not rename it.

The normal slash keeps its original artwork, animation, hitboxes and stats.
Heaven Sword (119), Hell Blade (118), and the dual-Heaven-Sword special (202)
keep their own settings. This uses the single flying attack, not the dual combo.

The patch puts the normal slash into reviewed empty space in overlay 13 and
adds it to unused artwork space. Its sprite bank and palette rows are separate
from the flying attack. Hunting Blade loads palette choice 1; original weapons
keep choice 0. Native Heaven Sword attack, return, afterimage and combo code
remain unchanged. Overlay 0 and every other weapon overlay remain unchanged.

The editor still discovers row 169 from the weapon's QCF link. Special damage
and MP edits affect only this row; normal damage and Heaven Sword stay separate.

## Prepare and check

```text
node tests/hunting-blade-heaven.test.js
node tools/weapons/build-hunting-blade-heaven-patch.js <output-directory>
```

`SOTN_ASS_BIN` selects another input image. Preparation checks the live source,
both installed weapon signatures and all occupied-space guards, then creates
forward and reversal PPFs with block checks and embedded undo. It verifies both
directions and both undo paths, full-image hashes, changed-sector checksums,
unchanged unrelated sectors, and editor discovery after export/reopen.
`verification.json` and the output README record all hashes and source revisions.
Preparation leaves the original BIN unchanged and creates no backup BIN.

After explicit approval of the prepared pair:

```text
node tools/weapons/build-hunting-blade-heaven-patch.js <output-directory> --apply
```

Application checks the recorded full source hash, both patch hashes and every
guarded byte before writing only the verified sectors. It verifies the live
result and exact reversal afterward. A changed source requires preparing and
reviewing a new pair.

The test follows actual instructions for both hands, facing directions, normal
slash poses, the native flying attack through its return, afterimage requests
and fading, palette loading, private tuning, QCF/MP/chain limits and rejection
of changed code. Rendering and game services are simulated.

## Gameplay acceptance

Fresh-boot the patched image and load a memory-card save; an old savestate can
retain old weapon code. Check normal slashes, QCF throws, flying artwork and
afterimages, return/rethrow, both hands and directions, insufficient MP, private
stat edits, menus, equipment changes and room transitions. Check the original
Heaven Sword, Hell Blade, dual-sword combo and other normal swords. Visuals and
gameplay remain unverified until these checks are completed.
