// Builds one shareable zip: a single self-contained "SotN Sound Browser.html" (scripts inlined, no BIN data).
// Usage: node tools/audio/build-sound-check-zip.js [output.zip]
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'SotN Sound Browser.zip'));
const SCRIPTS = {
  '../../sotn-core.js': path.join(ROOT, 'sotn-core.js'),
  'sound-check-catalog.js': path.join(__dirname, 'sound-check-catalog.js'),
  'sound-check-core.js': path.join(__dirname, 'sound-check-core.js'),
};
const ENTRY_NAME = 'SotN Sound Browser.html';

function inlineHtml() {
  let html = fs.readFileSync(path.join(__dirname, 'sound-check.html'), 'utf8');
  for (const [name, file] of Object.entries(SCRIPTS)) {
    const tag = `<script src="${name}"></script>`;
    if (!html.includes(tag)) throw new Error(`sound-check.html has no ${tag}`);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run: node tools/audio/sound-check.js --build-catalog`);
    const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
    html = html.replace(tag, () => `<script>\n${code}\n</script>`);
  }
  if (/<script[^>]*\ssrc=/i.test(html)) throw new Error('An external script tag remains in the page.');
  return html;
}

let CRC_TABLE;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return {time, date};
}

function buildZip(entries) {
  const {time, date} = dosDateTime(new Date());
  const locals = [], centrals = [];
  let offset = 0;
  for (const {name, data} of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), packed = zlib.deflateRawSync(data, {level: 9}), crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, packed); centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + packed.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const zip = buildZip([{name: ENTRY_NAME, data: Buffer.from(inlineHtml(), 'utf8')}]);
fs.writeFileSync(OUT, zip);
console.log(`Wrote ${OUT} (${zip.length.toLocaleString()} bytes).`);
