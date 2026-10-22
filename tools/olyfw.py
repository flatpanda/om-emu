#!/usr/bin/env python3
"""Walk / descramble / verify an Olympus-OM .BIN firmware container.

Format (community `oly_fw_manip`): file = concat of blocks, each
  <head:32><body:len><tail:32>
head/tail struct (LE, packed):
  0x00 u16 typeSig  ASCII 'OE'/'OM'/'OA'/'OL'
  0x02 u16 modelSig (2 bytes, big-endian nibble pair)
  0x04 u32 pad1
  0x08 u32 loadingAddress
  0x0C u32 len (body length)
  0x10 u16 version (BCD)
  0x12 u16 pad2
  0x14 u16 flags  (0x0000 code plain; 0x0100 code scrambled; 0x01xx resources)
  0x16 6B  pad3
  0x1C u32 checksum (0 in head; -sum32 in tail)
Scramble (flags!=0): per aligned 16 bytes decoded[k]=encoded[PERM[k]], then ^0xFF.
Checksum: sum of all u32 LE over head+UNSCRAMBLED body+tail (the 4 cksum bytes as 0) == 0.
"""
import sys, struct

PERM = [1,3,0,2, 6,4,7,5, 11,10,9,8, 13,14,12,15]  # decoded[k] = encoded[PERM[k]]
XOR_FF = bytes(i ^ 0xFF for i in range(256))

def descramble(b):
    out = bytearray(b)
    n = len(b) - len(b) % 16
    for k, p in enumerate(PERM):
        out[k:n:16] = b[p:n:16].translate(XOR_FF)
    # tail (not mult of 16) left as-is; real bodies are 16-aligned
    for i in range(len(b) - len(b) % 16, len(b)):
        out[i] = b[i]
    return bytes(out)

def scramble(b):
    """Inverse of descramble; retain the existing unaligned-tail convention."""
    out = bytearray(b)
    n = len(b) - len(b) % 16
    for k, p in enumerate(PERM):
        out[p:n:16] = b[k:n:16].translate(XOR_FF)
    return bytes(out)

def sum32(b):
    n = len(b) - len(b) % 4
    if sys.byteorder == 'little':
        return sum(memoryview(b)[:n].cast('I')) & 0xFFFFFFFF
    return sum(v[0] for v in struct.iter_unpack('<I', memoryview(b)[:n])) & 0xFFFFFFFF

def parse_head(h):
    typ = h[0:2]
    model = h[2:4]
    pad1, load, blen = struct.unpack_from('<III', h, 4)
    ver, pad2, flags = struct.unpack_from('<HHH', h, 0x10)
    cks = struct.unpack_from('<I', h, 0x1C)[0]
    return dict(typ=typ, model=model.hex(), load=load, len=blen, ver=ver,
                flags=flags, cks=cks)

def walk(f):
    off = 0
    blocks = []
    while off + 32 <= len(f):
        h = f[off:off+32]
        if h[0:2] not in (b'OE', b'OM', b'OA', b'OL'):
            break
        hd = parse_head(h)
        blen = hd['len']
        body_off = off + 32
        tail_off = body_off + blen
        if tail_off + 32 > len(f):
            hd['error'] = 'body overruns file'
            blocks.append((off, hd, None))
            break
        tail = f[tail_off:tail_off+32]
        th = parse_head(tail)
        body = f[body_off:body_off+blen]
        hd['tail_cks'] = th['cks']
        hd['scrambled'] = hd['flags'] != 0x0000
        dbody = descramble(body) if hd['scrambled'] else body
        # checksum: sum32 over head + unscrambled body + full tail (incl. stored
        # checksum, which is -datasum) must be 0.
        total = (sum32(h) + sum32(dbody) + sum32(tail)) & 0xFFFFFFFF
        hd['cksum_ok'] = (total == 0)
        hd['cksum_tot'] = total
        hd['block_off'] = off
        blocks.append((off, hd, dbody))
        off = tail_off + 32
    return blocks, off

if __name__ == '__main__':
    path = sys.argv[1]
    dump = len(sys.argv) > 2 and sys.argv[2] == '--dump'
    f = open(path, 'rb').read()
    blocks, end = walk(f)
    print(f"file={path} size={len(f)} parsed_to={end:#x} blocks={len(blocks)}")
    for off, hd, dbody in blocks:
        print(f"  @{off:#010x} {hd['typ'].decode(errors='replace'):2s} model={hd['model']} "
              f"load={hd['load']:#010x} len={hd['len']:#x} ver={hd['ver']:#06x} "
              f"flags={hd['flags']:#06x} scram={hd['scrambled']} cksum_ok={hd.get('cksum_ok')}")
        if dump and dbody is not None:
            base = path.rsplit('/',1)[-1]
            out = f"{base}.blk{off:08x}.{hd['typ'].decode(errors='replace')}.{hd['flags']:04x}.bin"
            open(out, 'wb').write(dbody)
            print(f"      -> wrote {out} ({len(dbody)} bytes)")
    if end < len(f):
        tail_pad = f[end:end+16]
        print(f"  trailing @ {end:#x}: {tail_pad.hex()} (remaining {len(f)-end} bytes)")
