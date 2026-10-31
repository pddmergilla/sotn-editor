// Maria mode: her own attack grunts and pain yelps (replaces the Faerie voices of Maria-Voices-Full-DA575EEE).
// - Her bank as shipped (VH and VB at F_TE4 LBA 41726/41729 since Maria-Kick-Voice-48BD8FEC) holds, besides the six
//   summon lines (program 0, samples 2-7), the ten voices of the decomp's SFX_VO_MAR list in order in programs 1-2:
//   samples 9-13 = the random attack grunts (SFX_VO_MAR_8E6, ATTACK_C, 8E8, 8E9, 8EA), 14 = 8EB,
//   15-17 = PAIN_B, PAIN_C, PAIN_D, 18 = DEATH.
// - Weird voice on every enemy hit: stage collision code (src/st/collision.h) plays SFX_RIC_WHIP_HIT (0x705:
//   vab 1, program 1, tone 8, note 53) for any non-Alucard player. Program 1 tones 8/9 are a silent pair here, so
//   it plays nothing in Maria mode (Richter mode loads SD_RIH and is unaffected).
// - Attack grunts (kick start, running kick, Energy Shot fire) play on one try in three.
// - Same slot-1 layout and declared VB total (0xE180, last slot padded) as Maria-Voices-Full; sound IDs 0x841-0x864.
const crypto = require('node:crypto');
const {r, R, ops: o, assemble, bytes} = require('../enemies/mips-asm.js');
const {parseBank} = require('../audio/sound-check.js');
const V = require('./maria-voices.js');
const F = require('./maria-voices-full.js');
const R1 = require('./maria-effects-repair.js');

const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase();
const PLAY = 0x8012CEBC, RAND = 0x800160E4, DASH_MODE = 0x801319FC, SHOT_LEVEL = 0x8012DED0;
const VOICE = V.VOICE, DEAD_END = V.DEAD_END;

// [name, source ('maria' = her bank as shipped), sample, program, tone, SFX id (null = silent pair), volume, priority]
const LAYOUT = [
  ['Guardian Knuckle', 'maria', 2, 0, 0, 0x841, 127, 90], ['Four Holy Beasts', 'maria', 3, 0, 2, 0x842, 127, 90],
  ['Seiryuu', 'maria', 4, 0, 4, 0x843, 127, 90], ['Suzaku', 'maria', 5, 0, 6, 0x844, 127, 90],
  ['Byakko', 'maria', 6, 0, 8, 0x846, 127, 90], ['Genbu', 'maria', 7, 0, 10, 0x847, 127, 90],
  ['Grunt 8E6', 'maria', 9, 1, 0, 0x848, 127, 80], ['Grunt ATTACK_C', 'maria', 10, 1, 2, 0x849, 127, 80],
  ['Grunt 8E8', 'maria', 11, 1, 4, 0x84A, 127, 80], ['Grunt 8E9', 'maria', 12, 1, 6, 0x84B, 127, 80],
  ['(silent: SFX_RIC_WHIP_HIT)', 'maria', 9, 1, 8, null, 0, 0],
  ['Pain B', 'maria', 15, 2, 0, 0x85E, 127, 85], ['Pain C', 'maria', 16, 2, 2, 0x85F, 127, 85],
  ['Pain D', 'maria', 17, 2, 4, 0x860, 127, 85],
  ['Energy Shot 3', 'ST/NZ1/SD_ZKNZ1', 16, 2, 6, 0x861, 100, 60], ['Energy Shot 4', 'BOSS/RBO5/SD_ZRBO5', 4, 2, 8, 0x862, 120, 60],
];
const PICKED = {'maria:2': 0x5D98708, 'maria:3': 0x5D9A348, 'maria:4': 0x5D9C2B8, 'maria:5': 0x5D9CF08, 'maria:6': 0x5D9DC88,
  'maria:7': 0x5D9E878, 'ST/NZ1/SD_ZKNZ1:16': 0x5569058, 'BOSS/RBO5/SD_ZRBO5:4': 0x684F898};
const IDS = Object.fromEntries(LAYOUT.filter(l => l[5]).map(l => [l[0], l[5]]));
const GRUNTS = ['Grunt 8E6', 'Grunt ATTACK_C', 'Grunt 8E8', 'Grunt 8E9'].map(n => IDS[n]);
const PAINS = ['Pain B', 'Pain C', 'Pain D'].map(n => IDS[n]);
const DASH = 1, SHOT4 = 2, CHANCE = 4;
const VOICES = [
  [0x71F, CHANCE, GRUNTS, 'kick start (0x8013C7C0)'],
  [0x71C, CHANCE | SHOT4, GRUNTS, 'Energy Shot fire; Energy Shot 4 also plays its sound'],
  [0x71D, CHANCE | DASH, [IDS['Grunt ATTACK_C'], ...GRUNTS.filter(i => i !== IDS['Grunt ATTACK_C'])], 'running kick; ATTACK_C always during the air dash (Dash Kick)'],
  [0x71E, 0, [IDS['Grunt ATTACK_C']], 'High Jump'],
  [0x5CC, 0, [IDS['Guardian Knuckle']], 'spell 0 Guardian Knuckle'], [0x5D3, 0, [IDS.Genbu], 'spell 1 Genbu'],
  [0x5D2, 0, [IDS.Byakko], 'spell 2 Byakko'], [0x5D1, 0, [IDS.Seiryuu], 'spell 3 Seiryuu'],
  [0x5D0, 0, [IDS.Suzaku], 'spell 4 Suzaku'], [0x5DA, 0, [IDS['Four Holy Beasts']], 'spell 5 Four Holy Beasts'],
  ...[0x5D4, 0x5D5, 0x5D6, 0x5D7, 0x5D8].map(k => [k, 0, PAINS, 'damage / grab reaction']),
];
// Current entries (Maria-Voices-Full values; 0x864 is unused vanilla).
const NEW_IDS = [...new Set(LAYOUT.filter(l => l[5]).map(l => l[5]))];

function toneAt(vh, prog, tone) {
  let packed = 0; for (let p = 0; p < prog; p++) if (vh[32 + p * 16]) packed++;
  return Buffer.from(vh.subarray(0x820 + packed * 512 + tone * 32, 0x820 + packed * 512 + tone * 32 + 32));
}
// banks: {maria: {vh, vb, vbLba}, ...}; maria = her bank as shipped (from Maria-Kick-Voice, sample 18 replaced).
function bank(banks, rawOffset) {
  const parsed = {}; for (const [k, b] of Object.entries(banks)) parsed[k] = parseBank(b.vh, b.vb, {name: k});
  const samples = [], index = new Map();
  for (const [name, src, idx] of LAYOUT) {
    const key = `${src}:${idx}`; if (index.has(key)) continue;
    const s = parsed[src].samples[idx];
    if (PICKED[key] !== undefined && rawOffset(banks[src].vbLba, s.offset) !== PICKED[key]) throw new Error(`${name}: not at ${hex(PICKED[key])}.`);
    const raw = Buffer.from(banks[src].vb.subarray(s.offset, s.offset + s.size));
    index.set(key, samples.length + 1); samples.push({name, src, idx, raw, data: V.trim(raw)});
  }
  if (parsed.maria.samples.length !== 19) throw new Error('Her bank differs.');
  const vbSize = F.VB_SIZE, vb = Buffer.alloc(vbSize), offs = []; let at = 0;
  for (const s of samples) { offs.push(at); s.data.copy(vb, at); at += s.data.length; }
  if (at > vbSize) throw new Error(`Bank needs ${hex(at)} bytes.`);
  const mvh = banks.maria.vh, vh = Buffer.alloc(F.VH_SIZE); mvh.copy(vh, 0, 0, 0x820);
  for (let p = 0; p < 128; p++) vh[32 + p * 16] = 0;
  const count = [0, 0, 0];
  for (const [name, src, idx, prog, tone, id, vol] of LAYOUT) {
    const b = parsed[src]; let sp = -1, st = -1;
    for (const [p, v] of b.programs) { const t = v.tones.findIndex(t => t.sample === idx); if (t >= 0 && !(t & 1)) { sp = p; st = t; break; } }
    if (st < 0) throw new Error(`${name}: no source tone.`);
    [0, 1].forEach(h => {
      const t = toneAt(banks[src].vh, sp, st + h); t.writeUInt16LE(prog, 20); t.writeUInt16LE(index.get(`${src}:${idx}`), 22);
      if (!id) t[2] = 0;                                   // silent pair
      t.copy(vh, 0x820 + prog * 512 + (tone + h) * 32);
    });
    count[prog] = Math.max(count[prog], tone + 2);
  }
  count.forEach((n, p) => { vh[32 + p * 16] = n; });
  const table = 0x820 + 3 * 512;
  vh.writeUInt16LE(mvh.readUInt16LE(0x820 + mvh.readUInt16LE(18) * 512), table);
  samples.forEach((s, i) => vh.writeUInt16LE((i === samples.length - 1 ? vbSize - offs[i] : s.data.length) / 8, table + (i + 1) * 2));
  vh.writeUInt32LE(F.VH_SIZE + vbSize, 12); vh.writeUInt16LE(3, 18); vh.writeUInt16LE(count.reduce((a, n) => a + n, 0), 20); vh.writeUInt16LE(samples.length, 22);
  return {vh, vb, used: at, samples: samples.map((s, i) => ({name: s.name, from: s.src, sample: s.idx, size: hex(s.raw.length), kept: hex(s.data.length), vbOffset: hex(offs[i]), sha256: sha(s.data)}))};
}

function sfxEntries() {
  return LAYOUT.filter(l => l[5]).map(([name, , , prog, tone, id, vol, pri]) => ({id, name, new: [1, prog, 60, vol, 0, tone, pri]}));
}

const divu = (s, t) => R(s, t, 0, 0, 0x1B), mfhi = d => R(0, 0, d, 0, 0x10);
const hi = a => ((a + 0x8000) >>> 16) & 0xFFFF, lo = a => a & 0xFFFF;
function voiceProgram() {
  const code = tableAt => [
    o.addiu(r.sp, r.sp, -24), o.sw(r.ra, 20, r.sp), o.sw(r.s0, 16, r.sp),
    o.lui(r.t0, hi(tableAt)), o.addiu(r.t0, r.t0, lo(tableAt)),
    'find:', o.lhu(r.t1, 0, r.t0), o.nop(), o.beqz(r.t1, 'done'), o.nop(),
    o.beq(r.t1, r.a0, 'found'), o.nop(), o.beq(r.zero, r.zero, 'find'), o.addiu(r.t0, r.t0, 12),
    'found:', o.move(r.s0, r.t0), o.lbu(r.t2, 3, r.s0), o.nop(),
    o.andi(r.t3, r.t2, DASH), o.beqz(r.t3, 'shot'), o.lui(r.t4, hi(DASH_MODE)),
    o.lw(r.t4, lo(DASH_MODE), r.t4), o.nop(), o.bnez(r.t4, 'first'), o.nop(),
    'shot:', o.lbu(r.t2, 3, r.s0), o.nop(), o.andi(r.t3, r.t2, SHOT4), o.beqz(r.t3, 'chance'), o.lui(r.t4, hi(SHOT_LEVEL)),
    o.lw(r.t4, lo(SHOT_LEVEL), r.t4), o.addiu(r.t5, r.zero, 4), o.bne(r.t4, r.t5, 'chance'), o.nop(),
    o.jal(PLAY), o.addiu(r.a0, r.zero, IDS['Energy Shot 4']),
    'chance:', o.lbu(r.t2, 3, r.s0), o.nop(), o.andi(r.t3, r.t2, CHANCE), o.beqz(r.t3, 'pick'), o.nop(),
    o.jal(RAND), o.nop(), o.addiu(r.t3, r.zero, 3), divu(r.v0, r.t3), mfhi(r.t3), o.bnez(r.t3, 'done'), o.nop(),
    'pick:', o.lbu(r.t2, 2, r.s0), o.addiu(r.t3, r.zero, 1), o.beq(r.t2, r.t3, 'first'), o.nop(),
    o.jal(RAND), o.nop(), o.lbu(r.t2, 2, r.s0), o.nop(), divu(r.v0, r.t2), mfhi(r.t3),
    o.sll(r.t3, r.t3, 1), o.addu(r.t3, r.s0, r.t3), o.beq(r.zero, r.zero, 'play'), o.lhu(r.a0, 4, r.t3),
    'first:', o.lhu(r.a0, 4, r.s0),
    'play:', o.jal(PLAY), o.nop(),
    'done:', o.lw(r.ra, 20, r.sp), o.lw(r.s0, 16, r.sp), o.jr(r.ra), o.addiu(r.sp, r.sp, 24),
  ];
  const tableAt = assemble(VOICE, code(0)).end, a = assemble(VOICE, code(tableAt));
  const table = Buffer.alloc((VOICES.length + 1) * 12);
  VOICES.forEach(([key, flags, ids], i) => {
    table.writeUInt16LE(key, i * 12); table[i * 12 + 2] = ids.length; table[i * 12 + 3] = flags;
    ids.forEach((id, k) => table.writeUInt16LE(id, i * 12 + 4 + k * 2));
  });
  const blob = Buffer.concat([bytes(a.words), table]);
  if (VOICE + blob.length > DEAD_END) throw new Error('Voice lookup does not fit.');
  return {code: a, tableAt, blob};
}

// stream/dra/area as in maria-voices-full.apply; dra must hold the Maria-Voices-Full entries.
function apply({stream, dra, area, banks, rawOffset}) {
  const s = Buffer.from(stream), d = Buffer.from(dra), t = Buffer.from(area), at = ram => R1.streamOffset(ram);
  const prog = voiceProgram(), old = V.voiceProgram();
  const cur = s.subarray(at(VOICE), at(VOICE) + prog.blob.length);
  if (cur.equals(prog.blob)) return {applied: true};
  if (!s.subarray(at(VOICE), at(VOICE) + old.blob.length).equals(old.blob)) throw new Error('Apply Maria-Voices-Full-DA575EEE first (voice lookup).');
  if (s.readUInt32LE(at(0x8014F340)) !== F.words()[0][2]) throw new Error('MarPlaySfx voice half differs.');
  s.fill(0, at(VOICE), at(VOICE) + Math.max(prog.blob.length, old.blob.length));
  prog.blob.copy(s, at(VOICE));
  const fullOld = Object.fromEntries(V.sfxEntries().map(e => [e.id, e.new]));
  const sfx = sfxEntries().map(e => ({...e, old: fullOld[e.id] || [3, 4, 60, 127, 0, 12, 80]}));
  for (const e of sfx) {
    const off = V.SFX_TABLE + (e.id - 0x600) * 7, c = [...d.subarray(off, off + 7)];
    if (c.join() !== e.old.join()) throw new Error(`Sound ${hex(e.id)} is ${c}, expected ${e.old}.`);
    Buffer.from(e.new).copy(d, off);
  }
  const b = bank(banks, rawOffset);
  t.fill(0, 0, (F.VB_LBA - F.VH_LBA) * 2048 + F.VB_READ);
  b.vh.copy(t, 0); b.vb.copy(t, (F.VB_LBA - F.VH_LBA) * 2048);
  return {applied: false, stream: s, dra: d, area: t, bank: b, sfx,
    lookup: {at: hex(VOICE), size: hex(prog.blob.length), table: hex(prog.tableAt)},
    voices: VOICES.map(([k, f, ids, what]) => ({key: hex(k), ids: ids.map(hex), flags: f, what}))};
}

module.exports = {apply, bank, sfxEntries, voiceProgram, LAYOUT, VOICES, IDS, NEW_IDS};
