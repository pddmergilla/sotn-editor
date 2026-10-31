// Maria mode: her voices on a rebuilt voice bank (replaces the reverted Maria-Voices-Recovery-Pickups-D8D9264A).
// - Why they did not play: her calls go through MarPlaySfx (0x8014F2E8). Its voice half (0x8014F340) only played
//   after a check (0x8014EEA4) that the loaded bank matches a stored fingerprint, then swapped Richter's sound slots
//   0x6F9-0x708 between a Maria config (note 56) and Richter's vanilla config (notes 5-89). Richter's notes on her
//   bank (tone centre 84) play about 80 semitones low, an inaudible rumble.
// - SPU memory is full in Maria mode: slot 1 (0x42CC0, 0xE190 bytes) holds her voices, slot 2 her own effects,
//   slot 3 the stage bank up to the reverb buffer. The new samples are therefore not added: slot 1 is rebuilt with
//   exactly the 15 sounds asked for (summon voices from her bank, Faerie voices, the two Energy Shot sounds), each
//   cut after its last sample above about -42 dBFS, in the same 0xE180 bytes (VH F_TE5 LBA 42137, VB F_TE4 LBA 41726;
//   the MAD.BIN loader records keep their sizes). Slot 2, the common bank and DRA's sound code are untouched.
// - Fifteen sound IDs that nothing on the disc plays (SFX_UNUSED_*, unchanged from the ASS 2.0 backup) get fixed
//   entries for the new bank. Nothing is rewritten at runtime.
// - MarPlaySfx keeps its effect half (remap table 0x80175974). Its voice half now calls a lookup in the dead tail of
//   the old voice code (0x8014FA20; nothing branches there) that plays one fixed or random voice per Maria ID.
const crypto = require('node:crypto');
const {r, R, ops: o, assemble, bytes} = require('../enemies/mips-asm.js');
const {decodeADPCM, parseBank} = require('../audio/sound-check.js');
const R1 = require('./maria-effects-repair.js');

const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const STREAM_LBA = R1.STREAM_LBA, STREAM_SECTORS = R1.STREAM_SECTORS;
const VH = {lba: 42137, size: 0x1020}, VB = {lba: 41726, size: 0xE180};
const MAD_VH_REC = 0x18334, MAD_VB_REC = 0x18344;
const SFX_TABLE = 0x1F554;                         // DRA.BIN offset of g_SfxData (0x800BF554)
const PLAY = 0x8012CEBC, RAND = 0x800160E4, DISPATCH = 0x8014F2E8;
const DASH_MODE = 0x801319FC, SHOT_LEVEL = 0x8012DED0;
const VOICE = 0x8014FA20, DEAD_END = 0x8014FC40;
const DEAD_SHA = 'DB33D6DD90D8F1F0CC0C813480ABBA508B4437BFFC0FCFFF4C9DDFA4EB8B8330'; // 0x8014FA20-0x8014FC40 as shipped
const TRIM = 0.008;

// [name, source bank, sample, BIN offset of the sample, target program, SFX id, volume, priority]
const SOUNDS = [
  ['Guardian Knuckle', 'maria', 2, 0x5D98708, 0, 0x841, 127, 90],
  ['Four Holy Beasts', 'maria', 3, 0x5D9A348, 0, 0x842, 127, 90],
  ['Seiryuu', 'maria', 4, 0x5D9C2B8, 0, 0x843, 127, 90],
  ['Suzaku', 'maria', 5, 0x5D9CF08, 0, 0x844, 127, 90],
  ['Byakko', 'maria', 6, 0x5D9DC88, 0, 0x846, 127, 90],
  ['Genbu', 'maria', 7, 0x5D9E878, 0, 0x847, 127, 90],
  ['Faerie 7 (attack)', 'SERVANT/SD_FAIRY', 7, 0x4208778, 1, 0x848, 124, 80],
  ['Faerie 8 (attack)', 'SERVANT/SD_FAIRY', 8, 0x42094E8, 1, 0x849, 116, 80],
  ['Faerie 9 (attack)', 'SERVANT/SD_FAIRY', 9, 0x420A388, 1, 0x84A, 102, 80],
  ['Faerie 10 (hurt)', 'SERVANT/SD_FAIRY', 10, 0x420B188, 1, 0x84B, 116, 85],
  ['Faerie 11 (hurt)', 'SERVANT/SD_FAIRY', 11, 0x420BB88, 1, 0x85E, 108, 85],
  ['Faerie 12 (hurt)', 'SERVANT/SD_FAIRY', 12, 0x420C7F8, 1, 0x85F, 120, 85],
  ['Faerie 13 (hurt)', 'SERVANT/SD_FAIRY', 13, 0x420D2A8, 1, 0x860, 116, 85],
  ['Energy Shot 3', 'ST/NZ1/SD_ZKNZ1', 16, 0x5569058, 2, 0x861, 100, 60],
  ['Energy Shot 4', 'BOSS/RBO5/SD_ZRBO5', 4, 0x684F898, 2, 0x862, 120, 60],
];
const ID = Object.fromEntries(SOUNDS.map(s => [s[0].split(' (')[0].replace(/ /g, ''), s[5]]));
// Their current entries (SFX_UNUSED_*, same as the ASS 2.0 backup).
const OLD_SFX = {
  0x841: [3, 2, 60, 127, 0, 4, 80], 0x842: [3, 2, 60, 127, 0, 6, 80], 0x843: [3, 2, 60, 127, 0, 8, 80],
  0x844: [3, 2, 60, 127, 0, 10, 80], 0x846: [3, 2, 60, 127, 0, 14, 80], 0x847: [3, 3, 60, 127, 0, 0, 80],
  0x848: [3, 3, 60, 127, 0, 2, 80], 0x849: [3, 3, 60, 125, 0, 4, 80], 0x84A: [3, 3, 60, 127, 0, 6, 80],
  0x84B: [3, 3, 60, 127, 0, 8, 90], 0x85E: [3, 4, 60, 125, 0, 0, 80], 0x85F: [3, 4, 60, 112, 0, 2, 80],
  0x860: [3, 4, 60, 120, 0, 4, 80], 0x861: [3, 4, 60, 120, 0, 6, 80], 0x862: [3, 4, 60, 120, 0, 8, 80],
};

const ATTACK = [ID.Faerie9, ID.Faerie7, ID.Faerie8], HURT = [ID.Faerie10, ID.Faerie11, ID.Faerie12, ID.Faerie13];
const DASH = 1, SHOT4 = 2;
// Maria ID -> [flags, ids]. Spell IDs come from the spell caster's voice step (0x8013D298, spell index s0).
const VOICES = [
  [0x71F, 0, ATTACK, 'kick start (0x8013C7C0)'],
  [0x71C, SHOT4, ATTACK, 'Energy Shot fire (0x8012DD84); Energy Shot 4 also plays its sound'],
  [0x71D, DASH, [ID.Faerie7, ID.Faerie8, ID.Faerie9], 'running kick (0x8013C824); Faerie 7 during the air dash (Dash Kick)'],
  [0x71E, 0, [ID.Faerie7], 'High Jump (0x8013E3B8)'],
  [0x5CC, 0, [ID.GuardianKnuckle], 'spell 0 Guardian Knuckle'],
  [0x5D3, 0, [ID.Genbu], 'spell 1 Genbu'],
  [0x5D2, 0, [ID.Byakko], 'spell 2 Byakko'],
  [0x5D1, 0, [ID.Seiryuu], 'spell 3 Seiryuu'],
  [0x5D0, 0, [ID.Suzaku], 'spell 4 Suzaku'],
  [0x5DA, 0, [ID.FourHolyBeasts], 'spell 5 Four Holy Beasts'],
  ...[0x5D4, 0x5D5, 0x5D6, 0x5D7, 0x5D8].map(k => [k, 0, HURT, 'damage / grab reaction']),
];

// Cut a PS-ADPCM sample after its last block above TRIM, keeping its end convention.
function trim(raw) {
  const blocks = raw.length / 16, flags = i => raw[i * 16 + 1];
  let end = 0; while (end < blocks && !(flags(end) & 1)) end++;
  const pcm = decodeADPCM(raw).pcm;
  let last = pcm.length - 1; while (last > 0 && Math.abs(pcm[last]) < TRIM) last--;
  const keep = Math.max(1, Math.ceil((last + 1) / 28));
  if (end < blocks - 1) {                         // data block with the end flag, then terminator block(s)
    if (keep > end) return Buffer.from(raw);
    const out = Buffer.concat([raw.subarray(0, keep * 16), raw.subarray((end + 1) * 16)]);
    out[(keep - 1) * 16 + 1] = (flags(keep - 1) | 1) & ~2;
    return out;
  }
  if (keep >= blocks - 1) return Buffer.from(raw); // only a silent looping terminator ends the sample
  return Buffer.concat([raw.subarray(0, keep * 16), raw.subarray((blocks - 1) * 16)]);
}

// Raw VAB header tone record (32 bytes) of a program/tone, using the packed program order.
function toneRecord(vh, prog, tone) {
  let packed = 0; for (let p = 0; p < prog; p++) if (vh[32 + p * 16]) packed++;
  return Buffer.from(vh.subarray(0x820 + packed * 512 + tone * 32, 0x820 + packed * 512 + tone * 32 + 32));
}

// banks: {maria: {vh, vb, vbLba}, 'SERVANT/SD_FAIRY': {vh, vb, vbLba}, ...}; rawOffset(lba, off) -> BIN offset
function buildBank(banks, rawOffset) {
  const maria = banks.maria.vh, parsed = {};
  for (const [k, b] of Object.entries(banks)) parsed[k] = parseBank(b.vh, b.vb, {name: k});
  const samples = SOUNDS.map(([name, src, idx, bin]) => {
    const b = parsed[src], s = b.samples[idx];
    if (rawOffset(banks[src].vbLba, s.offset) !== bin) throw new Error(`${name}: sample ${idx} of ${src} is not at ${hex(bin)}.`);
    let tone = -1, prog = -1;
    for (const [p, v] of b.programs) { const t = v.tones.findIndex(t => t.sample === idx); if (t >= 0 && !(t & 1)) { prog = p; tone = t; break; } }
    if (tone < 0) throw new Error(`${name}: no tone plays sample ${idx}.`);
    const raw = Buffer.from(banks[src].vb.subarray(s.offset, s.offset + s.size));
    return {name, src, raw, data: trim(raw), pair: [toneRecord(banks[src].vh, prog, tone), toneRecord(banks[src].vh, prog, tone + 1)]};
  });
  const vb = Buffer.alloc(VB.size), offsets = []; let at = 0;
  for (const s of samples) { offsets.push(at); s.data.copy(vb, at); at += s.data.length; }
  if (at > VB.size) throw new Error(`Voice bank needs ${hex(at)} bytes; slot 1 holds ${hex(VB.size)}.`);
  const vh = Buffer.alloc(VH.size); maria.copy(vh, 0, 0, 0x820);
  const programs = [0, 1, 2].map(p => SOUNDS.map((s, i) => [s, i]).filter(([s]) => s[4] === p));
  for (let p = 0; p < 128; p++) vh[32 + p * 16] = 0;
  programs.forEach((list, p) => {
    vh[32 + p * 16] = list.length * 2;
    list.forEach(([, i], k) => samples[i].pair.forEach((rec, h) => {
      const t = Buffer.from(rec); t.writeUInt16LE(p, 20); t.writeUInt16LE(i + 1, 22); t.copy(vh, 0x820 + p * 512 + (k * 2 + h) * 32);
    }));
  });
  const scale = maria.readUInt32LE(4) >= 5 ? 8 : 4, table = 0x820 + 3 * 512;
  vh.writeUInt16LE(maria.readUInt16LE(0x820 + maria.readUInt16LE(18) * 512), table);
  samples.forEach((s, i) => vh.writeUInt16LE(s.data.length / scale, table + (i + 1) * 2));
  vh.writeUInt32LE(VH.size + VB.size, 12); vh.writeUInt16LE(3, 18);
  vh.writeUInt16LE(programs.reduce((a, l) => a + l.length * 2, 0), 20); vh.writeUInt16LE(SOUNDS.length, 22);
  return {vh, vb, used: at, samples: samples.map((s, i) => ({name: s.name, from: s.src, size: hex(s.raw.length), kept: hex(s.data.length), vbOffset: hex(offsets[i]), sha256: sha(s.data)}))};
}

function sfxEntry(s, tone) { return [1, s[4], 60, s[6], 0, tone, s[7]]; }
function sfxEntries() {
  const out = []; const count = [0, 0, 0];
  for (const s of SOUNDS) { const tone = count[s[4]] * 2; count[s[4]]++; out.push({id: s[5], name: s[0], old: OLD_SFX[s[5]], new: sfxEntry(s, tone)}); }
  return out;
}

const divu = (s, t) => R(s, t, 0, 0, 0x1B), mfhi = d => R(0, 0, d, 0, 0x10);
const hi = a => ((a + 0x8000) >>> 16) & 0xFFFF, lo = a => a & 0xFFFF;
function voiceProgram() {
  const code = [
    o.addiu(r.sp, r.sp, -24), o.sw(r.ra, 20, r.sp), o.sw(r.s0, 16, r.sp),
    o.lui(r.t0, hi(0)), o.addiu(r.t0, r.t0, 0),           // patched below with the table address
    'find:', o.lhu(r.t1, 0, r.t0), o.nop(), o.beqz(r.t1, 'done'), o.nop(),
    o.beq(r.t1, r.a0, 'found'), o.nop(), o.beq(r.zero, r.zero, 'find'), o.addiu(r.t0, r.t0, 12),
    'found:', o.move(r.s0, r.t0), o.lbu(r.t2, 3, r.s0), o.nop(),
    o.andi(r.t3, r.t2, DASH), o.beqz(r.t3, 'shot'), o.lui(r.t4, hi(DASH_MODE)),
    o.lw(r.t4, lo(DASH_MODE), r.t4), o.nop(), o.bnez(r.t4, 'first'), o.nop(),
    'shot:', o.andi(r.t3, r.t2, SHOT4), o.beqz(r.t3, 'pick'), o.lui(r.t4, hi(SHOT_LEVEL)),
    o.lw(r.t4, lo(SHOT_LEVEL), r.t4), o.addiu(r.t5, r.zero, 4), o.bne(r.t4, r.t5, 'pick'), o.nop(),
    o.jal(PLAY), o.addiu(r.a0, r.zero, ID.EnergyShot4),
    'pick:', o.lbu(r.t2, 2, r.s0), o.addiu(r.t3, r.zero, 1), o.beq(r.t2, r.t3, 'first'), o.nop(),
    o.jal(RAND), o.nop(), o.lbu(r.t2, 2, r.s0), o.nop(), divu(r.v0, r.t2), mfhi(r.t3),
    o.sll(r.t3, r.t3, 1), o.addu(r.t3, r.s0, r.t3), o.beq(r.zero, r.zero, 'play'), o.lhu(r.a0, 4, r.t3),
    'first:', o.lhu(r.a0, 4, r.s0),
    'play:', o.jal(PLAY), o.nop(),
    'done:', o.lw(r.ra, 20, r.sp), o.lw(r.s0, 16, r.sp), o.jr(r.ra), o.addiu(r.sp, r.sp, 24),
  ];
  const first = assemble(VOICE, code), tableAt = first.end;
  code[3] = o.lui(r.t0, hi(tableAt)); code[4] = o.addiu(r.t0, r.t0, lo(tableAt));
  const a = assemble(VOICE, code);
  const table = Buffer.alloc((VOICES.length + 1) * 12);
  VOICES.forEach(([key, flags, ids], i) => {
    table.writeUInt16LE(key, i * 12); table[i * 12 + 2] = ids.length; table[i * 12 + 3] = flags;
    ids.forEach((id, k) => table.writeUInt16LE(id, i * 12 + 4 + k * 2));
  });
  const blob = Buffer.concat([bytes(a.words), table]);
  if (VOICE + blob.length > DEAD_END) throw new Error('Voice lookup does not fit the dead voice code.');
  return {code: a, tableAt, blob};
}

const J = to => (0x08000000 | ((to >>> 2) & 0x3FFFFFF)) >>> 0, JAL = to => (0x0C000000 | ((to >>> 2) & 0x3FFFFFF)) >>> 0;
const LI = (reg, v) => o.addiu(reg, r.zero, v), ORI_A0 = v => o.ori(r.a0, r.zero, v);
// [ram, old, new, what]
function words() {
  return [
    [0x8014F340, JAL(0x8014F3F0), JAL(VOICE), 'MarPlaySfx voice half: call the new lookup (was the bank-fingerprint gate)'],
    [0x8014F344, 0, o.move(r.a0, r.s0), 'MarPlaySfx: lookup gets the Maria ID'],
    [0x8014F34C, 0x10400015, 0x10000015, 'MarPlaySfx: always skip the old Richter-slot voice table'],
    [0x8013C824, 0, JAL(DISPATCH), 'running kick / Dash Kick voice (0x71D) back on'],
    [0x8013E3B8, 0, JAL(DISPATCH), 'High Jump voice back on'],
    [0x8013E3BC, LI(r.a0, 0x71D), LI(r.a0, 0x71E), 'High Jump voice: its own ID 0x71E'],
    [0x8013D338, 0x8FBF0014, J(0x8013D31C), 'spell 5 Four Holy Beasts: play a voice too'],
    [0x8013D33C, 0x8FB00010, LI(r.a0, 0x5DA), 'spell 5 voice ID 0x5DA'],
    [0x8013C6FC, JAL(DISPATCH), JAL(PLAY), 'slide: play directly'],
    [0x8013C700, LI(r.a0, 0x617), LI(r.a0, 0x60C), 'slide: SFX_WEAPON_SWISH_C (common sample 48)'],
    [0x8012CEDC, ORI_A0(0x6A8), ORI_A0(ID.EnergyShot3), 'Energy Shot 3 launch sound'],
    [0x8012BC68, ORI_A0(0x68F), ORI_A0(0x68E), 'heart-paid heal: SFX_HEALTH_PICKUP (Alucard potion sound)'],
  ];
}

// stream: STREAM_SECTORS of user data; dra: DRA.BIN; banks as in buildBank. Returns patched copies.
function apply({stream, dra, vh, vb, mad, banks, rawOffset}) {
  const s = Buffer.from(stream), d = Buffer.from(dra), list = words(), prog = voiceProgram();
  const at = ram => R1.streamOffset(ram);
  if (s.readUInt32LE(at(list[0][0])) === list[0][2]) return {applied: true};
  if (mad.readUInt32LE(MAD_VH_REC) !== VH.lba || mad.readUInt32LE(MAD_VH_REC + 8) !== VH.size ||
      mad.readUInt32LE(MAD_VB_REC) !== VB.lba || mad.readUInt32LE(MAD_VB_REC + 8) !== VB.size) throw new Error('MAD.BIN voice bank records moved.');
  if (sha(s.subarray(at(VOICE), at(DEAD_END))) !== DEAD_SHA) throw new Error('The dead voice code at 0x8014FA20 changed.');
  const edits = [];
  for (const [ram, old, w, what] of list) {
    const cur = s.readUInt32LE(at(ram));
    if (cur !== old >>> 0) throw new Error(`${hex(ram)} (${what}) is ${hex(cur)}, expected ${hex(old)}.`);
    s.writeUInt32LE(w >>> 0, at(ram)); edits.push({at: hex(ram), old: hex(old), new: hex(w), what});
  }
  prog.blob.copy(s, at(VOICE));
  edits.push({at: hex(VOICE), size: hex(prog.blob.length), what: `voice lookup (${prog.code.words.length} words) and table at ${hex(prog.tableAt)}`});
  const sfx = sfxEntries();
  for (const e of sfx) {
    const off = SFX_TABLE + (e.id - 0x600) * 7, cur = [...d.subarray(off, off + 7)];
    if (cur.join() !== e.old.join()) throw new Error(`Sound ${hex(e.id)} is ${cur}, expected ${e.old}.`);
    Buffer.from(e.new).copy(d, off);
  }
  const bank = buildBank(banks, rawOffset);
  if (vh.length !== VH.size || vb.length !== VB.size) throw new Error('Voice bank size differs.');
  return {applied: false, stream: s, dra: d, vh: bank.vh, vb: bank.vb, bank, sfx, edits, voices: VOICES.map(([k, f, ids, what]) => ({key: hex(k), ids: ids.map(hex), flags: f, what}))};
}

module.exports = {apply, buildBank, trim, words, voiceProgram, sfxEntries, SOUNDS, VOICES, ID, VH, VB, VOICE, DEAD_END,
  STREAM_LBA, STREAM_SECTORS, SFX_TABLE, MAD_VH_REC, MAD_VB_REC, DEAD_SHA};
