// Trace records of the debug API and their formats: QEMU's -d exec line, the
// memory_region_ops_read/write trace event as QEMU's log backend prints it (without the 'mr' host pointer), a JSON record
// per line, and the chunk digester the trace gates compare streams with (sha256 per run of N lines, as
// `split -l N --filter=sha256sum` prints them). Worker-safe: the hash is env.createHash, nothing else is imported.

const HEXD = new Uint8Array([48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102]);
const ENC = new TextEncoder();
const h = (v, n) => (v >>> 0).toString(16).padStart(n, '0');

// "MN10300 pc=%08x op=%02x sp=%08x d0=%08x d1=%08x d2=%08x psw=%04x"
export function execLine(r) {
  return `MN10300 pc=${h(r.pc, 8)} op=${h(r.op, 2)} sp=${h(r.sp, 8)} d0=${h(r.d0, 8)} d1=${h(r.d1, 8)} d2=${h(r.d2, 8)} psw=${h(r.psw & 0xffff, 4)}`;
}
// "memory_region_ops_read cpu %d addr 0x%lx value 0x%lx size %u name '%s'" (QEMU's log backend; mr dropped)
export function mmioLine(r) {
  return `memory_region_ops_${r.dir === 'w' ? 'write' : 'read'} cpu ${r.cpu} addr 0x${(r.addr >>> 0).toString(16)} value 0x${(r.value >>> 0).toString(16)} size ${r.size} name '${r.name}'`;
}
// The MMIO line with the accessing instruction's pc (cpu -1, the debugger: '-').
export function mmioPcLine(r) { return `${mmioLine(r)} pc ${r.cpu === 0 ? h(r.pc, 8) : '-'}`; }
export function irqLine(r) {
  return r.kind === 'presented' ? `irq presented irq ${r.irq} level ${r.level} pc ${h(r.pc, 8)} insns ${r.insns}`
    : `irq accepted level ${r.level} pc ${h(r.pc, 8)} insns ${r.insns}`;
}
// A JSON record per line: addresses, register values and MMIO values as '0x%08x' strings (the protocol's form, so a
// grep for 0x502d0336 finds them), op '0x%02x', psw '0x%04x'; counts, sizes, levels and names as they are.
const HEXF = { pc: 8, sp: 8, d0: 8, d1: 8, d2: 8, addr: 8, value: 8, op: 2, psw: 4 };
export function jsonLine(kind, r) {
  const o = { kind };
  for (const [k, v] of Object.entries(r)) o[k] = Object.hasOwn(HEXF, k) && typeof v === 'number' ? `0x${h(v, HEXF[k])}` : v;
  return JSON.stringify(o);
}

// Line digester: sha256 of every `lines` lines (each with its '\n'), and of the rest at finish(). exec() writes the
// -d exec line straight into a byte buffer (the gates hash about 130 M of them); text() takes any other line.
const TEMPLATE = ENC.encode('MN10300 pc=00000000 op=00 sp=00000000 d0=00000000 d1=00000000 d2=00000000 psw=0000\n');
export class ChunkDigester {
  constructor(createHash, { lines = 1000000, onChunk = null } = {}) {
    this.createHash = createHash; this.per = lines; this.onChunk = onChunk;
    this.hash = createHash('sha256'); this.n = 0; this.total = 0; this.chunks = [];
    this.buf = new Uint8Array(1 << 16); this.pos = 0;
  }
  _flush() { if (this.pos) { this.hash.update(this.buf.subarray(0, this.pos)); this.pos = 0; } }
  _line() {
    this.total++;
    if (++this.n === this.per) {
      this._flush();
      const d = this.hash.digest('hex');
      this.chunks.push(d);
      if (this.onChunk) this.onChunk(d, this.chunks.length - 1);
      this.hash = this.createHash('sha256'); this.n = 0;
    }
  }
  exec(pc, op, sp, d0, d1, d2, psw) {
    if (this.pos + 83 > this.buf.length) this._flush();
    const b = this.buf, p = this.pos;
    b.set(TEMPLATE, p);
    hex(b, p + 11, pc, 8); hex(b, p + 23, op, 2); hex(b, p + 29, sp, 8); hex(b, p + 41, d0, 8);
    hex(b, p + 53, d1, 8); hex(b, p + 65, d2, 8); hex(b, p + 78, psw & 0xffff, 4);
    this.pos = p + 83;
    this._line();
  }
  text(line) {
    const bytes = ENC.encode(line + '\n');
    if (this.pos + bytes.length > this.buf.length) this._flush();
    if (bytes.length > this.buf.length) this.hash.update(bytes); else { this.buf.set(bytes, this.pos); this.pos += bytes.length; }
    this._line();
  }
  // Ends the stream: the digest of a last partial chunk is added. Returns {chunks, lines}.
  finish() {
    this._flush();
    if (this.n) {
      const d = this.hash.digest('hex');
      this.chunks.push(d);
      if (this.onChunk) this.onChunk(d, this.chunks.length - 1);
      this.n = 0; this.hash = this.createHash('sha256');
    }
    return { chunks: this.chunks, lines: this.total };
  }
}
function hex(b, p, v, n) {
  v >>>= 0;
  for (let i = n - 1; i >= 0; i--) { b[p + i] = HEXD[v & 15]; v >>>= 4; }
}
