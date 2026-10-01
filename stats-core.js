(function (global) {
  "use strict";

  // Game 8x8 font table used by item, enemy and menu names (PS1 US).
  // Source: tools/sotn-assets/sotn/string.go in Xeeynamo/sotn-decomp.
  const FONT = Array.from(
    " !\"#$%&'()男+,-./" + "0123456789:人手=玉?" + "石ABCDEFGHIJKLMNO" + "PQRSTUVWXYZ[剣]盾_" +
    "書abcdefghijklmno" + "pqrstuvwxyz炎氷雷~女" + "力。「」、・ヲァィゥェォャュョッ" + "ーアイウエオカキクケコサシスセソ" +
    "タチツテトナニヌネノハヒフヘホマ" + "ミムメモヤユヨラリルレロワンﾞﾟ" + "子悪魔人妖精をぁぃぅぇぉゃゅょっ" + "金あいうえおかきくけこさしすせそ" +
    "たちつてとなにぬねのはひふへほま" + "みむめもやゆよらりるれろわん指輪" + "←↖↑↗→↘↓↙○×□△名刀聖血" + "✈★☀☁☃♂♀©®§¶∑大光邪月");
  if (FONT.length !== 256) throw new Error("Font table must have 256 entries.");
  const FONT_INDEX = new Map();
  FONT.forEach((ch, i) => FONT_INDEX.set(ch, i));

  // Bytes that have no editable character are shown as ⟨HH⟩ tokens so they round-trip.
  const TOKEN_RE = /⟨([0-9A-Fa-f]{2}(?:[0-9A-Fa-f]{2})*)⟩/y;
  const hex2 = v => v.toString(16).toUpperCase().padStart(2, "0");
  const token = bytes => `⟨${bytes.map(hex2).join("")}⟩`;
  function readToken(text, i) {
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(text);
    if (!m) return null;
    const bytes = [];
    for (let k = 0; k < m[1].length; k += 2) bytes.push(parseInt(m[1].slice(k, k + 2), 16));
    return {bytes, next: i + m[0].length};
  }

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const s16 = (b, o) => (u16(b, o) << 16) >> 16;
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const put16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; };
  const put32 = (b, o, v) => { put16(b, o, v & 0xFFFF); put16(b, o + 2, (v >>> 16) & 0xFFFF); };

  // ---------------------------------------------------------------- strings
  function fontStringLength(b, off, limit = b.length) {
    for (let o = off; o + 1 < limit; o++) {
      if (b[o] !== 0xFF) continue;
      if (b[o + 1] === 0) return o + 2 - off;
      o++;
    }
    return -1;
  }
  function decodeFont(b, off, limit = b.length) {
    const length = fontStringLength(b, off, limit);
    if (length < 0) return null;
    let text = "";
    for (let o = off; o < off + length - 2; o++) {
      const v = b[o];
      if (v === 0xFF) {
        const e = b[++o];
        text += e === 0xFF ? "月" : token([0xFF, e]);
        continue;
      }
      const ch = FONT[v];
      text += FONT_INDEX.get(ch) === v ? ch : token([v]);
    }
    return {text, length};
  }
  function encodeFont(text) {
    const out = [];
    for (let i = 0; i < text.length;) {
      const t = text[i] === "⟨" ? readToken(text, i) : null;
      if (t) { out.push(...t.bytes); i = t.next; continue; }
      const ch = String.fromCodePoint(text.codePointAt(i));
      i += ch.length;
      if (ch === "月") { out.push(0xFF, 0xFF); continue; }
      const v = FONT_INDEX.get(ch);
      if (v === undefined) throw new Error(`The game font has no "${ch}" character.`);
      out.push(v);
    }
    out.push(0xFF, 0x00);
    return Uint8Array.from(out);
  }

  let sjisTables = null;
  function sjis() {
    if (sjisTables) return sjisTables;
    const decoder = new TextDecoder("shift_jis", {fatal: true});
    const dec = new Map(), enc = new Map();
    const pair = new Uint8Array(2);
    for (let lead = 0x81; lead <= 0xFC; lead++) {
      if (lead > 0x9F && lead < 0xE0) continue;
      for (let trail = 0x40; trail <= 0xFC; trail++) {
        if (trail === 0x7F) continue;
        pair[0] = lead; pair[1] = trail;
        let ch;
        try { ch = decoder.decode(pair); } catch { continue; }
        if (ch.length === 0 || ch === "�") continue;
        const code = (lead << 8) | trail;
        dec.set(code, ch);
        if (!enc.has(ch)) enc.set(ch, code);
      }
    }
    for (let v = 0xA1; v <= 0xDF; v++) {
      const ch = String.fromCharCode(0xFF61 + v - 0xA1);
      dec.set(v, ch); enc.set(ch, v);
    }
    sjisTables = {dec, enc};
    return sjisTables;
  }
  function cStringLength(b, off, limit = b.length) {
    for (let o = off; o < limit; o++) if (b[o] === 0) return o + 1 - off;
    return -1;
  }
  function decodeSjis(b, off, limit = b.length) {
    const length = cStringLength(b, off, limit);
    if (length < 0) return null;
    const {dec, enc} = sjis();
    let text = "";
    const end = off + length - 1;
    for (let o = off; o < end; o++) {
      const v = b[o];
      if (v >= 0x20 && v < 0x7F) { text += String.fromCharCode(v); continue; }
      if (((v >= 0x81 && v <= 0x9F) || (v >= 0xE0 && v <= 0xFC)) && o + 1 < end) {
        const code = (v << 8) | b[o + 1], ch = dec.get(code);
        if (ch && enc.get(ch) === code) { text += ch; o++; continue; }
        text += token([v, b[o + 1]]); o++; continue;
      }
      if (v >= 0xA1 && v <= 0xDF) { text += dec.get(v); continue; }
      text += token([v]);
    }
    return {text, length};
  }
  function encodeSjis(text) {
    const {enc} = sjis();
    const out = [];
    for (let i = 0; i < text.length;) {
      const t = text[i] === "⟨" ? readToken(text, i) : null;
      if (t) { out.push(...t.bytes); i = t.next; continue; }
      const ch = String.fromCodePoint(text.codePointAt(i));
      i += ch.length;
      const c = ch.charCodeAt(0);
      if (ch.length === 1 && c >= 0x20 && c < 0x7F) { out.push(c); continue; }
      const code = enc.get(ch);
      if (code === undefined) throw new Error(`"${ch}" cannot be written in a menu description.`);
      if (code > 0xFF) out.push(code >> 8, code & 255); else out.push(code);
    }
    if (out.includes(0)) throw new Error("Descriptions cannot contain a NUL byte.");
    out.push(0);
    return Uint8Array.from(out);
  }

  // Bytes available for an in-place rewrite: the string, its alignment padding
  // (only zero bytes up to the next 4-byte boundary), and never past the next
  // string another table points at.
  function stringCapacity(b, off, used, knownStarts) {
    const end = off + used;
    let cap = end;
    const aligned = (end + 3) & ~3;
    while (cap < aligned && cap < b.length && b[cap] === 0) cap++;
    let overlap = false;
    for (const start of knownStarts || []) {
      if (start > off && start < cap) cap = start;
      if (start > off && start < end) overlap = true;
    }
    return {capacity: Math.max(cap, end) - off, overlap};
  }

  // ------------------------------------------------------------------- MIPS
  const REG_NAMES = ["zero","at","v0","v1","a0","a1","a2","a3","t0","t1","t2","t3","t4","t5","t6","t7",
    "s0","s1","s2","s3","s4","s5","s6","s7","t8","t9","k0","k1","gp","sp","fp","ra"];
  const REG = Object.fromEntries(REG_NAMES.map((n, i) => [n, i]));
  const op = w => w >>> 26, rs = w => (w >>> 21) & 31, rt = w => (w >>> 16) & 31;
  const rd = w => (w >>> 11) & 31, fn = w => w & 63, simm = w => (w << 16) >> 16;

  function isControl(w) {
    const o = op(w);
    if (o === 0) return fn(w) === 8 || fn(w) === 9;
    return o === 1 || (o >= 2 && o <= 7);
  }
  const isUncondJump = w => op(w) === 2 || (op(w) === 0 && fn(w) === 8) || (op(w) === 4 && rs(w) === 0 && rt(w) === 0);
  const isZeroMove = w => op(w) === 0 && (fn(w) === 0x21 || fn(w) === 0x25) && rs(w) === 0 && rt(w) === 0;
  function isCall(w) {
    const o = op(w);
    return o === 3 || (o === 0 && fn(w) === 9) || (o === 1 && (rt(w) === 16 || rt(w) === 17));
  }
  function branchTarget(w, pc) {
    const o = op(w);
    if (o === 1 || (o >= 4 && o <= 7)) return (pc + 4 + simm(w) * 4) >>> 0;
    if (o === 2 || o === 3) return ((((pc + 4) & 0xF0000000) >>> 0) + (w & 0x3FFFFFF) * 4) >>> 0;
    return null;
  }
  function regsRead(w) {
    const o = op(w);
    if (w === 0) return [];
    if (o === 0) {
      const f = fn(w);
      if (f <= 3) return [rt(w)];
      if (f === 8 || f === 9 || f === 0x11 || f === 0x13) return [rs(w)];
      if (f === 0x10 || f === 0x12 || f === 0x0C || f === 0x0D) return [];
      return [rs(w), rt(w)];
    }
    if (o === 1 || o === 6 || o === 7) return [rs(w)];
    if (o === 4 || o === 5) return [rs(w), rt(w)];
    if (o === 2 || o === 3 || o === 15) return [];
    if (o >= 8 && o <= 14) return [rs(w)];
    if (o >= 32 && o <= 38) return [rs(w)];
    if (o >= 40 && o <= 46) return [rs(w), rt(w)];
    if (o === 16 || o === 18) return (rs(w) === 4 || rs(w) === 6) ? [rt(w)] : [];
    if (o === 50 || o === 58) return [rs(w)];
    return [rs(w), rt(w)];
  }
  function regsWritten(w) {
    const o = op(w);
    if (w === 0) return [];
    if (o === 0) {
      const f = fn(w);
      if (f === 8 || (f >= 0x0C && f <= 0x0D) || f === 0x11 || f === 0x13 || (f >= 0x18 && f <= 0x1B)) return [];
      return [rd(w)];
    }
    if (o === 3) return [31];
    if (o === 1) return (rt(w) === 16 || rt(w) === 17) ? [31] : [];
    if (o >= 8 && o <= 15) return [rt(w)];
    if (o >= 32 && o <= 38) return [rt(w)];
    if (o === 16 || o === 18) return (rs(w) === 0 || rs(w) === 2) ? [rt(w)] : [];
    return [];
  }
  function loadImmediate(w) {
    const o = op(w);
    if (rs(w) !== 0 || rt(w) === 0) return null;
    if (o === 13) return {reg: rt(w), value: w & 0xFFFF, kind: "ori"};
    if (o === 9) return {reg: rt(w), value: simm(w), kind: "addiu"};
    return null;
  }
  const ori = (reg, value) => ((13 << 26) | (reg << 16) | (value & 0xFFFF)) >>> 0;
  const addiu = (reg, value) => ((9 << 26) | (reg << 16) | (value & 0xFFFF)) >>> 0;
  const loadConst = (reg, value) => value >= 0 ? ori(reg, value) : addiu(reg, value);
  const lui = (reg, value) => ((15 << 26) | (reg << 16) | (value & 0xFFFF)) >>> 0;
  const sw = (reg, offset, base) => ((43 << 26) | (base << 21) | (reg << 16) | (offset & 0xFFFF)) >>> 0;
  function withImmediate(w, value) { return ((w & 0xFFFF0000) | (value & 0xFFFF)) >>> 0; }

  class Code {
    constructor(bytes, base, start = 0, end = bytes.length) {
      this.b = bytes; this.base = base >>> 0;
      this.start = Math.max(0, start & ~3); this.end = Math.min(bytes.length, end) & ~3;
      this._targets = null;
    }
    has(pc) { const o = pc - this.base; return o >= this.start && o + 4 <= this.end; }
    word(pc) { if (!this.has(pc)) return null; return u32(this.b, pc - this.base); }
    off(pc) { return pc - this.base; }
    pc(off) { return (this.base + off) >>> 0; }
    // Every static branch/jump target in the scanned range, with the branch addresses.
    targets() {
      if (this._targets) return this._targets;
      const map = new Map();
      for (let o = this.start; o + 4 <= this.end; o += 4) {
        const w = u32(this.b, o), pc = this.pc(o), t = branchTarget(w, pc);
        if (t === null || isCall(w)) continue;
        if (!map.has(t)) map.set(t, []);
        map.get(t).push(pc);
      }
      this._targets = map;
      return map;
    }
    isDelaySlot(pc) { const w = this.word(pc - 4); return w !== null && isControl(w); }

    // Constant in reg just before pc executes. Walks every static predecessor path
    // backwards; succeeds only when all paths load the same constant, and
    // returns each loading instruction so all of them can be patched together.
    resolveConst(pc, reg, limit = 300) {
      const tg = this.targets();
      const callerSaved = !((reg >= 16 && reg <= 23) || reg >= 28);
      const defs = new Map(), seen = new Set(), stack = [pc >>> 0];
      let value = null, steps = 0;
      while (stack.length) {
        const p = stack.pop(), preds = [];
        const w4 = this.word(p - 4), w8 = this.word(p - 8);
        if (w4 !== null && !(w8 !== null && isUncondJump(w8))) {
          if (w8 !== null && isCall(w8) && callerSaved) return null;
          preds.push((p - 4) >>> 0);
        }
        for (const b of tg.get(p) || []) preds.push((b + 4) >>> 0);
        if (!preds.length) return null;
        for (const q of preds) {
          if (seen.has(q)) continue;
          seen.add(q);
          if (++steps > limit) return null;
          const w = this.word(q);
          if (w === null) return null;
          if (!regsWritten(w).includes(reg)) { stack.push(q); continue; }
          const li = loadImmediate(w);
          const v = li ? li.value : (isZeroMove(w) && rd(w) === reg ? 0 : null);
          if (v === null) return null;
          if (value === null) value = v;
          else if (value !== v) return null;
          defs.set(q, li ? li.kind : "zero");
        }
      }
      if (value === null) return null;
      const pcs = [...defs.keys()].sort((a, b) => a - b);
      return {pc: pcs[0], pcs, value, kind: defs.get(pcs[0]), word: this.word(pcs[0])};
    }
    // Argument register value at a call: its delay slot, or every path before it.
    callArg(callPc, reg) {
      const d = this.word(callPc + 4);
      if (d !== null && regsWritten(d).includes(reg)) {
        const li = loadImmediate(d);
        if (li) return {pc: callPc + 4, pcs: [callPc + 4], value: li.value, kind: li.kind, word: d};
        if (isZeroMove(d) && rd(d) === reg) return {pc: callPc + 4, pcs: [callPc + 4], value: 0, kind: "zero", word: d};
        return null;
      }
      return this.resolveConst(callPc, reg);
    }
    // Conservative: true unless every path from pc overwrites reg before any read.
    liveAt(pc, reg, limit = 400) {
      const seen = new Set(), stack = [pc >>> 0];
      let steps = 0;
      const calleeSaved = r => (r >= 16 && r <= 23) || r === 28 || r === 29 || r === 30;
      while (stack.length) {
        let p = stack.pop();
        for (;;) {
          if (seen.has(p)) break;
          seen.add(p);
          if (++steps > limit) return true;
          const w = this.word(p);
          if (w === null) return true;
          if (regsRead(w).includes(reg)) return true;
          if (!isControl(w)) {
            if (regsWritten(w).includes(reg)) break;
            p = (p + 4) >>> 0;
            continue;
          }
          const d = this.word(p + 4);
          if (d === null) return true;
          if (regsRead(d).includes(reg)) return true;
          const killed = regsWritten(d).includes(reg);
          const o = op(w);
          if (o === 0 && fn(w) === 8) {
            if (rs(w) !== 31) return true;
            if (!killed && (reg === 2 || reg === 3 || reg === 31 || calleeSaved(reg))) return true;
            break;
          }
          if (isCall(w)) {
            if (!killed && reg >= 4 && reg <= 7) return true;
            if (killed || !calleeSaved(reg)) break;
            p = (p + 8) >>> 0;
            continue;
          }
          if (killed) break;
          const t = branchTarget(w, p);
          if (o === 2) { p = t; continue; }
          if (t !== null) stack.push(t);
          p = (p + 8) >>> 0;
        }
      }
      return false;
    }
  }

  // -------------------------------------------------------------- icons
  // DRA holds 16x16 4bpp item icons and 16-colour palettes.
  function decodeColor(c) {
    if ((c & 0x7FFF) === 0 && !(c & 0x8000)) return [0, 0, 0, 0];
    return [(c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3, 255];
  }
  function renderIcon(dra, gfxOffset, palOffset, icon, palette) {
    const g = gfxOffset + icon * 128, p = palOffset + palette * 32;
    const rgba = new Uint8ClampedArray(16 * 16 * 4);
    if (g < 0 || g + 128 > dra.length || p < 0 || p + 32 > dra.length) return null;
    const colors = [];
    for (let i = 0; i < 16; i++) colors.push(decodeColor(u16(dra, p + i * 2)));
    for (let i = 0; i < 256; i++) {
      const byte = dra[g + (i >> 1)], index = (i & 1) ? byte >> 4 : byte & 15, c = colors[index];
      rgba.set(c, i * 4);
    }
    return rgba;
  }

  const api = {
    FONT, u16, s16, u32, put16, put32,
    fontStringLength, decodeFont, encodeFont, cStringLength, decodeSjis, encodeSjis, stringCapacity,
    REG, REG_NAMES, isControl, isCall, branchTarget, regsRead, regsWritten, loadImmediate,
    ori, addiu, loadConst, lui, sw, withImmediate, Code, renderIcon, decodeColor
  };
  global.SotnStatsCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
