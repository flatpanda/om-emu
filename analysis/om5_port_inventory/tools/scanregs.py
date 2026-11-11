#!/usr/bin/env python3
"""scanregs.py -- locate data tables by row shape in the two expanded main images.

1. settings-descriptor table (20-byte rows, cf. emu/refs/settings.mjs DESCRIPTORS:
   {u16 sid, u16 key2, u32 data-ptr, u32 table-ptr, u16 nbytes, u16 esize, u8 b16, u8 dtype})
2. app_check_mode registry (12-byte rows, cf. analysis/om-c-firmware 3.6 on E143:
   {u16 mode, u16 pad, u32 *u8 index list, u8 n, 3 pad})

A row is a candidate when its pointer fields land inside the image and its flag
bytes are small; a table is a maximal run of consecutive candidates. The scan
slides over every byte offset (alignment-agnostic) and reports the longest runs.
Writes evidence/scan_descriptors_E1xx.tsv and evidence/scan_appcheck_E1xx.tsv.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import om5diff as M

BASE = M.IMAGE_BASE


def scan_descriptors(img):
    n = len(img)
    best = {}
    for off in range(0, n - 20):
        sid, key2, data, table = struct.unpack_from('<HHII', img, off)
        nb, es = struct.unpack_from('<HH', img, off + 12)
        b16, dtype = img[off + 16], img[off + 17]
        ok = (0 <= sid <= 17000 and BASE <= data < BASE + n and BASE <= table < BASE + n
              and nb <= 4096 and es <= 512 and b16 <= 4 and dtype <= 8)
        # greedily extend the run from here only when the previous byte failed
        if ok and (off == 0 or not prev_ok_cache.get(off - 1)):
            end = off
            while end + 20 <= n:
                s2, k2, d2, t2 = struct.unpack_from('<HHII', img, end)
                nb2, es2 = struct.unpack_from('<HH', img, end + 12)
                b2, dt2 = img[end + 16], img[end + 17]
                if not (0 <= s2 <= 17000 and BASE <= d2 < BASE + n and BASE <= t2 < BASE + n
                        and nb2 <= 4096 and es2 <= 512 and b2 <= 4 and dt2 <= 8):
                    break
                end += 20
            run = (end - off) // 20
            if run >= 200:
                best[off] = run
    return best


prev_ok_cache = {}


def scan_descriptors2(img):
    """Two-pass run scan (avoids per-offset restarts)."""
    n = len(img)

    def row_ok(o):
        sid, key2, data, table = struct.unpack_from('<HHII', img, o)
        nb, es = struct.unpack_from('<HH', img, o + 12)
        b16, dtype = img[o + 16], img[o + 17]
        return (0 <= sid <= 17000 and BASE <= data < BASE + n and BASE <= table < BASE + n
                and nb <= 4096 and es <= 512 and b16 <= 4 and dtype <= 8)

    ok = bytearray(n)
    for o in range(0, n - 20):
        ok[o] = row_ok(o)
    runs = []
    o = 0
    while o < n - 20:
        if ok[o]:
            s = o
            while o < n - 20 and ok[o]:
                o += 20
            if (o - s) >= 200 * 20:
                runs.append((s, (o - s) // 20))
        else:
            o += 1
    return runs


def scan_appcheck(img):
    n = len(img)

    def row_ok(o):
        mode, pad, ptr, nb = struct.unpack_from('<HHIB', img, o)
        p1, p2, p3 = img[o + 9], img[o + 10], img[o + 11]
        return (0 < mode <= 0xFFFF and ptr > BASE + 0x1000 and ptr < BASE + n
                and 0 < nb <= 128 and p1 == 0 and p2 == 0 and p3 == 0)

    ok = bytearray(n)
    for o in range(0, n - 12):
        ok[o] = row_ok(o)
    runs = []
    o = 0
    while o < n - 12:
        if ok[o]:
            s = o
            while o < n - 12 and ok[o]:
                o += 12
            if (o - s) >= 100 * 12:
                runs.append((s, (o - s) // 12))
        else:
            o += 1
    return runs


def main():
    for code in ('E144', 'E148'):
        img = open(os.path.join(M.PKG, 'blocks', code, 'main_expanded.bin'), 'rb').read()
        ev = os.path.join(M.PKG, 'evidence')
        with open(os.path.join(ev, f'scan_descriptors_{code}.tsv'), 'w', newline='\n') as f:
            for s, r in scan_descriptors2(img):
                sid0, key2, data, table = struct.unpack_from('<HHII', img, s)
                sidN, _, _, _ = struct.unpack_from('<HHII', img, s + 20 * (r - 1))
                f.write(f'{s:#x}\t{r}\tfirst_sid={sid0}\tlast_sid={sidN}\n')
                print(f'{code} descriptors: run@{s:#x} rows={r} sids {sid0}..{sidN}')
        with open(os.path.join(ev, f'scan_appcheck_{code}.tsv'), 'w', newline='\n') as f:
            for s, r in scan_appcheck(img):
                mode0, _, ptr0, nb0 = struct.unpack_from('<HHIB', img, s)
                f.write(f'{s:#x}\t{r}\tfirst_mode={mode0}\tfirst_ptr={ptr0:#x}\tn0={nb0}\n')
                print(f'{code} appcheck: run@{s:#x} rows={r} first_mode={mode0}')


if __name__ == '__main__':
    main()
