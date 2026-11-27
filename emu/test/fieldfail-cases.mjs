// The field-failure corpus (emu/test/test_fieldfail.mjs): patched firmware that failed on a real camera, each case a
// bad build (the one that failed) and its fixed build (the one that did not), the scenario both run, and the detector
// that must fire on the bad build and stay quiet on the fixed one (the rule caduceus-om3's tools/test runner applies
// with --without BUILD: a test that passes on the unfixed build is MISSED). A case whose detector, loader or lab
// feature does not exist yet is a known miss (xfail), with the capability that would catch it named in `needs`;
// CAPABILITIES says how a run finds out whether each one exists, so the case turns live when it lands.
//
// No byte of a third-party build is here, nor in the repo: a 'release' build names its files by sha256 and the commit
// whose tree holds them; test_fieldfail.mjs --fetch puts them under $OM_THIRDPARTY (default ~/.om-emu/thirdparty)
// /<project>/<tag>/ and checks each digest. A 'source' build was never published (a camera test build): it names
// the commit and the build command, and the digest the project's notes give for it (a prefix and a suffix only, as
// their notes print it), so a build made by hand can be put at its path and recognised. A 'synthetic' build is made
// by the test from the stock block it runs (the self-control).
// caduceus-om3 (androidfanman/caduceus-om3) is Apache-2.0: the facts below (addresses, causes, dates, digests) are
// taken from its research/NOTES.md, release notes and issues, cited per case; no code or data of it is copied.
//
// A case: {id, body, title, sources [url...], camera (what the camera did, with its source), cause (what is known
// of why, and whether the camera or analysis showed it), detector, needs [capability...], scenario [token...]
// (host/session.mjs tokens; each build runs them in a fresh session), session (openSession options beyond patch/main),
// run_needs [capability...] (optional: needs without which the builds are not run, their run saying nothing), bad,
// fixed}; a build: {kind: 'release', project, tag, commit, files {name: sha256}, patch (the file given as
// --patch)} | {kind: 'source', project, commit, path (under $OM_THIRDPARTY), sha256_prefix, sha256_suffix, build
// (the command), main: true (given as --main)} | {kind: 'synthetic', make, ...its parameters}.

const CAD3 = 'https://github.com/androidfanman/caduceus-om3';

// The detectors and the other capabilities a case can name. kind 'detector' (fires on a run's observation), 'loader'
// (reads a build's file), 'lab' (a part of the camera the scenario needs). `now` true: present in this tree, always
// on. A detector of a report (the strict mode, --sec-ready) names its module, the export that lists its classes and
// the classes it fires on (a finding of one of them in the run's report: test_fieldfail.mjs observe, the summary's
// strict.findings and patch_audit.sec_ready.findings), and the session options that turn its report on, which both
// builds of a case whose detector it is run with. Otherwise probe(ctx) answers at run time whether it exists (ctx:
// importer, readPatchText). One place: fieldfail-cases-ep7-e139.mjs's PROBES look for the same exports.
export const CAPABILITIES = {
  // ---- detectors present now (test_fieldfail.mjs firedDetectors reads them off a run's observation)
  'lab-error': { kind: 'detector', now: true, what: 'a step (the open included) failed with a firmware or lab error: a CPU trap (pc 0, a bus error on an unmapped access, a misaligned access, an illegal instruction), code the boot does not load (S-STALERAM), a lab hook on patched bytes (the hook rule), a step that ran out of its instruction or stub budget (a hang), or another lab error' },
  hang: { kind: 'detector', now: true, what: "a step ran out of its budget (the lab's stand-in for a watchdog: 'more than N stub calls', insn-limit), or an expect:gui the scenario names was not reached (the screen never got there)" },
  'gui-not-reached': { kind: 'detector', now: true, what: 'an expect:gui token of the scenario failed' },
  audit: { kind: 'detector', now: true, what: "the session's patch audit lists a lab hook on patched bytes or a patched byte the boot does not load (summary.patch_audit hooks / unloaded)" },
  // ---- detectors of an opt-in report (src/lab/secready.mjs --sec-ready, src/lab/strict.mjs --strict)
  'section-ready': { kind: 'detector', what: "patched code entering a section before that section's ready bit (E147 0xa32de58c) is set: the boot-loop class of caduceus-om3's v0.20 test 1, crop round 7 and v0.40.3-beta2 (--sec-ready: an ungated branch into a later load tier, or a patched instruction run while its section's bit is clear)",
    module: '../src/lab/secready.mjs', export: 'SEC_READY_CLASSES', classes: ['ungated-branch', 'unready-run'], session: { secReady: true } },
  'strict-misaligned': { kind: 'detector', what: 'a misaligned access the camera faults on (--strict class misaligned; the CPU core faults it too)',
    module: '../src/lab/strict.mjs', export: 'STRICT_CLASSES', classes: ['misaligned'], session: { strict: 'on' } },
  'strict-image-write': { kind: 'detector', what: 'a store into the loaded code image (--strict class image-store)',
    module: '../src/lab/strict.mjs', export: 'STRICT_CLASSES', classes: ['image-store'], session: { strict: 'on' } },
  'strict-flash-init': { kind: 'detector', what: "a read of an init word at its source after the boot's copy (--strict class init-read)",
    module: '../src/lab/strict.mjs', export: 'STRICT_CLASSES', classes: ['init-read'], session: { strict: 'on' } },
  // ---- loaders (src/fw/patch.mjs readPatchText)
  'edits-json': { kind: 'loader', what: "caduceus-ep7's edits.json ({components, edits: [{kind, addr, expect, new}]})",
    sample: { components: ['0x100'], edits: [{ kind: '0x100', addr: '0x60021020', expect: '00', new: '01' }] } },
  'mods-json': { kind: 'loader', what: "E-M1-Miii's mods.json format 1 ({firmware, mods: [{id, edits: [[block, addr, hex]]}]})",
    sample: { format: 1, firmware: { name: 'x', sha256: '0'.repeat(64), size: 1 }, mods: [{ id: 'x', stock_sha256: '0'.repeat(64), edits: [[0, '0x60021020', '01']] }] } },
  // ---- lab features no branch is building
  'staged-load': { kind: 'lab', what: "the camera's staged section loading run in the lab (CPU 2's copies and per-section stage steps in the camera's order, stale RAM before a section's copy), so that patched code reaching a section before its load fails as on the camera. Without it --sec-ready's findings are a list to review, not a verdict: the camera-tested fixed builds have them too (X, 2026-11-23: 19 on v0.40-alpha, 20 on v0.40.3-beta3 against beta2's 22)",
    probe: null },
  'lv-magnify': { kind: 'lab', what: "the shooting screen's magnify (and MF assist) view: the camera application is a stand-in (S-CAMAPP), docs/hle-gaps/3.md 3.2's live-view row lists magnify among what the lab lacks, and no wired E147 control reaches it (front1 and AEL/AFL are not wired)",
    probe: null },
};

export const CASES = [
  // ---- the self-control: the rule run on a build the lab must catch, and its fix that must pass
  {
    id: 'self-unmapped-hook',
    body: 'E143',
    title: 'Self-control: a 5-byte hook in the menu reader jumping to an unmapped address, fixed by a hook into a cave holding the moved instructions',
    sources: [],
    camera: 'none (synthetic): the case checks the runner, not a camera report',
    cause: "the hook's jmp (d32,pc) lands at 0x30000000, where nothing is mapped: the fetch is a bus error (trap reason 2) at the boot's first pass through the reader",
    detector: 'lab-error',
    needs: [],
    // the menu reader's return (E143 block offset 0xb4e88a, its 5 bytes up to the reader's ret, test_patch.mjs) runs from the boot on and at
    // each settings read; the cave is the main block's 0xFF tail at 0x1a70c40, which the boot loads (test_patch.mjs)
    scenario: ['wait:3000', 'menu', 'down', 'down', 'expect:gui~MENU'],
    session: {},
    bad: { kind: 'synthetic', make: 'hook', site: 0xb4e88a, site_bytes: '6200df2008', to: 0x30000000 },
    fixed: { kind: 'synthetic', make: 'hook-cave', site: 0xb4e88a, site_bytes: '6200df2008', cave: 0x1a70c40 },
  },
  // ---- caduceus-om3 (E147)
  {
    id: 'cad3-crop-round-7',
    body: 'E147',
    title: "caduceus-om3 crop round 7: a section-2 hook jumping into section 6's extension before section 6 is loaded",
    sources: [`${CAD3}/blob/38e6ef8/research/NOTES.md`, `${CAD3}/commit/d9c2c2c6fe98f2ceb235b02f01a3e5715ca5b2d6`, `${CAD3}/commit/2ddebe1`, `${CAD3}/commit/480e6b2`],
    camera: "2026-11-17, the owner's OM-3: a boot loop at every start ('it went into a bootloop and never could even load the camera'); the package was renamed BOOTLOOP-do-not-flash (NOTES 'Crop round 7: the boot loop')",
    cause: "analysis (theirs, not seen on the camera): .hook_crp at 0x6057fb1b (section 2, the play app's copy of the photo info's ratio code) jumps to cr_pbi in .ext12 (section 6); the loader copies sections 1..10 in order while the camera starts and the play app can fill a photo's info (the newest photo at the card's mount) before section 6 is in. om-emu passed the build: every section is in place from the reset (FIDELITY-NOTES 7.18). Round 7b removed the hook and gated the section-1 store hooks on section 6's ready bit (cr_g1, cr_g2); v0.40-alpha is the first release with it",
    detector: 'section-ready',
    // --sec-ready lists ungated branches on the camera-tested fixed build too (staged-load), so the builds wait for it
    needs: ['section-ready', 'staged-load'],
    run_needs: ['staged-load'],
    // a picture on the card, then a power-on with it there (the play app's info fill at the mount) and playback
    scenario: ['wait:4500', 's1', 's2:down', 'wait:300', 's2:up', 'wait:5000', 'expect:card:DCIM/100OMSYS/*.JPG', 'power:off', 'restart', 'wait:4500', 'play', 'wait:1500', 'play', 'wait:1000', 's1', 'wait:1200'],
    session: {},
    bad: { kind: 'source', project: 'caduceus-om3', commit: 'd9c2c2c6fe98f2ceb235b02f01a3e5715ca5b2d6', path: 'caduceus-om3/crop-round-7/E1479999.BIN', sha256_prefix: '1cd2f94c', sha256_suffix: '6c41', main: true,
      build: 'git checkout d9c2c2c6fe98f2ceb235b02f01a3e5715ca5b2d6 && python3 firmware/build.py --stock OLY_E_147_1100_0000_0000.BIN --toolchain <binutils build for --target=mn10300-elf> --out DIR (their test-builds/2026-11-17-crop-round-7, not published)' },
    fixed: { kind: 'release', project: 'caduceus-om3', tag: 'v0.40-alpha', commit: 'a2551d07eb540e2defdaa2e8387e3826a36229e8', files: { 'patch.json': 'eb1b244179d426bce4abf7329624344771ea2375c3a8f1a3fa7ef72f97981da5' }, patch: 'patch.json' },
  },
  {
    id: 'cad3-issue-97-magnify',
    body: 'E147',
    title: 'caduceus-om3 #97: magnify at Image Aspect 5:4, XPan or 21:9 shows a black screen and hangs',
    sources: [`${CAD3}/issues/97`, `${CAD3}/releases/tag/v0.40.2`, `${CAD3}/releases/tag/v0.40.3-beta3`],
    camera: "a user's OM-3 on v0.40.2 (issue #97, 2026-11-20): with the crop ratios, magnify gives a black screen, a click, focus lost, nothing further; the Image Aspect menu also shows wrong names (cosmetic, no detector)",
    cause: "theirs (owner, #97): the zoom view has no magnify area for Image Aspect 5 (5:4), 6 (XPan) and 7 (21:9) and gets stuck; v0.40.3-beta2 maps 5:4 to 4:3's area and XPan / 21:9 to 16:9's (MF assist uses the same code), and beta3 carries the same fix without beta2's boot loop",
    detector: 'hang',
    needs: ['lv-magnify'],
    // XPan (MODE_ASPECT_RATIO 6) set by the setting op, the shooting screen after a half press; the magnify press the
    // camera report needs has no token (lv-magnify), so the scenario stops short of it
    scenario: ['wait:4500', 'SET:MODE_ASPECT_RATIO=6', 'expect:setting:MODE_ASPECT_RATIO=6', 's1', 'wait:1200', 'expect:gui~CA_REQ_DISP'],
    session: {},
    bad: { kind: 'release', project: 'caduceus-om3', tag: 'v0.40.2', commit: '9fc2dc1411e15cca898654842b710dc00f3a0817', files: { 'patch.json': '7b27b9d7f2a3486210f175fa0449fd7079fe956463031ee538955869a99804b5' }, patch: 'patch.json' },
    fixed: { kind: 'release', project: 'caduceus-om3', tag: 'v0.40.3-beta3', commit: '5a74a6074a96488dbf2ce03e13a370586a93ff6d', files: { 'patch.json': '28fc07609605c9a7e9a77e9d775b824c1e8b902d42cdc20d93183953e5802922' }, patch: 'patch.json' },
  },
  {
    id: 'cad3-v0.40.3-beta2-bootloop',
    body: 'E147',
    title: "caduceus-om3 v0.40.3-beta2: section 6 code jumping into section 8 at the start-up's setting-897 writes",
    sources: [`${CAD3}/issues/97#issuecomment-7054752208`, `${CAD3}/commit/94cd8c4fba0f3b40fbca46825ea63a695fbe91fe`, `${CAD3}/commit/d6dc2b2147b90719811b4291c41876148cebcf8f`, `${CAD3}/tree/42ec22c6ca5fa9e5b1b5ec7460e4a4ae6309c1f5/releases/v0.40.3-beta2`],
    camera: "2026-11-21, the owner's OM-3: beta2 (their test build fixes2) passed its camera test, then boot-looped later with the card unchanged; CADLOG.TXT was not written again; flashing v0.40.3-beta brought it back. The release was taken down (its folder stays in the tag's tree)",
    cause: "analysis and their om-emu trace, not seen on the camera (NOTES 'The fixes2 boot loop', commit 94cd8c4): fix99-1 put sl_set0's branch for setting 897 (the Creative Dial family) in section 6's ext11, jumping to fw_897j in .ext8 = section 8; the settings task writes 897 three times while the camera starts, once sections 6 and 7 are in and 8..10 may not be. Their om-emu run saw fw_897j run three times before the first look and flagged nothing. beta3 (fw_g8 in section 3's tail) branches to fw_897j only once cm_init is set, after the films load with all ten sections in",
    detector: 'section-ready',
    // as crop round 7: beta3 has 20 --sec-ready findings, beta2 22 (its added 6 -> 8 jump among them), so the
    // detector alone cannot tell the builds apart (staged-load)
    needs: ['section-ready', 'staged-load'],
    run_needs: ['staged-load'],
    // the start (the three 897 writes), the first look at S1, a Creative Dial turn (fw_897j's own path), Picture
    // Mode, and a second start on the same camera
    scenario: ['wait:4500', 's1', 'wait:1200', 'switch:creative_dial+1', 'wait:1000', 'ok', 'ok', 'wait:1000', 'power:off', 'restart', 'wait:4500', 's1', 'wait:1200', 'expect:gui~CA_REQ_DISP'],
    session: {},
    bad: { kind: 'release', project: 'caduceus-om3', tag: 'v0.40.3-beta2', commit: '42ec22c6ca5fa9e5b1b5ec7460e4a4ae6309c1f5', files: { 'patch.json': '0ff3e33b3bbedcc814f5ccc19a4abb697d15f264d91bc87b02075faf2837f288' }, patch: 'patch.json' },
    fixed: { kind: 'release', project: 'caduceus-om3', tag: 'v0.40.3-beta3', commit: '5a74a6074a96488dbf2ce03e13a370586a93ff6d', files: { 'patch.json': '28fc07609605c9a7e9a77e9d775b824c1e8b902d42cdc20d93183953e5802922' }, patch: 'patch.json' },
  },
];

// The URL a pinned release file is fetched from: the file in the tree of the commit the tag named when pinned (a
// moved tag or a release taken down does not change it)
export const RELEASE_URL = {
  'caduceus-om3': (b, name) => `https://raw.githubusercontent.com/androidfanman/caduceus-om3/${b.commit}/releases/${b.tag}/${name}`,
};
