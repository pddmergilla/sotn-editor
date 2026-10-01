"""Shared helpers: ISO9660 over raw 2352 BINs, file reads, diffs, disassembly."""
import struct, sys, os, pickle, hashlib
from pathlib import Path
from functools import lru_cache

HERE = Path(__file__).parent
try:  # only dis() needs capstone (pip install capstone)
    import capstone
except ImportError:
    capstone = None

DL = Path(os.environ.get('SOTN_DOWNLOADS', r'C:\Users\omergilla\Downloads'))
IMAGES = {
    'v': Path(os.environ.get('SOTN_VANILLA_BIN', DL / 'Castlevania - Symphony of the Night (USA)' / 'Castlevania - Symphony of the Night (USA) (Track 1).bin')),
    'o': Path(os.environ.get('SOTN_ASS_OLD_BIN', DL / 'Castlevania - Symphony of the Night Alter.bin')),   # ASS 1.3.1 (old base)
    'a': Path(os.environ.get('SOTN_ASS_BIN', DL / 'Castlevania - Alternate Scarlet Symphony 2.0.bin')),    # current ASS
    'b': DL / 'Castlevania - Alternate Scarlet Symphony 2.0 - backup before Eat-Food-On-Pickup.bin',
    't': DL / 'Castlevania - ASS Test.bin',
}
SECTOR, DATA = 2352, 2048


def _payload(f, lba, n=1):
    out = bytearray()
    for i in range(n):
        f.seek((lba + i) * SECTOR + 24)
        out += f.read(DATA)
    return bytes(out)


def _dir(f, lba, size):
    data = _payload(f, lba, (size + DATA - 1) // DATA)
    pos = 0
    while pos < size:
        ln = data[pos]
        if ln == 0:
            pos = (pos // DATA + 1) * DATA
            continue
        rec = data[pos:pos + ln]
        nl = rec[32]
        name = rec[33:33 + nl].decode('ascii', 'replace')
        if name not in ('\x00', '\x01'):
            yield name.split(';')[0], struct.unpack_from('<I', rec, 2)[0], struct.unpack_from('<I', rec, 10)[0], bool(rec[25] & 2)
        pos += ln


@lru_cache(None)
def files(kind):
    with IMAGES[kind].open('rb') as f:
        pvd = _payload(f, 16)
        root = pvd[156:]
        found = {}

        def visit(prefix, lba, size):
            for name, cl, cs, d in _dir(f, lba, size):
                p = f'{prefix}/{name}' if prefix else name
                if d:
                    visit(p, cl, cs)
                else:
                    found[p] = (cl, cs)
        visit('', struct.unpack_from('<I', root, 2)[0], struct.unpack_from('<I', root, 10)[0])
        return found


@lru_cache(None)
def read(name, kind):
    lba, size = files(kind)[name]
    with IMAGES[kind].open('rb') as f:
        return _payload(f, lba, (size + DATA - 1) // DATA)[:size]


def raw(name, pos, kind='v'):
    lba, _ = files(kind)[name]
    return (lba + pos // DATA) * SECTOR + 24 + pos % DATA


def ranges(a, b, gap=0):
    out = []
    n = min(len(a), len(b))
    p = 0
    while p < n:
        if a[p] != b[p]:
            if out and p - out[-1][1] <= gap:
                out[-1][1] = p + 1
            else:
                out.append([p, p + 1])
        p += 1
    return out


BASES = {'DRA.BIN': 0x800A0000, 'BIN/RIC.BIN': 0x8013C000, 'SLUS_000.67': 0x80010000 - 0x800}


def base_of(name):
    if name in BASES:
        return BASES[name]
    if name.startswith('BIN/ARC_F') or name.startswith('BIN/F_'):
        return 0
    if name.startswith('SERVANT/'):
        return 0x80170000
    if name.startswith('BIN/WEAPON'):
        return 0x8017A000
    return 0x80180000


CS = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 | capstone.CS_MODE_LITTLE_ENDIAN) if capstone else None


def ins(word_bytes, addr):
    r = list(CS.disasm(bytes(word_bytes), addr)) if CS else []
    return (r[0].mnemonic + ' ' + r[0].op_str) if r else '.word 0x%08x' % struct.unpack('<I', bytes(word_bytes))[0]


def dis(name, start, end, kinds=('v', 'o', 'a'), base=None, width=34):
    base = base_of(name) if base is None else base
    data = [read(name, k) for k in kinds]
    start &= ~3
    for p in range(start, end, 4):
        cols = []
        for d in data:
            cols.append(ins(d[p:p + 4], base + p) if p + 4 <= len(d) else '--')
        mark = ''.join('*' if data[i][p:p+4] != data[0][p:p+4] else ' ' for i in range(1, len(data)))
        print(f'{p:06X} {base+p:08X} {mark} ' + ' | '.join(c[:width].ljust(width) for c in cols))


def ppf_records(path):
    P = Path(path).read_bytes()
    assert P[:5] == b'PPF30', path
    undo = P[58]
    pos = 1084 if P[57] else 60
    out = []
    while pos < len(P):
        off, n = struct.unpack_from('<QB', P, pos)
        pos += 9
        new = P[pos:pos + n]
        pos += n
        old = None
        if undo:
            old = P[pos:pos + n]
            pos += n
        out.append((off, new, old))
    return out


def file_of_raw(rawoff, kind='v'):
    sec, part = divmod(rawoff, SECTOR)
    for name, (lba, size) in files(kind).items():
        n = (size + DATA - 1) // DATA
        if lba <= sec < lba + n:
            return name, (sec - lba) * DATA + part - 24
    return None, None
