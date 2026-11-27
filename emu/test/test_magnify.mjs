// Firmware-free unit checks for P1.2 (lv-magnify groundwork: E147 AEL/AFL 0x120b bodykey wiring),
// P1.3a (H-ADINIT E146 enablement, AD_MAX_CHANNELS = 10, E147 channel table evaluation), and
// play.mjs host environment helper (envVar / usbIdle).
//   node emu/test/test_magnify.mjs --units
import { AEL_CODE, AD_BODIES, AD_MAX_CHANNELS, BY_ID, CONTROLS, envVar, usbIdle } from '../src/lab/play.mjs';
import { CONTROL_ROWS, controlsDoc } from '../src/lab/playui.mjs';
import { FACTS } from '../src/fw/ports.mjs';

const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

export function magnifyUnits() {
  const t = tester(), { ok } = t;

  // 1. envVar precedence and usbIdle fallback
  {
    const prev = process.env.OM_USB_IDLE;
    try {
      process.env.OM_USB_IDLE = 'out';
      ok(envVar({ usb_idle: 'in' }, 'usb_idle', 'OM_USB_IDLE', 'in') === 'in', 'envVar prefers explicit env[key] over process.env');
      ok(envVar({}, 'usb_idle', 'OM_USB_IDLE', 'in') === 'out', 'envVar falls back to process.env when env[key] is absent');
      ok(envVar(null, 'usb_idle', 'OM_USB_IDLE', 'in') === 'out', 'envVar handles null env');
      delete process.env.OM_USB_IDLE;
      ok(envVar({}, 'usb_idle', 'OM_USB_IDLE', 'in') === 'in', 'envVar returns fallback when both env and process.env are absent');
      ok(usbIdle({ usb_idle: 'in' }, { usb_idle: 'out' }) === 'in', 'usbIdle prefers opts.usb_idle over env.usb_idle');
      ok(usbIdle({}, { usb_idle: 'in' }) === 'in', 'usbIdle reads env.usb_idle when opts.usb_idle is omitted');
      let err = null;
      try { usbIdle({}, { usb_idle: 'bogus' }); } catch (e) { err = e; }
      ok(err !== null && /in or out/.test(err.message), `usbIdle rejects invalid value: ${err?.message ?? 'accepted'}`);
    } finally {
      if (prev === undefined) delete process.env.OM_USB_IDLE;
      else process.env.OM_USB_IDLE = prev;
    }
  }

  // 2. AEL/AFL (0x120b) control wiring in play.mjs and playui.mjs
  {
    ok(AEL_CODE === 0x120B, `AEL_CODE is 0x120b (got 0x${AEL_CODE.toString(16)})`);
    const playRow = BY_ID.get('ael');
    const uiRow = CONTROL_ROWS.find((r) => r.id === 'ael');
    ok(playRow?.kind === 'key' && playRow?.bodykey === 0x120B && playRow?.status === 'not-wired' && playRow?.uiin === null,
      `play.mjs ael row keeps E143 not-wired default with bodykey 0x120b: ${JSON.stringify(playRow)}`);
    ok(uiRow?.kind === 'key' && uiRow?.bodykey === 0x120B && uiRow?.status === 'not-wired' && uiRow?.uiin === null,
      `playui.mjs ael row matches play.mjs: ${JSON.stringify(uiRow)}`);
    const shared = ['id', 'name', 'kind', 'uiin', 'gui', 'inject', 'js_ev', 'dial', 'status', 'reason'];
    const idx = CONTROLS.findIndex((c) => c.id === 'ael');
    ok(CONTROL_ROWS.length === CONTROLS.length && shared.every((k) => JSON.stringify(CONTROL_ROWS[idx]?.[k] ?? null) === JSON.stringify(CONTROLS[idx]?.[k] ?? null)),
      'CONTROL_ROWS and CONTROLS agree on ael and row count');

    // Simulate E147's D-verified UI_IN entry: group 1 byte 0 bit 3, code 0x120b, type 2, polarity 0, EV_PRESS_CUSTOM6_KEY
    const fakeTables = {
      ev: new Map(),
      ev_name: (code) => (code === 0x0200120B ? 'EV_PRESS_CUSTOM6_KEY' : code === 0x0201120B ? 'EV_RELEASE_CUSTOM6_KEY' : null),
      index_name: () => null,
    };
    const doc = controlsDoc(fakeTables, { ael: { uiin: [1, 0, 3, 0x120B, 2, 0], status: 'wired', reason: null } });
    const aelDoc = doc.find((r) => r.id === 'ael');
    ok(aelDoc?.status === 'wired' && aelDoc?.reason === null && aelDoc?.uiin?.code === '0x120b' &&
      aelDoc?.uiin?.group === 1 && aelDoc?.uiin?.byte === 0 && aelDoc?.uiin?.bit === 3 &&
      aelDoc?.ev?.[0] === 'EV_PRESS_CUSTOM6_KEY' && aelDoc?.ev?.[1] === 'EV_RELEASE_CUSTOM6_KEY',
      `controlsDoc wires E147 ael live row: ${JSON.stringify(aelDoc)}`);
  }

  // 3. H-ADINIT channel limit and AD_BODIES evaluation (E146 D-verified identical to E143; E147 deferred for ch 13..16)
  {
    ok(AD_MAX_CHANNELS === 10, `AD_MAX_CHANNELS is 10 to match om1.adc channels 0..9 (got ${AD_MAX_CHANNELS})`);
    ok(AD_BODIES.has('E143') && AD_BODIES.has('E146'), `AD_BODIES enables E143 and E146: ${JSON.stringify([...AD_BODIES])}`);
    ok(!AD_BODIES.has('E147'), `AD_BODIES defers E147 until driver channels 13..16 (conv 7,5,8,2) are D-identified: ${JSON.stringify([...AD_BODIES])}`);
    ok(FACTS.E146?.adc?.irq === 319 && FACTS.E147?.adc?.irq === 319,
      `FACTS.E146.adc and FACTS.E147.adc both target IRQ 319: E146=${FACTS.E146?.adc?.irq}, E147=${FACTS.E147?.adc?.irq}`);
  }

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = magnifyUnits();
  console.log(`magnify/adc/env units: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
