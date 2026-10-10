(function (global) {
  "use strict";
  const BASE = 0x800A0000, ROW = 217, TABLE = 0x4B04, DATA = 0x15100, MARK = DATA + 52;
  const START = 0x15140, SLOT = 0x50;
  const ICE_ROW = 218, ICE_DATA = 0x18D00, ICE_MARK = ICE_DATA + 52, ICE_START = 0x18D40, ICE_SLOT = 0x70;
  const i = (op, rs, rt, value) => ((op << 26) | (rs << 21) | (rt << 16) | (value & 65535)) >>> 0;
  const j = address => (0x08000000 | (address >>> 2 & 0x3FFFFFF)) >>> 0;
  const sites = [
    [0x6ECA0, 1, false, [0x3C01800A, 0x00220821]],
    [0x6EF18, 17, true, [0x00438821, 0x02409821]],
    [0x6EF58, 1, false, [0x3C01800A, 0x00220821]],
    [0x6F014, 17, true, [0x00468821, 0x02409821]],
    [0x6F0FC, 17, true, [0x00468821, 0x02409821]],
    [0x6F128, 1, false, [0x3C01800A, 0x00220821]],
    [0x6F1B0, 17, true, [0x00448821, 0x02409821]],
    [0x6F3CC, 1, false, [0x3C01800A, 0x00220821]],
    [0x5E764, 6, true, [0x00433021, 0x24C80030], true],
    [0x5E830, 1, false, [0x3C01800A, 0x00220821]],
    [0x54D64, 1, false, [0x3C01800A, 0x00240821]],
    [0x54E08, 1, false, [0x3C01800A, 0x00220821]]
  ];
  const bytes = words => Uint8Array.from(words.flatMap(w => [w & 255, w >>> 8 & 255, w >>> 16 & 255, w >>> 24 & 255]));
  function edits(version = 1) {
    const result = [{off: MARK, expect: Uint8Array.of(87, 83, 88, 49)}];
    if (version === 2) result.push({off: ICE_MARK, expect: Uint8Array.of(87, 83, 88, 50)});
    sites.forEach(([off, reg, pointer, original, secondAfter], n) => {
      const at = version === 2 ? ICE_START + n * ICE_SLOT : START + n * SLOT;
      const source = BASE + ROW * 52 + (pointer ? TABLE : 0);
      const target = BASE + DATA - (pointer ? 0 : TABLE);
      const words = [original[0], ...(secondAfter ? [] : [original[1]]),
        i(9, 29, 29, -8), i(43, 29, 24, 0), i(43, 29, 25, 4),
        i(15, 0, 24, source >>> 16), i(13, 24, 24, source), i(5, reg, 24, version === 2 ? 5 : 3), 0,
        i(15, 0, 25, target >>> 16), i(13, 25, reg, target),
        ...(version === 2 ? [i(4, 0, 0, 6), 0, i(9, 24, 24, 52), i(5, reg, 24, 3), 0,
          i(15, 0, 25, (BASE + ICE_DATA - (pointer ? 0 : TABLE)) >>> 16),
          i(13, 25, reg, BASE + ICE_DATA - (pointer ? 0 : TABLE))] : []),
        i(35, 29, 24, 0), i(35, 29, 25, 4), i(9, 29, 29, 8),
        ...(secondAfter ? [original[1]] : []), j(BASE + off + 8), 0];
      const body = new Uint8Array(version === 2 ? ICE_SLOT : SLOT); body.set(bytes(words));
      result.push({off, expect: bytes([j(BASE + at), 0]), original: bytes(original)});
      result.push({off: at, expect: body});
    });
    return result;
  }
  function matches(b, edit) { return edit.expect.every((v, n) => b[edit.off + n] === v); }
  function detect(b, table) {
    const newer = edits(2);
    const version = matches(b, newer[1]) || newer.filter(e => e.original).some(e => matches(b, e)) ? 2 : 1;
    const guards = version === 2 ? newer : edits();
    const present = version === 2 || matches(b, guards[0]) || guards.filter(e => e.original).some(e => matches(b, e));
    if (!present) return [];
    if (table !== TABLE || !guards.every(e => matches(b, e))) throw new Error("The extended weapon special is incomplete or changed.");
    return [{index: ROW, off: DATA, guards}, ...(version === 2 ? [{index: ICE_ROW, off: ICE_DATA, guards}] : [])];
  }
  const api = {BASE, ROW, TABLE, DATA, MARK, START, SLOT, ICE_ROW, ICE_DATA, ICE_MARK, ICE_START, ICE_SLOT, sites, edits, detect};
  global.SotnWeaponSpecialRows = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
