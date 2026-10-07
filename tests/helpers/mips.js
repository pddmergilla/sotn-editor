const assert = require('node:assert/strict');
const K = require('../../stats-core.js');

// Check the game instructions.
function machine(code, hooks = new Map()) {
  const memory = new Map();
  const put = (addr, size, value) => { for (let i = 0; i < size; i++) memory.set((addr + i) >>> 0, value >>> (i * 8) & 255); };
  const get = (addr, size) => {
    addr >>>= 0;
    const part = code.find(c => addr >= c.base && addr + size <= c.base + c.bytes.length);
    let value = 0;
    for (let i = 0; i < size; i++) value |= (memory.has((addr + i) >>> 0) ? memory.get((addr + i) >>> 0) : part ? part.bytes[addr - part.base + i] : 0) << (i * 8);
    return value;
  };
  function run(start, initial = {}) {
    const r = new Int32Array(32); r[29] = 0x801FF000; r[31] = -1;
    for (const [reg, value] of Object.entries(initial)) r[reg] = value;
    let pc = start >>> 0, branch = null, load = null, lo = 0, hi = 0;
    for (let n = 0; n < 20000; n++) {
      if (pc === 0xFFFFFFFF) return r;
      if (hooks.has(pc)) {
        assert.equal(branch, null); assert.equal(load, null);
        if (hooks.get(pc)(r, {get, put}) === 'stop') return r;
        pc = r[31] >>> 0; continue;
      }
      assert.ok(code.some(c => pc >= c.base && pc + 4 <= c.base + c.bytes.length), `Unknown instruction address ${pc.toString(16)}`);
      const w = get(pc, 4) >>> 0, op = w >>> 26, rs = w >>> 21 & 31, rt = w >>> 16 & 31, rd = w >>> 11 & 31;
      const imm = w << 16 >> 16, addr = (r[rs] + imm) >>> 0;
      let next = null, nextLoad = null, written = null;
      const set = (reg, value) => { r[reg] = value; written = reg; };
      if (op === 0) {
        const f = w & 63, shift = w >>> 6 & 31;
        if (f === 0) set(rd, r[rt] << shift);
        else if (f === 2) set(rd, r[rt] >>> shift);
        else if (f === 3) set(rd, r[rt] >> shift);
        else if (f === 0x21) set(rd, r[rs] + r[rt]);
        else if (f === 0x23) set(rd, r[rs] - r[rt]);
        else if (f === 0x24) set(rd, r[rs] & r[rt]);
        else if (f === 0x25) set(rd, r[rs] | r[rt]);
        else if (f === 0x26) set(rd, r[rs] ^ r[rt]);
        else if (f === 0x2A) set(rd, Number(r[rs] < r[rt]));
        else if (f === 0x2B) set(rd, Number((r[rs] >>> 0) < (r[rt] >>> 0)));
        else if (f === 8 || f === 9) { next = r[rs] >>> 0; if (f === 9) set(rd, pc + 8); }
        else if (f === 0x18) { const v = BigInt(r[rs]) * BigInt(r[rt]); lo = Number(BigInt.asIntN(32, v)); hi = Number(BigInt.asIntN(32, v >> 32n)); }
        else if (f === 0x12) set(rd, lo);
        else if (f === 0x10) set(rd, hi);
        else throw Error(`Unsupported attack instruction ${w.toString(16)}`);
      } else if (op === 15) set(rt, (w & 65535) << 16);
      else if (op === 9) set(rt, r[rs] + imm);
      else if (op === 10) set(rt, Number(r[rs] < imm));
      else if (op === 11) set(rt, Number((r[rs] >>> 0) < (imm >>> 0)));
      else if (op === 12) set(rt, r[rs] & (w & 65535));
      else if (op === 13) set(rt, r[rs] | (w & 65535));
      else if (op === 14) set(rt, r[rs] ^ (w & 65535));
      else if ([32, 33, 35, 36, 37].includes(op)) {
        const size = op === 35 ? 4 : op === 33 || op === 37 ? 2 : 1, value = get(addr, size);
        nextLoad = [rt, op === 32 ? value << 24 >> 24 : op === 33 ? value << 16 >> 16 : value];
      } else if ([40, 41, 43].includes(op)) put(addr, op === 43 ? 4 : op === 41 ? 2 : 1, r[rt]);
      else if (op === 4 || op === 5) { if ((r[rs] === r[rt]) === (op === 4)) next = pc + 4 + imm * 4; }
      else if (op === 6 || op === 7) { if (op === 6 ? r[rs] <= 0 : r[rs] > 0) next = pc + 4 + imm * 4; }
      else if (op === 1) { assert.ok(rt === 0 || rt === 1); if ((r[rs] < 0) === (rt === 0)) next = pc + 4 + imm * 4; }
      else if (op === 2 || op === 3) { if (op === 3) set(31, pc + 8); next = K.branchTarget(w, pc); }
      else throw Error(`Unsupported attack instruction ${w.toString(16)} at ${pc.toString(16)}`);
      if (load && written !== load[0]) r[load[0]] = load[1];
      r[0] = 0; pc = (branch === null ? pc + 4 : branch) >>> 0; branch = next; load = nextLoad;
    }
    throw Error('Attack check did not finish.');
  }
  return {put, get, run, hooks};
}

module.exports = {machine};
