// Maria mode: swap her attack and hurt voices and lower all her voices by 10% (on top of Maria-Voices-Own-1A5D642F).
// - Attack calls (kick start, running kick, Energy Shot fire, High Jump, Dash Kick) now play her PAIN_B/C/D samples;
//   damage and grab reactions play her attack grunts (8E6, ATTACK_C, 8E8, 8E9). The one-in-three chance stays on the
//   attack calls; High Jump and Dash Kick play PAIN_B.
// - Pitch: 10% lower is -1.82 semitones. Her tones (summons, grunts, pains) keep centre 84; the sound entries go from
//   note 60 to 58 and each tone's fine tune (VagAtr.shift, 1/128 semitone) gains 22: -2 + 22/128 = -1.83.
//   note2pitch2 carries a fine tune of 128+ into the next semitone. The Energy Shot sounds keep their pitch.
const O = require('./maria-voices-own.js');
const V = require('./maria-voices.js');
const F = require('./maria-voices-full.js');
const R1 = require('./maria-effects-repair.js');

const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const OLD_NOTE = 60, NEW_NOTE = 58, FINE_UP = 22;
const MARIA = O.LAYOUT.filter(l => l[1] === 'maria');
const GRUNTS = ['Grunt 8E6', 'Grunt ATTACK_C', 'Grunt 8E8', 'Grunt 8E9'].map(n => O.IDS[n]);
const PAINS = ['Pain B', 'Pain C', 'Pain D'].map(n => O.IDS[n]);
const SWAP = new Map([...GRUNTS.map(id => [id, 'pain']), ...PAINS.map(id => [id, 'grunt'])]);

// The lookup table entries with their id lists swapped.
function table() {
  const prog = O.voiceProgram(), out = Buffer.from(prog.blob), base = prog.tableAt - V.VOICE, n = O.VOICES.length;
  O.VOICES.forEach(([key, flags, ids], i) => {
    const at = base + i * 12, kind = ids.every(id => GRUNTS.includes(id)) ? 'grunt' : ids.every(id => PAINS.includes(id)) ? 'pain' : null;
    if (!kind) return;
    const list = kind === 'grunt' ? (ids.length === 1 ? [PAINS[0]] : PAINS) : GRUNTS;
    out.fill(0, at + 2, at + 12); out[at + 2] = list.length; out[at + 3] = flags;
    list.forEach((id, k) => out.writeUInt16LE(id, at + 4 + k * 2));
  });
  return {old: prog.blob, blob: out, tableAt: prog.tableAt, count: n};
}

// stream, dra: user data; vh: her VH (0x1020 bytes at F.VH_LBA). Returns patched copies.
function apply({stream, dra, vh}) {
  const s = Buffer.from(stream), d = Buffer.from(dra), h = Buffer.from(vh), at = R1.streamOffset(V.VOICE);
  const t = table(), cur = s.subarray(at, at + t.blob.length);
  if (cur.equals(t.blob)) return {applied: true};
  if (!cur.equals(t.old)) throw new Error('Apply Maria-Voices-Own-1A5D642F first (voice lookup).');
  t.blob.copy(s, at);
  const edits = [];
  for (const [name, , , prog, tone, id] of MARIA) {
    const fines = [];
    for (const k of [0, 1]) {
      const o = 0x820 + prog * 512 + (tone + k) * 32 + 5;
      if (h[o] + FINE_UP > 255) throw new Error(`${name} tone ${tone + k} fine tune ${h[o]} is too high.`);
      fines.push(`${h[o]}->${h[o] + FINE_UP}`); h[o] += FINE_UP;
    }
    if (!id) continue;
    const o = V.SFX_TABLE + (id - 0x600) * 7 + 2;
    if (d[o] !== OLD_NOTE) throw new Error(`${hex(id)} note is ${d[o]}, expected ${OLD_NOTE}.`);
    d[o] = NEW_NOTE; edits.push({id: hex(id), name, note: `${OLD_NOTE} -> ${NEW_NOTE}`, fine: fines.join(', ')});
  }
  const voices = O.VOICES.map(([key, flags], i) => {
    const e = t.blob.subarray(t.tableAt - V.VOICE + i * 12), ids = [];
    for (let k = 0; k < e[2]; k++) ids.push(hex(e.readUInt16LE(4 + k * 2)));
    return {key: hex(key), flags, ids, what: O.VOICES[i][3]};
  });
  return {applied: false, stream: s, dra: d, vh: h, edits, voices};
}

module.exports = {apply, table, NEW_NOTE, FINE_UP, VH_LBA: F.VH_LBA, VH_SIZE: F.VH_SIZE, STREAM_LBA: R1.STREAM_LBA, STREAM_SECTORS: R1.STREAM_SECTORS};
