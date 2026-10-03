# SOTN Editor

Build your own *Castlevania: Symphony of the Night* ROM hack in the browser. Edit maps, stats, shops and gameplay, then save a new BIN or a PPF3 patch.

**[Open SOTN Editor](https://pddmergilla.github.io/sotn-editor/)**

Everything runs locally. You open your own US PlayStation disc image, and the editor reads it in the browser. Nothing is uploaded, no game assets are included, and your original file is never overwritten.

## Play Alternate Scarlet Symphony 2.0

This editor is also home to **Alternate Scarlet Symphony 2.0**, a hard-hitting remix of Symphony of the Night. It has retuned combat, new enemy placements, bosses that won't flinch, an all-new Richter fight and a rebuilt arsenal.

You can get it two ways:

- **Build it in the browser.** Open your vanilla US BIN with **Open SOTN BIN**, go to the **Alternate Scarlet Symphony 2.0** tab, and select **Build**. The editor checks your BIN against vanilla before it writes anything.
- **Patch it yourself.** Download [`ass2/Alternate-Scarlet-Symphony-2.0.ppf`](ass2/Alternate-Scarlet-Symphony-2.0.ppf) and apply it to `Castlevania - Symphony of the Night (USA) (Track 1).bin` with any PPF3 patcher.

Keep the original Track 2 next to the patched Track 1. The tab can also download a matching `.cue`. [More about the ASS 2.0 tab](docs/ass2.md).

## What you can edit

| Tab | What it does |
|---|---|
| **Map Editor** | Paint foreground and background tiles with the stage's real artwork. Edit collision, room entities, item drops, relic orbs and object graphics banks. [Details](docs/map-editor.md) |
| **Stats Editor** | Change Alucard's and Richter's starting stats and gear, pickups and healing, spells, subweapons, familiars, enemies, every weapon, armor and accessory, weapon movesets and special effects. [Details](docs/stats-editor.md) |
| **Library Shop Editor** | Choose what the Master Librarian sells and when, set prices, and edit the relic and magic scrolls, the gems he buys, tactics prices and the menu. |
| **Extra Hacks** | Turn on or off 30 gameplay hacks (one is still a work in progress), from a MiniMap and Fast Warp to an all-new Richter AI. They can be added to vanilla or removed from Alternate Scarlet Symphony. [Details](docs/extra-hacks.md) |
| **Alternate Scarlet Symphony 2.0** | Read about the mod and download it, or build it from your vanilla BIN. [Details](docs/ass2.md) |

Every edit can be undone with the toolbar Undo button or Ctrl+Z.

## Quick start

1. Open the [hosted editor](https://pddmergilla.github.io/sotn-editor/) in desktop Chrome, Edge or Firefox.
2. Select **Open SOTN BIN** and choose your disc image: a 2352-byte sector BIN or a 2048-byte sector ISO.
3. Make your changes in any tab.
4. Select **Build BIN** to save a new image, or **Export PPF3** to save a patch with only your changes.

Select **▶ Test in browser** to run a patched copy without overwriting the source. This also works before making any edits. The separate play tab supports controllers, memory cards, and savestates; see [browser testing](docs/browser-testing.md).

### Run it locally

You need [Node.js](https://nodejs.org/) 22 or later. In the repository folder, run:

```text
node serve.js
```

Then open `http://127.0.0.1:8765` in desktop Chrome, Edge or Firefox. Serve the folder like this rather than opening `index.html` from disk, because the ASS 2.0 build needs the page to be served over http.

## Compatibility

- Built for the US PS1 release. It also reads the Alternate Scarlet Symphony 1.3.1 and 2.0 layouts.
- An already modded BIN can be the input. Exports then contain only the changes made in the editor.
- Data the editor doesn't recognize is rejected rather than guessed. For example, Extra Hacks locks itself on images from other mods.
- Raw 2352-byte sectors get recalculated EDC/ECC, so the output stays a valid disc image.
- Chrome and Edge use native open/save dialogs; Firefox opens files with a standard file picker and saves BINs and patches as downloads. The legacy Asset folder tools require Chrome or Edge.

## For developers

The editor is plain HTML, CSS and JavaScript with no build step. Browser testing loads the pinned EmulatorJS 4.2.3 runtime and PCSX-ReARMed core from its CDN.

| Path | Contents |
|---|---|
| `index.html`, `app.js`, `styles.css` | Page layout, tabs, disc loading and export |
| `play*.js`, `play.html`, `play.css` | Patched-copy handoff, browser emulator, and saved test copies |
| `sotn-core.js`, `disc-stage.js` | ISO9660 reading, stage overlays, EDC/ECC, PPF3 output |
| `entity-*.js` | Entity catalog, templates and editing model |
| `stats-*.js`, `shop-*.js` | Stats and Library shop models and UI |
| `extra-hacks-ui.js`, `extra-hacks-catalog.js` | Hack detection and toggling; the catalog is generated |
| `ass2-core.js`, `ass2-ui.js`, `ass2/` | ASS 2.0 tab, release PPF and release data |
| `tools/extra-hacks/` | Hack specs and `build_catalog.py`, which generates the catalog |
| `tools/ass2/build-release.js` | Rebuilds the ASS 2.0 PPF and release data from the BINs |
| `tests/` | Node test scripts |

Run the tests with `node tests/<name>.test.js`. Some checks need real disc images and skip without them. See [docs/testing.md](docs/testing.md) for the full list and the environment variables that point to your images.

To regenerate generated files:

- **After changing a hack spec**, run `python tools/extra-hacks/build_catalog.py`. It needs the vanilla, ASS 1.3.1 and ASS 2.0 BINs.
- **After changing the ASS 2.0 BIN**, run `node tools/ass2/build-release.js`.

## Support

If you enjoy the editor or Alternate Scarlet Symphony, you can [donate ♥️ on Buy Me a Coffee](https://buymeacoffee.com/nukesheart).

## Credits

- Game data structures, names and function references come from [Xeeynamo/sotn-decomp](https://github.com/Xeeynamo/sotn-decomp).
- Alternate Scarlet Symphony 2.0 builds on Alternate Scarlet Symphony 1.3.1 and the BigNumbers rebalance.
- The MiniMap, Fast Warp and Damage Number Colors hacks are ported from Reawakened.

*Castlevania: Symphony of the Night* is © Konami. This is an unofficial fan project, not affiliated with or endorsed by Konami. You need your own legally obtained copy of the game.

## License

[GNU General Public License v3.0](LICENSE).
