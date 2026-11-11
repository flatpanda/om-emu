#!/usr/bin/env python3
"""kinship.py -- sample code-kinship probes between the two expanded main images.

Method: pick log strings present in BOTH builds (feature anchors), find every
image offset where a u32 LE literal equals the string's run-time address
(BASE + block offset; these are the code sites that load the string address),
then byte-compare a window around the FIRST such site in each build and report
the longest common prefix/suffix and the equal-byte share.

Also reports whole-image byte-equality for the uncompressed head region
(0..first compressed span) where both builds are directly comparable.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import om5diff as M

BASE = M.IMAGE_BASE

ANCHORS = [
    'ch illegal range (0-13):',
    '[FLSH]Flash Access Guard Error!!!',
    'app_check_mode():mode=%d,check=%d,status=%d',
    '- uITRON Error Code  -',
    'USBIP_GUSB3PIPECTL0  :',
    'OlyTaSS',
]


def refs(img, s):
    """All image offsets holding the u32 literal BASE+off for string at block offset off."""
    out = []
    for off, text in M.ascii_strings(img, 6):
        if text == s:
            addr = BASE + off
            needle = struct.pack('<I', addr)
            q = 0
            while True:
                q = img.find(needle, q)
                if q < 0:
                    break
                out.append((off, q))
                q += 1
            return off, out
    return None, []


def main():
    imgs = {c: open(os.path.join(M.PKG, 'blocks', c, 'main_expanded.bin'), 'rb').read()
            for c in ('E144', 'E148')}
    rows = []
    for s in ANCHORS:
        off_a, ra = refs(imgs['E144'], s)
        off_b, rb = refs(imgs['E148'], s)
        if ra and rb:
            wa = imgs['E144'][ra[0][1] - 96: ra[0][1] + 128]
            wb = imgs['E148'][rb[0][1] - 96: rb[0][1] + 128]
            pre = 0
            while pre < min(len(wa), len(wb)) and wa[pre] == wb[pre]:
                pre += 1
            suf = 0
            while suf < min(len(wa), len(wb)) - pre and wa[-1 - suf] == wb[-1 - suf]:
                suf += 1
            same = sum(1 for x, y in zip(wa, wb) if x == y)
            rows.append((s, hex(off_a), hex(off_b), len(ra), len(rb),
                         hex(ra[0][1]), hex(rb[0][1]), pre, suf, f'{same}/{len(wa)}'))
            print(f'{s!r}: str@{hex(off_a)}/{hex(off_b)} refs {len(ra)}/{len(rb)} '
                  f'code@{hex(ra[0][1])}/{hex(rb[0][1])} prefix={pre} suffix={suf} equal={same}/{len(wa)}')
        else:
            rows.append((s, hex(off_a) if off_a is not None else '-', hex(off_b) if off_b is not None else '-',
                         len(ra), len(rb), '-', '-', '-', '-', '-'))
            print(f'{s!r}: refs {len(ra)}/{len(rb)}')
    with open(os.path.join(M.PKG, 'evidence', 'kinship_samples.csv'), 'w', newline='\n') as f:
        f.write('anchor_string,block_off_E144,block_off_E148,refs_E144,refs_E148,'
                'code_ref_E144,code_ref_E148,prefix_eq,suffix_eq,window_eq\n')
        for r in rows:
            f.write(','.join(str(x).replace(',', ';') for x in r) + '\n')
    # head-region equality (uncompressed in both)
    a, b = imgs['E144'], imgs['E148']
    n = 0x825fe0
    same = sum(1 for i in range(n) if a[i] == b[i])
    print(f'head region 0x00..0x825fe0 (uncompressed): {same}/{n} bytes equal ({100*same/n:.2f}%)')


if __name__ == '__main__':
    main()
