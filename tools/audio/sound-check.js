// Read-only sound checker server. The page itself parses the BIN in the browser; this only serves static files
// and streams the default image (with Range support). Run with --build-catalog to regenerate sound-check-catalog.js.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFile} = require('node:child_process');
const core = require('./sound-check-core');
const ROOT = path.resolve(__dirname, '../..');
const DECOMP = process.env.SOTN_DECOMP || path.resolve(ROOT, '../sotn-decomp');
const IMAGE = process.env.SOTN_BIN || path.join(ROOT, 'MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const CATALOG = path.join(__dirname, 'sound-check-catalog.js');
const hex = core.hex;

function readAreaNames() {
  const areaBlock = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/const AREA_NAMES=\{([\s\S]*?)\n  \};/)?.[1] || '';
  return Object.fromEntries([...areaBlock.matchAll(/(\w+):"([^"]+)"/g)].map(m => [m[1], m[2]]));
}

function sourceCatalog(maxText = 0) {
  const areaNames = readAreaNames(), names = {}, uses = {};
  const header = fs.readFileSync(path.join(DECOMP, 'include/sfx.h'), 'utf8');
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/\/\*\s*(?:us:)?(0x[\dA-Fa-f]+)[^*]*\*\/\s*(\w+)[^/]*(?:\/\/\s*(.*))?/);
    if (m) names[hex(Number(m[1]))] = {name: m[2], description: m[3] || ''};
  }
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!/saturn|psp$/.test(e.name)) walk(p); }
      else if (/\.[ch]$/.test(e.name)) {
        const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
        lines.forEach((s, i) => {
          for (const m of s.matchAll(/\bSFX_[A-Z0-9_]+\b/g)) {
            const list = uses[m[0]] || [];
            const file = path.relative(DECOMP, p).replaceAll('\\', '/'), stage = file.match(/^src\/(?:st|boss)\/([^/]+)/)?.[1]?.toUpperCase();
            let text = s.trim(); if (maxText && text.length > maxText) text = text.slice(0, maxText);
            list.push({file, line: i + 1, where: areaNames[stage] || file.replace(/^src\//, '').replace(/\.[ch]$/, '').replaceAll('_', ' '), text});
            uses[m[0]] = list;
          }
        });
      }
    }
  }
  walk(path.join(DECOMP, 'src')); walk(path.join(DECOMP, 'mods/mariapsp-forpsx'));
  return {names, uses, areaNames};
}

function buildCatalog() {
  if (!fs.existsSync(path.join(DECOMP, 'include/sfx.h'))) throw new Error(`sotn-decomp not found at ${DECOMP}. Set SOTN_DECOMP.`);
  const render = c => `(function(g){g.SOTN_SFX_CATALOG = ${JSON.stringify(c)}})(typeof globalThis!=='undefined'?globalThis:this);\nif(typeof module!=='undefined'&&module.exports)module.exports=(typeof globalThis!=='undefined'?globalThis:this).SOTN_SFX_CATALOG;\n`;
  let out = render(sourceCatalog());
  if (Buffer.byteLength(out) > 2e6) out = render(sourceCatalog(160));
  fs.writeFileSync(CATALOG, out);
  console.log(`Wrote ${CATALOG} (${Buffer.byteLength(out).toLocaleString()} bytes).`);
}

const STATIC = {
  '/': ['sound-check.html', 'text/html; charset=utf-8', __dirname],
  '/sotn-core.js': ['sotn-core.js', 'text/javascript; charset=utf-8', ROOT],
  '/sound-check-core.js': ['sound-check-core.js', 'text/javascript; charset=utf-8', __dirname],
  '/sound-check-catalog.js': ['sound-check-catalog.js', 'text/javascript; charset=utf-8', __dirname],
};

function serveImage(req, res) {
  let stat;
  try { stat = fs.statSync(IMAGE); if (!stat.isFile()) throw new Error('not a file'); } catch { res.writeHead(404); res.end(); return; }
  const size = stat.size, base = {'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Image-Name': encodeURIComponent(path.basename(IMAGE))};
  let start = 0, end = size - 1, status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) { res.writeHead(416, {...base, 'Content-Range': `bytes */${size}`}); res.end(); return; }
    if (m[1] === '') { start = Math.max(0, size - Number(m[2])); }
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(end, Number(m[2])); }
    if (start >= size || start > end) { res.writeHead(416, {...base, 'Content-Range': `bytes */${size}`}); res.end(); return; }
    status = 206; base['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, {...base, 'Content-Length': end - start + 1});
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(IMAGE, {start, end, flags: 'r'});
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function main() {
  if (!fs.existsSync(CATALOG) && fs.existsSync(path.join(DECOMP, 'include/sfx.h'))) buildCatalog();
  const port = Number(process.env.SOTN_SOUND_PORT) || 8766;
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      if (u.pathname === '/api/default-bin') { serveImage(req, res); return; }
      const entry = STATIC[u.pathname];
      if (!entry) { res.writeHead(404); res.end(); return; }
      const file = path.join(entry[2], entry[0]);
      if (!fs.existsSync(file)) { res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(`${entry[0]} is missing.`); return; }
      const body = fs.readFileSync(file);
      res.writeHead(200, {'Content-Type': entry[1], 'Content-Length': body.length});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) { res.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'}); res.end(e.message); }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`SotN Sound Browser: ${url}\n${fs.existsSync(IMAGE) ? 'Default BIN found; the page reads it read-only.' : 'No default BIN found; import one in the page.'}\nKeep this window open.`);
    if (process.argv.includes('--open')) execFile('cmd.exe', ['/c', 'start', '', url], {windowsHide: true}, () => {});
  });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy. Open the existing checker or set SOTN_SOUND_PORT.` : e.message); process.exitCode = 1; });
}

module.exports = {parseBank: core.parseBank, decodeADPCM: core.decodeADPCM, wav: core.wav, vag: core.vag, loadSoundImage: core.loadSoundImage, sourceCatalog, buildCatalog};
if (require.main === module) {
  try {
    if (process.argv.includes('--build-catalog')) buildCatalog(); else main();
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
