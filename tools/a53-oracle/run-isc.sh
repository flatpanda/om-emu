#!/bin/bash
# run-isc.sh SECONDS [afterMs:node:port:hex ...] : bring the A53's ISC up live.
# Boots the real A53 kernel on the patched QEMU with the om-isc device, runs
# iscpeer.mjs as the MN peer (nodes 0..3), and prints the live ISC traffic. Run
# INSIDE the om-emu VM. Set IMG to the extracted-image dir (Image, rootfs.sqfs,
# nep1.dts). Oracle only. See README.md. With SHCMDS=<file> ("afterMs command"
# lines) the commands are typed into the A53's console shell (uartsh.mjs).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
QEMU=${QEMU:-$HOME/qemu-om-build}       # or $HOME/qemu-src/qemu-11.1.2/build/qemu-system-aarch64
[ -x "$QEMU" ] || QEMU=$HOME/qemu-src/qemu-11.1.2/build/qemu-system-aarch64
IMG=${IMG:?set IMG to the extracted-image dir}
OUT=${OUT:-/tmp/a53isc}
SECS=${1:-45}; shift || true
MEM=$OUT/iscmem.bin SOCK=/tmp/a53isc.sock MON=/tmp/a53iscmon.sock UART=/tmp/a53uart.sock
mkdir -p "$OUT"
node "$HERE/qdts.mjs" "$IMG/nep1.dts" "$OUT/virt-nep1.dts"
dtc -q -I dts -O dtb -o "$OUT/virt-nep1.dtb" "$OUT/virt-nep1.dts"
rm -f "$MEM" "$SOCK" "$MON" "$UART" "$OUT/ram.bin"
dd if=/dev/zero of="$MEM" bs=1 count=0 seek=$((0x80000)) 2>/dev/null

export OM_ISC_MEMDEV=iscmem OM_ISC_CHARDEV=isc0 OM_ISC_UARTDEV=uart0
"$QEMU" -M virt,gic-version=3,virtualization=on,secure=off -cpu cortex-a53 -smp 2 -m 2G \
  -object memory-backend-file,id=iscmem,size=0x80000,mem-path="$MEM",share=on \
  -chardev socket,id=isc0,path="$SOCK",server=on,wait=off \
  -chardev socket,id=uart0,path="$UART",server=on,wait=off \
  -kernel "$IMG/Image" -dtb "$OUT/virt-nep1.dtb" -display none -serial none \
  -monitor unix:"$MON",server,nowait -S \
  -device loader,file="$IMG/rootfs.sqfs",addr=0x45140000,force-raw=on \
  -device loader,addr=0x9a50061c,data=0x1,data-len=4 > "$OUT/qemu.out" 2>&1 &
QP=$!
sleep 1.5
node "$HERE/iscpeer.mjs" live "$MEM" "$SOCK" $((SECS*1000)) "$@" &
PEERP=$!
[ -n "$SHCMDS" ] && node "$HERE/uartsh.mjs" "$UART" "$SHCMDS" &
sleep 0.8
python3 -c "import socket,time;s=socket.socket(socket.AF_UNIX);s.connect('$MON');time.sleep(.3);s.recv(65536);s.sendall(b'cont\n');time.sleep(.3)"
wait $PEERP || true
# leave the vCPUs' registers for a post-mortem (a stall shows where each CPU is)
python3 -I "$HERE/mon.py" "$MON" "info registers -a" > "$OUT/regs.txt" 2>&1 || true
[ -n "$RAMDUMP" ] && python3 -I "$HERE/mon.py" "$MON" "pmemsave 0x40000000 0x80000000 \"$OUT/ram.bin\"" > /dev/null 2>&1
kill $QP 2>/dev/null || true
