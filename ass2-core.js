// Applies the Alternate Scarlet Symphony 2.0 PPF3 to a vanilla US Track 1 BIN in the browser (or Node).
// The patch carries undo data, so the input is checked byte for byte before anything is written,
// and the output is streamed in windows and checked against the release CRC32.
(function (global) {
  "use strict";
  const WINDOW = 8 << 20;

  // PPF3: "PPF30", method 2, 50-byte description, image type, block check, undo, dummy,
  // [1024-byte block check], then records of u64 offset, u8 length, data[, undo data].
  function parsePpf(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const ascii = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
    if (b.length < 60 || ascii(0, 5) !== "PPF30" || b[5] !== 2) throw new Error("Not a PPF3 patch.");
    const blockCheck = b[57] === 1, undo = b[58] === 1;
    if (!undo) throw new Error("The patch has no undo data, so the input BIN can't be checked.");
    let pos = blockCheck ? 1084 : 60;
    const offsets = [], lengths = [], data = [];
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    while (pos < b.length) {
      if (pos + 9 > b.length) throw new Error("The PPF ends inside a record.");
      const off = Number(view.getBigUint64(pos, true)), n = b[pos + 8];
      pos += 9;
      if (!n || pos + 2 * n > b.length) throw new Error("The PPF ends inside a record.");
      offsets.push(off); lengths.push(n); data.push(pos);
      pos += 2 * n;
    }
    for (let i = 1; i < offsets.length; i++) if (offsets[i] < offsets[i - 1] + lengths[i - 1]) throw new Error("PPF records overlap or are out of order.");
    return {bytes: b, description: ascii(6, 50).trim(), blockCheck: blockCheck ? b.subarray(60, 1084) : null,
      offsets, lengths, data, end: offsets.length ? offsets[offsets.length - 1] + lengths[lengths.length - 1] : 0};
  }

  let table = null;
  function crc32(chunk, crc = 0) {
    if (!table) {
      table = new Int32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
    }
    let c = ~crc;
    for (let i = 0; i < chunk.length; i++) c = table[(c ^ chunk[i]) & 0xFF] ^ (c >>> 8);
    return ~c >>> 0;
  }
  const hex = n => n.toString(16).toUpperCase().padStart(8, "0");

  async function readSlice(file, start, end) {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }

  // Compares every patched region with the patch's undo (vanilla) and new (ASS 2.0) bytes.
  // Returns {status: "vanilla" | "patched" | "other", vanillaMismatch, patchedMismatch, records}.
  async function inspect(file, ppf, {size, onProgress} = {}) {
    const n = ppf.offsets.length, b = ppf.bytes;
    if (size && file.size !== size) return {status: "size", records: n, vanillaMismatch: n, patchedMismatch: n};
    if (ppf.end > file.size) return {status: "size", records: n, vanillaMismatch: n, patchedMismatch: n};
    let vanillaMismatch = 0, patchedMismatch = 0, i = 0;
    if (ppf.blockCheck) {
      const block = await readSlice(file, 0x9320, 0x9320 + 1024);
      if (block.some((x, k) => x !== ppf.blockCheck[k])) vanillaMismatch++;
    }
    for (let ws = 0; i < n; ws += WINDOW) {
      if (ppf.offsets[i] >= ws + WINDOW) { ws = Math.floor(ppf.offsets[i] / WINDOW) * WINDOW - WINDOW; continue; }
      const win = await readSlice(file, ws, Math.min(file.size, ws + WINDOW + 256));
      for (; i < n && ppf.offsets[i] < ws + WINDOW; i++) {
        const at = ppf.offsets[i] - ws, len = ppf.lengths[i], d = ppf.data[i];
        let isOld = true, isNew = true;
        for (let k = 0; k < len; k++) {
          const x = win[at + k];
          if (x !== b[d + len + k]) isOld = false;
          if (x !== b[d + k]) isNew = false;
        }
        if (!isOld) vanillaMismatch++;
        if (!isNew) patchedMismatch++;
      }
      onProgress?.(Math.min(1, (ws + WINDOW) / ppf.end));
    }
    const status = !vanillaMismatch ? "vanilla" : !patchedMismatch ? "patched" : "other";
    return {status, vanillaMismatch, patchedMismatch, records: n};
  }

  // Streams the patched image to writer.write(Uint8Array) in order. Returns the output CRC32 (hex).
  async function build(file, ppf, writer, {onProgress} = {}) {
    const n = ppf.offsets.length, b = ppf.bytes;
    let i = 0, crc = 0;
    for (let ws = 0; ws < file.size; ws += WINDOW) {
      const we = Math.min(file.size, ws + WINDOW);
      const win = await readSlice(file, ws, we);
      while (i < n && ppf.offsets[i] + ppf.lengths[i] <= ws) i++;
      for (let k = i; k < n && ppf.offsets[k] < we; k++) {
        const off = ppf.offsets[k], len = ppf.lengths[k], d = ppf.data[k];
        const from = Math.max(off, ws), to = Math.min(off + len, we);
        win.set(b.subarray(d + (from - off), d + (to - off)), from - ws);
      }
      crc = crc32(win, crc);
      await writer.write(win);
      onProgress?.(we / file.size);
    }
    return hex(crc);
  }

  const api = {parsePpf, inspect, build, crc32, hex};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.SotnAss2Core = api;
})(typeof window !== "undefined" ? window : globalThis);
