(function (global) {
  "use strict";
  const BASE = 0x800A0000, ROW = 217, TABLE = 0x4B04, DATA = 0x15100, MARK = DATA + 52;
  const START = 0x15140, SLOT = 0x50;
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
  function edits() {
    const result = [{off: MARK, expect: Uint8Array.of(87, 83, 88, 49)}];
    sites.forEach(([off, reg, pointer, original, secondAfter], n) => {
      const at = START + n * SLOT;
      const source = BASE + ROW * 52 + (pointer ? TABLE : 0);
      const target = BASE + DATA - (pointer ? 0 : TABLE);
      const words = [original[0], ...(secondAfter ? [] : [original[1]]),
        i(9, 29, 29, -8), i(43, 29, 24, 0), i(43, 29, 25, 4),
        i(15, 0, 24, source >>> 16), i(13, 24, 24, source), i(5, reg, 24, 3), 0,
        i(15, 0, 25, target >>> 16), i(13, 25, reg, target),
        i(35, 29, 24, 0), i(35, 29, 25, 4), i(9, 29, 29, 8),
        ...(secondAfter ? [original[1]] : []), j(BASE + off + 8), 0];
      const body = new Uint8Array(SLOT); body.set(bytes(words));
      result.push({off, expect: bytes([j(BASE + at), 0]), original: bytes(original)});
      result.push({off: at, expect: body});
    });
    return result;
  }
  function matches(b, edit) { return edit.expect.every((v, n) => b[edit.off + n] === v); }
  function detect(b, table) {
    const guards = edits();
    const present = matches(b, guards[0]) || guards.filter(e => e.original).some(e => matches(b, e));
    if (!present) return [];
    if (table !== TABLE || !guards.every(e => matches(b, e))) throw new Error("The extended weapon special is incomplete or changed.");
    return [{index: ROW, off: DATA, guards}];
  }
  const ICE_DATA = 0x13E70, ICE_MARK = ICE_DATA + 52, ICE_CODE = 0x13EB0, ICE_END = 0x1407C;
  function privateEdits() {
    const words = [], labels = new Map(), branches = [];
    const emit = (...values) => words.push(...values);
    const label = name => labels.set(name, words.length);
    const branch = (op, rs, rt, name) => {branches.push([words.length, name]); emit(i(op, rs, rt, 0), 0);};
    const address = (reg, at) => emit(i(15, 0, reg, at >>> 16), i(13, reg, reg, at));
    const go = name => {branches.push([words.length, name]); emit(i(4, 0, 0, 0), 0);};
    label('attack');
    emit(i(15, 0, 8, 0x8007), i(35, 8, 9, 0x2EEC), i(37, 8, 10, 0x2F68), i(12, 9, 9, 0xA0));
    branch(5, 10, 0, 'choose');
    emit(i(35, 8, 10, 0x2EE8), i(15, 0, 11, 0x8009));
    for (const hand of [0, 1]) {
      emit(i(35, 11, 12, 0x7C00 + hand * 4), 0,
        (12 << 16 | 13 << 11 | 1 << 6), (13 << 21 | 12 << 16 | 13 << 11 | 0x21),
        (13 << 16 | 13 << 11 | 2 << 6), (13 << 21 | 12 << 16 | 13 << 11 | 0x21),
        (13 << 16 | 13 << 11 | 2 << 6), i(15, 0, 14, 0x800A),
        (13 << 21 | 14 << 16 | 13 << 11 | 0x21), i(36, 13, 13, TABLE + 14), i(13, 0, 14, 9));
      branch(5, 13, 14, `shield${hand}`);
      emit(i(12, 10, 13, hand ? 0x20 : 0x80), (9 << 21 | 13 << 16 | 9 << 11 | 0x25));
      label(`shield${hand}`);
    }
    label('choose');
    emit(i(13, 0, 10, 0x20), i(15, 0, 11, 0x8009));
    branch(5, 9, 10, 'left');
    emit(i(35, 11, 12, 0x7C04)); go('picked');
    label('left'); emit(i(35, 11, 12, 0x7C00), 0);
    label('picked'); emit(i(13, 0, 10, 93)); branch(5, 12, 10, 'attackNative');
    go('swapAttack');
    label('properties');
    emit(i(13, 0, 8, 181)); branch(5, 6, 8, 'propertiesNative');
    emit((4 << 16 | 8 << 11 | 2 << 6), i(15, 0, 9, 0x8009),
      (9 << 21 | 8 << 16 | 9 << 11 | 0x21), i(35, 9, 9, 0x7C00), i(13, 0, 8, 93));
    branch(5, 9, 8, 'propertiesNative'); go('swapProperties');
    label('swapAttack');
    const attackTarget = words.length; emit(0, 0); go('swap');
    label('swapProperties');
    const propertiesTarget = words.length; emit(0, 0);
    label('swap');
    emit(i(9, 29, 29, -88), i(43, 29, 31, 84));
    address(8, BASE + TABLE + 181 * 52); address(9, BASE + ICE_DATA);
    emit(i(9, 29, 10, 16), i(9, 8, 11, 52));
    label('copy');
    emit(i(35, 8, 12, 0), i(35, 9, 13, 0), i(9, 9, 9, 4), i(43, 10, 12, 0),
      i(43, 8, 13, 0), i(9, 8, 8, 4));
    branches.push([words.length, 'copy']); emit(i(5, 8, 11, 0), i(9, 10, 10, 4));
    emit((25 << 21 | 31 << 11 | 9), 0);
    address(8, BASE + TABLE + 181 * 52);
    emit(i(9, 29, 9, 16), i(9, 8, 11, 52));
    label('restore');
    emit(i(35, 9, 12, 0), i(9, 9, 9, 4), i(43, 8, 12, 0), i(9, 8, 8, 4));
    branches.push([words.length, 'restore']); emit(i(5, 8, 11, 0), 0);
    emit(i(35, 29, 31, 84), i(9, 29, 29, 88), 0x03E00008, 0);
    label('attackNative'); emit(0x3C038007, 0x8C632EEC, j(BASE + 0x6EDC0), 0);
    label('propertiesNative'); emit(0x27BDFFD8, 0xAFB40020, j(BASE + 0x5E730), 0);
    for (const [at, name] of branches) words[at] = (words[at] & 0xFFFF0000 | (labels.get(name) - at - 1 & 65535)) >>> 0;
    for (const [at, name] of [[attackTarget, 'attackNative'], [propertiesTarget, 'propertiesNative']]) {
      const target = BASE + ICE_CODE + labels.get(name) * 4;
      words[at] = i(15, 0, 25, target >>> 16); words[at + 1] = i(13, 25, 25, target);
    }
    const body = bytes(words);
    if (ICE_CODE + body.length > ICE_END) throw new Error('Private special helper is too large.');
    return [{off: ICE_MARK, expect: Uint8Array.of(73, 67, 69, 49)}, {off: ICE_CODE, expect: body},
      ...[[0x6EDB8, 'attack'], [0x5E728, 'properties']].map(([off, name]) =>
        ({off, expect: bytes([j(BASE + ICE_CODE + labels.get(name) * 4), 0])}))];
  }
  function detectPrivate(b, table) {
    const guards = privateEdits();
    if (!guards.some(e => matches(b, e))) return null;
    if (table !== TABLE || !guards.every(e => matches(b, e))) throw new Error('The private ice special is incomplete or changed.');
    return {index: 181, privateFor: 93, off: ICE_DATA, guards};
  }
  const api = {BASE, ROW, TABLE, DATA, MARK, START, SLOT, sites, edits, detect,
    ICE_DATA, ICE_MARK, ICE_CODE, ICE_END, privateEdits, detectPrivate};
  global.SotnWeaponSpecialRows = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
