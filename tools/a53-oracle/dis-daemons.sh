#!/bin/bash
# dis-daemons.sh : disassemble the A53's iscdrv.ko and the ISC daemons from an
# extracted rootfs, then print each port's ISC calls. Oracle only, static read.
# Set ROOT to the extracted squashfs root and OUT to a scratch dir. Run inside
# the om-emu VM (GNU binutils). See README.md.
set -e
ROOT=${ROOT:?set ROOT to the extracted rootfs}
OUT=${OUT:-/tmp/a53dis}
HERE=$(dirname "$0")
mkdir -p "$OUT"
objdump -dr "$ROOT/lib/modules/4.14.222/extra/iscdrv.ko" > "$OUT/iscdrv.dis"
objdump -t "$ROOT/lib/modules/4.14.222/extra/iscdrv.ko" > "$OUT/iscdrv.sym"
for f in usr/bin/sccore usr/bin/hhhr usr/bin/isc_olnet usr/bin/isc_socket \
         usr/bin/wifi_remocon usr/bin/wifi_upnp usr/bin/wifi_mdns usr/bin/blebridge \
         usr/bin/isc_test usr/bin/dbgterm_server \
         var/www/fcgi-bin/isc_cgi var/www/fcgi-bin/isc_file; do
  [ -f "$ROOT/$f" ] && objdump -d --no-show-raw-insn "$ROOT/$f" > "$OUT/$(basename "$f").dis" 2>/dev/null
done
echo "== per-daemon ISC port map =="
node "$HERE/iscports.mjs" "$OUT"/*.dis
