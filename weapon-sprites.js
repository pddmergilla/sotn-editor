(function (global) {
  "use strict";
  const K = global.SotnStatsCore || (typeof require === "function" ? require("./stats-core.js") : null);
  const BASE = 0x8017A000, STRIDE = 0x7000, GFX_SIZE = 0x4000, CODE_SIZE = 0x3000;
  // Palette choices in the US weapon overlays.
  const COUNTS = [5, 2, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 6, 2, 2, 1, 2, 2, 2, 2, 2, 4, 2, 2, 2, 2, 2, 2, 2, 2,
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 5, 1, 1, 4, 2, 5, 1, 5, 3, 1, 1, 1, 5, 1, 5, 1];
  const COPY = [0x27BDFFE0, 0x3C038018, null, 0x00042080, 0xAFBF0018, 0x3C018018, 0x00240821, null,
    0x00031040, 0x00431021, 0x00021200, 0x3C038007, 0x2463EDCC, 0x10A00014, 0x00431821, 0x00002021,
    0x94A20000, 0x24A50002, 0x24840001, 0xA4620000, 0x28820180, 0x1440FFFA, 0x24630002];
  const COPY29 = [0x27BDFFE0, 0xAFBF0018, 0x3C038018, null, 0, 0x00031040, 0x00431021, 0x00021200,
    0x3C038007, 0x2463EDCC, 0x00432821, 0x00042080, 0x3C018018, 0x00240821, null, 0,
    0x10600014, 0x00002021, 0x94620000, 0, 0xA4A20000, 0x24630002, 0x24840001, 0x28820180,
    0x1440FFF9, 0x24A50002];

  function paletteInfo(bytes, overlay, selection) {
    const fail = reason => ({ok: false, reason});
    if (!bytes) return fail("Weapon artwork is unavailable in this image.");
    if (!Number.isInteger(overlay) || overlay < 0 || overlay >= COUNTS.length || (overlay + 1) * STRIDE > bytes.length)
      return fail("This weapon overlay is not supported by the preview.");
    const code = bytes.subarray(overlay * STRIDE + GFX_SIZE, (overlay + 1) * STRIDE);
    const loader = K.u32(code, 0x1C) - BASE;
    const pattern = overlay === 29 ? COPY29 : COPY;
    if (loader < 0x40 || loader + pattern.length * 4 > CODE_SIZE ||
        !pattern.every((word, i) => word === null || K.u32(code, loader + i * 4) === word))
      return fail("This weapon's palette loader is not recognized.");
    const loadIndex = overlay === 29 ? 14 : 7, handIndex = overlay === 29 ? 3 : 2;
    const lw = K.u32(code, loader + loadIndex * 4), hand = K.u32(code, loader + handIndex * 4);
    if ((lw >>> 16) !== (overlay === 29 ? 0x8C23 : 0x8C25) || (hand >>> 16) !== 0x8C63)
      return fail("This weapon's palette table is not recognized.");
    const table = 0x80180000 + K.s16(code, loader + loadIndex * 4) - BASE;
    const handOffset = 0x80180000 + K.s16(code, loader + handIndex * 4) - BASE;
    const count = COUNTS[overlay];
    if (table < 0x40 || table + count * 4 > CODE_SIZE || handOffset < 0x40 || handOffset + 4 > CODE_SIZE || K.u32(code, handOffset) !== 0)
      return fail("This weapon's palette table is not recognized.");
    if (!Number.isInteger(selection) || selection < 0 || selection >= count)
      return fail(`Palette ${selection} is outside this overlay's ${count} palette choice${count === 1 ? "" : "s"}; it may read invalid game data.`);
    const pointer = K.u32(code, table + selection * 4);
    if (!pointer) return fail("This palette loads no colors; the game keeps the hand's previous colors.");
    const offset = pointer - BASE;
    if (offset < 0x40 || offset + 24 * 32 > CODE_SIZE) return fail("This palette's color data is outside the supported overlay.");
    return {ok: true, code, offset, count, pointer};
  }

  function renderSheet(bytes, overlay, selection, row = 0) {
    const info = paletteInfo(bytes, overlay, selection);
    if (!info.ok) return info;
    if (!Number.isInteger(row) || row < 0 || row >= 24) return {ok: false, reason: "Choose a color row from 0 to 23."};
    const colors = Array.from({length: 16}, (_, i) => K.decodeColor(K.u16(info.code, info.offset + row * 32 + i * 2)));
    const rgba = new Uint8ClampedArray(256 * 128 * 4), start = overlay * STRIDE;
    for (let i = 0; i < 256 * 128; i++) {
      const byte = bytes[start + (i >> 1)], index = i & 1 ? byte >> 4 : byte & 15;
      rgba.set(colors[index], i * 4);
    }
    return {ok: true, rgba, colors, count: info.count, pointer: info.pointer};
  }

  const api = {paletteInfo, renderSheet};
  global.SotnWeaponSprites = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
