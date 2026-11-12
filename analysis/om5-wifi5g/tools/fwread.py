#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Firmware read helpers for the OM-5 (E144) wifi-5ghz study.

Implements, from scratch, the container primitives documented in
docs/firmware-container.md (this repository) so that reproduce.py is
self-contained and deterministic:

  * .BIN block walk + Olympus descramble (flags != 0 blocks)
  * LZ4 raw block decode (the 'olycompress' containers of the main block)
  * in-place expansion of the main code block into its run-time image
    (offsets unchanged; see emu/src/fw/expand.mjs)

No third-party modules. Static reads only.
"""

import hashlib
import struct

PERM = [1, 3, 0, 2, 6, 4, 7, 5, 11, 10, 9, 8, 13, 14, 12, 15]
OLYCOMPRESS = b"olycompress"

# E144 v1.2 (OM-5) image constants, docs/model-survey.md + docs/README.md "Addresses":
CODE_BASE = 0x50000000   # code window:  body offset + 0x50000000 = disassembly VMA
DATA_BASE = 0x60021020   # data window:  body offset + 0x60021020 = run-time data address


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def descramble(body):
    """Per aligned 16 bytes: decoded[k] = encoded[PERM[k]] ^ 0xFF; tail kept."""
    out = bytearray(len(body))
    n16 = len(body) // 16
    for i in range(n16):
        base = i * 16
        enc = body[base:base + 16]
        for k in range(16):
            out[base + k] = enc[PERM[k]] ^ 0xFF
    tail = len(body) % 16
    if tail:
        out[n16 * 16:] = body[n16 * 16:]
    return bytes(out)


def u32le(b, o):
    return struct.unpack_from("<I", b, o)[0]


def u16le(b, o):
    return struct.unpack_from("<H", b, o)[0]


def unpack_bin(path):
    """Walk the .BIN container; return a list of block dicts.

    Layout per docs/firmware-container.md: <head:32><body:len><tail:32>, head
    fields little-endian: 0x00 u16 type ('OE'), 0x02 u16 model (BE nibble pair),
    0x08 u32 load address, 0x0C u32 body length, 0x10 u16 version (BCD),
    0x14 u16 flags, 0x1C u32 checksum (0 in the head, minus the sum in the tail).
    Checksum: sum of the u32 words over head + descrambled body + tail == 0.
    """
    with open(path, "rb") as f:
        data = f.read()
    pos = 0
    blocks = []
    while pos < len(data):
        head = data[pos:pos + 32]
        if len(head) < 32:
            break
        tag = head[0:2]
        body_len = u32le(head, 0x0C)
        body = data[pos + 32:pos + 32 + body_len]
        tail = data[pos + 32 + body_len:pos + 32 + body_len + 32]
        if len(body) < body_len or len(tail) < 32:
            raise ValueError("truncated block at 0x%x" % pos)
        flags = u16le(head, 0x14)
        dec = descramble(body) if flags else body
        s = sum(struct.unpack_from("<%dI" % (len(head) // 4), head, 0))
        s += sum(struct.unpack_from("<%dI" % (len(dec) // 4), dec, 0))
        rest = len(dec) % 4
        if rest:
            s += int.from_bytes(dec[len(dec) - rest:], "little")
        s += sum(struct.unpack_from("<8I", tail, 0))
        s &= 0xFFFFFFFF
        blocks.append({
            "file_off": pos,
            "tag": tag.decode("ascii", "replace"),
            "model": u16le(head, 0x02),
            "load": u32le(head, 0x08),
            "body_len": body_len,
            "version": u16le(head, 0x10),
            "flags": flags,
            "checksum_ok": (s == 0),
            "tail_checksum": u32le(tail, 0x1C),
            "descrambled": dec,
        })
        pos += 32 + body_len + 32
    return blocks


def lz4_block(src, size):
    """Decode a raw LZ4 block (sequences of literals + matches), at most size bytes."""
    out = bytearray(size)
    o = 0
    i = 0
    n = len(src)
    while i < n:
        token = src[i]
        i += 1
        length = token >> 4
        if length == 15:
            while True:
                b = src[i]
                i += 1
                length += b
                if b != 255:
                    break
        if o + length > size or i + length > n:
            raise ValueError("lz4: literal overrun (o=%d lit=%d size=%d)" % (o, length, size))
        out[o:o + length] = src[i:i + length]
        o += length
        i += length
        if i >= n or o >= size:
            break
        offset = src[i] | (src[i + 1] << 8)
        i += 2
        match = token & 15
        if match == 15:
            while True:
                b = src[i]
                i += 1
                match += b
                if b != 255:
                    break
        match += 4
        if not (0 < offset <= o):
            raise ValueError("lz4: bad offset %d at input %d" % (offset, i))
        if o + match > size:
            raise ValueError("lz4: match overrun")
        s = o - offset
        if offset >= match:
            out[o:o + match] = out[s:s + match]
            o += match
        else:
            for k in range(match):
                out[o + k] = out[s + k]
            o += match
    if o != size:
        raise ValueError("lz4: decoded %d bytes, expected %d" % (o, size))
    return bytes(out)


def find_containers(img):
    """All 'olycompress' containers: [(offset, packed, raw)]."""
    hits = []
    start = 0
    while True:
        p = img.find(OLYCOMPRESS, start)
        if p < 0:
            break
        packed = u32le(img, p + 16)
        raw = u32le(img, p + 20)
        hits.append((p, packed, raw))
        start = p + 1
    return hits


def expand_main(block_bytes):
    """Decode every olycompress container in place (offsets unchanged).

    Returns (image, containers) where image is the run-time image the code
    sees: body offset + 0x50000000 = code VMA, body offset + 0x60021020 =
    run-time data address (emu/src/fw/expand.mjs).
    """
    img = bytearray(block_bytes)
    containers = find_containers(block_bytes)
    for (p, packed, raw) in containers:
        if p + 32 + packed > len(img) or p + raw > len(img):
            raise ValueError("container at 0x%x overruns the block" % p)
        data = lz4_block(img[p + 32:p + 32 + packed], raw)
        img[p:p + raw] = data
    return bytes(img), containers


def find_bcs(img):
    """Locate the 'BCS\\0' boot section table; return (offset, 64 raw bytes)."""
    p = img.find(b"BCS\x00")
    if p < 0:
        return None, b""
    return p, img[p:p + 64]


def ascii_strings(img, min_len=6):
    """Yield (offset, string) for every run of printable ASCII + NUL."""
    runs = []
    start = None
    run = bytearray()
    for i, b in enumerate(img):
        if 32 <= b < 127:
            if start is None:
                start = i
            run.append(b)
        else:
            if start is not None:
                if len(run) >= min_len:
                    runs.append((start, run.decode("ascii")))
                start = None
                run = bytearray()
    return runs
