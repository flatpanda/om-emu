// dmesg RAMDUMP [ptrOff=0x58a870] [ramBase=0x40040000] [kernelPhys=0x40080000]: print the 4.14 printk ring from a RAM dump
import fs from 'node:fs';
const [f, ptrS = '0x58a870', rbS = '0x40040000', kpS = '0x40080000'] = process.argv.slice(2);
const b = fs.readFileSync(f);
const ptr = b.readBigUInt64LE(Number(ptrS));
const size = b.readUInt32LE(Number(ptrS) - 8);
const start = Number(ptr - 0xffffff8008080000n) + Number(kpS) - Number(rbS);
// records: u64 ts, u16 len, u16 text_len, u16 dict_len, u8 facility, u8 flags|level
const recs = [];
for (let p = start; p < start + size;) {
  const len = b.readUInt16LE(p + 8);
  if (len === 0 || len < 16) { // wrap marker or unused space: resync on next 8-byte boundary that looks like a record
    let q = p + 8, found = -1;
    while (q < start + size - 16) {
      const l = b.readUInt16LE(q + 8), tl = b.readUInt16LE(q + 10);
      if (l >= 16 && l % 8 === 0 && tl > 0 && tl <= l - 16 && b.readBigUInt64LE(q) > 0n) { found = q; break; }
      q += 8;
    }
    if (found < 0) break;
    p = found; continue;
  }
  const tl = b.readUInt16LE(p + 10);
  recs.push([b.readBigUInt64LE(p), b.toString('latin1', p + 16, p + 16 + tl)]);
  p += len;
}
recs.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
for (const [ts, t] of recs) console.log(`[${(Number(ts) / 1e9).toFixed(6)}] ${t}`);
