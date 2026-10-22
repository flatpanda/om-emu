// The MODELS knobs that hold firmware addresses and carry from a reference model to another (MODELS port_via, a target
// that lists them in `carry`): each knob's shape, and the kind of each address in it, by which bin/port.mjs takes it
// through the map from the reference's build to the target's and checks it (the result: src/fw/ports.mjs KNOBS, read
// through knob() in src/fw/model.mjs). A knob not listed here is the target's own to give: stand-ins for hardware a
// body lacks or for a state not understood yet (return_stubs, call_skips), whose pairing would not show they apply
// (E144's S-INTCHA stub pairs with an unrelated E139 function, D); vsync_alias_flags are found per body (the flag does
// not pair, D on E139), and the application's flash saves, once the knob flash_save_returns, by a rule
// (src/fw/facts.mjs appSaves; the call sites do not pair, D on E139). S-FRAMEWAIT's flag is read per body by a rule
// (src/fw/facts.mjs frameWait): carried as data by the votes of the map from E139, it went to a wrong word on E134
// (0x60041658 by 8 of 12 votes, where E134's open waits on 0x6004172e, D 0x50211247; X, bin/port.mjs). S-DISPQ's
// DISPLAY sends, once the knob dispq_send_returns, are read by a rule too (src/fw/facts.mjs displaySends): E144's did
// not carry to E134 or E137 (the call before it is not paired, carryKnob, X).
//   entry   a function's entry: the paired calls to it, or the walks' pairing of its first byte
//   return  a call's return address: the call before it paired by the walks, and the target's call there going to the
//           pair of the reference's callee
import { CODE_BASE } from './xmap.mjs';
import { callAt } from './facts.mjs';

export const KNOBS = {
  // menu.mjs K-CFLUSH: return addresses
  cflush_returns: (v, carry) => v.map((at) => carry('return', at)),
  // camapp.mjs S-SETSAVE: {fn, returns}
  block_save: (v, carry) => ({ fn: carry('entry', v.fn), returns: v.returns.map((at) => carry('return', at)) }),
};

// the addresses a knob's value holds (a chained port seeds its map with them)
export function knobAddresses(name, value) {
  const out = [];
  KNOBS[name](value, (kind, at) => { out.push(at); return at; });
  return out;
}

// the call ending at a return address ra (disassembly notation) in img (src/fw/facts.mjs callAt): {site, callee}, both
// in the disassembly notation, or null
function callBefore(img, ra) {
  for (const n of [7, 5, 6, 4]) { const c = callAt(img, ra - n - CODE_BASE); if (c?.len === n) return { site: ra - n, callee: CODE_BASE + c.to }; }
  return null;
}

// A knob's value taken from the reference's build (a, its run-time image) to the target's (b) through map (a -> b) and
// mapPlace (src/fw/place.mjs, the same map). Throws, naming the knob and the address, where a check fails.
export function carryKnob(name, value, { a, b, map, mapPlace }) {
  if (!Object.hasOwn(KNOBS, name)) throw new Error(`carryKnob: ${name} is not a carried knob (src/fw/knobs.mjs KNOBS)`);
  const h = (v) => '0x' + (v >>> 0).toString(16);
  // a function's entry as mapPlace pairs code: the paired calls to it, then the walks' pairing of its first byte (or
  // that pairing snapped to the called entry before it, code-entry)
  const fnPair = (at) => { const p = mapPlace(at); return ['code', 'code-entry', 'calls'].includes(p?.how) ? p.to : null; };
  const fail = (at, why) => { throw new Error(`carryKnob: ${name} ${h(at)}: ${why}`); };
  return KNOBS[name](value, (kind, at) => {
    if (kind === 'entry') return fnPair(at) ?? fail(at, 'the function is not paired');
    if (kind === 'return') {
      const c = callBefore(a, at); if (!c) fail(at, 'no call ends there in the reference');
      const o = map.code[c.site - CODE_BASE];
      if (!(o >= 0)) fail(at, `the call at ${h(c.site)} is not paired`);
      const t = callAt(b, o), want = fnPair(c.callee);
      if (!t || CODE_BASE + t.to !== want) fail(at, `the paired call at ${h(CODE_BASE + o)} ${t ? `goes to ${h(CODE_BASE + t.to)}` : 'is not a call'}, the pair of the reference's callee ${h(c.callee)} is ${want === null ? 'none' : h(want)}`);
      return CODE_BASE + o + t.len;
    }
    throw new Error(`carryKnob: ${name}: kind ${kind}`);
  });
}
