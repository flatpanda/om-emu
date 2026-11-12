#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal squashfs 4.0 reader (LZO-compressed) for the E144 OM-5 rootfs.

Written for this study from the public format definitions:
  * LZO1X decompression follows the algorithm of the Linux kernel's
    lib/lzo/lzo1x_decompress_safe.c (GPL-2.0); reimplemented here in Python.
  * squashfs 4.0 on-disk structures per squashfs-tools 4.x.

The OM-5's rootfs superblock is NONSTANDARD: the directory_table_start field
(offset 0x38) holds -1 and the real tables are located empirically by walking
valid metadata-block chains (locate_tables below).  It validates every block
(exact LZO EOF marker, full input consumption, sane sizes, fragment count,
file sizes) and raises on any mismatch, so its output can back byte claims.
"""

import struct

M2_MAX_OFFSET = 0x800
META_MAX = 8192          # a metadata block holds at most 8192 payload bytes
BLK_UNCOMPRESSED = 0x01000000


class SqError(Exception):
    pass


def lzo1x_decompress(src, expected=None):
    """Decode a raw LZO1X stream (Linux lib/lzo algorithm, Python port).

    expected: exact output length required (None = any); the stream must end
    with the length-3 EOF match and be fully consumed either way.
    """
    ip = 0
    n = len(src)
    out = bytearray()
    if n < 3:
        raise SqError("lzo: input under 3 bytes")

    bitstream_version = False
    if n >= 5 and src[ip] == 17:
        bitstream_version = True   # ip[1] would be the version; zero-runs not expected
        ip += 2

    state = 0

    def need_ip(k):
        if n - ip < k:
            raise SqError("lzo: input overrun")

    # Preamble: a leading byte > 17 emits a literal run first (or, if the
    # length is under 4, just that many literal bytes via match_next).
    if src[ip] > 17:
        t = src[ip] - 17
        ip += 1
        need_ip(t)
        out += src[ip:ip + t]
        ip += t
        state = 0 if t < 4 else 4

    def rd255(t, base):
        nonlocal ip
        last = ip
        while ip < n and src[ip] == 0:
            ip += 1
        offset = ip - last
        if offset > 0xFFFF // 255 - 2:
            raise SqError("lzo: 255-run too long")
        offset = (offset << 8) - offset
        need_ip(1)
        t += offset + base + src[ip]
        ip += 1
        return t

    t = 0
    while True:
        if ip >= n:
            raise SqError("lzo: input overrun (no EOF marker)")
        t = src[ip]
        ip += 1
        if t < 16:
            if state == 0:
                if t == 0:
                    t = rd255(t, 15)
                t += 3
                need_ip(t)
                out += src[ip:ip + t]
                ip += t
                state = 4
                continue
            elif state != 4:
                need_ip(1)
                nxt = t & 3
                mpos = len(out) - 1 - (t >> 2) - (src[ip] << 2)
                ip += 1
                if mpos < 0:
                    raise SqError("lzo: lookbehind overrun")
                # sequential 2-byte copy (C's op[0]=m[0]; op[1]=m[1]; overlap-safe)
                out.append(out[mpos])
                out.append(out[mpos + 1])
                state = nxt
                t = nxt
                need_ip(t)
                out += src[ip:ip + t]
                ip += t
                continue
            else:
                need_ip(1)
                nxt = t & 3
                mpos = len(out) - (1 + M2_MAX_OFFSET) - (t >> 2) - (src[ip] << 2)
                ip += 1
                if mpos < 0:
                    raise SqError("lzo: lookbehind overrun")
                t = 3
        elif t >= 64:
            need_ip(1)
            nxt = t & 3
            mpos = len(out) - 1 - ((t >> 2) & 7) - (src[ip] << 3)
            ip += 1
            if mpos < 0:
                raise SqError("lzo: lookbehind overrun")
            t = (t >> 5) - 1 + 2
        elif t >= 32:
            t = (t & 31) + 2
            if t == 2:
                t = rd255(t, 31)
            if n - ip < 2:
                raise SqError("lzo: input overrun")
            o = struct.unpack_from("<H", src, ip)[0]
            mpos = len(out) - 1 - (o >> 2)
            nxt = o & 3
            ip += 2
            if mpos < 0:
                raise SqError("lzo: lookbehind overrun")
        else:
            if n - ip < 2:
                raise SqError("lzo: input overrun")
            o = struct.unpack_from("<H", src, ip)[0]
            if bitstream_version and (o & 0xFFFC) == 0xFFFC and (t & 0xF8) == 0x18:
                raise SqError("lzo: zero-run bitstream v2 form (not expected here)")
            mpos = len(out) - ((t & 8) << 11)
            t = (t & 7) + 2
            if t == 2:
                t = rd255(t, 7)
                if n - ip < 2:
                    raise SqError("lzo: input overrun")
                o = struct.unpack_from("<H", src, ip)[0]
            ip += 2
            mpos -= o >> 2
            nxt = o & 3
            if mpos == len(out):
                # EOF marker: must be the length-3 match and consume all input
                if t != 3:
                    raise SqError("lzo: EOF match length %d != 3" % t)
                if ip != n:
                    raise SqError("lzo: input not consumed (%d of %d)" % (ip, n))
                if expected is not None and len(out) != expected:
                    raise SqError("lzo: decoded %d bytes, expected %d" % (len(out), expected))
                return bytes(out)
            mpos -= 0x4000
            if mpos < 0:
                raise SqError("lzo: lookbehind overrun (big offset)")
        if expected is not None and len(out) + t > expected:
            raise SqError("lzo: output overrun")
        s = mpos
        for k in range(t):
            out.append(out[s + k])
        state = nxt
        t = nxt
        need_ip(t)
        out += src[ip:ip + t]
        ip += t


# ---- squashfs 4.0 ---------------------------------------------------------

class Sqfs:
    COMP_LZO = 3

    def __init__(self, data, start, inode_table=None, dir_table=None, frag_entries=None):
        self.data = data
        self.fs = start
        sb = data[start:start + 96]
        if sb[0:4] != b"hsqs":
            raise SqError("no squashfs magic at 0x%x" % start)
        (self.inodes, mkfs_time, self.block_size, self.fragments) = struct.unpack_from("<IIII", sb, 4)
        (self.compression, self.block_log, self.flags, self.no_ids, self.major, self.minor) = \
            struct.unpack_from("<HHHHHH", sb, 0x14)
        (self.root_inode, self.bytes_used, self.sb_inode_table, self.sb_dir_table,
         self.sb_frag_table, self.sb_export_table) = struct.unpack_from("<QQQQQQ", sb, 0x20)
        if self.compression != self.COMP_LZO:
            raise SqError("compression id %d, LZO(3) expected" % self.compression)
        self.inode_table = inode_table
        self.dir_table = dir_table
        self.frag_entries = frag_entries
        self._frag_cache = None

    # -- metadata chains ------------------------------------------------------
    def meta_chain(self, base, max_blocks=10000):
        """Walk metadata blocks from fs-relative base; yield (payload, raw_size).

        Blocks are byte-packed (no alignment); the raw step is 2 + stored size.
        Stops cleanly at the first offset that is not a valid block (the next
        table begins there).
        """
        off = base - self.fs
        end = self.bytes_used
        for _ in range(max_blocks):
            if off + 2 > end:
                return
            hdr = struct.unpack_from("<H", self.data, self.fs + off)[0]
            size = hdr & 0x7FFF
            comp = not (hdr & 0x8000)
            if size == 0 or size > META_MAX:
                return
            raw = self.data[self.fs + off + 2:self.fs + off + 2 + size]
            if len(raw) < size:
                return
            if comp:
                try:
                    payload = lzo1x_decompress(raw, None)
                except SqError:
                    return
            else:
                payload = bytes(raw)
            if len(payload) > META_MAX:
                return
            yield payload, size
            off += 2 + size

    # -- inodes ---------------------------------------------------------------
    # On this rootfs an inode reference is (raw_byte_offset << 16) | payload_offset:
    # the high half points at the metadata block's HEADER as a raw byte offset
    # from the table base (E144: the root reference 0x087607d4 = byte 0x876, the
    # exact end of metadata block 0: 2-byte header + 2164-byte payload).
    def read_inode(self, ref):
        # ref = (raw_byte_offset << 16) | payload_offset; the raw offset falls
        # inside a metadata block's stored span [pos, pos+2+size) (E144: the
        # root reference 0x087607d4 names block 1's header position exactly,
        # child entries name positions inside block 0).
        raw_off = (ref >> 16) & 0xFFFFFFFFFFFF
        offset = ref & 0xFFFF
        pos = 0
        for payload, rsize in self.meta_chain(self.inode_table):
            if pos <= raw_off < pos + 2 + rsize:
                if offset >= len(payload):
                    raise SqError("inode offset %d beyond meta block at +%#x (%d B)" %
                                  (offset, raw_off, len(payload)))
                return self.parse_inode(payload, offset)
            pos += 2 + rsize
        raise SqError("inode meta block at raw offset 0x%x not reached" % raw_off)

    def parse_inode(self, buf, off):
        itype, mode, uid, guid, mtime = struct.unpack_from("<HHHHI", buf, off)
        o = off + 16
        ino = {"type": itype, "mode": mode, "uid": uid, "guid": guid, "mtime": mtime}
        if itype == 1:   # basic directory
            start_block, nlink = struct.unpack_from("<II", buf, o)
            file_size, offset_ = struct.unpack_from("<HH", buf, o + 8)
            parent = struct.unpack_from("<I", buf, o + 12)[0]
            ino.update({"start_block": start_block, "nlink": nlink,
                        "file_size": file_size, "offset": offset_, "parent": parent})
        elif itype == 3:  # symlink
            nlink, tsize = struct.unpack_from("<II", buf, o)
            ino.update({"nlink": nlink, "target": bytes(buf[o + 8:o + 8 + tsize])})
        elif itype == 2:  # basic file
            start_block, frag = struct.unpack_from("<II", buf, o)
            offset_, file_size = struct.unpack_from("<II", buf, o + 8)
            nblocks = file_size >> self.block_log
            if frag == 0xFFFFFFFF and (file_size & (self.block_size - 1)):
                nblocks += 1
            block_list = list(struct.unpack_from("<%dI" % nblocks, buf, o + 16))
            ino.update({"start_block": start_block, "frag": frag, "offset": offset_,
                        "file_size": file_size, "block_list": block_list})
        else:
            raise SqError("inode type %d not handled at off %d" % (itype, off))
        return ino

    # -- directories ----------------------------------------------------------
    def list_dir(self, ino):
        """Directory entries of an inode (its data = dir-table bytes).

        E144 layout (validated against the whole tree): the directory's data
        is a sequence of 12-byte segment headers {count u32, start u32,
        inode_number u32} each followed by count+1 entries; an entry is
        {offset u16, x u16, type u16, size u16, name[size+1]} (8 + name
        bytes, no per-entry inode number).  `start` is the raw byte offset
        of the metadata block (inside the inode table) holding the segment's
        inodes; entry `offset` is the byte offset within that block's
        DECOMPRESSED payload.  inode_ref = (start << 16) | offset.
        """
        want = ino["file_size"]
        if not want:
            return []
        chunks = []
        got = 0
        for i, (payload, _rsize) in enumerate(self.meta_chain(self.dir_table)):
            if i < ino["start_block"]:
                continue
            take = payload[ino["offset"]:] if i == ino["start_block"] else payload
            chunks.append(take)
            got += len(take)
            if got >= want:
                break
        if got < want:
            raise SqError("dir data truncated (%d < %d)" % (got, want))
        data = b"".join(chunks)[:want]
        entries = []
        o = 0
        while o < len(data):
            if o + 12 > len(data):
                break
            count, start, _inode_number = struct.unpack_from("<III", data, o)
            o += 12
            for _ in range(count + 1):
                if o + 8 > len(data):
                    raise SqError("dir entry beyond segment data")
                e_off, e_x, etype, nsize = struct.unpack_from("<HHHH", data, o)
                o += 8
                if o + nsize + 1 > len(data):
                    raise SqError("dir name beyond segment data")
                name = data[o:o + nsize + 1].decode("utf-8", "replace")
                o += nsize + 1
                entries.append({"name": name, "type": etype, "x": e_x,
                                "inode_ref": (start << 16) | e_off})
        return entries

    # -- fragments ------------------------------------------------------------
    def fragment(self, index):
        if self._frag_cache is None:
            self._frag_cache = []
            for payload, _rsize in self.meta_chain(self.frag_entries):
                for k in range(0, len(payload) - 15, 16):
                    start, size, _ = struct.unpack_from("<QII", payload, k)
                    self._frag_cache.append({"start": start, "size": size})
            if len(self._frag_cache) != self.fragments:
                raise SqError("fragment entries %d, superblock says %d" %
                              (len(self._frag_cache), self.fragments))
        return self._frag_cache[index]

    # -- file data ------------------------------------------------------------
    def file_bytes(self, ino):
        """Exact file bytes; every block's decompressed length is validated."""
        bs = self.block_size
        out = bytearray()
        base = self.fs + ino["start_block"]
        if ino["frag"] == 0xFFFFFFFF:
            nblocks = len(ino["block_list"])
        else:
            nblocks = ino["file_size"] >> self.block_log
        for k, sz in enumerate(ino["block_list"][:nblocks]):
            clen = sz & 0x00FFFFFF
            uncompressed = bool(sz & BLK_UNCOMPRESSED)
            raw = self.data[base:base + clen]
            if len(raw) < clen:
                raise SqError("file block %d truncated" % k)
            if uncompressed:
                out += raw
            else:
                if ino["frag"] == 0xFFFFFFFF and k == nblocks - 1:
                    expect = ino["file_size"] - (nblocks - 1) * bs
                else:
                    expect = bs
                out += lzo1x_decompress(raw, expect)
            base += clen
        if ino["frag"] != 0xFFFFFFFF:
            frag_size = ino["file_size"] & (bs - 1)
            frag = self.fragment(ino["frag"])
            clen = frag["size"] & 0x00FFFFFF
            raw = self.data[self.fs + frag["start"]:self.fs + frag["start"] + clen]
            if frag["size"] & BLK_UNCOMPRESSED:
                blob = raw
            else:
                blob = lzo1x_decompress(raw, None)
            out += blob[ino["offset"]:ino["offset"] + frag_size]
        if len(out) != ino["file_size"]:
            raise SqError("file assembled %d bytes, inode says %d" % (len(out), ino["file_size"]))
        return bytes(out)

    # -- path lookup ----------------------------------------------------------
    def lookup(self, path):
        parts = [p for p in path.split("/") if p]
        ino = self.read_inode(self.root_inode)
        for part in parts:
            for e in self.list_dir(ino):
                if e["name"] == part:
                    ino = self.read_inode(e["inode_ref"])
                    break
            else:
                raise SqError("path %s: '%s' not found" % (path, part))
        return ino

    def walk(self):
        """Yield (path, entry, inode) for the whole tree, fail-closed."""
        def rec(dir_ino, prefix):
            for e in self.list_dir(dir_ino):
                p = prefix + "/" + e["name"]
                child = self.read_inode(e["inode_ref"])
                yield p, e, child
                if e["type"] == 1 and child["type"] == 1:
                    yield from rec(child, p)
        root = self.read_inode(self.root_inode)
        yield from rec(root, "")


def locate_tables(data, start):
    """Find the table bases of the nonstandard OM-5 superblock from the bytes.

    Returns a dict {inode_table, dir_table, frag_entries} of fs-relative
    bases.  Discovery: walk the metadata chain at each candidate base in the
    tail region; score chains by total payload; classify the best chains by
    content (an inode record parses with type in 1..9; a dir block starts
    with a sane dir header).  Raises SqError when no consistent layout exists.
    """
    sq = Sqfs(data, start)
    end = sq.bytes_used
    chains = []
    for base in range(end - 0x40000, end - 16):
        blocks = []
        off = base
        while off < end - 2:
            hdr = struct.unpack_from("<H", data, start + off)[0]
            size = hdr & 0x7FFF
            comp = not (hdr & 0x8000)
            if size == 0 or size > META_MAX:
                break
            raw = data[start + off + 2:start + off + 2 + size]
            if len(raw) < size:
                break
            if comp:
                try:
                    payload = lzo1x_decompress(raw, None)
                except SqError:
                    break
                if len(payload) > META_MAX:
                    break
            blocks.append((off, size, len(payload) if comp else size))
            off += 2 + size
        if len(blocks) >= 1 and off <= end:
            chains.append((base, blocks))
    # score: chains whose first payload parses as an inode record / dir header
    best = {"inode_table": None, "dir_table": None, "frag_entries": None}
    seen = set()
    # inode table: first payload byte-pair type in 1..9 and mode has 0o1000-ish bits
    for base, blocks in chains:
        if best["inode_table"] is None and blocks:
            off, size, _ = blocks[0]
            raw = data[start + off + 2:start + off + 2 + size]
            try:
                p = lzo1x_decompress(raw, None)
                itype, mode = struct.unpack_from("<HH", p, 0)
                if 1 <= itype <= 9 and mode != 0:
                    best["inode_table"] = base
                    seen.add(base)
            except SqError:
                pass
    # dir table: a later chain whose first payload starts with a dir header
    # (count u32 small, name bytes follow the 12-byte entries header)
    for base, blocks in chains:
        if base in seen or best["dir_table"] is not None:
            continue
        off, size, _ = blocks[0]
        raw = data[start + off + 2:start + off + 2 + size]
        try:
            p = lzo1x_decompress(raw, None)
            count, startb, ino = struct.unpack_from("<III", p, 0)
            if count < 512 and ino <= sq.inodes:
                best["dir_table"] = base
                seen.add(base)
        except SqError:
            continue
    # fragment entries: the block inside/after the dir chain whose decoded
    # payload is exactly 16 * fragments bytes ({u64 start, u32 size, u32 pad} records)
    for base, blocks in chains:
        if base != best["dir_table"]:
            continue
        for (boff, bsize, dlen) in blocks:
            if dlen == 16 * sq.fragments:
                best["frag_entries"] = boff
                break
    if best["frag_entries"] is None:
        # also allow a separate chain with that exact payload
        for base, blocks in chains:
            if base in seen:
                continue
            if sum(b[2] for b in blocks) == 16 * sq.fragments:
                best["frag_entries"] = base
                break
    if not (best["inode_table"] and best["dir_table"] and best["frag_entries"]):
        raise SqError("table discovery incomplete: %r" % best)
    return best
