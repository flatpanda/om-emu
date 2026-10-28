// The STM32L4's RTC (RM0394 section 38, at 0x40002800) at register level: the calendar (TR / DR in BCD, SSR, 24-hour
// and AM / PM formats) running on the RTC clock RCC selects (LSE 32.768 kHz on the SCPU's board, I) through the
// asynchronous and synchronous prescalers of PRER, the initialisation mode (ISR.INIT -> INITF, the calendar stopped
// and TR / DR / PRER writable), the shadow registers' synchronisation flag RSF (set again two RTC clock periods after
// software clears it, and after leaving INIT), the write protection (WPR's key 0xca, 0x53; any other value locks)
// and the backup domain's write access (PWR CR1.DBP), alarms A and B with their masks and sub-second masks treated as
// whole-second matches, the wake-up timer (WUCKSEL, WUTR, WUTF), the interrupts through EXTI (alarms line 18, wake-up
// line 20), the 32 backup registers, the daylight-saving bits and BKP. Time passes with the core's cycles at the
// clock RCC gives HCLK. Timestamp, tamper, calibration, the shift register and the reference clock are not modelled
// (Unmodelled when enabled). The backup domain's state survives a system reset (the machine keeps this object), and
// RCC's BDRST resets it.
import { Regs, Unmodelled, merge } from './regs.mjs';

export const TR = 0x00, DR = 0x04, CR = 0x08, ISR = 0x0c, PRER = 0x10, WUTR = 0x14, ALRMAR = 0x1c, ALRMBR = 0x20,
  WPR = 0x24, SSR = 0x28, SHIFTR = 0x2c, TSTR = 0x30, TSDR = 0x34, TSSSR = 0x38, CALR = 0x3c, TAMPCR = 0x40,
  ALRMASSR = 0x44, ALRMBSSR = 0x48, OR = 0x4c, BKP0R = 0x50;
const ALRAWF = 1, ALRBWF = 2, WUTWF = 4, INITS = 16, RSF = 32, INITF = 64, INIT = 128, ALRAF = 256, ALRBF = 512, WUTF = 1024;
const bcd = (v) => ((Math.floor(v / 10) << 4) | (v % 10));
const unbcd = (v) => ((v >>> 4) & 15) * 10 + (v & 15);
const DAY = 86400;

export class Rtc extends Regs {
  // sched, exti (line(n, level)), rtcHz() / hclkHz() from RCC, dbp() from PWR
  constructor({ sched, exti, rtcHz, hclkHz, dbp }) {
    super('RTC');
    Object.assign(this, { sched, exti, rtcHz, hclkHz, dbp });
    this.reset();
  }
  // the backup domain's reset (power-on with no backup supply, or RCC BDCR.BDRST)
  reset() {
    this.cr = 0; this.isr = ALRAWF | ALRBWF | WUTWF; this.prer = 0x007f00ff; this.wutr = 0xffff;
    this.alrm = [0, 0]; this.alrmss = [0, 0]; this.or = 0; this.tampcr = 0; this.calr = 0;
    this.bkp = new Uint32Array(32);
    this.unlocked = 0;                            // WPR: 0 locked, 1 after 0xca, 2 unlocked
    this.secs = 0;                                // seconds since 2000-01-01 00:00:00 (a Saturday; DR's weekday is kept apart)
    this.wdu = 1;                                 // DR's reset value: Monday, 2000-01-01
    this.sub = 0;                                 // ck_apre periods into the current second
    this.acc = 0;                                 // RTC clock periods not yet an ck_apre period
    this.at = this.sched ? this.sched.now() : 0;
    this.hz = 0;
    this.ev = this.sched ? this.sched.cancel(this.ev) : null;
    this.wuEv = this.sched ? this.sched.cancel(this.wuEv) : null;
    this.rsfEv = this.sched ? this.sched.cancel(this.rsfEv) : null;
    this.secEv = this.sched ? this.sched.cancel(this.secEv) : null;
    this.isr |= RSF;
    if (this.exti) this.lines();
  }
  apre() { return ((this.prer >>> 16) & 0x7f) + 1; }
  spre() { return (this.prer & 0x7fff) + 1; }
  running() { return this.rtcHz() > 0 && !(this.isr & INITF); }
  // bring the calendar up to the current cycle (call before any change of the clock or of the calendar)
  advance() {
    const now = this.sched.now(), dt = now - this.at;
    this.at = now;
    if (!this.running() || dt <= 0) return;
    const ticks = this.acc + dt * this.rtcHz() / this.hclkHz();
    const n = Math.floor(ticks / this.apre());
    this.acc = ticks - n * this.apre();
    const s = this.sub + n, sp = this.spre(), whole = Math.floor(s / sp);
    this.sub = s % sp;
    if (whole) {
      const days = Math.floor((this.secs + whole) / DAY) - Math.floor(this.secs / DAY);
      this.secs += whole;
      if (this.wdu) this.wdu = ((this.wdu - 1 + days) % 7) + 1;
    }
  }
  // core cycles until the next second boundary
  toNextSecond() {
    const per = this.apre() * this.hclkHz() / this.rtcHz();
    return Math.max(1, Math.ceil((this.spre() - this.sub) * per - this.acc * this.hclkHz() / this.rtcHz()));
  }
  clockChanged() { this.advance(); this.schedule(); }

  // ---- the calendar as registers
  date() { return new Date(Date.UTC(2000, 0, 1) + this.secs * 1000); }
  tr() {
    const d = this.date();
    let h = d.getUTCHours(), pm = 0;
    if (this.cr & (1 << 6)) { pm = h >= 12 ? 1 : 0; h = h % 12 || 12; }
    return ((pm << 22) | (bcd(h) << 16) | (bcd(d.getUTCMinutes()) << 8) | bcd(d.getUTCSeconds())) >>> 0;
  }
  dr() {
    const d = this.date();
    return ((bcd(d.getUTCFullYear() - 2000) << 16) | (this.wdu << 13) | (bcd(d.getUTCMonth() + 1) << 8) | bcd(d.getUTCDate())) >>> 0;
  }
  setCalendar(tr, dr) {
    let h = unbcd((tr >>> 16) & 0x3f);
    if ((this.cr & (1 << 6)) && ((tr >>> 22) & 1)) h = (h % 12) + 12;
    else if (this.cr & (1 << 6)) h = h % 12;
    const y = 2000 + unbcd((dr >>> 16) & 0xff), mo = unbcd((dr >>> 8) & 0x1f), dd = unbcd(dr & 0x3f);
    const t = Date.UTC(y, mo - 1, dd, h, unbcd((tr >>> 8) & 0x7f), unbcd(tr & 0x7f));
    this.secs = Math.round((t - Date.UTC(2000, 0, 1)) / 1000);
    this.wdu = (dr >>> 13) & 7;
    this.sub = 0; this.acc = 0;
    this.isr = (this.isr & ~INITS) | (((dr >>> 16) & 0xff) ? INITS : 0);
  }

  writable() { return this.dbp(); }
  protectedOk() { return this.dbp() && this.unlocked === 2; }
  rd(off) {
    this.advance();
    if (off >= BKP0R && off < BKP0R + 0x80) return this.bkp[(off - BKP0R) >> 2];
    switch (off) {
      case TR: return this.tr();
      case DR: return this.dr();
      case CR: return this.cr;
      case ISR: return this.isr;
      case PRER: return this.prer;
      case WUTR: return this.wutr;
      case ALRMAR: return this.alrm[0];
      case ALRMBR: return this.alrm[1];
      case WPR: return 0;
      case SSR: return (this.spre() - 1 - this.sub) & 0xffff;
      case SHIFTR: return 0;
      case TSTR: case TSDR: case TSSSR: return 0;
      case CALR: return this.calr;
      case TAMPCR: return this.tampcr;
      case ALRMASSR: return this.alrmss[0];
      case ALRMBSSR: return this.alrmss[1];
      case OR: return this.or;
    }
    throw this.missing(off, false);
  }
  wr(off, v, mask) {
    if (!this.writable()) return;                 // the backup domain is write-protected (PWR CR1.DBP = 0)
    this.advance();
    if (off >= BKP0R && off < BKP0R + 0x80) { const i = (off - BKP0R) >> 2; this.bkp[i] = merge(this.bkp[i], v, mask); return; }
    if (off === WPR) {
      const k = v & mask & 0xff;
      this.unlocked = k === 0xca ? 1 : k === 0x53 && this.unlocked === 1 ? 2 : 0;
      return;
    }
    if (off === ISR) return this.writeIsr(v, mask);
    if (!this.protectedOk()) return;              // RTC_WPR has not been unlocked
    const init = (this.isr & INITF) !== 0;
    switch (off) {
      case TR: if (init) this.setCalendar(merge(this.tr(), v, mask, 0x007f7f7f), this.dr()); return;
      case DR: if (init) this.setCalendar(this.tr(), merge(this.dr(), v, mask, 0x00ffff3f)); return;
      case PRER: if (init) this.prer = merge(this.prer, v, mask, 0x007f7fff); return;
      case CR: return this.writeCr(merge(this.cr, v, mask, 0x01ffff7f));
      case WUTR: if (this.isr & WUTWF) this.wutr = merge(this.wutr, v, mask, 0xffff); return;
      case ALRMAR: if (this.isr & ALRAWF) this.alrm[0] = merge(this.alrm[0], v, mask); return;
      case ALRMBR: if (this.isr & ALRBWF) this.alrm[1] = merge(this.alrm[1], v, mask); return;
      case ALRMASSR: this.alrmss[0] = merge(this.alrmss[0], v, mask, 0x0f007fff); return;
      case ALRMBSSR: this.alrmss[1] = merge(this.alrmss[1], v, mask, 0x0f007fff); return;
      case CALR: { const nv = merge(this.calr, v, mask, 0x0000e1ff); if (nv) throw new Unmodelled('RTC smooth calibration (CALR)'); this.calr = nv; return; }
      case TAMPCR: { const nv = merge(this.tampcr, v, mask); if (nv & 0x2d) throw new Unmodelled('RTC tamper detection (TAMPCR)'); this.tampcr = nv; return; }
      case SHIFTR: throw new Unmodelled('RTC shift (SHIFTR)');
      case OR: this.or = merge(this.or, v, mask, 3); return;
      case SSR: case TSTR: case TSDR: case TSSSR: return;
    }
    throw this.missing(off, true, v);
  }
  writeIsr(v, mask) {
    v &= mask;
    // INIT needs the write protection unlocked; the flags clear by writing 0 (rc_w0)
    if (this.protectedOk()) {
      if ((v & INIT) && !(this.isr & INIT)) { this.isr |= INIT | INITF; this.isr &= ~RSF; this.sub = 0; this.acc = 0; }
      else if (!(v & INIT) && (mask & INIT) && (this.isr & INIT)) { this.isr &= ~(INIT | INITF); this.at = this.sched.now(); this.resync(); }
    }
    const w0 = (RSF | ALRAF | ALRBF | WUTF | (1 << 11) | (1 << 12) | (7 << 13) | (1 << 17)) & mask;
    const cleared = w0 & ~v;
    this.isr &= ~cleared;
    if (cleared & RSF) this.resync();
    this.lines();
    this.schedule();
  }
  // RSF sets again after two RTC clock periods (RM0394 38.3.8)
  resync() {
    this.rsfEv = this.sched.cancel(this.rsfEv);
    const hz = this.rtcHz();
    if (!hz) return;
    this.rsfEv = this.sched.after(Math.ceil(2 * this.hclkHz() / hz), () => { this.rsfEv = null; this.isr |= RSF; }, 'RTC RSF');
  }
  writeCr(nv) {
    if (nv & ((1 << 11) | (1 << 15) | (1 << 4) | (1 << 23) | (1 << 24))) throw new Unmodelled(`RTC timestamp, reference clock or calibration output (CR 0x${nv.toString(16)})`);
    if (nv & (3 << 16)) {                        // ADD1H / SUB1H: one hour more or less, then they clear
      this.secs += nv & (1 << 16) ? 3600 : -3600;
      nv &= ~(3 << 16);
    }
    const old = this.cr;
    this.cr = nv;
    // the write flags follow the enables: a timer or alarm is writable while it is off
    this.isr = (this.isr & ~(ALRAWF | ALRBWF | WUTWF)) | (nv & (1 << 8) ? 0 : ALRAWF) | (nv & (1 << 9) ? 0 : ALRBWF) | (nv & (1 << 10) ? 0 : WUTWF);
    if ((nv ^ old) & ((1 << 10) | 7)) this.wakeTimer();
    this.lines();
    this.schedule();
  }
  // the wake-up timer: (WUTR + 1) periods of its clock to each WUTF
  wakeTimer() {
    this.wuEv = this.sched.cancel(this.wuEv);
    if (!(this.cr & (1 << 10)) || !this.rtcHz()) return;
    const sel = this.cr & 7;
    const hz = sel < 4 ? this.rtcHz() / (16 >> sel) : this.rtcHz() / (this.apre() * this.spre());
    const periods = (this.wutr + 1) + (sel >= 6 ? 0x10000 : 0);
    const cycles = Math.max(1, Math.round(periods * this.hclkHz() / hz));
    this.wuEv = this.sched.after(cycles, () => { this.wuEv = null; this.isr |= WUTF; this.lines(); this.wakeTimer(); }, 'RTC wake-up');
  }
  // the alarms are checked at each second while one is enabled
  schedule() {
    this.secEv = this.sched.cancel(this.secEv);
    if (!(this.cr & (3 << 8)) || !this.running()) return;
    this.secEv = this.sched.after(this.toNextSecond(), () => { this.secEv = null; this.advance(); this.alarms(); this.schedule(); }, 'RTC second');
  }
  alarms() {
    for (let k = 0; k < 2; k++) {
      if (!(this.cr & (1 << (8 + k)))) continue;
      if (this.matches(this.alrm[k])) { this.isr |= k ? ALRBF : ALRAF; }
    }
    this.lines();
  }
  matches(a) {
    const tr = this.tr(), dr = this.dr();
    if (!(a & 0x80) && (a & 0x7f) !== (tr & 0x7f)) return false;
    if (!(a & 0x8000) && ((a >>> 8) & 0x7f) !== ((tr >>> 8) & 0x7f)) return false;
    if (!(a & 0x800000) && ((a >>> 16) & 0x7f) !== ((tr >>> 16) & 0x7f)) return false;
    if (!(a & 0x80000000)) {
      const want = (a >>> 24) & 0x3f;
      if (a & (1 << 30)) { if ((want & 7) !== this.wdu) return false; }
      else if (want !== (dr & 0x3f)) return false;
    }
    return true;
  }
  // an event that wakes the chip from standby: an alarm or the wake-up timer with its interrupt enabled
  wakeSource() {
    const c = this.cr, s = this.isr;
    return !!(((c & (1 << 12)) && (s & ALRAF)) || ((c & (1 << 13)) && (s & ALRBF)) || ((c & (1 << 14)) && (s & WUTF)));
  }
  // the EXTI lines: alarm (18) from ALRAF / ALRBF with their enables, wake-up (20) from WUTF with WUTIE
  lines() {
    const c = this.cr, s = this.isr;
    this.exti.line(18, !!(((c & (1 << 12)) && (s & ALRAF)) || ((c & (1 << 13)) && (s & ALRBF))));
    this.exti.line(20, !!((c & (1 << 14)) && (s & WUTF)));
  }
}
