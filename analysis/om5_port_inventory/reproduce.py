#!/usr/bin/env python3
"""reproduce.py -- end-to-end, deterministic regeneration of this package's evidence.

Run from anywhere with the repo checkout present:
    py -3.11 "D:/AI/om-emu-port52to51/analysis/om5_port_inventory/reproduce.py"

Pipeline (all steps read only the two pinned updater .BINs under fw/ and write
only inside this package):
  1. verify both .BIN SHA-256 digests (hard-pinned below)
  2. walk/descramble/checksum both containers with repo tools/olyfw.py, dump the
     10 block bodies under blocks/<code>/ and verify them against BLOBS.sha256's
     pinned digests
  3. expand the main blocks' olycompress spans (own LZ4 decoder; the digests are
     pinned below and were cross-checked byte-for-byte against the repo's own
     emu/src/fw/expand.mjs expandImage() output)
  4. regenerate every evidence/ file (strings, diffs, scans, language tables,
     kinship probes)
  5. write evidence/evidence.sha256 (sha256 of every evidence file, sorted)
Exits non-zero on any mismatch. Blocks (blocks/) are not hashed as evidence:
they are the pinned inputs' direct decompressions, verified in step 2.
"""
import hashlib
import os
import subprocess
import sys

PKG = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(PKG, '..', '..', '..'))
TOOLS = os.path.join(PKG, 'tools')
sys.path.insert(0, TOOLS)
sys.path.insert(0, os.path.join(REPO, 'tools'))

BIN_SHA = {
    'fw/OLY_E_144_1200_0000_0000.BIN': 'a0c91f3ac7caaf0925b2af609e711183cf3b5982b3333224bcef26c0c5943d11',
    'fw/OLY_E_148_1100_0000_0000.BIN': '9de5d77e1d290fa2ed4ebc7d75cee0ed490befbc89566722467d1d421d66d637',
}
BLOCK_SHA = {
    'E144/OLY_E_144_1200_0000_0000.BIN.blk00000000.OE.0100.bin': 'cf4babeab5f516514e4a9b6032b0374e643830511e083b9cdd26bcb02980af88',
    'E144/OLY_E_144_1200_0000_0000.BIN.blk017c0000.OE.0101.bin': '36d70aaef469dbeb4feba9cfe5946c64b1e957e12f7a7692ead2955d3cc41f1a',
    'E144/OLY_E_144_1200_0000_0000.BIN.blk02520000.OE.0106.bin': '8bda3804fddcc206f7c1a78b30b0765eb69b84b15c872eec99cda46be795b8aa',
    'E144/OLY_E_144_1200_0000_0000.BIN.blk050c0000.OE.010e.bin': 'b61feee4954ac5ea46d9b07677e68e1190a7eba69cffe1a8e46d058eeb94ab3b',
    'E144/OLY_E_144_1200_0000_0000.BIN.blk05100000.OE.0102.bin': '6bcc8258768c05717430fb39afe4761b3aded45e76bcc0e7fed328b076d1de33',
    'E148/OLY_E_148_1100_0000_0000.BIN.blk00000000.OE.0100.bin': 'f9c6b0bb37675a2b031ccf09292796ab5793994b8ce2053dcfd7f9fe68035cd8',
    'E148/OLY_E_148_1100_0000_0000.BIN.blk017c0000.OE.0101.bin': '0576d786f8f40350ec9f620c7302f95c317c979fed88d9afc678c5b7e6f59fa0',
    'E148/OLY_E_148_1100_0000_0000.BIN.blk023c0000.OE.0106.bin': '80d07a7bef901e9e428f6dac6023378e1cb0b9ae4b7a280a15636bc4b116239f',
    'E148/OLY_E_148_1100_0000_0000.BIN.blk04c60000.OE.010e.bin': '82dc5d9cfb499e843570f37847b18192ea8d014f27d81c1378dd0e78f9f5ca88',
    'E148/OLY_E_148_1100_0000_0000.BIN.blk04ca0000.OE.0102.bin': '0e77202f0c735fc2a88776897c1e17ef0c24521a12bd84ff7cc7bb6c6f368780',
}
EXPANDED_SHA = {
    'E144': '692f1b9eb6f89fe6467ade3c88092305b0423ac1aa6ba759eac83b6cd5d36487',
    'E148': '7ae7d4c60990cc859c070e0ceb6cbe612f9c5b260713f2f1256e51d137851c61',
}


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def main():
    import om5diff as M

    # 1+2: containers and blocks
    for code in ('E144', 'E148'):
        blks = M.blocks(code)  # verifies .BIN sha256 + per-block sum32
        for off, hd, body in blks:
            name = f"{os.path.basename(M.FW[code])}.blk{off:08x}.{hd['typ'].decode()}.{hd['flags']:04x}.bin"
            outp = os.path.join(PKG, 'blocks', code, name)
            open(outp, 'wb').write(body)
            got = sha256(open(outp, 'rb').read())
            want = BLOCK_SHA[f'{code}/{name}']
            if got != want:
                raise SystemExit(f'block digest mismatch {code}/{name}: {got}')
            print(f'ok block {code}/{name}')
    # 3: expansion
    for code in ('E144', 'E148'):
        rom = M.body_by_flags(code, 0x0100)[2]
        exp = M.expand_main(rom)
        got = sha256(exp)
        if got != EXPANDED_SHA[code]:
            raise SystemExit(f'expanded image digest mismatch {code}: {got}')
        open(os.path.join(PKG, 'blocks', code, 'main_expanded.bin'), 'wb').write(exp)
        print(f'ok expanded {code}')
    # 4: evidence
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'om5diff.py'), 'resindex'], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'om5diff.py'), 'resstrings'], cwd=PKG)
    for code in ('E144', 'E148'):
        subprocess.check_call([sys.executable, os.path.join(TOOLS, 'om5diff.py'), 'strings', code], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'om5diff.py'), 'diffblocks'], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'reslang.py')], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'strdiff.py')], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'scanregs.py')], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'kinship.py')], cwd=PKG)
    subprocess.check_call([sys.executable, os.path.join(TOOLS, 'features.py')], cwd=PKG)
    # text-keyed enu diff (written by an inline step in the session; repeated here)
    from reslang import parse_table
    import re
    tab = {}
    for code in ('E144', 'E148'):
        off, hd, block = M.body_by_flags(code, 0x0101)
        entries = M.res_index(block)
        for e in range(1, 19):
            data, _ = M.res_record(block, entries, e)
            tag, count, ptr, texts = parse_table(data)
            tab[(code, tag)] = texts
    ta = {v for v in tab[('E144', 'enu')].values() if v}
    tb = {v for v in tab[('E148', 'enu')].values() if v}
    with open(os.path.join(PKG, 'evidence', 'res_enu_textnew_in_E148.tsv'), 'w', newline='\n') as f:
        for t in sorted(tb - ta):
            f.write(t.replace('\t', ' ').replace('\n', ' / ') + '\n')
    with open(os.path.join(PKG, 'evidence', 'res_enu_textgone_from_E144.tsv'), 'w', newline='\n') as f:
        for t in sorted(ta - tb):
            f.write(t.replace('\t', ' ').replace('\n', ' / ') + '\n')
    # 5: evidence manifest
    ev = os.path.join(PKG, 'evidence')
    lines = []
    for name in sorted(os.listdir(ev)):
        p = os.path.join(ev, name)
        if os.path.isfile(p) and name != 'evidence.sha256':
            lines.append(f'{sha256(open(p, "rb").read())}  {name}')
    with open(os.path.join(ev, 'evidence.sha256'), 'w', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'evidence.sha256 written ({len(lines)} files)')
    print('reproduce.py: all checks passed')


if __name__ == '__main__':
    main()
