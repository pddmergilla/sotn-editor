const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const K = require('../../stats-core.js'), M = require('../../stats-model.js');
// Life Apple auto-revive v2: rewrites the v1 helper (built 2026-10-12, already in the ASS 2.0 BIN) in place.
// HUD: up to 5 small (8x8) Life Apple icons under the HP/MP/hearts box, gold while charged, grey once used.
// Revive: a soft additive white flash; HP/MP return at its peak (as the Faerie does), then Alucard stands up.
const BASE = M.DRA_BASE, ITEM = 0x92, ICON = 154, PAL = 149, MAX = 5;
const ICON_GFX = 0x25324, ICON_PAL = 0x388D4, iconStart = n => ICON_GFX + n * 0x80;
// v1 helper (icons 294-301) plus the slack and blank icon 302 after it; icon 303 is another mod's.
const CAVE = 0x2E624, CAVE_END = iconStart(303), V1_END = 0x2EA00;
// RAM variables in blank icon 275 (file bytes stay zero): used charges, revive frame, flash prim + 1, HUD prims.
const VARS = 0x800CDCA4, VARS_END = VARS + 8;
// The current image reused icon 275 for other code and has load/init wrappers
// clearing 0x800CDCB0 before reaching the v2 reset. Keep that code intact and relocate our state into
// the verified blank tail after those wrappers, before the damage-number flag.
const LOAD_VARS = 0x800CE378;
const V = {used: 0, rev: 1, fl: 2, hud: 4};
// Game addresses (US DRA, checked against this BIN by prepare()).
const A = {
  unk28: 0x80097420, stepS: 0x80073406, count: 0x8009798A + ITEM,
  hp: 0x80097BA0, hpMax: 0x80097BA4, heartsMax: 0x80097BAC, mp: 0x80097BB0, mpMax: 0x80097BB4, d73FC: 0x800973FC,
  servant: 0x8006CBC4, ent8: 0x800739B8, ent64: 0x800762D8, primBuf: 0x80086FEC, playable: 0x8003C9A0, stage: 0x800974A0,
  palCur: 0x80137538, clutSlot29: 0x800705CC + 29 * 32, clutRowFE: 0x800707CC,
  LoadEquipIcon: 0x800EB534, AllocPrimitives: 0x800EDC80, AllocPrimitivesReverse: 0x800EDD9C,
  FreePrimitives: 0x800EDE78, DestroyEntity: 0x80106590, LoadClut: 0x80011218
};
// HUD layout (screen pixels). The ASS HUD box spans y 8-32 and the subweapon frame y 5-37.
const HUD = {x: 36, y: 34, size: 8, step: 9, gold: 30, grey: 29};
// Revive timeline in frames: the flash starts FLASH frames after the death check, peaks (HP/MP restored)
// PEAK frames later, and has faded out (Alucard stands up) at FINISH.
const FLASH = 30, PEAK = 32, FINISH = 96;
// g_Servant while the Faerie is the summoned familiar (FAM_ACTIVE_FAERIE; her overlay TT_002 is g_Servant - 1).
const FAERIE = 3;
// Hook sites: [file offset, v1 word]. Kill and tick hooks become jal; the rest jump to stubs.
const HOOKS = {
  kill1: [0x753D0, 0x080339A2], kill2: [0x75F88, 0x080339AA], tick: [0x75BE8, 0x080339E1],
  hudInit: [0x61A68, 0x08033A47], hudTick: [0x624C0, 0x08033A41],
  resetLoad: [0x4A47C, 0x08033A78], resetInit: [0x5F9D8, 0x08033A70], resetSave: [0x65754, 0x08033A68]
};
const R = {zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, t2: 10, t3: 11, t4: 12, t5: 13, t6: 14, t7: 15,
  s0: 16, s1: 17, s2: 18, t8: 24, t9: 25, sp: 29, ra: 31};
const hi = a => (a + 0x8000) >>> 16 & 0xFFFF, lo = a => a & 0xFFFF;
const vo = key => (VARS + V[key]) - 0x800D0000;

// Minimal MIPS assembler with labels.
function assembler(base) {
  const words = [], fix = [], labels = {};
  const I = (op, rs, rt, imm) => words.push(((op << 26) | (R[rs] << 21) | (R[rt] << 16) | (imm & 0xFFFF)) >>> 0);
  const S = (f, rs, rt, rd, sh = 0) => words.push(((R[rs] << 21) | (R[rt] << 16) | (R[rd] << 11) | (sh << 6) | f) >>> 0);
  const B = (op, rs, rt, label, rtNum) => { fix.push([words.length, label]); words.push(((op << 26) | (R[rs] << 21) | ((rtNum ?? R[rt]) << 16)) >>> 0); };
  const J = (op, target) => words.push(((op << 26) | (target >>> 2 & 0x3FFFFFF)) >>> 0);
  const a = {
    label: name => { assert.ok(!(name in labels), name); labels[name] = base + words.length * 4; },
    nop: () => words.push(0),
    lui: (rt, imm) => I(15, 'zero', rt, imm), ori: (rt, rs, imm) => I(13, rs, rt, imm), xori: (rt, rs, imm) => I(14, rs, rt, imm), andi: (rt, rs, imm) => I(12, rs, rt, imm),
    addiu: (rt, rs, imm) => I(9, rs, rt, imm), slti: (rt, rs, imm) => I(10, rs, rt, imm), sltiu: (rt, rs, imm) => I(11, rs, rt, imm),
    lw: (rt, off, rs) => I(35, rs, rt, off), lhu: (rt, off, rs) => I(37, rs, rt, off), lbu: (rt, off, rs) => I(36, rs, rt, off),
    sw: (rt, off, rs) => I(43, rs, rt, off), sh: (rt, off, rs) => I(41, rs, rt, off), sb: (rt, off, rs) => I(40, rs, rt, off),
    addu: (rd, rs, rt) => S(0x21, rs, rt, rd), subu: (rd, rs, rt) => S(0x23, rs, rt, rd), or: (rd, rs, rt) => S(0x25, rs, rt, rd),
    slt: (rd, rs, rt) => S(0x2A, rs, rt, rd), sltu: (rd, rs, rt) => S(0x2B, rs, rt, rd),
    sll: (rd, rt, sh) => S(0, 'zero', rt, rd, sh), move: (rd, rs) => S(0x21, rs, 'zero', rd),
    jr: rs => S(8, rs, 'zero', 'zero'),
    beq: (rs, rt, l) => B(4, rs, rt, l), bne: (rs, rt, l) => B(5, rs, rt, l), b: l => B(4, 'zero', 'zero', l),
    bltz: (rs, l) => B(1, rs, 'zero', l, 0), bgez: (rs, l) => B(1, rs, 'zero', l, 1),
    j: t => J(2, t), jal: t => J(3, t), jalL: l => { fix.push([words.length, l, 'jal']); words.push(0x0C000000); },
    li: (rt, value) => { if (value >>> 16) { a.lui(rt, value >>> 16); if (value & 0xFFFF) a.ori(rt, rt, value & 0xFFFF); } else a.ori(rt, 'zero', value); },
    la: (rt, addr) => { a.lui(rt, hi(addr)); a.addiu(rt, rt, lo(addr)); },
    half: values => { for (let n = 0; n < values.length; n += 2) words.push(((values[n] & 0xFFFF) | ((values[n + 1] ?? 0) & 0xFFFF) << 16) >>> 0); },
    here: () => base + words.length * 4, labels,
    link() {
      for (const [at, label, kind] of fix) {
        assert.ok(label in labels, `Missing label ${label}`);
        if (kind === 'jal') { words[at] = (0x0C000000 | (labels[label] >>> 2 & 0x3FFFFFF)) >>> 0; continue; }
        const delta = (labels[label] - (base + at * 4 + 4)) / 4;
        assert.ok(Number.isInteger(delta) && delta >= -0x8000 && delta < 0x8000);
        words[at] = (words[at] | (delta & 0xFFFF)) >>> 0;
      }
      const b = Buffer.alloc(words.length * 4); words.forEach((w, n) => b.writeUInt32LE(w, n * 4)); return b;
    }
  };
  return a;
}

// Greyscale copy of the Life Apple palette; colour 0 stays transparent and dark colours stay opaque.
function greyPalette(dra) {
  const out = [];
  for (let i = 0; i < 16; i++) {
    const c = K.u16(dra, ICON_PAL + PAL * 32 + i * 2);
    if (!c) { out.push(0); continue; }
    const l = Math.max(1, Math.round(((c & 31) * 0.299 + (c >> 5 & 31) * 0.587 + (c >> 10 & 31) * 0.114) * 0.8));
    out.push((c & 0x8000) | l | l << 5 | l << 10);
  }
  return out;
}

// hearts: revive HP = min(max hearts, max HP) keeping MP, or full HP/MP while the Faerie is summoned. It fits the same
// bytes by setting up the flash prim every frame and hoisting draw's ra load, so reset_* and grey keep their addresses.
function helper(dra, vars = VARS, hearts = false) {
  const vo = key => vars + V[key] - 0x800D0000;
  const a = assembler(BASE + CAVE);
  const primOf = (dst, idx, tmp) => {
    a.sll(dst, idx, 1); a.addu(dst, dst, idx); a.sll(dst, dst, 2); a.addu(dst, dst, idx); a.sll(dst, dst, 2);
    a.la(tmp, A.primBuf); a.addu(dst, dst, tmp);
  };

  // check(): jal from PlayerStepKill's "unk28 == 0xFFF && step_s" test (both copies). Starts a revive when the player
  // is dying, nothing else holds unk28, none is running and a charge is left (charges = min(apples, 5) - used).
  // Returns to the hook's "equal" path, or 0x34 further (the "not equal" target at both sites).
  a.label('check');
  a.lui('t0', 0x8009); a.lw('v1', lo(A.unk28), 't0');
  a.lui('t1', 0x8007); a.lhu('t1', lo(A.stepS), 't1');
  a.bne('v1', 'zero', 'c_out'); a.lui('t2', 0x800D);
  a.beq('t1', 'zero', 'c_out'); a.lbu('t3', vo('rev'), 't2');
  a.lui('t1', 0x8009);
  a.bne('t3', 'zero', 'c_out'); a.lbu('t1', lo(A.count), 't1');
  a.lbu('t4', vo('used'), 't2');
  a.sltiu('t3', 't1', MAX + 1);
  a.bne('t3', 'zero', 'c_cap'); a.nop(); a.ori('t1', 'zero', MAX);
  a.label('c_cap');
  a.sltu('t3', 't4', 't1');
  a.beq('t3', 'zero', 'c_out'); a.addiu('t4', 't4', 1);
  a.sb('t4', vo('used'), 't2'); a.ori('t3', 'zero', 1); a.sb('t3', vo('rev'), 't2');
  a.ori('v1', 'zero', 0xFFF); a.sw('v1', lo(A.unk28), 't0');
  a.label('c_out');
  a.xori('t5', 'v1', 0xFFF);
  a.beq('t5', 'zero', 'c_ret'); a.ori('v0', 'zero', 0xFFF); a.addiu('ra', 'ra', 0x34);
  a.label('c_ret');
  a.jr('ra'); a.nop();

  // tick(): jal from PlayerStepUnk17 each frame while unk28 holds the player. Runs the flash, restores HP/MP and
  // clears entities 8-63 at its peak like the Faerie, then releases unk28. Returns to the stand-up path when unk28
  // is 0, else 0x50 further (the original "unk28 != 0" target).
  a.label('tick');
  a.addiu('sp', 'sp', -32); a.sw('ra', 24, 'sp'); a.sw('s0', 16, 'sp');
  a.lui('t9', 0x800D); a.lbu('s0', vo('rev'), 't9'); a.sw('s1', 20, 'sp');
  a.beq('s0', 'zero', 't_ret'); a.addiu('s0', 's0', 1);
  a.sb('s0', vo('rev'), 't9');
  a.addiu('s0', 's0', -FLASH); // s0 = flash frame
  a.bltz('s0', 't_ret'); a.nop();
  a.bne('s0', 'zero', 't_level'); a.ori('a0', 'zero', 3);
  // Spawn one full-screen G4: additive, dithered, absolute, under the HUD.
  a.jal(A.AllocPrimitives); a.ori('a1', 'zero', 1);
  a.bltz('v0', 't_level'); a.addiu('t1', 'v0', 1);
  a.lui('t9', 0x800D); a.sh('t1', vo('fl'), 't9');
  const flashSetup = p => {
    a.ori('t3', 'zero', 0x100); a.sw('t3', 0x14, p);
    a.lui('t3', 0x0100); a.sw('t3', 0x20, p); a.ori('t3', 't3', 0x100); a.sw('t3', 0x2C, p);
    a.ori('t3', 'zero', 0x1C0); a.sh('t3', 0x26, p); a.ori('t3', 'zero', 0x2435); a.sh('t3', 0x32, p);
  };
  if (!hearts) { primOf('t1', 'v0', 't2'); flashSetup('t1'); }
  // Level: 4 per frame up to 128 at PEAK, then 2 per frame down to 0 at FINISH.
  a.label('t_level');
  a.slti('t4', 's0', PEAK + 1); a.bne('t4', 'zero', 't_colour'); a.sll('t3', 's0', 2);
  a.sll('t3', 's0', 1); a.ori('t4', 'zero', 128 + 2 * PEAK); a.subu('t3', 't4', 't3');
  a.label('t_colour');
  a.lui('t9', 0x800D); a.lhu('t1', vo('fl'), 't9');
  a.sll('t6', 't3', 8); a.or('t3', 't3', 't6'); a.sll('t6', 't6', 8); a.or('t3', 't3', 't6'); // level 0-128 to grey RGB
  a.beq('t1', 'zero', 't_peak'); a.addiu('t1', 't1', -1);
  primOf('t2', 't1', 't5');
  a.lui('t6', 0x0300); a.or('t6', 't6', 't3');
  a.sw('t6', 0x04, 't2'); a.sw('t3', 0x10, 't2'); a.sw('t3', 0x1C, 't2'); a.sw('t3', 0x28, 't2');
  if (hearts) flashSetup('t2');
  a.label('t_peak');
  a.ori('t4', 'zero', PEAK); a.bne('s0', 't4', 't_fin'); a.lui('t5', 0x8009);
  if (hearts) {
    // Faerie summoned: full HP and MP. Otherwise HP = min(max hearts, max HP) and MP stays as it was.
    a.lui('t7', hi(A.servant)); a.lw('t7', lo(A.servant), 't7');
    a.lw('t6', lo(A.hpMax), 't5'); a.lw('t8', lo(A.heartsMax), 't5');
    a.xori('t7', 't7', FAERIE); a.beq('t7', 'zero', 't_store'); a.lw('t7', lo(A.mpMax), 't5');
    a.sltu('t4', 't8', 't6'); a.beq('t4', 'zero', 't_store'); a.lw('t7', lo(A.mp), 't5');
    a.move('t6', 't8');
    a.label('t_store');
    a.sw('t6', lo(A.hp), 't5'); a.sw('t7', lo(A.mp), 't5');
  } else { a.lw('t6', lo(A.hpMax), 't5'); a.lw('t7', lo(A.mpMax), 't5'); a.sw('t6', lo(A.hp), 't5'); a.sw('t7', lo(A.mp), 't5'); }
  a.la('s1', A.ent8);
  a.label('t_kill');
  a.lhu('t6', 0x26, 's1'); a.ori('t7', 'zero', 0x29);
  a.bne('t6', 't7', 't_kill2'); a.lui('t8', 0x8009); a.sw('zero', lo(A.d73FC), 't8');
  a.label('t_kill2');
  a.jal(A.DestroyEntity); a.move('a0', 's1');
  a.addiu('s1', 's1', 0xBC); a.la('t6', A.ent64);
  a.bne('s1', 't6', 't_kill'); a.nop();
  a.label('t_fin');
  a.ori('t4', 'zero', FINISH); a.bne('s0', 't4', 't_ret'); a.lui('t9', 0x800D);
  a.lhu('a0', vo('fl'), 't9'); a.nop();
  a.beq('a0', 'zero', 't_clear'); a.nop();
  a.jal(A.FreePrimitives); a.addiu('a0', 'a0', -1);
  a.label('t_clear');
  a.lui('t9', 0x800D); a.sb('zero', vo('rev'), 't9'); a.sh('zero', vo('fl'), 't9');
  a.lui('t0', 0x8009); a.sw('zero', lo(A.unk28), 't0');
  a.label('t_ret');
  a.lui('t0', 0x8009); a.lw('t0', lo(A.unk28), 't0');
  a.lw('ra', 24, 'sp'); a.lw('s0', 16, 'sp'); a.lw('s1', 20, 'sp');
  a.beq('t0', 'zero', 't_back'); a.nop(); a.addiu('ra', 'ra', 0x50);
  a.label('t_back');
  a.jr('ra'); a.addiu('sp', 'sp', 32);

  // HUD: DrawHud end (allocate 5 GT4 like the HUD itself) and DrawHudSubweapon end (every HUD frame).
  a.label('hud_init');
  a.lui('t0', 0x800D); a.sw('zero', vo('hud'), 't0');
  a.lui('t1', hi(A.playable)); a.lw('t1', lo(A.playable), 't1');
  a.lui('t2', 0x8009); a.lw('t2', lo(A.stage), 't2'); a.ori('t3', 'zero', 0x1F);
  a.bne('t1', 'zero', 'h_out'); a.nop();
  a.beq('t2', 't3', 'h_out'); a.ori('a0', 'zero', 4);
  a.jal(A.AllocPrimitivesReverse); a.ori('a1', 'zero', MAX);
  a.bltz('v0', 'h_out'); a.nop(); // AllocPrimitivesReverse returns -1 only on PSP; kept for safety
  primOf('t1', 'v0', 't2');
  a.lui('t0', 0x800D); a.jalL('draw'); a.sw('t1', vo('hud'), 't0');
  a.label('h_out');
  a.lw('ra', 40, 'sp'); a.lw('s1', 36, 'sp'); a.j(0x80101A70); a.nop();
  a.label('hud_tick');
  a.jalL('draw'); a.nop(); a.lw('ra', 76, 'sp'); a.lw('s2', 72, 'sp'); a.j(0x801024C8); a.nop();

  a.label('draw');
  a.lui('t0', 0x800D); a.lw('t0', vo('hud'), 't0'); a.addiu('sp', 'sp', -32);
  a.beq('t0', 'zero', 'd_none'); a.sw('ra', 28, 'sp');
  a.ori('a0', 'zero', ICON); a.ori('a1', 'zero', PAL); a.jal(A.LoadEquipIcon); a.ori('a2', 'zero', HUD.gold);
  // Grey: slot 30's pixels drawn through a greyscale CLUT kept in slot 29's palette; 0xFFFE marks it current, so a
  // LoadEquipIcon into slot 29 by anything else makes us rewrite it.
  a.lui('t0', hi(A.palCur)); a.lhu('t1', lo(A.palCur) + HUD.grey * 2, 't0'); a.ori('t3', 'zero', 0xFFFE);
  a.beq('t1', 't3', 'd_count'); a.nop();
  a.la('t0', 0); const greyAt = a.here() - 8;
  a.la('t1', A.clutSlot29); a.ori('t2', 'zero', 16);
  a.label('d_copy');
  a.lhu('t3', 0, 't0'); a.addiu('t0', 't0', 2); a.sh('t3', 0, 't1'); a.addiu('t2', 't2', -1);
  a.bne('t2', 'zero', 'd_copy'); a.addiu('t1', 't1', 2);
  a.la('a0', A.clutRowFE); a.move('a1', 'zero'); a.jal(A.LoadClut); a.ori('a2', 'zero', 0xFE);
  a.lui('t0', hi(A.palCur)); a.ori('t3', 'zero', 0xFFFE); a.sh('t3', lo(A.palCur) + HUD.grey * 2, 't0');
  // v0 = prim, v1 = apples shown (max 5), a2 = charges left, t9 = index, t8 = x.
  a.label('d_count');
  a.lui('t0', 0x8009); a.lbu('v1', lo(A.count), 't0'); a.lui('t1', 0x800D); a.lbu('a2', vo('used'), 't1');
  a.lw('v0', vo('hud'), 't1'); a.sltiu('t2', 'v1', MAX + 1); a.bne('t2', 'zero', 'd_cap'); a.nop(); a.ori('v1', 'zero', MAX);
  a.label('d_cap');
  a.subu('a2', 'v1', 'a2'); a.bgez('a2', 'd_avail'); a.move('t9', 'zero'); a.move('a2', 'zero');
  a.label('d_avail');
  // GT4 type and raw texturing come from the allocation (no DRAW_COLORS). Slot 30 sits at u 0x60, v 0xB0 of tpage
  // 0x1A; only the CLUT index (0x1D0 + slot) differs between gold and grey.
  a.ori('t8', 'zero', HUD.x); a.li('a0', (0x1D0 + HUD.gold) << 16 | 0xB060); a.li('a1', (0x1D0 + HUD.grey) << 16 | 0xB060);
  a.li('t5', 0x001AB070); a.li('t6', 0x01F0C060); a.li('t7', 0x2000C070); // u1v1+tpage, u2v2+priority, u3v3+ABSPOS
  if (hearts) a.lw('ra', 28, 'sp'); // the loop makes no calls; loading ra here drops the nop before jr ra
  a.label('d_loop');
  a.slt('t2', 't9', 'v1'); a.bne('t2', 'zero', 'd_show'); a.ori('t3', 'zero', 8);
  a.b('d_next'); a.sh('t3', 0x32, 'v0');
  a.label('d_show');
  a.slt('t2', 't9', 'a2'); a.bne('t2', 'zero', 'd_set'); a.move('t3', 'a0'); a.move('t3', 'a1');
  a.label('d_set');
  a.sw('t3', 0x0C, 'v0'); a.sw('t5', 0x18, 'v0'); a.sw('t6', 0x24, 'v0'); a.sw('t7', 0x30, 'v0');
  a.lui('t3', HUD.y); a.or('t3', 't3', 't8'); a.sw('t3', 0x08, 'v0'); a.addiu('t3', 't3', HUD.size); a.sw('t3', 0x14, 'v0');
  a.lui('t3', HUD.y + HUD.size); a.or('t3', 't3', 't8'); a.sw('t3', 0x20, 'v0'); a.addiu('t3', 't3', HUD.size); a.sw('t3', 0x2C, 'v0');
  a.label('d_next');
  a.lw('v0', 0, 'v0'); a.addiu('t9', 't9', 1); // the 5 prims end with next == NULL
  a.bne('v0', 'zero', 'd_loop'); a.addiu('t8', 't8', HUD.step);
  if (!hearts) { a.lw('ra', 28, 'sp'); a.nop(); } // load delay before jr ra
  a.label('d_none');
  a.jr('ra'); a.addiu('sp', 'sp', 32);

  // Recharge/reset at load, InitStatsAndGear and the save point: one store clears used charges, the revive frame
  // and the flash prim; then the displaced instructions.
  a.label('reset_load'); a.lui('at', 0x800D); a.sw('zero', vo('used'), 'at'); a.lui('at', 0x8009); a.j(0x800EA484); a.sw('v1', 0x78B8, 'at');
  a.label('reset_init'); a.lui('at', 0x800D); a.sw('zero', vo('used'), 'at'); a.lui('v0', 0x8007); a.j(0x800FF9E0); a.addiu('v0', 'v0', -15501);
  a.label('reset_save'); a.lui('at', 0x800D); a.sw('zero', vo('used'), 'at'); a.lui('at', 0x8013); a.j(0x8010575C); a.sw('v1', 0x79BC, 'at');

  a.label('grey'); a.half(greyPalette(dra));
  const code = a.link(), labels = a.labels, off = greyAt - BASE - CAVE;
  code.writeUInt32LE((code.readUInt32LE(off) & 0xFFFF0000 | hi(labels.grey)) >>> 0, off);
  code.writeUInt32LE((code.readUInt32LE(off + 4) & 0xFFFF0000 | lo(labels.grey)) >>> 0, off + 4);
  assert.ok(CAVE + code.length <= CAVE_END, `Helper is ${CAVE + code.length - CAVE_END} bytes too large.`);
  return {code, labels};
}

// v1 state this patch replaces: helper bytes, its RAM variables (12 bytes, zero on disc) and the hook delay slots.
const V1_SHA = '2730B42216E7338C791D963E6A070762EEF7C88C8A41E878ACCD9F1861C635A2';
const V1_VARS = 12, SLOTS = {kill1: 0xAFB10014, kill2: 0xAFB10014};
// Code ranges scanned for references: DRA .text and the mod code that lives in vanilla-blank icons 276-319.
const CODE = [[iconStart(276), ICON_GFX + 320 * 0x80], [0x42398, 0x962AC]];
const hookWord = (key, labels) => {
  const target = {kill1: 'check', kill2: 'check', tick: 'tick', hudInit: 'hud_init', hudTick: 'hud_tick',
    resetLoad: 'reset_load', resetInit: 'reset_init', resetSave: 'reset_save'}[key];
  return ((['kill1', 'kill2', 'tick'].includes(key) ? 0x0C000000 : 0x08000000) | (labels[target] >>> 2 & 0x3FFFFFF)) >>> 0;
};
// Every j/jal/branch target and hi/lo address in the scanned code that falls in [lo, hi), excluding skip ranges.
function references(dra, lo, hiEnd, skip = []) {
  const found = [];
  for (const [start, end] of CODE) for (let off = start; off + 4 <= end; off += 4) {
    if (skip.some(([a, b]) => off >= a && off < b)) continue;
    const w = K.u32(dra, off), pc = BASE + off, t = K.branchTarget(w, pc);
    if (t !== null && t >= lo && t < hiEnd) found.push({off, target: t});
    if (w >>> 26 === 15) for (let n = 1; n <= 8 && off + n * 4 < end; n++) {
      const x = K.u32(dra, off + n * 4), op = x >>> 26;
      if ((x >>> 21 & 31) !== (w >>> 16 & 31) || ![9, 13, 32, 33, 35, 36, 37, 40, 41, 43].includes(op)) continue;
      const addr = (op === 13 ? (w << 16 | x & 0xFFFF) : (w << 16) + (x << 16 >> 16)) >>> 0;
      if (addr >= lo && addr < hiEnd) found.push({off: off + n * 4, target: addr});
    }
  }
  return found;
}

function prepare(dra) {
  const sha = crypto.createHash('sha256').update(dra.subarray(CAVE, V1_END)).digest('hex').toUpperCase();
  assert.equal(sha, V1_SHA, 'The Life Apple v1 helper is not in this DRA.BIN.');
  assert.ok(dra.subarray(V1_END, CAVE_END).every(v => v === 0), 'The space after the v1 helper is occupied.');
  assert.ok(dra.subarray(VARS - BASE, VARS - BASE + V1_VARS).every(v => v === 0), 'The Life Apple variables are not blank.');
  for (const [key, [off, word]] of Object.entries(HOOKS)) {
    assert.equal(K.u32(dra, off), word, `Unknown ${key} hook.`);
    assert.equal(K.u32(dra, off + 4), SLOTS[key] ?? 0, `Unknown ${key} delay slot.`);
  }
  // The game code and data the helper relies on.
  const m = M.parse({DRA: {bytes: dra, base: BASE}}), row = m.sections.equipRows[ITEM];
  assert.equal(m.get(row.icon), ICON); assert.equal(m.get(row.palette), PAL);
  assert.deepEqual([0, 4, 8, 12].map(n => K.u32(dra, A.LoadEquipIcon - BASE + n)), [0x27BDFFC8, 0xAFB20028, 0x00809021, 0xAFB10024]);
  // LoadEquipIcon: icon pixels at 0x800C5324, palettes at 0x800D88D4, slots at VRAM 0x280+, CLUT copy at
  // &g_Clut[1][0xD00] = 0x800705CC, uploaded as rows 0xFD and 0xFE.
  for (const [n, w] of [[0x44, 0x3C02800C], [0x48, 0x24425324], [0x5C, 0x24470280], [0xA8, 0x3C088007], [0xAC, 0x250805CC],
    [0xB8, 0x3C07800E], [0xBC, 0x24E788D4], [0x100, 0x0C004486], [0x104, 0x340600FD], [0x110, 0x0C004486], [0x114, 0x340600FE]])
    assert.equal(K.u32(dra, A.LoadEquipIcon - BASE + n), w, `Unknown LoadEquipIcon code at +${n.toString(16)}.`);
  for (const [fn, words] of [[A.AllocPrimitives, [0x27BDFFD8, 0xAFB40020]], [A.AllocPrimitivesReverse, [0x27BDFFD8, 0xAFB40020]],
    [A.DestroyEntity, [0x27BDFFE8, 0xAFB00010]]]) assert.deepEqual([K.u32(dra, fn - BASE), K.u32(dra, fn - BASE + 4)], words);
  assert.equal(K.u32(dra, 0x665B8), 0x0C03B79E, 'DestroyEntity no longer frees prims with FreePrimitives.');
  // Nothing outside the v1 helper and its hooks may point into the helper space or the variables.
  const hooks = Object.values(HOOKS).map(([off]) => [off, off + 4]);
  const stray = [...references(dra, BASE + CAVE, BASE + CAVE_END, [[CAVE, CAVE_END], ...hooks]),
    ...references(dra, VARS, VARS + 0x80, [[CAVE, CAVE_END]])];
  assert.deepEqual(stray.map(r => r.off.toString(16)), [], 'Other code references the Life Apple helper space.');

  const {code, labels} = helper(dra), after = new Uint8Array(dra);
  after.set(code, CAVE);
  for (const [key, [off]] of Object.entries(HOOKS)) K.put32(after, off, hookWord(key, labels));
  return {after, code, labels};
}

function prepareLoadFix(dra) {
  // Guard the complete installed v2 helper, including its palette and every
  // instruction; do not infer compatibility from vanilla addresses.
  const installed = helper(dra);
  assert.deepEqual(Buffer.from(dra.subarray(CAVE, CAVE_END)), installed.code,
    'The installed Life Apple v2 helper changed.');
  const wrappers = [
    [0x2E358, [0x3C08800D, 0xAD00DCB0, 0x08033A92, 0]],
    [0x2E368, [0x3C08800D, 0xAD00DCB0, 0x08033A97, 0]]
  ];
  for (const [off, words] of wrappers) words.forEach((word, n) =>
    assert.equal(K.u32(dra, off + n * 4), word, 'Unknown load/init reset wrapper.'));
  for (const [key, [off]] of Object.entries(HOOKS)) {
    const expected = key === 'resetLoad' ? 0x080338D6 : key === 'resetInit' ? 0x080338DA : hookWord(key, installed.labels);
    assert.equal(K.u32(dra, off), expected, `Unknown ${key} hook.`);
    assert.equal(K.u32(dra, off + 4), SLOTS[key] ?? 0, `Unknown ${key} delay slot.`);
  }
  assert.ok(dra.subarray(LOAD_VARS - BASE, LOAD_VARS - BASE + 8).every(v => v === 0),
    'The new Life Apple state space is occupied.');
  assert.deepEqual(references(dra, LOAD_VARS, LOAD_VARS + 8), [],
    'Other code references the new Life Apple state space.');
  for (let off = 0; off + 4 <= dra.length; off += 4) {
    const word = K.u32(dra, off), target = K.branchTarget(word, BASE + off);
    assert.ok(!(word >= LOAD_VARS && word < LOAD_VARS + 8), 'A data pointer uses the new state space.');
    assert.ok(!(target !== null && target >= LOAD_VARS && target < LOAD_VARS + 8), 'Code reaches the new state space.');
  }
  // Guard old bytes as evidence of the overlap, but never clear them on disc.
  assert.deepEqual(Buffer.from(dra.subarray(VARS - BASE, VARS - BASE + 12)),
    Buffer.from('0200e386fcffe1960a006010', 'hex'), 'Unknown code at the old state address.');
  const {code, labels} = helper(dra, LOAD_VARS), after = new Uint8Array(dra);
  after.set(code, CAVE);
  for (const key of ['resetLoad', 'resetInit']) K.put32(after, HOOKS[key][0], hookWord(key, labels));
  return {after, code, labels};
}

// Hearts revive (2026-10-14): replaces the installed fresh-load v2 helper (state at LOAD_VARS) in place. Only
// hud_init/hud_tick move (+4), so only their two hooks change; every other entry keeps its address.
const HEARTS_HOOKS = ['hudInit', 'hudTick'];
function prepareHeartsRevive(dra) {
  const installed = helper(dra, LOAD_VARS);
  assert.deepEqual(Buffer.from(dra.subarray(CAVE, CAVE_END)), installed.code,
    'The installed Life Apple fresh-load v2 helper changed.');
  for (const [key, [off]] of Object.entries(HOOKS)) {
    assert.equal(K.u32(dra, off), hookWord(key, installed.labels), `Unknown ${key} hook.`);
    assert.equal(K.u32(dra, off + 4), SLOTS[key] ?? 0, `Unknown ${key} delay slot.`);
  }
  // Data the new peak reads: g_Status.heartsMax and g_Servant, used by the game at these addresses in this DRA.
  for (const addr of [A.heartsMax, A.servant])
    assert.ok(references(dra, addr, addr + 4).length > 4, `No game code uses ${addr.toString(16)}.`);
  const {code, labels} = helper(dra, LOAD_VARS, true);
  assert.equal(code.length, CAVE_END - CAVE, 'The hearts helper must fill the existing helper space exactly.');
  for (const name of ['check', 'tick', 'reset_load', 'reset_init', 'reset_save', 'grey'])
    assert.equal(labels[name], installed.labels[name], `${name} moved.`);
  // Code outside the helper that reaches into it may only use entries that keep their address (the hooks, and the old
  // load/init wrappers that still jump to reset_load/reset_init).
  const kept = new Set(['check', 'tick', 'reset_load', 'reset_init', 'reset_save'].map(n => labels[n]));
  const hookSpans = HEARTS_HOOKS.map(k => [HOOKS[k][0], HOOKS[k][0] + 4]);
  for (const r of references(dra, BASE + CAVE, BASE + CAVE_END, [[CAVE, CAVE_END], ...hookSpans]))
    assert.ok(kept.has(r.target), `Code at ${r.off.toString(16)} reaches a moved helper address.`);
  const after = new Uint8Array(dra);
  after.set(code, CAVE);
  for (const key of HEARTS_HOOKS) K.put32(after, HOOKS[key][0], hookWord(key, labels));
  return {after, code, labels};
}

module.exports = {BASE, ITEM, ICON, PAL, MAX, CAVE, CAVE_END, V1_END, V1_SHA, VARS, VARS_END, V, A, HUD, HOOKS, CODE,
  FLASH, PEAK, FINISH, FAERIE, HEARTS_HOOKS, prepareHeartsRevive, assembler, greyPalette, helper, hookWord, references, prepare, prepareLoadFix, LOAD_VARS, iconStart, hi, lo};
