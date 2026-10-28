// S-SDCARD's card: an SDHC or SDXC memory card at the SD command level, with its data in a sparse sector store. Pure
// JS (node and the browser player's Worker); src/lab/storage.mjs puts it behind the firmware's SD command layer.
//
// What the card answers is the SD Physical Layer Simplified Specification's (version 3.01 and later): the
// registers (OCR, CID, CSD version 2.0, SCR, the SD Status and CMD6's switch status) and the commands' responses and
// state changes. The values the card reports are the lab's choice (a card of `sectors` 512-byte blocks, default 8
// GiB, class 10, 3.3 V only, no UHS), not a captured card's. The capacity alone makes the card SDHC (above 2 GiB, at
// most 32 GiB) or SDXC (above 32 GiB, at most C_SIZE 0x3FFEFF, just under 2 TiB): both are high-capacity cards with
// the same OCR (CCS set) and CSD version 2.0, whose 22-bit C_SIZE counts 512 KiB units; an SDXC card differs in the
// SCR's SD_SECURITY (4, version 3.xx, where SDHC reports 3) and in the larger AU its SD Status may report (the lab's
// choice: 4 MiB on SDHC, 16 MiB on SDXC up to 128 GiB and 32 MiB above, the SD File System Specification's boundary
// units for those capacities as far as recalled, I). The store keeps only the sectors written with something other
// than zeros, so a 128 GiB card costs nothing until it is written. A command the card does not take (UHS-II's,
// one the specification has but this card does not implement) gets no response, which is what a card does with a
// command it does not know. A card out of the slot (present false) answers nothing at all, as an empty slot does; its
// sectors stay as they were, so the same card goes back in with its files.
//
// Commands reach exec() as the firmware's SD command layer builds them (src/lab/storage.mjs has the evidence): the
// index in bits 0..5, bit 6 for an application command (the CMD55 before it is the host's), the response type in
// bits 8..10 (3 none, 4 R1 / R3 / R6 / R7, 5 R1b, 6 R2, 7 R3), bit 30 for a UHS-II command. An R2 comes back as the
// SD host gives it: bits 127..8 of the register (CRC dropped) in four words, bits 39..8 in the first.

export const SECTOR = 512;
export const NO_RESPONSE = 0x1405;        // the firmware's status for a command that got no response (CMD8's test, D)
const R1_APP_CMD = 0x20, R1_READY = 0x100, R1_OUT_OF_RANGE = 1 << 31, UHS2 = 1 << 30;
const OCR_DONE = 1 << 31, OCR_CCS = 1 << 30, OCR_VDD = 0xff8000;
const STATES = { idle: 0, ready: 1, ident: 2, stby: 3, tran: 4, data: 5, rcv: 6, prg: 7 };
const ADDRESSED = new Set(['stby', 'tran', 'data', 'rcv', 'prg']);    // the states with a published RCA (data transfer mode)
const GIB = 2097152;                      // sectors in a GiB
const SDHC_MIN = 2 * GIB, SDHC_MAX = 32 * GIB, SDXC_MAX = (0x3ffeff + 1) * 1024;   // capacity limits in sectors
const AU_4M = 9, AU_16M = 0xc, AU_32M = 0xe;                          // the SD Status's AU_SIZE codes

// A card's capacity in sectors from its size in GiB (a number, or text such as '64', '64G' or '64GiB': a host's
// card-size option); the card itself checks that it is an SDHC or SDXC capacity
export function cardSectors(size) {
  const m = /^\s*(\d+)\s*(?:G|GiB)?\s*$/i.exec(String(size));
  if (!m) throw new RangeError(`cardSectors: '${size}' is not a size in GiB (such as 8, 64G or 128GiB)`);
  return Number(m[1]) * GIB;
}

// CRC7 (x^7 + x^3 + 1) over bytes, as the CID and CSD carry it in their last byte (<< 1 | 1)
export function crc7(bytes) {
  let crc = 0;
  for (const b of bytes) for (let i = 7; i >= 0; i--) {
    const bit = ((b >> i) & 1) ^ (crc >> 6);
    crc = ((crc << 1) & 0x7f) ^ (bit ? 0x09 : 0);
  }
  return crc;
}
const withCrc = (b) => { b[15] = (crc7(b.subarray(0, 15)) << 1) | 1; return b; };

// The register's 128 bits (16 bytes, bit 127 first) as the host's four response words: bits 39..8, 71..40, 103..72,
// 127..104
export function r2Words(reg) {
  const w = [0, 0, 0, 0];
  for (let i = 8; i < 128; i++) {
    const bit = (reg[15 - (i >> 3)] >> (i & 7)) & 1, k = i - 8;
    w[k >> 5] |= bit << (k & 31);
  }
  return w.map((x) => x >>> 0);
}

export class SdCard {
  // sectors: the capacity in 512-byte blocks, a multiple of 1024 above 2 GiB (CSD version 2.0: C_SIZE counts 512 KiB
  // units): SDHC up to 32 GiB, SDXC above; data: an optional Map sector -> Uint8Array(512) to start from (a saved card)
  constructor({ sectors = 8 * GIB, data = null } = {}) {
    if (!Number.isInteger(sectors) || sectors % 1024 || sectors <= SDHC_MIN || sectors > SDXC_MAX) {
      throw new RangeError(`SdCard: ${sectors} sectors is not an SDHC or SDXC capacity (a multiple of 1024 above 2 GiB, at most ${SDXC_MAX} sectors)`);
    }
    this.sectors = sectors;
    this.kind = sectors > SDHC_MAX ? 'SDXC' : 'SDHC';
    this.data = data ?? new Map();
    this.rca = 0x1234;
    this.state = 'idle';
    this.bus4 = false;
    this.selected = false;
    this.writes = 0; this.reads = 0;       // sectors written and read since the card was made
    this.dirty = false;                    // written since the last take_dirty()
    this.log = [];                         // [index, acmd, arg, status] of every command, the last 200
    this.erase = [0, 0];
    this.present = true;                   // in the slot (src/lab/storage.mjs takes it out and puts it back)
  }
  // Out of the slot: power is lost, so the card comes back in its idle state
  remove() { this.present = false; this.state = 'idle'; this.selected = false; this.bus4 = false; }
  insert() { this.present = true; }
  // ---- the registers
  ocr() { return (OCR_DONE | OCR_CCS | OCR_VDD) >>> 0; }   // power-up done, CCS (SDHC or SDXC), 2.7-3.6 V; S18A clear: no UHS-I signalling
  cid() {
    // MID 0, OID 'EM', PNM 'OMEMU', PRV 1.0, PSN 1, MDT October 2026
    return withCrc(Uint8Array.of(0x00, 0x45, 0x4d, 0x4f, 0x4d, 0x45, 0x4d, 0x55, 0x10, 0, 0, 0, 1, 0x01, 0xaa, 0));
  }
  csd() {
    // CSD 2.0: TAAC 1 ms, TRAN_SPEED 25 MHz, CCC 0x5b5, READ_BL_LEN 9, C_SIZE, ERASE_BLK_EN, SECTOR_SIZE 127, R2W_FACTOR
    // 2, WRITE_BL_LEN 9
    const c = this.sectors / 1024 - 1;
    return withCrc(Uint8Array.of(0x40, 0x0e, 0x00, 0x32, 0x5b, 0x59, 0x00, (c >> 16) & 0x3f, (c >> 8) & 0xff, c & 0xff, 0x7f, 0x80, 0x0a, 0x40, 0x00, 0));
  }
  // SCR: SD_SPEC 2 with SD_SPEC3 (version 3.0x), SD_SECURITY 3 (SDHC, version 2.00) or 4 (SDXC, version 3.xx), 1- and
  // 4-bit bus
  scr() { return Uint8Array.of(0x02, (this.kind === 'SDXC' ? 0x40 : 0x30) | 0x05, 0x80, 0x00, 0, 0, 0, 0); }
  // the SD Status's AU_SIZE code: 4 MiB on SDHC; on SDXC 16 MiB up to 128 GiB, 32 MiB above (the lab's choice)
  auSize() { return this.kind === 'SDHC' ? AU_4M : this.sectors <= 128 * GIB ? AU_16M : AU_32M; }
  // SD Status: the bus width, SPEED_CLASS 4 (class 10), AU_SIZE, ERASE_SIZE 1 AU, ERASE_TIMEOUT 1 s, ERASE_OFFSET 1 s
  ssr() {
    const b = new Uint8Array(64);
    b[0] = this.bus4 ? 0x80 : 0; b[8] = 4; b[10] = this.auSize() << 4; b[12] = 1; b[13] = 0x05;
    return b;
  }
  // CMD6's status: 200 mA, group 1 (access mode) supports default and high speed, the other groups their default; the
  // selection of group 1 is the argument's (0xf: no change, 0 or 1 taken, any other 0xf, unsupported), the others 0
  switchStatus(arg) {
    const b = new Uint8Array(64);
    b[1] = 0xc8;
    for (let g = 0; g < 6; g++) { b[2 + 2 * g] = 0x80; b[3 + 2 * g] = 0x01; }
    b[13] = 0x03;
    const g1 = arg & 0xf;
    b[16] = g1 === 0xf ? 0 : g1 <= 1 ? g1 : 0xf;
    b[17] = 0;
    return b;
  }
  // ---- the sector store
  readSector(lba) { this.reads += 1; return this.data.get(lba) ?? new Uint8Array(SECTOR); }
  writeSector(lba, bytes) {
    this.writes += 1; this.dirty = true;
    if (bytes.every((v) => v === 0)) this.data.delete(lba); else this.data.set(lba, Uint8Array.from(bytes));
  }
  read(lba, count) {
    const out = new Uint8Array(count * SECTOR);
    for (let i = 0; i < count; i++) { const s = this.data.get(lba + i); if (s) out.set(s, SECTOR * i); }
    return out;
  }
  take_dirty() { const d = this.dirty; this.dirty = false; return d; }
  // ---- commands
  status() { return (STATES[this.state] << 9 | R1_READY) >>> 0; }
  // One command: {status, resp: [4 words], data (the bytes a read command returns), write (true: the command takes
  // count blocks from the host)}; status NO_RESPONSE for a command the card does not answer. The block count and size
  // are the host's (a data command's).
  exec(code, arg, count = 0, blockSize = 0) {
    const index = code & 0x3f, acmd = (code & 0x40) !== 0;
    const r = this._exec(code, index, acmd, arg >>> 0, count, blockSize);
    this.log.push([index, acmd ? 1 : 0, arg >>> 0, r.status]);
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
    return r;
  }
  _exec(code, index, acmd, arg, count, blockSize) {
    const none = { status: NO_RESPONSE };
    if (!this.present || (code & UHS2)) return none;     // an empty slot; UHS-II: this card has no UHS-II interface
    const ok = (w0 = 0, data = null, write = false) => ({ status: 0, resp: [w0 >>> 0, 0, 0, 0], data, write });
    const r1 = () => this.status() | (acmd ? R1_APP_CMD : 0);
    if (acmd) {
      switch (index) {
        case 41: if (this.state === 'idle' && (arg & OCR_VDD)) this.state = 'ready'; return ok(this.ocr());
        case 6: if (this.state !== 'tran') return none; this.bus4 = (arg & 3) === 2; return ok(r1());
        case 13: if (this.state !== 'tran') return none; return ok(r1(), this.ssr());
        case 42: return ok(r1());                  // SET_CLR_CARD_DETECT: the DAT3 pull-up, no effect here
        case 51: if (this.state !== 'tran') return none; return ok(r1(), this.scr());
        case 23: return ok(r1());                  // SET_WR_BLK_ERASE_COUNT: a hint
        default: return none;
      }
    }
    switch (index) {
      case 0: this.state = 'idle'; this.selected = false; this.bus4 = false; return ok();
      case 8: return (arg & 0xf00) === 0x100 ? ok(arg & 0xfff) : none;            // 2.7-3.6 V; the check pattern back
      case 2: if (this.state !== 'ready') return none; this.state = 'ident'; return { status: 0, resp: r2Words(this.cid()) };
      case 3: if (this.state !== 'ident' && this.state !== 'stby') return none;
        this.state = 'stby';
        return ok(this.rca << 16 | ((STATES.ident << 9) | R1_READY));               // R6: RCA, status bits 12..0
      case 9: if (this.state !== 'stby') return none; return { status: 0, resp: r2Words(this.csd()) };
      case 10: if (this.state !== 'stby') return none; return { status: 0, resp: r2Words(this.cid()) };
      case 7: {
        const before = this.status();
        if ((arg >>> 16) === this.rca) { if (this.state === 'stby') this.state = 'tran'; this.selected = true; } else { if (this.state === 'tran') this.state = 'stby'; this.selected = false; }
        return ok(before);
      }
      case 13: if ((arg >>> 16) !== this.rca || !ADDRESSED.has(this.state)) return none; return ok(r1());   // from stand-by on (an RCA)
      case 16: return ok(r1());                    // SET_BLOCKLEN: 512 on an SDHC card
      case 23: return ok(r1());                    // SET_BLOCK_COUNT
      case 55: return ok(this.status() | R1_APP_CMD);
      case 6: if (this.state !== 'tran') return none; return ok(r1(), this.switchStatus(arg));
      case 12: return ok(this.status());
      case 17: case 18: {
        if (this.state !== 'tran') return none;
        const n = index === 17 ? 1 : count;
        if (arg + n > this.sectors) return { status: 0, resp: [(r1() | R1_OUT_OF_RANGE) >>> 0, 0, 0, 0] };   // OUT_OF_RANGE
        const out = new Uint8Array(n * SECTOR);
        for (let i = 0; i < n; i++) out.set(this.readSector(arg + i), SECTOR * i);
        return ok(r1(), out);
      }
      case 24: case 25:
        if (this.state !== 'tran') return none;
        if (arg + (index === 24 ? 1 : count) > this.sectors) return { status: 0, resp: [(r1() | R1_OUT_OF_RANGE) >>> 0, 0, 0, 0] };
        return ok(r1(), null, true);
      case 32: this.erase[0] = arg; return ok(r1());
      case 33: this.erase[1] = arg; return ok(r1());
      case 38: {                                    // ERASE: the blocks read 0 after it (SCR DATA_STAT_AFTER_ERASE 0)
        const [a, b] = this.erase, last = Math.min(b, this.sectors - 1);
        // by the stored sectors when the range is the larger (a whole SDXC card is 2^28 sectors and more)
        const span = last - a + 1, gone = span > this.data.size ? [...this.data.keys()].filter((s) => s >= a && s <= last) : null;
        if (gone) for (const s of gone) { this.data.delete(s); this.dirty = true; }
        else for (let s = a; s <= last; s++) if (this.data.delete(s)) this.dirty = true;
        return ok(r1());
      }
      default: return none;
    }
  }
}

// ---- a saved card: 'OMSD', version 1, sectors, count, then count x (u32 sector, 512 bytes), little-endian
export function cardImage(card) {
  const keys = [...card.data.keys()].sort((a, b) => a - b);
  const out = new Uint8Array(16 + keys.length * (4 + SECTOR)), dv = new DataView(out.buffer);
  out.set([0x4f, 0x4d, 0x53, 0x44]);
  dv.setUint32(4, 1, true); dv.setUint32(8, card.sectors, true); dv.setUint32(12, keys.length, true);
  keys.forEach((k, i) => { const o = 16 + i * (4 + SECTOR); dv.setUint32(o, k, true); out.set(card.data.get(k), o + 4); });
  return out;
}
export function cardFromImage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'OMSD' || dv.getUint32(4, true) !== 1) throw new Error('cardFromImage: not an OMSD version 1 card image');
  const sectors = dv.getUint32(8, true), n = dv.getUint32(12, true), data = new Map();
  if (bytes.length !== 16 + n * (4 + SECTOR)) throw new Error(`cardFromImage: ${bytes.length} bytes for ${n} sectors`);
  for (let i = 0; i < n; i++) { const o = 16 + i * (4 + SECTOR); data.set(dv.getUint32(o, true), bytes.slice(o + 4, o + 4 + SECTOR)); }
  return new SdCard({ sectors, data });
}

// A card kept in memory between sessions (src/lab/player.mjs: a player's power cycle keeps the card in the slot):
// env.card's {open(), save(card)}, the browser player's and node's without OM_EMU_CARD; sectors: its capacity (the
// default card's when null; node's OM_EMU_CARD_SIZE)
export function memoryCard({ sectors = null } = {}) {
  let card = null;
  return { open: () => (card ??= new SdCard(sectors === null ? {} : { sectors })), save: (c) => { card = c; } };
}
