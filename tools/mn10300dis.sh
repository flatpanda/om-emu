#!/bin/bash
# Disassemble an MN10300/AM33 slice of a flat descrambled OM code block.
# Usage: mn10300dis.sh <file> <start_off_hex> <len_hex> [vma_base_hex=0x50000000]
set -e
F=$1; S=$(( $2 )); L=$(( $3 )); BASE=${4:-0x50000000}
VMA=$(( BASE + S ))
DIR=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
dd if="$F" bs=1 skip=$S count=$L status=none of="$TMP"
"$DIR/mn10300-objdump" -D -b binary -m mn10300 \
  --adjust-vma=$(printf '0x%x' $VMA) "$TMP"
