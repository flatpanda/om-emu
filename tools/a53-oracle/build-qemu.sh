#!/bin/bash
# build-qemu.sh : fetch, patch and build a QEMU 11.1.2 aarch64-softmmu with the
# om-isc device, into a prefix under $HOME (never over the system QEMU). Run
# INSIDE the om-emu VM. Oracle only; nothing here ships in emu/.
#
# Packages (Arch Linux ARM): base-devel ninja meson glib2 pixman dtc python
# are needed; the VM already had them. Install any missing with:
#   sudo pacman -S --needed base-devel ninja meson glib2 pixman dtc python
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRC=${SRC:-$HOME/qemu-src}
PREFIX=${PREFIX:-$HOME/qemu-om}
VER=11.1.2
TARBALL=qemu-$VER.tar.xz
# Official release tarball; sha256 verified below (also GPG-signed by the QEMU
# release key CEACC9E15534EBABB82D3FA03353C9CEF108B584).
SHA256=731b5681e4bb18be313231579b8efd0296c5b015fa36dc533874b639ba838016

mkdir -p "$SRC"; cd "$SRC"
[ -f "$TARBALL" ] || curl -fsSLO "https://download.qemu.org/$TARBALL"
echo "$SHA256  $TARBALL" | sha256sum -c -
[ -d "qemu-$VER" ] || tar xf "$TARBALL"
cd "qemu-$VER"
# apply the device + board patch (idempotent-ish: skip if already applied)
if ! grep -q create_om_isc hw/arm/virt.c; then
  patch -p1 < "$HERE/om-isc-qemu.patch"
fi
cp "$HERE/om-isc.c" hw/misc/om-isc.c
mkdir -p build && cd build
[ -f build.ninja ] || ../configure --prefix="$PREFIX" \
  --target-list=aarch64-softmmu --without-default-features \
  --enable-fdt=system --enable-tcg --disable-docs --disable-werror
ninja qemu-system-aarch64
echo "built: $SRC/qemu-$VER/build/qemu-system-aarch64"
