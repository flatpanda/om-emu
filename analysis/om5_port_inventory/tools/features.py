#!/usr/bin/env python3
"""features.py -- feature-keyword censuses + RAM literal census.

Writes:
  evidence/feature_census_ascii.tsv -- per keyword: hit counts in the two expanded
                                       images' ASCII strings (>=6 chars)
  evidence/feature_census_enu.tsv   -- per keyword: row counts matching in the two
                                       'enu' string tables (case-insensitive)
  evidence/ram_literal_census.csv   -- u32 literal distribution by address class
Keywords chosen from the resource-table diffs; counts are raw facts, the
feature-name reading of each keyword is in README.md.
"""
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import om5diff as M
from reslang import parse_table

KEYWORDS = ['Starry', 'Gradation', 'GND', 'High Res', 'HIGHRES', 'Focus Stacking', 'FocusStack',
            'Webcam', 'Bluetooth', 'Live ND', 'Airplane', 'Lever', 'AF Focus Adjustment',
            'Fine-tuning', 'USB', 'WLAN', 'BLE', 'GPS', 'Composite', 'Handheld']


def main():
    ev = os.path.join(M.PKG, 'evidence')
    imgs = {c: open(os.path.join(M.PKG, 'blocks', c, 'main_expanded.bin'), 'rb').read()
            for c in ('E144', 'E148')}
    strs = {}
    for c in ('E144', 'E148'):
        rows = M.ascii_strings(imgs[c], 6)
        strs[c] = [s for _, s in rows]
    tab = {}
    for code in ('E144', 'E148'):
        off, hd, block = M.body_by_flags(code, 0x0101)
        entries = M.res_index(block)
        for e in range(1, 19):
            data, _ = M.res_record(block, entries, e)
            tag, count, ptr, texts = parse_table(data)
            tab[(code, tag)] = [v for v in texts.values() if v]
    with open(os.path.join(ev, 'feature_census_ascii.tsv'), 'w', newline='\n') as f:
        f.write('keyword\tE144\tE148\n')
        for k in KEYWORDS:
            pat = re.compile(k, re.I)
            f.write(f'{k}\t{sum(1 for s in strs["E144"] if pat.search(s))}\t{sum(1 for s in strs["E148"] if pat.search(s))}\n')
    with open(os.path.join(ev, 'feature_census_enu.tsv'), 'w', newline='\n') as f:
        f.write('keyword\tE144\tE148\n')
        for k in KEYWORDS:
            pat = re.compile(k, re.I)
            f.write(f'{k}\t{sum(1 for s in tab[("E144", "enu")] if pat.search(s))}\t{sum(1 for s in tab[("E148", "enu")] if pat.search(s))}\n')
    # RAM literal census over the expanded images
    with open(os.path.join(ev, 'ram_literal_census.csv'), 'w', newline='\n') as f:
        f.write('body,scratch_0xa2xxxxxx,image_0x60021020_0x61900000,uncached_dram_0xa0_0xb0\n')
        for c in ('E144', 'E148'):
            img = imgs[c]
            n = len(img)
            scr = imgr = hi = 0
            for o in range(0, n - 4):
                v = struct.unpack_from('<I', img, o)[0]
                if 0xA2000000 <= v < 0xA2400000:
                    scr += 1
                elif 0x60021020 <= v < 0x61900000:
                    imgr += 1
                elif 0xA0000000 <= v < 0xB0000000:
                    hi += 1
            f.write(f'{c},{scr},{imgr},{hi}\n')
            print(f'{c}: scratch={scr} image={imgr} uncached={hi}')


if __name__ == '__main__':
    main()
