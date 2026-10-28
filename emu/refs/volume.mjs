// The file system on a card, whichever kind it is: the volume an MBR's first partition holds (or the card's own sector
// 0 when that is a boot sector), read by refs/exfat.mjs when its boot sector is exFAT's and by refs/fat.mjs otherwise.
// Both readers give the same surface (type, label, spc, clusters, list, find, data, chain, freeClusters, fsInfo), so a
// caller that checks what the firmware wrote reads an SDHC card's FAT32 and an SDXC card's exFAT the same way. It
// imports only refs/ (test_pure.mjs) and reads through read(lba, count) -> bytes (512-byte sectors).
import { FatVolume, mbrPartition } from './fat.mjs';
import { ExfatVolume, isExfatBoot } from './exfat.mjs';

// the volume on a card: an ExfatVolume or a FatVolume (start: the partition's first sector, or 0)
export function openVolume(read) {
  const s0 = read(0, 1);
  // an exFAT boot sector at 0 also ends in 0x55aa, and its boot code where an MBR's table would be
  if (isExfatBoot(s0)) return new ExfatVolume(read, 0);
  const start = mbrPartition(s0)?.start ?? 0;
  return isExfatBoot(read(start, 1)) ? new ExfatVolume(read, start) : new FatVolume(read, start);
}
