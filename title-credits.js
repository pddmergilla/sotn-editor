(function (global) {
  "use strict";
  const C = typeof module !== "undefined" && module.exports ? require("./sotn-core.js") : global.SotnCore;
  const URL = "https://pddmergilla.github.io/sotn-editor/";
  const CODE = 0x34250;
  const original = [
    0x340c00d6, 0x34060080, 0x340b0003, 0x340a0064, 0x34090018, 0x34080021,
    0x34070001, 0x34050008, 0x2404ff90, 0x3403000c, 0xa6030008, 0xa60c000a,
    0xa206000c, 0xa204000d, 0x162b0002, 0xa2060018, 0xa20a0018, 0x24840008,
    0x26310001, 0x2a220004, 0xa2050019, 0xa609001a, 0xa608000e, 0xa6070026,
    0xa6050032, 0x8e100000, 0x1440ffef, 0x24630080
  ];
  const credited = original.slice();
  credited[4] = 0x3409001e; credited[7] = 0x34050010; credited[17] = 0x24840010;
  const moved = [
    0x340c0092, 0x34060080, 0x3409001e, 0x34080021, 0x34070001, 0x34050054,
    0x34040090, 0x3403000c, 0xa6030008, 0xa60c000a, 0x30620080, 0xa202000c,
    0x00031202, 0x00491021, 0xa602001a, 0xa204000d, 0xa2060018, 0xa2050019,
    0xa608000e, 0xa6070026, 0x34020008, 0xa6020032, 0x26310001, 0x2a220004,
    0x8e100000, 0x1440ffee, 0x24630080, 0x00000000
  ];

  function pixelOffset(x, y) {
    const tile = Math.floor(x / 256) * 4 + Math.floor(y / 128) * 2 + Math.floor((x % 256) / 128);
    return tile * 8192 + (y % 128) * 64 + Math.floor((x % 128) / 2);
  }
  const pixel = (bytes, x, y) => (bytes[pixelOffset(x, y)] >> ((x & 1) * 4)) & 15;
  function putPixel(bytes, x, y, value) {
    const at = pixelOffset(x, y), shift = (x & 1) * 4;
    bytes[at] = (bytes[at] & ~(15 << shift)) | (value << shift);
  }
  function matches(bytes, words) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return bytes.length >= CODE + words.length * 4 && words.every((word, i) => view.getUint32(CODE + i * 4, true) === word);
  }
  function textLine(bytes, text, centered = false) {
    const line = new Uint8Array(484 * 8), left = centered ? (484 - text.length * 8) / 2 : 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i), gx = 1536 + (c & 15) * 8, gy = ((c >> 4) - 2) * 8;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        line[y * 484 + left + i * 8 + x] = pixel(bytes, gx + x, gy + y) ? 1 : 0;
      }
    }
    return line;
  }
  function shiftRight(line, amount) {
    const shifted = new Uint8Array(line.length);
    for (let y = 0; y < 8; y++) shifted.set(line.subarray(y * 484, (y + 1) * 484 - amount), y * 484 + amount);
    return shifted;
  }

  async function add(disc, changes = []) {
    // Keep edits that share title sectors.
    const effective = changes.length ? await C.DiscImage.open(C.modifiedBlob(disc.file, changes)) : disc;
    const sel = await effective.findPath(["ST", "SEL", "SEL.BIN"]);
    const title = await effective.findPath(["BIN", "F_TITLE1.BIN"]);
    const selBytes = await effective.readFile(sel), titleBytes = await effective.readFile(title);
    const installed = matches(selBytes, credited), relocated = matches(selBytes, moved);
    if (!installed && !relocated && !matches(selBytes, original)) throw new Error("This title screen has unsupported changes; its credits cannot be safely added.");
    if (titleBytes.length !== 262144) throw new Error("This title graphic has an unsupported size.");
    const heading = new Uint8Array(484 * 8);
    // Keep the game's existing title line.
    for (let i = 0; i < 4; i++) {
      const width = i < 3 ? 128 : 100;
      for (let y = 0; y < 8; y++) for (let x = 0; x < width; x++) {
        heading[y * 484 + i * 128 + x] = pixel(titleBytes, relocated ? 1536 + i * 128 + x : installed ? 1664 + x : 128 + x,
          relocated ? 144 + y : 144 + i * (installed ? 16 : 8) + y);
      }
    }
    const assHeading = textLine(titleBytes, "Alternate Scarlet Symphony 2.0", true);
    const centeredAss = heading.every((value, i) => value === assHeading[i]);
    const earlierAligned = shiftRight(assHeading, 12), alignedAss = shiftRight(assHeading, 56);
    const knownAss = centeredAss || heading.every((value, i) => value === earlierAligned[i]) || heading.every((value, i) => value === alignedAss[i]);
    const moveTitle = relocated || knownAss;
    const link = textLine(titleBytes, URL), height = moveTitle ? 84 : 16;
    const line = new Uint8Array(484 * height);
    line.set(knownAss ? alignedAss : heading); line.set(link, (height - 8) * 484);
    // Check earlier editor artwork before moving it.
    if (installed) for (let i = 0; i < 4; i++) for (let y = 0; y < 16; y++) for (let x = 0; x < 128; x++) {
      const at = i * 128 + x;
      const expected = at < 484 ? (y < 8 ? heading : link)[(y % 8) * 484 + at] : 0;
      if (pixel(titleBytes, 1664 + x, 144 + i * 16 + y) !== expected) {
        throw new Error("The title credit area is already in use; its artwork was preserved.");
      }
    }
    const afterTitle = titleBytes.slice(), afterSel = selBytes.slice();
    for (let i = 0; i < 4; i++) for (let y = 0; y < height; y++) for (let x = 0; x < 128; x++) {
      const value = i * 128 + x < 484 ? line[y * 484 + i * 128 + x] : 0;
      const dx = moveTitle ? 1536 + i * 128 + x : 1664 + x;
      const dy = moveTitle ? 144 + y : 144 + i * 16 + y;
      const existing = pixel(titleBytes, dx, dy);
      const earlierArea = installed && dx >= 1664 && dx < 1792 && dy >= 144 && dy < 208;
      if ((relocated && y >= 8 && existing !== value) || (!relocated && !earlierArea && existing)) {
        throw new Error("The title credit area is already in use; its artwork was preserved.");
      }
      putPixel(afterTitle, dx, dy, value);
    }
    const view = new DataView(afterSel.buffer);
    (moveTitle ? moved : credited).forEach((word, i) => view.setUint32(CODE + i * 4, word, true));
    const merged = new Map(changes.map(change => [change.start, change]));
    for (const [record, after] of [[sel, afterSel], [title, afterTitle]]) {
      const before = await disc.readFile(record);
      for (const change of await C.changedSectors(disc, record, before, after)) merged.set(change.start, change);
    }
    return [...merged.values()].sort((a, b) => a.start - b.start);
  }

  const api = {add, URL};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.SotnTitleCredits = api;
})(typeof window !== "undefined" ? window : globalThis);
