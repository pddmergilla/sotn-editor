// Maria mode: one Faerie voice on her kick, on her original voice bank laid out the way DRA loads it.
// - Why every Maria voice was static: DRA's VH callback (cd.c, after SsVabOpenHeadSticky) keeps reading the sectors
//   right after the VH as the VB. It never seeks to the VB record; it only takes the VB size from
//   D_800ACC74[vh.unkF] (21 = DRA's SD_RIH VB record, 0xE190). MAD.BIN's loader hook (0x801F02FC) swaps in its own
//   VH record (F_TE5 LBA 42137) but the samples are at F_TE4 LBA 41726 (Maria-Effects-Repair-2A5B9ED9), so slot 1
//   was filled from whatever follows the VH in F_TE5.
// - Why the first fix (Maria-Kick-Voice-F4C4D32B, reverted) hung the loading screen: libsnd stops accepting VB data
//   once the total its VH declares has arrived (vs_vtbp.c); DRA keeps sending 0xE190 bytes, gets -1 and retries
//   forever. Its one-sample VH declared 0xB30.
// - This fix keeps her VH byte for byte (18 samples, 0xE180 declared: the 0x190 extra bytes fall in the last chunk,
//   as before). VH and VB move back to back to the start of the unused debug stage file ST/TE4/F_TE4.BIN (VH LBA
//   41726, VB LBA 41729) and only the MAD.BIN VH record's LBA changes.
// - Faerie sample 7 (BIN 0x4208778, trimmed, with its own end blocks) replaces her sample 18 inside its 0x1F00
//   slot; the rest of the slot is silence that is never reached. Sample 18 is played by tone 2 of program 2 (centre
//   84, the Faerie's own centre is 83), so sound 0x841 (SFX_UNUSED_SHAFT_ATTACK_B, played by nothing) uses note 61.
// - MarPlaySfx's skipped voice half (0x8014F340, after Maria-No-Voices) plays 0x841 when the Maria ID is 0x71F
//   (kick start, 0x8013C7C0); the kick swish from the effect remap still plays first.
const {r, ops: o, assemble} = require('../enemies/mips-asm.js');
const {parseBank} = require('../audio/sound-check.js');
const {trim} = require('./maria-voices.js');
const R1 = require('./maria-effects-repair.js');

const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase();
const STREAM_LBA = R1.STREAM_LBA, STREAM_SECTORS = R1.STREAM_SECTORS;
const MAD_VH_REC = 0x18334, MAD_VB_REC = 0x18344;
const OLD_VH_LBA = 42137, OLD_VB_LBA = 41726, VH_SIZE = 0x1020, VB_SIZE = 0xE180;
const VH_LBA = 41726, VB_LBA = VH_LBA + Math.ceil(VH_SIZE / 2048), VB_READ = 0xE190;  // DRA SD_RIH VB record size
const AREA_SECTORS = Math.ceil(((VB_LBA - VH_LBA) * 2048 + VB_READ) / 2048);
const SFX_TABLE = 0x1F554, ID = 0x841, OLD_SFX = [3, 2, 60, 127, 0, 4, 80], NEW_SFX = [1, 2, 61, 120, 0, 2, 80];
const SAMPLE = {bank: 'SERVANT/SD_FAIRY', index: 7, bin: 0x4208778}, SLOT = 18;
const KICK = 0x71F, PLAY = 0x8012CEBC, EXIT = 0x8014F3A4;

// mariaVh/mariaVb: her bank as shipped (VH at OLD_VH_LBA, VB at OLD_VB_LBA). Returns the VB with sample 18 replaced.
function bank(fairyVh, fairyVb, rawOffset, fairyVbLba, mariaVh, mariaVb) {
  const f = parseBank(fairyVh, fairyVb, {name: SAMPLE.bank}), s = f.samples[SAMPLE.index];
  if (rawOffset(fairyVbLba, s.offset) !== SAMPLE.bin) throw new Error(`Faerie sample ${SAMPLE.index} is not at ${hex(SAMPLE.bin)}.`);
  const m = parseBank(mariaVh, mariaVb, {name: 'Maria voices'}), slot = m.samples[SLOT];
  if (m.samples.length !== 19 || mariaVh.readUInt32LE(12) !== VH_SIZE + VB_SIZE) throw new Error('Her voice bank differs.');
  const tone = m.programs.get(NEW_SFX[1]).tones[NEW_SFX[5]];
  if (tone.sample !== SLOT || tone.center !== 84 || !tone.volume) throw new Error('Program 2 tone 2 no longer plays sample 18.');
  const data = trim(Buffer.from(fairyVb.subarray(s.offset, s.offset + s.size)));
  if (data.length > slot.size) throw new Error('Faerie sample does not fit sample 18.');
  const vb = Buffer.from(mariaVb); vb.fill(0, slot.offset, slot.offset + slot.size); data.copy(vb, slot.offset);
  return {vb, data, kept: data.length, size: s.size, slot: {offset: slot.offset, size: slot.size}};
}

function voiceWords() {
  const a = assemble(0x8014F340, [
    o.addiu(r.v0, r.zero, KICK), o.bne(r.s0, r.v0, EXIT), o.nop(),
    o.jal(PLAY), o.addiu(r.a0, r.zero, ID), o.beq(r.zero, r.zero, EXIT), o.nop()]);
  const old = [0, 0, 0, 0x10000015, 0, 0, 0];
  return a.words.map((w, i) => [0x8014F340 + i * 4, old[i], w]);
}

// area: user data of F_TE4 from VH_LBA (AREA_SECTORS sectors; its start is her current VB); mariaVh: her VH.
function apply({stream, dra, mad, area, fairyVh, fairyVb, fairyVbLba, mariaVh, rawOffset}) {
  const s = Buffer.from(stream), d = Buffer.from(dra), m = Buffer.from(mad), t = Buffer.from(area), at = ram => R1.streamOffset(ram);
  const words = voiceWords();
  if (s.readUInt32LE(at(words[0][0])) === words[0][2]) return {applied: true};
  const edits = [];
  for (const [ram, old, w] of words) {
    const cur = s.readUInt32LE(at(ram));
    if (cur !== old) throw new Error(`${hex(ram)} is ${hex(cur)}, expected ${hex(old)} (apply Maria-No-Voices first).`);
    s.writeUInt32LE(w, at(ram)); edits.push({at: hex(ram), old: hex(old), new: hex(w)});
  }
  const off = SFX_TABLE + (ID - 0x600) * 7;
  if ([...d.subarray(off, off + 7)].join() !== OLD_SFX.join()) throw new Error(`Sound ${hex(ID)} is in use.`);
  Buffer.from(NEW_SFX).copy(d, off);
  if (m.readUInt32LE(MAD_VH_REC) !== OLD_VH_LBA || m.readUInt32LE(MAD_VH_REC + 8) !== VH_SIZE || m.readUInt32LE(MAD_VB_REC) !== OLD_VB_LBA ||
      m.readUInt32LE(MAD_VB_REC + 8) !== VB_SIZE) throw new Error('MAD.BIN voice bank records differ.');
  m.writeUInt32LE(VH_LBA, MAD_VH_REC);
  const b = bank(fairyVh, fairyVb, rawOffset, fairyVbLba, mariaVh, Buffer.from(area.subarray(0, VB_SIZE)));
  t.fill(0, 0, (VB_LBA - VH_LBA) * 2048 + VB_READ);
  mariaVh.copy(t, 0); b.vb.copy(t, (VB_LBA - VH_LBA) * 2048);
  return {applied: false, stream: s, dra: d, mad: m, area: t, bank: b, edits};
}

module.exports = {apply, bank, voiceWords, STREAM_LBA, STREAM_SECTORS, MAD_VH_REC, MAD_VB_REC, VH_LBA, VB_LBA, VH_SIZE, VB_SIZE, VB_READ,
  AREA_SECTORS, SFX_TABLE, ID, NEW_SFX, SAMPLE, SLOT, OLD_VH_LBA};
