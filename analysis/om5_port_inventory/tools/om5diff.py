#!/usr/bin/env python3
"""om5diff.py -- byte-grounded E144 (OM-5 v1.2) vs E148 (OM-5 II v1.1) firmware inventory tooling.

Static analysis only. Reads the two updater .BIN containers, walks the OE block
layout with tools/olyfw.py (imported from the repo tools/ directory), expands the
main blocks' `olycompress` spans with a self-contained LZ4 block decoder, and
emits deterministic evidence files (LF line endings, sorted rows).

Subcommands (each writes under evidence/ unless --out says otherwise):
  expand    -- expand both main blocks; print span table; validate raw sizes
  resindex  -- resource-block (flags 0x0101) index + record table for both bodies
  resstrings-- UTF-16LE strings per decompressed string-table record
  strings   -- ASCII (>=6) and UTF-16LE (>=4 chars) strings of expanded mains
  diffblocks-- byte-diff of the two misc (0x010e) blocks and raw main blocks
  cmp       -- helpers used by reproduce.py (hash checks)
All offsets printed are offsets into the DESCRAMBLED block bodies ("block offsets",
the analysis/ convention), not into the packed .BIN.
"""
import os
import struct
import sys
import hashlib

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TOOLS = os.path.join(REPO, 'tools')
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)
import olyfw  # repo tools/olyfw.py: walk(), descramble(), sum32()

PKG = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FW = {
    'E144': os.path.join(REPO, 'fw', 'OLY_E_144_1200_0000_0000.BIN'),
    'E148': os.path.join(REPO, 'fw', 'OLY_E_148_1100_0000_0000.BIN'),
}
SHA = {
    'E144': 'a0c91f3ac7caaf0925b2af609e711183cf3b5982b3333224bcef26c0c5943d11',
    'E148': '9de5d77e1d290fa2ed4ebc7d75cee0ed490befbc89566722467d1d421d66d637',
}
IMAGE_BASE = 0x60021020  # run-time base both builds assume (docs/model-survey.md)
OLY = b'olycompress'


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def load_bin(code):
    path = FW[code]
    data = open(path, 'rb').read()
    got = sha256(data)
    if got != SHA[code]:
        raise SystemExit(f'{code}: sha256 mismatch: {got}')
    return data


def blocks(code):
    """[(file_off, head dict, descrambled body)] via repo tools/olyfw.py."""
    blks, end = olyfw.walk(load_bin(code))
    for off, hd, body in blks:
        if not hd.get('cksum_ok'):
            raise SystemExit(f'{code}: block @{off:#x} checksum FAIL')
    return blks


def body_by_flags(code, flags):
    for off, hd, body in blocks(code):
        if hd['flags'] == flags:
            return off, hd, body
    raise SystemExit(f'{code}: no block with flags {flags:#x}')


# ---- LZ4 block decode (standard format; mirrors emu/src/lab/resources.mjs lz4Block) ----

def lz4_block(src, size):
    out = bytearray(size)
    o = 0
    n = len(src)
    i = 0
    while i < n:
        token = src[i]; i += 1
        length = token >> 4
        if length == 15:
            while True:
                b = src[i]; i += 1
                length += b
                if b != 255:
                    break
        if o + length > size:
            raise ValueError('literal overrun')
        out[o:o + length] = src[i:i + length]
        o += length; i += length
        if i >= n or o >= size:
            break
        offset = src[i] | (src[i + 1] << 8); i += 2
        match = token & 15
        if match == 15:
            while True:
                b = src[i]; i += 1
                match += b
                if b != 255:
                    break
        match += 4
        if not (0 < offset <= o):
            raise ValueError(f'bad LZ4 offset {offset} at input {i}')
        s = o - offset
        if offset >= match:
            out[o:o + match] = out[s:s + match]
            o += match
        else:
            for k in range(match):
                out[o + k] = out[s + k]
            o += match
    if o != size:
        raise ValueError(f'decoded {o} bytes, header says {size}')
    return bytes(out)


def find_oly(rom):
    p, hits = 0, []
    while True:
        p = rom.find(OLY, p)
        if p < 0:
            return hits
        hits.append(p)
        p += 1


def expand_main(rom):
    """Expand every olycompress container in place (emu/src/fw/expand.mjs semantics)."""
    out = bytearray(rom)
    for p in find_oly(rom):
        packed, raw = struct.unpack_from('<II', rom, p + 16)
        if p + 32 + packed > len(rom) or p + raw > len(rom):
            raise ValueError(f'container at {p:#x} overruns block')
        data = lz4_block(rom[p + 32:p + 32 + packed], raw)
        out[p:p + raw] = data
    return bytes(out)


# ---- BCS boot-section table ----

def bcs_table(rom):
    o = rom.find(b'BCS\x00')
    rows = []
    p = o + 4
    while p + 12 <= len(rom):
        dst, src, flag = struct.unpack_from('<III', rom, p)
        if dst < 0x60000000 or dst >= 0x70000000 or src < 0x40000000 or src >= 0x50000000 or flag > 1:
            break
        rows.append((dst, src, flag))
        p += 12
    return o, rows


# ---- strings ----

PRINTABLE = set(range(0x20, 0x7f))


def ascii_strings(d, minlen=6):
    out = []
    start = None
    for i, c in enumerate(d):
        if c in PRINTABLE:
            if start is None:
                start = i
        else:
            if start is not None and i - start >= minlen:
                out.append((start, d[start:i].decode('ascii')))
            start = None
    if start is not None and len(d) - start >= minlen:
        out.append((start, d[start:].decode('ascii')))
    return out


def utf16_strings(d, minlen=4):
    """UTF-16LE strings: runs of [printable ascii lo][00] pairs (the firmware's TftText)."""
    out = []
    i = 0
    n = len(d)
    while i + 1 < n:
        start = i
        chars = []
        while i + 1 < n and d[i] in PRINTABLE and d[i + 1] == 0:
            chars.append(chr(d[i]))
            i += 2
        if len(chars) >= minlen:
            out.append((start, ''.join(chars)))
        else:
            i = start + 1
    return out


# ---- resource block (flags 0x0101) ----

INDEX_READ = 2048
HEAD = 0x20
INDEX_AREA = INDEX_READ - HEAD


def res_index(block):
    entries = []
    for i in range(INDEX_AREA // 16):
        address, size, z1, z2 = struct.unpack_from('<IIII', block, 16 * i)
        if not address or z1 or z2:
            break
        entries.append((address, size))
    return entries


def res_origin(block, entries):
    return entries[0][0] - INDEX_AREA


def res_record(block, entries, entry):
    org = res_origin(block, entries)
    address, size = entries[entry]
    o = address - org
    stored = block[o:o + size]
    if stored[:11] == OLY and stored[11] == 0:
        packed, raw = struct.unpack_from('<II', stored, 16)
        return lz4_block(stored[0x20:0x20 + packed], raw), True
    return stored, False


def cmd_expand():
    for code in ('E144', 'E148'):
        off, hd, rom = body_by_flags(code, 0x0100)
        bcs_off, rows = bcs_table(rom)
        print(f'{code} main block body {len(rom)} bytes, BCS@{bcs_off:#x} rows={len(rows)}')
        for dst, src, flag in rows:
            fo = dst - IMAGE_BASE
            mark = ''
            if flag == 1:
                packed, raw = struct.unpack_from('<II', rom, fo + 16)
                mark = f' olycompress packed={packed:#x} raw={raw:#x}'
            print(f'  dst={dst:#010x} src={src:#010x} flag={flag} block_off={fo:#x}{mark}')
        exp = expand_main(rom)
        outp = os.path.join(PKG, 'blocks', code, 'main_expanded.bin')
        open(outp, 'wb').write(exp)
        print(f'  expanded -> {outp} sha256={sha256(exp)}')


def cmd_resindex():
    for code in ('E144', 'E148'):
        off, hd, block = body_by_flags(code, 0x0101)
        entries = res_index(block)
        org = res_origin(block, entries)
        print(f'{code} resource block body {len(block)} bytes, {len(entries)} index entries, origin={org:#x}')
        for k, (address, size) in enumerate(entries):
            o = address - org
            stored = block[o:o + min(size, 32)]
            comp = stored[:11] == OLY and stored[11] == 0
            rawsz = struct.unpack_from('<I', stored, 20)[0] if comp else size
            print(f'  [{k:3d}] address={address:#010x} size={size:#x} {"olycompress raw=" + hex(rawsz) if comp else "plain"}')


def cmd_resstrings():
    for code in ('E144', 'E148'):
        off, hd, block = body_by_flags(code, 0x0101)
        entries = res_index(block)
        org = res_origin(block, entries)
        n = (len(entries) - 2) // 2
        rows = []
        for e in range(1, n + 1):
            data, comp = res_record(block, entries, e)
            strs = utf16_strings(data, minlen=2)
            rows.append((e, len(data), comp, strs))
            outp = os.path.join(PKG, 'evidence', f'res_strings_{code}_rec{e:03d}.tsv')
            with open(outp, 'w', newline='\n') as f:
                for so, s in strs:
                    f.write(f'{so}\t{s}\n')
            print(f'{code} rec[{e}] bytes={len(data)} comp={comp} strings={len(strs)}')
        # fonts and images (last n entries) listed, not decoded
        for e in range(n + 1, len(entries)):
            address, size = entries[e]
            o = address - org
            stored = block[o:o + 32]
            comp = stored[:11] == OLY and stored[11] == 0
            print(f'{code} rec[{e}] stored_size={size:#x} comp={comp}')


def cmd_strings(code):
    exp = open(os.path.join(PKG, 'blocks', code, 'main_expanded.bin'), 'rb').read()
    rows = ascii_strings(exp, 6)
    with open(os.path.join(PKG, 'evidence', f'ascii_strings_{code}.tsv'), 'w', newline='\n') as f:
        for o, s in rows:
            f.write(f'{o:08x}\t{s}\n')
    print(f'{code} ascii>=6: {len(rows)}')
    rows = utf16_strings(exp, 4)
    with open(os.path.join(PKG, 'evidence', f'utf16_strings_{code}.tsv'), 'w', newline='\n') as f:
        for o, s in rows:
            f.write(f'{o:08x}\t{s}\n')
    print(f'{code} utf16>=4: {len(rows)}')


def cmd_diffblocks():
    import collections
    # misc blocks (0x010e)
    b = {}
    for code in ('E144', 'E148'):
        b[code] = body_by_flags(code, 0x010e)[2]
    if len(b['E144']) != len(b['E148']):
        print(f'misc blocks differ in size: E144={len(b["E144"])} E148={len(b["E148"])}')
    diffs = [(i, b['E144'][i], b['E148'][i]) for i in range(min(len(b['E144']), len(b['E148']))) if b['E144'][i] != b['E148'][i]]
    print(f'misc 0x010e: {len(diffs)} differing bytes of {min(len(b["E144"]), len(b["E148"]))}')
    with open(os.path.join(PKG, 'evidence', 'misc_block_diff.csv'), 'w', newline='\n') as f:
        f.write('offset,e144_byte,e148_byte\n')
        for i, x, y in diffs:
            f.write(f'{i:#x},{x:#02x},{y:#02x}\n')
    # raw main blocks
    m = {c: body_by_flags(c, 0x0100)[2] for c in ('E144', 'E148')}
    same = sum(1 for i in range(len(m['E144'])) if m['E144'][i] == m['E148'][i])
    print(f'raw main blocks: {same}/{len(m["E144"])} bytes equal ({100.0 * same / len(m["E144"]):.2f}%)')
    e = {c: open(os.path.join(PKG, 'blocks', c, 'main_expanded.bin'), 'rb').read() for c in ('E144', 'E148')}
    same = sum(1 for i in range(len(e['E144'])) if e['E144'][i] == e['E148'][i])
    print(f'expanded main images: {same}/{len(e["E144"])} bytes equal ({100.0 * same / len(e["E144"]):.2f}%)')
    # run-length report of differing regions (>=64 bytes apart merged)
    regions = []
    for i in range(len(e['E144'])):
        if e['E144'][i] != e['E148'][i]:
            if regions and i - regions[-1][1] <= 64:
                regions[-1][1] = i + 1
            else:
                regions.append([i, i + 1])
    with open(os.path.join(PKG, 'evidence', 'expanded_main_diff_regions.csv'), 'w', newline='\n') as f:
        f.write('from_off,to_off,len\n')
        for a, z in regions:
            f.write(f'{a:#x},{z:#x},{z - a}\n')
    print(f'expanded main: {len(regions)} differing regions (gaps <=64B merged)')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'expand':
        cmd_expand()
    elif cmd == 'resindex':
        cmd_resindex()
    elif cmd == 'resstrings':
        cmd_resstrings()
    elif cmd == 'strings':
        cmd_strings(sys.argv[2])
    elif cmd == 'diffblocks':
        cmd_diffblocks()
    else:
        raise SystemExit(__doc__)


if __name__ == '__main__':
    main()
