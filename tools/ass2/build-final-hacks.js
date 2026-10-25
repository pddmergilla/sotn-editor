// Split everything the main BIN gained after ASS 2.0.10 into one guarded PPF pair per feature (see final-hacks.js).
//
//   node tools/ass2/build-final-hacks.js [--out DIR] [--dry]
//
// The shipped 2.0.10 image is rebuilt in memory from vanilla + ass2/Alternate-Scarlet-Symphony-2.0.ppf. Each byte that
// differs in the current main BIN is assigned to the newest applied PPF that wrote it (next to the main BIN, in outputs/
// in Downloads or in Documents/Codex session outputs) and that PPF's feature group. A retune of a feature's own bytes (a later balance patch or Stats
// Editor value) stays with the feature. Bytes no PPF explains are Stats Editor fields (balance), stage/boss overlay
// edits (content), or reported as unattributed.
//
// A feature whose final bytes replaced bytes another feature wrote requires that feature: its patch is built on
// 2.0.10 + the required features, and its reversal restores their bytes. For every feature:
//   <Name>.ppf          adds it to 2.0.10 (+ requirements)  guarded, with undo data and repaired EDC/ECC
//   Reverse-<Name>.ppf  removes it from the current BIN      guarded, with undo data and repaired EDC/ECC
//   specs/<id>.json     Extra Hacks-style edit runs (file, offset, off, on) for the website catalog
// Neither the main BIN nor any backup is written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const child = require('node:child_process');
const ROOT = path.join(__dirname, '../..');
const C = require('../../sotn-core.js'), A = require('../../ass2-core.js'), M = require('../../stats-model.js');
const {ppf, apply} = require('../weapons/build-stone-sword-patch.js');
const {FEATURES, classify} = require('./final-hacks.js');

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const DOWNLOADS = 'C:/Users/omergilla/Downloads', CODEX = 'C:/Users/omergilla/Documents/Codex';
const VANILLA = process.env.SOTN_VANILLA_BIN || `${DOWNLOADS}/Castlevania - Symphony of the Night (USA)/Castlevania - Symphony of the Night (USA) (Track 1).bin`;
const MAIN = process.env.SOTN_ASS_BIN || path.join(ROOT, 'MainBIN/Castlevania - Alternate Scarlet Symphony 2.0.bin');
const OUT = path.resolve(arg('--out') || path.join(ROOT, 'MainBIN/ASS-Final-Hacks'));
const DRY = process.argv.includes('--dry');
const SECTOR = 2352, DATA = 24, USER_END = DATA + 2048;
const kind = id => FEATURES.find(f => f.id === id)?.kind || id;

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const hex = v => '0x' + v.toString(16).toUpperCase();
const revision = cwd => { try { return child.execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {cwd, encoding: 'utf8'}).trim(); } catch { return null; } };
const slug = t => t.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

function release() {
  global.window = global.window || {};
  require('../../ass2/ass2-release.js');
  return global.window.SotnAss2Release;
}

function listPpfs(dir, depth, out = []) {
  if (depth < 0 || !fs.existsSync(dir) || /Reawakened|ASS-Final-Hacks/.test(dir)) return out;
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    // Full release patches (vanilla -> ASS) are not feature patches.
    if (e.isDirectory()) listPpfs(p, depth - 1, out); else if (/\.ppf$/i.test(e.name) && !/^Alternate-Scarlet-Symphony-/.test(e.name)) out.push(p);
  }
  return out;
}

async function walk(disc, dir, prefix, out) {
  for (const e of await disc.readDirectory(dir)) {
    if (e.name === '\0' || e.name === '\x01') continue;
    const p = prefix.concat(C.normalizeIsoName(e.name));
    if (e.isDirectory) await walk(disc, e, p, out); else out.set(p.join('/'), e);
  }
  return out;
}

// Image offsets covered by Stats Editor fields (the editor's own balance controls), and the DEF column of
// Alucard's equipment and of the enemies, which belongs to Percent DEF.
async function statFieldOffsets(disc, files) {
  const model = await M.loadFromDisc(disc, C.normalizeIsoName), out = new Set(), def = new Set();
  const isoPath = key => key === 'DRA' ? 'DRA.BIN' : key === 'RIC' ? 'BIN/RIC.BIN' : `${key}/${key.split('/')[1]}.BIN`;
  const mark = (key, off, size, set = out) => {
    const rec = files.get(isoPath(key)); if (!rec) return;
    for (let i = 0; i < size; i++) { const o = off + i; set.add((rec.extent + Math.floor(o / 2048)) * SECTOR + DATA + o % 2048); }
  };
  // Whole data tables count too: the Stats Editor shows only some of their columns (enemy level, for one).
  const t = model.tables;
  for (const [start, size] of [[t.subwpn, 0x14 * 13], [t.equip, 0x34 * 169], [t.acc, 0x20 * 90], [t.enemy, 0x28 * 400], [t.spell, 0x1C * 28], [t.relic, 0x10 * 30]])
    if (start >= 0) mark('DRA', start, size);
  for (const f of model.fields.values()) {
    if (f.kind === 'int') mark(f.file, f.off, f.size);
    else if (f.kind === 'text') mark(f.file, f.off, f.capacity);
    else if (f.kind === 'sites' || f.kind === 'effect') for (const s of f.sites || []) mark(s.file, s.off, s.size || 2);
  }
  // DEF is the s16 at +0x0A of every hand item, body item and enemy row (named enemies and their attack rows).
  for (const [start, stride, count] of [[t.equip, 0x34, 169], [t.acc, 0x20, 90], [t.enemy, 0x28, 400]])
    for (let i = 0; i < count; i++) mark('DRA', start + i * stride + 0x0A, 2, def);
  assert.equal(model.field(model.sections.enemies[0].defense).off, t.enemy + model.sections.enemies[0].index * 0x28 + 0x0A);
  return {all: out, def};
}

function topoOrder(ids, deps) {
  const order = [], state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`Dependency cycle: ${trail.concat(id).join(' -> ')}`);
    state.set(id, 1);
    for (const d of [...(deps.get(id) || [])].sort()) visit(d, trail.concat(id));
    state.set(id, 2); order.push(id);
  };
  for (const id of ids) visit(id, []);
  return order;
}

async function main() {
  const rel = release();
  const vanilla = fs.readFileSync(VANILLA);
  assert.equal(sha(vanilla), rel.vanilla.sha256, 'Vanilla US Track 1 hash');
  const base = Buffer.from(vanilla);
  { const p = A.parsePpf(fs.readFileSync(path.join(ROOT, rel.ppf.file))); p.offsets.forEach((o, i) => base.set(p.bytes.subarray(p.data[i], p.data[i] + p.lengths[i]), o)); }
  const baseSha = sha(base);
  assert.equal(baseSha, rel.result.sha256, `ASS ${rel.version} rebuild`);
  const cur = fs.readFileSync(MAIN), curSha = sha(cur);
  console.error(`ASS ${rel.version} ${baseSha}\ncurrent ${curSha}`);

  // Every changed byte outside EDC/ECC.
  const changed = new Map();
  for (let s = 0; s < cur.length / SECTOR; s++) {
    const a = s * SECTOR;
    if (!base.compare(cur, a, a + USER_END, a, a + USER_END)) continue;
    for (let i = a; i < a + USER_END; i++) if (base[i] !== cur[i]) changed.set(i, []);
  }
  const sectorOf = o => Math.floor(o / SECTOR);

  const disc = await C.DiscImage.open(new Blob([cur])), files = await walk(disc, disc.root, [], new Map());
  const sectorFile = new Map();
  for (const [name, e] of files) for (let s = 0; s < Math.ceil(e.size / 2048); s++) sectorFile.set(e.extent + s, {name, at: s * 2048});
  const fileOf = o => sectorFile.get(sectorOf(o))?.name || `sector ${sectorOf(o)}`;

  // Every PPF that wrote a changed byte, with the values it wrote in the direction it was applied.
  const ppfs = [], writers = new Map();
  for (const file of [...listPpfs(DOWNLOADS, 1), ...listPpfs(CODEX, 4), ...listPpfs(path.join(ROOT, 'MainBIN'), 9), ...listPpfs(path.join(ROOT, 'outputs'), 9)]) {
    let p; try { p = A.parsePpf(fs.readFileSync(file)); } catch { continue; }
    let mod = 0, und = 0;
    p.offsets.forEach((o, i) => {
      const n = p.lengths[i];
      if (!Buffer.compare(cur.subarray(o, o + n), p.bytes.subarray(p.data[i], p.data[i] + n))) mod++;
      if (!Buffer.compare(cur.subarray(o, o + n), p.bytes.subarray(p.data[i] + n, p.data[i] + 2 * n))) und++;
    });
    const reverse = und > mod, index = ppfs.length, written = new Map(), filesWritten = {};
    let applied = false;
    p.offsets.forEach((o, i) => {
      const n = p.lengths[i], at = p.data[i] + (reverse ? n : 0);
      let live = true, differs = false;
      for (let k = 0; k < n; k++) {
        const v = p.bytes[at + k];
        if (cur[o + k] !== v) live = false; if (base[o + k] !== v) differs = true;
        if (!changed.has(o + k) || v === base[o + k]) continue;
        written.set(o + k, v);
        if (!writers.has(o + k)) writers.set(o + k, []); writers.get(o + k).push(index);
        if (cur[o + k] === v) changed.get(o + k).push(index);
        const f = fileOf(o + k); filesWritten[f] = (filesWritten[f] || 0) + 1;
      }
      if (live && differs) applied = true;
    });
    const name = path.basename(file).replace(/^(Reverse|Undo)-/, '');
    const entry = {file: file.replace(/\\/g, '/'), name, mtime: fs.statSync(file).mtime.toISOString(), description: p.description, reverse, applied,
      recovery: /bin-recovery/.test(file), mirror: /^(Reverse|Undo)-|REVERT/i.test(path.basename(file)), written, files: filesWritten};
    entry.feature = entry.recovery || !written.size ? null : classify(entry);
    ppfs.push(entry);
  }
  const rank = i => (ppfs[i].recovery ? 0 : 2) + (ppfs[i].mirror ? 0 : 1);
  for (const own of changed.values()) own.sort((a, b) => rank(b) - rank(a) || ppfs[b].mtime.localeCompare(ppfs[a].mtime));

  const {all: stats, def: defense} = await statFieldOffsets(disc, files);
  const ruleFor = o => {
    const f = fileOf(o);
    if (/TT_006|FT_006/.test(f)) return 'dawn';
    if (/TT_005|FT_005/.test(f)) return 'ouroboros';
    if (stats.has(o)) return 'balance';
    const w = o - (o % SECTOR - DATA) % 4;
    if (cur.readUInt32LE(w) === 0x0C033729 && base.readUInt32LE(w) !== 0x0C033729) return 'second-castle-attacks';
    if (/^(ST|BOSS)\//.test(f)) return 'content';
    return null;
  };

  // Assign each byte to one group; tuning on top of a feature's own bytes stays with the feature.
  const group = new Map(), owner = new Map(), absorbed = new Map();
  for (const [o, own] of changed) {
    const top = own.map(i => ppfs[i]).find(p => !p.recovery);
    assert.ok(!top || top.feature, `Unclassified PPF ${top?.file}`);
    let id = top?.feature || null;
    if (defense.has(o)) { group.set(o, 'percent-def'); if (top) owner.set(o, ppfs.indexOf(top)); continue; }
    if (kind(id) === 'hack') { group.set(o, id); owner.set(o, ppfs.indexOf(top)); continue; }
    const hackWriter = (writers.get(o) || []).map(i => ppfs[i]).filter(p => p.applied && kind(p.feature) === 'hack')
      .sort((a, b) => b.mtime.localeCompare(a.mtime))[0];
    if (hackWriter) { group.set(o, hackWriter.feature); absorbed.set(hackWriter.feature, (absorbed.get(hackWriter.feature) || 0) + 1); continue; }
    id = id || ruleFor(o);
    if (id) { group.set(o, id); if (top) owner.set(o, ppfs.indexOf(top)); }
  }
  // Leftover bytes: cleared item text is content; a small hook next to one feature's bytes in the same file joins it.
  const near = new Map();
  for (const [o, id] of group) if (kind(id) === 'hack') { const f = fileOf(o); if (!near.has(f)) near.set(f, []); near.get(f).push(o); }
  for (const list of near.values()) list.sort((a, b) => a - b);
  const proximity = [];
  for (const [o] of changed) if (!group.has(o) && o % SECTOR >= DATA) {
    const f = fileOf(o), at = sectorFile.get(sectorOf(o))?.at + o % SECTOR - DATA;
    if (f === 'DRA.BIN' && cur[o] === 0 && at >= 0x3D000 && at < 0x40000) { group.set(o, 'content'); continue; }
    const list = near.get(f) || [];
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < o) lo = mid + 1; else hi = mid; }
    const best = [list[lo - 1], list[lo]].filter(x => x !== undefined).sort((a, b) => Math.abs(a - o) - Math.abs(b - o))[0];
    if (best !== undefined && Math.abs(best - o) <= 0x200) { group.set(o, group.get(best)); proximity.push({file: f, offset: hex(at), feature: group.get(best)}); }
    else group.set(o, 'unattributed');
  }
  for (const [o] of changed) if (!group.has(o)) {
    const s = o - o % SECTOR, votes = new Map();   // header/subheader bytes follow the rest of their sector
    for (let i = s + DATA; i < s + USER_END; i++) if (group.has(i)) votes.set(group.get(i), (votes.get(group.get(i)) || 0) + 1);
    group.set(o, [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || 'unattributed');
  }
  assert.equal(group.size, changed.size);

  // Each feature's own values: what its applied patches wrote, oldest first, then its final bytes.
  const hacks = FEATURES.filter(f => f.kind === 'hack').map(f => f.id);
  const value = new Map(hacks.map(id => [id, new Map()]));
  for (const p of [...ppfs].filter(p => p.applied && kind(p.feature) === 'hack').sort((a, b) => a.mtime.localeCompare(b.mtime)))
    for (const [o, v] of p.written) if (!defense.has(o) || p.feature === 'percent-def') value.get(p.feature).set(o, v);
  for (const [o, id] of group) if (kind(id) === 'hack') value.get(id).set(o, cur[o]);
  const deps = new Map(hacks.map(id => [id, new Set()]));
  for (const [o, id] of group) if (kind(id) === 'hack')
    for (const other of hacks) if (other !== id && value.get(other).has(o)) deps.get(id).add(other);
  const order = topoOrder(hacks, deps);
  const closure = id => { const out = new Set(), go = d => { for (const x of deps.get(d)) if (!out.has(x)) { out.add(x); go(x); } }; go(id); return order.filter(x => out.has(x)); };

  // Composition check: 2.0.10 + every feature in order + the excluded groups' bytes = the current BIN.
  {
    const saved = new Map([...new Set([...changed.keys()].map(sectorOf))].map(s => [s, Buffer.from(base.subarray(s * SECTOR, (s + 1) * SECTOR))]));
    for (const id of order) for (const [o, v] of value.get(id)) base[o] = v;
    for (const [o, id] of group) if (kind(id) !== 'hack') base[o] = cur[o];
    for (const s of saved.keys()) assert.equal(base.compare(cur, s * SECTOR, s * SECTOR + USER_END, s * SECTOR, s * SECTOR + USER_END), 0, `Composition differs in sector ${s}`);
    for (const [s, bytes] of saved) bytes.copy(base, s * SECTOR);
    assert.equal(sha(base), baseSha);
  }

  const summary = offs => {
    const touched = {}, src = new Map();
    for (const o of offs) { const f = fileOf(o); touched[f] = (touched[f] || 0) + 1; if (owner.has(o)) { const p = ppfs[owner.get(o)]; src.set(p.file, (src.get(p.file) || 0) + 1); } }
    return {bytes: offs.length, sectors: new Set(offs.map(sectorOf)).size, files: touched,
      sources: [...src].map(([file, bytes]) => ({file, bytes})).sort((a, b) => a.file.localeCompare(b.file))};
  };
  const byGroup = new Map();
  for (const [o, id] of group) { if (!byGroup.has(id)) byGroup.set(id, []); byGroup.get(id).push(o); }

  const report = {
    built: new Date().toISOString(), editor: {revision: revision(ROOT)},
    decomp: {remote: 'https://github.com/Xeeynamo/sotn-decomp.git', revision: revision('D:/AAA/GitHub/sotn-decomp')},
    vanilla: {path: VANILLA, sha256: rel.vanilla.sha256},
    base: {name: `ASS ${rel.version}`, ppf: rel.ppf.file, sha256: baseSha},
    current: {path: MAIN, size: cur.length, sha256: curSha},
    changedBytes: changed.size, changedSectors: new Set([...changed.keys()].map(sectorOf)).size, ppfsScanned: ppfs.length,
    attributedByProximity: Object.values(proximity.reduce((acc, p) => {
      const k = `${p.feature} ${p.file}`; (acc[k] ??= {feature: p.feature, file: p.file, bytes: 0, offsets: []}).bytes++;
      if (acc[k].offsets.length < 12) acc[k].offsets.push(p.offset); return acc; }, {})),
    installOrder: order.filter(id => value.get(id).size), features: [], excluded: {}, sharedSectors: []
  };
  for (const id of ['balance', 'second-castle-attacks', 'content', 'unattributed']) if (byGroup.has(id)) {
    const s = summary(byGroup.get(id));
    if (id === 'unattributed') s.runs = runs(byGroup.get(id), o => base[o], o => cur[o]).slice(0, 200);
    report.excluded[id] = s;
  }
  const sectorGroups = new Map();
  for (const [o, id] of group) if (kind(id) === 'hack') { const s = sectorOf(o); if (!sectorGroups.has(s)) sectorGroups.set(s, new Set()); sectorGroups.get(s).add(id); }
  const pairs = new Map();
  for (const ids of sectorGroups.values()) { const l = [...ids].sort(); for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { const k = l[i] + '+' + l[j]; pairs.set(k, (pairs.get(k) || 0) + 1); } }
  report.sharedSectors = [...pairs].map(([k, n]) => ({features: k.split('+'), sectors: n})).sort((a, b) => b.sectors - a.sectors);

  // Edit runs in the current disc layout's file coordinates (directory records and sector headers as disc offsets).
  function runs(offs, off, on) {
    const out = [];
    for (const o of [...offs].sort((a, b) => a - b)) {
      const sf = o % SECTOR >= DATA && o % SECTOR < USER_END ? sectorFile.get(sectorOf(o)) : null;
      const where = sf ? {file: sf.name, offset: sf.at + o % SECTOR - DATA} : {disc: true, offset: o};
      const last = out[out.length - 1];
      if (last && last.file === where.file && !!last.disc === !!where.disc && last.offset + last.on.length === where.offset) { last.on.push(on(o)); last.off.push(off(o)); continue; }
      out.push({...where, off: [off(o)], on: [on(o)]});
    }
    return out.map(r => ({...(r.disc ? {disc: true} : {file: r.file}), offset: hex(r.offset),
      off: Buffer.from(r.off).toString('hex').toUpperCase(), on: Buffer.from(r.on).toString('hex').toUpperCase()}));
  }

  if (!DRY) fs.mkdirSync(path.join(OUT, 'specs'), {recursive: true});
  const block = base.subarray(0x9320, 0x9720), curBlock = cur.subarray(0x9320, 0x9720);
  for (const f of FEATURES.filter(f => f.kind === 'hack')) {
    const own = value.get(f.id), mine = byGroup.get(f.id) || [], need = closure(f.id);
    const entry = {id: f.id, title: f.title, category: f.category, about: f.about, requires: need, ...summary(mine)};
    if (own.size !== mine.length) entry.alsoWrites = own.size - mine.length;
    if (absorbed.get(f.id)) entry.retunedBytes = absorbed.get(f.id);
    report.features.push(entry);
    if (!own.size) { entry.note = 'No bytes in the current BIN differ from 2.0.10 for this feature.'; continue; }
    // Value of each byte once the required features are installed on 2.0.10.
    const before = o => { for (let i = need.length - 1; i >= 0; i--) if (value.get(need[i]).has(o)) return value.get(need[i]).get(o); return base[o]; };
    const sectors = [...new Set([...own.keys()].map(sectorOf))].sort((a, b) => a - b);
    // Guard the real 2.0.10 sector (some carry stale EDC/ECC); recompute only where a requirement changed it.
    const add = sectors.map(s => {
      const start = s * SECTOR, original = Buffer.from(base.subarray(start, start + SECTOR));
      let required = false;
      for (let i = start; i < start + USER_END; i++) { const v = before(i); if (v !== original[i - start]) { original[i - start] = v; required = true; } }
      if (required) C.repairSector(original, DATA);
      const modified = Buffer.from(original);
      for (const [o, v] of own) if (sectorOf(o) === s) modified[o - start] = v;
      C.repairSector(modified, DATA);
      return {start, original, modified};
    }).filter(c => !c.original.equals(c.modified));
    const removeSectors = [...new Set(mine.map(sectorOf))].sort((a, b) => a - b);
    const remove = removeSectors.map(s => {
      const start = s * SECTOR, original = Buffer.from(cur.subarray(start, start + SECTOR)), modified = Buffer.from(original);
      for (const o of mine) if (sectorOf(o) === s) modified[o - start] = before(o);
      C.repairSector(modified, DATA);
      return {start, original, modified};
    });
    const name = `ASS-Final-${slug(f.title)}`;
    const forward = ppf(add, block, `ASS Final: ${f.title}`.slice(0, 50));
    const reversal = ppf(remove, curBlock, `Remove ${f.title}`.slice(0, 50));
    // Forward: on 2.0.10 with the required features' sectors in place; reversal: on the current BIN. Both undone after.
    const check = (image, patch, changes) => {
      const saved = changes.map(c => Buffer.from(image.subarray(c.start, c.start + SECTOR)));
      changes.forEach(c => c.original.copy(image, c.start));
      apply(image, patch);
      for (const c of changes) { const now = image.subarray(c.start, c.start + SECTOR); assert.deepEqual(now, c.modified); assert.deepEqual(C.repairSector(Buffer.from(now), DATA), now); }
      apply(image, patch, true);
      for (const c of changes) assert.deepEqual(image.subarray(c.start, c.start + SECTOR), c.original);
      changes.forEach((c, i) => saved[i].copy(image, c.start));
    };
    check(base, forward, add);
    check(cur, reversal, remove);
    apply(cur, reversal); entry.reversalResultSha256 = sha(cur); apply(cur, reversal, true);
    if (!need.length) { apply(base, forward); entry.forwardResultSha256 = sha(base); apply(base, forward, true); }
    entry.forward = {path: path.join(OUT, `${name}.ppf`), size: forward.length, sha256: sha(forward), records: A.parsePpf(forward).offsets.length,
      appliesTo: need.length ? `ASS ${rel.version} + ${need.join(', ')}` : `ASS ${rel.version}`};
    entry.reversal = {path: path.join(OUT, `Reverse-${name}.ppf`), size: reversal.length, sha256: sha(reversal), records: A.parsePpf(reversal).offsets.length, appliesTo: `current main BIN ${curSha.slice(0, 8)}`};
    const spec = {id: f.id, label: f.title, summary: f.about, requires: need, source: 'Generated by tools/ass2/build-final-hacks.js; review before adding to tools/extra-hacks/specs.',
      base: `ASS ${rel.version} (${baseSha})`, target: `main BIN ${curSha}`, edits: runs([...own.keys()], before, o => own.get(o))};
    if (!DRY) {
      fs.writeFileSync(entry.forward.path, forward); fs.writeFileSync(entry.reversal.path, reversal);
      fs.writeFileSync(path.join(OUT, 'specs', `${f.id}.json`), JSON.stringify(spec, null, 2) + '\n');
    }
    console.error(`${f.id}: ${mine.length} bytes${need.length ? ` (requires ${need.join(', ')})` : ''}`);
  }
  assert.equal(sha(base), baseSha, '2.0.10 image restored after checks');
  assert.equal(sha(cur), curSha, 'current image restored after checks');
  assert.equal(sha(fs.readFileSync(MAIN)), curSha, 'Main BIN unchanged while building');
  report.verified = ['vanilla and 2.0.10 rebuild hashes', 'every changed byte assigned to exactly one group',
    '2.0.10 + all features in install order + balance/content bytes reproduces every changed sector of the current BIN',
    'forward PPF: guards pass on 2.0.10 (+ required features), expected sectors written with valid EDC/ECC, undo restores the input',
    'reversal PPF: guards pass on the current BIN, valid EDC/ECC, undo restores the current BIN', 'main BIN hash unchanged'];
  report.gameplay = 'Not played in an emulator; byte-level checks only. Install a feature\'s requirements first; remove features that require it first.';
  if (!DRY) fs.writeFileSync(path.join(OUT, 'README.md'), readme(report));
  const json = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(DRY ? path.join(ROOT, 'outputs/final-audit-2026-10-24/dry-report.json') : path.join(OUT, 'ASS-Final-Hacks.verification.json'), json);
  console.log(JSON.stringify({features: report.features.filter(e => e.bytes).length, order: report.installOrder.length,
    excluded: Object.fromEntries(Object.entries(report.excluded).map(([k, v]) => [k, v.bytes])), current: curSha}));
}

// The feature list by category, as used for docs/final-hacks.md and the website's Hacks list.
function featureList(report) {
  const title = id => report.features.find(f => f.id === id)?.title || id;
  let md = '';
  for (const category of [...new Set(report.features.map(f => f.category))]) {
    md += `\n### ${category}\n\n| Feature | What it does | Requires | Bytes | Patch |\n|---|---|---|---:|---|\n`;
    for (const f of report.features.filter(f => f.category === category && f.forward))
      md += `| **${f.title}** | ${f.about} | ${f.requires.map(title).join(', ') || '—'} | ${f.bytes.toLocaleString('en-US')} | \`${path.basename(f.forward.path)}\` |\n`;
  }
  return md;
}

function readme(report) {
  const ex = report.excluded, n = k => (ex[k]?.bytes || 0).toLocaleString('en-US');
  return `# Alternate Scarlet Symphony -Final-: separate feature patches

Everything the main BIN gained after ${report.base.name}, split into ${report.features.filter(f => f.forward).length} features (balance changes excluded).
Generated by \`node tools/ass2/build-final-hacks.js\` on ${report.built.slice(0, 10)}.

- Base: ${report.base.name}, SHA-256 \`${report.base.sha256}\` (vanilla US Track 1 + \`${report.base.ppf}\`).
- Current main BIN: SHA-256 \`${report.current.sha256}\`. ${report.changedBytes.toLocaleString('en-US')} bytes in ${report.changedSectors} sectors differ from the base.
- \`ASS-Final-<feature>.ppf\` adds the feature to the base (after the features it requires). \`Reverse-ASS-Final-<feature>.ppf\` removes it from the current BIN; remove the features that require it first.
- Every PPF is PPF3 with a block check and undo data, and writes valid sector EDC/ECC for the image it targets. Several features share sectors; chain them in the install order below with a patcher that does not check undo data, then repair sector checksums (the editor does this when it builds).
- \`specs/<id>.json\` lists each feature's edits as file, offset, off (base) and on (current) bytes for the Extra Hacks catalog. Review before copying into \`tools/extra-hacks/specs/\`.
- Excluded, no patch: balance and Stats Editor values ${n('balance')} bytes, map/pickup/text content ${n('content')} bytes, unattributed ${n('unattributed')} bytes. See \`ASS-Final-Hacks.verification.json\`.
- Bytes attributed to a neighbouring feature because no PPF wrote them are listed under \`attributedByProximity\` in the verification file; review those.
- The main BIN and its backups were not written. Nothing was played in an emulator.

Install order: ${report.installOrder.join(', ')}.
${featureList(report)}`;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {featureList};
