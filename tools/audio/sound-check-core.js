// Browser/Node-safe SotN sound parsing: VAB banks, PS1 ADPCM, WAV/VAG writers, and the 737-slot sound table.
// No Buffer, fs, crypto or path: only Uint8Array / DataView.
(function (global) {
  "use strict";

  const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
  const clamp = n => Math.max(-32768, Math.min(32767, n));

  function readUInt16LE(b, off) {
    if (!(off >= 0) || off + 2 > b.length) throw new RangeError('Read past the end of the data.');
    return b[off] | (b[off + 1] << 8);
  }
  function readUInt32LE(b, off) {
    if (!(off >= 0) || off + 4 > b.length) throw new RangeError('Read past the end of the data.');
    return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
  }
  function ascii(b, start, end) {
    let s = '';
    for (let i = start; i < end && i < b.length; i++) s += String.fromCharCode(b[i]);
    return s;
  }
  function writeAscii(b, off, s) {
    for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i) & 0x7f;
  }

  function parseBank(vh, vb, info, areaNames = {}) {
    if (ascii(vh, 0, 4) !== 'pBAV') throw new Error(`Invalid sound bank: ${info.name}`);
    const count = readUInt16LE(vh, 18), n = readUInt16LE(vh, 22);
    const table = 0x820 + count * 512;
    if (table + 512 > vh.length || count > 128 || n > 254) throw new Error(`Broken bank header: ${info.name}`);
    const scale = readUInt32LE(vh, 4) >= 5 ? 8 : 4;
    let off = readUInt16LE(vh, table) * scale;
    const samples = [null];
    for (let i = 1; i <= n; i++) {
      const size = readUInt16LE(vh, table + i * 2) * scale;
      if (off + size > vb.length || size % 16) throw new Error(`Sample exceeds bank: ${info.name}/${i}`);
      samples.push({index: i, offset: off, size}); off += size;
    }
    const programs = new Map(); let packed = 0;
    for (let p = 0; p < 128; p++) {
      const at = 32 + p * 16, tones = vh[at];
      if (!tones) continue;
      if (tones > 16 || packed >= count) throw new Error(`Invalid tone count: ${info.name}`);
      const list = [];
      for (let t = 0; t < tones; t++) {
        const a = 0x820 + packed * 512 + t * 32;
        list.push({tone: t, volume: vh[a + 2], pan: vh[a + 3], center: vh[a + 4], fine: vh[a + 5],
          adsr1: readUInt16LE(vh, a + 16), adsr2: readUInt16LE(vh, a + 18), sample: readUInt16LE(vh, a + 22)});
      }
      programs.set(p, {volume: vh[at + 1], pan: vh[at + 4], tones: list}); packed++;
    }
    const area = info.name.match(/^(?:ST|BOSS)\/([^/]+)/)?.[1];
    return {...info, location: areaNames[area] || '', vh, vb, samples, programs, volume: vh[24]};
  }

  function decodeADPCM(bytes) {
    const out = [], filters = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];
    let h1 = 0, h2 = 0, loopStart = 0, loopEnd = 0;
    for (let a = 0; a + 16 <= bytes.length; a += 16) {
      const shift = bytes[a] & 15, filter = bytes[a] >> 4, flags = bytes[a + 1];
      if (filter > 4 || shift > 12) throw new Error('Invalid PlayStation sample block.');
      if (flags & 4) loopStart = out.length;
      const [f1, f2] = filters[filter];
      for (let i = 0; i < 28; i++) {
        let v = (bytes[a + 2 + (i >> 1)] >> ((i & 1) * 4)) & 15;
        if (v & 8) v -= 16;
        v = clamp(((v << 12) >> shift) + ((h1 * f1 + h2 * f2 + 32) >> 6));
        out.push(v); h2 = h1; h1 = v;
      }
      if (flags & 1) { if (flags & 2) loopEnd = out.length; break; }
    }
    return {pcm: Float32Array.from(out, v => v / 32768), loopStart, loopEnd};
  }

  // 16-bit PCM WAV from one or more float channels. Returns a Uint8Array.
  function wav(channels, rate = 44100) {
    const length = channels[0].length, nch = channels.length;
    const b = new Uint8Array(44 + length * nch * 2), dv = new DataView(b.buffer);
    writeAscii(b, 0, 'RIFF'); dv.setUint32(4, b.length - 8, true); writeAscii(b, 8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, nch, true); dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * nch * 2, true); dv.setUint16(32, nch * 2, true); dv.setUint16(34, 16, true);
    writeAscii(b, 36, 'data'); dv.setUint32(40, b.length - 44, true);
    for (let i = 0; i < length; i++) for (let c = 0; c < nch; c++)
      dv.setInt16(44 + (i * nch + c) * 2, clamp(Math.round(channels[c][i] * 32767)), true);
    return b;
  }

  // Sony .VAG file: 48-byte big-endian header, one all-zero 16-byte block, then the ADPCM bytes as stored.
  function vag(adpcmBytes, rate = 44100, name = '') {
    const dataSize = adpcmBytes.length + 16;
    const b = new Uint8Array(48 + dataSize), dv = new DataView(b.buffer);
    writeAscii(b, 0, 'VAGp');
    dv.setUint32(4, 0x20, false);
    dv.setUint32(8, 0, false);
    dv.setUint32(12, dataSize, false);
    dv.setUint32(16, Math.round(rate) >>> 0, false);
    writeAscii(b, 32, String(name).replace(/[^\x20-\x7e]/g, '_').slice(0, 16));
    b.set(adpcmBytes, 48 + 16);
    return b;
  }

  // Native bank files exactly as held in the image (DRA-embedded banks have a 0x3000-byte header slice).
  function bankFiles(bank) { return {name: bank.name, vh: bank.vh, vb: bank.vb}; }

  // disc: an opened SotnCore.DiscImage. catalog: {names, uses, areaNames}. Returns the sound-table API.
  async function loadSoundImage(disc, {catalog = {names: {}, uses: {}, areaNames: {}}, imageName = '', imageSize = 0} = {}) {
    const names = catalog.names || {}, uses = catalog.uses || {}, areaNames = catalog.areaNames || {};
    const files = [];
    async function walk(r, p = '') {
      for (const x of await disc.readDirectory(r)) {
        const name = p + x.name.replace(/;\d+$/, '');
        if (x.isDirectory) await walk(x, name + '/'); else files.push({...x, path: name});
      }
    }
    await walk(disc.root);
    const find = p => { const r = files.find(x => x.path === p); if (!r) throw new Error(`Missing disc file: ${p}`); return r; };
    const read = async r => new Uint8Array(await disc.readFile(r));
    const draRec = find('DRA.BIN'), dra = await read(draRec);
    if (dra.length < 0x21ecc || ascii(dra, 0x1107c, 0x11080) !== 'pBAV') throw new Error('Expected the US PS1 DRA layout.');
    const rawOffset = (lba, off = 0) => (lba + Math.floor(off / 2048)) * disc.sectorSize + disc.dataOffset + off % 2048;
    const banks = [], warnings = [];
    function add(vh, vb, name, slot, hlba, hoff, blba, boff, spu) {
      banks.push(parseBank(vh, vb, {id: banks.length, name, slot, headerBIN: rawOffset(hlba, hoff),
        bodyLBA: blba, bodyOffset: boff, spu}, areaNames));
    }
    const headers = [0x1107c, 0x1407c, 0x1607c, 0x1807c];
    const bodies = [0x9b6a0, 0xdd350, 0xeb4e0, 0x109c80];
    const bodyEnds = [0xdd350, 0xeb4e0, 0x105af0, 0x119870];
    const spu = Array.from({length: 4}, (_, i) => readUInt32LE(dra, 0x1d1c8 + i * 4));
    for (let i = 0; i < 4; i++) add(dra.subarray(headers[i], headers[i] + 0x3000), dra.subarray(bodies[i], bodyEnds[i]),
      ['Common effects', 'Alucard / native player', 'Native bank 2', 'Native bank 3'][i], i, draRec.extent, headers[i], draRec.extent, bodies[i], spu[i]);
    for (const h of files.filter(x => x.path.endsWith('.VH'))) {
      const v = files.find(x => x.path === h.path.slice(0, -3) + '.VB'); if (!v) continue;
      const slot = h.path.startsWith('SERVANT/') ? 2 : h.path.startsWith('VAB/') ? 1 : 3;
      try { add(await read(h), await read(v), h.path.replace('.VH', ''), slot, h.extent, 0, v.extent, 0, spu[slot]); }
      catch (e) { warnings.push(e.message + '; this directory entry may have been repurposed by the mod.'); }
    }
    const mad = await read(find('ST/MAD/MAD.BIN'));
    const hlba = readUInt32LE(mad, 0x18334), blba = readUInt32LE(mad, 0x18344);
    const hv = await disc.readUserData(hlba, readUInt32LE(mad, 0x1833c));
    const bv = await disc.readUserData(blba, readUInt32LE(mad, 0x1834c));
    add(hv, bv, 'Maria playable voice (live loader)', 1, hlba, 0, blba, 0, spu[1]);
    const mariaBank = banks[banks.length - 1].id;
    const samples = banks.flatMap(b => b.samples.filter(Boolean).map(s => ({bank: b.id, bankName: b.name, slot: b.slot,
      sample: s.index, size: s.size, rate: Math.round(44100 * 2 ** ((60 - ([...b.programs.values()].flatMap(p => p.tones).find(t => t.sample === s.index)?.center || 60)) / 12)), bin: hex(rawOffset(b.bodyLBA, b.bodyOffset + s.offset)),
      spu: hex(b.spu + s.offset), spuNote: 'SPU address when this bank occupies its usual slot; other loading arrangements can differ.'})));
    const pcmCache = new Map();
    function decoded(b, s) { const key = b.id + ':' + s.index; if (!pcmCache.has(key)) pcmCache.set(key, decodeADPCM(b.vb.subarray(s.offset, s.offset + s.size))); return pcmCache.get(key); }
    function config(id, mode) {
      const off = 0x1f554 + (id - 0x600) * 7;
      if (!Number.isInteger(id) || id < 0x600 || id > 0x8e0) throw new Error('Sound ID must be 0x600–0x8E0.');
      return Array.from(dra.subarray(off, off + 7));
    }
    function events(id, mode) {
      const [vab, prog, note, volume, , tone] = config(id, mode);
      if (vab !== 9) return [{vab, prog, note, volume, tone, time: 0}];
      const ptr = readUInt32LE(dra, 0x21ecc + (prog + 1) * 4), offset = ptr - 0x800a0000;
      if (offset < 0x2097c || offset >= 0x21ecc) throw new Error('Sound script pointer is outside its known area.');
      const list = []; let time = 0, ended = false;
      for (let a = offset; a + 6 <= 0x21ecc; a += 6) {
        if (dra[a] === 255) { ended = true; break; }
        list.push({vab: dra[a], prog: dra[a + 1], note: dra[a + 2], tone: dra[a + 3], volume: volume * dra[a + 4] / 127, time});
        time += (dra[a + 5] + 1) / 60;
      }
      if (!ended) throw new Error('Unterminated sound script.'); return list;
    }
    function bankFor(slot, q) {
      if (slot === 0) return banks[0];
      if (slot === 1) return banks[q.get('mode') === 'maria' ? mariaBank : q.get('mode') === 'richter' ? banks.find(x => x.name === 'VAB/SD_RIH').id : 1];
      const selected = Number(q.get(slot === 2 ? 'familiar' : 'stage') || slot);
      const b = banks[selected]; if (!b || b.slot !== slot) throw new Error(`Choose a bank for slot ${slot}.`); return b;
    }
    function voices(id, q) {
      return events(id, q.get('mode')).flatMap(e => {
        const b = bankFor(e.vab, q), p = b.programs.get(e.prog);
        if (!p) throw new Error(`${b.name} has no program ${e.prog}. Try another bank.`);
        const pair = p.tones.slice(e.tone, e.tone + 2);
        if (!pair.length) throw new Error(`${b.name} has no tone ${e.tone}. Try another bank.`);
        return pair.filter(t => t.sample && b.samples[t.sample]).map(t => ({b, p, t, e, s: b.samples[t.sample]}));
      });
    }
    function sound(id, q) {
      const vs = voices(id, q); if (!vs.length) throw new Error('This slot contains no sample in the selected banks.');
      const length = 44100 * 8, left = new Float32Array(length), right = new Float32Array(length); let end = 0;
      for (const {b, p, t, e, s} of vs) {
        const d = decoded(b, s), speed = 2 ** ((e.note - t.center + t.fine / 128) / 12);
        const frames = Math.min(length - Math.round(e.time * 44100), Math.ceil(d.pcm.length / speed));
        const gain = (e.volume / 127) * (p.volume / 127) * (t.volume / 127) * (b.volume / 127) * 0.45;
        const pan = Math.max(0, Math.min(127, t.pan + p.pan - 64)) / 127;
        const start = Math.round(e.time * 44100);
        for (let i = 0; i < frames; i++) {
          const at = i * speed, j = Math.floor(at), f = at - j;
          const v = ((d.pcm[j] || 0) * (1 - f) + (d.pcm[j + 1] || 0) * f) * gain;
          left[start + i] += v * Math.min(1, 2 * (1 - pan)); right[start + i] += v * Math.min(1, 2 * pan);
        }
        end = Math.max(end, start + frames);
      }
      return wav([left.subarray(0, end), right.subarray(0, end)]);
    }
    function rows(q) {
      return Array.from({length: 737}, (_, i) => {
        const id = 0x600 + i, meta = names[hex(id)] || {name: 'UNNAMED SLOT', description: ''};
        const refs = uses[meta.name] || [];
        let available = true, reason = '', refsToSamples = [];
        try {
          refsToSamples = voices(id, q).map(({b, s}) => ({bank: b.name, sample: s.index,
            bin: hex(rawOffset(b.bodyLBA, b.bodyOffset + s.offset)), spu: hex(b.spu + s.offset)}));
          if (!refsToSamples.length) { available = false; reason = 'No sample in these banks.'; }
        } catch (e) { available = false; reason = e.message; }
        return {id: hex(id), name: meta.name,
          originalName: meta.name, description: meta.description, ram: hex(0x800bf554 + i * 7),
          bin: hex(rawOffset(draRec.extent, 0x1f554 + i * 7)), config: config(id, q.get('mode')),
          mapping: q.get('mode') === 'maria' ? 'BIN table settings auditioned against Maria’s bank. This is a bank preview, not her current runtime action mapping.' : 'Settings read from this BIN; names and call sites describe source references, not a verified live action map.',
          available, reason, samples: refsToSamples, uses: refs};
      });
    }
    // Convenience wrappers for exports and raw sample playback.
    const sampleOf = (bankId, sampleIndex) => {
      const b = banks[Number(bankId)], s = b?.samples[Number(sampleIndex)];
      if (!s) throw new Error('Sample not found.');
      return {b, s};
    };
    const sampleAdpcm = (bankId, sampleIndex) => { const {b, s} = sampleOf(bankId, sampleIndex); return b.vb.subarray(s.offset, s.offset + s.size); };
    function sampleWav(bankId, sampleIndex, rate = 44100) {
      rate = Number(rate); if (!Number.isFinite(rate) || rate < 4000 || rate > 48000) throw new Error('Sample rate must be 4000–48000 Hz.');
      const {b, s} = sampleOf(bankId, sampleIndex);
      return wav([decoded(b, s).pcm], Math.round(rate));
    }
    function sampleVag(bankId, sampleIndex, rate = 44100, name) {
      const {b, s} = sampleOf(bankId, sampleIndex);
      return vag(sampleAdpcm(bankId, sampleIndex), rate, name || `${b.name.split("/").pop().slice(0, 13)}_${String(s.index).padStart(2, "0")}`);
    }
    return {banks, samples, rows, sound, decoded, rawOffset, mariaBank, warnings, image: imageName, imageSize,
      sampleWav, sampleVag, sampleAdpcm, bankFiles: id => bankFiles(banks[Number(id)])};
  }

  const api = {parseBank, decodeADPCM, wav, vag, bankFiles, loadSoundImage, hex};
  global.SotnSoundCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
