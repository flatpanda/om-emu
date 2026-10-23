// qdts.mjs IN OUT [ramBase]: turn the camera's A53 device tree (nep1.dts) into a
// QEMU virt variant: GICv3 at virt's addresses, RAM rebased, the two out-of-range
// SPIs renumbered into virt's 256-SPI range. Oracle-only; the emulator never uses
// this. See README.md. (These edits match what reached phases a/b on virt.)
import fs from 'node:fs';
const [inp, out, baseS = '0x40000000'] = process.argv.slice(2);
const base = Number(baseS), h = (v) => '0x' + v.toString(16);
let t = fs.readFileSync(inp, 'utf8');
t = t.replace('reg = <0x00 0xa0080000 0x00 0x10000 0x00 0xa00c0000 0x00 0x40000>;',
              'reg = <0x00 0x8000000 0x00 0x10000 0x00 0x80a0000 0x00 0xf60000>;');
t = t.replace('slram=mtd0,0x05140000,', `slram=mtd0,${h(base + 0x05140000)},`);
t = t.replace(/memory@0x00040000 \{([\s\S]*?)reg = <0x00 0x40000 0x00 0x5100000>;/,
              (m, mid) => `memory@0x00040000 {${mid}reg = <0x00 ${h(base + 0x40000)} 0x00 0x5100000>;`);
t = t.replace('interrupts = <0x00 0x1c0 0x04 0x00 0x1c2 0x04 0x00 0x1c4 0x04 0x00 0x1c6 0x04>;',
              'interrupts = <0x00 0x60 0x04 0x00 0x62 0x04 0x00 0x64 0x04 0x00 0x66 0x04>;');
t = t.replace('interrupts = <0x00 0x15e 0x04 0x00 0x15d 0x04>;',
              'interrupts = <0x00 0x50 0x04 0x00 0x51 0x04>;');
if (process.env.EXTRA_ARGS) t = t.replace('init=/temproot debug', 'init=/temproot debug ' + process.env.EXTRA_ARGS);
fs.writeFileSync(out, t);
console.log('ok', out);
