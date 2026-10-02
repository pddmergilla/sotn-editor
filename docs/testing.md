# Tests

[← Back to the README](../README.md)

Run each file with Node.js 22 or later from the repository root:

```text
node tests/core.test.js
node tests/disc-stage.test.js
node tests/copy-tile.test.js
node tests/entity-editor.test.js
node tests/entity-templates.test.js
node tests/entity-repack.test.js
node tests/room-gfx.test.js
node tests/stats-core.test.js
node tests/prize-drops.test.js
node tests/stats-bin.test.js
node tests/extra-hacks-ui.test.js
node tests/ass2.test.js
```

`ass2.test.js` checks the PPF parser and windowed builder on a synthetic image, that the shipped PPF matches the release data, and, when the images are present, that vanilla builds to the exact ASS 2.0 BIN.

`extra-hacks-ui.test.js` runs its unit checks always. With the reference images present it also checks:

- detection on vanilla, ASS 2.0 and ASS 1.3.1;
- add and remove round trips that must restore the files byte for byte;
- removing each hack on its own, and Healing items use Hearts off then on (costs and the L2 shortcuts switch to MP and back; adding it in a second build gives the same bytes as adding everything at once);
- a simulated later ASS build with retuned values and edited data;
- that another mod (the Reawakened PPF) is rejected.

Set `SOTN_VANILLA_BIN`, `SOTN_ASS_BIN`, `SOTN_ASS_OLD_BIN` and `SOTN_OTHER_PPF` to choose the files. `stats-bin.test.js` needs real disc images and skips without them; `prize-drops.test.js` runs its synthetic checks either way. Set `SOTN_BIN` to a US BIN and `SOTN_VANILLA_BIN` to an unmodified US Track 1 to choose which images it checks.
