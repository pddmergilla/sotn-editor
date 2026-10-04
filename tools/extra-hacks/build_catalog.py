"""Build ../../extra-hacks-catalog.js from specs/*.json (one research spec per hack), ui.json (labels and
UI text), overrides.json (catalog-only adjustments) and a code fingerprint taken from the reference images.

Needs the vanilla US track 1, ASS 1.3.1 and ASS 2.0 BINs (paths in sotn.py, or SOTN_VANILLA_BIN,
SOTN_ASS_OLD_BIN, SOTN_ASS_BIN). Every spec "on" run is checked against ASS 2.0 before writing.
Only needed when a hack is added or changed; stat, text and map edits in later builds need no rebuild.

usage: python build_catalog.py [--out PATH] [--allow-missing]
"""
import hashlib, json, struct, sys, zlib
from pathlib import Path
from sotn import *
from stat_buffs import dark_extension, write_stones, stone_edits

OUT = Path(__file__).resolve().parents[2] / 'extra-hacks-catalog.js'
SPECS = HERE / 'specs'
ORDER = ['minimap', 'fast-warp', 'damage-colors', 'mist-gas-swap', 'aggressive-enemy', 'karasuman', 'slogra', 'dopplegangers', 'succubus',
         'richter-no-flinch', 'richter-ai', 'richter-save', 'quick-items', 'mp-items', 'heal-hearts', 'instant-food', 'eat-food-on-pickup',
         'hint-items-no-attack', 'subweapon-mp', 'agunea-limit', 'stopwatch-rework', 'holy-water-richter', 'wolf-no-jump', 'subweapon-weapon', 'all-cloaks-hearts',
         'heart-regen', 'dark-stats', 'dark-speed', 'sky-walker', 'faerie-behavior']
TEXT = {'DRA.BIN': (0x42398, 0x962AC), 'BIN/RIC.BIN': (0x1AC60, 0x39890)}
MARKER_FILES = ['DRA.BIN', 'BIN/RIC.BIN']
WINDOW = 256
OVERRIDES = json.loads((HERE / 'overrides.json').read_text(encoding='utf-8')) if (HERE / 'overrides.json').exists() else {}


def masked(b, off, n):
    out = bytearray(b[off:off + n])
    for at in range((4 - (off & 3)) & 3, len(out) - 3, 4):
        if 8 <= (out[at + 3] >> 2) <= 15:
            out[at] = 0
            out[at + 1] = 0
    return bytes(out)


def crc(b):
    return '%08X' % (zlib.crc32(b) & 0xFFFFFFFF)


def h(x):
    return int(x, 16) if isinstance(x, str) else int(x)


def load_specs(allow_missing):
    ui = json.loads((HERE / 'ui.json').read_text(encoding='utf-8')) if (HERE / 'ui.json').exists() else {}
    specs = []
    for fid in ORDER:
        p = SPECS / f'{fid}.json'
        if not p.exists():
            if allow_missing:
                print('MISSING spec', fid)
                specs.append({'id': fid, 'label': fid, 'edits': [], 'missing': True})
                continue
            raise SystemExit(f'missing spec {p}')
        s = json.loads(p.read_text(encoding='utf-8'))
        s.update(ui.get(fid, {}))
        if fid == 'dark-stats':
            extension, values = dark_extension()
            s['edits'] += extension
            s['values'] += values
            s['defaults'].update(str=0, con=0, lck=0)
            for value in s['values']:
                if value['key'] in ('atk', 'int', 'def'):
                    value.update(editable=True, min=0, max=999 if value['key'] != 'int' else 99)
            s['values'][1]['offsets'] = [0x42894, 0x428a4]
            s['tunables'] += [dict(file=v['file'], offset=off, length=2) for v in values for off in v['offsets']]
        specs.append(s)
    return specs


def convert(spec):
    edits = []
    for e in spec.get('edits', []):
        f, off, on, of = e['file'], h(e['offset']), bytes.fromhex(e['on']), bytes.fromhex(e['off'])
        assert len(on) == len(of) and on, (spec['id'], e)
        base_van = None
        if OVERRIDES.get(spec['id'], {}).get('baseOriginVanillaOnly') and str(e.get('origin', '')).startswith('ASS 1.3.1 base'):
            # Already in ASS 1.3.1: unchanged when toggling an ASS image; added only on vanilla.
            base_van = of
            of = read(f, 'o')[off:off + len(on)]
        a = read(f, 'a')
        with_on = bytes.fromhex(e['with']['on']) if e.get('with') else None
        # ASS 2.0 holds either the plain form or, where another hack changes this one's bytes, the combined form.
        # A work-in-progress hack ("wip") may be left off in ASS 2.0.
        allowed = (on, with_on, of) if spec.get('wip') or e.get('optional') else (on, with_on)
        rec = {'file': f, 'offset': off, 'off': of.hex().upper(), 'on': on.hex().upper()}
        if e.get('optional'):
            rec['optional'] = True
        if with_on is not None:
            assert len(with_on) == len(on)
            rec['with'] = {'feature': e['with']['feature'], 'on': with_on.hex().upper()}
        if e.get('vanillaOn'):
            assert len(bytes.fromhex(e['vanillaOn'])) == len(on)
            rec['vanillaOn'] = e['vanillaOn'].upper()
        if e.get('needsFree'):
            rec['free'] = 1  # installed only where the image still holds the off bytes (free space)
        if is_cost_field(f, off, len(on)):
            rec['stats'] = 1  # an item MP cost the Stats Editor shows; the app writes it through the stats model
        v = read(f, 'v')[off:off + len(on)]
        van = base_van
        for vo in spec.get('vanilla', {}).get('vanillaOff', []) or []:
            if vo['file'] == f and h(vo['offset']) == off:
                van = bytes.fromhex(vo['bytes'])
        if van is not None and van != of:
            assert len(van) == len(on)
            rec['vanillaOff'] = van.hex().upper()
        tun = []
        for t in spec.get('tunables', []):
            if t['file'] != f:
                continue
            ts, tl = h(t['offset']), int(t['length'])
            lo, hi = max(ts, off), min(ts + tl, off + len(on))
            if lo < hi:
                tun.append([lo - off, hi - lo])
        if tun:
            rec['tunable'] = tun
        mask = bytearray(len(on))
        for start, length in tun:
            mask[start:start + length] = bytes([1]) * length
        actual = a[off:off + len(on)]
        assert len(actual) == len(on) and (actual in allowed or any(candidate is not None and all(x == y or mask[n] for n, (x, y) in enumerate(zip(actual, candidate))) for candidate in allowed)), f"{spec['id']}: on bytes do not match ASS 2.0 at {f} {off:#x}"
        alts = list(e.get('onAlt', [])) + OVERRIDES.get(spec['id'], {}).get('onAlt', {}).get(f'{f}:{off:#x}', [])
        for alt in alts:
            data = alt['bytes'] if isinstance(alt, dict) else alt
            assert len(bytes.fromhex(data)) == len(on), (spec['id'], f, hex(off))
            if isinstance(alt, dict):
                for start, length in alt.get('tunable', []):
                    assert start >= 0 and length > 0 and start + length <= len(on), (spec['id'], alt)
        if alts:
            rec['onAlt'] = [dict(x, bytes=x['bytes'].upper()) if isinstance(x, dict) else x.upper() for x in alts]
        vpatch = OVERRIDES.get(spec['id'], {}).get('vanillaOnPatch', {}).get(f'{f}:{off:#x}')
        if vpatch:
            von = bytearray(on)
            for rel, hx in vpatch:
                von[rel:rel + len(bytes.fromhex(hx))] = bytes.fromhex(hx)
            rec['vanillaOn'] = bytes(von).hex().upper()
        edits.append(rec)
    return edits


def is_cost_field(f, off, n):
    # mpUsage (+0x24, u16) of an equipment-table row (217 rows of 0x34 bytes, pointer in the DRA header).
    if f != 'DRA.BIN' or n != 2:
        return False
    table = struct.unpack_from('<I', read(f, 'v'), 0x8003C830 - 0x8003C770)[0] - 0x800A0000
    rel = off - table
    return 0 <= rel < 217 * 0x34 and rel % 0x34 == 0x24


def find_params(b, x, y, eid, slot):
    key = struct.pack('<4H', x, y, eid, slot)
    out, at = [], b.find(key)
    while at >= 0:
        if at % 2 == 0:
            out.append(struct.unpack_from('<H', b, at + 8)[0])
        at = b.find(key, at + 1)
    return out


def convert_entities(spec):
    rows, stats = [], {'ok': 0, 'aMissing': 0}
    for e in spec['entityEdits']:
        f, x, y, eid, slot = e['file'], int(e['x']), int(e['y']), h(e['entityId']), h(e['entityRoomIndex'])
        off, on, vonly = h(e['paramsOff']), h(e['paramsOn']), e['scope'] != 'ass+vanilla'
        def mine(kind):
            # Records sharing this key but holding other params are unrelated entities in other rooms.
            return [p for p in find_params(read(f, kind), x, y, eid, slot) if p in (on, off)]
        pv = mine('v')
        assert len(pv) == 2 and all(p == off for p in pv), (spec['id'], 'vanilla', e, pv)
        if not vonly:
            pa, po = mine('a'), mine('o')
            assert len(pa) == 2 and all(p == on for p in pa), (spec['id'], 'ass', e, pa)
            assert len(po) == 2 and all(p == off for p in po), (spec['id'], '1.3.1', e, po)
        rows.append([f, x, y, eid, slot, off, on, 1 if vonly else 0])
        stats['ok'] += 1
    print('  entities', spec['id'], stats)
    return rows


def exclusion_map(specs):
    excl = {f: bytearray(len(read(f, 'v'))) for f in MARKER_FILES}

    def mark(f, s, e, pad=8):
        if f in excl:
            b = excl[f]
            for i in range(max(0, s - pad), min(len(b), e + pad)):
                b[i] = 1
    for s in specs:
        for e in s.get('edits', []):
            mark(e['file'], h(e['offset']), h(e['offset']) + len(e['on']) // 2)
        for c in s.get('context', []) or []:
            mark(c['file'], h(c['offset']), h(c['offset']) + int(c['length']))
    # InitStatsAndGear can be rewritten by the Stats Editor.
    for edit in stone_edits():
        mark(edit['file'], h(edit['offset']), h(edit['offset']) + len(edit['on']) // 2)
    dra = read('DRA.BIN', 'v')
    init = struct.unpack_from('<I', dra, 0x8003C854 - 0x8003C770)[0] - 0x800A0000
    mark('DRA.BIN', init, init + 0x1400, 0)
    # Anything the private ASS 2.0 patches or editor builds changed is not a stable family marker.
    for f in MARKER_FILES:
        o, a = read(f, 'o'), read(f, 'a')
        for s0, e0 in ranges(o, a):
            mark(f, s0, e0, 4)
    return excl


def fingerprint(specs):
    excl = exclusion_map(specs)
    windows, markers, count = {}, [], 0
    for f, (s, e) in TEXT.items():
        v, o = read(f, 'v'), read(f, 'o')
        for off in range(s, e - WINDOW, WINDOW):
            if any(excl[f][off:off + WINDOW]):
                continue
            if v[off:off + WINDOW] != o[off:off + WINDOW]:
                continue
            c = crc(masked(v, off, WINDOW))
            windows.setdefault(f, []).extend([off, c])
            count += 1
    for f in MARKER_FILES:
        v, o = read(f, 'v'), read(f, 'o')
        for s0, e0 in ranges(v, o, gap=16):
            if any(excl[f][s0:e0]):
                continue
            s1 = s0 & ~3
            e1 = (e0 + 3) & ~3
            cv, co = crc(masked(v, s1, e1 - s1)), crc(masked(o, s1, e1 - s1))
            if cv == co:
                continue  # immediate-only difference: not a stable marker
            markers.append([f, s1, e1 - s1, cv, co])
    return {'windowLength': WINDOW, 'windowTolerance': max(8, count // 100), 'windows': windows,
            'markers': markers, 'minMarkerVotes': max(8, len(markers) // 4), 'markerAgreement': 0.9}


def main():
    allow = '--allow-missing' in sys.argv
    write_stones()
    specs = load_specs(allow)
    features = []
    owner = {}
    for s in specs:
        edits = convert(s) if not s.get('missing') else []
        for e in edits:
            for i in range(len(e['on']) // 2):
                key = (e['file'], e['offset'] + i)
                if key in owner and owner[key] != s['id']:
                    raise SystemExit(f"byte overlap {key} between {owner[key]} and {s['id']}")
                owner[key] = s['id']
        vanilla = s.get('vanilla', {})
        feat = {'id': s['id'], 'label': s.get('label', s['id'])}
        for k in ('wip', 'subtitle', 'summary', 'requires', 'valueTemplate', 'defaults', 'values', 'contextReason', 'partialIsOn', 'vanillaNote'):
            if s.get(k):
                feat[k] = s[k]
        if vanilla.get('vanillaRequires'):
            feat['vanillaRequires'] = vanilla['vanillaRequires']  # extra dependencies on vanilla images only
        feat['vanilla'] = True if vanilla.get('supported') else (vanilla.get('reason') or 'Available only on Alternate Scarlet Symphony images.')
        if s.get('context'):
            feat['context'] = [[c['file'], h(c['offset']), int(c['length']), crc(masked(read(c['file'], 'a'), h(c['offset']), int(c['length'])))] for c in s['context']]
        if s.get('onVersions'):
            for version in s['onVersions']:
                assert len(version) == len(edits), (s['id'], 'incomplete version')
                assert all(len(bytes.fromhex(form)) == len(bytes.fromhex(edit['on'])) for form, edit in zip(version, edits)), (s['id'], 'invalid version')
            feat['onVersions'] = [[form.upper() for form in version] for version in s['onVersions']]
        feat['edits'] = edits
        if OVERRIDES.get(s['id'], {}).get('useEntities'):
            feat['entities'] = convert_entities(s)
            for k in ('entityLabel', 'entityOnText'):
                if s.get(k):
                    feat[k] = s[k]
        alt = vanilla.get('vanillaAlternative')
        if alt:
            # A different edit set for vanilla images; its off bytes must be vanilla's.
            vedits = []
            for e in alt:
                f, off, on, of = e['file'], h(e['offset']), bytes.fromhex(e['on']), bytes.fromhex(e['off'])
                assert len(on) == len(of) and read(f, 'v')[off:off + len(of)] == of, (s['id'], 'vanillaAlternative', f, hex(off))
                vedits.append({'file': f, 'offset': off, 'off': of.hex().upper(), 'on': on.hex().upper()})
            feat['vanillaEdits'] = vedits
            feat['vanilla'] = True
        features.append(feat)
    ids = {ft['id'] for ft in features}
    for ft in features:
        for e in ft['edits']:
            assert e.get('with', {}).get('feature', ft['id']) in ids, (ft['id'], e.get('with'))
        for need in ft.get('requires', []) + ft.get('vanillaRequires', []):
            assert need in ids, (ft['id'], need)
    fp = fingerprint(specs)
    sizes = {}
    for f in sorted({e['file'] for ft in features for e in ft['edits']} | set(MARKER_FILES)):
        sizes[f] = files_v_size(f)
    source_hash = hashlib.sha256(IMAGES['a'].read_bytes()).hexdigest().upper()[:8]
    catalog = {'version': 2, 'built': f'from ASS 1.3.1, ASS 2.0 ({source_hash}) and vanilla US', 'files': sizes,
               'fingerprint': fp, 'features': features}
    text = '// Extra Hacks catalog (generated). Byte signatures per hack, plus a code fingerprint for vanilla US / ASS.\n'
    text += 'window.SotnExtraHacks = ' + json.dumps(catalog, separators=(',', ':')) + ';\n'
    out = Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else OUT
    out.write_text(text, encoding='utf-8')
    print('wrote', out, len(text), 'bytes;', sum(len(x) // 2 for x in fp['windows'].values()), 'windows,', len(fp['markers']), 'markers')
    for ft in features:
        print('  %-18s edits=%3d bytes=%6d vanilla=%s' % (ft['id'], len(ft['edits']), sum(len(e['on']) // 2 for e in ft['edits']), ft['vanilla'] is True))


def files_v_size(f):
    return files('v')[f][1]


if __name__ == '__main__':
    main()
