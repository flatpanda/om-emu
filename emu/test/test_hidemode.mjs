// The hidden service screens (docs/hle-gaps/4.6.md 4.6.5; src/lab/play.mjs H-STARTKEY):
//   hideModeSite     (firmware) the MENU state step's site in USTART5 read by its instructions (startKeySite) on E143:
//                    MENU's code 0x0089, the camera state kind 0x2751, the key state read 0x5014c015 and the write
//                    0x5004188b; and a byte of the site changed is refused with its offset (the control).
//   hideModeSession  (firmware, E143) a session with --held menu: H-STARTKEY in use and property 4519 at 0 after the
//                    start, MENU, Setup's page 3, Monitor Adjust, OK, INFO, OK reaches SS_MENU_MAIN/ID_ST_HIDE_MODE,
//                    UP, DOWN, LEFT, RIGHT, S2, UP and RIGHT keep it (PAGE 1, PAGE 2); no poke. The control: the same
//                    keys without the hold leave 4519 at 1 (written by the step) and OK goes back to the menu.
//   mecCountSites    (firmware) H-MECCOUNT's sites (src/lab/mec.mjs mecCountSite) on E143, E146 and E147: the
//                    mechanism driver's counter init read and step, kind 0x8344 and the counter word each body's own
//                    (D: a byte scan of the three images); on E143 a changed byte of the step is refused (the control).
//   mecCountSession  (firmware, E143) with --held menu three S2 shots step the count to 3 (the camera state kind
//                    0x8344, PAGE 2's MS row); and under S-NVRAM on a file of its own two shots and the power-off,
//                    then a restart: the init's read finds 2 (store E saved by the native power-off), where two shots
//                    without the power-off keep nothing (the control: the session closed, the next one reads 0).
//   node emu/test/test_hidemode.mjs [--session] [--mec]   (exit 1 on a failure; --mec: the sites alone)
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
const HIDE = 'SS_MENU_MAIN/ID_ST_HIDE_MODE', MENU = 'SS_MENU/ID_ST_MENU';
// MENU, two pages right to the Setup tab's page 3, DOWN to Monitor Adjust, OK, INFO (the colour page), OK
const TO_OK = ['menu', 'right', 'right', 'down', 'ok', 'info', 'ok'];
const CODE = ['up', 'down', 'left', 'right', 's2', 'up', 'right'];

export async function hideModeSite() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, IMAGE_BASE } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad };
  const { loadImage } = await import('../bin/run.mjs');
  const { imageView } = await import('../src/fw/image.mjs');
  const { startKeySite, START_KEY_SITE } = await import('../src/lab/play.mjs');
  const img = loadImage();
  const site = startKeySite(imageView(img, IMAGE_BASE, MODEL));
  ok(!site.why && site.code === 0x89 && site.kind === 0x2751 && site.key_state === 0x5014c015 && site.write === 0x5004188b && site.read === 0x500417da,
    `E143: the MENU state step reads ${JSON.stringify(site)}, want code 0x89, kind 0x2751, 0x5014c015, 0x5004188b, 0x500417da`);
  const c = img.slice(), off = START_KEY_SITE - 0x50000000 + 15;
  c[off] = 0x05;                                          // `clr d1` (04) made `clr d2`
  const changed = startKeySite(imageView(c, IMAGE_BASE, MODEL));
  ok(/byte \+15 is 0x5, not 0x4/.test(changed.why ?? ''), `E143: a changed byte at ${h8(START_KEY_SITE + 15)} is refused (${changed.why ?? 'read as a site'})`);
  return { checks, bad };
}

export async function hideModeSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad };
  const { openSession } = await import('../host/session.mjs');
  for (const held of [true, false]) {
    const tag = held ? '--held menu' : 'no hold';
    const s = await openSession(held ? { held: ['menu'] } : {});
    try {
      const step = (t) => { const r = s.step(t); if (!r.ok) throw new Error(`${tag}: ${t}: ${r.error}`); return r; };
      ok(s.player.stand_ins_in_use().includes('H-STARTKEY'), `${tag}: H-STARTKEY in use`);
      const v = step('setting:4519').setting.value;
      ok(v === (held ? 0 : 1), `${tag}: property 4519 reads ${v} after the start, want ${held ? 0 : 1}`);
      let last = null;
      for (const t of TO_OK) last = step(t);
      ok(last.gui === (held ? HIDE : MENU), `${tag}: Monitor Adjust's OK leads to ${last.gui}, want ${held ? HIDE : MENU}`);
      if (held) {
        const after = CODE.map((t) => step(t).gui);
        ok(after.every((g) => g === HIDE), `${tag}: the code's keys and RIGHT stay in ${HIDE} (${after.join(', ')})`);
      }
      ok(s.pokes === undefined || s.pokes.length === 0, `${tag}: no poke`);
    } finally { s.close?.(); }
  }
  return { checks, bad };
}

// H-MECCOUNT's sites by body (D: the bytes found by a scan of each image for the init's read and the step)
const MEC_SITES = {
  E143: { read_site: 0x5010f00f, step: 0x5010f8fe, counter: 0x6296597c },
  E146: { read_site: 0x5010f00f, step: 0x5010f8fe, counter: 0x6298f174 },
  E147: { read_site: 0x50118fb7, step: 0x501198a6, counter: 0x6298ec4c },
};
export async function mecCountSites() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL, IMAGE_BASE } = await import('../src/fw/model.mjs');
  const want = MEC_SITES[MODEL];
  if (!want) return { checks, bad };
  const { loadImage } = await import('../bin/run.mjs');
  const { imageView } = await import('../src/fw/image.mjs');
  const { mecCountSite, MEC_COUNT_STEP } = await import('../src/lab/mec.mjs');
  const img = loadImage();
  const site = mecCountSite(imageView(img, IMAGE_BASE, MODEL));
  ok(!site.why && site.kind === 0x8344 && site.read_site === want.read_site && site.step === want.step && site.counter === want.counter && site.frame?.join() === '0,4',
    `${MODEL}: the MS counter's sites read ${JSON.stringify(site)}, want kind 0x8344, ${h8(want.read_site)}, ${h8(want.step)}, ${h8(want.counter)}, frame [0, 4]`);
  if (MODEL === 'E143') {
    const c = img.slice(), off = MEC_COUNT_STEP - 0x50000000 + 12;
    c[off] = 0x44;                                        // `inc a1` (45) made `inc a0`
    const changed = mecCountSite(imageView(c, IMAGE_BASE, MODEL));
    ok(/byte \+12 is 0x44, not 0x45/.test(changed.why ?? ''), `E143: a changed byte at ${h8(MEC_COUNT_STEP + 12)} is refused (${changed.why ?? 'read as a site'})`);
  }
  return { checks, bad };
}

export async function mecCountSession() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };
  const { MODEL } = await import('../src/fw/model.mjs');
  if (MODEL !== 'E143') return { checks, bad };
  const { openSession } = await import('../host/session.mjs');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const kind = (s) => { const r = s.step('call:0x500417da:d0=0x8344'); return r.ok ? Number(r.d0) : `refused: ${r.error}`; };
  const shots = (s, n, tag) => { for (let i = 0; i < n; i++) for (const t of ['s2', 'wait:1500']) { const r = s.step(t); if (!r.ok) throw new Error(`${tag}: ${t}: ${r.error}`); } };
  // PAGE 2's MS row after three shots, with MENU held for the hidden screens (4.6.5's recipe)
  {
    const s = await openSession({ held: ['menu'] });
    try {
      ok(s.player.stand_ins_in_use().includes('H-MECCOUNT'), '--held menu: H-MECCOUNT in use');
      shots(s, 3, '--held menu');
      const k = kind(s);
      ok(k === 3 && s.player.session.mec.status().steps === 3, `--held menu: three S2 shots leave kind 0x8344 at ${k} (${JSON.stringify(s.player.session.mec.status())}), want 3`);
      let last = null;
      for (const t of [...TO_OK, ...CODE]) { last = s.step(t); if (!last.ok) throw new Error(`--held menu: ${t}: ${last.error}`); }
      ok(last.gui === HIDE && kind(s) === 3, `--held menu: PAGE 2 (${last.gui}) with kind 0x8344 at ${kind(s)}, want ${HIDE} and 3 (the code's S2 in the hidden screen counts nothing)`);
    } finally { s.close?.(); }
  }
  // S-NVRAM: the count over a power cycle, and the control without the power-off
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-mec-'));
  try {
    for (const off of [true, false]) {
      const tag = off ? 'power:off' : 'no power-off', file = path.join(dir, `nv-${off ? 'off' : 'pull'}.json`);
      const s = await openSession({ nvram: file });
      try {
        shots(s, 2, tag);
        ok(kind(s) === 2, `${tag}: two shots leave kind 0x8344 at ${kind(s)}, want 2`);
        if (off) {
          const p = s.step('power:off');
          ok(p.ok, `${tag}: ${p.error}`);
          const r = s.step('restart');
          ok(r.ok, `${tag}: restart: ${r.error}`);
          const st = s.player.session.mec.status();
          ok(st.read === 2 && kind(s) === 2, `${tag}: after the restart the init's read finds ${st.read}, kind 0x8344 ${kind(s)}, want 2`);
        }
      } finally { s.close?.(); }
      if (!off) {
        const s2 = await openSession({ nvram: file });
        try {
          const st = s2.player.session.mec.status();
          ok(st.read === 0, `${tag}: the next session's init read finds ${st.read}, want 0 (store E not saved without the power-off)`);
        } finally { s2.close?.(); }
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--mec')) {
    const { MODEL } = await import('../src/fw/model.mjs');
    const m = await mecCountSites();
    console.log(`the MS counter's sites on ${MODEL}: ${m.checks - m.bad.length}/${m.checks}`);
    m.bad.forEach((x) => console.log('  ', x));
    process.exit(m.bad.length ? 1 : 0);
  }
  const { MODEL } = await import('../src/fw/model.mjs');
  const i = await hideModeSite();
  console.log(`the hidden screens' MENU state step on ${MODEL}: ${i.checks - i.bad.length}/${i.checks}`);
  i.bad.forEach((x) => console.log('  ', x));
  const m = await mecCountSites();
  console.log(`the MS counter's sites on ${MODEL}: ${m.checks - m.bad.length}/${m.checks}`);
  m.bad.forEach((x) => console.log('  ', x));
  let fail = i.bad.length + m.bad.length;
  if (process.argv.includes('--session')) {
    const s = await hideModeSession();
    console.log(`the hidden screens in a ${MODEL} session: ${s.checks - s.bad.length}/${s.checks}`);
    s.bad.forEach((x) => console.log('  ', x));
    const c = await mecCountSession();
    console.log(`the MS count in ${MODEL} sessions: ${c.checks - c.bad.length}/${c.checks}`);
    c.bad.forEach((x) => console.log('  ', x));
    fail += s.bad.length + c.bad.length;
  }
  process.exitCode = fail ? 1 : 0;
}
