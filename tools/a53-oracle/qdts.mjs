// qdts.mjs IN OUT [ramBase]: turn the camera's A53 device tree (nep1.dts) into a
// QEMU virt variant: GICv3 at virt's addresses and RAM rebased. The camera's own
// SPI numbers are kept as-is (irqcon's driver hardcodes irq-0x1c0 <= 7), which
// needs the widened GIC in the om-isc QEMU patch (NUM_IRQS 512). Oracle-only; the
// emulator never uses this. See README.md.
import fs from 'node:fs';
const [inp, out, baseS = '0x40000000'] = process.argv.slice(2);
const base = Number(baseS), h = (v) => '0x' + v.toString(16);
let t = fs.readFileSync(inp, 'utf8');
t = t.replace('reg = <0x00 0xa0080000 0x00 0x10000 0x00 0xa00c0000 0x00 0x40000>;',
              'reg = <0x00 0x8000000 0x00 0x10000 0x00 0x80a0000 0x00 0xf60000>;');
t = t.replace('slram=mtd0,0x05140000,', `slram=mtd0,${h(base + 0x05140000)},`);
t = t.replace(/memory@0x00040000 \{([\s\S]*?)reg = <0x00 0x40000 0x00 0x5100000>;/,
              (m, mid) => `memory@0x00040000 {${mid}reg = <0x00 ${h(base + 0x40000)} 0x00 0x5100000>;`);
// cap kernel RAM to the A53's real 81 MiB so the ISC windows (0x97xxxxxx,
// 0x99xxxxxx) are not RAM -- arm64 __ioremap refuses to map RAM, which is what
// isc_lock_init / irqcon / isc_start do.
const extra = 'mem=0x5140000' + (process.env.EXTRA_ARGS ? ' ' + process.env.EXTRA_ARGS : '');
t = t.replace('init=/temproot debug', 'init=/temproot debug ' + extra);
fs.writeFileSync(out, t);
console.log('ok', out);
