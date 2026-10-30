// The TG-5's internal charger at the far end of PER_SIO's channel 9 (S-CHARGER, behind S-SIOIIC, src/lab/sio.mjs;
// E129, E132; the addresses in src/fw/models.mjs E132 sio_devices and docs/model-survey.md finding 24). What the
// firmware's code shows of it is all the model answers. The power module's charger request (d0 a request code: its
// type, register and value index in nibbles 2, 1 and 0) writes one of its table's values to register 0, 1 or 2 (0 <-
// 8, 9 or 2; 1 <- 0xa2, 0x96, 0x94, 0x97, 0x95 or 0x93; 2 <- 9) as the IIC write [0x36, register, value], waits for
// the completion (3000 ms; its timeout logs an error), reads the register back with the IIC write-read [0x36,
// register], [0x37] and one byte, and compares the byte with the value written (a mismatch takes the charger's error
// path); its type 2 reads a register so without writing it (D). The address is 0x1b, the address bytes' 0x36 / 0x37
// (D). The chip is not named in the image (?). The model: registers 0, 1 and 2 keep what is written (I: the
// read-back test expects it); a read answers the register the write segment before it named; a read of a register
// not written in the session (its value on the camera is ?), another address, register or length stops the session.
import { FirmwareError } from './hle.mjs';
import { bytesHex } from '../util/bytes.mjs';

export class ChargerError extends FirmwareError {}

export const CHARGER_ADDRESS = 0x1B;
const REGISTERS = [0, 1, 2];

export class IntCharger {
  constructor() {
    this.label = 'S-CHARGER';
    this.regs = new Map();                // register -> the value last written
    this.ptr = null;                      // the register a following read answers
    this.log = [];                        // [op, register, value]
  }
  fail(what) { throw new ChargerError(`S-CHARGER: ${what}: not what the firmware's charger request does (src/lab/charger.mjs)`); }
  write(addr, data) {
    if (addr !== CHARGER_ADDRESS) this.fail(`a write to address 0x${addr.toString(16)}`);
    if (!(data.length === 1 || data.length === 2) || !REGISTERS.includes(data[0])) this.fail(`a write of ${bytesHex(data)}`);
    if (data.length === 2) { this.regs.set(data[0], data[1]); this.ptr = null; this.log.push(['write', data[0], data[1]]); return; }
    this.ptr = data[0];
  }
  read(addr, n) {
    if (addr !== CHARGER_ADDRESS) this.fail(`a read from address 0x${addr.toString(16)}`);
    if (n !== 1 || this.ptr === null) this.fail(`a read of ${n} bytes ${this.ptr === null ? 'with no register named' : `of register ${this.ptr}`}`);
    const reg = this.ptr;
    this.ptr = null;
    if (!this.regs.has(reg)) throw new ChargerError(`S-CHARGER: a read of register ${reg}, which was not written in this session: its value on the camera is not known (?)`);
    this.log.push(['read', reg, this.regs.get(reg)]);
    return [this.regs.get(reg)];
  }
  status() { return { regs: Object.fromEntries(this.regs), ops: this.log.length, last: this.log.at(-1) ?? null }; }
}
