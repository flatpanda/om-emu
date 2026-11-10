# emu: the OM-Emu emulator and lab

emu runs Olympus / OM System camera firmware in JavaScript: an MN10300 (AM33) CPU, the camera's interrupt controller,
timers, OSD engine, VSC display compositor and SCPU interface, and a harness that runs the firmware's own kernel, GUI
and camera application with named stand-ins where a part of the camera is not modelled. It runs the OM-1 v1.9 (E143)
natively and other bodies through ports (`docs/model-survey.md`). This file is the user and developer guide; the design
is in [ARCHITECTURE.md](ARCHITECTURE.md) and the known departures from the hardware in
[FIDELITY-NOTES.md](FIDELITY-NOTES.md).

## Requirements

- node 26 (tested with v26.11.1); no npm packages, no Python.
- The model's firmware, which is never stored in this repository: `node emu/bin/fetch-fw.mjs [--model CODE]` downloads
  the `.BIN` from the vendor's updater API, checks it against `BLOBS.sha256`, unpacks the main code block and the
  resource block into `unpacked/<code>/` and checks both against `src/fw/models.mjs` (for the OM-1, about 240 MB
  downloaded, 90 MB kept). On E143 it also writes there the extract of the NAND blocks the play bring-up loads the
  resource tables from (`<bin>.nand.bin`, 3.4 MB, checked against its MODELS digest; `checks/lib/env.mjs` loadNand,
  `src/lab/resnand.mjs`). The player does this itself on first use; a checkout unpacked before the extract existed
  makes it with one more `fetch-fw.mjs` run, which reads the `.BIN` from `fw/` (or `$OM_FW_DIR`, `$OM_BIN`, `--bin`)
  or downloads it again. Until then the tools that check the unpacked blocks without fetching (`nav.mjs`, which reads
  no NAND itself, among them) refuse E143 as lacking its blocks.
- For the debug API's `--disasm` only: `tools/mn10300-objdump` (or `$OM_OBJDUMP`; the build recipe is in `BLOBS.md`).
- For `bin/webgate.mjs`: the `.BIN` (`$OM_BIN`, or `$OM_FW_DIR` holding it) and Chrome: `--chrome PATH`, else the
  first found of `/usr/bin/google-chrome-stable`, `/usr/bin/google-chrome`, `/usr/bin/chromium`,
  `/usr/bin/chromium-browser` and the macOS Chrome and Chromium apps in `/Applications` (tested with Chrome
  155.0.8059.39 on Linux and 155.0.8059.85 on macOS). The browser player itself needs a browser with module Workers; with
  OPFS it also keeps the firmware and the settings (without it, it runs from the `.BIN` at each start).
- For `bin/browsergate.mjs`: the `.BIN`s as for webgate, and on Linux Firefox with geckodriver and WebKitGTK's
  MiniBrowser with `WebKitWebDriver` and Xvfb (tested 2026-11-02 in an Arch Linux ARM VM: Firefox 159.0, geckodriver
  0.37.1, WebKitGTK 2.54.2; on Arch, `pacman -S firefox geckodriver webkitgtk-6.0 xorg-server-xvfb`).

## Quick start

```sh
emu/play.sh                    # the interactive player in the default browser (the play page and its API)
emu/play.sh --device evf --start menu --idle off     # any play option
emu/play.sh --model E144       # another camera model (OM-5); --model list shows them all
```

The model is E143 (OM-1 v1.9) unless `--model CODE` names another body of `src/fw/models.mjs` (`OM_EMU_MODEL` in the
environment does the same; the option wins); `bin/play.mjs`, `bin/nav.mjs` and `bin/fetch-fw.mjs` take the same option.
`--model list` prints each one's code, name, firmware version and whether its firmware is on disk. A body whose port is
not finished stops during its start or soon after: the status's phase is `error` with the reason, and the page shows
it (the E118 family's did until 2026-10-30, when E122, E118 and E120 reached their shooting screens, framed on both
panels, and modelcheck's path with their cards native, `docs/model-survey.md` findings 31 and 38 to 56); a body the lab does not load on (one whose board family
leaves a fact the import needs unread, src/fw/board.mjs) is refused at start with the reason, exit 1. The
page's model menu switches a running server to another body (`POST /api/model`): the session stops as Quit stops it,
the server restarts on that model at the same URL, and the page reloads. It refuses, with the reason under the menu and
the session running on, a body whose firmware is not unpacked yet (run `fetch-fw.mjs --model CODE` first), a body the
lab does not load on, a session started with `--out` or `--replay`, and one whose state is kept in a named file
(`--nvram FILE`, `OM_EMU_NVRAM=FILE`: that file is the old model's).

On first use the player provisions the model's firmware (`host/firmware.mjs`): it takes the `.BIN` from `fw/` or
`fw/old/` (or `$OM_FW_DIR`, or `$OM_BIN` when that file is the model's `.BIN`), else downloads it (the API serves only
each body's latest release), and verifies and unpacks it as `fetch-fw.mjs` does (`--check` only reports whether the
blocks are the model's). `npm run play` in `emu/` does the same as `play.sh`. Ctrl+C stops it; the session log is in
`emu/out/play/<model>/<time>/session.json`. A browser-only variant, with the lab in a Worker and no server, is under
"The browser player".

**The camera's kept state (S-NVRAM).** The player keeps the camera's non-volatile state between sessions, as the
camera does across a power-off: the settings stores M and E as the firmware saves them (the menu's close, the
power-off), the SCPU window's backed-up words and the sub-CPU's memory (its RTC and backup registers). A camera whose
clock was set starts on its shooting screen with the last session's settings, not at the date prompt. `bin/play.mjs`
keeps one JSON file per model, `~/.om-emu/nvram-<model>.json` (`nvram-E143.json`, `nvram-E146.json`, ...), and its
startup line names the file in use. `--nvram off` (or `OM_EMU_NVRAM=off`) runs a blank camera at each start and leaves
the file alone; `--nvram FILE` (or `OM_EMU_NVRAM=FILE`) keeps the state in FILE instead; `--nvram` wins over
`OM_EMU_NVRAM`. Delete the file to start from a blank camera again. A file names its model and another model's is
refused at start (exit 1), and so is a file that does not parse. The state is kept where the build places S-NVRAM's
sites, E143, E146 and E147 (X: two sessions on a fresh file restore M and E on each); on the other bodies the player
runs blank and its line says why (the flash task's post `0x5003d95c` has no place in their builds), and `--nvram on`
or a file is refused there. `OM_EMU_SCPU=native` runs blank by default as well (the sub-CPU's own backup domain is not
kept), and refuses a kept state asked for. The browser player keeps the same document in OPFS by default (`nvram=0`
for a blank camera; "Forget the kept settings" removes it; "The browser player").

The camera's clock in a session with the kept state is the host's local time, read once as the session starts, plus
the offset the camera's own clock setting left, and then advances with lab time (src/lab/menu.mjs store_init), so a
session is a function of its starting state, that one clock read and its inputs. `session.json` records both for
every session of the run (its `nvram`: `{start, sessions: [{clock, doc?}]}`, the state when the run began and each
session's clock, with a session's document only where the file was not what this run's own saves left, another
writer or a deletion between sessions; `src/lab/nvramdoc.mjs`), and writes the same record to `session.nvram.json`
beside `session.jsonl` as each session starts. `--replay` of such a log starts every session from the recorded state
and clock, held in memory: it repeats the session frame for frame, and never reads or writes the kept file; a
`session.jsonl` takes the record from the `session.nvram.json` beside it. A log without the record (a session without
the kept state, or a log from before it was recorded) replays as a blank camera, whatever the kept file holds, and
`--nvram` with `--replay` is refused. The tools and tests run blank: `checks/lib/playhttp.mjs` and
`test/test_host.mjs` start `bin/play.mjs` with `--nvram off` unless a test names `--nvram` (or replays a log),
`bin/nav.mjs`, `bin/debug.mjs`, golden and modelcheck give the lab no kept state, webgate's pages and sitegate's
dropped page ask for `nvram=0`, and the pages sitegate and browsergate open through the landing page's link run the
default in the fresh browser profile each run makes.

**The live view.** The page's "Scene and image sensor" panel turns on S-SCENE, a stand-in for the image sensor
(`src/lab/scene.mjs`, `docs/om1-shutter-spec.md`). It renders a synthetic scene (static, moving or a test chart; three
layers at their own distances and speeds) through a thin lens on a Four Thirds sensor (focal length, aperture, focus
distance: depth of field from the circle of confusion) at an exposure (EV, shutter, ISO, compensation; auto or
manual), and the firmware's own through-image API shows it on the live-view plane under the GUI. S1 focuses on the
layer under the AF point, S2 records a capture with the exposure in use and REC starts and ends a clip; all three are
the stand-in's, because the camera modules that would run AF, the release and the movie recording do not run in the
lab. Its inputs are session-log inputs, so `--replay` repeats them.

**The card, the HDMI port, the tilt and the session's options.** The page's panel of that name (both players)
reaches the run-time inputs below from the page. The session line says what the session was started with
(`GET /api/session`): the HDMI port, the lens (natively with S-LENSMCU, the default on E143, E146 and E147, or
S-LENS), the settings (S-NVRAM or S-SETSAVE) and where the card is kept, with the size asked for a new one. These are
fixed for a session: on node by `--hdmi on`, `--nvram` and `OM_EMU_LENS`, `OM_EMU_NVRAM`, `OM_EMU_CARD` and
`OM_EMU_CARD_SIZE`
in the server's environment, in the browser by the start options above the camera (`?hdmi=on`, `?lens=stand-in`, `?nvram=0`, and the
Card menu's `?card_size=GiB`: 64 or 128 GiB, an SDXC card). HDMI: Plug in sends `{"type": "hdmi", "action": "plug"}` in a session with the port (the
cable, the DDC reads, the driver's EDID state and, once the firmware opened it, the HDMI output's format and timing from
the status), and is disabled with the reason without one; Unplug sends the unplug (A-HDMI-1). Card: Take out and Put in
are the card inputs (S-MEDIA, the HLS media side of E143 and E146; another body refuses them with the reason), and the
list is the card's files read with the independent FAT and exFAT readers (`refs/volume.mjs` picks `refs/fat.mjs` or
`refs/exfat.mjs` by the boot sector; `web/cardfiles.mjs`) between the lab's steps, not through the firmware, in or out of the slot and
while the camera is off, with the card's kind and capacity (`GET /api/card`; a volume the readers do not read, a blank
card, shows its reason): per file its size and date, a thumbnail and a viewer for a JPEG
decoded by `refs/jpeg.mjs` (`GET /api/card/image?path=P&max=N`: PNG from the node server, RGBA from the Worker), and a
download (`GET /api/card/file?path=P`). Each read is a `{"type": "cardfiles"}` input on the session's queue, run
between ticks outside the session log, as the debug route's inputs are (`src/lab/player.mjs` card_files). Tilt: roll
and pitch sliders send the tilt input (S-ACCSAMPLE, E143 and E146). The scene panel shows subject detection's frames
(from MDET's table on E143) from the status; the scene takes no subjects of its own at run time (they are its patterns', the moving
scene's rider), so the panel has no control for them: the camera's setting 1682 chooses the kind.

**The camera application.** Every play session runs the firmware's camera application (CA_MAIN) natively (S-CAMAPP,
`src/lab/camapp.mjs`, `docs/om1-shutter-spec.md` section 7). It takes the GUI from power-on to its own screen (on the
lab's unset clock, the date prompt), and S1 and S2 are the application's: S1 cancels the prompt and shows the shooting
information, S2 the capture display and the rec view. What runs below it is stood in:

- the firmware's PER_SCPU runs natively against a model of the sub-CPU at the far end of its link (S-SCPUDEV,
  `src/lab/scpudev.mjs`, over PER_SIO's channel S-SIO2 and the GIO pins 102 / 103 / 107, `src/lab/scpulink.mjs`,
  `src/dev/linkpins.mjs`; E143, E146, E147, E139 and E134): the start's reset pulse and
  `0x85 {2}` handshake and the store init's requests are frames on the link, the sub-CPU's RTC and backup words are
  kept for the session, and the SCPU clock ticks with lab time. On E143, E146 and E147
  the power lever, the Fn lever and S1 are the SCPU interface's port levels (H-SCPUPORT): IRQ 320, its handler and
  UI_IN's callback run natively; the lab attaches the IRQ and registers the callback in place of the inits that would
  (H-SCPUIRQ, H-UIINPORT). On E143, E146 and E147 the power manager (PWR_MAIN) starts natively at the bring-up
  (H-PWRSTART; on E143 and E146 its IO expanders' requests are answered at their tasks' seam, S-IOEXP; E147 has none),
  and the lever's off runs the firmware's own power-off from the HFW's shutDown (S-SHUTDOWN, in place of the HLS
  component that would call it) through the sub-CPU's `0x85 {1}` to the SCPU window's last write, where the session
  ends (H-POWER; `src/lab/power.mjs`, at the addresses `src/fw/facts.mjs` powerOff reads; `docs/hle-gaps.md` 4.7.4);
  elsewhere the off closes the session at once.
- With `--hdmi on` (E143, E146, E147; off by default) the HDMI port is modelled: the transmitter's registers, its
  DDC and IRQ 239, and the hot-plug GIO pin with its IRQ 109 (`src/dev/hdmi.mjs`). The input `{"type": "hdmi",
  "action": "plug"}` puts a lab sink on it (S-HDMISINK: a 1080p60 EDID with a CTA-861 block composed for the lab,
  `src/lab/edid.mjs`), and the firmware takes the pin's interrupt, starts the transmitter, reads and parses the EDID
  over the DDC and reports the connection to UI_IN natively; the lab only frees the GIO interrupt slots the pin's
  registration needs, as the GIO init that does not run would (H-GIOSLOTS). The camera application then asks for the
  HDMI output (TRA 588), and on E143 the lab does its component's part (S-OUTDEV): the IO-device capability opens the
  HDMI device natively, the transmitter's open (its PHY, SCDC write and update) and VSC channel 0 at 1080p59.94 run
  natively, and `DisplayLab.compose('hdmi')` composes channel 0 (its window; the GUI draws nothing there yet). The
  unplug (A-HDMI-1) runs natively down to the disconnect report; nothing switches back. The `fw_0501` switch is
  refused: the firmware drives it (`docs/hle-gaps.md` 4.9).
- On E143 and E146 the accelerometer is stood in at its sample cache (`src/lab/acc.mjs`): the ACC module init and
  PER_SLOPE's init run natively at the bring-up (H-ACCINIT, H-SLOPEINIT), the sensor's register file answers the
  probe (S-ACCREG), and before each of ACC_MAIN's 80 ms copies the lab stores one sample where the sampler's
  completion would (S-ACCSAMPLE): a level camera by default, tilted by the input `{"type": "tilt", "roll": 5,
  "pitch": 0}` (degrees, within 45; A-ACC-1..3). ACC_MAIN, PER_SLOPE, the shooting screen's level gauge and Setup's
  Level Adjust run natively; with the lab's blank factory data Adjust writes the user table but leaves the gauge as it
  was (`docs/hle-gaps.md` 4.7.3). With `--rotate on` (the browser's start option Orientation, `?rotate=on`; off by
  default) PER_ROTATE runs natively too (H-ROTINIT): the tilt then takes any attitude (roll within 180, pitch within
  90 degrees), its step waits 500 ms and records the orientation, and the camera turned past 50 degrees of roll has
  the GUI lay the level gauge out for portrait.
- module requests are answered (S-MODACK), the HLS transaction layer's exec succeeds and deletes its request as the
  exec would (S-TRAACK; `docs/hle-gaps.md` 4.4.2, the heap's growth), and the modules'
  notifications of a release (focus, exposure, rec view) are posted as the callbacks the HLS would make of them
  (S-RELSEQ); no image is captured. The focus result and the exposure time come from S-SCENE when its live view is on.
- Each release sounds as the mechanical shutter does (S-SHUTTERSND, `src/lab/shuttersnd.mjs`): an open click at
  S-RELSEQ's START_EXPOSE and a close click with the charge at END_EXPOSE, the shutter time in use later (S-SCENE's,
  else 1/125 s). On the camera that sound is the mechanism's, not the firmware's (the stock firmware plays nothing at a
  release and the electronic shutter is silent), so the lab synthesizes it, from seeded noise and a few resonators: no
  audio asset. Which drive settings select the electronic shutter is not decoded, so every release sounds. The clicks
  go out on the lab's audio output (`src/lab/audio.mjs`): a session emits PCM events (lab time, rate, channels,
  16-bit samples, source) only where its host plays sound (`env.onAudio`: the node server's lab thread and the
  browser player's Worker), the Player hands them over after each tick, and both pages play them with WebAudio
  through `GET /api/audio?after=N` (a long poll; the browser's page answers it from the Worker's messages). A page
  plays sound (and polls for it) once a key press or a click on it has started its audio context; its Sound button
  mutes it. A `--replay`'s sound is dropped, and the gates, golden, the checks and `nav.mjs` emit none.
- On E143 the resource API's tables are the firmware's own (`src/lab/resnand.mjs`, `docs/hle-gaps.md` 4.5): the play
  bring-up runs USTART_L's resource loader natively (H-RESINIT), and S-RESNAND serves its NAND reads from the update's
  blocks at their load addresses (from the extract the hosts keep: node in `unpacked/<code>/`, `checks/lib/env.mjs`
  loadNand; the browser in its cache), so the lens data lookup finds its lens's record. The camera's own sound
  resources at `0x4e420000` are factory data that no update carries: a host may give an image (`env.soundArea`;
  `src/fw/nand.mjs` soundArea() builds one in the TG-7's format from WAVE files), else the lab serves its own where the
  audio hardware runs (S-SOUNDRES, below), else they read erased: then USTART_L's load of sound 0 takes its error path
  at the bring-up and logs `0x1f000003`, as a camera with an erased area would.
- On E143 a half press in focus beeps (`docs/hle-gaps.md` 4.5, `FIDELITY-NOTES.md` 7.14, 7.15). The audio hardware
  runs by default there (`--audio auto`; `--audio off` leaves it out, `--audio on` refuses a body without it): the
  audio serial port's TX side with IRQ 43 and the SCA's page (`src/dev/audio.mjs`, A-AUDIO-1), the sound IC on
  PER_SIO's channel 14 as a register file (S-WM8946, `src/lab/wm8946.mjs`), AUD_MAIN started at the bring-up
  (H-AUDSTART) with its CPU 2 starts answered (S-AUDCPU2), and the lab's time jumps taken event by event while the
  port plays (H-AUDTIME; `src/lab/audiohw.mjs`). The lamps' and sounds' module UI_OUT runs (H-UIOUTSTART), S-AFLOCK
  writes the AF lock as the sequence, the take capability and the AF module would at S-RELSEQ's focus callbacks (and
  posts its CBS_AF_LOCK, which re-arms the beep for the next half press), and the GUI's own beep code asks UI_OUT for
  sound 0, which the firmware's driver plays from the sound area through the port to the page (events of source
  `native` on the lab's audio output). What you hear is not the camera's sound: the OM-1's own sounds are not in any
  update, so the lab serves a lab-made area in their place (S-SOUNDRES, `src/lab/soundres.mjs`), whose sound 0 is a
  beep the lab synthesizes, two 52 ms bursts of 2.7 kHz, played at the WAV's level (the codec's volume is not
  applied). The Setup menu's beep item (Off) silences it, as on the camera.
- A card is in the SD slot. On E143 it is an 8 GiB SDHC card behind the firmware's SD command layer (S-SDCARD,
  `src/lab/sdcard.mjs`), and the firmware's own storage stack runs on it (`src/lab/storage.mjs`, `docs/hle-gaps.md`
  4.8.2): the file system's bring-up and the file tasks natively before the application starts (H-FILEINIT,
  H-FILECLBK; the SD host's registers S-SDHOST, its NAND area S-FSNAND, the album manager S-ALBM), the card's
  insertion as the file module's requests (S-CARD): the firmware formats a blank card itself (FAT32, `OM SYSTEM`) and
  mounts it, and counts the remaining shots and the movie time from it. Each picture taken is also written to the card
  as `C:\DCIM\100OMSYS\P1010001.JPG` and on (S-RECFILE: a JPEG of S-SCENE's frame at the capture, each 8 x 8 block
  its mean), recorded as REC_FILE's recorder records a file: its requests to the file module, each run natively,
  so the firmware's DCF database counts the picture at once and playback shows the database's pictures
  (`docs/hle-gaps.md` 4.8.9; on E146, E147, E144 and E148 too, the other bodies with a native card through the file
  module's own file requests). On E143, E146 and E147 REC_FILE's own task records it (`src/lab/rec.mjs`,
  `docs/hle-gaps.md` 4.8.10): the packet REC_IMAGE posts it (S-RECIMAGE), with the file's header (Exif with the Make, Model, dates and
  maker notes, XMP) built by REC_IMAGE's header maker natively from the shot's EXIF parameters (S-EXIFPRM) and the
  lab's JPEG after it (S-JPEGENC). Card Formatting from the menu formats it: the menu's
  Yes reaches the file module through api_media's own format call (S-MDACTRL, `src/lab/media.mjs`, `docs/hle-gaps.md`
  4.8.3, in place of the HLS function component), its progress bar runs and the application returns to the menu. The
  input `{"type": "card", "action": "remove"}` takes the card out of the slot while the camera runs and `"insert"`
  puts it back: the card switch changes as a body's does and UI_IN decodes it natively, S-MEDIA (in place of the HLS
  media manager) has the firmware unmount and mount it again, and the shooting screen drops the card's counts and
  shows them again. The card stays in the slot across a player's power
  cycles; `OM_EMU_CARD=FILE` keeps it between sessions (`host/card.mjs`). `OM_EMU_CARD_SIZE=GiB` (the browser
  player's Card start option) gives a new card another capacity, above 32 GiB an SDXC card, which the firmware formats
  exFAT (`docs/hle-gaps.md` 4.8.6; `refs/exfat.mjs` reads it back), and formats exFAT again from the menu; the card
  out and in mounts it again. E146, E147, E144, E139, E137, E142, E140,
  E125, E130, E133, E145, E129, E132, E134 and the E118 family's E122, E118 and E120 run the same file system on the
  same card (their seams read from their firmware by `src/fw/facts.mjs` fileSystem; on the E144 family the SD
  driver's request for the card's supply is answered, S-SDPOWER; on E134 its lamps' module UI_OUT runs, H-UIOUTSTART,
  since its file layer asks it for the card's access lamp; on E118 the SD driver's request to the sub-CPU for a card
  line is answered, S-SDSWITCH, and its movie record time's division by the frame rate, 0 before a movie take on the
  camera too, is stood in as the MN103's DIVU by 0, S-MOVRATE, `docs/model-survey.md` findings 50, 51, 59): a blank card formatted and mounted, the counts from it, each picture's file written (the movie time left
  on E144, E139, E137 and E125 is an orange `0:00:00`: the blank settings store's movie mode, UHD 4K at 60p, is one
  they cannot record, `docs/hle-gaps.md` 4.8.5; E134's query answers 0 for the same reason); the menu's Card
  Formatting and the card input run on E143 and E146 (`docs/hle-gaps.md` 4.8.7) and are refused on the others. With a
  64 GiB SDXC card (`modelcheck.mjs --card-size 64`) each of them formats it exFAT; all but E144 run on, and E144
  stops at the camera application's start on its own divide by zero (its movie parameters, with that movie mode and
  an exFAT card, divide by a size the rate table did not give; the hardware's result is undefined, so emu stops
  there: `docs/hle-gaps.md` 4.8.7). On the other bodies the card has no file
  system (S-CARD: the HLS mount state, every picture taken kept as an image of folder 100, a remaining-shots answer of
  999 less the images to the application's getAvailableShootCount, the first slot's card detect state at inserted and
  a movie time left of an hour less what has been recorded). The system timer module's
  long timers run out (S-LONGTIMER), and a lens is on the mount. On E143, E146 and E147 it is there natively (since
  2026-10-29 the default): the lens tasks, the lens driver and its serial driver LENS_SSC run against a model of the
  lens serial controller (`src/dev/lensssc.mjs`), S-LENSMCU (`src/lab/lensmcu.mjs`) answers its frames as the 12-40mm
  F2.8 PRO, the zoom ring and the lens lock pin switch fw_121c reach the driver, and on E143 the camera application,
  which learns of the lens from the lens module, forwards the touches to the GUI itself (`docs/hle-gaps.md` 4.4.2;
  E146's and E147's driver addresses are read by `src/fw/facts.mjs` lensDriver, 4.4.3). `OM_EMU_LENS=stand-in` (the
  page's `?lens=stand-in`) takes S-LENS instead, and the other bodies always have it: an attach flag, a lens-ready
  byte and a 12-40mm F2.8 PRO record, so the screen shows S-AF and the AF target; the application then counts no
  lens attached for its touch path, which S-TOUCHMAP and S-CAFWD stand in for. A touch reaches the driver through
  S-TPREG, which answers the controller the driver reads: E143's at slave `0x70`, and since 2026-11-02 the E144
  family's at `0x48` (`src/lab/touchpanel.mjs`; `docs/model-survey.md` finding 75), where a tap on the touch mode icon
  or in the super control panel reaches the GUI as on E143.
- A half press in focus shows the green AF frame and focus mark. They are CPU 3's (its task DISP_FRAME draws them into
  the TFT's face-frame plane), so S-DISPFRAME runs DISP_FRAME on the lab CPU for each post to it, S-TAKEFRAME sets the
  frame display mode the TAKE module would, S-AFOSD uploads the indicator and the AF frame the AF module would, and
  the VSC model shows the plane under the opt-in A19 (`docs/om1-shutter-spec.md` section 7 item 50). A full press
  clears the GUI's information for the capture and the rec view; during the rec view S-RECVIEW holds S-SCENE's frame
  of the capture on the live-view plane (the lab develops no image).
- With the camera's subject detection on (settings id 1682: 1 motorsports .. 5 animals; the debug API's token
  `SET:1682=1` sets it) and S-SCENE's live view showing a subject of that kind (the moving preset's rider and the race
  preset's two motorcycles stand for motorsports, the motorcycles' helmets for their parts),
  DISP_FRAME draws subject frames on it natively from MDET's own frame table: CPU 3's MDET_DL code runs natively on the
  lab CPU (S-TAKEMDET, S-MDETDL, S-LEARNDATA; `src/lab/mdet.mjs`): TAKE's start and change of kind, a YC frame offer per
  tick and scene step, the DML engine's register images and IRQ 285 (S-DML, `src/dev/dml.mjs`; the debug API's `dml` op
  shows the last run's image), MDET's own post-processing and LAF, which writes the frame table and its aspect pair and
  posts UP_FACE; S-TAKEFRAME adds the frame mode's subject bit while MDET runs. The engine runs no network: S-DML writes
  S-SCENE's subjects of the kind as its records, and MDET's own stabilisation reports them from the seventh offer, so
  the first frame comes with it (seven WAITs of a frame step in an `--idle off` session); the frames follow the subject
  as it moves and go when the setting is off (`docs/om1-subject-spec.md` 5.3 to 5.5). With several subjects each is a
  frame; MDET's own combination pairs each helmet with its motorcycle (5.6). The subject under the camera's AF target
  (the centre by default; H-FCSAF runs the AF library's init steps that give LAF that area) becomes LAF's main-subject
  candidate natively; the main and part frames are not drawn: LAF's chase cycle, which would set them, starts from
  take_mov's LAF requests, built from TAKE_MOV's EMS1 state the lab does not have (5.7, 5.8). The PDT / TRC unit has a
  register model (S-PDT, `src/dev/pdt.mjs`; the debug API's `pdt` op), the boot chain's MDET, PDT and TRC init steps run
  (H-MDETINIT) and LAF's start runs PDT's and TRC's tasks natively, opening both drivers. TAKE's message 81, which LAF's
  tracking status posts, stays in TAKE's queue in a session; served in a test it gives take_mov its LAF mode and starts
  and ends LAF's PDT / TRC side natively (5.9). EMS1, take_mov's per-frame engine, has a register model too (S-EMS1,
  `src/dev/ems1.mjs`; the debug API's `ems1` op); no session makes an EMS1 job. On a body without MDET_DL,
  S-SUBJECT (`src/lab/subject.mjs`) would write the table itself (none today; spec 5.1).
- With the control op camapp at 2 a new session runs the HLS components too (off otherwise: the GUI then shows its
  shooting panel over a black image area): S-CAMAPP starts the OXF main thread (task 57 HIGHLEVEL_MAIN), S-BOOTDONE
  sends the camera base and the still-shooting category the events the modules' start would bring, so the shoot mode
  and Cmp_ShootingComponent are created natively, and S-CPU3 takes their remote calls to CPU 3 off the ring.
  With the control op camapp at 3 (E143) the components run with their transaction path native as well: the OXF main
  thread starts before the HighLevel init, S-TRAACK and S-RPC let every transaction reach the components, which
  answer them (the application's own TRA 415 and the mode change's 420 boot them, so no S-BOOTDONE; the HDMI plug's
  TRA 588 is theirs, so no S-OUTDEV), and the VSC's histogram unit, which they start, ends each run natively
  (A-VSCHIST-1 and A-VSCHIST-2; S-HISTEND runs the lab clock to the end in DISPLAY cmd 15's wait, `docs/hle-gaps.md`
  4.2.1). It is not the default: the TFT's composite is refused once the components start the histogram, and the menu
  stops past udf07 at the imgpro unit `0x9c600000` (`0x5050a7a9`), which the lab does not model (`docs/hle-gaps.md`
  4.1.5).
- The mode dial shows each position by the firmware's name for it: UI_IN's dial table gives the position's mode code
  and the build names the codes (fact `mode_dial`, `src/fw/facts.mjs` modeDial), so E143's positions 0..9 are S, M,
  B, C1..C4 (MY_MODE1..4), Movie, P and A (`docs/om1-input-spec.md` section 2). A session starts with the dial at P,
  the mode its start takes from the store. The application takes each change and the settings store changes mode
  natively, so the shooting screen shows the position's mode: P, A, S, M and B with their exposure readouts, P marked
  C1..C4 (the custom banks, on the blank store P with RAW), the movie screen at Movie; OK and the menus work away from
  P too. This needs the store's own module init, which the lab runs between the registry bootstrap and the DB init
  (H-STOREINIT; without it a change committed 0 into most settings, `docs/om1-settings-spec.md` section 2.2). The
  page's arrows and PageUp / PageDown step the dial, wrapping (the body's ends are not known); a click on its ring picks
  a position.
- REC records with the mode dial at Movie (position 7) once the LLPSW firmware key is released (with the native lens
  it reads released from the start: the lens is locked on the mount, and pressing it detaches the lens); while it
  records, the GUI shows its movie recording screen (the card, a red REC mark with the recording's time, the time left, the movie mode, shutter,
  aperture and a blinking ISO).
- OK opens the Super Control Panel, MENU the menu (the live view stops behind it, S-THROUGH; closing it skips the
  settings' flash save, S-SETSAVE; on every other ported body too since 2026-11-02, its pages navigated natively,
  `docs/model-survey.md` findings 66 to 68), PLAY playback (the pictures taken, newest first, through S-PLAYSEQ, S-PLAYCOMP and
  S-PLAYVIEW; left and right move between them, INFO shows the detail view, PLAY or S1 returns; "No Picture" before
  any), and LV or the eye sensor switches to the EVF with the application re-entering the screen (S-OUTDISP). The
  application creates the GUI itself (H-GUIBYAPP), so the EVF shows its information and bottom bar in every frame.

## Run

```sh
sh emu/play.sh                                   # the interactive player (bin/play.mjs) in the browser
node emu/bin/play.mjs --no-browser --idle off    # its server alone (HTTP API; --debug-api for the debug tokens and
                                                 # the live debug route, below)
node emu/bin/play.mjs --hdmi on                  # with the HDMI port; the input {"type": "hdmi", "action": "plug"}
node emu/bin/play.mjs --audio off                # without the audio hardware (on by default on E143: --audio auto)
node emu/bin/play.mjs --rotate on                # PER_ROTATE natively (E143, E146): the tilt input all the way round
node emu/bin/play.mjs --take probe               # TAKE_FUNC and TAKE_FUNC_CP natively with recording stand-ins (E143,
                                                 # off by default; docs/hle-gaps.md 4.1.4)
                                                 # and TAKE_MAIN / TAKE_MAIN_CP (4.1.7): with control camapp 3 S1's
                                                 # take request reaches TAKE_MAIN natively; STB_EXTERNAL answers
                                                 # over the empty hot shoe (S-HOTSHOE, 4.12.1)
node emu/bin/play.mjs --cpu2 native              # CPU 2 on the machine's second core from its entry (E143, off by
                                                 # default; S-CPU2 lifted; docs/hle-gaps.md 4.6.1)
                                                 # with CPU 0's CPUCONN and OSD_DRAW_CPU2, which draws the
                                                 # histogram under control camapp 3 (4.6.2)
OM_EMU_LENS=stand-in sh emu/play.sh              # S-LENS in place of the native lens (S-LENSMCU, the default on
                                                 # E143, E146 and E147)
OM_EMU_SCPU=native sh emu/play.sh                # E143's and E146's sub-CPU as its own firmware on the STM32L4 machine
                                                 # in place of S-SCPUDEV (needs the
                                                 # SCPU block in unpacked/, BLOBS.md)
sh emu/play.sh --nvram off                       # a blank camera at each start (S-SETSAVE): the settings and the
                                                 # clock kept in ~/.om-emu/nvram-<model>.json are left alone
OM_EMU_NVRAM=/tmp/cam.json sh emu/play.sh        # keep the settings and the clock in another file (S-NVRAM; the
                                                 # default is ~/.om-emu/nvram-<model>.json)
OM_EMU_CARD=emu/out/card/E143.omsd sh emu/play.sh   # keep the card between sessions (E143): formatted once, the
                                                 # pictures' files stay on it (src/lab/sdcard.mjs cardImage)
OM_EMU_CARD_SIZE=64 sh emu/play.sh               # a blank 64 GiB SDXC card in place of the 8 GiB SDHC one, formatted
                                                 # exFAT by the firmware (docs/hle-gaps.md 4.8.6)
node emu/bin/nav.mjs --time --png each 'DOWN OK MENU'     # a scripted menu session: a line and a PNG per step
node emu/bin/play.mjs --patch FILE                # the player on the stock blocks with FILE's patches (Patch overlays)
node emu/bin/run.mjs all --trace emu/out/js      # the replayed scenarios, traced (37 labs, about 3 min)
node emu/bin/run.mjs stage2 --slice 1000000      # the same in budgeted continues of 1 M instructions
node emu/bin/golden.mjs check [--jobs N]         # emu against its own recorded outputs (golden.json), about 20 min
node emu/bin/modelcheck.mjs [MODEL ...]          # the ported models' smoke test: start, S1, S2, PLAY, INFO on TFT and EVF
node emu/bin/modelcheck.mjs --card-size 64       # the same with a blank 64 GiB SDXC card on each native card
node emu/bin/port.mjs all                        # re-port every model after a change to the rules, src/lab or overrides
node emu/bin/xto.mjs E144 0x501e04b7             # where an E143 code address is in a ported model (xwhere.mjs: back)
node emu/bin/fw-survey.mjs survey                # the multi-model survey's columns for every .BIN in fw/ and fw/old/
node emu/bin/fwmap.mjs                           # the firmware map: static map, coverage run, report (about 5 min)
node emu/bin/m4census.mjs                        # the SCPU image's Thumb-2 instruction census (the Cortex-M4 core's scope)
node emu/bin/m4smoke.mjs                         # the Cortex-M4 core on the SCPU image from reset to its first
                                                 # unmodelled access
node emu/bin/scpu.mjs --line help                # the SCPU image on the STM32L4 machine to its console prompt, then
                                                 # console lines (--line ...; --drive PC13=0 sets a pin's level)
node emu/bin/scpu.mjs --tier reference           # the same on the core's reference tier (no decode cache): its last
                                                 # line's wall time against the default cached tier's
```

**The SCPU's core.** `src/core/m4/` is a Cortex-M4 (ARMv7E-M) core for the sub-CPU's firmware
(`docs/om1-scpu-spec.md` section 8 steps 3-4), apart from the MN10300 core and not yet part of the lab: the decoder
(`decode.mjs`, also the census's), the executor and exception model (`cpu.mjs`), the system control space (`sys.mjs`),
a memory bus peripherals attach to (`bus.mjs`) and the SCPU's flash and SRAM (`boot.mjs`). Like the MN core it has two
execution tiers: `reference` decodes every instruction each time it runs, `cached` (the default) keeps decoded
instructions in a decode cache that writes to their code pages invalidate (`dcache.mjs`, the bus's page versions;
`--tier` on `bin/scpu.mjs` and `bin/m4smoke.mjs`; the cached tier about 1.8 times as fast on the SCPU image). Its oracle, QEMU's
Cortex-M4 in the VM on generated code, is `tools/m4-oracle/`; the vectors it recorded replay in `test-pure`.
`src/core/m4/periph/` is the SCPU's STM32L4 around it (section 8 step 5): register-level models of the peripherals
the image uses (RCC, FLASH, PWR, GPIO, EXTI / SYSCFG, DMA, the U(S)ARTs, I2C, SPI2, the timers, the RTC, the ADC and
the USB device), the board's answers (`board.mjs`: nothing attached), the event scheduler and the machine
(`stm32l4.mjs`) with its run loop and standby, and since 2026-10-29 the other low-power modes (Stop 0, 1
and 2 with the peripherals' clock domains, Shutdown), flash erase and programming (the flash's bytes change only
through the flash interface, which reports each change with `bus.written` for the core's decode cache), I2C slave mode and
the timers' slave modes. Like the core, it is outside `bin/port.mjs`'s literal scan: its
constants are the STM32's address map and registers, not MN addresses. `bin/scpu.mjs` boots the image to its debug
console's prompt "SUB> " and types lines into it. S-SCPUDEV stays the lab's sub-CPU by default; with
`OM_EMU_SCPU=native` (env.scpu 'native') on E143 and E146 the lab puts this machine with the body's SCPU image at the
far end of the MN's link in its place (`src/lab/scpum4.mjs`, `docs/om1-scpu-spec.md` section 8 step 6: PB12, PC3 and
PC2 wired to the MN's pins, its reset line to NRST, the transfers' bytes through SPI2 at the link's clock, its time
in step with lab time but for the answer windows it gets while the MN waits, S-SCPUBOARD and A-SCPUM4-1..3). Its frame log, transfers and pins from the first request on equal S-SCPUDEV's in the store-init session on E143 and E146.

`bin/play.mjs` is the play server and `bin/nav.mjs` the scripted menu tool (`host/playcli.mjs`, `host/navcli.mjs`). The
server answers every request with the router the browser uses (`src/lab/playapi.mjs`) on node's main thread and runs
`Player.run` synchronously in a `worker_threads` Worker (`host/labworker.mjs`), whose input queue blocks
(`host/portqueue.mjs`: `receiveMessageOnPort` and `Atomics.wait`). SIGINT, SIGTERM and SIGHUP stop the loop after its
current tick; a second signal exits 130. The default `--out` is `emu/out/play/<model>/<time>`
(`emu/out/nav/<model>/<tag>` for nav). Two request bodies throw Unported rather than guess: a JSON body nested deeper
than 10,000 levels and a body whose `surrogatepass` decode puts two surrogates in a row.

**Scenarios.** `bin/run.mjs` replays sessions from their inputs: `scenarios/calls/<scenario>.calls.json` holds recorded
calls into the lab objects (recorded on 2026-10-13; inputs only, no outcomes), and the osd scenario's calls are
generated from `check_osd` at run time (`checks/lib/osdcalls.mjs`: its arguments carry memory copied out of the
firmware, so they are not committed). Each replayed call's outcome digest goes into the trace, where `bin/golden.mjs`
records it. Groups: `stage0` (the six kernel sessions `kernel-1`, `kernel-5b`, `kernel-5c`, `kernel-6`, `kernel-7`,
`kernel-7b`, and `osd`), `stage1` (`shoot-tft`, `shoot-evf`, `menu-tft`, `nav-a`, `nav-evf`: the play session's bring-up
to the shooting screen, a menu open and close, two scripted menu sessions), `stage2` (the Player driven without HTTP or
threads: `play-perf`, `scp-timeout`, `scp-edge`, `evf-idle`, `eye-burn`, `switch-shoot`, `switch-scp`, `inputs`,
`a15-open`, `queue`, `power`, `scp-replay`, `power-replay`, `keys`, `b7-gate`, `tokens`, `playback`, `tokens-3b`,
`pace-wall`), `stage3` (`menu-open`, `menu-open-any`: a menu session in interrupt gate modes 1 and 2) and `all` (37
labs). `pace-wall` drives the Player with `--idle wall` under a frozen clock, so its pacing is kept in its outcomes
rather than removed. A session that opens more than one lab is traced as `NAME`, `NAME#2`, `NAME#3`. A scenario that
throws (a FirmwareError, Unported, a calls file the replayer cannot drive, or a bug) is reported and the others still
run; with `--trace` its partial trace goes to `<scenario>.partial.json` and the throw to `<scenario>.divergence.json`,
and the exit status is 1. `run.mjs --trace DIR` first removes the earlier trace, partial and divergence files of the
scenarios it runs, so a failed run never leaves an old trace behind.

**The checks** (`checks/check_*.mjs`), like `bin/debug.mjs`, `bin/play.mjs` and `bin/nav.mjs`, parse their command lines
with `checks/lib/args.mjs`: options are spelled in full, and an unknown option, a missing or malformed value or a usage
rule of the check's own prints `PROG: message` and the usage line on stderr and exits 2. check_perf's `--play`, which it
does not implement, is refused that way with the reason. An uncaught error prints its stack and exits 1.
`checks/runs.json` lists every run with the exit status it must give, its own environment variables, the output files it
must write and, for a fault-point run (`OM_FAULT`), a line its output must hold; `bin/checks.mjs` runs them and
judges each on its own exit status. `OM_MACHINE` sets the machine options of every lab a check makes, as white-space
separated `mutant=N` (a negative control) and `oneInsn=0|1` (the one-instruction mode); run `irq-xm28` sets `mutant=28`.
`--write-notes` writes into `OM_NOTES_DIR` and is refused without it; output files go under `OM_CHECK_OUT` (default
`emu/out/checks/js/manual/`). A check that declares a notes file compares its observations with
`checks/fixtures/check_*_notes.txt`, pinned from emu's own run. PNGs are compared by their pixels, never by their bytes.
check_menu's and check_nav's `--jobs N` run the sessions in N `worker_threads`; `--mutants` runs the check as a node
child under each mutant; check_menu's and check_nav's first check that a child spinning on `bra .` and killed on timeout
leaves no child process and no temporary directory.

## The firmware map

`bin/fwmap.mjs` measures how much of the E143 main block emu runs, per source module and per subsystem block, so that a
modelling step can be measured against the one before. Its subcommands (default `all`, the three in order):

```sh
node emu/bin/fwmap.mjs static          # the static map: functions, their modules and features (a few seconds)
node emu/bin/fwmap.mjs cover           # golden's workload under OM_COVERAGE, and the union of what it ran (about 4 min)
node emu/bin/fwmap.mjs report          # the map joined with the coverage and the labels: emu/out/fwmap/E143/report/
node emu/bin/fwmap.mjs cover --scenarios shoot-tft,menu-tft --checks none     # a smaller workload
node emu/bin/fwmap.mjs report --without-mutants --top 20
```

**static** (`fwmap/discover.mjs`, `fwmap/static.mjs`) finds the code by recursive descent from the reset and CPU 1..3
entries, the static task tables and the interrupt vectors, then from validated code pointers (`mov imm32` in code,
aligned words in data, jump tables), each kind of evidence drained before the next, and splits it into functions. A
function's module is the source file whose `__FILE__` string it loads, or a `Class::method` string's class; the
functions between two of one module take it (contiguity, call affinity at the edges), and what is left forms gap
pieces named `gap@<first entry>`. The instruction lengths are emu's (`src/core/cpu.mjs insnLength`); the validity of an
encoding is the ISA spec's (`fwmap/isa.mjs` says why not `step()`'s). The map is a function of the image and
`fwmap/E143.seeds.json`, executed instruction starts the static phases miss, pinned; `static --update-seeds` re-derives
them from the last cover run. On E143: 102,803 functions, 5,186,071 instructions, 2,629 modules (1,217 named).

**cover** runs `node emu/bin/run.mjs all` and `node emu/bin/checks.mjs --jobs 4` (every run of `checks/runs.json`, the
mutant and fault-injection runs included) with `OM_COVERAGE` set, and takes the union of the per-thread files
(`checks/lib/coverage.mjs`). The machine option behind it, `coverage` (`src/machine.mjs`), marks every pc the CPU runs
(at its decode into the cache and at every helper step) and every stand-in that fires; without it nothing changes,
`golden.mjs check` included. `OM_COVERAGE=DIR` works on its own for any lab made through `labEnv`, `bin/run.mjs` or
`bin/playperf.mjs`; children and worker threads inherit it. It shares `emu/out/checks/js/` with `checks.mjs`, so do not
run it beside `checks.mjs` or `golden.mjs`.

**report** writes, under `emu/out/fwmap/E143/report/`, `functions.jsonl` and `modules.json` (each function and module
with what ran of it, the direct call sites that ran, the stand-ins at it), `regions.json` (each MMIO region the code
names, with emu's model status), `lists.json` (the largest modules never entered, the ones a running caller did not
call, the ones that touch unmodelled MMIO, the functions stood in for), `blocks.json` and `report.md`, and prints the
table by block. The blocks come from `fwmap/E143.labels.json`: per module a subsystem block, whether its code is
gap-relevant (code a native path would still have to reach), the evidence and a description, written by agents from
the map. The labels are keyed by the static pass's module names, so a change to discovery or attribution (or to the
seeds) that renames modules needs them re-keyed: report lists the modules without a label and the labels without a
module, and `test/test_fwmap.mjs` fails until both are empty. Only E143 is supported (`--model` refuses others).

## The debug API

`bin/debug.mjs` is the command-line debugger (`--entry`, `--stop`, `--reg`, `--write`, `--read`, `--step`, `--stack`,
`--trace`, `--insn-limit`; `--image` defaults to the ND128 candidate's main code, built in memory from the E143 main
block and the patches in `artifacts/nd128/manifest.json` as a patch overlay, below; `--patch FILE` runs the stock main
block with a patch file's patches instead). It also has
`--watch ADDR:LEN[:r|w|rw]`, `--exec-trace PATH` with `--trace-mode native|one-insn`, `--mmio-trace PATH`,
`--irq-trace PATH`, `--disasm ADDR:LEN` (through `tools/mn10300-objdump` or `$OM_OBJDUMP`) and `--max-ms N`.
`node emu/bin/debug.mjs --serve` reads one JSON request per line and answers one per line, for scripts, for
example:

```
{"id": 1, "op": "load", "image": "unpacked/E143/OLY_E_143_1900_0000_0000.BIN.blk00000000.OE.0100.bin"}
{"id": 2, "op": "reset", "regs": {"pc": "0x502d0336", "d3": "0xa2022000"}}
{"id": 3, "op": "watch", "list": [{"addr": "0xa2022000", "len": 2, "kind": "w"}]}
{"id": 4, "op": "cont", "stops": ["0x502d0341"], "maxMs": 5000}
```

The ops are in `src/debug/protocol.mjs`. The library behind both, `src/debug/debugger.mjs`, is Worker-safe: a standalone
machine or a running lab session's Simulator, registers and memory, continues with a budget or a wall-time limit, single
steps, watchpoints per virtual address (stop or log), exec, MMIO and interrupt traces, lab time, and in-memory
snapshots. The exec trace has two modes: `one-insn` runs every instruction as its own one-instruction block (the
machine option `oneInsn`), `native` (the default) keeps the untraced run's interrupt timing; both write the line format
of QEMU's `-d exec` log (the protocol's trace format `qemu`; `jsonl` is its other).

A client has to plan for three behaviours. A `cont` whose pc is on a breakpoint (after a break stop, or a watch stop
that ended on a breakpoint pc) returns `break` at once without executing anything, so `step` first. After `abort` the
machine is gone: every op, `reset` included, fails with `Aborted` until the next `load`; `halt` instead ends a paused
continue where it paused (stop `halt`) and leaves the machine runnable, as after a breakpoint stop. While a budgeted
or `maxMs` continue is paused, every op that would change the machine or its run is refused until `resume`, `halt`
or `abort`: `break`,
`step`, `cont`, `watch`, `snapshot`, `restore`, `reset`, `setRegs`, `setReg`, `write`, `cpuStore`, `lab` other than
`time`, an `exec` trace and `trace {off}` (which turns the exec trace off too); the reads (`regs`, `reg`, `read`,
`stack`, `stderr`, `watchLog`, `stats`, `disasm`, `lab {time}`) and `mmio` and `irq` traces are allowed.

Requests are handled one at a time: a `cont` or `resume` without `budget` or `maxMs` runs until a stop, a fault or the
insn limit, and no later request, `abort` included, is read meanwhile, so give `maxMs` to keep control. `stack` dumps
upward from the current SP, or from `at` (a task's saved SP); `initialSp` only tags the line at that address. A `jsonl`
trace writes addresses and values as `"0x..."` strings, as the responses do; a `trace` request that fails changes no
file and no running trace; a trace restarted on its own file starts empty, two keys of one request may name one file
(their lines interleave), and a file another running trace writes is refused. The watch log keeps the newest hits (at
200,000 it drops the oldest half): `watchLog {limit?}` takes at most `limit` entries (default 100,000) off it and says
how many are `more` and how many were `dropped` since the last call. A standalone machine keeps its last 1,000 to 2,000
stderr lines: `stderr {since?}` answers from the oldest line still kept, with `first` and `dropped`, and a run's own
`stderr` field is its last 1,000 lines, with `stderrDropped` when it wrote more. `disasm`'s `n` is a byte count, not an
instruction count, and each returned line is one whole instruction. A watch stop's `watch` record and the `watchLog`
entries give `kind` as a number (1 read, 2 write, 3 both), where the `watch` request takes `r`, `w` or `rw`. A field
of the wrong shape is a `BadRequest`, never a JS error or a silent truncation: an address outside 0..2^32-1, a register
or stored value outside 32 bits (signed or unsigned), a count that is not a non-negative integer (`step`'s `n`,
`disasm`'s `n`, a watch's `len` and a `budget` positive), a list field (`stops`, `pcs`, `list`) that is not a list,
`regs` or a watch entry that is not an object. A trace's `filter` keeps fewer lines: `{exec: {from, to, pcs}, mmio:
{from, to, dir}, irq: {kind, irqs}}` (a pc range or list; accesses overlapping an address range, one direction; one
kind of interrupt event, or the presentations of some IRQ numbers); the top-level `from` and `to` are the exec
filter's. On a lab session's Simulator (`Debugger.attach(sim, {lab})`) breakpoints are refused, because the harness
owns the breakpoint list and takes any stop as its own, and so are stopping watchpoints unless a host routes the
stops (the live route below); the watch log's entries there also carry `lab_ns` (the lab clock at the hit) and `n`
(the hit's number since attach, dropped hits counted).

What the traces and stops show at the edges (`test/test_debug.mjs` traceRuleUnits, firmware-free, 2026-10-29): an
instruction whose code fetch faults writes no exec line in either mode (the fault is 2 at its pc, with the first byte
the fetch cannot read as the address, and does not count); the MMIO trace has a line per access to a device or the lab
stub and per write to a ROM device, at the access's own size and value (a `movhu` store traces the register's low
halfword), and for code run from the lab stub a size-1 line per code byte read (the translator's reads of every byte,
then the helper's), but none for CPU or debugger accesses through the bus window's pages off bus DRAM (a live-view
range there is RAM, an unbacked one a bus fault); a stopping watchpoint hit by an interrupt entry's stores (the PSW and
pc it pushes below SP) ends the continue after the entry, before the handler's first instruction: the registers are
the handler's entry state, the hit's `pc` and `insns` those of the interrupted instruction, as the entry is not an
instruction of its own, and a continue from there runs as it would have without the watchpoint. Stopping there, rather
than after the handler's first instruction, keeps the stop next to the access, as a watch stop after an instruction
is, and leaves no instruction run between them whose own hits a stop would hide.

**A running play session (the live route).** With `--debug-api`, `POST /api/debug` (the `X-Token` header, as every API
request) takes one request of the JSON-lines protocol and answers its response object once it ran; `node
emu/bin/debug.mjs --attach 'http://127.0.0.1:PORT/?t=TOKEN'` (the URL `bin/play.mjs` prints) sends its stdin's lines
there in order and prints the answers, as `--serve` does. Without `--debug-api` the route answers 403 and a `{type:
'debug'}` input on `/api/input` is refused. The requests are inputs on the session's own queue (`src/debug/live.mjs`):
the Player runs them between ticks, outside the session log and the GUI's event gate, through `Debugger.attach(lab.sim,
{lab})` on the current session (a restart starts with a fresh debugger), and nothing of the route runs before the first
one, so an unused route changes nothing (the golden runs are identical). The reads and memory writes of the protocol
work (`regs`, `reg`, `setReg`, `setRegs`, `read`, `write`, `stack`, `stderr`, `stats`, `disasm`, `watchLog`, `trace`,
`lab {time}`), plus `tasks` (the kernel's tasks: id, entry in the disassembly notation, state, priority, saved SP, the
running one), `standins {limit?}` (the last harness stub calls by name, the camera application's stand-in actions,
the stand-ins in use), `dml` (the DML engine's model on the E143 board: its run count, status and the newest run's
register image, S-DML), `pdt` (the PDT / TRC unit's model on the E143 board: per engine its run count, status and
the newest run's parameter image, S-PDT) and `ems1` (the EMS1 engine's model on the E143 board: its run count, status
and the newest run's start word, channels and parameter image, S-EMS1); `load`, `reset`, `cpuStore`, the snapshots,
`abort`, `quit` and `lab` time moves are refused. Run control:
`halt` pauses the session at the current tick boundary (phase `debug`; only debug inputs and controls run, the
other inputs wait in the queue in their order); `break {pcs}` and a stopping watchpoint make a debug stop inside a tick,
where the session is held (the harness's continue or step waits in the Simulator's debug hook) while debug inputs run:
`step {n?}` single-steps there (no interrupt accepted; it stops before an instruction at one of the harness's own
breakpoints, `harness: true`, which a `cont` then lets the harness take); `cont {stops?, maxMs?}` runs on and answers at
the next debug stop or halt (stop `break`, `watch` or `halt`, the registers, the watch hit, `lab_ns`, `at: run` or
`tick`, the stderr lines since), `maxMs` halting at the first tick boundary after that much wall time; `resume` runs on
and answers at once; `detach` turns breakpoints, watchpoints and traces off and runs on; `state` says where the session
is. A control (restart, power, quit) during a debug stop lets the stop go (its breakpoints and stopping watchpoints
cleared) and runs after the tick; during a halt it runs at once. A debug stop waits for the next input inside the tick,
which needs a blocking input queue: the node server's has one, the browser player's Worker does not, so there
(`/api/debug` on its router) `break`, `cont`'s `stops` and stopping watchpoints are refused while `halt`, the reads and
log watchpoints work, and trace files and `disasm` are not offered. Stepping and setting registers inside a tick can
leave the harness in a state it did not expect; that is the user's to judge.

The open items are in `docs/ROADMAP.md` "Debug API follow-ups".

## Patch overlays

`--patch FILE` on `bin/play.mjs`, `bin/nav.mjs` and `bin/debug.mjs` runs the firmware with a patch file's byte patches,
applied in memory to the stock blocks after their `MODELS` digests are checked; nothing is written to disk and the
blocks in `unpacked/` stay as they are. The option repeats: the patches of every file given are checked together.
The browser player's start option Patch takes one file the same way, in the Worker (the file is read in the browser and
neither uploaded nor cached). `bin/modelcheck.mjs` takes none: it runs many bodies, and a patch file is for one build.

```sh
node emu/bin/play.mjs --patch mine.json                         # the player on the patched firmware
node emu/bin/nav.mjs --patch a.json --patch b.json 'MENU DOWN'   # two files, checked together
node emu/bin/debug.mjs --entry 0x502d0336 --stop 0x502d0336 --patch mine.json --read 0x62020f20:16
```

A patch file is JSON: a list of patches, or an object whose `patches` is one. A patch is `{block, offset, old, new,
label?}`, `old` and `new` base64 of one length, as the templates of azqeurio/om-c-firmware give them, or the ND128
manifest's `{decoded_body_offset, before, after}` (hex, the main code block). `block` is the index in the `.BIN`'s
container (0 the main code block, 1 the resource block where it follows the main block, as on every body of
`src/fw/models.mjs`) or a name: `main`, `resource`, or a block file's name holding its `blk<offset>`. `offset` (an
integer or `"0x..."`) is into the block's body as unpacked, before `src/fw/expand.mjs`, so on E143 the run-time address
is the offset plus `0x60021020` and the disassembly notation's the offset plus `0x50000000`. The lab loads two blocks,
so a patch may target the whole main code block and the part of the resource block the lab reads (its prefix,
`src/fw/resprefix.mjs`: 9.6 MiB on E143); another block is refused.

The overlay is refused, with the reason and exit 1 before any lab starts, unless every file can be read, every patch
is well formed, every patch's `old` bytes are the stock block's at its offset, no two patches overlap (across files
too) and each lies inside what the tool loads (`src/fw/patch.mjs`; debug.mjs loads the main code block alone, so it
refuses a patch to the resource block). The browser player refuses its start likewise, also when it could not read the
chosen file. A patched run says so everywhere it reports: a `play: patched firmware: ...` line on stdout (nav's
`patched: ...`; debug.mjs's `debug.mjs: patched: ...` on stderr) with the count, the bytes changed and each patched
block's sha256 next to the stock one; the player's status and `GET /api/session` carry the summary as `patch` and the
page shows it as a red line under the status bar; session.json has it as `patch` (it is not among the session's
`args`, so a `--replay` of a patched session needs `--patch` again: without it play.mjs refuses the replay, exit 1
before the server starts, rather than run its inputs on the stock blocks; a session.jsonl records no patch);
debug.mjs's JSON has `patch`, and `--serve`'s `load` without an image loads the patched block (its response's `image`
is `patched: FILE...`). A play server with `--patch` refuses a model switch, and debug.mjs takes `--patch` neither with
`--image` nor with `--attach`.
The patch files are the user's: none is committed here, and the tests write their own (`test/test_patch.mjs`).

## The browser player

`web/index.html` is the player's page (`web/play.html`) running the lab in a module Worker (`web/worker.mjs`). Serve
`emu/` from any static server on localhost (for example `python3 -m http.server -d emu 8000 --bind 127.0.0.1`), open
`http://127.0.0.1:8000/` (the landing page, `emu/index.html`) or `http://127.0.0.1:8000/web/index.html`, and choose the
camera's firmware file or drop it anywhere on the page (the page names it: E143's is
`OLY_E_143_1900_0000_0000.BIN`). The Worker reads it block by block (`src/fw/olyfw.mjs`: the container walk,
descramble and checksum), keeps the main code block and the part of the resource block the lab can read
(`src/fw/resprefix.mjs`, 9.6 of 58 MiB) and, on E143, an extract of the NAND blocks the play bring-up loads the
resource tables from (`src/fw/labfw.mjs` labNand: the heads, the indexes and the records of at most 64 KiB, 3.3 MiB,
checked against its digest in `src/fw/models.mjs` res_nand), and caches all three in the browser's Origin Private File
System, so a later visit starts with "Start from the cached firmware" (a cache made before the extract existed is not
used: the `.BIN` is asked for again). Nothing is uploaded.

The query string takes the player's options (`?idle=off`, `device=evf`, `a15=on`, `touch=driver`, `start=menu`,
`tab=7,5,1`, `debug_api=1`, `hdmi=on`, `audio=off`, ...); the default is `--idle wall`. The start options above the
camera set four of them before the start and keep them in the query: the HDMI port (`hdmi=on`), the lens natively
(`lens=native`, the Worker's `env.lens`), the settings kept in this browser (on by default, as `bin/play.mjs` keeps
them; `nvram=0` when "Keep the settings" is unchecked, for a blank camera: S-NVRAM's document, as the node player's
file holds it, in OPFS under `nvram-<model>`, apart from the firmware; "Forget the kept settings" removes it; a body
whose build lacks S-NVRAM's sites runs blank and the page says why; `web/nvram.mjs`) and the card's size
(`card_size=GiB`, as `OM_EMU_CARD_SIZE`: the Card menu's 64 or 128 GiB
SDXC card, in memory for the Worker's life; a size the card does not take fails the start with its reason). The page
runs one model, E143 unless `?model=CODE` names another of `src/fw/models.mjs` (the page's model menu reloads it with
that parameter): the Worker compares the main code block and the resource prefix with that model's sha256
(`src/fw/labfw.mjs`) before it caches anything (one OPFS directory per model), so any other `.BIN` (a newer release, or
another body's) is refused with a message that names the file the model needs, and the file input is offered again. With
`debug_api=1`, the `WINDOWS` token is refused before it runs anything (its layers carry zlib's level-6 deflate, which
the Worker does not have); `STORE` and the other tokens run as in `bin/play.mjs`. Quit ends the session; the page then
stops polling and says so.

The Worker runs the Player as the server's lab thread does (`web/driver.mjs`: tick, then wait for a message, the pacing
target or 20 ms) and answers the page's API calls with `src/lab/playapi.mjs`. The page swaps play.html's `fetch` for
`web/page.mjs`, which answers the status and frame long polls from what the Worker pushes (every status, the newest
frame as RGBA, the session log) and sends every other request to the Worker. The message protocol is in
`web/worker.mjs`'s header. `web/gate.html` and `web/runner.mjs` are `bin/webgate.mjs`'s Worker-side runner.

**Where the firmware comes from.** The page's "Where to get" panel names the model's `.BIN`. OM System's support site
offers no `.BIN`: its update tools (OM Workspace, OM Image Share) fetch it from the vendor's updater API. Neither that
API nor the signed CDN URL its reply names sends CORS headers, so a page on another origin cannot fetch the file, and
the player goes through no relay (the headers seen on 2026-10-29 are in `docs/firmware-container.md` "From a web
page"). The panel instead shows `src/fw/updater.mjs` `fetchCommand()`, a one-line curl command for macOS and Linux
that asks the same API and saves the `.BIN` under its own name in the current directory. It also names `fetch-fw.mjs`
for a clone. The API serves each body's latest release only, so a release newer than the model's is refused with
the name of the file the model needs.

**The published site.** `node emu/bin/site.mjs DIR` writes the static site. It holds `emu/index.html` (the landing
page, which links to the player and says that the firmware stays in the visitor's browser) and exactly the files the
player loads, found by following every relative reference from the landing page (`--list` prints them: 131 files,
2.7 MiB on 2026-11-02, all under `web/`, `src/`, `scenarios/` and `refs/`). It holds no firmware, nothing of
`emu/out/`, no test or node-only module and not `web/gate.html`. A reference that is absolute (it would leave the
site's sub-path), bare, outside `emu/`, into `out/` or of another file type stops the build. The site needs no server
code and no custom headers (no COOP/COEP: the Worker uses no SharedArrayBuffer, and OPFS's sync access handles need
none), only a JavaScript content type for `.mjs`. `.github/workflows/pages.yml` runs on a push to `main`, the public
repository's branch, or by hand: it runs `test/test_site.mjs`, builds the site and deploys it with
`actions/upload-pages-artifact` and `actions/deploy-pages` to the repository's project site,
`https://<owner>.github.io/<repo>/`. For the public repository that is `https://flatpanda.github.io/om-emu/`. The
repository's Pages source must be set to "GitHub Actions".
`OM_FW_DIR=fw node emu/bin/sitegate.mjs` builds the site and serves it under `/om-emu/` from a plain static server
(GitHub Pages' content types, nothing else). In headless Chrome it then opens the landing page, follows its link,
checks the firmware panel, chooses the `.BIN` through the file input and waits for the shooting screen (GUI `0x0108`).
A second page started by dropping the `.BIN` must reach it too. Every request must be a body-less GET under the
prefix, every answer a 200, and no page or Worker may throw. Screenshots go to `emu/out/web/site/`.

**Other browsers.** `OM_FW_DIR=fw node emu/bin/browsergate.mjs` runs the same site in headless Firefox and in WebKit
(WebKitGTK's MiniBrowser, the engine Safari is built on), driven over W3C WebDriver (`host/webdriver.mjs`, node's
`fetch`, no npm packages): the landing page and its link, the `.BIN` by the file input to the shooting screen, the
canvas read back equal to the RGBA the Worker sent, webgate's keys and touch (M, Down, M, a press on the monitor,
Enter) each with its GUI state, a picture taken (S1, S2) and read in the Card panel (thumbnail and view), LV to the
EVF and back (its 1600 x 1200 canvas read back as the TFT's), the pace at
`--idle wall`, a second page from the OPFS cache, and E144 by `?model=E144` with its own `.BIN`. Firefox 159 runs all of
it with no change to the page. WebKitGTK ships the Storage API off, so it has no `navigator.storage` and no OPFS: the page then
runs from the `.BIN` alone (`web/opfs.mjs` `unsupported()`), says at the start that the firmware is not cached and why,
offers no cache, and disables "Keep the settings"; a browser whose OPFS is there but refuses runs the same way with
the error named. `--browser webkit-storage` switches WebKitGTK's Storage API, OPFS and access handles
on, as Safari ships them: in WebKitGTK 2.54 its `getDirectory` rejects in an automation session (UnknownError) and its
`createSyncAccessHandle` is not supported outside one, so Safari's own cache path is untested
(`docs/model-survey.md` findings 77-79). Safari itself on macOS is driven by `safaridriver`, which its user must enable
once (`safaridriver --enable`, an administrator's password, and Safari's Develop menu > Allow Remote Automation, with
the Develop menu shown from Settings > Advanced); the gate has no Safari entry. Screenshots go to
`emu/out/web/<browser>/`.

## Layout

- `src/`: the machine and the harness, with no node APIs, so that it runs in a Web Worker. `core/` the CPU, the
  interpreter and the one machine buffer, and `core/m4/` the SCPU's Cortex-M4 core with its STM32L4 peripherals and
  machine in `core/m4/periph/`; `dev/` the devices; `machine.mjs` the board and its gdbstub-equivalent API (with budgeted continues: `cont({budget})`, `resume`, `abort`); `lab/` the harness (the HLE layers, the native
  kernel, display, text, menu, navigation, the play session, the Player, the camera application's stand-ins, the
  scene and its subject frames (`subject.mjs`), the accelerometer's stand-in, and the card with the file system: `sdcard.mjs`, `storage.mjs`, `media.mjs`, `jpeg.mjs`); `fw/` the `.BIN` unpacker, the model table (`models.mjs`), the per-model address tables (`ports.mjs`, written
  by `bin/port.mjs`), the cross-build map (`xmap.mjs`, `place.mjs`), the firmware rules (`facts.mjs`) and the boards
  (`board.mjs`); `debug/` the debug API; `trace/` the trace writer; `util/` sha256 for the Worker, bytes and hex text
  (`bytes`, `hex`), counts (`tally`), value text and equality for messages and checks (`show`, `equal`), the numbers
  of the lab's text inputs (`parse`) and the trace and digest JSON (`tracejson`). Values are plain JS values
  throughout; the Player's HTTP API and session logs are plain JSON (`JSON.stringify` / `JSON.parse`).
- `refs/`: the checks' independent references (the menu reference with its raster and navigation rules, the font, the
  settings tables, the OSD bitmap format, the MT19937 generator with CPython-compatible seeding (`mt19937`), the
  reference compositor and register formulas, the live-view formulas, the ISA and interrupt expectations, a FAT reader
  `fat.mjs`, an exFAT reader `exfat.mjs` with the same surface and `volume.mjs` to pick one by the card's boot sector,
  and a baseline JPEG decoder `jpeg.mjs` for the card's files), Worker-safe and importing only `refs/`.
- `checks/`: one node command per check, `checks/lib/` their helpers, `checks/runs.json` the run table.
- `scenarios/`: the scenario replayers (`kernel.mjs`, `osd_replay.mjs`, `session_replay.mjs`, `bind.mjs`) and the
  replayed scenarios' inputs (`scenarios/calls/`).
- `bin/`: the command-line tools. `host/`: the node hosts of the player and the scripted menu tool. `web/`: the browser
  player (page, Worker, driver, frame conversion, OPFS cache, S-NVRAM's browser host) and the players' card reader
  (`cardfiles.mjs`, which the node host's lab thread uses too), importing only `src/`, `scenarios/`, `web/` and `refs/`
  (the card's FAT reader and JPEG decoder, which `src/` may not import).
- `fwmap/`: the firmware map's library (`bin/fwmap.mjs`: the ISA view, discovery, the static map, the coverage run, the
  report, the block aggregation) and its E143 data: the module labels (`E143.labels.json`) and the pinned discovery
  seeds (`E143.seeds.json`).
- `test/`: the test suites (`bin/test.mjs` runs them) and their fixtures (`test/fixtures/isa_vectors.json`);
  `checks/fixtures/`: the checks' pinned data; `golden.json`: the regression reference.

`src/` and `scenarios/` import neither `refs/` nor `checks/`; `test/test_pure.mjs` checks the import rules and that the
Worker-side modules use no node API. Paths that are not modelled throw `Unported` with their source name.

**Interrupt acceptance** is not checked at every instruction: a pending interrupt is looked at only at the start of a
continue, after a helper RTI or PSW write, after an instruction run as a one-instruction translation block (TB: the PSW
write window, irq_wait, the last 64 instructions before the insn limit, or every instruction with the `oneInsn` machine
option), and once more after an instruction that raised the request. Where a look would depend on a TB layout or TB
cache that emu does not model, `src/core/interp.mjs` refuses (`TbUndecidable`) instead of guessing, and the continue
ends with a stop of kind `undecidable`; `test/test_irq.mjs` checks those refusals unsliced and in slices. A budgeted
continue pauses only where no look is pending, so a chain of slices takes exactly the looks of one continue. CPU faults
write trap lines prefixed `om-emu:` to stderr, and a FirmwareError message ends with them (golden pins the check runs
that print them). FIDELITY-NOTES 2.1-2.3 say where this departs from the hardware.

## Data

Firmware images and unpacked blocks stay outside git (`fw/`, `unpacked/`; see `BLOBS.md`), and what a run produces
(traces with register and memory images, device vectors, frames) is written to `emu/out/`, which is gitignored. None of
that is committed or published with this code; composites appear in traces only as sha256. The repository does hold
small derived data: the VSC register and name table `checks/fixtures/om1-vsc-regs.h`, the digests and short recorded
observations of `checks/fixtures/` and `golden.json`, the replayed scenarios' inputs in `scenarios/calls/` (call
arguments: keys, options, lab-time targets, addresses; no firmware bytes), the firmware map's module labels and seeds in
`fwmap/` (module names, addresses, descriptions with short strings), and the addresses, tables and short excerpts in
`docs/` and `analysis/`. The browser player takes the firmware only from the user's own file and keeps the unpacked
blocks only in that browser's Origin Private File System; the page embeds no firmware, and `bin/webgate.mjs` checks that
it sends nothing but GETs for its own files.

### Publication audit

`bin/pubaudit.mjs` checks what a push would publish: every blob in a ref's history (each blob once, with every path
it was committed at) and every commit's identity and message. It fails (exit 1, with blob, path and commit per
finding) on forbidden paths (`fw/`, `unpacked/`, `emu/out/`, `*.bin`, `.claude/`, scratch, key and ignored files),
blobs over 1 MiB, content that is not text, home and temporary directories, email addresses, tokens and keys, long
hex or base64 runs, commits by an identity that is not noreply, and firmware: any 47 bytes or more of a local `.BIN`
(descrambled) found in a binary blob or decoded from text (hex runs, number lists, base64, listings), or a run of
quoted firmware text over 128 bytes. Short listings (up to 512 matching bytes per file) and quoted strings pass. The
rules and the reviewed exceptions (`ALLOW`, each with its reason) are in the tool's header. Names that must never
appear can be added locally with `git config --add pubaudit.marker TEXT`; they stay in `.git/config`.

Before each push to the public repository, audit only what is not public yet:

```sh
git fetch https://github.com/flatpanda/om-emu.git main    # FETCH_HEAD: what is already published
node emu/bin/pubaudit.mjs release --since FETCH_HEAD       # the commits about to go out; push only when clean
node emu/bin/pubaudit.mjs release                          # the whole history: after a rule change
```

The firmware rule reads `fw/` (about 4 s for the 2.9 GB of `.BIN` files; `--fw PATH` for other places); without
firmware the run warns and skips that rule. `--explain N` prints what each firmware finding matched.

## Tests

| Command | What it covers | Needs |
|---|---|---|
| `node emu/bin/test-pure.mjs` (`npm run test:pure`) | the ISA vectors on both engines, the core's two tiers in lockstep and its length tables, the pure sha256 and JSON parser, the debug API's argument checks, halt, trace filters and live-route units and its trace rules and edge cases (halfword device accesses, code on the lab stub, the bus window, code-fetch faults, a watch hit in an interrupt entry), the browser driver's pure parts, the scene model, the lab's audio output (its events, queue and rings, `/api/audio` on the router and the browser page) and S-SHUTTERSND's clicks, the audio port's model, the sound IC's register file and the PCM sink (`test/test_audiohw.mjs`), the purity rule, the firmware rules (each unpacked main block checked against its `MODELS` entry when present), the firmware map's units, the SCPU clock, port words, the link's pins and the sub-CPU's model (S-SCPUDEV), the HDMI port's device and sink, the accelerometer stand-in's sample, the SD card model (SDHC and SDXC), PER_SIO's served IIC transfers' segments and the TG-5's charger (S-SIOIIC, S-CHARGER), the FAT reader, the exFAT reader on a volume the test builds and the JPEG pair, the players' Card panel and session options (the card reader of `web/cardfiles.mjs` on a FAT16 volume and an exFAT volume the tests build, the card routes and `/api/session` on a headless Player, the node server's PNG of a picture, `web/nvram.mjs`), the subject boxes and transform of `subject.mjs`, S-DML's register file, S-PDT's register file (`test/test_pdt.mjs`), S-EMS1's (`test/test_ems1.mjs`), the publication audit's rules on a throwaway repository, the patch overlays' rules on synthetic blocks and the `--replay` check of a patched session (`test/test_patch.mjs`), the resource tables' NAND (the container's blocks at their load addresses, the browser's extract, the sound area's builder, S-RESNAND's layer; `test/test_resnand.mjs`), the Cortex-M4 core's hand-written vectors and the differential vectors QEMU recorded for it, on both its tiers, and the two tiers in lockstep after every instruction with the decode cache's self-modifying-code cases and two mutants the lockstep must catch (`test/test_m4.mjs`, `test/fixtures/m4_vectors.json`), the SCPU's STM32L4 peripheral models one by one (`test/test_stm32l4.mjs`), and their flash programming, I2C slave and timer slave modes and the machine's low-power modes and flash programming on a synthetic image | node and git; runs on any checkout in a few seconds |
| `node emu/bin/test.mjs` (`npm test`) | all of the above, plus the decode-cache regressions, the VSC register, class and blend tables, the kick model's TB-layout refusals, the replayer's argument binding, the check runner and the checks' controls, the debug API's units, the browser player's parts and hosts (the Worker's card and session routes too), the node host (the Card panel's routes over HTTP: a picture's file and PNG, the card out and back), the command-line tools, the scene, one open and one close click per S2 in play spaced by the shutter time (S-SHUTTERSND, `test/test_audio.mjs`), the audio hardware on E143: AUD_MAIN natively and AUD_EXEC's play of a lab-made WAV through the audio port's model, IRQ 43 every 4 ms, the samples out unchanged, repeated plays and their release (`test/test_audiohw.mjs`), H-RESINIT's tables natively from the NAND, the erased and a host's sound area, the firmware's type-2 write read back (`test/test_resnand.mjs`), the AF beep end to end on E143 (two half presses, each one beep on the host's audio output, sample for sample S-SOUNDRES's; none with the beep Off or without S-AFLOCK; S2's clicks beside it), the camera application (and S-HEAP's live blocks bounded over an idle with either lens), the power manager and the power-off on E143, E146 and E147, `--patch` on E143 through `debug.mjs`, `play.mjs` and `nav.mjs` with a patch file the test writes (and the refusals: by all three of a file whose old bytes differ, an overlap and an unreadable file, by `debug.mjs` of a resource-block patch, by `play.mjs` of a patched session's `--replay` without `--patch`, and by the Worker of a patch whose old bytes differ or that the page could not read), an HDMI plug in play on E143, E146 and E147, check_level on E146, the card and the file system in play on E143 (a blank card formatted and mounted by the firmware, read back independently; the counts from the card; a picture's file written and found again; Card Formatting from the menu, read back; the card taken out and put back; the same on E146, and but for the menu and the card input on E147, E144, E142 and E134, each in a process of its own; blank 64 and 128 GiB SDXC cards on E143 formatted and mounted by the firmware, read back by `refs/volume.mjs`, S2's file found, Card Formatting from the menu and the card out and in on the 64 GiB card, what the firmware chose, the lab times and the counts printed as notes), subject frames DISP_FRAME draws from MDET's own frame table on the scene's rider while subject detection is on (after MDET's seven offers; at 4:3, 16:9 and 3:4, moving, on the EVF, `--replay`) and S-SUBJECT's with the mdet facts taken away (`test/test_subject.mjs`), CPU 3's MDET_DL natively from mdet_dl_start to dml_start_callback at each kind with S-DML's register images against the firmware's tables, and MDET's own subject record for the scene's rider from S-DML's records, TAKE's message 81 taking take_mov's LAF mode up and down, LAF's start and end through PDT's and TRC's tasks, the firmware's PDT / TRC drivers on S-PDT and its EMS1 driver on S-EMS1 (`test/test_mdet.mjs`), the Cortex-M4 core on the SCPU image from reset to its first unmodelled access (on both tiers and in lockstep, and the console prompt and `help` at the same cycle on both), the SCPU image on the STM32L4 machine to its console prompt, console commands, its standby and the wake-up (and its path to the standby at 3.03 s without a Stop, Shutdown or flash operation), the firmware map and the regression net's controls | the E143 firmware blocks (the SCPU block too; E146's and E147's for the HDMI plug and the card, E146's for check_level, E144's, E142's and E134's for the card) and `golden.json`; with `OM_FW_DIR=fw` also the unpacker against `unpacked/E143` and the Worker in a node worker thread (without it those count as failures) |
| `node emu/bin/golden.mjs check` | every scenario, every lab of the traced check runs and every check run's output against `golden.json`: what the panels show, what the devices see and what the checks conclude must not change | the firmware |
| `node emu/bin/checks.mjs [CHECK \| RUN ...]` | every run of `checks/runs.json`, judged on its exit status | the firmware |
| `node emu/bin/checktrace.mjs RUN [--slice N]` | the labs one check run creates, traced (golden records them) | as checks.mjs |
| `node emu/bin/bench.mjs SCENARIO --passes 5` | MIPS and cost per stop; exit 1 if a pass does not repeat pass 0 | the firmware |
| `node emu/bin/playperf.mjs` | the play workload on the Player; exit 1 unless its digest is `13fa8f7471592f8a` | the firmware |
| `node emu/bin/snapgate.mjs kernel-5c osd shoot-tft` | snapshot detours leave the sessions and the end state unchanged; detours run three times from one snapshot trace identically, a short one and one of at least 10,000 instructions per session (99,205, 200,002 and 103,598 on these three, 2026-10-29) | the firmware |
| `OM_FW_DIR=fw node emu/bin/sitegate.mjs` | the published site (`bin/site.mjs`) from a plain static server under `/om-emu/` in headless Chrome: the landing page and its link, the firmware panel, the `.BIN` by the file input and by a drop to the shooting screen, only GETs under the prefix, all answered; under a minute | the `.BIN`, Chrome |
| `OM_FW_DIR=fw node emu/bin/browsergate.mjs [--browser firefox\|webkit\|webkit-storage]` | the published site under `/om-emu/` in headless Firefox and in WebKitGTK over WebDriver (all three by default): the landing page, the `.BIN` by the file input to the shooting screen, the canvas against the Worker's RGBA, keys and a touch, a picture in the Card panel, the EVF's canvas, the OPFS cache on a second page (or, where the browser keeps none, the page saying why), E144 by `?model=`, only GETs under the prefix; about 2 min | the E143 and E144 `.BIN`s; geckodriver and Firefox, WebKitWebDriver, MiniBrowser and Xvfb (Linux) |
| `OM_FW_DIR=fw node emu/bin/webgate.mjs --rounds 4` | headless Chrome: the Worker against node and `bin/run.mjs`, the page (keys, touch, canvas, session log; the Card panel's read, Take out and Put in with a 64 GiB card picked by the Card start option, and the HDMI control without the port; the EVF layout's class and canvas size after LV to the EVF and back), no uploads; about 5 min | the `.BIN`, Chrome |
| `node emu/bin/modelcheck.mjs` | the ported models marked `checked` in `src/fw/models.mjs` (E146, E147, E148, E144, E139, E134, E137, E142, E140, E125, E130, E133, E145, E129, E132, E122, E118, E120), or those named: start (E145 and E129: then MENU at the date and time setting, E132: the clock set there by UP and OK on each field, `START_PROMPT`), S1, S2, PLAY, INFO, PLAY on the TFT, and start, S1, S2 on the EVF of a body with one (the whole path on the E118 family's, `EVF_PLAY`), then MENU, DOWN, MENU on both (the menu opened with the frame changed, DOWN moving in it, MENU back to the shooting state; on the EVF E146 and E147 expected to fail, MENU_EVF_XFAIL, strictly); GUI states by name; after S2 a frame of more than one value, the shooting screen back after the rec view; after S1 the count probe: the screen must change with the remaining-shots query's answer (S-CARD's count, or on a body whose card is native the firmware's, replaced for one window by the probe's own answer of the query) and only there, on a body whose application asks for the count only when its shooting screen is redrawn (E118, E120, E122: `PROBE_REDRAW`) with the screen redrawn by INFO through its views before each window; on a body whose card is native the card check: mounted, the shots counted from it, each picture's file found again by `refs/volume.mjs` (FAT or exFAT) with its size (all pass; a body expected to fail it goes in PROBE_XFAIL with its reason, strictly: a pass of an expected failure fails the run); `--card-size GiB` puts a blank card of that size in the slot (with an SDXC card E144 is expected to stop, SDXC_XFAIL, as strictly) | the models' firmware |
| `node emu/test/test_scpum4.mjs [--session]` | also in both suites above: the bridge that puts the SCPU's own firmware behind the link, its clock (A-SCPUM4-1), the frame log rebuilt from the wire against S-SCPUDEV's own, the byte mover through SPI2 and DMA1 (pure); with `--session` a play session's start with S-SCPUDEV and with the SCPU's firmware (`OM_EMU_SCPU=native`), whose frame log, transfers and pin levels must equal S-SCPUDEV's (`OM_EMU_MODEL=E146` for E146) | the E143 (or E146) firmware blocks and SCPU block for `--session` |
| `node emu/test/test_fwmap.mjs` | the coverage option off and on, the static map's determinism and headline, the labels' keys, `run.mjs` under `OM_COVERAGE` (also in both suites above) | the E143 main block for the second half |

What the tests compare with is emu's own data, and it is regression data, not a specification
([ARCHITECTURE.md](ARCHITECTURE.md), "Ground truth"): `golden.json` is recorded from emu by `bin/golden.mjs record`, the
checks' notes files and pinned results under `checks/fixtures/` come from emu's own runs, and the 5,322 ISA vectors
(`test/fixtures/isa_vectors.json`) are recorded vectors, fixed data that no tool in this tree regenerates. The replayed
scenarios' inputs (`scenarios/calls/`) are the other recorded data, replayed as inputs only. A checkout with the fetched
firmware runs every command above but `webgate` and `sitegate`, which also need Chrome, and `browsergate`, which needs
Firefox and WebKitGTK with their drivers.

An intended behaviour change updates a fixture only with a recorded reason and its evidence level (firmware code,
manual, camera). `bin/golden.mjs record` asks for both (`--reason`, `--evidence`) and writes them into `golden.json`'s
log. A change to the tooling alone is recorded with `record --tooling-only --reason TEXT`: it refuses (exit 2, nothing
written) when any session's screen or devices layer differs, and logs which layers of which sessions changed. A pinned
fixture under `checks/fixtures/` or `test/fixtures/`, or a pinned constant in a check, changes in the commit that
changes the behaviour, with its reason in the commit message.

Do not run `bin/checks.mjs`, `bin/checktrace.mjs` and `bin/golden.mjs` against the same output directories at the same
time: they share `emu/out/checks/js/` and `emu/out/js/check/`. Give a second checktrace its own `--trace DIR`.

## Performance

Measured on an Intel i7-1265U laptop (2 P-cores with 4 threads and 8 E-cores, 15 GB of RAM) under Linux with node
v26.11.1. Medians of alternating runs unless noted; MIPS are instructions per second of guest time.

| Date | What | Figure |
|---|---|---|
| 2026-10-10 | interpreter on the kernel and OSD sessions (`bench.mjs`, steady passes) | 34-36 MIPS unpinned; 31-34 on the P-cores, 20-22 on the E-cores; 53-56 in long continues only; the cold first pass 13-16 (V8 warm-up) |
| 2026-10-10 | cost per stop (harness, HLE stubs, machine API) | 29-34 us on the kernel and OSD sessions; 18-25 us on the play sessions |
| 2026-10-10 | the play bring-up sessions (`shoot-tft`, `menu-tft`, `nav-a`, ...) | 50-62 MIPS steady |
| 2026-10-10 | the play workload (`bench.mjs play-perf`) | 44 MIPS steady (bring-up 56-61, Player phases 28), 18 us per stop |
| 2026-10-10 | the play workload's phases (`playperf.mjs`) | 3.78 s; a whole process 7.16 s |
| 2026-10-10 | lab seconds per wall second, unpaced | shooting screen 3.75, menu 5.30, Super Control Panel 2.30 |
| 2026-10-10 | peak RSS of `run.mjs all` | 2.2 GB |
| 2026-10-13 | the debug API's hooks, off | no cost: `shoot-tft` 56.7 MIPS against 56.7 before the debug API, `play-perf` 43.5 against 44.2 |
| 2026-10-13 | headless Chrome 155 against node | `shoot-tft` 1.5x node's time, the workload's phases 1.08x; a paced page ran 10.12 lab s in 10.00 wall s; Chrome's memory 1.6-2.1 GB |
| 2026-10-13 | firmware loading in Chrome | unpacking the `.BIN` with the E143 check 0.85-0.88 s, the first OPFS write about 50 ms, a start from the OPFS cache 0.71-0.75 s |
| 2026-10-13 | `bin/test.mjs`, the whole suite | 742 s |
| 2026-10-20 | `bin/port.mjs all`, 17 bodies with every map from the cache | 52 s and 3.4 GB in one process; 119 s as one run per body |

A real-time player needs at least 1.0 lab second per wall second; the slowest phase measured, the Super Control Panel,
clears it about 2.3 times over unpaced on this host. Under load the figures drop: at a load of 3-6 the OSD session fell
to 16-17 MIPS unpinned (2026-10-10).
