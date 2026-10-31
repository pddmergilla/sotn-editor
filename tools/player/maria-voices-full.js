// Maria mode: all her requested voices, on the slot-1 layout proven by Maria-Kick-Voice-48BD8FEC (VH at F_TE4 LBA
// 41726, VB right after it at 41729, so DRA's VH callback reads the real samples).
// - The 15-sound bank from tools/player/maria-voices.js (her summon voices, Faerie attack/hurt voices, Energy Shot
//   3/4 sounds), with the last sample's slot padded so the VH still declares exactly 0xE180 bytes: libsnd accepts VB
//   data only up to that total, and DRA sends 0xE190 in 0x800 chunks, so the total must end in the last chunk.
// - Sounds 0x841-0x862 (unused IDs) get fixed entries; 0x841 was the kick-voice test entry.
// - MarPlaySfx's voice half (0x8014F340) calls the voice lookup at 0x8014FA20 (maria-voices.js) for every Maria ID;
//   the kick-voice test words there are replaced. Same call sites as maria-voices.js: High Jump, running kick /
//   Dash Kick, Four Holy Beasts, Energy Shot 3 launch. Slide and heart-paid heal are already set by Maria-No-Voices.
const {r, ops: o, assemble} = require('../enemies/mips-asm.js');
const {parseBank} = require('../audio/sound-check.js');
const V = require('./maria-voices.js');
const K = require('./maria-attack-voice.js');
const R1 = require('./maria-effects-repair.js');

const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const STREAM_LBA = R1.STREAM_LBA, STREAM_SECTORS = R1.STREAM_SECTORS;
const VH_LBA = K.VH_LBA, VB_LBA = K.VB_LBA, VH_SIZE = K.VH_SIZE, VB_SIZE = K.VB_SIZE, VB_READ = K.VB_READ, AREA_SECTORS = K.AREA_SECTORS;
const PICKED_VB_LBA = 41726;   // her VB's LBA when the sample BIN offsets were picked; it now starts at VB_LBA
const DISPATCH = 0x8014F2E8, PLAY = 0x8012CEBC, EXIT = 0x8014F3A4;
const KICK_TEST = K.voiceWords().map(([ram, , w]) => [ram, w]);

function bank(banks, rawOffset) {
  const b = V.buildBank(banks, rawOffset), vh = b.vh, table = 0x820 + 3 * 512, n = V.SOUNDS.length;
  let last = 0; for (let i = 1; i < n; i++) last += vh.readUInt16LE(table + i * 2) * 8;
  vh.writeUInt16LE((VB_SIZE - last) / 8, table + n * 2);                 // pad the last slot: declared total = 0xE180
  const p = parseBank(vh, b.vb, {name: 'Maria voices'});
  const total = p.samples.reduce((a, s) => Math.max(a, s ? s.offset + s.size : 0), 0);
  if (total !== VB_SIZE || Math.ceil(total / 0x800) !== Math.ceil(VB_READ / 0x800)) throw new Error('Declared VB total is wrong.');
  return {...b, vh, total};
}

function words() {
  const head = assemble(0x8014F340, [o.jal(V.VOICE), o.move(r.a0, r.s0), o.nop(), o.beq(r.zero, r.zero, EXIT), o.nop(), o.nop(), o.nop()]).words;
  const JAL = to => (0x0C000000 | ((to >>> 2) & 0x3FFFFFF)) >>> 0, J = to => (0x08000000 | ((to >>> 2) & 0x3FFFFFF)) >>> 0;
  const LI = v => o.addiu(r.a0, r.zero, v);
  return [
    ...KICK_TEST.map(([ram, w], i) => [ram, w, head[i], 'MarPlaySfx voice half: voice lookup for every Maria ID (was the kick test)']),
    [0x8013C824, 0, JAL(DISPATCH), 'running kick / Dash Kick voice (0x71D) back on'],
    [0x8013E3B8, 0, JAL(DISPATCH), 'High Jump voice back on'],
    [0x8013E3BC, LI(0x71D), LI(0x71E), 'High Jump voice: its own ID 0x71E'],
    [0x8013D338, 0x8FBF0014, J(0x8013D31C), 'spell 5 Four Holy Beasts: play a voice too'],
    [0x8013D33C, 0x8FB00010, LI(0x5DA), 'spell 5 voice ID 0x5DA'],
    [0x8012CEDC, o.ori(r.a0, r.zero, 0x6A8), o.ori(r.a0, r.zero, V.ID.EnergyShot3), 'Energy Shot 3 launch sound'],
  ];
}

// area: F_TE4 user data from VH_LBA (AREA_SECTORS); banks as in maria-voices.buildBank (maria = her current bank).
function apply({stream, dra, mad, area, banks, rawOffset}) {
  const s = Buffer.from(stream), d = Buffer.from(dra), t = Buffer.from(area), at = ram => R1.streamOffset(ram), list = words();
  if (s.readUInt32LE(at(list[0][0])) === list[0][2]) return {applied: true};
  if (mad.readUInt32LE(K.MAD_VH_REC) !== VH_LBA) throw new Error('Apply Maria-Kick-Voice-48BD8FEC first (VH record).');
  const edits = [];
  for (const [ram, old, w, what] of list) {
    const cur = s.readUInt32LE(at(ram));
    if (cur !== old >>> 0) throw new Error(`${hex(ram)} (${what}) is ${hex(cur)}, expected ${hex(old)}.`);
    s.writeUInt32LE(w >>> 0, at(ram)); edits.push({at: hex(ram), old: hex(old), new: hex(w), what});
  }
  const prog = V.voiceProgram();
  const dead = s.subarray(at(V.VOICE), at(V.DEAD_END));
  if (require('node:crypto').createHash('sha256').update(dead).digest('hex').toUpperCase() !== V.DEAD_SHA) throw new Error('The dead voice code at 0x8014FA20 changed.');
  prog.blob.copy(s, at(V.VOICE));
  edits.push({at: hex(V.VOICE), size: hex(prog.blob.length), what: `voice lookup and table at ${hex(prog.tableAt)}`});
  const sfx = V.sfxEntries().map(e => e.id === K.ID ? {...e, old: K.NEW_SFX} : e);
  for (const e of sfx) {
    const off = V.SFX_TABLE + (e.id - 0x600) * 7, cur = [...d.subarray(off, off + 7)];
    if (cur.join() !== e.old.join()) throw new Error(`Sound ${hex(e.id)} is ${cur}, expected ${e.old}.`);
    Buffer.from(e.new).copy(d, off);
  }
  const b = bank(banks, rawOffset);
  t.fill(0, 0, (VB_LBA - VH_LBA) * 2048 + VB_READ);
  b.vh.copy(t, 0); b.vb.copy(t, (VB_LBA - VH_LBA) * 2048);
  return {applied: false, stream: s, dra: d, area: t, bank: b, sfx, edits,
    voices: V.VOICES.map(([k, f, ids, what]) => ({key: hex(k), ids: ids.map(hex), flags: f, what}))};
}

module.exports = {apply, bank, words, STREAM_LBA, STREAM_SECTORS, VH_LBA, VB_LBA, VH_SIZE, VB_SIZE, VB_READ, AREA_SECTORS, PICKED_VB_LBA};
