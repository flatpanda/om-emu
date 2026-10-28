// A minimal GDB remote serial protocol client for QEMU's gdbstub (tools/m4-oracle only): packets with checksums,
// no-ack mode after the handshake, the stop reply of a continue, an interrupt. Our own code, written from the
// protocol's documentation (GDB manual, "Remote Protocol").
import net from 'node:net';

export class Rsp {
  static async connect(port, host = '127.0.0.1', tries = 100) {
    for (let i = 0; i < tries; i++) {
      try {
        const sock = await new Promise((res, rej) => { const s = net.connect(port, host, () => res(s)); s.once('error', rej); });
        const r = new Rsp(sock);
        await r.handshake();
        return r;
      } catch { await new Promise((res) => setTimeout(res, 50)); }
    }
    throw new Error(`gdbstub at ${host}:${port}: no connection`);
  }
  constructor(sock) {
    this.sock = sock;
    this.buf = '';
    this.waiters = [];
    this.noAck = false;
    sock.setNoDelay(true);
    sock.on('data', (d) => { this.buf += d.toString('latin1'); this.drain(); });
  }
  drain() {
    for (;;) {
      while (this.buf.length && (this.buf[0] === '+' || this.buf[0] === '-')) this.buf = this.buf.slice(1);
      const s = this.buf.indexOf('$');
      if (s < 0) return;
      const h = this.buf.indexOf('#', s);
      if (h < 0 || this.buf.length < h + 3) return;
      const body = this.buf.slice(s + 1, h);
      this.buf = this.buf.slice(h + 3);
      if (!this.noAck) this.sock.write('+');
      const w = this.waiters.shift();
      if (w) w(unescape(body));
    }
  }
  send(body) {
    let cs = 0;
    for (let i = 0; i < body.length; i++) cs = (cs + body.charCodeAt(i)) & 0xff;
    this.sock.write(`$${body}#${cs.toString(16).padStart(2, '0')}`, 'latin1');
  }
  request(body, timeoutMs = 10000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`gdbstub: no reply to ${body.slice(0, 24)}`)), timeoutMs);
      this.waiters.push((x) => { clearTimeout(t); res(x); });
      this.send(body);
    });
  }
  async handshake() {
    await this.request('qSupported:swbreak+;hwbreak+');
    const r = await this.request('QStartNoAckMode');
    if (r === 'OK') this.noAck = true;
    await this.request('?');
  }
  // continue until a stop reply; an interrupt after timeoutMs (the reply is then the interrupt's stop)
  async cont(timeoutMs = 2000) {
    const reply = new Promise((res) => this.waiters.push(res));
    this.send('c');
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; this.sock.write('\x03'); }, timeoutMs);
    const r = await reply;
    clearTimeout(t);
    return { reply: r, timedOut };
  }
  async readMem(addr, len) {
    let out = '';
    for (let o = 0; o < len; o += 1024) {
      const n = Math.min(1024, len - o);
      const r = await this.request(`m${(addr + o).toString(16)},${n.toString(16)}`);
      if (r.length !== 2 * n) throw new Error(`gdbstub: read 0x${(addr + o).toString(16)}: ${r.slice(0, 8)}`);
      out += r;
    }
    return Uint8Array.from(out.match(/../g), (x) => parseInt(x, 16));
  }
  async writeMem(addr, bytes) {
    for (let o = 0; o < bytes.length; o += 1024) {
      const part = bytes.subarray(o, o + 1024);
      const r = await this.request(`M${(addr + o).toString(16)},${part.length.toString(16)}:${hexBytes(part)}`);
      if (r !== 'OK') throw new Error(`gdbstub: write 0x${(addr + o).toString(16)}: ${r}`);
    }
  }
  async readReg(n) { return le32(await this.request(`p${n.toString(16)}`)); }
  async writeReg(n, v) {
    const r = await this.request(`P${n.toString(16)}=${hexBytes(u32bytes(v))}`);
    if (r !== 'OK') throw new Error(`gdbstub: write register ${n}: ${r}`);
  }
  async readAll() { return await this.request('g'); }
  async writeAll(hex) { const r = await this.request(`G${hex}`); if (r !== 'OK') throw new Error(`gdbstub: G: ${r}`); }
  async breakAt(a) { const r = await this.request(`Z0,${a.toString(16)},2`); if (r !== 'OK') throw new Error(`gdbstub: Z0 0x${a.toString(16)}: ${r}`); }
  async unbreak(a) { await this.request(`z0,${a.toString(16)},2`); }
  async xfer(object, annex) {
    let out = '', off = 0;
    for (;;) {
      const r = await this.request(`qXfer:${object}:read:${annex}:${off.toString(16)},800`);
      out += r.slice(1); off += r.length - 1;
      if (r[0] === 'l') return out;
      if (r[0] !== 'm') throw new Error(`gdbstub: qXfer ${annex}: ${r.slice(0, 16)}`);
    }
  }
  close() { this.sock.destroy(); }
}

function unescape(s) {
  if (s.indexOf('}') < 0 && s.indexOf('*') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '}') { out += String.fromCharCode(s.charCodeAt(++i) ^ 0x20); continue; }
    if (ch === '*' && i > 0) { const n = s.charCodeAt(++i) - 29; out += out[out.length - 1].repeat(n); continue; }
    out += ch;
  }
  return out;
}
export const hexBytes = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const u32bytes = (v) => Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
export const le32 = (h) => (parseInt(h.slice(0, 2), 16) | (parseInt(h.slice(2, 4), 16) << 8) | (parseInt(h.slice(4, 6), 16) << 16) | (parseInt(h.slice(6, 8), 16) << 24)) | 0;
