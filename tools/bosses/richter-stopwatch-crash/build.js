// Rebuilds code.json from clocks.c and sparkle.c. Needs Zig 0.13.0: set ZIG to zig.exe.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), child = require('node:child_process');
const ZIG = process.env.ZIG, BASE = 0x801C7408, END = 0x801C8590;
const FLAGS = ['-target', 'mipsel-freestanding-none', '-mcpu=mips1', '-Os', '-fno-pic', '-mno-abicalls', '-G0', '-ffunction-sections',
  '-fno-builtin', '-fno-jump-tables', '-mno-check-zero-division', '-falign-functions=4'];
const ENTRIES = ['Stopwatch', 'CrashStopwatch', 'StopwatchSparkle'];
// Symbols from the linked ELF (function entries only).
function symbols(elf) {
  const sh = elf.readUInt32LE(0x20), size = elf.readUInt16LE(0x2E), count = elf.readUInt16LE(0x30);
  const sections = Array.from({length: count}, (_, i) => {
    const o = sh + i * size;
    return {type: elf.readUInt32LE(o + 4), offset: elf.readUInt32LE(o + 16), size: elf.readUInt32LE(o + 20), link: elf.readUInt32LE(o + 24)};
  });
  const table = sections.find(s => s.type === 2), names = sections[table.link], out = {};
  for (let o = table.offset; o < table.offset + table.size; o += 16) {
    let name = ''; for (let i = names.offset + elf.readUInt32LE(o); elf[i]; i++) name += String.fromCharCode(elf[i]);
    if (name && (elf[o + 12] & 15) === 2) out[name] = elf.readUInt32LE(o + 4);
  }
  return out;
}
function compile() {
  assert.ok(ZIG && fs.existsSync(ZIG), 'Set ZIG to Zig 0.13.0 zig.exe.');
  assert.equal(child.execFileSync(ZIG, ['version'], {encoding: 'utf8'}).trim(), '0.13.0');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ric-watch-'));
  const objects = ['clocks', 'sparkle'].map(name => {
    const out = path.join(work, `${name}.o`);
    child.execFileSync(ZIG, ['cc', ...FLAGS, '-c', path.join(__dirname, `${name}.c`), '-o', out], {stdio: 'pipe'});
    return out;
  });
  const elf = path.join(work, 'all.elf'), bin = path.join(work, 'all.bin');
  child.execFileSync(ZIG, ['ld.lld', '-T', path.join(__dirname, 'link.ld'), '-o', elf, ...objects], {stdio: 'pipe'});
  child.execFileSync(ZIG, ['objcopy', '-O', 'binary', '-j', '.text', elf, bin], {stdio: 'pipe'});
  const code = Buffer.from(fs.readFileSync(bin)), entries = symbols(fs.readFileSync(elf));
  // lld fills alignment gaps after unconditional jumps with 0x04170001; they are never reached.
  for (let o = 0; o < code.length; o += 4) if (code.readUInt32LE(o) === 0x04170001) code.writeUInt32LE(0, o);
  fs.rmSync(work, {recursive: true, force: true});
  assert.ok(BASE + code.length <= END, 'The Stopwatch crash code does not fit the reclaimed Agunea/Vibhuti code.');
  for (const name of ENTRIES) assert.ok(entries[name] >= BASE && entries[name] < BASE + code.length, name);
  return {code, entries};
}
if (require.main === module) {
  const {code, entries} = compile();
  const record = {compiler: 'Zig 0.13.0', flags: FLAGS, linker: 'link.ld', base: '0x' + BASE.toString(16).toUpperCase(),
    size: code.length, sha256: crypto.createHash('sha256').update(code).digest('hex').toUpperCase(),
    entries: Object.fromEntries(ENTRIES.map(n => [n, '0x' + entries[n].toString(16).toUpperCase()])),
    sources: {'clocks.c': crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'clocks.c'))).digest('hex').toUpperCase(),
      'sparkle.c': crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'sparkle.c'))).digest('hex').toUpperCase()},
    hex: code.toString('hex').toUpperCase()};
  fs.writeFileSync(path.join(__dirname, 'code.json'), JSON.stringify(record, null, 1) + '\n');
  console.log(JSON.stringify({...record, hex: undefined}, null, 1));
}
module.exports = {compile, FLAGS, BASE, END, ENTRIES};
