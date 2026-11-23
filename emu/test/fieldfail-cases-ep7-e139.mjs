// Field-failure regression cases for the E-P7 (E142) and the E-M1 Mark III (E139): patched firmware that failed on a
// real camera, paired with the build that fixed it. The corpus rule (borrowed from caduceus-om3's `--without BUILD`):
// the lab must CATCH the bad build (a named detector fires) and the fixed build must PASS the same scenario. A case
// the lab cannot catch yet is a known miss: it carries the capabilities it still needs (`needs`, checked at run time,
// so the case turns live when they are merged) or, where nothing the lab could add would do, a permanent `blocked`
// reason (a bad build that was never published). emu/FIDELITY-NOTES.md 7.23 records each miss.
//
// test_fieldfail.mjs imports this file when it is present; test_fieldfail_cases.mjs checks the shape and the pins.
//
// Sources (facts only; nothing of theirs is in this tree):
//   cakelesscoder/caduceus-ep7 (Apache-2.0): issue #48, CHANGELOG.md, docs/FIRMWARE_GUIDE.md section 10,
//     docs/FILM_DOWN_CRASH.md, docs/SD_V2_CRASH.md, docs/GRAIN_PORT.md, WORKLOG.md; release folders releases/<tag>/
//     (an edit list `edits.json` with stock `expect` bytes, `build.json`, `SHA256SUMS`, card files). Their GitHub
//     releases carry no assets: the folder at the commit that added it is the release.
//   dfeldt91-blip/E-M1-Miii (no LICENSE: facts only, cited): docs/ART_FILTERS.md "White frame for picture modes",
//     commits 344cd4b and 7fc28da, builder/mods.json.
//
// A build: {project, tag, commit, src, asset, sha256, files?, select?, unpublished?}
//   project  the folder under ~/.om-emu/thirdparty (OM_THIRDPARTY, as test_fieldfail.mjs, or OM_EMU_THIRDPARTY overrides the root)
//   tag      the release (a git tag, or the release folder's name where they made no tag), also the sub-folder
//   commit   the upstream commit the files are pinned at; src the path of `asset` in that commit
//   asset    the file the loader reads, relative to the tag folder; sha256 its pin (null only with `unpublished`)
//   files    other pinned files of the release (card files and the release's own records), {rel: sha256}
//   select   for a mod pack, the mods to apply
//   unpublished  why there are no bytes to pin (the build was made and flashed but never released)
// fetch: curl -fsSL -o <root>/<project>/<tag>/<rel> https://raw.githubusercontent.com/<owner>/<repo>/<commit>/<dir>/<rel>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EP7 = 'https://github.com/cakelesscoder/caduceus-ep7';
const EM1 = 'https://github.com/dfeldt91-blip/E-M1-Miii';

// v0.33 and v0.33a ship the same four card files (their SHA256SUMS)
const EP7_CARD_V033 = {
  'card/EP7MOD/AP.BIN': 'bc2039a49bd90acc6a241f1b24afdf85b3b2349c0004de4403592c2afb0c0a95',
  'card/EP7MOD/BUNDLES.BIN': 'e87e4d31404c11f2749f77af3eff9272ba2431fed79813ef416037deac571420',
  'card/EP7MOD/LOOKS.BIN': '188b79501ebd13c9e0c525e2495d8786eb9e64945d81ef5a822b463da0eb89f5',
  'card/EP7MOD/MOVIE.BIN': '53cb9bcb29343efdf8b874d87afe238178d5d04071aa35c6c526fdbac202e21a',
};
const EP7_CARD_PUT = Object.keys(EP7_CARD_V033).map((rel) => `${rel.replace(/^card\//, '')}=${rel}`);

export const CASES = [
  {
    id: 'ep7-48-flash-init-word',
    body: 'E142',
    title: 'Caduceus E-P7 #48: the Film label read a .data init-image word in flash after the boot copy, read 0, PC 0',
    links: [
      `${EP7}/issues/48`,
      `${EP7}/releases/tag/v0.33`,
      `${EP7}/releases/tag/v0.33a`,
      `${EP7}/blob/main/docs/FILM_DOWN_CRASH.md`,
      `${EP7}/blob/main/CHANGELOG.md`,
    ],
    bad: {
      project: 'caduceus-ep7', tag: 'v0.33', commit: '599b0870f374637343a6b20cac1ae8021e1f859e',
      src: 'releases/v0.33/edits.json', asset: 'edits.json',
      sha256: '26de9edf21b7477b83f53a95e408e19517c697751519a5a54354343bc0927c92',
      files: {
        'build.json': '6e663d5e48a499ed4817c60dc5b6929fa00e5ccdd62cce690783318c2437813b',
        'SHA256SUMS': '9973dc4e63c4f5c270895fbec882b490295e538c88893d968f483c0671d5cb86',
        ...EP7_CARD_V033,
      },
    },
    fixed: {
      project: 'caduceus-ep7', tag: 'v0.33a', commit: '1ba251b9d01a95fc59998bb9fe26c5d0bf942d7b',
      src: 'releases/v0.33a/edits.json', asset: 'edits.json',
      sha256: '0d2766c9966a9d9eb47f1e1f61d79286eee7829daf303ab33b17e9ac7ca81a9d',
      files: {
        'build.json': '5d9b2d088845b0fd248a4b923f1ab86cecd83d0664a7e01bf2bf24a3ede16847',
        'SHA256SUMS': 'bfaec35ba509d39b5c02d81ab1665f49832ee1aafab8f7ffbc163bdf04818e2c',
        ...EP7_CARD_V033,
      },
    },
    loader: 'edits-json',
    // card files put under C:\EP7MOD from the build's folder (both builds ship the same four)
    card_put: EP7_CARD_PUT,
    // the owner's repro (FILM_DOWN_CRASH.md): power on, half-press (the card loader runs and the looks load), the
    // Shortcut button opens the Colour Profile page, Down (or Up three times) reaches the colour wheel, page 1, whose
    // guide label v0.32+ draws through sn_gd. The lab's blank camera opens the page on MONO (the stock MONO guide label
    // 0x60e27209 runs at Down); Left first takes it to the COLOR page the owner's camera showed, whose Down runs the
    // patched label site 0x60e2757d and jumps to sn_gd 0x61242c40 (X, 2026-11-23, both builds)
    scenario: ['wait:4500', 's1', 'wait:1500', 'shortcut', 'wait:500', 'left', 'wait:500', 'down', 'wait:1500'],
    pending_tokens: {},
    detector: 'strict-flash-init',
    detector_alt: ['crash'],
    expect: {
      bad: 'caught',
      fixed: 'pass',
      site: { read: 0x6025aa98, live_copy: 0x61fc27d8, crash_pc: 0 },
      camera_bad: 'CRASH.BIN: FATAL_SYSTEM_ERROR MEM, CPU0, PC 0; stack +8 = sn_gd+0x5c; sn_gd read the guide chain ' +
        'from the part table\'s flash init word 0x6025aa98, which held 0 at run time; freeze and restart, sometimes a ' +
        'battery pull (issue #48, v0.32 to v0.33)',
      camera_fixed: 'v0.33a reads the live .data copy 0x61fc27d8 (part table 0x61fc27d0 + 8) and keeps the stock label ' +
        'when it is 0; owner: Shortcut, Down, repeatedly, no crash, the Film label shows',
    },
    // om-emu keeps the whole image in DRAM from the reset (FIDELITY-NOTES 7.18), so the word reads its patched value
    // as in their flat-image emulator: only a strict mode that flags a read of a flash init-image word after the boot's
    // .data copy catches it. sn_gd reads the SD loader's state u16 0x622cbcc2 first (movhu at 0x61242c5a, add -1,
    // cmp 0xa941, bcc at 0x61242c68 to the stock label at 0x61242cb5) and keeps the stock label while it is 0; the
    // loader v3 (0x605b7400) leaves it 0 unless E142's copied mask 0xa272e420 has bits 0 to 8 set at S1 (and 511 /
    // cmp 511 / bne at 0x605b742b), the gate test 7a stops at. With the Shortcut input alone the case ran missed (X,
    // 2026-11-23); with S-SECLOADED setting the mask the looks load, the init-word read at 0x61242c94 runs, and
    // --strict reports it as init-read (X, 2026-11-23)
    needs: ['edits-json', 'strict-flash-init', 'key:shortcut'],
  },
  {
    id: 'ep7-test7a-section3-store',
    body: 'E142',
    title: 'Caduceus E-P7 test 7a: the SD loader\'s byte store into section-3 RAM crashed at the first half-press',
    links: [
      `${EP7}/blob/main/docs/SD_V2_CRASH.md`,
      `${EP7}/blob/main/docs/FIRMWARE_GUIDE.md#10-safety-lessons`,
      `${EP7}/blob/main/WORKLOG.md`,
      `${EP7}/tree/f0bdb34101ce10868da0566eaa39e6ace7d6166c/releases/test7-sdloader`,
      `${EP7}/tree/f5ddeb0906153c239745d1f833a7fe74dc0be9de/releases/test7b-sdloader-v3`,
    ],
    bad: {
      project: 'caduceus-ep7', tag: 'test7-sdloader', commit: 'f0bdb34101ce10868da0566eaa39e6ace7d6166c',
      src: 'releases/test7-sdloader/edits.json', asset: 'edits.json',
      sha256: 'f706371abd820314446d486d5456fba79a8cca7529bef6cf8abcdd97994db419',
      files: {
        'build.json': '51c14a944c8adaa5649dd6f4635347d3596eddd2b67019cf4aa7d2079e3ba01d',
        'SHA256SUMS': '7c9f9154303cd0d76c9863602cc13240da5421f8c9e6356efaa53701be832f77',
      },
    },
    // test 7b (SD loader v3: state at 0x622cbcc2, no image-region stores) passed the same step on the camera; probe
    // P2 (the same gate path with only the store moved to 0x622cbcc2) passed first and is the narrower contrast
    fixed: {
      project: 'caduceus-ep7', tag: 'test7b-sdloader-v3', commit: 'f5ddeb0906153c239745d1f833a7fe74dc0be9de',
      src: 'releases/test7b-sdloader-v3/edits.json', asset: 'edits.json',
      sha256: '9fe55e244e2b30a4db055fedc361fa607689eb9fc397c07d93952606ff7ac7f8',
      files: {
        'README.md': '3811f9caa1f75f69bd8ec3d713468195aed49658aac16865e09970bc73d4cc18',
        'SHA256SUMS': 'a7013eb78fe698f81dec4e25e2ca527cb6c18e265cb6ab01c20527152912418a',
      },
    },
    also_fixed: {
      project: 'caduceus-ep7', tag: 'probe-P2', commit: 'f84ef148303f9f67b8a9d1c99dc5d152b8326537',
      src: 'releases/probe-P2/edits.json', asset: 'edits.json',
      sha256: 'c5be15c33d5a19cfd5eaa06ea957b0471c116084e9ee2414458cb62313aac726',
      files: {
        'README.md': '7393487f25da76202a476b6b1cd06df24c6f8e7ac38babf4532020e6d2ccf567',
        'SHA256SUMS': 'ff472020e391405537d90e6b5e3ed56ede34fae33b0774e012c14f4a680b561f',
      },
    },
    loader: 'edits-json',
    card_put: [],
    // card in and mounted, no EP7MOD folder (both camera runs); boot, then the first shutter half-press
    scenario: ['wait:4500', 's1', 'wait:1500', 's1', 'wait:1500'],
    pending_tokens: {},
    detector: 'strict-image-write',
    detector_alt: [],
    expect: {
      bad: 'caught',
      fixed: 'pass',
      site: { pc: 0x605b7484, store: 0x605b7692, section: 3, section_range: [0x6057b200, 0x605b7800] },
      camera_bad: 'boots; crash and immediate restart on the first shutter half-press (card mounted, no EP7MOD). ' +
        'The first non-stack store on the path is movbu d0,(0x605b7692) at 0x605b7484, into section-3 RAM; probe P2 ' +
        '(store moved to .bss 0x622cbcc2) passed, so the crash is attributed to that store (probe P1 was not flashed)',
      camera_fixed: 'test 7b step A: loader v3 and a half-press with no EP7MOD, no issues; step B loaded BUNDLES.BIN',
    },
    // RAM is RAM in the lab: a store into a loaded section succeeds, as in their emulator; --strict reports it
    // (image-store). The loader stores only once E142's word 0xa272e420 has bits 0 to 8 set ((word & 0x1ff) ==
    // 0x1ff at 0x605b742b): that word is the section loader's copied mask (load_section 0x500257c7 ORs bit n - 1
    // in after section n's copy, nine sections; the stages' ready word is 0xa272e41c), which S-SECLOADED sets
    // since 2026-11-23 (src/fw/facts.mjs sectionLoader's flash-copy form; before, the word read 0 after the half
    // press and the store was never reached, X)
    needs: ['edits-json', 'strict-image-write'],
  },
  {
    id: 'ep7-grain-s1-misaligned',
    body: 'E142',
    title: 'Caduceus E-P7 grain s1: opening Extras crashed on a misaligned word read at 0x601e356c',
    links: [
      `${EP7}/blob/main/docs/GRAIN_PORT.md`,
      `${EP7}/blob/main/docs/FIRMWARE_GUIDE.md#10-safety-lessons`,
      `${EP7}/tree/13657058ebbde8fd9c547ba9b675fc93f4d8bbf1/patches/grain_cpu`,
      `${EP7}/releases/tag/v0.27`,
    ],
    bad: {
      project: 'caduceus-ep7', tag: 'grain-s1', commit: '13657058ebbde8fd9c547ba9b675fc93f4d8bbf1',
      src: null, asset: null, sha256: null,
      unpublished: 'grain s1 was a camera test build made by patches/grain_cpu/build_s1.py (present at v0.27\'s commit) ' +
        'and never released; its edit list is in no commit, and s2 (s1 plus .balign 4 before gc_t1) is not either',
    },
    // the nearest published descendant: v0.27 carries the grain_cpu line (its edits name "grain_cpu s1" words and the
    // v0.27 grain block at 0x601dfc3c) and 0x601e356c lies in its look-extras block 0x601e323c (1308 B); that its data
    // is aligned there is their fix's claim, not checked here
    fixed: {
      project: 'caduceus-ep7', tag: 'v0.27', commit: '13657058ebbde8fd9c547ba9b675fc93f4d8bbf1',
      src: 'releases/v0.27/edits.json', asset: 'edits.json',
      sha256: '0d47da0587640d5af3bdb333a0de90e8698a63d7172ca3f8796bce3b38481ea8',
      files: { 'build.json': '1247caf925b08af9a7a65360ad49f746263e0986f90fcbcf1ccfa7c0b18a1c14' },
    },
    loader: 'edits-json',
    card_put: [],
    // "opening Extras": the look editor's Extras stop (INFO cycles S, L, H, X on the colour editor); the exact key
    // path on s1 is not recorded. Left takes the blank camera's Colour Profile page from MONO to COLOR, as in #48
    scenario: ['wait:4500', 's1', 'wait:1500', 'shortcut', 'wait:500', 'left', 'wait:500', 'info', 'info', 'info', 'info', 'wait:1500'],
    pending_tokens: {
      info: 'the INFO count to the Extras stop on s1 is not recorded',
    },
    detector: 'strict-misaligned',
    // om-emu's CPU already raises alignment fault 3 on a misaligned word or halfword load (emu/src/core/mem.mjs), so
    // the bad build, if it existed, would also stop as a crash
    detector_alt: ['crash'],
    expect: {
      bad: 'caught',
      fixed: 'pass',
      site: { addr: 0x601e356c },
      camera_bad: 'opening Extras crashed on a misaligned word read at 0x601e356c (FIRMWARE_GUIDE.md section 10 #3); ' +
        'whether 0x601e356c is the pc or the data address is not stated',
      camera_fixed: 's2 (s1 + .balign 4 before gc_t1): Extras and the +50 save work (GRAIN_PORT.md "s2 camera result")',
    },
    needs: ['edits-json', 'strict-misaligned', 'key:shortcut'],
    blocked: 'the bad build (grain s1) was never published: no bytes to pin or run',
  },
  {
    id: 'e139-test1727-art-chain',
    body: 'E139',
    title: 'E-M1 III Mod Builder test 1.727: picture-mode photos sent to the art chain builder crash and reboot',
    links: [
      `${EM1}/blob/master/docs/ART_FILTERS.md#white-frame-for-picture-modes-test-1722`,
      `${EM1}/commit/344cd4b34660b3c17b878609ea6c8d854a5eb646`,
      `${EM1}/commit/7fc28da60c248ec652c72571fd0d62530d0542e0`,
      `${EM1}/commit/12cea8ff2a9cfc1fa25ad361130df2d4550144c4`,
      `${EM1}/releases/tag/mod-builder-1.19`,
    ],
    bad: {
      project: 'E-M1-Miii', tag: 'test-1.727', commit: '344cd4b34660b3c17b878609ea6c8d854a5eb646',
      src: null, asset: null, sha256: null,
      unpublished: 'test 1.727 was built by tools/patch_frame_switch.py on test 1.719 and flashed; no .BIN or edit ' +
        'list was published, the frame switch never entered builder/mods.json, and the repository has no LICENSE, ' +
        'so its tool is not run here',
    },
    // the author's next build, 1.728, is 1.709 plus the art gradation without the frame and Bleach experiments; the
    // published pack's art_gradation mod is that line
    fixed: {
      project: 'E-M1-Miii', tag: 'mod-builder-1.19', commit: 'ba87b5f4358b6ee518cf133676d69698db6ef83e',
      src: 'builder/mods.json', asset: 'mods.json',
      sha256: '51c0ce2dfd0d7326099ab237bd1dfea4ce95638c99b9071ad36c5490ab7036b8',
      select: ['art_gradation'],
    },
    loader: 'mods-json',
    card_put: [],
    // on 1.727 the SCP Color Space item is the Frame switch (setting 0x3c, E139's MODE_COLOR_RGB): on = Adobe RGB.
    // Then a photo in a picture mode (Natural, the default). With the switch off (sRGB) the same build did not crash.
    // The value 1 for Adobe RGB is not read from the firmware.
    scenario: ['wait:4500', 'SET:MODE_COLOR_RGB=1', 's2', 'wait:3000'],
    pending_tokens: {},
    detector: 'crash',
    detector_alt: [],
    expect: {
      bad: 'caught',
      fixed: 'pass',
      site: { chain_dispatch: 0x603816c5, picture_builder: 0x60395eb9, art_chain_builder: 0x60384438 },
      camera_bad: 'switch on (Adobe RGB) + a Natural photo: crash and reboot; switch off (sRGB): no crash. The art ' +
        'chain builder 0x60384438 cannot take a picture-mode job as it is (ART_FILTERS.md, test 1.727)',
      camera_fixed: '1.728 (no frame switch) was flashed and used for the gradation tests that followed',
    },
    // the crash is in the still job's image chain on S2, which the lab does not build on E139 (S-JPEGENC stands in for
    // the image library's run, FIDELITY-NOTES 7.9)
    needs: ['mods-json', 'e139-still-chain'],
    blocked: 'the bad build (test 1.727) was never published: no bytes to pin or run',
  },
];

export default CASES;

// ---- run-time capability check -----------------------------------------------------------------------------------
// A capability counts as present when a dedicated probe below finds it in the lab's sources (emu/src, emu/host,
// emu/checks, emu/bin; not the tests), else when a lab module names it as a string literal. The detectors and loaders
// are probed by what test_fieldfail.mjs's CAPABILITIES (fieldfail-cases.mjs) probe: a strict detector by its class in
// src/lab/strict.mjs STRICT_CLASSES, section-ready by src/lab/secready.mjs SEC_READY_CLASSES, the loaders by
// src/fw/patch.mjs's readers. 'crash' (a CPU fault, a trap or a reset stopping the session) is the lab's own.
const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const LAB_DIRS = ['src', 'host', 'checks', 'bin'];
let labText = null;
function labSources() {
  if (labText !== null) return labText;
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  for (const d of LAB_DIRS) walk(path.join(EMU, d));
  labText = out.join('\n');
  return labText;
}
const named = (name) => new RegExp(`['"\`]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(labSources());
const listed = (list, name) => new RegExp(`export const ${list} = \\[[^\\]]*'${name}'`).test(labSources());

const PROBES = {
  crash: () => true,
  'edits-json': () => /function readEdits\(/.test(labSources()),
  'mods-json': () => /function readMods\(/.test(labSources()),
  'section-ready': () => listed('SEC_READY_CLASSES', 'ungated-branch') && listed('SEC_READY_CLASSES', 'unready-run'),
  'strict-misaligned': () => listed('STRICT_CLASSES', 'misaligned'),
  'strict-image-write': () => listed('STRICT_CLASSES', 'image-store'),
  'strict-flash-init': () => listed('STRICT_CLASSES', 'init-read'),
  // an input row named shortcut in the play runtime's controls (src/lab/play.mjs: UI_IN key 0x1224 on E142)
  'key:shortcut': () => /row\('shortcut'/.test(labSources()),
  // no probe can show these yet: fidelity steps, named when they land
  'e139-still-chain': () => named('e139-still-chain'),
};
export const CAPABILITIES = ['edits-json', 'mods-json', 'section-ready', 'strict-misaligned', 'strict-image-write',
  'strict-flash-init', 'crash', 'key:shortcut', 'e139-still-chain'];

export function capabilityPresent(name) {
  if (Object.hasOwn(PROBES, name)) return PROBES[name]();
  return named(name);
}
// what a case still lacks, and whether it can run: {live, missing, reason}
export function caseStatus(c) {
  const missing = [...new Set([...c.needs, c.detector])].filter((n) => !capabilityPresent(n));
  if (c.blocked) return { live: false, missing, reason: `xfail: ${c.blocked}${missing.length ? `; needs ${missing.join(', ')}` : ''}` };
  if (missing.length) return { live: false, missing, reason: `xfail: needs ${missing.join(', ')}` };
  return { live: true, missing, reason: null };
}

// the local copy of a pinned file: <root>/<project>/<tag>/<rel>
export const thirdpartyRoot = () => process.env.OM_THIRDPARTY || process.env.OM_EMU_THIRDPARTY || path.join(os.homedir(), '.om-emu', 'thirdparty');
export const buildPath = (b, rel = b.asset) => path.join(thirdpartyRoot(), b.project, b.tag, rel);
// every pinned file of a build: [[rel, sha256], ...]
export const buildPins = (b) => [...(b.asset ? [[b.asset, b.sha256]] : []), ...Object.entries(b.files ?? {})];
