# Duplichaos

`node tools/items/build-duplichaos-patch.js <output-directory>` prepares an exact-image forward/reversal PPF pair without changing the original ASS 2.0 BIN. `--apply` requires the user's explicit approval of that prepared pair and checks its full source hash.

Duplicator (accessory 84) becomes **Duplichaos**, described as "Gain the power of Chaos". It keeps the Duplicator icon and palette (250). ATK, DEF, STR, CON, INT and LCK are 0. It has no weaknesses, resistances, immunities or absorptions.

Duplichaos acts like Mystic Pendant. The HUD's MP regeneration adds 30 MP on the pendant's tick (`g_GameTimer & 0x3F == 0x1F`, every 64 frames), and the game's existing clamp then limits MP to max. The existing regeneration gate also applies. Either accessory slot works. Two equipped give the same +30, as two Mystic Pendants give their single bonus. Mystic Pendant keeps its ASS +3 and stacks. Base regeneration (+1 every 32 frames) and ASS's CON-based HP regeneration are unchanged.

The **Infinite items** effect (`ReduceWeapon`) now checks "No item" (`0xFFFF`), so consumables are used up normally while Duplichaos is equipped. The Stats Editor still lists that effect and can assign it to another item.

The 88-byte helper sits in verified blank equipment-icon space at DRA `0x2F040-0x2F097`, inside icon 314. Reserve icon 314; warp cards keep icons 311-313. The only hook is the jal at `0x61DA8`, which replaces the clamp's two-word `&g_Status.mp` load; the helper reloads that address before returning. The Stats Editor reads the new name, description and stats directly but does not list the +30 MP check.

`node tests/duplichaos.test.js` executes the actual HUD regeneration and ASS's regeneration helper through the MP clamp across both gate states, timer phases, accessory pairs and MP states. It also runs `ReduceWeapon` for both hands, consumable and permanent rows, and item counts. The checks cover unchanged Mystic Pendant and unequipped results, preserved registers, occupied-space, pointer and icon rejection, and unchanged unrelated DRA fields and bytes. The builder verifies both PPFs and their embedded undo data by full image hashes, repaired sector checksums, export/reopen and unchanged input bytes.

Fresh-boot emulator acceptance remains required: load a memory-card save, check the menu name, description, icon and zero stats, then equip Duplichaos in either slot and watch MP refill by about 30 per second. Also test it together with Mystic Pendant and confirm that food is used up while it is equipped. Instruction checks do not prove gameplay.
