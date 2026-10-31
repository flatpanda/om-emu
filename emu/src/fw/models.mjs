// The camera models the lab knows: each one's firmware release (the .BIN the vendor's updater API serves for its code),
// the two blocks the lab reads (main code, resources) and their digests (BLOBS.sha256 and the resource prefix). E143 is
// the build every address in src/lab is written against; another model translates those addresses through A()
// (src/fw/model.mjs, backed by src/fw/ports.mjs from bin/port.mjs and the cross-build map src/fw/xmap.mjs). `overrides`
// places an E143 address the map cannot (hex E143 address -> {to: hex address or null, why}). `panels`: the TFT and EVF
// sizes the VSC model composes at (the firmware programs the channel; these are the panels the vendor's specifications give).
// `image_base`: the run-time address of the main block's byte 0 (src/fw/model.mjs IMAGE_BASE), which import-time
// constants need before any image is read; src/fw/facts.mjs imageBase reads it from the reset head, and
// test/test_facts.mjs checks every entry whose block is unpacked against that rule.
// `res`: the size limits of the font and string slots the resource loader copies a language's records to (the `cmp
// imm32` after each slot's mov in the loader that follows the index read; E143's are 0xC7C00 at 0x501a8f35 and 0x5FC00
// at 0x501a9197, D), read through src/fw/model.mjs fact(). bin/port.mjs reads them on every model it ports
// (src/fw/facts.mjs resLoader, into src/fw/ports.mjs FACTS), so an entry gives them only until its port does.
// `port_via`: a model ported before whose hand overrides this one takes over through the map between the two builds
// (bin/port.mjs, src/fw/place.mjs carryOverrides), where they pair better than either does with E143 (the evidence at
// the entry); the model's own overrides come first. `carry`: the reference's knobs that hold addresses (src/fw/knobs.mjs)
// this model takes through the same map, each checked by its kind (src/fw/ports.mjs KNOBS, read through knob() in
// src/fw/model.mjs); a knob is either carried or given here.
// `board`: the board family (src/fw/board.mjs FAMILIES) and the facts this model gives by hand where its firmware's
// differ from the family's or no rule of src/fw/facts.mjs reads them yet, each with its evidence; a fact the port
// reads (FACTS[code].board) is not given here too. `checked`: in bin/modelcheck.mjs's default set, which it passes.
import { OVERRIDES_E144 } from './overrides-E144.mjs';
import { OVERRIDES_E122 } from './overrides-E122.mjs';

// The VSC register blocks the kind-1 compositor composes without (board vsc.unapplied; src/dev/vsccompose.mjs A21):
// the highlight block (HIAREA1..3, HIBC, HILIGHT1..4: 0x48c..0x494, 0x4cc, 0x5d0..0x5dc), which E147's playback detail
// turns on for its highlight and shadow warning, and the NV block (NVEN, NV11SET1..NV23SET6: 0x9a0..0xc54), which E147
// sets for its EVF (X). Open: what either does to the panel's picture; the composite shows the planes without them
const VSC_UNAPPLIED = [[0x48C, 0x494], [0x4CC, 0x4CC], [0x5D0, 0x5DC], [0x9A0, 0xC54]];

// H-G4SET not applied (src/lab/play.mjs g4set): UI_IN's group 4 is pushed like the other groups. A stand-in on the
// bodies that give it, while their group-4 producer (the port places E143's) is not checked: start and S1 run so (X)
const G4SET_UNCHECKED = false;

// S-NOPOWEROFF, retired 2026-10-23: the lab stepped over the power-off post in the PC sub-app state's USB-disconnect
// handler (fact power_off.usb_disconnect, src/fw/facts.mjs usbPowerOff) on eight E144-family bodies. The start had
// reached it because the idle image left the USB connection 0x0400 at "cable in" (and E144's and E137's power lever
// off): the application went to its PC state, ending the shooting service. With the power lever on and no cable
// (src/lab/play.mjs IDLE_SWITCH_STATES) no body's start reaches the post (X: E144, E139, E137, E142, E140, E125, E145,
// E130), so the call runs as the firmware's

// The movie time query's log on the shooting screen (E143's card_fs below, where it is read; E146's and E147's): its
// time code conversion finds the movie info's frame rate 0, the movie module's set-up not run in the lab
const MOVIE_TIME_ERRLOG = [0x39000903, 'the movie time query\'s frame rate is 0: the movie module\'s info is not set up in the lab (the time left is the card\'s)'];

// `scpu_port`: UI_IN's group 0 through the SCPU interface's port and event words (src/lab/play.mjs H-SCPUIRQ,
// H-UIINPORT, H-SCPUPORT; docs/hle-gaps.md 4.7.2), in the model's disassembly notation: irq [handler, level], the IRQ
// 320 handler the SCPU init attaches; register, the IRQ 320 callback registration; callback, UI_IN's callback, which
// its port init registers; old_state, the init of UI_IN's group-0 old state from the port byte, which UI_IN's start
// stage calls first. A body without it pushes group 0 as the other groups (S-KEYBITS)
//
// `hdmi`: the HDMI port (src/dev/hdmi.mjs with the board's hdmi; src/lab/display.mjs H-GIOSLOTS, src/lab/play.mjs the
// hdmi input; docs/hle-gaps.md 4.9), in the model's disassembly notation: gio_slots, the reset of the GIO interrupt
// slots the GIO init ends with (the init does not run in the lab; without the reset the display init's registration
// of the hot-plug pin finds no free slot and does nothing); state [address, bytes], the driver's EDID state, which its
// getter reads (0xf0 the EDID read and parsed, 0xff failed, 0 not read). A body without it has no HDMI port
//
// `acc`: the accelerometer, stood in at its sample cache (src/lab/acc.mjs H-ACCINIT, S-ACCREG, S-ACCSAMPLE,
// H-SLOPEINIT; docs/hle-gaps.md 4.7.3), in the model's disassembly notation (data at run-time addresses): init, the ACC
// module init, run natively with its device part, the call at device (the data-ready pin's set-up and the register
// API's kernel objects), stepped over; ptrs [counter slot, copy slot], the two pointers the init stores (the sample
// counter's address and the cache copy's run-time address); main, ACC_MAIN's entry (task 121, which the init starts);
// probed, the halfword ACC_MAIN sets to 1 after a successful probe; reg {open, read, write, close}, the sensor's
// register API, and dev [channel, device], what the probe opens; who_am_i [register, value], the probe's read and the
// value it wants; setup, the probe's register writes [register, value]; copy and correct, the cache copy and the
// correction ACC_MAIN calls each cycle; words [accelerometer x/y/z, temperature], the halfwords the sample read's
// completion packs, and counter, the sample counter it increments; refs, the six pose references the init computes
// (pose 0 is the level camera); axes, the axis order and polarity the remap reads; slope {init, main, get}, PER_SLOPE's
// init, its task entry (task 78) and the gauge's getter. A body without it keeps the accelerometer and PER_SLOPE off
// (the gauge reads the BSS)
//
// `sio_devices`: the devices on PER_SIO's channels the lab has, [{channel, device}] (src/lab/sio.mjs S-SIOIIC and
// H-SIOMAP; a device name of its DEVICES, 'charger': src/lab/charger.mjs S-CHARGER). A body without it runs PER_SIO's
// channels natively against lab-stub pages, its channel map unset
//
// `modack_queues`: the module queues of the body's API target table that E143's has no counterpart of, [queue id,
// its name in the object-name table], which S-MODACK answers too (src/lab/camapp.mjs module_queues)
//
// `heap_pool`: the firmware heap's block get and release of its pool 2 (get, put, the pool's block bytes), which Level
// Adjust's sampling loop calls instead of malloc and free; S-HEAP (src/lab/play.mjs), whose memory is that pool's,
// serves them too. A body without it runs them natively
//
// `card_fs`: whether the card's file system runs natively (src/lab/storage.mjs; docs/hle-gaps.md 4.8.4): native, at
// the seams src/fw/facts.mjs fileSystem reads (fact storage); errlog, the error logs its card's queries make in the lab
// (src/lab/display.mjs EXPECTED_ERRLOG); hls, the HLS media side's addresses (src/lab/media.mjs: Card Formatting from
// the menu, the card out and in; E143 and E146). Every body gives it, one that does not run it with its reason (why);
// such a body keeps S-CARD's card without a file system (src/lab/camapp.mjs)
//
// `ui_out`: UI_OUT, the module of the camera's lamps, where the lab runs it (src/lab/play.mjs H-UIOUTSTART: E134,
// whose file layer asks it for the card's access lamp): init, its init's entry, and task, its static task's entry. A
// body without it does not run UI_OUT
// `lens_native`: the lens on the mount runs natively, the default (src/lab/lens.mjs with S-LENSMCU; OM_EMU_LENS=stand-in
// takes S-LENS; docs/hle-gaps.md 4.4.2), on a body whose card's file system runs too; the driver's addresses are read
// by src/fw/facts.mjs lensDriver (fact lens_driver). A body without it has S-LENS (src/lab/camapp.mjs)
// `power_native`: the power manager starts at the play bring-up and the power lever's off runs the firmware's own
// power-off to its last write (src/lab/power.mjs H-PWRSTART, S-IOEXP, S-SHUTDOWN, H-POWER; docs/hle-gaps.md 4.7.4), at
// the addresses src/fw/facts.mjs powerOff reads (fact 'power.off'); given for a body whose power-off is known to run so
// (X). A body without it closes the session at the lever's off at once
//
// `scpu_lle`: the sub-CPU's own firmware, which the lab can run on the STM32L4 machine in S-SCPUDEV's place (opt-in,
// src/lab/scpum4.mjs; docs/om1-scpu-spec.md section 8 step 6), given only for a body whose image that machine is
// known to boot: block, the SCPU block's file name in unpacked/<code> beside the main block's (scpuPath; a full unpack
// of the .BIN makes it, BLOBS.md), and sha256, its digest; pins, the image's link pins (the MN's request line in, the
// ready and message lines out, scpu spec 3.1); gate, the SRAM byte of its command manager's power-on flag (in the
// image's address notation). A body without it keeps S-SCPUDEV
export const MODELS = {
  E143: {
    name: 'OM-1', bin: 'OLY_E_143_1900_0000_0000.BIN', version: '1.9', res_block: 'blk02000000.OE.0101.bin',
    rom_len: 33554368, rom_sha256: '7f791611580925f3550d394baa9e8cca4e8f4c38e427ccd498170e8d1feb67e9',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10031072, res_sha256: '03a18d68e950ab0f55df3f1379d26ace4ee654a6e4a276bc8872daa1e9ebfa6c',
    panels: { tft: [900, 600], evf: [1600, 1200] },
    board: { family: 'E143' },
    // the SCPU's block at file offset 0x0e560000 (docs/om1-scpu-spec.md section 2; X: it boots on the STM32L4 machine,
    // section 8 step 5); pins (D, section 3.1): PB12 the request's EXTI input, PC3 pin 102, PC2 the message line;
    // gate: the literal pool word 0x80135c4 the power-on gate 0x8012d72 and the release 0x801305d reach their flag
    // object through holds 0x20008390, whose byte +0 is the flag (D)
    scpu_lle: {
      block: 'blk0e560000.OE.0107.bin', sha256: '2d930ac588014c250391d6af3a49fe7372852fc5eafbac5d2ac73df04be94807',
      pins: { request: 'PB12', ready: 'PC3', message: 'PC2' }, gate: 0x20008390,
    },
    // the SCPU init 0x5004dc55 attaches 0x5004e1fd at level 5 (0x5004de8e..99); 0x5004ded1 adds a callback to its
    // table of 4; UI_IN's port init 0x5014e3ab registers 0x5014e534 (0x5014e50e..14); UI_IN's start stage 0x5014bfc6
    // calls 0x5014e51e (D)
    scpu_port: { irq: [0x5004E1FD, 5], register: 0x5004DED1, callback: 0x5014E534, old_state: 0x5014E51E },
    // the GIO init 0x50002a20 ends with 0x50002b5d (0x50002a2d), which marks the 325 slots at 0xa32c1f74 free (255);
    // the EDID state byte 0x62a3c8ec, read by 0x501d30f6 (D)
    hdmi: { gio_slots: 0x50002B5D, state: [0x62A3C8EC, 1] },
    // the module init 0x50048cad calls the device part 0x500493ac at 0x50048cb4, stores 0x6034d9d4 and the run-time
    // 0x6006a221 (= 0x50049201) at 0x50048cbf / 0x50048ccb, starts ACC_MAIN through OlyTaSt (0x50048ce2); the probe
    // 0x50048fd1 opens (6, 107), reads register 0x0f, wants 0x6a and writes 0x10 = 0x10, 0x0d = 1, and 0x50048ead then
    // sets 0x62963fb8 to 1; the completion 0x5004910a packs
    // 0x62963fd6..da and 0x62963fde and increments 0x6034d9d4; 0x50048d14 writes the references at 0x6034d9b0; the remap
    // 0x5005ff7d reads 0x6034e170; PER_SLOPE's init 0x5005fb31 starts task 78 (0x5005fb9c); the gauge's getter
    // 0x5005f982; ACC_MAIN's cycle calls the copy through 0x62963f5c and then the correction 0x500493dc (D)
    acc: {
      init: 0x50048CAD, device: 0x50048CB4, ptrs: [0x62963F58, 0x62963F5C], main: 0x50048EC2, probed: 0x62963FB8,
      reg: { open: 0x5004C971, read: 0x5004CB57, write: 0x5004CB6D, close: 0x5004CB4C },
      dev: [6, 107], who_am_i: [0x0F, 0x6A], setup: [[0x10, 0x10], [0x0D, 0x01]],
      copy: 0x50049201, correct: 0x500493DC, words: [0x62963FD6, 0x62963FDE], counter: 0x6034D9D4,
      refs: 0x6034D9B0, axes: 0x6034E170,
      slope: { init: 0x5005FB31, main: 0x5005FB9C, get: 0x5005F982 },
    },
    // the lens on the mount natively, the default (src/lab/lens.mjs, src/lab/lensmcu.mjs; docs/hle-gaps.md 4.4.2): the
    // driver's entry points, LENS_EXEC's queue, the lens-0 flags and the lens caches' NAND are read by src/fw/facts.mjs
    // lensDriver (E143's LENS_DRIVER_E143 there, with their evidence)
    lens_native: true,
    // 0x5000314c / 0x50003156 run the heap's get 0x5000319c / release 0x50003466 with pool 2, whose block size is 16512
    // (the table 0x60029908) and whose memory is 0x62424700.. (0x50003211), S-HEAP's (D)
    heap_pool: { get: 0x5000314C, put: 0x50003156, bytes: 16512 },
    // the power manager started and the power-off run natively (src/lab/power.mjs; docs/hle-gaps.md 4.7.4), at the
    // addresses src/fw/facts.mjs powerOff reads (POWER_OFF_E143 there, with their evidence)
    power_native: true,
    // The card's file system runs natively (src/lab/storage.mjs; docs/hle-gaps.md 4.8.2): its seams are read by
    // src/fw/facts.mjs fileSystem (fact storage; E143's values STORAGE_E143 there, with their evidence), the SD host's
    // pages are the board's (src/fw/board.mjs sd). errlog: the logs its card's queries make in the lab. The movie
    // time query (0x5042da58) takes the time left from the movie module's copy, which the DCF remain count fills from
    // the card (0x5045c4ac, called from 0x50448d83, X), and converts the movie info's frame rate (+720 of the static
    // info 0xa32ed128, which the movie module's set-up 0x5045c3fd fills; not run in the lab, so 0) for the recording's
    // time code: 0x5044949b takes 23, 24, 25, 30, 50 or 60 and logs this code for any other (D); the time left is
    // computed before it (0x5045ada2)
    card_fs: {
      native: true,
      errlog: [MOVIE_TIME_ERRLOG],
      // The HLS side of the card (src/lab/media.mjs; docs/hle-gaps.md 4.8.3). D unless tagged.
      // reception: OlyHfwReception's singleton getter (0x6035f0fc, made by 0x50af8959) and its vtable slot 2
      // (0x50af8c96: the receive body 0x50af89f9 with d0 = 1), which hands an event to every receptor of its list
      // (+20: u16 count at +2, items at +8; 0x50af8156, 0x50af818b) whose isInterested (vt[3]) takes it, through the
      // receptor's synchronous slot (vt[2], 0x50ac8f27: the reactive's handleEvent, OMReactive vt[6] 0x50d9bd10).
      // Slot 1 (0x50af89e5, d0 = 0) is the asynchronous one: the receptor's vt[1] (0x50ac8eed) gens the event to the
      // reactive's OXF thread (+100), the OXF main thread HIGHLEVEL_MAIN, which runs only with the HLS components.
      // OlyHfwOpeMdaCtrl's receptor (vtable 0x60de6808) takes the events of class 696 (its filter, +8), and its
      // reactive (vtable 0x60de8ffc) handles them in its state 6 (0x50acb4b9 -> 0x50acb53e) by posting the
      // application's callbacks (0x50ab8390) and events (0x50b7a392). `new`: operator new (size d0, line d1, file
      // a0), as every sender allocates its events
      hls: {
        reception: 0x50ABC5A3, sync_slot: 2, new: 0x50D9BA46,
        // the event classes (each derived from 696, ctor 0x50ac89d0): 1513 / 1514 (0x50ac8d0d: id d0, +28 the CBC
        // id d1, +32 a1, +36 / +40 the two stack words; 44 bytes, 0x50cec2bb), 697 (0x50ac89f8: +28 d0, +32 u16 d1;
        // 36 bytes, 0x50cec316), 711 (0x50ac8c70: +28 the media kind, +32 d1, +36 a1; 40 bytes, 0x50bb8a00)
        events: { result: [0x50AC8D0D, 44], media: [0x50AC89F8, 36], mount: [0x50AC8C70, 40] },
        ids: { progress: 1513, result: 1514 },
        // The media control request the menu's Card Formatting sends (TRA 1511, OlyHfwOpeMdaCtrl 0x50ac937f; its
        // class's ctor 0x50ac052e: +32 u8 the command, +34 u16 the media, +36 u16 the option; X: Format Card's Yes
        // sends command 1, media 0). The HLS function component CmpCst_Function (CmpCst_Function.cpp), which takes it
        // (rcvReqFncMediaCtrlStart 0x50ceb3be), does not run in camapp 1. Its parts the lab calls: getMediaCtrlCBC
        // 0x50cebeea (command -> the callback id: 1 -> 16), the start table 0x60364a44 (24 bytes a command, filled
        // at boot; X: command 1's entries are executeMediaFormatStart 0x50ceb9b0, getMediaProgress 0x50ceb96c and
        // executeMediaFormatEnd 0x50ceba28), getMediaProgress (entered by calls; api_media 0x503f093a's percent of
        // the file layer's progress words 0x62ae4cd4 / 0x62ae4cd8). executeMediaFormatStart calls api_media's
        // format 0x503f0820 (API 0xe0005) with the media: for media 0 or 1 it posts FILECLBK {reply queue (the API's,
        // the halfword 0x600431d0; X: 6), token, 0x34, block} (0x503f08fb) and returns the token (X: 0xf00a0000); the
        // file module's progress events 0x04020011 (0x508902cd) and its reply {u16 status, token, block} to the API
        // queue (0x508a4bd5, X) follow. At the end (rcvReqFncMediaCtrlStartComplete 0x50cec0ff, status 0): for each
        // slot whose media status (api 0x503f0bd7) has bit 0 clear and whose mount state (0x50aca51d) is mounted it
        // sets 15261 + slot to 1 (0x50ab4f75; 0x50cec212..0x50cec25e), sends 1513 {CBC, 3, 100, 0} (0x50cec2e3) and
        // 697 {1, media} (0x50cec334), stores kind 72 and result 0, and for the format starts a request whose
        // completion (cbMediaCtrlResult 0x50ceb6c1) sends 1514 {CBC, 72, 0, 0} (0x50ceb71e); each progress event
        // sends 1513 {CBC, 3, percent, 0} (0x50cebeb4). An error status ends in kinds 70 / 71 / 118 (0x50cec268..)
        ctrl: { request: 1511, cmd: 32, media: 34, option: 36, format: 1, cbc: 0x50CEBEEA, progress: 0x50CEB96C,
          api: 0x503F0820, reply_queue: 0x600431D0, progress_event: 0x04020011, kinds: { progress: 3, done: 72 },
          status: 0x503F0BD7, flag: [0x50AB4F75, 15261] },
        // The HLS mount state words, by media kind (getter 0x50aca51d, setter 0x50aca6b1(kind d0, a0 -> value)):
        // CapMed_MediaManager's unmountPreprocess (0x50bb8292) sets 0 (0x50bb8288), S-CARD's start value is 8.
        // CapMed's notifications to the application's media control (event 711 through the reception's slot 2):
        // {kind, flag, 0} at a card's change (0x50bb8a1b), {kind, 1, 2} at the REC mount's end (notifyRecMountEnd,
        // 0x50bb8de9), {kind, 1, 4} (0x50bb8d55), {kind, 1, 8} at mountProcEnd (0x50bb8c6c). The reactive's 711
        // handler (0x50acaeb5) posts the application's 29 (with the card switch's EV, 0x50424f9a) for a change with
        // the flag 1, 30 for one with 0, 193 / 194 / 195 for the states 2 / 4 / 8 (X: 29, 193, 30)
        mount: { get: 0x50ACA51D, set: 0x50ACA6B1, unmounted: 0, mounted: 8, rec_end: 2, end: 8 },
        // The card slots: the media kind, and the card switch UI_IN decodes (port 1 byte 1 bits 0 and 1; the level
        // getter 0x5014c015). The file layer registers its callback for both codes with UI_IN at its init
        // (0x50877e75..0x50877e92, 0x5014c420(code, 3, fn); the callback 0x5087ace0 / 0x5087acec -> 0x5087bb09 marks
        // the slot's card as changed, X: it runs at each toggle) and logsec waits 740 ms before a mount's sdmem
        // command 2 when UI_IN's last code is the slot's (0x508ac202). Level 0 is a card in the slot (I: the start
        // the lab's card mounts at, round 1, has 0; 0x501ea9f1 clears a bit when the level is not 0)
        // UI_IN publishes a switch's change as the module event 0x02020000 | code (X: 0x02021506 at each toggle,
        // from 0x5014c417) through the module event post 0x50025095, which the file layer's progress uses too
        slots: [{ kind: 4, switch: 0x1506 }, { kind: 8, switch: 0x1518 }],
        switch_level: 0x5014C015, switch_event: 0x02020000, publish: 0x50025095,
      },
    },
    // Subject detection's frames on the display (src/lab/subject.mjs S-SUBJECT; docs/om1-subject-spec.md 4.3 and 5.1).
    // D unless tagged. setting: the subject-detection setting, the data object 0x1e71 (settings id 1682, six values,
    // default 0), which TAKE reads through the property read 0x500417da(0x1e71, 0, 0) (0x5039ac95..9b, 0x5039bb03..08,
    // 0x506d8011..17) into its context +206 and hands to take_mov (0x503a4882 -> 0x62a411a3 -> mdet_dl_change_mode
    // 0x5080a79a, 0x503a48ac..ce); its value is MDET's kind, whose names are at 0x50338100 (0 OFF, 1 MOTOR_SPORTS,
    // 2 AIRPLANE, 3 TRAIN, 4 BIRD, 5 ANIMAL; 0x50812dc9 maps 1..5 to the learning items). table: MDET's frame table, as
    // its writer 0x5082ac64..0x5082af98 fills it and its getter 0x5083a299 (trace id 227) copies it: main {flag, the
    // record}, subject 0's box (0xa33790b2..b8, or the centre and size at 0xa3379060..66), written only while the byte
    // 0xa337f082 is 1 (0x5082acb3, 0x5082ad02..0x5082ae76; what that state is, ?); part {flag, record}, a box at
    // 0xa33790f2..f8 taken in the same state when 0xa337811b is 1 (0x5082ae7d..0x5082af1a); count and list, the
    // subjects' boxes (0xa33790b2 + 8 n, valid at 0xa337d53c + n; n from 0, or from 1 in that state, up to 8 records,
    // 0x5082af23..0x5082af98). A record is four corners (x, y) as halfwords, top left,
    // top right, bottom left, bottom right (the writer's order; FACE's 0x50523fe3 takes x0, y0, x1 and the third
    // corner's y for the centre, width and height). active: the byte 0x50839ed0 returns, which the getter requires
    // (else no frames) and the writer requires before it posts UP_FACE (0x5082af9a..0x5082afee). aspect: the pair of
    // bytes the getter maps to the frame's aspect code (0x5083a368..0x5083a3f8; all zero: no frames): code -> pair
    // below. up_face: the frame plane's UP_FACE (flag 1 to DISP_FRAME when the frame mode has bit 1, 0x50025747).
    // DISP_FRAME's side (S-DISPFRAME runs it): draw_face 0x5100d751 asks FACE's 0x5052202c for an 88-byte record, which
    // takes MDET's table through the getter unless FACE's own mode byte 0xa32f3e06 is 1, and draws only when its
    // aspect code equals the one DISP_FRAME computes for the frame (0x5100d469: the still aspect, object 0x3081 /
    // settings id 269, or the movie's; aspect_code); 0x5100dfef turns the list into frames of kind 1 colour 3, the
    // main record into kind 7 colour 4 and the part into kind 8 colour 4 when the mode has bit 0x10. The frames' plane
    // coordinates come from a 24-byte transform {width, height, x num, x den, y num, y den, x offset, y offset, clip x0,
    // y0, x1, y1} (0x500259bd), picked from the table 0x60365754 (a pointer per output, 0x500258e8(state, object 0x8971,
    // 0x500258d4()) the index; 0x5100d77d..0x5100d7a5) and the aspect (0x50025931(code) the row)
    subject: {
      setting: 0x1E71, prop_read: 0x500417DA,
      table: { main: [0xA337EFA1, 0xA337EFA2], part: [0xA337EFB2, 0xA337EFB4], count: 0xA337EFC4, list: 0xA337EFC6, max: 8 },
      active: 0xA337F084, aspect: [0xA3378119, 0xA337811A],
      aspect_pairs: { 1: [4, 3], 2: [3, 2], 3: [16, 9], 4: [6, 6], 9: [3, 4], 10: [17, 9] },
      up_face: 0x50025747,
      face_mode: 0xA32F3E06,
      aspect_code: 0x5100D469, state: 0x5100DFBC,
      transform: { table: 0x60365754, index: 0x500258E8, object: [0x8971, 0x62F4FE68], device: 0x500258D4, row: 0x50025931 },
    },
  },
  E146: {
    name: 'OM-1 II', bin: 'OLY_E_146_1300_0000_0000.BIN', version: '1.3', res_block: 'blk02000000.OE.0101.bin', checked: true,
    rom_len: 33554368, rom_sha256: '125c9ff8f43396f48f55b9b3a62279a9fea29623038e02cb4b397f6a76c7c95c',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10176992, res_sha256: 'b05dac40db4a90d93476a46a705611f4653cfde224befd3bdbd46427d4c41a6b',
    panels: { tft: [900, 600], evf: [1600, 1200] },
    // E143's board; the compositor leaves the register blocks VSC_UNAPPLIED unapplied, as on E147 (I: which of them
    // E146's firmware writes was not read)
    board: { family: 'E143', vsc: { unapplied: VSC_UNAPPLIED } },
    vsc_extra: [0x6800, 0x1400],
    touch: false,
    g4set: G4SET_UNCHECKED,
    // the lens on the mount natively, the default (src/lab/lens.mjs; docs/hle-gaps.md 4.4.3): its driver is E143's
    // but for addresses, the debug log's line numbers and the order of a few instructions (X: its serial layer, init
    // chain, power-on and detect paths and frame table compared with E143's instruction for instruction), the addresses
    // read by src/fw/facts.mjs lensDriver; its start sends E143's 15 frames (X)
    lens_native: true,
    // the SCPU's block at file offset 0x0e520000, byte-identical to E143's (docs/om1-scpu-spec.md section 2; D: the same
    // sha256), so E143's pins and gate
    scpu_lle: {
      block: 'blk0e520000.OE.0107.bin', sha256: '2d930ac588014c250391d6af3a49fe7372852fc5eafbac5d2ac73df04be94807',
      pins: { request: 'PB12', ready: 'PC3', message: 'PC2' }, gate: 0x20008390,
    },
    // the SCPU's backed-up words the firmware writes and reads, [index, byte], and its writes without data or an
    // answer (src/lab/scpudev.mjs S-SCPUDEV; E143's [2, 0] and none): the time-zone record's write and read wrappers
    // at 0x5005c164 and 0x5005c171 pass index 2, byte 0 (D); port_scan: UI_IN's port-scan request 0x5005edec and the
    // inbound 0x08 handler 0x5005eec0 are E143's 0x5005d36a and 0x5005d43e instruction for instruction (D;
    // src/lab/play.mjs H-UIINSCAN)
    scpu: { words: [[2, 0]], quiet: [], port_scan: true },
    // as E143's (D): the SCPU init 0x5004f6d7 attaches 0x5004fc7f at level 5 (0x5004f910..1b); UI_IN's port init
    // registers 0x50152295 (0x5015226f..75); its start stage calls 0x5015227f (0x5014fd27)
    scpu_port: { irq: [0x5004FC7F, 5], register: 0x5004F953, callback: 0x50152295, old_state: 0x5015227F },
    // as E143's (D: the module init, ACC_MAIN, the probe, the sampler's completion, the copy, the correction, the
    // register API and PER_SLOPE compare instruction for instruction with E143's but for addresses; the gauge's getter
    // calls the adjust state machine with a 72-byte frame, which has a seventh operation): the init 0x5004999e calls the
    // device part at 0x500499a5 and stores 0x6034d9d4 and the run-time 0x6006af12 (= 0x50049ef2) at 0x6298d750 /
    // 0x6298d754; the completion 0x50049dfb packs 0x6298d7ce..d2 and 0x6298d7d6; the remap 0x50061a33 reads 0x6034e2c4
    acc: {
      init: 0x5004999E, device: 0x500499A5, ptrs: [0x6298D750, 0x6298D754], main: 0x50049BB3, probed: 0x6298D7B0,
      reg: { open: 0x5004E3F3, read: 0x5004E5D9, write: 0x5004E5EF, close: 0x5004E5CE },
      dev: [6, 107], who_am_i: [0x0F, 0x6A], setup: [[0x10, 0x10], [0x0D, 0x01]],
      copy: 0x50049EF2, correct: 0x5004A0CD, words: [0x6298D7CE, 0x6298D7D6], counter: 0x6034D9D4,
      refs: 0x6034D9B0, axes: 0x6034E2C4,
      slope: { init: 0x500615E7, main: 0x50061652, get: 0x50061436 },
    },
    // as E143's (D): pool 2's get 0x5000314d and release 0x50003157, block 16512 (the table 0x60029910), memory 0x62424700
    heap_pool: { get: 0x5000314D, put: 0x50003157, bytes: 16512 },
    // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card), and its HLS side (src/lab/media.mjs;
    // docs/hle-gaps.md 4.8.7): E143's (its entry has the meaning of each field), each function paired by the map
    // (bin/xto.mjs) and compared with E143's instruction for instruction but for absolute addresses and source line
    // numbers (D): the reception's getter, slot 2 and the receive body, operator new, the event classes' ctors (697,
    // 711 and 696 as E143's; the senders allocate 44, 36 and 40 bytes), the media control's class ctor (0x50aca769),
    // getMediaCtrlCBC, getMediaProgress, executeMediaFormatStart (the progress event 0x04020011), api_media's format
    // and media status, the flag setter, the mount state getter and setter, UI_IN's level getter and the module event
    // post. Three ids differ: the media control request is TRA 1509 (its ctor's id; E143's 1511), the progress and
    // the result 1511 and 1512 (cbMediaCtrlResult 0x50cfbf3c, the progress send 0x50cfc6e5, the sender 0x50cfcb36 and
    // the reactive's state 6 0x50ad5b24 test them; E143's 1513 and 1514); the API's reply queue is the halfword
    // 0x6004320e (api_media's format reads it at 0x503ecb06; the map's data pairing, 0x60043200, is not it). errlog:
    // E143's movie time query's (MOVIE_TIME_ERRLOG), from the same time code conversion (E146 0x5043fa3d: E143's
    // 0x5044949b instruction for instruction but for the log's line number, X), on the shooting screen with either
    // lens (X)
    card_fs: {
      native: true,
      errlog: [MOVIE_TIME_ERRLOG],
      hls: {
        reception: 0x50AC655A, sync_slot: 2, new: 0x50DACAF5,
        events: { result: [0x50AD32E7, 44], media: [0x50AD2FD2, 36], mount: [0x50AD324A, 40] },
        ids: { progress: 1511, result: 1512 },
        ctrl: { request: 1509, cmd: 32, media: 34, option: 36, format: 1, cbc: 0x50CFC765, progress: 0x50CFC1E7,
          api: 0x503ECA4D, reply_queue: 0x6004320E, progress_event: 0x04020011, kinds: { progress: 3, done: 72 },
          status: 0x503ECE04, flag: [0x50ABEF30, 15261] },
        mount: { get: 0x50AD4AF7, set: 0x50AD4C8B, unmounted: 0, mounted: 8, rec_end: 2, end: 8 },
        slots: [{ kind: 4, switch: 0x1506 }, { kind: 8, switch: 0x1518 }],
        switch_level: 0x5014FD76, switch_event: 0x02020000, publish: 0x50025160,
      },
    },
    // the power manager and the power-off natively, with E143's IO expanders (X: test_scpu's and test_scpum4's power
    // sessions; docs/hle-gaps.md 4.7.4)
    power_native: true,
    // as E143's (D): the GIO init 0x50002a21 ends with 0x50002b5e (0x50002a2e), slots at 0xa32c1f74; the EDID state is
    // the word 0x62a67880 its getter 0x501d8647 reads. The hot-plug handler's work runs in the display init's HDMI task
    // 0x501dc568 (extra_tasks), not in task 16 as E143's
    hdmi: { gio_slots: 0x50002B5E, state: [0x62A67880, 4] },
    extra_tasks: [
      0x501DC568,   // started by the display task init (E143 0x501c2f13 starts no task; E147 starts 0x501e3eca)
    ],
  },
  E147: {
    name: 'OM-3', bin: 'OLY_E_147_1100_0000_0000.BIN', version: '1.1', res_block: 'blk02000000.OE.0101.bin', checked: true,
    rom_len: 33554368, rom_sha256: '5e8d376e9111a44ac0352f26030d7c1b17026d42c45f3600cfa02a0e8c5b7d59',
    // the reset head's jump into the run-time copy at 0x50000082: mov 0x600210c5,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 10197472, res_sha256: '119370d5dab0d5fc9b1e58357f3fd60595603076127ab60199a4c2bc5712d724',
    panels: { tft: [900, 600], evf: [1024, 768] },
    // the flash library's get-core-id (disassembly notation, flash 0x50002900): E143 has it in the image (0x50002fd3,
    // `mov (0x97f00254),d0; retf`); E147 calls the flash copy from the same 21 sites (paired, X)
    flash_core_id: 0x3FFE18E0,
    // task entries a later build starts where E143 starts none, run natively (each with what starts it)
    // the VSC's per-channel block 0x6800..0x7c00 (word indices 0x1a00..0x1eaf in ten runs of 0x30), which the
    // display init clears (0x501ed5bc, table 0x602eb7a8) and E143's VSC has not (X)
    vsc_extra: [0x6800, 0x1400],
    // the feature registers' values E147 writes for its EVF (1024 x 768 panel) where E143's differ (X: the EVF start)
    vsc_features: { 0x428: [0x22], 0x580: [0], 0x584: [0], 0x588: [0], 0x58c: [0], 0x598: [0] },
    // the touch init starts the touch task itself and both wait for the controller's I2C completion (X): not modelled
    touch: false,
    g4set: G4SET_UNCHECKED,
    // the lens on the mount natively, the default, as on E146 (src/lab/lens.mjs; docs/hle-gaps.md 4.4.3; X: the same
    // compares and frames); LLPSW is bit 6 of group 1 byte 0 in its UI_IN tables (E143's bit 4 of byte 1)
    lens_native: true,
    // property 4513 (the output device) reads the play path makes from one more site than E143's GUI (X)
    prop_sites: [0x503DAF24],
    // the SCPU's backed-up words the firmware writes and reads, [index, byte], and its writes without data or an
    // answer (src/lab/scpudev.mjs S-SCPUDEV; E143's [2, 0] and none): the time-zone record's write and read wrappers
    // at 0x50057330 and 0x5005733d pass index 2, byte 0 (D); port_scan: UI_IN's port-scan request 0x50059f64 and the
    // inbound 0x08 handler 0x5005a038 are E143's instruction for instruction (D; src/lab/play.mjs H-UIINSCAN)
    scpu: { words: [[2, 0]], quiet: [], port_scan: true },
    // as E143's (D): the SCPU init attaches 0x5004f9bc at level 5 (0x5004f64c..57), its registration 0x5004f690 keeps
    // its count at 0xa32bff60 (E143's 0xa32bff5c); UI_IN's port init registers 0x501595dc (0x501595b6..bc); its start
    // stage calls 0x501595c6 (0x5015707b)
    scpu_port: { irq: [0x5004F9BC, 5], register: 0x5004F690, callback: 0x501595DC, old_state: 0x501595C6 },
    // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card). errlog: the file system's first call
    // of the SCPU clock's API (0x50135923 -> 0x5005720a; what it asks is ?) comes at the bring-up before anything ran the
    // SCPU clock's wait 0x50057348, which sets the interface's state field (0x98e00000 bits 2..7) to 42; the API logs
    // this code for any other state (0x50057211..0x5005721d, D); the field is 42 4 ms later (X: 0 at 323 ms, 42 at
    // 327 ms; the wait's `mov 42,d0; call 0x5004fb2c` at 0x50057378, D). On E143 and E146 the field is 42 before the
    // bring-up (X); which boot step sets it first on the camera is ?
    card_fs: { native: true, errlog: [[0x19001004, 'the file system\'s first call of the SCPU clock\'s API finds its state not yet set (the clock\'s first wait sets it)'], MOVIE_TIME_ERRLOG] },
    // the power manager and the power-off natively; its power-off sends no IO expander a command (D: the sequence
    // 0x50045807; X: a scan finds the expanders' task names only in a name list no code loads), so S-IOEXP does not
    // run (X: test_scpu's power session; docs/hle-gaps.md 4.7.4)
    power_native: true,
    // as E146's (D): the GIO init 0x50002a11 ends with 0x50002b50 (0x50002a1e), slots at 0xa32c1c44; the EDID state
    // word 0x62a655e4 (its getter at 0x501e078a); the hot-plug work runs in the HDMI task 0x501e3eca
    hdmi: { gio_slots: 0x50002B50, state: [0x62A655E4, 4] },
    // no acc: E147's accelerometer code is not E143's (D): its probe 0x50049771 wants WHO_AM_I 0x70, and its ACC_MAIN
    // 0x50049640 copies every 30 ms only while 0x6298d7b0 is 1 (set by 0x50049616, cleared by 0x50049621); its sensor,
    // its scale and what sets the enable are not read
    extra_tasks: [
      0x501E3ECA,   // started by the display task init (0x501cfd03, E143 0x501c2f13 starts no task), X
    ],
    // E143's board (src/fw/board.mjs) but for the flash library, which E147 runs from its image head linked at
    // 0x3FFDEFE0 (memcpy/memset, the core-id getter: d32 calls from flash into it, X); the compositor leaves the
    // register blocks VSC_UNAPPLIED unapplied
    board: {
      family: 'E143', library: { base: 0x3FFD0000, size: 0x30000, image: [0, 0x30000 - 0xEFE0, 0xEFE0] },
      vsc: { unapplied: VSC_UNAPPLIED },
    },
  },
  E144: {
    name: 'OM-5', bin: 'OLY_E_144_1200_0000_0000.BIN', version: '1.2', res_block: 'blk017c0000.OE.0101.bin', checked: true,
    rom_len: 24903616, rom_sha256: 'cf4babeab5f516514e4a9b6032b0374e643830511e083b9cdd26bcb02980af88',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 7835616, res_sha256: '1bc282d99c073bee159fbffa85c27b48782a7c083cfcc55bd086410790960b36',
    panels: { tft: [720, 480], evf: [1024, 768] },
    overrides: OVERRIDES_E144,
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    g4set: G4SET_UNCHECKED,
    // the menus are the older Menu_Viewer / Cursor_2CNL framework, not ListMenu (src/fw/ports.mjs FACTS menu.list_menu,
    // read by src/fw/facts.mjs listMenu): no tab/page tables, variable 226 a 382-byte publish (D, the menu-entry chain
    // 0x50301ef8)
    // the VSC ch0 ISR sets a second vsync flag besides 0x60041680, waited by the task whose id is in (0xa2693e80)
    // (0x5018595f..0x501859ba, D)
    vsync_alias_flags: [0x600417B2],
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5018a924: attach 120, poll (0x620c662c)), called at 0x50181efb, the code at
    // 0x50181f10 (D)
    // the cache flushes besides the DB init's (menu.mjs K-CFLUSH; return addresses): the driver at 0x50003a99 flushes
    // the data cache (0x5004821b: CHCTR 0x8070, the tag area 0x28a00000) before its DMA (X)
    cflush_returns: [0x50003AA0],
    // the save of the 1 MiB state block 0x62be0000 to flash 0x46c60000 (camapp.mjs S-SETSAVE): 0x50003a64 runs its
    // registered callbacks, flushes the cache, sums the block and writes it through the flash access 0x5003b76c,
    // which programs the flash controller 0x98d01800 the lab does not have (D); the application's RPC 0xc0036
    // handler calls it at power-on (0x503021b8, X)
    block_save: { fn: 0x50003A64, returns: [0x503021BF] },
    // drivers of peripherals the lab does not have (play.mjs; [function, d0, name, why]): the internal charger's
    // register write over IIC channel 6 (0x50041179: d0 1, d1 register, a0 value; its 3000 ms waits for the IIC
    // completion flag (0x600417aa) time out and log 0x1d003003 "INTCHA Eve W Err" without the charger, X), which the
    // GUI's power-state change 0x50041a4c makes about 4 s after power-on (X); 0 is its success value (0x5004135c, D)
    return_stubs: [[0x50041179, 0, 'S-INTCHA', 'internal charger IIC write: no charger in the lab']],
    // its board family's (src/fw/board.mjs FAMILIES.E144); its core byte (the getter 0x5000276d `movbu
    // (0x8ff00198),d0`), library (flash 0x41e02000 -> 1536 words at 0x47000800, 0x5000027d..0x5000028e) and preload
    // (the reset head's copies 0x500000f7..0x50000117, 0x5000018b..0x500001c5) are read by bin/port.mjs
    // (src/fw/ports.mjs FACTS.E144)
    board: { family: 'E144' },
  },
  // The bodies at the run-time bases 0x60021020, 0x60020020 and 0x60400020 (docs/model-survey.md tiers A-C). Each
  // entry's .BIN is the one the updater API serves for its code (the name: its reply's model_name; the reply is not
  // committed), pinned in BLOBS.sha256; rom_* and res_* are the main block's and the resource prefix's
  // digests by the lab's own path (src/fw/olyfw.mjs labBlocks, src/fw/resprefix.mjs resPrefix with the block's load
  // address, X). panels: the vendor's specification's dot counts as RGB pixels, 1.037M dots 720 x 480 and 2.36M dots
  // 1024 x 768 (I: unchecked; nothing reads panels yet), null where it gives no geometry or the body has no EVF.
  // board.family: the family scan's (src/fw/board.mjs FAMILIES, whose comments name the bodies scanned, X); the
  // family's per-body facts are read by bin/port.mjs (src/fw/ports.mjs FACTS), none is given here.
  E139: {
    name: 'E-M1 III', bin: 'OLY_E_139_1600_0000_0000.BIN', version: '1.6', res_block: 'blk01a00000.OE.0101.bin', checked: true,
    rom_len: 27262912, rom_sha256: '3f8bcc3248e63a823dd978607f019f2063ead83080b9c93cddc836d556ff42dd',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 11726816, res_sha256: '0d4c92407626a32ae4173fc2d6efc5360d75b5c271f088339830ffe1455e157e',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    // the SCPU clock ticks, as on E143 (src/fw/board.mjs: the family's stands still): its start, S1 and S2 run as with
    // the clock standing still (X: bin/modelcheck.mjs). The sub-CPU link (src/dev/linkpins.mjs, src/lab/scpulink.mjs):
    // its PER_SCPU is E143's but for its pins, ready 77, request 76 and reset 57 (0x50051ed3..0x50051ede, 0x5005362a, D); the GIO driver maps a
    // pin through the board variant's remap table (0x61a22bfc by (0x61f0e4bc), the variant byte BSS in the lab: table 0, which leaves
    // the three alone), its words are (0x600251f4)[pin]: 0x9b80092c, 0x9b800b8c, 0x9b800bac, the level in bit 4 and the
    // output in bit 0 as on E143 (0x500020f3, 0x5004c5ad), and pin 77's slot (0x600258e0)[77] = 67 is a group slot: record 0x600259b4 +
    // 32 x 67 = {77, its pin word, IRQ 40, the group handler, status 0x9b801e4c, enable 0x9b801f28, type-0 bit 0x40,
    // type-1 bit 0x80}, the words shared with the group's other pins (D); the message line is port 3, the word 0x64
    // (the port byte reader 0x50048fbd reads bit 31 of 0x58..0x68, D)
    board: {
      family: 'E144', scpu: { ticks: true, message: 0x64 },
      scpu_link: {
        ready: { pin: 77, word: 0x9B800BAC, status: 0x9B801E4C, enable: 0x9B801F28, bits: [0x40, 0x80], irq: 40, shared: true },
        request: { pin: 76, word: 0x9B800B8C },
        reset: { pin: 57, word: 0x9B80092C },
      },
    },
    // the map from E144 pairs 7.29M instructions with 14 conflicts, the one from E143 2.18M with 110 (X: port.json
    // port_via.map and map, bin/port.mjs)
    port_via: 'E144',
    // E144's knobs this body takes through that map (src/fw/knobs.mjs; src/fw/ports.mjs KNOBS)
    carry: ['cflush_returns', 'block_save'],
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 88 (0x5018b4dc), called at 0x501827eb, the code at 0x50182800 (D)
    g4set: G4SET_UNCHECKED,
    // the SCPU's backed-up words the firmware writes and reads, [index, byte], and its writes without data or an
    // answer (src/lab/scpudev.mjs S-SCPUDEV; E143's [2, 0] and none): the time-zone record's write and read wrappers
    // at 0x50051013 and 0x50051020 pass index 2, byte 0 (D); port_scan false: no port-scan request of E143's shape
    // in the image (X: a byte scan for 0x5005d36a's head finds none; its sub-CPU is another lineage, with keys)
    scpu: { words: [[2, 0]], quiet: [], port_scan: false },
    overrides: {
      '0x5005b424': { to: '0x50051e16', why: 'PER_SCPU\'s task entry (src/lab/scpulink.mjs PER_SCPU_TASK), which the map from E144 (whose PER_SCPU differs) pairs with a generic table walker at 0x50051cbc: 0x50051e16 runs the reset check 0x5005360d (pin 57 pulsed when the cause is 0 or 8) and the init 0x50051eb2 (block flag, the IRQ 320 callback, pin 77\'s mode, handler and enable, pin 76 = 1, the 0x85 {2} send 0x5005364e), then loops on PER_SCPU_RECEIVE through the table machine with event 11 deferred outside states 0 and 2 (0x50051e25..0x50051e8b), as E143\'s 0x5005b424 (D)' },
      '0x50002b5d': { to: '0x500022c3', why: 'the GIO init\'s slot reset (src/lab/scpulink.mjs GIO_SLOTS), which the map places inside another function (0x50001e0e): 0x500022c3 writes 255 and five zero words to each of the 232 slot states from 0xa26bb79c, the free mark the mode function 0x5004c5ee takes a slot by (0x5004c948), as E143\'s 0x50002b5d for its 325 (D)' },
      '0x5014e374': { to: '0x5011080a', why: 'the joystick decoder publish return, as the map from E143 places it (E144 has no joystick and gives null): the UI_IN code has E143\'s branch on 0x1235/0x1234 (D cmp at 0x50110999/0x501109a5 and 0x50110a59/0x50110a65, E143 0x5014c07a/0x5014c086 and 0x5014c13a/0x5014c146), and 0x501107fe..0x5011080a is E143\'s 0x5014e368..0x5014e374, the call of the publisher 0x500257d0 with d1 0, a0 0 (D; play)' },
    },
  },
  E134: {
    name: 'E-M1X', bin: 'OLY_E_134_2400_0000_0000.BIN', version: '2.4', res_block: 'blk01a00000.OE.0101.bin', checked: true,
    rom_len: 27262912, rom_sha256: '7b0d72f88cfed079c6e3367a910856f9e4f69bc9e020f9c06d7ed0980bd66d3f',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 22175200, res_sha256: '1b390ea79011cf8a4946344c909078b320f8dc46000ab9f07018b8e0c76e9176',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    // UI_OUT, the module of the camera's lamps (src/lab/play.mjs H-UIOUTSTART; D unless tagged): the boot calls its
    // init 0x5010cb57 after its checkpoint "2_9" (0x50180afd), then starts the task whose id is the halfword
    // 0x600413fa (41; the static row of task 41 at 0x500180a8 holds the entry 0x5010cbda) and names it "UI_OUT"
    // (0x50180b04..0x50180b18). The lamp request 0x5010c328 ({lamp id, u16, word}; the id checked through the table
    // 0x5010caa2 reads) sends a 44-byte message to the queue of the halfword 0x6004192e (117), which the init sets up
    // (0x5010cb61), with no timeout (0x50030432(queue, -1) at 0x5010c35f). X: with the init and the task run, the task
    // waits, and a session's 72 lamp requests to the shooting screen, S2 and PLAY all complete
    ui_out: { init: 0x5010CB57, task: 0x5010CBDA },
    // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card), since UI_OUT runs: E134's file
    // layer asks for the card's access lamp around its accesses (0x5066dea4: lamp 6, 0xffff and 500 to start, 0 to
    // stop, I: a blink of 500 ms; from the file layer's 0x50648255, 0x506483cf, 0x5064840c, 0x50648540, 0x50648562 and
    // 0x506595b8), and with UI_OUT not run the 54th send blocked FILECLBK in S-RECFILE's first fopen (X: 53 sends, no
    // read in 10 s of lab time). E143's and E144's file layers make no such request (X)
    card_fs: { native: true },
    // the SCPU clock ticks, as on E143 (src/fw/board.mjs: the family's stands still): its start, S1 and S2 run as with
    // the clock standing still (X: bin/modelcheck.mjs). The sub-CPU link (src/dev/linkpins.mjs, src/lab/scpulink.mjs):
    // its PER_SCPU is E143's but for its pins, ready 77, request 76 and reset 57 (0x500528ac..0x500528b7, 0x50053fad, D); the GIO driver maps a
    // pin through the board variant's remap table (0x61c2299c by (0x6214512c), the variant byte BSS in the lab: table 0, which leaves
    // the three alone), its words are (0x60024054)[pin]: 0x9b80092c, 0x9b800b8c, 0x9b800bac, the level in bit 4 and the
    // output in bit 0 as on E143 (0x5004cfb1), and pin 77's slot (0x60024740)[77] = 67 is a group slot: record 0x60024814 +
    // 32 x 67 = {77, its pin word, IRQ 40, the group handler, status 0x9b801e4c, enable 0x9b801f28, type-0 bit 0x40,
    // type-1 bit 0x80}, the words shared with the group's other pins (D); the message line is port 3, the word 0x64
    // (the port byte reader 0x500486b8 reads bit 31 of 0x58..0x68, D)
    board: {
      family: 'E144', scpu: { ticks: true, message: 0x64 },
      scpu_link: {
        ready: { pin: 77, word: 0x9B800BAC, status: 0x9B801E4C, enable: 0x9B801F28, bits: [0x40, 0x80], irq: 40, shared: true },
        request: { pin: 76, word: 0x9B800B8C },
        reset: { pin: 57, word: 0x9B80092C },
      },
    },
    // the map from E139 pairs 8.12M instructions with 34 conflicts, the one from E144 5.88M with 47; through E139, 106
    // of the overrides carry, 15 against the direct map's answer and 11 fail, through E144 102, 22 and 16 (X: port.json
    // port_via.map, carried, carry_failed, bin/port.mjs with each; since the frame-wait knob left the seeds and E144's
    // rule-placed overrides went, through E139 102, 13 and 10, X). None of E139's knobs carries: the block save's
    // function and the calls before the cache flush's and the DISPLAY send's returns are not paired (carryKnob, X; the
    // DISPLAY sends are read by a rule since, src/fw/facts.mjs displaySends)
    port_via: 'E139',
    g4set: G4SET_UNCHECKED,
    // the SCPU's backed-up words the firmware writes and reads, [index, byte], and its writes without data or an
    // answer (src/lab/scpudev.mjs S-SCPUDEV; E143's [2, 0] and none): the time-zone record's write and read wrappers
    // at 0x5005239a and 0x500523a7 pass index 23, byte 0 (D); the dial init sends 0x21 with no data, no
    // completion and nothing waiting for it (0x50109328..0x50109342, D; its meaning is ?); port_scan false: no
    // port-scan request of E143's shape in the image (X: a byte scan for 0x5005d36a's head finds none)
    scpu: { words: [[23, 0]], quiet: [0x21], port_scan: false },
    overrides: {
      '0x5005b424': { to: '0x500527ef', why: 'PER_SCPU\'s task entry (src/lab/scpulink.mjs PER_SCPU_TASK), which neither map places right: 0x500527ef runs the reset check 0x50053f90 (pin 57 pulsed when the cause is 0 or 8) and the init 0x5005288b (pins 77 and 76 as E139\'s, the 0x85 {2} send 0x50053fd1), then loops on PER_SCPU_RECEIVE through the table machine (0x500527fe..0x50052864), as E139\'s 0x50051e16 and E143\'s 0x5005b424 (D)' },
      '0x50002b5d': { to: '0x50001ce5', why: 'the GIO init\'s slot reset (src/lab/scpulink.mjs GIO_SLOTS), which neither map places: 0x50001ce5 writes 255 and five zero words to each slot state from 0xa28a1e30, the free mark the mode function 0x5004cff0 takes a slot by, as E139\'s 0x500022c3 (D)' },
      '0x50023bab': { to: '0x5021050d', why: 'the EVF vtotal getter (display.mjs DEVICE.evf), which neither map places (E139\'s is the direct map\'s alignment 0x50021641): after the retf at 0x5021050a, `movbu (0x62316834),d1; mov 819,d2; cmp 1,d1` with 787 for mode 1 and 900 for a 20000 us period read through 0x50210666, as E139\'s 0x50021641 (D)' },
      '0x5014b7c7': { to: '0x501092da', why: 'the dial init (menu.mjs DIAL_INIT), which neither map places: like E143\'s it selects the board\'s dial table (src/fw/facts.mjs dialStore) and clears the dial counters, the 16-byte slots from 0xa28b9ecc, the map\'s DIAL_COUNTERS (0x501092f7..0x50109327), after a call of 0x501091eb, which clears ten bytes from 0xa28b9f10 and the three after them; then it posts a message through 0x50053de3 (0x50109342), which E143\'s does not; its one caller is 0x50108d5f (D)' },
    },
  },
  E137: {
    name: 'E-M5 III', bin: 'OLY_E_137_1700_0000_0000.BIN', version: '1.7', res_block: 'blk017e0000.OE.0101.bin', checked: true,
    rom_len: 25034688, rom_sha256: '4097f57751ac30c24589448865b2824891a754744eae63ab14359fd46c1cf4be',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 24465888, res_sha256: '4d0643ac1b46c33c074f5fad669d197c80a62d9590586904e68a53379ff9712f',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E144 pairs 7.94M instructions with 107 conflicts, the one from E139 7.43M with 99; through E144, 119
    // of the overrides carry (66 not null), 14 against the direct map's answer and 12 fail, through E139 109 (64), 15
    // and 8 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each; through E144 116 (63), 13 and 12
    // since three of E144's overrides went to rules, X). E144 is taken: E137 has its board traits where E139's differ
    // (no SCPU backup, font limit 0x9fc00; src/fw/ports.mjs FACTS) and its EVF code (the vtotal getter `mov 825,d0;
    // retf` 0x50020f74 and the period setter 0x50021078, as E144's 0x5002183a and 0x5002193e, D). None of E144's knobs
    // carries: the calls before the DISPLAY send's and the cache flush's returns and the block save's function are not
    // paired (carryKnob, X; the DISPLAY sends are read by a rule since, src/fw/facts.mjs displaySends)
    port_via: 'E144',
    g4set: G4SET_UNCHECKED,
  },
  E142: {
    name: 'E-P7', bin: 'OLY_E_142_1100_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: '5dd9af164b4590c7e82f6905c919b3cc450bb58f2d5742ab2a0e3a4eb2e26190',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600200f9,a0; jmp (a0) (D)
    image_base: 0x60020020,
    res_len: 22091232, res_sha256: '61d008779b2952a50936d58aa45390a7b1e918f4edcd49f20b3c82d235dac9da',
    // TFT 1.037M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E144 pairs 3.47M instructions with 116 conflicts, the one from E139 4.63M with 115, the one from
    // E137 3.92M with 141; through E144, 116 of the overrides carry (63 not null), 16 against the direct map's answer
    // and 10 fail, through E139 108 (63), 17 and 3, through E137 128 (65), 14 and 4 (X: port.json port_via.map,
    // carried, carry_failed, bin/port.mjs with each). E144 is taken: E142 has its board traits where E139's differ (no
    // SCPU backup: through E144 the four SCPU wait words stay null, through E139 they take the direct map's places,
    // src/fw/ports.mjs FACTS), and E144's get_still_info dump site carries to E142's createDate.year trace at
    // 0x50760ab2, where through E139 it lands on the WBMode trace 0x50760cc9 (D). Through any of the three the touch
    // panel's I2C write and read are E144's (0x5016c8bc, 0x5016cbe8: E144's 0x5018aab3 and 0x5018adf3 instruction for
    // instruction, D), which the map from E143 does not place (it gave the write 0x5016c69f, a reader of the
    // controller's register 0x1c14, D)
    port_via: 'E144',
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5016c6d5), called at 0x50164055, the code at 0x5016406a (D); reached, X
    // the shared stand-in (G4SET_UNCHECKED); start and S1 run with it (X)
    g4set: G4SET_UNCHECKED,
  },
  E140: {
    name: 'E-M10 IV', bin: 'OLY_E_140_1100_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: '5f2bfb367a7d65278fae1338bb10181ca8de8ebbd9a83f9e89bec4db9ade1fa5',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600200f9,a0; jmp (a0) (D)
    image_base: 0x60020020,
    res_len: 21919200, res_sha256: '483aa7d7b8b64f11d851f5e9083ceea479b22905f0b338ff9229600e5d315aa6',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E142 pairs 6.56M instructions with 81 conflicts, the one from E144 3.49M with 111; through E142, 134
    // of the overrides carry (60 nulls) and none fails, through E144 118 (53) and 8 fail (X: port.json port_via.map,
    // carried, carry_failed, bin/port.mjs with each). The two ports give the same places but for three E143 addresses
    // that through E142, which has no EVF, stay unplaced: the eye-state compare 0x501e806c, which through E144 lands on
    // E140's `cmp 2,d0` after its eye reader 0x5004847f, at 0x5016fe49 (D); the eye-state setter 0x50050efd, which
    // through E144 is filled at 0x500487de, a loop of `calls (a0)`, not a setter (D; E140's stores its eye word
    // (0xa2717360) at 0x5004869b in another shape than E144's 0x5004a521, D); and the YCbCr conversion 0x501db1c8
    // (through E144 0x50165945, not checked). E142 is taken; the eye state's two addresses are open on E140
    port_via: 'E142',
    // the device open's interrupt wait (its timeout's errlog 0x37005206 expected, src/lab/display.mjs
    // EXPECTED_ERRLOG): IRQ 120 (0x5016c5a4), called at 0x50163fee, the code at 0x50164003 (D); reached, X
    // the shared stand-in (G4SET_UNCHECKED); start and S1 run with it (X)
    g4set: G4SET_UNCHECKED,
  },
  E125: {
    name: 'E-M1 II', bin: 'OLY_E_125_3700_0000_0000.BIN', version: '3.7', res_block: 'blk01600000.OE.0101.bin', checked: true,
    rom_len: 23068608, rom_sha256: '0a41fb8e1105751f7817e5664f2edf2a1bdf399f070e91b4e3c84e6943113803',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 23330784, res_sha256: 'bd25f933ce5572b799776b5eaadc11876cd096e78a4182c71cebc44649ad386e',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E134 pairs 4.22M instructions with 28 conflicts, the one from E139 3.85M (37), from E144 4.72M
    // (51); through E134 108 of the overrides carry (54 nulls) and 7 fail, 60 lab addresses stay unplaced, through
    // E139 96 (45), 13 and 60, through E144 104 (53), 20 and 68 (X: port.json port_via.map, carried, carry_failed,
    // unmapped, bin/port.mjs with each). All three place the kernel tick init (0x50034f34) and the TFT vtotal function
    // (0x5022aaa8); only through E134 is the EVF vtotal function placed at its entry, 0x501729ab `movbu (0x6223ab28),d1;
    // mov 787,d0; cmp 1,d1` as E139's 0x50021641 (through E139 0x501729a6, a `mov 1,d0; retf` before it, through E144
    // 0x501729e0, inside it, D). E134 is taken
    port_via: 'E134',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    extra_tasks: [
      0x5078D50B,   // OlyHfwBatteryManager's thread ("thread_entry()"), which its init creates (priority 54, stack 1792,
                    // 0x5078d2ba..d3) and starts in the camera application's start (S-CAMAPP, X); E143 has no battery
                    // manager (no "OlyHfwBatteryManager" string, X)
    ],
    // S-CARD's mount test (src/lab/camapp.mjs): E125's DCF remain count 0x505f49ad tests the drive status 0x5061cb03
    // returns for its error bits only, `btst 63,d0; mov 1,d1; beq` at 0x505f49d0, where E143's (0x5087d7dc) goes on
    // only with the mount bit 0x1000 set too, `btst 4096,d1; bne` at 0x5087d80a, the status's bit 12 copied from the
    // device state's bit 16 (0x508a83e7; E125's 0x5061cbb5, D). The lab's drive status is 0x8600 on both (X), so
    // getMovieTimeInMedia's count (from 0x502de73d, E143's from 0x503f1bcd) returned on E143 and on E125 counted the
    // free clusters of drive 0's volume, null in the table 0x622907d4, and divided by its zero cluster field at
    // 0x505feaf0 (X). Of the 16 bodies scanned only E125's count lacks a second test (E129's tests bit 0x80, E145's
    // and E132's `and` the error mask before `btst 4096`; X, a byte scan of the expanded images for the count's
    // property reads 0xf021, 0xf051 and the tests before them). With it the count takes its own not-mounted return
    // (its type-4 call 0x5031a8d0, as E143's 0x5087e9f5, then 0) and the start goes on (X)
    dcf_mount_test: { at: 0x505F49D0, reg: 'd0' },
  },
  E145: {
    name: 'TG-7', bin: 'OLY_E_145_1103_0000_0000.BIN', version: '1.1', res_block: 'blk01380000.OE.0101.bin', checked: true,
    rom_len: 20447168, rom_sha256: 'e52660cc0aad6057831d15f721c5d4bd159fc728cdbf78772a35ec11c33e8c47',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 13577184, res_sha256: '5404cb456e2f5cddb7fa1ace6fa3210b6b2ea3e55908d71c3140434880b7fd98',
    // TFT 1.04M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E142 pairs 2.01M instructions with 121 conflicts, the one from E140 2.17M (116), from E144 1.83M
    // (117); through E142 120 of the overrides carry (60 nulls) and 14 fail, 77 lab addresses stay unplaced, through
    // E140 120 (60), 15 and 79, through E144 106 (53), 20 and 80 (X: port.json port_via.map, carried, carry_failed,
    // unmapped, bin/port.mjs with each). Through E142 the DB init and its flash save return are placed (0x5028eb02,
    // 0x5028eb32), through E140 and E144 not; none of the three places the touch I2C functions, which E145 lacks
    // (src/fw/facts.mjs touchDriver). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
  },
  E133: {
    name: 'E-PL9', bin: 'OLY_E_133_1101_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: '8e39c335d54fd8ddea189db82fe708159f43f9995bba42c2cd47dd22b8814267',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 21456352, res_sha256: 'd777456e3c2e41db6a55458cb8ec37d1a6589391f8103b3ec38be7cae59aaa43',
    // TFT 1.037M dots; no EVF
    panels: { tft: [720, 480], evf: null },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E143 pairs 1.04M instructions; from E142 2.24M with 122 conflicts, from E140 2.35M (120), from E125
    // 5.20M (84), from E145 2.04M (79); through E142 120 of the overrides carry (60 nulls) and 12 fail, through E140
    // 120 (60) and 13, through E125 131 (60) and 3, through E145 133 (72) and 6 (X: port.json port_via.map, carried,
    // carry_failed, bin/port.mjs with each). Through E142 and E140 the start runs to the session's touch start, through
    // E125 it stops at the settings store's unplaced init (E143 0x503c5473; X, the tft child with each). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
  },
  E130: {
    name: 'E-M10 III', bin: 'OLY_E_130_1200_0000_0000.BIN', version: '1.2', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: '8c3099214a3ec1aa29a9058997c4472072bdeddda8c8df93ec707d7a0bc31eb9',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 21476832, res_sha256: 'a21935005597087e0a43f0a99cee28376c142a4e55339d76ab2ed8286228cb15',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    board: { family: 'E144' },
    // the map from E143 pairs 1.02M instructions; from E142 2.11M with 45 conflicts, from E140 2.15M (47), from E145
    // 1.98M (71); through E142 118 of the overrides carry (60 nulls) and 14 fail, through E140 117 (60) and 16, through
    // E145 133 (72) and 6 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each). Through E142 and
    // E140 the start runs to the session's touch start, through E145 it stops before, at the settings store's unplaced
    // init (E143 0x503c5473; X, the tft child with each). E142 is taken
    port_via: 'E142',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // the AF module's OSD upload (camapp.mjs S-AFOSD), which neither map places, was a hand override here until the
    // rule framePlane (src/fw/facts.mjs) placed it at the same 0x50022dd8, the plane's mode-3 upload (2026-10-29)
  },
  E129: {
    name: 'TG-5', bin: 'OLY_E_129_1101_0000_0000.BIN', version: '1.1', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: 'a57f3d72282b2f923bcc38e53f1159f51af708c219e065986936064ca4cf93a5',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 17276384, res_sha256: '110a674b5dfe8d127eb241b24c4cb60a5675ce14a1d435687a53eb36c6663f1b',
    // the vendor's specification gives the TFT as 460K dots, not its pixel geometry (I: unchecked); no EVF
    panels: { tft: null, evf: null },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    // the family's stub pages and the serial controllers' blocks of channels 9, 2 and 3, as E132's (its sessions write
    // those blocks and no other, X)
    board: { family: 'E144', stub_pages: [0x98800000, 0x98F20000, 0x9A200000, 0x9B800000, 0x9B801000, 0x9BC00000, 0x9BD00000, 0x9A100000, 0x98500000, 0x98600000] },
    // the map from E143 pairs 0.94M instructions; from E145 2.61M with 33 conflicts, from E142 1.76M (129), from E140
    // 1.84M (117); through E145 137 of the overrides carry (72 nulls) and 2 fail, through E142 116 (60) and 16, through
    // E140 117 (60) and 16 (X: port.json port_via.map, carried, carry_failed, bin/port.mjs with each). Through E142 and
    // E140 the display start stops at E143's EVF frame period word, which neither places (this TG-5 has no EVF),
    // through E145 (TG-7, no EVF either) it runs past it (X, the tft child with each). E145 is taken
    port_via: 'E145',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // PER_SIO's devices the lab has (src/lab/sio.mjs S-SIOIIC): the internal charger on channel 9 (S-CHARGER,
    // src/lab/charger.mjs), as E132's: its start writes register 1 and reads it back over the same transfers (X)
    sio_devices: [{ channel: 9, device: 'charger' }],
  },
  E132: {
    name: 'TG-5 (KOUICHIRO)', bin: 'OLY_E_132_1300_0000_0000.BIN', version: '1.3', res_block: 'blk01900000.OE.0101.bin', checked: true,
    rom_len: 26214336, rom_sha256: 'e3ecb52bb83d376ff97b2543293e7a20c44490671fae5c1ebad327c8584c09f7',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x604000f9,a0; jmp (a0) (D)
    image_base: 0x60400020,
    res_len: 18550240, res_sha256: 'd0fa5807f2e4fbbf384b464082c35a9a59355c12fb73830987d15d08d4b162bc',
    // a TG-5 (the reply's model_name TG-5(KOUICHIRO)): its TFT of 460K dots, no geometry given; no EVF
    panels: { tft: null, evf: null },
    card_fs: { native: true },   // the card's file system natively (src/lab/storage.mjs; X: modelcheck's card)
    // the family's stub pages (src/fw/board.mjs FAMILIES.E144) and the register blocks of the serial controllers its
    // channels use once PER_SIO's channel map is set (H-SIOMAP, src/lab/sio.mjs): channel map 0x604aa840 (core 0's,
    // the setter's table 0x604aa830 / 0x604aa86c), channel 9 -> index 7, 2 -> index 2 and 3 -> index 3, and the
    // driver's register table 0x604aa1a8 (132 bytes an index): index 7's registers at 0x9a100000.., index 2's at
    // 0x98500000.., index 3's at 0x98600000.. (D). The driver's configurations write them; the transfers on channel 9
    // are S-SIOIIC's, on channel 2 the panel's, on channel 3 the IIC bus driver's (the compass's and the
    // accelerometer's, whose waits S-IICWAIT answers) (I: the pages keep what is written, as the family's)
    board: { family: 'E144', stub_pages: [0x98800000, 0x98F20000, 0x9A200000, 0x9B800000, 0x9B801000, 0x9BC00000, 0x9BD00000, 0x9A100000, 0x98500000, 0x98600000] },
    // as E129, a TG-5 whose main block has E129's size and base: E145 is taken; the map from E145 pairs 2.68M
    // instructions with 20 conflicts, 137 of the overrides carry (72 nulls) and 2 fail (X: port.json port_via.map,
    // carried, carry_failed); the other references were not measured
    port_via: 'E145',
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // PER_SIO's devices the lab has (src/lab/sio.mjs S-SIOIIC): the internal charger on channel 9 (S-CHARGER,
    // src/lab/charger.mjs), which the charger init 0x5003fa04 configures (0x5003fa27: channel 9 at 400 kHz, D) and the
    // camera application's start writes and reads back (X). The charger request 0x5003fa92: its table of register
    // values 0x5003fb04..0x5003fb84, the address bytes 0x36 at 0x5003faeb and 0x37 at 0x5003fc2b, the read-back test
    // 0x5003fc70..7e (a mismatch to the error path 0x5003fe6e(2)), the type-2 read 0x5003fc87..0x5003fd12, the
    // completion waits' errlogs 0x1d003003 / 0x1d003004; the IIC layer's write 0x5004ba70 and write-read 0x5004bac8
    // (its restart list through 0x5004ba5c -> 0x500505e1 mode 2) start the driver's 0x500506cb and 0x500509be with a1
    // 0 (the polled path 0x50050821), and the interrupt's ends 0x50051719..0x50051770 and 0x500519f2..0x50051a84
    // dispatch through 0x50051814 (D)
    sio_devices: [{ channel: 9, device: 'charger' }],
    // module queues of its API target table (0x608542fc, by target) that E143's has no counterpart of, which S-MODACK
    // answers as it answers E143's (src/lab/camapp.mjs module_queues): target 38 -> 0xe6 and 43 -> 0xdf, named
    // CATEGORY_MAIN and LOGGER_MAIN in the object-name table (name[24] + u16 id, their records at 0x512ef790 and
    // 0x512ef6da, D). Their tasks do not run in the lab. CATEGORY_MAIN: the start's error factor check (0x50be0796,
    // setErrorFactor) asks isCategoryUpdate first (0x50be13b8), which on this body (an industrial TG-5,
    // OlyHfwOpeIndustrial, the CALS quality) is a real check: the synchronous DISPLAY cmd 43 (0x5029c9e9 ->
    // 0x50299470), whose status 0 reads as "update" (the DISPLAY loop's reply word (36,sp), cleared at 0x501ecf4f, is
    // not set by cmd 43's handler 0x501ed607, D; that the send returns it, I); so the start shows "Update folder
    // Allocation"'s progress screen (factor 22 -> request 267 -> GUI 0x10c, "Busy") and updateCategoryInfo
    // (0x50710d83) posts its request to CATEGORY_MAIN (D; E145 has the same check as a stub that returns 0,
    // 0x50743489, D). Without the answer the screen stayed (X). LOGGER_MAIN: its request is posted at the start;
    // without the answer the session stops after the clock is set, the application's queue 6 full (X; why is ?)
    modack_queues: [[0xE6, 'CATEGORY_MAIN'], [0xDF, 'LOGGER_MAIN']],
  },
  E118: {
    name: 'E-M5 II', bin: 'OLY_E_118_4100_0000_0000.BIN', version: '4.1', res_block: 'blk01460000.OE.0101.bin',
    rom_len: 21364672, rom_sha256: 'ecd9603c4a264a358d91ef110a05f9236055e6369399f7c7de5985b21a2fd96a',
    // the reset head's jump into the run-time copy at 0x500000d1: mov 0x60021114,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 19291104, res_sha256: 'b1e448561edfc9c56a08fd5fa5c3d6307fc4741149bb40d951940e82364ccc5f',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    // the card native since 2026-10-30 (docs/model-survey.md finding 51): its SD driver switches a card line through
    // the sub-CPU (src/lab/storage.mjs S-SDSWITCH) and its movie record time divides by the movie info's frame rate
    // (src/lab/camapp.mjs S-MOVRATE); the blank 8 GiB card formatted FAT32 'NO NAME' at 8192 with 32 KiB clusters,
    // 2116 shots and 0:37:19 from it, S2's file read back (X: bin/modelcheck.mjs, the OSD records)
    card_fs: { native: true },
    board: { family: 'E118' },
    // through E122 (port_via): the family's reference, whose overrides it takes over (the evidence at E122's entry)
    port_via: 'E122',
    // as E122's (src/fw/models.mjs E122, the evidence there): the reset path's early driver inits, the table walk
    // 0x50065a9d (called at 0x50000293; the same code as E122's 0x50062ed4, X: twin.mjs bytes with the calls and addresses
    // masked), no disp_sync module ("disp_sync_work" absent, X), the frame period assumed (A-PERIOD; the rule reads no
    // period word on it either, src/fw/facts.mjs framePeriod null, X)
    boot_drivers: 0x50065A9D,
    disp_sync_init: false,
    frame_period_us: { tft: 16683, evf: 16683 },
    // the dial init 0x5016558b takes one fixed id table, 0x601b1e58 (`mov 0x601b1e58,d0` for its slot set-up from 0xa1c184a8), with
    // no board select and no table pointer (D): src/lab/menu.mjs dial_init runs it alone
    dial: { table_ptr: null, table0: 0x601B1E58 },
    // E122's display task (src/fw/models.mjs E122): the static task table's row 0x51, whose entry word (image offset
    // 0x18f70, as on E122 and E120) holds 0x602f3fed (D), which the display task init starts (X: the kernel's start of
    // it from that step); the same opening as E122's 0x502f90f5 in another order (D), which the map does not pair
    extra_tasks: [0x502D2FCD],
    g4set: G4SET_UNCHECKED,
    touch: false,
    frame_plane: null,
    overrides: {
      '0x5014b7c7': { to: '0x5016558b', why: 'the dial init (DIAL_INIT): the dial module init, which sets up the dial slots from 0xa1c184a8 with the fixed id table 0x601b1e58 (D); E122\'s, which selects a table by board, does not carry (menu)' },
      '0x5002e758': { to: '0x5004c674', why: 'LEVEL_HANDLERS[2]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c674 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e715': { to: '0x5004c636', why: 'LEVEL_HANDLERS[3]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c636 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e6d2': { to: '0x5004c5f8', why: 'LEVEL_HANDLERS[4]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c5f8 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e68f': { to: '0x5004c5ba', why: 'LEVEL_HANDLERS[5]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c5ba (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
    },
  },
  E122: {
    name: 'PEN-F', bin: 'OLY_E_122_3101_0000_0000.BIN', version: '3.1', res_block: 'blk01460000.OE.0101.bin', checked: true,
    rom_len: 21364672, rom_sha256: 'a2eb1d1f1afe47cce148e9aae0a04dfb82547d9de9437d342e012341140913f4',
    // the reset head's jump into the run-time copy at 0x500000b6: mov 0x600210f9,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 19767776, res_sha256: '8509050a3374abf6237254ad0a2627fa33aaccf7612e2dafae7e6ba481e77407',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    // the card native since 2026-10-30 (docs/model-survey.md finding 41): src/fw/facts.mjs fileSystem reads the family's
    // forms; the blank 8 GiB card formatted FAT32 'NO NAME' at 8192 with 32 KiB clusters, 1470 shots and 0:37:19 from
    // it, S2's file read back (X: bin/modelcheck.mjs, the OSD records)
    card_fs: { native: true },
    board: { family: 'E118' },
    // the map from E143 leaves 116 of the lab's addresses unplaced; through E125 113 (107 of its overrides carried, 62
    // nulls, 26 failed), through E130 114 (122 carried, 71 nulls, 18 failed); through E142, E137, E144 and E140 the
    // port stops at the hardware-timer rule on a carried place (X: bin/port.mjs with each). E130 is taken, the family's
    // reference for E118 and E120 (port_via E122), with E122's own overrides first
    port_via: 'E130',
    overrides: OVERRIDES_E122,
    // the early driver inits the reset path runs through 0x50062ed4 (called at 0x50000278, before the kernel): four
    // entries of the table 0x6012b74c, of which 0x50001b8d does the work (the GIO pins' configuration, 0x9b800000 and
    // 0x9b801000, and at 0x50001e0d..0x50001e6c the timer pool: its 15 records and the free masks 0xa1c3ac48 = 0x7fff,
    // 0xa1c3ac4c = 0x3f) and the other three return (D). The software-timer init allocates its channels from that pool
    // and logs 0x19001802 when it finds none free (0x5006600d, X: without the step); the lab's start enters at the
    // kernel, so H-DRVINIT runs it (src/lab/display.mjs)
    boot_drivers: 0x50062ED4,
    // no disp_sync module of E143's form (0x507f2fe0, its work table "disp_sync_work": no such string, X); its display
    // module keeps a disp_sync parameter of its own (disp_update_image_disp_sync_param, 0x502cb203.., D), so the display
    // start has no disp_sync init to run (src/lab/display.mjs)
    disp_sync_init: false,
    // A-PERIOD: the TFT's and the EVF's vtotal functions return constants (0x50302e5f 495 lines, 0x502fa8eb 825, D) and
    // no frame period getter follows them (src/fw/facts.mjs framePeriod null, X); the period is ?, the lab assumes E143's
    // TFT period word's 16683 us (59.94 Hz) for both, which sets only the lab clock's line time
    frame_period_us: { tft: 16683, evf: 16683 },
    // the dial-table select (src/lab/menu.mjs dial_init), of a form src/fw/facts.mjs dialSelect and dialStore do not
    // read: the dial module init 0x50176f46 (E143's DIAL_INIT's place, src/fw/overrides-E122.mjs) stores the board's id
    // table from the preloaded table 0x615fc838 into 0xa1c57f34, indexed through 16 {board byte, index} pairs at
    // 0x601c2fec (D). The board byte is 4: H-DRVINIT's board-id read (0x50001d91) packs three strap pins' level bits,
    // which the lab stub reads 0, and maps id 0 to 4 through the pairs at 0x60026864 (0:4, 3:3, 5:1, 6:2, 7:0; any other
    // id halts at 0x50002388, D); board 4 takes index 1, the table 0x601c3054 (X). Which revision a PEN-F has is ?
    dial: { select: 0x50176F46, select_end: 0x59, table_ptr: 0xA1C57F34, table0: 0x601C3054, board: 4 },
    // the shared stand-in (G4SET_UNCHECKED)
    g4set: G4SET_UNCHECKED,
    // no frame plane of E143's form (src/lab/camapp.mjs S-TAKEFRAME, S-AFOSD): src/fw/facts.mjs framePlane reads none and
    // the map places neither the frame display mode set (E143 0x500256d9) nor the AF upload (0x500257ce) (X); where its
    // AF frames are drawn is ?
    frame_plane: null,
    // the touch panel is not modelled on it: the lab's touch start needs the panel's open and the HFW callbacks, which
    // src/fw/facts.mjs touchOpen does not read in its build and the map does not place (X: port.json)
    touch: false,
    extra_tasks: [
      0x502F90F5,   // a display task (static row 0x51, stack 0x800) that the display task init starts (OlyTaSt at
                    // 0x502f8f6a, after its mailbox 0x5004adef); it waits on the flag in 0x60041034 and drives the VSC
                    // driver's 0x503078b9 and 0x5030a68b (D); no E143 code pairs with it (X: xwhere)
    ],
  },
  E120: {
    name: 'E-M10 II', bin: 'OLY_E_120_1400_0000_0000.BIN', version: '1.4', res_block: 'blk01460000.OE.0101.bin',
    rom_len: 21364672, rom_sha256: '309682c05a96d3079ebcae598169d487fea7f8b2531d8ae99445d63e80ea7a39',
    // the reset head's jump into the run-time copy at 0x500000d1: mov 0x60021114,a0; jmp (a0) (D)
    image_base: 0x60021020,
    res_len: 18415584, res_sha256: 'f12ebf2598496f11bfdecff105f933a9f60c2cfff6a479258e9c6c34cb9236f0',
    // TFT 1.037M dots, EVF 2.36M dots
    panels: { tft: [720, 480], evf: [1024, 768] },
    // the card native since 2026-10-30 (docs/model-survey.md finding 51): the play bring-up mounts it before the start
    // stays at POWER_ON, the blank 8 GiB card formatted FAT32 and DCF folder 100, file 1 (X: a play session per device)
    card_fs: { native: true },
    board: { family: 'E118' },
    // through E122 (port_via): the family's reference, whose overrides it takes over (the evidence at E122's entry)
    port_via: 'E122',
    // as E122's (src/fw/models.mjs E122, the evidence there): the reset path's early driver inits, the table walk
    // 0x50064732 (called at 0x50000293; the same code as E122's 0x50062ed4, X: twin.mjs bytes with the calls and addresses
    // masked), no disp_sync module ("disp_sync_work" absent, X), the frame period assumed (A-PERIOD; the rule reads no
    // period word on it either, src/fw/facts.mjs framePeriod null, X)
    boot_drivers: 0x50064732,
    disp_sync_init: false,
    frame_period_us: { tft: 16683, evf: 16683 },
    // the dial init 0x5015d3a6 takes one fixed id table, 0x601a8810 (`mov 0x601a8810,d0` for its slot set-up from 0xa1c17b80), with
    // no board select and no table pointer (D): src/lab/menu.mjs dial_init runs it alone
    dial: { table_ptr: null, table0: 0x601A8810 },
    // E122's display task (src/fw/models.mjs E122, E118): the static task table's row 0x51, whose entry word (image
    // offset 0x18f70) holds 0x602e7a9d (D), which the display task init starts (X: the kernel's start of it from that step)
    extra_tasks: [0x502C6A7D],
    g4set: G4SET_UNCHECKED,
    touch: false,
    frame_plane: null,
    overrides: {
      '0x5014b7c7': { to: '0x5015d3a6', why: 'the dial init (DIAL_INIT): the dial module init, which sets up the dial slots from 0xa1c17b80 with the fixed id table 0x601a8810 (D); E122\'s, which selects a table by board, does not carry (menu)' },
      '0x51049ebb': { to: '0x508eaf45', why: 'CA_MAIN, the camera application\'s main task: its object of 68 bytes created, its constructor 0x5090c80e and run 0x5090c824 called, then 0x508eafe2, as E122\'s 0x50b738ce in short call forms (D); neither map places it (camapp)' },
      '0x5002e758': { to: '0x5004c624', why: 'LEVEL_HANDLERS[2]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c624 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e715': { to: '0x5004c5e6', why: 'LEVEL_HANDLERS[3]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c5e6 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e6d2': { to: '0x5004c5a8', why: 'LEVEL_HANDLERS[4]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c5a8 (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
      '0x5002e68f': { to: '0x5004c56a', why: 'LEVEL_HANDLERS[5]: the kernel\'s level-handler table kcb[88] after its init holds 0x5004c56a (X); the leg map put levels 2 and 3 on level 1\'s handler and levels 4 and 5 one handler late (irq)' },
    },
  },
};
export const codeOf = (m) => 'E' + m.bin.slice(6, 9);
export const romPath = (m) => `unpacked/${codeOf(m)}/${m.bin}.blk00000000.OE.0100.bin`;
export const resPath = (m) => `unpacked/${codeOf(m)}/${m.bin}.${m.res_block}`;
// the SCPU block of a body that gives scpu_lle, else null
export const scpuPath = (m) => (m.scpu_lle ? `unpacked/${codeOf(m)}/${m.bin}.${m.scpu_lle.block}` : null);
