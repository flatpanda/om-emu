#!/bin/bash
# qrun.sh SECONDS : boot the OM-1 A53 kernel on QEMU virt inside the om-emu VM and
# dump RAM so dmesg.mjs can read the printk ring. Oracle only. Set IMG to the dir
# holding Image / rootfs.sqfs / virt-nep1.dts (see README.md "Extract"). The ISC
# custom windows are NOT backed here, so iscdrv stops at "isc_start failed -6"
# (phase c) -- that stop is the point of this harness; bringing ISC up needs the
# device model in README "Bringing ISC up".
set -e
IMG=${IMG:?set IMG to the extracted-image dir}
OUT=${OUT:-/tmp/a53run}
HERE=$(dirname "$0")
S=/tmp/a53mon.sock
mkdir -p "$OUT"
dtc -q -I dts -O dtb -o "$OUT/virt-nep1.dtb" "$IMG/virt-nep1.dts"
rm -f "$OUT/ram.bin" "$S"
timeout $(( $1 + 30 )) qemu-system-aarch64 \
  -M virt,gic-version=3,virtualization=on,secure=off -cpu cortex-a53 -smp 2 -m 2G \
  -kernel "$IMG/Image" -dtb "$OUT/virt-nep1.dtb" -display none -serial none \
  -monitor unix:$S,server,nowait \
  -device loader,file="$IMG/rootfs.sqfs",addr=0x45140000,force-raw=on \
  -device loader,addr=0x9a50061c,data=0x1,data-len=4 > "$OUT/qemu.out" 2>&1 &
QP=$!
sleep "$1"
python3 -I "$HERE/mon.py" $S "pmemsave 0x40040000 0x5100000 \"$OUT/ram.bin\"" > "$OUT/mon.out" 2>&1 || true
sleep 2
kill $QP 2>/dev/null || true
echo "wrote $OUT/ram.bin; read it with: node $HERE/dmesg.mjs $OUT/ram.bin"
