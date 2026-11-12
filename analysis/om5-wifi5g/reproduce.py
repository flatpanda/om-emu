#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reproduce every artifact of the om5-wifi5g package from the pinned vendor image.

Usage (from anywhere):  python <path-to>/reproduce.py

Steps:
  1. verify the vendor .BIN sha256 (pinned in tools/make_evidence.py);
  2. unpack + descramble the 5 blocks, verify each against BLOBS.sha256 pins;
  3. expand the main code block in place (LZ4 'olycompress' containers);
  4. re-derive every evidence/ file deterministically (fail-closed);
  5. re-extract /bin/isc_olnet (LZO squashfs reader, cross-checked against
     python-lzo-pinned reference hashes);
  6. write output_manifest.csv and the detached seal.sha256.

Static analysis only: reads bytes, writes evidence files, executes nothing
from the firmware.  Pure standard library; no network; deterministic.
"""

import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "tools"))

import make_evidence  # noqa: E402


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    make_evidence.main()

    # verify the output manifest against the files on disk
    man_path = os.path.join(HERE, "output_manifest.csv")
    with open(man_path, "r", newline="\n") as f:
        rows = [l.strip() for l in f if l.strip() and not l.startswith("path,")]
    for row in rows:
        rel, want, size = row.rsplit(",", 2)[0], row.split(",")[1], int(row.rsplit(",", 1)[1])
        p = os.path.join(HERE, rel)
        got = sha256_file(p)
        if got != want or os.path.getsize(p) != size:
            raise SystemExit("output mismatch: %s (%s != %s)" % (rel, got, want))

    # detached seal: sha256 of every committed package file (excluding the seal)
    seal_lines = []
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in ("tmp", "__pycache__")]
        for f in sorted(files):
            if f in ("seal.sha256",) or f.endswith(".bin"):
                continue
            p = os.path.join(root, f)
            rel = os.path.relpath(p, HERE).replace("\\", "/")
            seal_lines.append("%s  %s" % (sha256_file(p), rel))
    seal_lines.sort()
    with open(os.path.join(HERE, "seal.sha256"), "w", newline="\n") as f:
        f.write("\n".join(seal_lines) + "\n")
    print("reproduce: outputs verified, seal.sha256 written (%d entries)" % len(seal_lines))


if __name__ == "__main__":
    main()
