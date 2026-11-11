#!/usr/bin/env python3
"""reslang.py -- parse the resource blocks' per-language string tables (StringTable
semantics mirrored from emu/src/lab/resources.mjs) and diff them by string id.

Usage: py -3.11 tools/reslang.py
Writes:
  evidence/res_lang_table.csv           -- body, record index, tag, n_strings, record bytes
  evidence/res_strings_<CODE>_enu.tsv   -- sid<TAB>text for the 'enu' record of each body
  evidence/res_enu_diff_added.tsv       -- sid<TAB>E148 text   (sid absent in E144)
  evidence/res_enu_diff_removed.tsv     -- sid<TAB>E144 text   (sid absent in E148)
  evidence/res_enu_diff_changed.csv     -- sid, E144 text, E148 text (same sid, different text)
Assumes the loader slot base 0xA502B680 (E143's; validated per record: the header,
pointer array and tag must land inside the record) and FONT_RECORD_SIZE = 74.
"""
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import om5diff as M

LINK = 0xA502B680  # E143's loader slot base; E144/E148 derive their own from the tag position
FONT_RECORD_SIZE = 74
TAG_PAT = 'OlympusLanguage_'.encode('utf-16le')


def parse_table(data):
    first, end = struct.unpack_from('<II', data, 0)
    if (end - first) % 4:
        raise ValueError(f'header {first:#x}..{end:#x} not a 4-array')
    count = (end - first) // 4
    # the tag (UTF-16LE "OlympusLanguage_XXXtft") sits at record offset (end - link + 74);
    # finding it pins this record's slot base: link = end + 74 - tag_offset.
    tag_off = data.find(TAG_PAT)
    if tag_off < 0:
        raise ValueError('no OlympusLanguage tag (utf-16) in record')
    link = end + FONT_RECORD_SIZE - tag_off
    po = first - link
    if not (0 <= po and po + 4 * count <= len(data)):
        raise ValueError(f'pointer array at {po:#x} x {count} outside record ({len(data)})')
    pointers = struct.unpack_from(f'<{count}I', data, po)
    name_off = tag_off
    name = data[name_off:name_off + 2 * FONT_RECORD_SIZE]
    units = [name[i] | (name[i + 1] << 8) for i in range(0, len(name), 2)]
    z = units.index(0) if 0 in units else len(units)
    text = ''.join(chr(u) for u in units[:z])
    m = re.match(r'^OlympusLanguage_(\w{3})tft$', text)
    if not m:
        raise ValueError(f'tag {text!r} does not parse')
    texts = {}
    for sid, p in enumerate(pointers):
        o = p - link
        if not (0 <= o < len(data)):
            texts[sid] = None
            continue
        e = o
        while e + 1 < len(data) and not (data[e] == 0 and data[e + 1] == 0):
            e += 2
        raw = data[o:e]
        try:
            texts[sid] = raw.decode('utf-16le')
        except UnicodeDecodeError:
            texts[sid] = raw.decode('utf-16le', 'replace')
    return m.group(1), count, pointers, texts


def main():
    tables = {}
    rows = []
    for code in ('E144', 'E148'):
        off, hd, block = M.body_by_flags(code, 0x0101)
        entries = M.res_index(block)
        n = (len(entries) - 2) // 2
        for e in range(1, n + 1):
            data, comp = M.res_record(block, entries, e)
            try:
                tag, count, pointers, texts = parse_table(data)
                tables[(code, tag)] = (e, count, texts, len(data))
                rows.append((code, e, tag, count, len(data)))
            except ValueError as ex:
                rows.append((code, e, f'FAIL({ex})', 0, len(data)))
    with open(os.path.join(M.PKG, 'evidence', 'res_lang_table.csv'), 'w', newline='\n') as f:
        f.write('body,record,tag,n_strings,record_bytes\n')
        for r in rows:
            f.write(','.join(str(x) for x in r) + '\n')
    for r in rows:
        print(r)

    # English diff by sid
    a = tables.get(('E144', 'enu'))
    b = tables.get(('E148', 'enu'))
    if not a or not b:
        raise SystemExit('enu record not found')
    _, _, ta, _ = a
    _, _, tb, _ = b
    added = [s for s in sorted(tb) if s not in ta]
    removed = [s for s in sorted(ta) if s not in tb]
    changed = [s for s in sorted(ta) if s in tb and ta[s] != tb[s]]
    ev = os.path.join(M.PKG, 'evidence')
    with open(os.path.join(ev, 'res_strings_E144_enu.tsv'), 'w', newline='\n') as f:
        for s in sorted(ta):
            if ta[s]:
                f.write(f'{s}\t{ta[s]}\n')
    with open(os.path.join(ev, 'res_strings_E148_enu.tsv'), 'w', newline='\n') as f:
        for s in sorted(tb):
            if tb[s]:
                f.write(f'{s}\t{tb[s]}\n')
    with open(os.path.join(ev, 'res_enu_diff_added.tsv'), 'w', newline='\n') as f:
        for s in added:
            if tb[s]:
                f.write(f'{s}\t{tb[s]}\n')
    with open(os.path.join(ev, 'res_enu_diff_removed.tsv'), 'w', newline='\n') as f:
        for s in removed:
            if ta[s]:
                f.write(f'{s}\t{ta[s]}\n')
    with open(os.path.join(ev, 'res_enu_diff_changed.csv'), 'w', newline='\n') as f:
        f.write('sid,e144_text,e148_text\n')
        for s in changed:
            f.write(f'{s},"{(ta[s] or "").replace(chr(34), chr(39))}","{(tb[s] or "").replace(chr(34), chr(39))}"\n')
    print(f'enu: added={len(added)} removed={len(removed)} changed={len(changed)}')


if __name__ == '__main__':
    main()
