# Map Editor

[← Back to the README](../README.md)

Select **Open SOTN BIN**, choose a 2048-byte sector ISO or 2352-byte sector BIN, then choose a castle area and room. The editor reads the selected stage overlay and graphics directly from `ST/<AREA>/` in the image. No decomp asset folder or separate `F_<AREA>.BIN` is needed. An already modded BIN can be the input; the PPF will contain only differences made in this editor relative to that BIN.

Paint foreground or background tile IDs with the real stage art. Entities mode lists the current room's placements by area header name, highlights a selected marker, and edits its type and room-local X/Y. Named types come from the matching `EntityID` enum in [Xeeynamo/sotn-decomp](https://github.com/Xeeynamo/sotn-decomp).

In Entities mode, **Graphics and templates from room** selects another room in the same stage. The current room then uses that room's object graphics-bank ID, and the Add and Change Type menus show templates found in the selected room. **Current graphics** restores the current room's original bank and v5's same-bank template list. This changes object graphics, not the map's tile art. Changing banks may make existing objects incompatible; the editor warns when an entity ID is absent from all original rooms using the chosen bank. Test the result in-game.

A template supplies entity ID, upper flags, and parameters. A new instance gets an unused stage entity slot and a separate persistence index when the template uses one. The existing entity's position and slot are retained on Change Type. `E_PRIZE_DROP` params select a direct `ITEMDROP` ID; `E_EQUIP_ITEM_DROP` params select equipment using IDs beginning at `0x80`; `E_PERSISTENT_ITEM_DROP` params are a stage-local `PrizeDrops[]` index.

**Holds item** (Persistent Item Drop) chooses what the pickup gives. It edits the stage's `PrizeDrops[]` entry for the pickup's slot (its Params), found from the code of `EntityPersistentItemDrop` in each stage overlay. The list is grouped: **Progression** (Life Max-Up, Heart Max-Up, Holy glasses, Spike Breaker, Gold Ring, Silver Ring), hearts and gold, subweapons, hand items, head gear, armor, cloaks, and accessories, using the loaded BIN's item names. Each slot has its own "collected" castle flag, so placements that share a slot hold the same item and disappear together; the panel says when that happens. Breakable walls and scripted objects can also spawn a slot. Relics are not persistent drops: a **Relic Orb** has its own **Holds relic** list (Params low 15 bits). Place each relic once; an orb for a relic you already own disappears. The entity list shows what every pickup and orb holds. Both apply with **Apply Changes** and can be undone.

Entity coordinates are local to the room. Drag a marker or edit its local X/Y to move it. Add and Duplicate are available only when the fixed stage layout-data span can hold the changed X/Y banks and a free entity slot exists. The editor reuses byte-identical banks and updates their pointers; it does not grow the stage file. Asset-folder layouts do not support insertion because their BIN capacity is unknown.

**Copy Tile** lets you drag a rectangle of tiles and copies it when you release the left mouse button. The starting tile chooses the visible foreground or background layer, and the entire rectangle comes from that layer, including empty tiles. A click still copies one tile. The button turns off after copying and switches the paint layer to match.

The copied chunk appears as a preview under the mouse, with its top-left tile at the cursor. Click or drag to paint it repeatedly. At the map edges, only tiles inside the layer are painted. Choose a palette tile, enter a Tile ID, or change the paint layer to return to a single tile. Copied chunks can be used in other rooms with the same tile definitions; changing to incompatible tile definitions clears the chunk.

In Collision mode, choose a layer and use **Copy Collision** to sample a tile's collision value from the next map click. It then turns off, leaving that value ready to paint. Esc cancels either copy mode. Right-drag the map view to pan in any mode.

Use the up/down buttons beside zoom to move through tall rooms. Ctrl+C arms Copy Tile outside text fields; Esc cancels it.

Use the toolbar Undo button or Ctrl+Z to reverse edits. A tile brush stroke is one undo step. Undo history is cleared when opening another BIN or saving asset-folder edits.

**Build BIN** writes a new image with the edits. **Export PPF3** writes a PPF 3.0 patch against the loaded image. The source file is never overwritten. For raw 2352-byte sectors, changed sectors receive updated Mode 1 or Mode 2 Form 1 EDC/ECC before either output is made.

The **Asset folder tools** menu keeps the older decomp asset-folder workflow available separately.

## Scope and limits

- Stage layout parsing follows the PS1 stage header, rooms, layers, tile definitions, and 53-entry entity layout table documented by [Xeeynamo/sotn-decomp](https://github.com/Xeeynamo/sotn-decomp/tree/master/tools/sotn-assets/assets).
- Named entity types are taken from the matching local stage header; IDs without a matching name are never labeled as enemies.
- The source-room selector offers only entities originally placed in that source room. It does not import enemies from other stages, and matching a graphics-bank ID does not guarantee that every scripted condition or sprite will behave identically in another room.
- v5.1 changes the stage room's object graphics-bank ID; it does not copy a graphics bank or tile art into the image. The selected bank must already exist in the loaded stage.
- Added entities use stage slots below 96 to avoid the common dynamic entity pools. The editor rejects insertion when no slot or fixed layout-data space remains.
- Room resizing and stage-file growth are not supported.
- Special stage effects and animated or runtime changed tiles are not simulated.
- The parser was checked against a US disc image and a modded variant; in-memory tile, collision, entity, and PPF3 edits round tripped on both. Verify a saved BIN and PPF in your emulator before distributing a patch.
