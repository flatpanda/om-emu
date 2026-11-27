// S-DISPSYNC's two halves, shared by the camera application's stand-in in play (src/lab/camapp.mjs, which has the
// stand-in's text) and nav's bring-up (src/lab/nav.mjs NavSession dispsync_install / dispsync_release): the observer
// of the display manager's request that marks a device with a synced update waiting, and the release of one device.
// The functions are the fact 'display.sync''s (src/fw/facts.mjs displaySync, which has the evidence).
import { fact } from '../fw/model.mjs';
import { DISPLAY_SYNC_E143 } from '../fw/facts.mjs';
import { unpack } from '../util/bytes.mjs';

// The request type that waits for an image sync; the release's sync-word store (its value; the panels' d1 values, as
// stopRecView passes them, and the image sync's kind, the one the type-3 request's pending state takes, are the
// fact's, displaySync's comment) and image-event flag (a0, as stopRecView passes it). On E120's record form (the
// fact's record) the request's type and device code and the release's code and device are fields of the record a0
// points to, and the synced type is the record's
export const DISPSYNC_REQUEST = 3, DISPSYNC_OFF = 0, DISPSYNC_IMAGE = 1, DISPSYNC_RECORD = 8;

// The build's display sync functions: {request, image_sync, sync_set, kind, panels, record?}, or undefined where the
// rule reads none
export const dispsyncFacts = () => fact('display.sync', DISPLAY_SYNC_E143);

// Observes the request: add(code) for each synced request (its device code); name is the observer's label
export function observeDispsync(lab, sync, add, name = 'S-DISPSYNC') {
  const rec = sync.record;
  lab.observe(sync.request, (l, r) => {
    const [type, code] = rec ? [unpack('<H', l.sim.read(r.a0 + rec.type, 2))[0], l.sim.u32(r.a0 + rec.device)] : [r.d0 >>> 0, r.d1 >>> 0];
    if (type === (rec?.synced ?? DISPSYNC_REQUEST)) add(code);
  }, name);
}

// One release of device code: both panels' sync words cleared through the application's setter, then the image sync
// of the fact's kind for the device (its record on the record form). The caller settles after it
export function releaseDispsync(lab, sync, code) {
  const { sync_set: set, image_sync: image, kind, panels, record: rec } = sync;
  for (const panel of panels) lab.call(set, { d0: DISPSYNC_OFF, d1: panel }, null, null, 2000);
  if (rec) {
    const b = new Uint8Array(DISPSYNC_RECORD), dv = new DataView(b.buffer);
    dv.setUint16(rec.code_at, rec.code, true); dv.setUint32(rec.device_at, code, true);
    lab.call(image, { a0: lab.alloc(b, 4) }, null, null, 2000000);
  } else lab.call(image, { d0: kind, d1: code, a0: DISPSYNC_IMAGE }, null, null, 2000000);
}
