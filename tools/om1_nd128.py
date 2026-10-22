#!/usr/bin/env python3
"""Build and validate an OFFLINE ND128 research candidate for OM-1 v1.9.

The existing ND64 menu slot supplies step 7 to the exposure adapter. This
is not a seven-item menu port, a flash utility, or evidence of camera success.
Only the exact firmware below is accepted. Source files are never modified.
"""
import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path

from olyfw import descramble, parse_head, scramble, sum32

SOURCE_SHA256 = "342954a48b60bb900614791d6c44d2ba88a67e7a0e03a065069160daa5fbd75a"
MAIN_SHA256 = "7f791611580925f3550d394baa9e8cca4e8f4c38e427ccd498170e8d1feb67e9"
SELECTOR = 0x2D00F1
STORE = 0x2D012B
INVALID = 0x2D0131
PROVIDER = 0x2D165D
ORIGINAL_SELECTOR = bytes.fromhex(
    "a0 01 c8 18 a0 02 c8 17 a0 03 c8 17 a0 04 c8 1a "
    "a0 05 c8 1a a0 06 c8 20 ca 28 12 ca 1f 12 ea ca 1b "
    "12 88 54 f1 08 ca 0a 12 56 ca 10 12 88 54 e8 "
    "5c 58 f0 50 ca 27 12 f9 02 06"
)
ORIGINAL_PROVIDER = bytes.fromhex("f8 53 23 df f0 1c")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_container(path, roundtrip=False):
    """Strict block checks, processing one block at a time to limit memory."""
    blocks = []
    with Path(path).open("rb") as f:
        while (head := f.read(32)):
            off = f.tell() - 32
            require(len(head) == 32 and head[:2] == b"OE", f"Invalid header at {off:#x}")
            hd = parse_head(head)
            require(hd["len"] % 16 == 0, "Unaligned block")
            encoded = f.read(hd["len"])
            tail = f.read(32)
            require(len(encoded) == hd["len"] and len(tail) == 32, "Truncated block")
            require(head[:28] == tail[:28], f"Header/tail mismatch at {off:#x}")
            body = descramble(encoded) if hd["flags"] else encoded
            total = (sum32(head) + sum32(body) + sum32(tail)) & 0xFFFFFFFF
            require(total == 0, f"Bad checksum at {off:#x}: {total:#x}")
            if roundtrip:
                packed = scramble(body) if hd["flags"] else body
                require(packed == encoded, f"No-op repack differs at {off:#x}")
                del packed
            blocks.append({"offset": off, "length": hd["len"],
                           "flags": hd["flags"], "model": hd["model"],
                           "checksum_ok": True, "noop_identical": roundtrip})
            del encoded, body
    require(len(blocks) == 6, "Expected six OM-1 blocks")
    require(all(b["model"] == "1430" for b in blocks), "Not an OM-1 image")
    return blocks


def make_patches(body):
    require(hashlib.sha256(body).hexdigest() == MAIN_SHA256, "Unexpected main code")
    require(body[SELECTOR:STORE] == ORIGINAL_SELECTOR, "Selector preimage mismatch")
    require(body[PROVIDER:PROVIDER + 6] == ORIGINAL_PROVIDER, "Provider preimage mismatch")
    require(body[PROVIDER - 13:PROVIDER] == bytes.fromhex(
        "2c 51 1e 90 00 04 dd 84 01 d7 ff c0 0c"), "Wrong parameter getter")

    # Replace the six-case multiplier with bounded repeated addition. Use only
    # ordinary MN10300 instructions; no assumptions about custom UDF opcodes.
    # D0, D1 are scratch registers; callers consume the output byte in memory.
    code = bytearray()

    def emit(data):
        code.extend(bytes.fromhex(data))

    def branch(op, target):
        pc = SELECTOR + len(code)
        code.extend(bytes([op]) + struct.pack("b", target - pc))

    emit("a0 01")                 # cmp 1,d0
    branch(0xC0, INVALID)          # blt original error path
    emit("a0 07")                 # cmp 7,d0
    branch(0xC1, INVALID)          # bgt original error path
    emit("12 81 00")              # extb d2; mov d0,d1; clr d0
    loop = SELECTOR + len(code)
    emit("e8 29 ff")              # add d2,d0; add -1,d1
    branch(0xC9, loop)             # bne loop
    emit("82")                    # mov d0,d2
    branch(0xCA, STORE)            # original store/epilogue

    # Occupy space released INSIDE the original switch, not erased flash.
    trampoline = SELECTOR + len(code)
    emit("a0 06 c9 03 40")         # if returned parameter is 6, increment to 7
    emit(ORIGINAL_PROVIDER.hex())  # original store and provider's own stack return
    require(len(code) <= len(ORIGINAL_SELECTOR), "Patch exceeds original switch")
    code.extend(b"\xcb" * (len(ORIGINAL_SELECTOR) - len(code)))  # nop padding
    jump = b"\xcc" + struct.pack("<h", trampoline - PROVIDER)
    patches = [(SELECTOR, ORIGINAL_SELECTOR, bytes(code)),
               (PROVIDER, ORIGINAL_PROVIDER[:3], jump)]
    result = bytearray(body)
    for off, before, after in patches:
        require(len(before) == len(after), "Patch changes image length")
        require(result[off:off + len(before)] == before, "Preimage mismatch")
        result[off:off + len(after)] = after
    return bytes(result), patches, trampoline


def execute_patch(code, start, d0, d2=0, limit=200):
    """Interpret emitted instructions, including relative jumps and byte stores.

    Deliberately narrow: this checks the actual generated instruction bytes and
    branch displacements. It does not emulate the RTOS, custom UDF instructions,
    image engine, memory allocation, or camera hardware.
    """
    regs = [d0, 0xDEADBEEF, d2, 0]
    pc, zero, comparison = start, False, 0
    for _ in range(limit):
        if pc == INVALID:
            return {"kind": "invalid", "step": regs[0]}
        if pc == STORE:
            return {"kind": "offset", "value": regs[2] & 255}
        op = code[pc]
        if op == 0xA0:
            immediate = struct.unpack("b", code[pc + 1:pc + 2])[0]
            value = regs[0] if regs[0] < 0x80000000 else regs[0] - 0x100000000
            comparison = value - immediate
            zero = comparison == 0
            pc += 2
        elif op in (0xC0, 0xC1, 0xC9, 0xCA):
            take = {0xC0: comparison < 0, 0xC1: comparison > 0,
                    0xC9: not zero, 0xCA: True}[op]
            displacement = struct.unpack("b", code[pc + 1:pc + 2])[0]
            pc += displacement if take else 2
        elif op == 0xCC:
            pc += struct.unpack_from("<h", code, pc + 1)[0]
        elif op == 0x12:
            regs[2] = struct.unpack("b", bytes([regs[2] & 255]))[0] & 0xFFFFFFFF
            pc += 1
        elif op == 0x81:
            regs[1] = regs[0]
            pc += 1
        elif op == 0x00:
            regs[0] = 0
            zero = True
            pc += 1
        elif op == 0xE8:
            regs[0] = (regs[0] + regs[2]) & 0xFFFFFFFF
            zero = regs[0] == 0
            pc += 1
        elif op == 0x29:
            immediate = struct.unpack("b", code[pc + 1:pc + 2])[0]
            regs[1] = (regs[1] + immediate) & 0xFFFFFFFF
            zero = regs[1] == 0
            pc += 2
        elif op == 0x82:
            regs[2] = regs[0]
            pc += 1
        elif op == 0x40:
            regs[0] = (regs[0] + 1) & 0xFFFFFFFF
            pc += 1
        elif code[pc:pc + 6] == ORIGINAL_PROVIDER:
            return {"kind": "provider", "value": regs[0] & 255, "stack_return": 28}
        else:
            raise ValueError(f"Unexpected instruction at {pc:#x}: {op:#x}")
    raise ValueError("Instruction limit exceeded (loop or bad branch)")


def verify_patch(body):
    cases = 0
    for step in range(256):
        result = execute_patch(body, PROVIDER, step)
        expected = 7 if step == 6 else step
        require(result == {"kind": "provider", "value": expected, "stack_return": 28},
                f"Provider mismatch for {step}")
        cases += 1
        for unit in (1, 2, 3):
            # Nonzero upper register bits verify that EXTB is actually executed.
            result = execute_patch(body, SELECTOR, step, 0xAABBCC00 | unit)
            expected_result = ({"kind": "offset", "value": step * unit}
                               if 1 <= step <= 7 else {"kind": "invalid", "step": step})
            require(result == expected_result, f"Selector mismatch for {step}/{unit}")
            cases += 1
    return {"machine_code_cases": cases, "provider_6_to_7": True,
            "selector_valid_steps": [1, 2, 3, 4, 5, 6, 7],
            "table_index_offsets_for_step7": [7, 14, 21],
            "requested_frame_count": 128, "camera_tested": False}


def compare_tables(original, donor):
    """Compare the tables actually selected by the two disassembled helpers."""
    pairs = [(0x6CBBF0, 0x6B0DA4, 67), (0x6CBC76, 0x6B0E2A, 46),
             (0x6CBCD2, 0x6B0E86, 25), (0x6CBD04, 0x6B0EB8, 69),
             (0x6CBD8E, 0x6B0F42, 48), (0x6CBDEE, 0x6B0FA2, 27),
             (0x6CBE24, 0x6B0FD8, 48), (0x6CBE84, 0x6B1038, 27),
             (0x6CC078, 0x6B122C, 150)]
    tables = []
    for off, donor_off, entries in pairs:
        left = original[off:off + 2 * entries]
        right = donor[donor_off:donor_off + 2 * entries]
        require(left == right, f"Donor table differs at {off:#x}")
        tables.append({"om1_offset": hex(off), "om1ii_offset": hex(donor_off),
                       "bytes": len(left), "identical": True})
    return tables


def build(source, donor_path, out_dir):
    source, out_dir = Path(source).resolve(), Path(out_dir).resolve()
    require(sha256(source) == SOURCE_SHA256, "Unsupported source firmware SHA-256")
    before_blocks = validate_container(source, roundtrip=True)
    with source.open("rb") as f:
        head = f.read(32)
        hd = parse_head(head)
        encoded = f.read(hd["len"])
        tail = bytearray(f.read(32))
    original = descramble(encoded)
    patched, patches, trampoline = make_patches(original)
    validation = verify_patch(patched)
    donor = Path(donor_path).read_bytes()
    require(hashlib.sha256(donor).hexdigest() ==
            "125c9ff8f43396f48f55b9b3a62279a9fea29623038e02cb4b397f6a76c7c95c",
            "Unexpected OM-1 II donor block")
    tables = compare_tables(original, donor)
    packed = scramble(patched)
    # Preserve the entire header/tail, replacing only the tail checksum DWORD.
    old_checksum = struct.unpack_from("<I", tail, 28)[0]
    new_checksum = (old_checksum + sum32(original) - sum32(patched)) & 0xFFFFFFFF
    struct.pack_into("<I", tail, 28, new_checksum)
    require((sum32(head) + sum32(patched) + sum32(tail)) & 0xFFFFFFFF == 0,
            "Patched first-block checksum fails")
    out_dir.mkdir(parents=True, exist_ok=True)
    output = out_dir / "OM1_v1.9_ND128_ND64-slot_EXPERIMENTAL.BIN"
    require(output != source, "Refusing to overwrite source")
    require(not output.exists(), f"Output already exists: {output}")
    shutil.copyfile(source, output)
    with output.open("r+b") as f:
        f.seek(32)
        f.write(packed)
        f.write(tail)
    output_blocks = validate_container(output)
    # Verify every packed changed byte belongs to a patched 16-byte group or
    # the checksum. Everything after block 0 was copied and must stay identical.
    allowed_groups = set()
    for off, before, after in patches:
        allowed_groups.update(range(off // 16, (off + len(after) - 1) // 16 + 1))
    changed = [i for i, (a, b) in enumerate(zip(encoded, packed)) if a != b]
    require(all(i // 16 in allowed_groups for i in changed), "Unexpected packed edit")
    with source.open("rb") as a, output.open("rb") as b:
        start = 32 + hd["len"] + 32
        a.seek(start)
        b.seek(start)
        while (chunk := a.read(1024 * 1024)):
            require(chunk == b.read(len(chunk)), "Untargeted block changed")
        require(b.read(1) == b"", "Output grew")
    code_path = out_dir / "OM1_v1.9_ND128.main-code.bin"
    code_path.write_bytes(patched)
    report = {
        "status": "offline_research_candidate_NOT_camera_verified",
        "source": str(source), "source_sha256": SOURCE_SHA256,
        "output": str(output), "output_sha256": sha256(output),
        "output_size": output.stat().st_size,
        "main_code": str(code_path), "main_code_sha256": hashlib.sha256(patched).hexdigest(),
        "original_main_code_sha256": MAIN_SHA256,
        "menu_behavior": "ND64 label retained; its exposure-adapter step is remapped 6 -> 7",
        "patches": [{"decoded_body_offset": hex(o), "before": a.hex(), "after": b.hex()}
                    for o, a, b in patches],
        "trampoline_body_offset": hex(trampoline),
        "first_block_tail_checksum_before": hex(old_checksum),
        "first_block_tail_checksum_after": hex(new_checksum),
        "packed_body_changed_bytes": len(changed),
        "source_blocks": before_blocks, "output_blocks": output_blocks,
        "donor_tables": tables, "validation": validation,
        "limitations": ["UI and other direct parameter readers still see step 6",
                        "Remaining image-pipeline limits and EXIF behavior are unverified",
                        "Camera update acceptance and on-device behavior are untested",
                        "Six named Bayer buffers do not prove ND128 memory safety"],
    }
    (out_dir / "manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output), "sha256": report["output_sha256"],
                      "checksums_passed": len(output_blocks), **validation}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--donor", type=Path, default=Path(
        "unpacked/E146/OLY_E_146_1300_0000_0000.BIN.blk00000000.OE.0100.bin"))
    parser.add_argument("--out-dir", type=Path, default=Path("artifacts/nd128"))
    args = parser.parse_args()
    build(args.source, args.donor, args.out_dir)
