#!/usr/bin/env python3
"""strdiff.py -- content-keyed string-set diffs between the two expanded main images
(and optionally between resource string-table records).

Writes evidence/strdiff_ascii_E144_only.tsv, ..._E148_only.tsv,
evidence/strdiff_utf16_E144_only.tsv, ..._E148_only.tsv.
Rows: string<TAB>comma-separated offsets in the owning image (all occurrences).
Only strings that occur in exactly one image are listed (pure adds/removes);
strings shared with changed offsets are not listed here (the per-image TSVs have
every offset).
"""
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import om5diff as M

PKG = M.PKG


def load(code, kind):
    path = os.path.join(PKG, 'evidence', f'{kind}_strings_{code}.tsv')
    offs = defaultdict(list)
    with open(path, encoding='utf-8') as f:
        for line in f:
            o, s = line.rstrip('\n').split('\t', 1)
            offs[s].append(int(o, 16))
    return offs


def diff(kind, a='E144', b='E148'):
    A, B = load(a, kind), load(b, kind)
    for name, X, Y in ((f'{a}_only', A, B), (f'{b}_only', B, A)):
        rows = [(s, X[s]) for s in X if s not in Y]
        rows.sort(key=lambda r: r[1][0])
        outp = os.path.join(PKG, 'evidence', f'strdiff_{kind}_{name}.tsv')
        with open(outp, 'w', newline='\n') as f:
            for s, offs in rows:
                f.write(s + '\t' + ','.join(hex(o) for o in offs) + '\n')
        print(f'strdiff {kind} {name}: {len(rows)} strings -> {outp}')


if __name__ == '__main__':
    diff('ascii')
    diff('utf16')
