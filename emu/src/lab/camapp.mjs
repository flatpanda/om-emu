// S-CAMAPP: the camera application (CA_MAIN, task 58) running natively in every play session, with the stand-ins it
// needs below it. docs/om1-shutter-spec.md section 7 has the evidence (items 14 to 22 and on). The application maps the
// keys and takes the GUI from power-on to the shooting screen itself (the lab's own stand-ins for it, S-CAMSEQ and
// S-KEYMAP, are gone).
//
//   S-CAMAPP   the boot chain's HighLevel steps (create 0x50ab222a, init 0x50ab22bc, called at 0x501e9dbc / 0x501e9dd1),
//              the event broker init 0x502a48b6, with the components (control camapp 2) act_tsk(57) (HIGHLEVEL_MAIN
//              0x50ab2293: the OXF main thread's event loop, which every HLS reactive's events wait for), act_tsk(58); the task entries they start are allowed,
//              the places the application reads module 9's state join S-TAKEOVER's readers, its output-device read
//              joins S-PROP's sites
//   S-LONGTIMER the system timer module's long timers: the HLS timer service hands timers of 1000 ms and more to it
//              (api_system.c 0x5041fd71 / 0x5041fd0d: timer number, ms; 0 ms stops), and the module publishes event
//              0x03010000 | number when one runs out (the HLS timer 3..: 0x0301003x). The module does not run, so the
//              application's 3 s and 1 s timers never ran out; S-LONGTIMER publishes the event (0x50025095) once the
//              lab time is due
//   S-BOOTDONE (control camapp 2 only) the HLS components' boot completion: the camera base (Cab_CameraBase, vtable 0x60ef0b88) and the
//              still-shooting category (CtgStl_StillImageShooting, 0x60ef81d0) wait in their state 3 for event 415,
//              which the application's own HighLevel init sends as TRA 415 through the transaction exec (the event
//              of vtable 0x60dca154 built at 0x50ab2dda, the exec at 0x50ab2def, X), and S-TRAACK answered it at the
//              exec (with S-RPC in the receiver's place; control camapp 3 runs both natively); S-BOOTDONE
//              dispatches 415 to each that waits there, and 420 (the shooting mode, as OlyHfwOpeComRsbChangeMode makes it for mode
//              0x10000; its RSB request reaches the components through S-RPC's other entry, 0x50ac734c) to the camera
//              base waiting in its state 11. The camera base then creates the shoot mode
//              (ModSht_ShootMode), which creates the category, which creates Cmp_ShootingComponent. The sub-CPU status
//              read 0x5012b8b7 the component's constructor makes (SCPU 0x98e000c0 / 0xd0, not in the lab's SCPU) returns 0.
//              Off by default: with the components running the GUI shows its shooting panel over a black image area
//              (disp_shooting 1, docs/om1-shutter-spec.md section 7 item 40), why is ?
//   S-CPU3     (control camapp 2 only) the posts the running components make to CPU 3 (the display API's remote calls, api_disp.c 0x503e8bff ->
//              the inter-CPU post 0x50035b28, ring [3][0], function 0x5002587a) are taken off the ring and acknowledged
//              after each step, as if CPU 3's task had run them; nothing they ask for is done (the lab has no CPU 3)
//   S-MODACK   every request the application's API sender posts (OlyQeWr returning to 0x503eba07) to a module queue
//              is answered after the step with [status 0, token = word 1, word 3] to the reply queue in its word 0
//              (the layout of DISPLAY's replies, 0x501c48bf); every synchronous send (0x5002e39d) the lab's own stand-in
//              refuses returns E_OK. Nothing a module would write back is written. The message is taken, as the
//              module's task would take it off its queue: OlyQeWr returns E_OK without putting it in the kernel's
//              queue, which no task reads (until 2026-11-10 it was put there: PLAY_EXEC's queue holds two, and
//              camapp 3's third play request blocked the OXF main thread for good, docs/hle-gaps.md 4.3.2). The
//              queues whose module the lab runs leave S-MODACK (install(): FILECLBK, UI_OUT_EXEC, AUD_EXEC, the
//              native lens's LENS_EXEC and LENS_COMMAND, TAKE's with --take probe)
//   S-DISPQ's replies (with the application): the replies the DISPLAY loop sends to queue 6 while S-DISPQ runs it
//              (play.mjs, 0x501c490c / 0x501c496d), which S-DISPQ records, go to queue 6 after the step, each followed
//              by a settle: the application's event task (entry 0x50abbf0c) reads that queue (0x503ebf63), and a reply
//              (id 0xf0000000 | slot << 16) frees its request slot's buffer (0x503ea264 -> 0x503ebae0 -> free at
//              0x503ebb3f, the 192 bytes 0x503eb91b allocated). Recorded only, every request's buffer stayed allocated
//              (X: 6 blocks a pass of S1, S2, the menu and playback; docs/hle-gaps.md 4.4.2). That the camera's reply
//              comes before the requester's next step is I (DISPLAY outranks the GUI)
//   S-DISPSYNC the release of the GUI's synced display updates: while the application's sync word for a panel is
//              set (CameraCommon::setDispSync, which E137's GUI asks for at the start), the GUI's update sends the
//              display manager a request of type 3, which leaves its buffers pending until an image sync names the
//              device (fact display.sync, src/fw/facts.mjs displaySync, which has the evidence). Their one sender, the
//              shooting sequence's stopRecView, does not run in an idle session, so E137's screen stayed one colour
//              and then showed only its wait clock (X). After the step (or idle slice) the lab releases each device
//              with such a request: the sync words of both panels cleared through the application's setter, as
//              stopRecView does, then the image sync of the fact's kind, the one whose event the manager takes in the
//              state the type-3 request leaves, which commits the pending buffers (D, displaySync has the manager's
//              table): kind 1 with the setter's both-panel value 2, and on the E118 family's display sync modules kind
//              0 with one call per panel (0, 1); on E120's record form the request's type (5, its async update) and
//              device are the record's fields, and the release passes a record of code 18, kind 0's, and the device
//              (the fact's record). stopRecView's kind 2 is not taken in that state: under it E137's screen came only
//              with its GUI's next update, a 250 ms redraw of a blinking item that the clear made an ordinary request,
//              and E125's GUI, which sends no further update, kept a one-colour frame (X); E122's composite had no OSD
//              plane enabled (X). The camera releases it with the image's next update: on the E118 family
//              DevDpc_DispCtrlBase's imageUpdate() clears a panel's sync word after its image update once
//              api_disp_Disp_Get_Wait_State answers 0, as setThroughPermit() and the still shooting component's
//              rcvShtDrawThrough() do (D, docs/model-survey.md finding 100); the lab runs no image update and releases
//              at the step's end (I: the camera's first one comes with its through image's start)
//   S-RVSTANDBY the rec view component in standby: the shooting components' RecView, which does not run, would
//              store its standby state (1) in the application's state word as its entryStandby does (fact recview,
//              src/fw/facts.mjs recViewStandby, which has the evidence); the word starts at 0, which getRecViewState
//              takes for a rec view. E142's GUI asks SubAppMdlRecview::isRecviewOn at the start (docs/model-survey.md has
//              the addresses); with the word 0 it posted EVT_REC_DISP_RECVIEW (index 155, 0xf005) where E137's posts
//              EVT_REQ_REC_DISP_INFO, and drew the rec view's items only ("4:3 RAW"), so its screen stayed one colour
//              under S-DISPSYNC (X). Set before the application starts; with it E142 draws its shooting screen (X).
//              That the camera's component is in standby at the start is I (its other states are a shot's rec view)
//   S-TRAACK   the HLS transaction layer's synchronous exec (0x50af7cb9 by calls, 0x50af7cbe by call) returns 0: no
//              local handler is ever registered (the request that would add one is never built, on the camera too), so
//              every transaction takes the remote path to the active state's components, where the shooting component
//              CmpSht_ShootingComponent_NEW answers TRA 990 and 991; it runs only with the HLS components (camapp 2),
//              and the remote channel answers 0xf0000001 (docs/hle-gaps.md 4.1.2, D). The request is consumed as the
//              exec consumes one itself: its senders allocate it (operator new) and leave it to the exec, which deletes
//              it through its own vt[1] (the event's delete, which honours its delete-after-consume flag) where a
//              local handler took it or no receiver is there, and hands it to the receiver on the remote path (D); so
//              S-TRAACK, in the remote receiver's place, deletes it through vt[1] natively before it returns (I: that
//              the receiver deletes it once dispatched). Without it every request stayed allocated (X: about 5 blocks
//              a second on the idle shooting screen, getHistogramData's 40-byte events)
//   S-RELSEQ   the modules' notifications of a release, as the callbacks the HLS shooting reactive posts for them
//              (0x50af4451, CBC_SHOOTING_COMMON): S1 down -> START_FOCUS, END_FOCUS(1, or 0 when the S-SCENE live view
//              is on and nothing focusable is under its AF point); S2 down -> START_SHOOTING_PICTURE, START_EXPOSE, then
//              after the exposure time (S-SCENE's shutter in use, else 1/125 s) END_EXPOSE, END_SHOOTING_PICTURE,
//              START_RECVIEW, and END_RECVIEW 500 ms of lab time later, then START_THROUGH_IMAGE_PROCESS, the through
//              image's restart after the rec view: the reactive posts it for the notification 1366 (its handler
//              0x50af4a63), which the through image capability and the sequence parts build (CapThr_ThroughImage,
//              CmpSqp_SequencePartsBase: the builder 0x50af2daf's callers 0x50bd2488, 0x50c87ef1, 0x50cacf6b, D); that
//              it comes right after the rec view's end is I. The GUIs of the E118 family, E142, E140, E130, E133,
//              E145, E129 and E132 leave their rec view's display on it alone (EVT_REQ_REC_DISP_INFO 0xf001,
//              docs/model-survey.md finding 69): without it their screens kept no OSD after S2 (X). When the
//              application starts its function
//              RECORDING_MOVIE (27; observed at 0x51068e37, past its checks), the recording starts (START_READY_MOVIE,
//              END_READY_MOVIE, START_SHOOTING_MOVIE, START_RECORDING_MOVIE, then UPDATE_SHOOTING_TIME(seconds) every
//              second); the next REC press ends it (STOP_SHOOTING_MOVIE, END_RECORDING_MOVIE: while recording the
//              application starts no function on the key). The application takes only the callbacks in its translation
//              table (0x5108226d, keyed by id - 2 at 0x613062e0): UPDATE_RECORDING_TIME (234) is not among them, and
//              without START_SHOOTING_MOVIE the GUI shows nothing while recording. During the movie the shooting phase
//              query (0x50ab57e9, 100 with no sequence controller) answers the phases the shooting component's sequence
//              would enter (MOVIE_PHASE), so getMovieState is 1 and the GUI lays out its REC mark and recording time.
//              Which notification each module sends, and when, is not known: the order follows the callbacks' names
//   S-SHUTTERSND (a host that plays sound: PlaySession.audio, src/lab/audio.mjs) the mechanical shutter's sound,
//              which on the camera is the mechanism's, synthesized (src/lab/shuttersnd.mjs): an open click at each
//              release's START_EXPOSE and a close click at its END_EXPOSE's due time, the shutter time in use later
//   S-AFLOCK   (E143, while UI_OUT runs: H-UIOUTSTART) the AF lock as the shooting sequence, the take capability and
//              the AF module would hold it, fed from S-RELSEQ's focus callbacks (see TAKE_STATUS_SET): S1 down sets
//              the still sequence's READY bit in the shared take status, END_FOCUS(OK) its READY_FINISH bit and the
//              take information's isFocus, and the AF module's state getter answers indicator 1; S1 up clears them.
//              It also posts the AF lock's callback, CBS_AF_LOCK(1) after END_FOCUS(OK) and CBS_AF_LOCK(0) at S1 up,
//              whose 0 re-arms the GUI's beep (CBS_AF_LOCK's comment). The application's own changedFocus then plays
//              the AF beep natively down to UI_OUT's sound request and, with the audio hardware, to the audio port
import { FirmwareError, where, runtime, disasm, SP } from './hle.mjs';
import { OPENED_WORD, HDMI_MASK, VSC_CHANNEL } from './display.mjs';
import { AssertionError } from './errors.mjs';
import { RPC_ENTRIES, bootFacts } from './menu.mjs';
import { packRegs } from './sim.mjs';
import { pack, unpack } from '../util/bytes.mjs';
import { hex } from '../util/hex.mjs';
import * as SC from './scene.mjs';
import { jpegOfFrame } from './jpeg.mjs';
import { HlsMedia } from './media.mjs';
import { SubjectFrames } from './subject.mjs';
import { MdetDl } from './mdet.mjs';
import { ShutterSound } from './shuttersnd.mjs';
import { TakeProbe } from './take.mjs';
import { A, MODEL, ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, knob, fact, isUnmapped } from '../fw/model.mjs';
import { DISPLAY_SYNC_E143, RECVIEW_E143, CBS_E143, LENS_ZOOM_TABLE_E143, CARD_DETECT_E143, STILL_E143, DCF_COUNTS_E143 } from '../fw/facts.mjs';
//   S-CARD     a card in the SD slot. On a body whose file system runs natively (storage.mjs; MODELS card_fs)
//              the card is a real block device (S-SDCARD) the firmware formats and mounts itself, and of S-CARD only
//              these stay: the HLS media mount state (SD 0x60360bfc and 0x60360c08, read through 0x50aca51d by
//              getMountState) is 8, as the HLS media layer would set it once the file layer reports the mount (the
//              application's card check passes, errFactor 0, and the GUI's count check 0x511ffcc9 too); each picture
//              taken (END_SHOOTING_PICTURE) is kept as the lab's record of its capture (images), and its file is
//              written through the file module (S-RECFILE, storage.mjs) in place of REC_FILE, whose recording modules
//              do not run (on E143, E146 and E147 REC_FILE's own task records it, rec.mjs).
//              Where REC's recorder records it (storage.mjs record(); dcf_db) the firmware's DCF database
//              counts it at once, and the image count (IMAGE_COUNT) and playback's pictures are the database's;
//              elsewhere S-CARD answers the count from its list and the database learns of the file at the next
//              mount (none while the card is out of the slot, and a format from the menu clears them: media.mjs).
//              The firmware counts the remaining shots
//              (getAvailableShootCount's query 0x50419164) and the movie time (0x5042da58) from the card itself, and
//              the card driver's detect state comes from the DCF process's card-in. On the other bodies the card has
//              no file system: the driver's detect state of drive 0 (CARD_DETECT) is set to 2, inserted, so the drive
//              status reports the card present and the GUI asks for the slot's count; the remaining-shots query (the
//              module request getAvailableShootCount makes; src/fw/facts.mjs shotsQuery) answers card_shots
//              (CARD_SHOTS unless bin/modelcheck.mjs's count probe sets it) less the images; the movie time query
//              (the module request behind getMovieCountdownTime's time left, 0x503f3cf5, and the time code,
//              0x503f3e4e) fills its 24-byte reply: +0 and +4 the time left in ms (CARD_MOVIE_S less the recordings'
//              time), +12 the recording's time in ms, +16 its whole seconds (the time code; +20, the frame, 0). Set
//              before CA_MAIN starts. An image is its number, its exposure and S-SCENE's scene at the capture. The
//              file layer sees no card there (its drive status lacks the mount bit 0x1000); a build whose DCF remain
//              count tests only the status's error bits (MODEL_INFO.dcf_mount_test, src/fw/models.mjs) gets the
//              mount test at its error-bit test: with the mount bit clear the stand-in sets error bit 0, so the count
//              returns as not mounted instead of reading the free clusters of a volume that does not exist
//   S-MOVRATE  (fact card.movie_rate: E118) the MN103's DIVU by 0 in the native movie time query's record time,
//              which divides by the movie info's frame rate without a test: that rate is 0 until a movie take or a
//              movie's playback runs the movie recorder's set-up, on the camera too; the divide alone is stood in
//              for, its quotient 0 (see the hook)
//   S-PLAYSEQ  the play module's notifications of the HLS play requests (see RSB_EXECUTE); S-PLAYCOMP answers for the
//              play component the HLS components would create (PLAY_COMPONENT); S-PLAYVIEW (play.mjs) shows the image;
//              the synchronous getNumber (5) and getStillInfo (3) are answered from the image shown where PlyCom asks no
//              component, the histogram (7) as empty
//   S-LENS     (unless the lens runs natively, the default on E143, E146 and E147: src/lab/lens.mjs and S-LENSMCU,
//              docs/hle-gaps.md 4.4.2, 4.4.3; OM_EMU_LENS=stand-in takes S-LENS there) a lens on the mount, the M.Zuiko 12-40mm F2.8 PRO: lens 0's attach
//              flag (0xa32d4b9a, read by 0x50126a20) and its data-valid flag (0xa32d4b98, 0x50126a08) are 1, so getLensConnection (0x504106f8) answers 1 and
//              the application leaves MF (S-AF on the screen, the AF target shown). Its record is the one the lens
//              driver's init (0x502ac2ce) points 0xa32caa8c at (static 0xa3193780), filled as the driver fills it: the
//              current STATE, CHARACTER and zoom-entry copies (0x502ac60b 0/1/2) written, then committed by the driver's
//              own 0x502ac838 and 0x502acb96, the zoom entries 1..n-1 written at +1164 + 16 i; the field names and
//              widths are the record dump's (0x50118662 STATE, 0x50118ab7 CHARACTER, 0x50118d20 CHARACTER_ZM). The
//              values are I (the lens's published specification: 12-40 mm, F2.8-F22, as APEX x 256 apertures, 761 and
//              2283, the unit 0x5057379f converts; the zoom steps LENS_ZOOM); the lens ID is the entry 0x1019 of the
//              lens table (0x506ea4f3). The driver's derived values then run natively (0x502a63c2 apertures,
//              0x50129a3e / 0x50129980 / 0x501299a2 focal lengths). No focus confirmation is drawn after END_FOCUS.
//              Set before CA_MAIN starts
//   S-EXPOSE   the brightness the exposure plan follows: the AE result the writer 0x50596187 writes when EXP calls back
//              (the data objects 0xc12a, 0xc0ba, 0xc0ca, one per metering mode, I; the plan reads the one its metering
//              mode picks, 0x505613ea) is set through the property setter 0x5004188b to the scene's brightness, BV =
//              (EV100 - 5) x 256 (APEX x 256: the plan keeps Tv + Av - Sv = BV), and take_expose_calculate
//              (0x50597e82) runs natively; its plan (0x62a919dc: +6 Tv, +10 Sv, +14 Av) is the camera's shutter,
//              aperture and ISO on the screen and, with S-SCENE, the live view's and the captures' exposure. The
//              scene is S-SCENE's when it has one, else its default (EV 12); the zoom step is the one nearest the
//              scene's focal length. The camera meters the live view continuously (EXP's AE requests, not run,
//              docs/hle-gaps.md 4.2.2): the lab plans once the application has started and again after each
//              input on the shooting screen

// BROKER_INIT: the event broker's init, which the boot chain calls through its wrapper (the port places it by
// src/fw/facts.mjs brokerInit)
export const HL_CREATE = A(0x50AB222A), HL_INIT = A(0x50AB22BC), BROKER_INIT = A(0x502A48B6), CA_MAIN = A(0x51049EBB);
export const HL_MAIN = A(0x50AB2293);
export const CA_TASK_ENTRIES = [CA_MAIN, HL_MAIN, A(0x50AB83F4), A(0x5108BA1B), A(0x50D9B388), A(0x50ABBF0C)];
// S-BOOTDONE: [name, vtable, dispatchEvent], the event classes' vtables (id at +4), the state word of the reactives
const BOOT_OBJECTS = [['Cab_CameraBase', A(0x60EF0B88), A(0x50D744FC)], ['CtgStl_StillImageShooting', A(0x60EF81D0), A(0x50D97281)]];
const EV_BOOT_DONE = [A(0x60DCA154), 415], EV_SHOOT_MODE = [A(0x60DCA2BC), 420], RX_STATE = 256, RX_EVENT = 104;
const HLS_HEAP = A(0x62A00000), HLS_HEAP_END = A(0x62C00000), SCPU_STATUS = A(0x5012B8B7);
const CPU3 = 3, CPU3_REMOTE_CALL = A(0x5002587A);
const LONG_TIMER_SET = [A(0x5041FD71), A(0x5041FD0D)], MODULE_EVENT_PUBLISH = A(0x50025095), LONG_TIMER_EVENT = 0x03010000;
export const CA_MODULE9_READERS = [A(0x50ABE026), A(0x50AF63F3), A(0x50ABB039), A(0x50ABA912), A(0x50AE0FA3), A(0x50AE138C), A(0x50AE1559), A(0x50AE1566), A(0x50AE15A2)];
export const CA_PROP_SITE = A(0x50B76DBE);
// the module-9 reads the native transaction path reaches (control camapp 3, X): the shooting component's set-up after
// TRA 990 (0x50c78b35: state 2 takes CapThr's start at 0x50c78bc1, D), the application's second read in 0x50abb032,
// made once the components have set the state to 0 (0x50ca4ae1), and the two reads of 0x50d787f0 at the HDMI plug
export const CMP_MODULE9_READERS = [A(0x50C78BB4), A(0x50ABB044), A(0x50D78808), A(0x50D78815)];
// the target table at 0x606214a0 (docs/om1-shutter-spec.md 2.2) without DISPLAY (0x88), plus PC_PD_CMD_EXEC (0xcf):
// E143's module queues by name, each the target table's entry at its target (src/fw/facts.mjs API_TARGETS_E143), which
// a ported body's fact 'api.queues' gives from its own table (src/fw/facts.mjs apiTargets: its ids differ, E122's
// XTC_APP_EXEC is 0x80; null where its table has no such target, E120's C3D). Until 2026-11-10 the lab read the
// queues' id words in the static queue-id table through the port, which on the E118 family read another queue's id
// for five of them and on ten other bodies for one to five (docs/model-survey.md findings 43 and 99)
const API_QUEUES_E143 = { XTC_APP_EXEC: 0x76, PLAY_EXEC: 0x3F, TFT_EXEC: 0x64, TAKE_EXEC: 0x5A, REC_EXEC_MAIN: 0x47,
  FILECLBK_UEXEC: 0x1F, ADJ_SLF_EXEC: 0x03, BC_EXEC: 0x09, UI_OUT_EXEC: 0x71, LENS_EXEC: 0x2E, ADJ_EXEC: 0x01,
  TAKE_FUNC: 0x5E, ZOOM_EXEC: 0x7D, FCS_EXEC: 0x1B, PWR_EXEC: 0x7C, AUD_EXEC: 0x08, LENS_COMMAND: 0x31,
  MOVE_MAIN: 0xAE, C3D: 0x98 };
export const MODULE_QUEUES = new Set([...Object.values(API_QUEUES_E143), 0xCF]);
// the same queues by their id words in the static queue-id table (0x600431c6, id n at +2(n - 1)), in MODULE_QUEUES'
// order: on E143 they hold the table's ids (module_queues checks it); on another body only the last, PC_PD_CMD_EXEC's,
// which no target names, is read where the port places it: the queue its name names on E146, E147, E144, E148, E139
// and E134; on E137 and E125, which hold no such name, REC_EXEC_PROGRESS (0xd6) and FMEMEXEC (0xdc); unplaced on the
// ten others, none of which holds the name (X, the object-name tables)
export const MODULE_QUEUE_WORDS = [A(0x600432B0), A(0x60043242), A(0x6004328C), A(0x60043278), A(0x60043252), A(0x60043202), A(0x600431CA), A(0x600431D6), A(0x600432A6), A(0x60043220), A(0x600431C6), A(0x60043280), A(0x600432BE), A(0x600431FA), A(0x600432BC), A(0x600431D4), A(0x60043226), A(0x60043320), A(0x600432F4), A(0x60043362)];
const apiQueues = () => fact('api.queues', API_QUEUES_E143);
// A body's API target table can name module queues E143's has no counterpart of (src/fw/models.mjs modack_queues:
// [queue id, its name in the object-name table]; E132's CATEGORY_MAIN and LOGGER_MAIN): S-MODACK answers them too
export function module_queues(image) {
  const word = (a) => image[a - IMAGE_BASE] | image[a - IMAGE_BASE + 1] << 8;
  const pc = MODULE_QUEUE_WORDS.at(-1), ids = [...Object.values(apiQueues()).filter((q) => q !== null), ...(isUnmapped(pc) ? [] : [word(pc)])];
  if (ON_LAB_MODEL && (ids.join() !== [...MODULE_QUEUES].join() || MODULE_QUEUE_WORDS.map(word).join() !== ids.join())) throw new Error('module_queues: E143 table is not MODULE_QUEUES');
  const more = (MODEL_INFO.modack_queues ?? []).map(([q]) => q);
  if (more.some((q) => ids.includes(q))) throw new Error(`module_queues: ${MODEL}'s modack_queues ${more.join(', ')} repeat a queue of E143's table (${ids.join(', ')})`);
  return new Set([...ids, ...more]);
}
const OLYQEWR = A(0x5002C151), API_SEND_RETURN = A(0x503EBA07);
// S-DISPSYNC: the request type that waits for an image sync; the release's sync-word store (its value; the panels'
// d1 values, as stopRecView passes them, and the image sync's kind, the one the type-3 request's pending state takes,
// are the fact's, displaySync's comment) and image-event flag (a0, as stopRecView passes it). On E120's record form
// (the fact's record) the request's type and device code and the release's code and device are fields of the record
// a0 points to, and the synced type is the record's
const DISPSYNC_REQUEST = 3, DISPSYNC_OFF = 0, DISPSYNC_IMAGE = 1, DISPSYNC_RECORD = 8;
const TRA_EXEC_CALLS = A(0x50AF7CB9), TRA_EXEC_CALL = A(0x50AF7CBE);
// camapp 3, the transaction path native (docs/hle-gaps.md 4.1.5): S-TRAACK hands every transaction to the exec, whose
// remote path sends through the receiver substance's vt[41] (0x50af8487) and, for the RSB requests (the mode change
// that brings 420), the remote-call method 0x50ac734c: both entries S-RPC answered (menu.mjs RPC_ENTRIES), so the
// components were never asked; they run natively there. TRAACK_KEPT: the transactions S-TRAACK still answers 0 at
// the exec in that mode (none: the menu's stop is not one transaction, 4.1.5). TRA_NATIVE_LOG: tra_native's length
const TRAACK_KEPT = new Set(), TRA_NATIVE_LOG = 400;
// The VSC histogram under camapp 3 (docs/hle-gaps.md 4.2.1, docs/om1-vsc-spec.md section 13): DISPLAY cmd 13 / 14
// start the VSC's histogram on the TFT channel (0x501e14a4: INTEN1 |= 0x100, HIST1 = 1, X); the VSC model ends the run
// (A-VSCHIST-1, src/dev/vsc.mjs) and the ISR's bit-8 branch (0x501dec7f..e4) posts the done callback 0x501d71e1 to
// task 16 (0x50053505), which clears the run word 0x62a3eaf8, posts DISPLAY cmd 16 {0, 0, 16, &slot} from
// HIST_DONE_SEND while the word 0x62a3eabe is set, and sets the flag whose id is at 0x6004303a (D). Cmd 16 reads the
// bins (0x501d70e6) and starts the next run (0x501d6bec), a run every 50 ms of lab time (X). S-DISPQ runs that cmd 16
// as it runs the display manager's requests (dispq_accept, play.mjs).
// S-HISTEND: DISPLAY cmd 15 (0x501d709f) clears 0x62a3eabe and, while a run is on (0x62a3eaf8 = 1), clears the flag
// and waits for it 50 ms (OlyEvWt at 0x501d70d1, returning to HIST_WAIT_RETURN; the flag's only waiter, D: its id word
// is read at 0x501d70b2, 0x501d70c5 and by the done callback only). The menu sends it inside a display run, where lab
// time stands still: the lab clock runs to the run's end, a frame at a time on the channel where the run is (at most
// two frames, A-VSCHIST-1), and the wait then runs natively: S-IRQFIRST takes the VSC's IRQ, the wait blocks, task 16
// runs the done callback, which sets the flag, and the wait returns E_OK (X). Where the run has already ended, its
// interrupt still to be taken or the done callback itself queued on task 16's ring (DEFER_SLOTS calls of
// DEFER_SLOT_BYTES from DEFER_RING, the function first; pending from the read index DEFER_READ to the write index
// DEFER_WRITE: the poster 0x50053505 and the drain 0x50053157, D; docs/om1-kernel-spec.md 9.6), the wait runs
// natively at once; with neither the lab refuses it (another deferred call on the ring sets no flag). Before the unit
// was modelled S-HISTWAIT ran the wait to its 50 ms timeout (E_TMOUT)
const HIST_WAIT_RETURN = A(0x501D70D8), OLY_EV_WAIT = A(0x5002BDD8), HIST_DONE_SEND = A(0x501D722E);
const HIST_DONE_CALLBACK = A(0x501D71E1), HIST_END_FRAMES = 2;
const DEFER_WRITE = A(0xA32C3E10), DEFER_READ = A(0xA32C3E12), DEFER_RING = A(0xA32C3E14);
const DEFER_SLOTS = 32, DEFER_SLOT_BYTES = 12;
const VSC_INTEN1 = 0x00C, VSC_INTST1 = 0x010, HIST_END_BIT = 0x100;
// The imgpro unit at 0x9c600000 under camapp 3 (docs/hle-gaps.md 4.3.1, docs/om1-imgpro-spec.md; the model
// src/dev/imgpro.mjs, S-IMGPRO). H-IMGPROINIT: the image library's init 0x5046d7ab, which USTART2's stage calls
// (0x501e91d8) and the lab does not run, in part: its IRQ attach 0x5048c3a0 (the library's 14 IRQs, each attached on
// CPUs 0..3 and disabled there; IRQ 300 with the unit's handler 0x5048bfe3 at level 4, which the go 0x5050a8ba enables
// on the calling core), its id bitmap's clear 0x5048ba3a and, of the units' init 0x50481211, only its call of the
// unit's own init 0x5050a6b2 (0x50481322); the rest of 0x50481211 (the units at 0x9c200000 and the others, which the
// lab does not model) and 0x5048d57f do not run. Without the attach the go's enable writes level 0 and the end is never
// taken: the request's wait runs out (1000 ms, 0x5049362a) and the kind's end runs anyway (X).
// S-STAGE9: the menu's image player (CapImg_ImagePlayer 0x50bad41b -> api_play 0x504067b9 -> the play buffer's
// 0x50a6c59b, command 0x300) waits for the image's stage 9 (0x50024de8(9), 2 ms sleeps until bit 8 of the stages' ready
// word is set; X: the OXF main thread slept there for good), which the boot's per-segment step 0x50024eda sets after
// the segment's read; module 9 has no static constructors (0x501e6102: count 0, D) and the lab's image holds every
// stage's code (as for S-BOOTSTAGE's stage 1 and H-AUDSTART's stage 6), so the bit is set at the start
const IMGPRO_IRQ_ATTACH = A(0x5048C3A0), IMGPRO_IDS_CLEAR = A(0x5048BA3A), IMGPRO_UNIT_INIT = A(0x5050A6B2);
const STAGE_PLAY = 9;
// S-TRAACK: the request's vtable slot the exec deletes a consumed request through (docs/hle-gaps.md 4.1.2, D)
const REQUEST_DELETE_SLOT = 1;
// S-OUTDEV (E143 with the HDMI port, docs/hle-gaps.md 4.9): the application's change of output device, TRA 588
// (OlyHfwOpeCamCom 0x50abcf49 builds it at 0x50abf14d: +32 the device, +36 the second device, +40 0); the active
// state's component takes it (CmpCst_Function 0x50ce992d..0x50ce9a0a, CmpSqp_SequencePartsBase 0x50c8fd69) and sends
// the IO-device capability event 224 (constructor 0x50bf2f4e: +28, +32, +36 the request's three words), which
// CapIod_IODevice (the singleton 0x50be92ca) takes in its state 6 (0x50beace2 -> 0x50beab11) and opens the device;
// its dispatchEvent is the reactive's vtable slot 33 (0x50bea64b)
const TRA_OUTPUT_DEVICE = 588, OUTPUT_HDMI = 8, IOD_INSTANCE = A(0x50BE92CA), IOD_EVENT_NEW = A(0x50BF2F4E);
const IOD_EVENT_BYTES = 40, IOD_STATE_READY = 6, RX_DISPATCH_SLOT = 33;
// the property setter CapIod writes the output-device property through (0x50ab4f75 -> 0x503c4b2f, d0 id, d1 value)
const OUTDEV_PROP_SET = A(0x503C4B2F);
const SHOOT_POST = A(0x50AF4451), SHOOT_REACTIVE_VT = A(0x60DFF400);
const HEAP = A(0x62424700), HEAP_END = A(0x6268D380);
// the callbacks' ids, by name in the build's CBS name table (src/fw/facts.mjs cbsIds): a build may number one
// otherwise (E142's END_SHOOTING_PICTURE is 369, E143's 211)
export const CBS = fact('cbs', CBS_E143);
// S-RELSEQ's shooting phase during a movie: the phases the shooting component's sequence enters (CmpSqp_SequencePartsBase,
// setter 0x50cc6121: 113 at 0x50c87a17 (MOV_READY, I), 114 MOV_READY_FINISH, 115 MOV_RECORDING, 117 MOV_END), which the
// phase query 0x50ab57e9 answers in place of 100 (no sequence controller in camapp 1). getMovieState is 1 at 113..115.
const PHASE_QUERY = A(0x50AB57E9);
// S-RELSEQ's release sequences run only while the application's shooting service runs: OlyHfwOpeShoot's
// startShootingService (its start, 0x50ae1124) and endShootingService (0x50ad7e8a; playback ends it), each at the load
// of its opening trace (bin/port.mjs places both by src/fw/facts.mjs shootingService).
const SHOOTING_START = A(0x50AE1124), SHOOTING_END = A(0x50AD7E8A);
const MOVIE_PHASE = { START_READY_MOVIE: 113, END_READY_MOVIE: 114, START_SHOOTING_MOVIE: 115, START_RECORDING_MOVIE: 115,
  STOP_SHOOTING_MOVIE: 117, END_RECORDING_MOVIE: null };
const RECVIEW_NS = 500e6, DEFAULT_SHUTTER_S = 1 / 125;
const CARD_STATE = [A(0x60360BFC), A(0x60360C08)], CARD_MOUNTED = 8, SHOTS_QUERY = A(0x50419164), MOVIE_TIME_QUERY = A(0x5042DA58);
export const CARD_SHOTS = 999, CARD_MOVIE_S = 3600;
// S-CARD's slot: the card driver's detect state of drive 0 (the first slot) is 2, inserted (src/fw/facts.mjs
// cardDetect: the file layer's drive status reports the card present for 2 and 3, the driver's insertion handler
// writes 2 where it finds 1)
const CARD_DETECT = fact('card.detect', CARD_DETECT_E143), CARD_INSERTED = 2;
// S-CARD's mount test: the drive status's mount bit, and the error bit set where it is clear (the DCF remain count's
// error test is the mask 63; which of its bits means what is not read)
const DRIVE_MOUNTED = 0x1000, DRIVE_ERROR = 0x1;
// S-CARD's images: the media API's image count (0x503feea4: slot, type; the application's getImageCount 0x503d2230 sums
// it over the types 1, 2, 3, 5, 9, 8, 14). Which kind of file each type counts is ? : the card's images are type 1.
const IMAGE_COUNT = A(0x503FEEA4), IMAGE_TYPE = 1, CARD_FOLDER = 100;
const DCF_COUNTS = fact('dcf.counts', DCF_COUNTS_E143);   // the first slot's counts
// S-PLAYSEQ: the play module's side of the HLS play requests. An asynchronous one (OlyHfwOpePlyComAsyncRsb::execute
// 0x50ad26fb: the request at +236 holds the id, the notify function 0x50ad2bc2 and the RSB) is finished by the module
// calling the notify with (a0 result word, a1 RSB, d0 the request's id, d1 2), which calls the RSB's callback (+228,
// this at +224): PlyCom's (0x50aceb5f) posts CBC_PLAY_COMMON / CBS_END for id 0 (startPlayService), the single-frame
// one's (0x50b7118d) CBC_PLAY_SINGLE_FRAME / CBS_FINISH_DRAW for id 8 (startSingleFrame); the GUI's callback handlers
// turn them into EVT_GUI_END_PLAY_SINGLE_READY (0x5123bd97) and EVT_GUI_END_PLAY_SINGLE_DISPLAY (0x5123bdd2). A
// synchronous request's id is set at 0x50ad4166 (OlyHfwOpePlyComSyncRsb): 1 is endPlayService (0x50acf764).
const RSB_EXECUTE = A(0x50AD26FB), RSB_REQUEST = 236, SYNC_REQUEST = A(0x50AD4166), NOTIFY_DONE = 2;
const PLAY_START = 0, PLAY_SINGLE_FRAME = 8, PLAY_MOVE = 9, SYNC_PLAY_END = 1, SYNC_GET_NUMBER = 5, SYNC_CAN_MOVE = 344;
const SYNC_RESPONSE = A(0x60360C88), SYNC_RESPONSE_GET = A(0x50AD46B4), RSB_RESULT = A(0x60360C64);
const MOVE_LEFT = 3, MOVE_RIGHT = 4, MOVE_RESULT = 1;
// The single move's state (u16; set to 1 by moveCurrent through the hook 0x50ce4c65 registered at 0x50ce46f6; the next
// move is refused while it is not 0): the play single component's start_single_move_current sets it to 0 when the move completes
// (0x50c299f6).
const MOVE_STATE = A(0x60362A7C);
// S-PLAYCOMP: OlyHfwOpePlyCom's calls into the current play component (Cmp_PlayComponentBase, found through the camera
// base's mode, 0x50d7570b), which the HLS components create when they run; without them the lookup reads a null
// pointer. The wrappers, by the component method each calls (names from the methods' logs).
const PLAY_COMPONENT = {
  cancel_transfer_image: A(0x50ACF156), get_img_type: A(0x50ACF174), isRecording: A(0x50ACF18E), getNumber: A(0x50ACF1A8),
  isProtect: A(0x50ACF1E0), getStillInfo: A(0x50ACF1FA), getEnlargeInfo: A(0x50ACF217), getActualMagnification: A(0x50ACF233),
  getSelectPicNumber: A(0x50ACF251), isMovementAllowed: A(0x50ACF2AF), isMovementAllowedForShare: A(0x50ACF2CB),
  getPlaySoundFormat: A(0x50ACF2E7), 'method 0x50c11859': A(0x50ACF303), getSelectPicNumberSpecifyMedia: A(0x50ACF31F),
  updateMaxPicNo: A(0x50ACF33C), 'method 0x50c176f3': A(0x50ACF356) };
// S-PLAYCOMP hooks every wrapper the build has (fact 'play.wrappers', src/fw/facts.mjs componentWrappers; E143's are
// the sixteen above, D): by its name where the port placed one of E143's there (bin/port.mjs, by the method each
// calls), else by its address. A name the port left unplaced is a wrapper the build lacks, so no wrapper is left to
// read the null pointer.
// getStillInfo's struct (offsets from the fields OlyHfwOpePlyCom's dump at 0x50acd02d prints, found by filling it with a
// pattern): the date at 8 (u16 year, then month, day, hour, minute and second bytes, D: the converter 0x50acc981), the
// picture size u16 x 2 at 16, rationals (u32 numerator, denominator) for the exposure time at 48, the f-number at 56
// and the bias at 72 (I: EXIF's); the focal length (in tenths of a mm, X) and the ISO where the build's converter
// reads them (fact play.still, src/fw/facts.mjs stillFields: E143's u32 +148 and u32 +100, the E118 family's u32
// +136 and u16 +90). The component's struct (S-PLAYCOMP) and the play module's answer (S-PLAYSEQ) go to the same
// converter (D), so both are written alike (still_record).
const STILL = { date: 8, size: 16, exp_time: 48, f_number: 56, exp_bias: 72 };
// S-PLAYSEQ's synchronous getStillInfo and getHistogram (PlyCom's request ids, from its name table: 0
// startPlayService, 1 endPlayService, 2 getImageType, 3 getStillInfo, ..., 5 getNumber; E143's getStillInfo sends 3
// with its mode word at 3, its getHistogram 7, the E118 family's always, D: docs/model-survey.md finding 57).
// getHistogram reads the response's flag byte at +4 and the bins (u32 each, up to 128 copied) from +8, and for the RGB
// display three more pairs at +1032 / +1036, +2060 / +2064, +3088 / +3092 (E143 0x50acdeb0..0x50acdf8e, D; the E118
// family's the same, finding 57)
const SYNC_STILL_INFO = 3, SYNC_HISTOGRAM = 7;
const HISTOGRAM = { flags: [4, 1032, 2060, 3088], bins: [8, 1036, 2064, 3092], bin_bytes: 1024 };
// S-CARD: the camera's clock read (CLOCK_READ: E143's 0x5005a59e, behind the wrapper 0x5012b7cd its 61 callers call)
// fills a0's record {u16 year, month, day, hour, minute, second, hundredths, u16 status at +8} (D): where the SCPU
// window's clock signature (0x5004e384, bits 7..2 of word 0) is 42, the window's clock words (seconds since 1970 and
// the subsecond count) converted by 0x5012bf86 and checked by 0x5012b9ab, else, or where that is no date, the build's
// default with the status 10501 (0x5012b91f: E143's 2022-01-01 00:00:00, D). The port's place is the read on every
// body: on the E118 family the RTC driver's get that api_sctime_GET_REAL_TIME calls (E122 0x50068dbc, behind
// 0x502ee369 -> 0x5016892e, D); X: each of the 19 answers its build's default with the status 10501 in a hermetic
// session, whose window clock counts from 1970 (01-01 of E118 and E120 2015, E122 and E125 2016, E129, E130 and E132
// 2017, E133 2018, E134 and E137 2019, E139 and E140 2020, E142 2021, E143 and E144 2022, E145 2023, E146 2024, E147
// and E148 2025)
const CLOCK_READ = A(0x5005A59E), CLOCK_RECORD = 10, CLOCK_STATUS = 8;
// S-LENS applies on a build with a lens mount, whose driver keeps the mounted lens's record (fact lens.mount,
// src/fw/facts.mjs lensMount); a body with a built-in lens (E145, E129, E132) has no such record to mount one through
export const LENS_MOUNT = fact('lens.mount', true);
const LENS_ATTACHED = A(0xA32D4B9A), LENS_VALID = A(0xA32D4B98), LENS_RECORD = A(0xA32CAA8C), LENS_READY = A(0xA32D4B94);
// S-LENS: the driver's static record and its current copies (0x502ac60b), commits and derived values; a build whose
// driver init points the record at a static buffer of its own has that buffer read (src/fw/facts.mjs lensStatic), the
// others keep E143's
const lensStatic = () => fact('lens_record.static', null) ?? A(0xA3193780);
const LENS_STATE = A(0xA32CA5F4), LENS_CHARACTER = A(0xA32CAA38), LENS_ZOOM_ENTRY = A(0xA32CAA7C);
const LENS_COMMIT_STATE = A(0x502AC838), LENS_COMMIT_CHARACTER = A(0x502ACB96);
// the record's zoom table, 16 bytes a step (src/fw/facts.mjs lensZoomTable: E143's 1164, the E144 family's 1156)
const lensZoomTable = () => fact('lens_record.zoom_table', LENS_ZOOM_TABLE_E143);
const LENS_DERIVE = [A(0x502A63C2), A(0x50129A3E), A(0x50129980), A(0x501299A2)], LENS_FOCAL_NOW = A(0x50129980);
const LENS_ID = [0x00, 0x00, 0x19, 0x10, 0x00, 0x00], LENS_NAME = '12-40mm F2.8 PRO';
const LENS_ZOOM = [12, 14, 17, 20, 25, 30, 35, 40], LENS_AP = [761, 2283];    // mm; APEX x 256 (F2.8, F22)
// S-EXPOSE: the AE result objects (one per metering mode), the setter, the plan and its output
const BV_OBJECTS = [0xC12A, 0xC0BA, 0xC0CA], PROP_SET = A(0x5004188B), EXPOSE_CALC = A(0x50597E82);
const AE_PLAN = A(0x62A919DC), PLAN = { tv: 6, sv: 10, av: 14 }, STATE_SHOOTING = 0x0108;
// S-DISPFRAME: CPU 3's task DISP_FRAME (id 0x300d, entry 0x5100d05a; the same image) run on the lab CPU. Its start: the
// frame colour table (0x51016eb1) and the data pointers of three settings objects (12417, 61473, 35185 = 0x3081, 0xf021,
// 0x8971 -> 0x62f4fe60/64/68; 0x500417b0 returns an object's data, and the draws read the values through the property
// read with them, 0x5100d469 and 0x5100da04: the still aspect among them; called frame bitmaps here before, D). The
// TFT channel's eight face-plane colours (+0xD00, 0x501e061a), which the channel setup converts from that table
// (0x501db1b4: 0x51016e3e, then Cr Cb Y as below) and which the lab's TFT bring-up set from a table not yet filled. Each
// post to CPU 3 (ring [3][0], function 0x5002587a, argument = the bits of DISP_FRAME's flag) runs one turn of its loop
// (0x5100d0a5..0x5100d150, ported in dispframe_turn) natively: 0x5100dfbc, then 0x5100d19e (erase) or 0x5100d1b8 (draw).
// A build that traces its face colour setter has it placed by src/fw/facts.mjs faceColourSet (bin/port.mjs).
const DF_COLOUR_INIT = A(0x51016EB1), DF_COLOUR = A(0x51016E3E), PROP_DATA = A(0x500417B0), FACE_COLOUR_SET = A(0x501E061A);
const DF_SETTINGS = [[12417, A(0x62F4FE60)], [61473, A(0x62F4FE64)], [35185, A(0x62F4FE68)]];
const DF_STATE = A(0x5100DFBC), DF_ERASE = A(0x5100D19E), DF_DRAW = A(0x5100D1B8), DF_FLUSH_RETURN = A(0x5100D2A7), K_CFLUSH = A(0x5004E68A);
const DF_MODE = A(0xA3209010), DF_MASK = A(0xA3209012), DF_PENDING = A(0x62F4FE57), TFT_CHANNEL = 2, EVF_CHANNEL = 1, FACE_COLOURS = 8;
const TFT_FRAME_STATE = A(0xA32DDAF6), DF_FUNCTIONS = [DF_COLOUR_INIT, DF_COLOUR, FACE_COLOUR_SET, DF_STATE, DF_ERASE, DF_DRAW];
// DISP_FRAME's wait for the frame plane's buffer swap (0x5100d398..: while the channel's shown address is one of its two
// buffers, OlyTaSS(1) and read again, 0x501c4291) sleeps on the display clock (A10, as the display task's sleeps do):
// natively the lab task would sleep with no timer to wake it.
const DF_SWAP_SLEEPS = new Set([A(0x5100D3C5), A(0x5100D424)]), OLYTASS = A(0x5002C6E5);   // 0xa32ddaf4 + 2: 0 when the TFT display setup's configuration word is 0xFACE
// S-TAKEFRAME / S-AFOSD: the CPU 1 side of the frame plane, the shared-memory API DISP_FRAME reads: the frame display
// mode (0x500256d9, the TAKE module's 0x5039f583 at live view) and the AF module's OSD upload (0x500257ce: indicator, frame
// count, frames of cx, cy, w, h; upload_af_info 0x508c8554).
// FRAME_MODE_SUBJECT: the subject (face) frames' bit, TAKE's request 1 (0x5039f583; docs/om1-subject-spec.md 5.1).
const FRAME_MODE_SET = A(0x500256D9), AF_UPLOAD = A(0x500257CE), FRAME_MODE_AF = 4, FRAME_MODE_SUBJECT = 1, AF_FRAME = [400, 300, 60, 60];
const INDICATOR_FOCUS = 1, INDICATOR_NO_FOCUS = 9;
// S-AFLOCK, the AF beep's inputs (D unless tagged; the comment the stand-in's description refers to). The GUI's
// SubAppMDLFocus::changedFocus 0x5105260c (event 0x03000030, after END_FOCUS) plays it through playAfSound 0x51052444
// only when the application's getCondition (OlyHfwOpeShoot 0x50ad8b37) answers isFocus 1 and indicator 1 and no rec
// view (0x5105268b..0x51052707), and the sound control's playTarget 0x50b758b4 refuses sound 0 ("NOT READY",
// 0x50b75962) unless the shared take status's word 0 has one of the bits 2, 4, 8 or 0x1000000 (0x50b758fa..0x50b7592f).
// In the lab nothing writes them: the sequence parts and the take capability run only with the HLS components, the AF
// module's init does not run (X: isFocus 0, indicator 0, word 0 0 at S1).
// - The take status TraShareTakeStatus: its words 0x62af6d00 + 4 i (getter 0x50ab5716(i)) are set by 0x50ab61ee(bits
//   | i << 28) and cleared by 0x50ab52ad(bits | i << 28), both under the status lock (0x50ab2948(5)). Word 0 holds
//   the still sequence's states: CmpSqp_SequencePartsBase's state entries OR their state's bit, after STANDBY's
//   entry clears the four words and sets 1 (0x50c89d3a, from the entry that logs "entrySTANDBY_ErrorEvent",
//   0x50c89da1). The entries that log their state's name set READY_TRIG2 8 (0x50c88ae5, "entryREADY_TRIG2"),
//   END_WAIT 0x400, MOV_END 0x8000, MOV_READY_FINISH 0x1000, MOV_RECORDING 0x2000 and MOV_SELFTIMER_WAIT 0x4000;
//   they lie in their names' alphabetical order. The entries that set 2 (0x50c87e53 and its 0x50c88554: 0x50c88056,
//   0x50c88569) and 4 (0x50c886e7 and its 0x50c88aa4: 0x50c88915, 0x50c88abb) are READY's and READY_FINISH's: the
//   subclass CmpSqp_SequencePartsZeroLag's entry that logs "[%s][%d] entryREADY " (0x50cd9243) calls 0x50c87e53
//   (0x50cd926e), the one that logs "[%s][%d] entryREADY_FINISH " (0x50cd927e) calls 0x50c886e7 (0x50cd92e4), and its
//   STANDBY entry calls 0x50c89da1 (0x50cd922b). playTarget's four bits are then READY, READY_FINISH, READY_TRIG2 and
//   0x1000000 (0x50c89b96, one of the entries between READY_TRIG2's and STANDBY's; which state is ?: by the order
//   SECOND_WAIT or SELFTIMER_WAIT, but the subclass's SECOND_WAIT entry 0x50cda9b0 sets 0x200 itself, 0x50cda9eb).
//   playTarget's test also reads word 1: with a word-0 bit set, either bit 0x4 or bit 0x10000000 of word 1 still gives
//   NOT READY (0x50b75939..0x50b75948); the lab's word 1 stays 0. READY_FINISH is the state of the AF lock (I: READY is
//   entered on S1, "guardTrig1KeyIn_STANDBY_To_READY", and the AE/AF completion leaves it). S1 down sets READY's bit
//   and END_FOCUS(OK) READY_FINISH's through the setter; S1 up clears the two through the clear (on the camera the
//   sequence's return to STANDBY clears the words and sets STANDBY's 1, which the lab's words, never STANDBY's, do not
//   get)
// - isFocus: CapTre_TakeReady::notifyAFOK 0x50bc9551 (CapTak_Take) stores 1 at +280 of the take information
//   (0x50bc95f4), the word 0x62af6e28 that getCondition copies (0x50ab5576, 0x50ab55c0); written 1 at END_FOCUS(OK),
//   0 at S1 up (the take information's reset 0x50ab5243 writes 0 there, 0x50ab5280; when the sequence resets it is ?)
// - the indicator: getCondition's api_rec 0x50413486 calls the AF module's state getter 0x509b06f6 (through
//   0x503c436c) for a record {u16 indicator, u16, u16} and takes the indicator when it is 1 or 2 (0x504134d7..e4);
//   with the module's state flag (0xa33d955c) 0, the lab's, the getter writes zeros (0x509b06f6..0x509b0711). While
//   the AF lock holds, S-AFLOCK answers the getter with {1, 0, 0}: in focus, S-AFOSD's indicator (that the getter's
//   record and the OSD upload's share the code 1 is I); otherwise it runs natively
// The take status's and the getter's addresses are E143's (not ported): S-AFLOCK runs on E143 only, and only while
// UI_OUT runs, so the beep's request has a reader (H-UIOUTSTART)
const TAKE_STATUS_SET = A(0x50AB61EE), TAKE_STATUS_CLEAR = A(0x50AB52AD), TAKE_STATUS_GET = A(0x50AB5716);
const TAKE_IS_FOCUS = A(0x62AF6E28), AF_STATE_GET = A(0x509B06F6);
const SEQ_READY = 0x2, SEQ_READY_FINISH = 0x4, AF_INDICATOR_FOCUS = 1;
// - the AF lock's callback: CBS_AF_LOCK is 155 in the CBS name table (0x60dcfb68, src/fw/facts.mjs cbsIds); the
//   shooting reactive posts it through its post 0x50af4451 from its "haL" case with 1 or 0 by its event's field
//   (0x50af4b73..0x50af4ba6), and the application's callback switch (0x5108226d, case 0x510824af) turns 1 into the GUI
//   event 0x0300002c and anything else into 0x0300002d. 0x0300002c's rows include changedFocus's sibling 0x51052713
//   (which plays through playAfSound too); 0x0300002d's include clearAfSound 0x5105241b and 0x5105254f, which calls it
//   (the event rows {event, 1, 1, handler} at 0x512c955c and on). clearAfSound clears the GUI's afSound flag
//   (0x62b2e0c4) when 0x51069d6d answers 0 (0x5105241e..0x51052429), and playAfSound plays only while that flag is 0.
//   That the camera's sequence posts CBS_AF_LOCK(1) at the AF lock and CBS_AF_LOCK(0) at its release, so that each half
//   press in focus beeps once, is I (by the names; the reactive's event and its field are not traced to the AF module).
//   S-AFLOCK posts them so (X: with them the second half press beeps, without them it does not, afBeepSession)
const CBS_AF_LOCK = 155;
// S-SETSAVE: the settings store's save to flash (0x500421cd: when the store is dirty, 0x5003f5dd copies it to the next
// flash slot, K-CFLUSH, then programs the flash controller 0x98d01800, which the lab does not have). The application
// calls it when the menu closes (0x503f019d).
// S-OUTDISP: the application's choice of output, getOutputDisplay (0x5104fd44: d0 = 2 TFT, 3 EVF, 5 EVF, 6 INTERNAL_EVF,
// ...), which its output switch (0x5104fb9b) compares with the current output and sends to the GUI as request 131.
const OUTPUT_DISPLAY = A(0x5104FD44), OUTPUT_INTERNAL_EVF = 6;
// S-THROUGH: OlyHfwOpeShoot::ctrlAutoThrough(ctrl), 0 as the menu opens, 1 as it closes (bin/port.mjs places it by
// src/fw/facts.mjs shootingService, the function that loads its trace)
const AUTO_THROUGH = A(0x50ABD373);
const SET_SAVE = A(0x500421CD), SET_SAVE_RETURNS = new Set([A(0x503F01A4)]);
// the function direct start past its checks, where the function's id is kept at (28,sp) (E143, the entry's second
// instruction; another build keeps it there or in a register, fact 'func_direct.id', src/fw/facts.mjs funcDirect,
// which bin/port.mjs also places the start by)
const FUNC_DIRECT_RUN = A(0x51068E37), FUNC_RECORDING_MOVIE = 27;
// The page's texts for the four stand-ins (playui.mjs STAND_INS is a recorded document and stays as it was).
export const CAMAPP_STAND_INS = {
  "H-GUIBYAPP": "the lab's bring-up does not create the GUI (the creator 0x5108bc37): the application's start does, from CA_MAIN's code (0x510609ce), as on the camera; the lab takes the GUI's task and OSD records after it. Created twice, the lab's idle GUI kept a root of output 0 and one of the two buffers of OSD layer 1 (the registry 0x62b26528), so the shown root's double buffer had layer 1 on one side only: on the EVF the bottom bar and most of the information were missing in every other frame (docs/om1-shutter-spec.md section 7 item 59)",
"S-CAMAPP": "the camera application runs natively in every session: the boot chain's HighLevel steps (0x50ab222a, 0x50ab22bc), the event broker init 0x502a48b6 and act_tsk(58) at bring-up; its task entries are allowed, its nine module-9 readers join S-TAKEOVER's, its output-device read (0x50b76dbe) joins S-PROP; the application maps keys and moves the GUI itself (docs/om1-shutter-spec.md section 7); control camapp 2 starts a session with the HLS components running too; control camapp 3 runs them with the transaction path native, the OXF main thread started before HL_INIT",
  "S-MODACK": "the module tasks do not run: every request the application's API sender posts to a module queue (OlyQeWr returning to 0x503eba07; E143's target table's module queues, on another body its own table's entries at the same targets, src/fw/facts.mjs apiTargets, and those a body's src/fw/models.mjs modack_queues adds: E132's CATEGORY_MAIN and LOGGER_MAIN) is answered after the step with [status 0, token, word 3] to the reply queue in its word 0, the layout of DISPLAY's replies (0x501c48bf); every synchronous send (0x5002e39d) the lab otherwise refuses returns E_OK. Nothing a module would write back is written (I). The request's message is taken as the module's task would take it: OlyQeWr returns E_OK and the message is not left in the kernel's queue, which no task reads (until 2026-11-10 it was left there, and a module queue filled: PLAY_EXEC holds two messages, so under control camapp 3 the third play request blocked the OXF main thread for good, X; docs/hle-gaps.md 4.3.2). The queues of the modules that run natively are left to them: the file module's FILECLBK with the card's file system, and with --audio on AUD_MAIN's AUD_EXEC (0x08; H-AUDSTART), synchronous sends included; with the native lens (H-LENSINIT) the requests to LENS_EXEC (0x2e) and LENS_COMMAND (0x31), whose tasks wait on them (X; until 2026-11-10 S-MODACK answered these too, and the tasks took the messages; the golden sessions post none, X), a synchronous send to them still returning E_OK",
  "S-DISPSYNC": "the release of the GUI's synced display updates: while the application's sync word for a panel is set (CameraCommon::setDispSync, which E137's GUI asks for at the start), the GUI's update is a request of type 3, which leaves its buffers pending until an image sync; their one sender, the shooting sequence's stopRecView, does not run in an idle session, so E137's screen stayed blank (X). After each step the lab releases each device with such a request: both panels' sync words cleared through the application's setter, as stopRecView does, then the image sync of kind 1, whose event the display manager takes in the state the type-3 request leaves, and the pending buffers are committed (D). stopRecView's kind 2 is not taken there: under it E137's screen came only at its GUI's next update, a 250 ms redraw of a blinking item, and E125's GUI, which sends none, kept a one-colour frame (X). The camera releases it with the image's next update (on the E118 family, D: DevDpc_DispCtrlBase's imageUpdate() clears a panel's sync word after its image update once api_disp_Disp_Get_Wait_State answers 0, as setThroughPermit() and the still shooting component's rcvShtDrawThrough() do); the lab runs no image update and releases at the step's end (I: the camera's first one comes with its through image's start)",
  "S-RVSTANDBY": "the rec view component in standby: the shooting components' RecView does not run; its entryStandby would store state 1 in the application's state word (fact recview), which starts at 0, and getRecViewState takes 0 for a rec view, so E142's GUI showed the rec view's items at the start (EVT_REC_DISP_RECVIEW, 0xf005) instead of the shooting screen (X). The lab stores 1 before the application starts; that the camera's component is in standby then is I",
  "S-TRAACK": "the HLS transaction layer's synchronous exec (0x50af7cb9 / 0x50af7cbe) returns 0: no local handler is ever registered (on the camera either), so every transaction goes to the active state's components, where the shooting component CmpSht_ShootingComponent_NEW answers TRA 990 and 991; it runs only with the HLS components, and the remote channel answers 0xf0000001 (startShootingService fails on TRA 990 without it, X). With the file system native and its HLS side (card_fs.hls: E143, E146) the media control's start (TRA 1511; E146's 1509) also goes to S-MDACTRL (media.mjs). Under control camapp 3 it answers none (its list TRAACK_KEPT is empty): every transaction goes to the exec natively and, S-RPC lifted from the receiver's send and the remote-call method, to the components, which answer the start's 990 and the rest natively (X; docs/hle-gaps.md 4.1.5)",
  "S-CARD": "a card in the SD slot. With the file system native (a body that runs it, src/fw/models.mjs card_fs; storage.mjs) the card is S-SDCARD's, which the firmware formats and mounts itself at the insertion, and S-CARD keeps only the HLS media mount state (0x60360bfc, 0x60360c08) at 8, as the HLS media layer would set it on the file layer's mount, and its record of each picture taken (S-RELSEQ's END_SHOOTING_PICTURE: its release, S-SCENE's scene, the clock and the lens at the capture), whose file S-RECFILE writes (on E143, E146 and E147 REC_FILE natively, from the packet of REC_IMAGE's own task: rec.mjs). Where REC's recorder records the file (S-RECFILE's DCF steps) the firmware's own DCF database counts it in the same session: the media API's image count (0x503feea4) and each picture's folder and number in playback are the database's (its fnode by index), S-CARD's image list retired; elsewhere the pictures are S-CARD's list, of folder 100 numbered from 1, the image count answering their number for type 1, and the database learns of each file at the next mount. The firmware answers the remaining shots and the movie time from the card. While the card is out of the slot (media.mjs S-MEDIA) the image count is 0; a format from the menu (S-MDACTRL) clears the records. On the other bodies the card has no file system: the card driver's detect state of the first slot is 2, inserted (src/fw/facts.mjs cardDetect), set before the application starts; the remaining-shots module query 0x50419164 answers 999 less the images; the movie time query 0x5042da58 answers a time left of 1:00:00 less the time recorded so far, and the current recording's time; a DCF remain count that tests only the drive status's error bits (MODEL_INFO.dcf_mount_test) is given the mount test E143's count makes, so it returns as not mounted. An image is its number, its exposure and S-SCENE's scene at the capture",
  "S-PLAYSEQ": "the play module's notifications: each asynchronous HLS play request (OlyHfwOpePlyComAsyncRsb::execute 0x50ad26fb) is finished after the step by its notify function (0x50ad2bc2) with the request's id and kind 2, as the module would: startPlayService (0) makes PlyCom's callback post CBS_END and the GUI leave ID_ST_PREPARE, startSingleFrame (8) and moveCurrent (9) make the single-frame callback post CBS_FINISH_DRAW and the GUI show the image. While a request's transaction runs (S-TRAACK) the module's answer is written: canMoveCurrent (sync 344) can move whenever there are two images or more (they wrap around), moveCurrent's result is 1 and the image shown moves (direction 3 left, 4 right). Where PlyCom asks the play module rather than a component (the E118 family always), getNumber (sync 5) is answered with the image's index, file number and folder, getStillInfo (sync 3) with the picture's own record: the date the camera's clock gave at the capture (the family's default while its clock is not set: 2016-01-01 00:00 on E122, 2015-01-01 on E118 and E120), its file's JPEG size, the release's exposure and the lens's focal length at the capture; getHistogram (sync 7) is answered empty (the lab decodes no picture). That every request finishes at once, with result 0 and no other data, is an inference from the callbacks (I). An erase (PlyCom::erase, async 301) would be finished the same way with no file deleted: erase is not modelled and no session sends one (docs/model-survey.md finding 94)",
  "S-PLAYCOMP": "the play component's answers (Cmp_PlayComponentBase, which only the HLS components create; OlyHfwOpePlyCom's wrappers 0x50acf156..0x50acf356 are answered in its place) for the image S-PLAYSEQ shows, the newest: getNumber its index, file number and folder 100, getStillInfo the picture's own record as S-PLAYSEQ's answer holds it (the date the camera's clock gave at the capture, its JPEG's size, its exposure time, f-number, bias and ISO from S-SCENE at the capture, 1/125 s alone without it, and the lens's focal length at the capture), the type 0, not protected, no recording; a move's completion clears the single-move state (0x60362a7c), as the component's start_single_move_current does. The other wrappers answer 0, each logged (I)",
  "S-PLAYVIEW": "(with S-SCENE's live view) while the GUI shows a card image, from startSingleFrame's finish to endPlayService (sync request 1), the live-view plane holds the frame S-SCENE renders again from the scene kept with the image (black for an image taken without it): the camera would decode the file onto its image plane, which the lab does not have (I: same plane, same scaling as S-RECVIEW)",
  "S-DISPFRAME": "CPU 3's task DISP_FRAME on the lab CPU: its start (the frame colour table 0x51016eb1, the data pointers of the three settings objects its draws read), the TFT and EVF channels' eight face-plane colours converted from that table as the channel setup does (0x501db1b4), the TFT frame-state byte 0xa32ddaf6 at 0 (the value of a display setup with the configuration word 0xFACE, I), and one turn of its loop, natively, for each post to its flag (ring [3][0], function 0x5002587a); its 1 ms sleeps while it waits for the frame plane's buffer swap (0x5100d398..) run on the display clock (A10), so the VSC latches the new address at a frame boundary. It draws the AF frames, the focus indicator and S-SUBJECT's subject frames into its 8-bit plane (VSC IMG3, format 2); the composite shows the plane under the A19 opt-in",
  "S-RECVIEW": "(with S-SCENE's live view) from START_RECVIEW to END_RECVIEW the live-view plane holds the frame S-SCENE rendered at the capture (S2 down, the exposure in use) instead of the live scene; the camera would show the developed image through its playback path, which the lab does not run (I)",
  "S-TAKEFRAME": "the frame display mode the TAKE module sets for the live view (0x5039f583 -> 0x500256d9): 4, the AF frames and the indicator (the mask TAKE requests in S-AF is I); on E143, where MDET_DL runs natively, with 1 added (TAKE's request 1, the subject frames DISP_FRAME draws from MDET's frame table) while S-TAKEMDET has subject detection started and the live scene is shown, and taken away otherwise (I: TAKE's live-view request sets that bit unless one of its conditions clears it, which are not read in a running camera, docs/om1-subject-spec.md 5.1 and U10)",
  "S-AFOSD": "the AF module's OSD upload (upload_af_info 0x508c8554 -> 0x500257ce) at S-RELSEQ's END_FOCUS: in focus, indicator 1 and one frame at the AF target (centre 400, 300, 60 x 60 in DISP_FRAME's coordinates, I); not in focus, indicator 9 and no frame (I); at the S1 release, none. A build whose frame plane has no AF upload (E145, the TG-7: modes 1 and 2 only, src/fw/facts.mjs framePlane) is given none: no code of its image stores the plane's mode-3 frames (X, a byte scan), so the camera's AF draws none there either (I)",
  "S-AFLOCK": "(E143, while UI_OUT runs: H-UIOUTSTART) the AF lock as the shooting sequence, the take capability and the AF module would hold it, fed from S-RELSEQ's focus callbacks: S1 down sets the still sequence's READY bit (2) of the shared take status's word 0 and END_FOCUS(OK) its READY_FINISH bit (4), both through the status's own setter 0x50ab61ee (which bit is which state: D, the sequence parts' READY and READY_FINISH entries call the setters of 2 and 4), and the take information's isFocus (0x62af6e28) as CapTre_TakeReady::notifyAFOK stores it; while the lock holds the AF module's state getter 0x509b06f6 answers indicator 1, S-AFOSD's in-focus code (natively it answers 0: the module is not initialised in the lab); S1 up clears the two bits through the status's clear 0x50ab52ad and isFocus. The application's getCondition then sees the lock, and its changedFocus plays the AF beep natively through playAfSound, the sound control's playTarget and api_sound to UI_OUT's sound request (X: sound 0, volume 60, the settings id 18 the Setup item 1037 sets too; with the audio hardware it sounds, S-SOUNDRES's lab-made beep). The GUI plays it once per lock until its own afSound flag is cleared again: S-AFLOCK posts the AF lock's callback CBS_AF_LOCK (155) through S-RELSEQ's post, 1 after END_FOCUS(OK) and 0 at S1 up, and the application turns 0 into GUI event 0x0300002d, whose handlers clear the flag (D), so each half press in focus beeps once (X); that the camera's sequence posts it so is I (the shooting reactive's AF lock case posts CBS_AF_LOCK with 1 or 0, D; when the AF module raises it is not traced). Not installed under control camapp 2 (the HLS components run there)",
  "S-SUBJECT": "(on a body where MDET_DL does not run natively: none today, E143 runs it, S-MDETDL; with S-SCENE's live view, while the camera's subject-detection setting names a kind) the subject detection CPU 3's MDET would run: S-SCENE's subjects of that kind (the rider stands for motorsports) written into MDET's frame table as list records (four corners each, through DISP_FRAME's own transform taken back, so they land on the subject as the panel shows it), the getter's aspect pair and active byte set, the frame mode's subject bit added (I) and UP_FACE posted (0x50025747); DISP_FRAME reads the table through FACE's and MDET's getters and draws the frames natively (subject.mjs; docs/om1-subject-spec.md 5.1, 5.5)",
  "S-TAKEMDET": "(E143, with S-SCENE's live view, while the camera's subject-detection setting names a kind) the requests TAKE and take_mov would make to MDET, which do not run in the lab: before the first, TAKE's registration of its LAF status-change callback (0x506d98ed through mdet_laf_dl_set_status_change_callback 0x506e68b4, as TAKE's start does at 0x506d8109), then mdet_dl_start(kind), mdet_dl_change_mode(kind) at a change of kind and mdet_dl_end at OFF, and one mdet_dl_offer_yc_data per S-SCENE frame step with the record {frame number, buffer id, 640 x 480, still, no digital zoom, DISP_FRAME's aspect code}, each natively from the lab task (LAF maps the offer's aspect code to the frame getter's aspect pair natively); the buffer id names a 640 x 480 YC buffer the stand-in takes from S-HEAP (not written: nothing reads its pixels), whose lock, address and release the YC buffer manager is answered for. TAKE's callback, when LAF's tracking status changes, posts TAKE its message 81, which stays in TAKE's queue: TAKE does not run. Its handler would hand take_mov the LAF mode bit of MDET's tracking (0x10, from TAKE's tracking sources), whose rise starts LAF's PDT / TRC side through TAKE_MOV's start and makes take_mov ask LAF for a chase cycle after its EMS1 run on every live-view frame; those frames come from the image pipeline's live-view sequencer, which does not run, and LAF started without them stops writing MDET's frame table (X), so the message is not served in a session (test_mdet.mjs serves it: the start and the end run natively). The LAF parameters and the chase requests are not made (mdet.mjs; docs/om1-subject-spec.md 5.3, 5.7, 5.8, 5.9)",
  "H-TAKEINIT": "(--take probe, E143) TAKE_FUNC's module init (0x502ccff8, USTART's call at 0x50024c2d) natively before the application starts, after USTART2's stage word 0xa32d6d58 is set to 1 as USTART2 sets it (0x5012abef; TAKE_FUNC_CP's start polls it), then TAKE_FUNC (task 105) and TAKE_FUNC_CP (task 106) started with act_tsk as USTART starts them after the init; the application's requests to TAKE_FUNC's queue (0x5e) then go to it natively, the synchronous ones included, and leave S-MODACK (src/lab/take.mjs; docs/hle-gaps.md 4.1.4)",
  "S-TAKEREQ": "(--take probe, E143) the recording stand-in for every queue TAKE_FUNC and TAKE_FUNC_CP post to whose reader the lab does not run (BC_EXEC and CPU 2's MOV_COMMAND, SDET_EXEC, WB_MOV; TAKE_EXPOSE's and TAKE_POWER_MANAGER's queues go natively, H-TAKENBINIT, STB_EXTERNAL's, H-STBINIT, and TAKE_FOCUS's, H-TAKEFOCUS): each request is recorded (queue, command, parameter, token, synchronous or not, the sender) and dropped, and answered only where TAKE waits: a synchronous request returns the status 0 (TAKE_FUNC's own 0x502ce86d returns the reply's u16 status, 0x502ce8ba); a request whose reply queue is TAKE_FUNC_CP_POST (0x61) gets {status 0, its token, 0} there after the step, which TAKE_FUNC_CP's start sequence clears from its pending bits (0x502cdad7..0x502cdae3); BC_EXEC's request is followed by TAKE's own completion callback in its parameter (0x502cdc0b, which posts token 0x80 to 0x61; that BC calls it is I); a request with no reply queue is not answered. Posts to TAKE's own queues, to LENS_EXEC (the native lens) and TAKE's replies to its requesters go natively and are recorded. Any other queue throws (src/lab/take.mjs; docs/hle-gaps.md 4.1.4)",
  "S-TAKECAM": "(--take probe, E143) the camera driver's request switch (cam.c, 0x502a4a46) from TAKE's tasks. Without its init the request pool 0x6299726c was not built (the allocator handed request 148's handler address 0, which it takes as a failed allocation, logging 0x0a103000, X); with the first init natively (H-CAMINIT) requests 148 and 144 are accepted and queued as items of the driver's sequence engine, which nothing completes in the lab, and request 6 logs 0x0a273000 (X; I: the driver's front end would complete them after its second init, which touches devices the lab does not model). TAKE_FUNC_CP's start makes requests 148 and 6 and waits on flag TAKE_CAM_EVENT bit 1 for each (and, under camapp 3 with H-TAKEFOCUS, TAKE_MAIN's RdyFcsRdy1 request 144, 0x503c2e21, docs/hle-gaps.md 4.1.8); the stand-in records each, returns 0 and after the step calls the request's completion callback (+72, TAKE's 0x502cd4d0) natively with the status 0 and the request, as the driver calls it (0x502a4b92..0x502a4b96). Nothing the driver would do to the sensor is done (src/lab/take.mjs; docs/hle-gaps.md 4.1.4)",
  "H-TAKENBINIT": "(--take probe, E143) TAKE's neighbour tasks TAKE_EXPOSE (task 103) and TAKE_POWER_MANAGER (task 131) natively, started after H-TAKEINIT as USTART2's stage 0x501e8e84 starts them: TAKE_EXPOSE's module init 0x50591220 (its call at 0x501e90bd) natively, then act_tsk of both (0x501e90d8, 0x501e936b); TAKE_POWER_MANAGER's init (0x502ce4d4) is TAKE_FUNC's init's second call, which H-TAKEINIT runs. Their queues (TAKE_EXPOSE 0x5b, TAKE_POWER_MANAGER_EXEC 0xd7, TAKE_POWER_MANAGER_POST 0xd8) leave S-TAKEREQ: TAKE_FUNC's synchronous request to TAKE_EXPOSE (0x502ce86d) runs natively and TAKE_EXPOSE replies on TAKE_FUNC_IMDFUNC itself; what they post to a queue the probe does not know throws. TAKE_EXPOSE's AE result writer 0x50596187 is observed: it does not run in the lab's scenarios, so S-EXPOSE is unchanged (src/lab/take.mjs; docs/hle-gaps.md 4.1.6)",
  "S-TAKEUSF": "(--take probe, E143) the dust filter's gate-on API (0x50064a69, 'USF GATE CONTROL') from TAKE's tasks: TAKE_FUNC_CP's start asks it with its record {callback 0x502cdc97, 0} and waits on flag TAKE_FUNC_CP bit 1, which that callback's deferred count sets; the API drives the filter through the timer block at 0x9b880000, which the lab does not model. The stand-in records the call and after the step calls the record's callback natively with the status 0 and the record, as the filter's completion does (0x50064d40..0x50064d5b). The filter does not run (src/lab/take.mjs; docs/hle-gaps.md 4.1.4)",
  "H-STBINIT": "(--take probe, E143) the strobe's tasks natively, after H-TAKEMAIN: STB_HANDLER_PROC (task 139, entry 0x501bb24a) and STB_EXTERNAL (task 101, 0x501b7465) started with act_tsk as USTART2's stage 0x501e8e84 starts them (0x501e8fbd, 0x501e8ff3; STB_CHARGE, which it starts between them, stays dormant: nothing on TAKE's requests asks it, X). STB_EXTERNAL's queue 0x57 leaves S-TAKEREQ: it answers TAKE_FUNC_CP's start's commands 1 and 4 (tokens 4 and 8) itself, over the hot shoe's channel (S-HOTSHOE), and its replies are recorded. A request it takes with a reply queue makes the step run lab time in 10 ms slices until it has replied, at most 1 s (more stops the session), as its requester's wait lets the camera's time run: with nothing on the shoe its own timers make the reply 1 + 64 + 20 ms after command 1 (D; X: 85.4 ms). STB_HANDLER_PROC runs the functions the strobe's timer handlers queue, among them the end of a channel-11 transfer (src/lab/take.mjs; docs/hle-gaps.md 4.12.1)",
  "S-HOTSHOE": "(--take probe, E143) the hot shoe's serial channel with nothing on the shoe (src/lab/shoe.mjs): PER_SIO channel 11, controller index 6 (registers 0x98580000..0x985800a0, allowed in the lab stub, which keeps what is written), mode 0 at 20833 per second, served at mode 0's transfer and receive starts (0x5005dc2c, 0x5005df40) for that index. PER_SIO's channel map is set first by its own setter (H-SIOMAP, as on the TG-5s) if nothing set it; PER_SIO's channel API, its configuration and close, the completions and the strobe's code run natively. A transfer's bytes go nowhere and it ends at the MN's next idle point (A-HOTSHOE-1) in interrupt context through the index's transmit completion, as mode 0's transmit handler ends it (0x5005ea80..0x5005ea99); a receive is kept, nothing arrives (A-HOTSHOE-2), and the index's close drops it. A polled transfer, an index of kind 1 and a second receive while one is kept stop the session. On the camera the index's interrupts (IRQs 205, 206, 207) are attached by the driver's init 0x5005d5c7, which the lab does not run, on CPU 0 (the board configuration's byte for index 6, D), the strobe's CPU, where the lab ends the transfer too. What an attached flash would answer is not modelled",
  "A-HOTSHOE-1": "(--take probe, E143) a transfer on the hot shoe's channel takes no line time: it ends at the MN's next idle point (at 20833 per second a byte with a start and a stop bit takes 0.48 ms, I); every wait the strobe makes after a transfer is longer (1, 6, 20, 50 ms, D), so the order of events is the same",
  "A-HOTSHOE-2": "(--take probe, E143) nothing is on the hot shoe and nothing reaches channel 11's receiver: a receive never ends and its first-byte event never fires. What the camera's receive line presents with an empty shoe (its pull, a break) is ?; the firmware itself reads 20 ms with no first byte after its ID exchange [0x55, 0x82] as no flash (D) and polls the shoe again about every 250 ms (D, X)",
  "S-MDETDL": "CPU 3's MDET tasks natively on the lab CPU: MDET_DL_REQ and MDET_DL_LDL (the MDET poster's return path serves ring [3][0] at once, S-CPU3: MDET's function in interrupt context), and MDET_E_SEND_CPU3 and MDET_CALC_MAIN_CPU3 when S-CPU3 serves one of LAF's event setters (the eleven 0x508017b4 names, which set MDET_E_SEND's flag 0x3007; it forwards each event to MDET_CALC_MAIN's queue 0x3005); each task whose flag has a bit it waits for, or whose queue a message, runs a turn of its body on a harness stack until it waits with nothing there; CPU 3's flags 0x3003..0x3007 and the queue 0x3005 are kept by the lab (OlyEvSt, iOlyEvSt, OlyEvWt, OlyEvCl and OlyQeWr, OlyQeRd on their ids, uITRON's semantics, the queue's 16-byte messages in order, waits without limit only); the offer's wait for the engine takes the deferred call's IRQ 53 (the driver's start), runs the lab clock to S-DML's completion and delivers IRQ 285, whose callback sets the flag; the post-processing, the subject records and LAF run natively, LAF writing MDET's frame table and posting UP_FACE after each offer; those posts wait for the call's return, where S-CPU3 serves them with one turn of DISP_FRAME, which draws the subject frames from that table. CPU 3's MDET code runs with the core register (0x8050) at 0, so the firmware's own tests for core 3 post to ring [3][0] what CPU 3 would call directly (the EMS2 clear 0x508251d2), which S-CPU3 serves after the turn (I). LAF's PDT and TRC sides run with the core register at 3, as their queues require: MDET_PDT_CPU3 and MDET_TRC_CPU3 (flags 0x300a's and 0x300b's words 0x600436dc / 0x600436e2, kept by the lab too) take a turn when their dispatch (0x50841edd, 0x508486c6), served by S-CPU3 in interrupt context, sets their flag; the deferred calls their drivers' interfaces post on CPU 3 (the opens, closes and starts) run after the turn through CPU 3's IRQ 53 handler, and a post from CPU 3 through any ring is an error. A turn's wait on the flag 0x300f (mdet_laf_stop_trc_pdt's, for TRC's and PDT's ends at LAF's end; its word 0x600436e8 kept by the lab too) serves CPU 3's ring at once, the dispatched tasks' turns running nested on a second harness stack, one level. No lab session posts a LAF event of its own: LAF's chase cycle needs take_mov's LAF parameters and chase requests, which follow TAKE_MOV's frame events (docs/om1-subject-spec.md 5.8, 5.9)",
  "S-LEARNDATA": "the learning data's copy: learning_data_load's read of the kind's item of group 0x800f (9,383,936 bytes) to its destination is answered with the reader's record {address, size} and nothing is copied (the large-data block is not in the lab, the destination is not mapped, S-DML reads no weights); other groups run natively (mdet.mjs)",
  "H-FCSAF": "(E143, at MDET's first request: S-TAKEMDET) three steps of the AF library's init (0x508bede6, which the boot chain calls at 0x501e9533 and the lab does not run) natively, in its order: 0x509748d7 (the AF target record's rebuild flag), 0x508c70c0 (the per-point table and the AF target record 0xa33b015c, built from the camera's AF target settings, objects 0x88b2, 0x84d1, 0x1dd1, 0x9a41, 0x1df1, 0x1e01) and 0x5099cbd9 (the info record whose pointer 0xa33d951c CPU 3's FCS call 0x508c00a3 writes and LAF reads; it was 0, so that call wrote and read low memory). LAF's AF area is then the AF target's cells in the 39 x 27 grid (the default centre 3 x 3 target: x 279..361, y 196..284 in MDET's 640 x 480 frame). The init's other steps log errors in the lab and do not run; a later change of the AF target is not followed (the AF library's settings step 0x508c388f does not run) (mdet.mjs; docs/om1-subject-spec.md 5.7)",
  "H-MDETINIT": "(E143, at MDET's first request: S-TAKEMDET, after H-FCSAF) the boot chain's MDET steps after the DML driver's (0x501e9720..0x501e9733, which the lab does not run) natively, in its order: MDET's message queues (mdet_util_q_init 0x50855239, two queue records copied from ROM; without them PDT's and TRC's dispatches log errors), the PDT driver's init (0x507f9c18: IRQ 279 attached on CPU 3 with handler 0x507f9b4d, the unit opened and closed) and the TRC driver's (0x507fbdd9: IRQ 278, 0x507fbd0e); MDET's logger init 0x5080445f, the step's first part, does not run (mdet.mjs; docs/om1-subject-spec.md 5.8)",
  "S-PDT": "the PDT / TRC unit (src/dev/pdt.mjs, board pdt): its registers as storage (the common page's resets and LLF tables, each engine's control words, parameters and results; any other address a bus error), a start of either engine (+0x2018 / +0x3018 bit 0) refused while the unit or the engine is held in reset, keeping the parameter image written since the last start (the debug API's pdt op), setting the result registers from the lab's words (none in a session: no camera flow the lab runs starts an engine) and completing after 2 ms of lab time (A-PDT-1) with status bit 0 (write 1 to clear) and IRQ 279 (PDT) or 278 (TRC), delivered by the lab through CPU 3's handler; neither engine's computation runs (docs/om1-subject-spec.md 5.8)",
  "S-EMS1": "the EMS1 engine of the camera front end (src/dev/ems1.mjs, board ems1): its registers as storage (the state, start, control and channel words, the common parameters, the five area channels' registers of the driver's table 0x602a3820, the power words, the clock tables, the four look-up tables, which read back what was written; any other address a bus error), the status write 1 to clear, a start (+0x008 with a channel's run bit 5k + 4, while the state word is 0) keeping the parameter image written since the last start (the debug API's ems1 op) and completing after 1 ms of lab time (A-EMS1-1) with each run channel's status bit and IRQ 276; the result RAMs read the lab's words (none) or 0; a nonzero block trigger is refused; nothing is written to memory: the engine's computation (its motion, statistics and correlation outputs by DMA) does not run. No camera flow the lab runs makes an EMS1 job: test_mdet.mjs runs the firmware's driver on it (docs/om1-subject-spec.md 2.4, 5.9)",
  "S-DML": "the DML engine (src/dev/dml.mjs, board dml): its registers as storage, the power words, a start (+0x010 = 1) that keeps the register image written since the last one (the debug API's dml op), zeroes the 9 classes of 32 records at (+0x1118) << 4, writes the records the lab gives (on E143 with S-TAKEMDET: S-SCENE's subjects of the offer's kind, each of them, placed in MDET's 640 x 480 frame through DISP_FRAME's own transform taken back, subject.mjs frames(), as body records of class 0 and the parts S-SCENE names at their own boxes in their class of the group, the racer's helmet in class 2 (part 2, I), all with score 0x0e00, mdet.mjs; MDET's own combination pairs each part with its body, docs/om1-subject-spec.md 5.6) and completes after 10 ms of lab time (A-DML-1) with status bit 14 (write 1 to clear) and IRQ 285; the network does not run",
  "S-LENS": "(unless the lens runs natively: the default on E143, E146 and E147, S-LENSMCU; OM_EMU_LENS=stand-in for S-LENS there) a lens on the mount, the M.Zuiko 12-40mm F2.8 PRO: lens 0's attach and data-valid flags (0xa32d4b9a, 0xa32d4b98) are 1 and its record (0xa32caa8c -> the driver's static 0xa3193780) is filled through the driver's current copies and its own commits 0x502ac838 / 0x502acb96, the zoom entries at +1164; the field layout is the record dump's (0x50118662, 0x50118ab7, 0x50118d20), the values I (12-40 mm, F2.8-F22 as APEX x 256 761 / 2283); the driver's derived apertures and focal lengths run natively; the lens-ready byte 0xa32d4b94 is 1 (0x50127ba2 answers 1, not 0x21, which DISP_FRAME requires, I); set before the application starts",
  "S-EXPOSE": "the brightness the exposure plan follows: the AE result objects 0xc12a / 0xc0ba / 0xc0ca (the AE result writer 0x50596187 copies them from EXP's result record, in the callback TAKE_EXPOSE puts in its AE request to EXP; one per metering mode, I; read natively only by the plan and the application's get by index, docs/hle-gaps.md 4.2.2) set through the property setter 0x5004188b to the scene's BV = (EV100 - 5) x 256 (S-SCENE's scene, else its default EV 12), the zoom step nearest its focal length; take_expose_calculate 0x50597e82 runs natively, once the application has started and after each input on the shooting screen; its plan (0x62a919dc +6 Tv, +10 Sv, +14 Av) is the shutter, aperture and ISO the screen shows and, in S-SCENE's auto, the live view's and the captures' exposure. The camera meters the live view continuously (EXP's AE requests, not run: the lab never reaches the through start's request, and posted by hand it stops before the callback, docs/hle-gaps.md 4.2.2)",
  "S-OUTDISP": "while the lab's display switch (SWITCH: H-CONNECT 131 with lOutput 7) has the EVF open, the application's getOutputDisplay (0x5104fd44) answers 6 (INTERNAL_EVF), the device H-CONNECT's lOutput 7 stands for; on the TFT it runs natively. Without it the application, told of the GUI's change, answers the TFT (its EVF branch needs a monitor position the lab's switch bits do not give, docs/om1-shutter-spec.md section 7 item 53) and sends 131 with lOutput 2, and the two alternate. The camera decides from the eye sensor, the monitor position and the settings (I)",
  "S-OUTDEV": "(E143 with --hdmi on) the application's change of output device, TRA 588, which S-TRAACK answers at the exec: the part its component would do (CmpCst_Function, CmpSqp_SequencePartsBase: the IO-device capability's event 224 with the request's device), done after the step, the event built by its own constructor and dispatched to CapIod_IODevice natively, as its OXF thread would; CapIod opens the device natively (the HDMI output 8 at the plug), and S-PROP's output-device property follows the value CapIod writes. The components' own steps around it (the through image's bank, their reply to the transaction, the change's notification 494) are not done. Not used under control camapp 3: there the component answers TRA 588 natively and the device opens through it (X)",
  "S-THROUGH": "(with S-SCENE's live view) the application's through-image control OlyHfwOpeShoot::ctrlAutoThrough (0x50abd373; ctrl 0 as the menu opens, 1 as it closes, D from its log) stops and restarts S-SCENE's frames: while stopped the live-view plane shows black (I: what the camera's plane shows while the through image is stopped)",
  "S-SETSAVE": "the settings store's save to flash (0x500421cd, called by the application as the menu closes, return 0x503f01a4) returns 0 without saving, the value of its path for a store that is not dirty: the flash controller (0x98d01800) is not in the lab and persistence is not modelled; a call from anywhere else is an error",
  "S-NVRAM": "(a host that keeps the camera's non-volatile state, env.nvram: bin/play.mjs by default, in ~/.om-emu/nvram-<model>.json, --nvram off / OM_EMU_NVRAM=off for a blank camera, OM_EMU_NVRAM=FILE elsewhere; the browser player by default, in OPFS, nvram=0 for a blank camera; on bodies whose build places its sites, E143, E146 and E147, X) the settings stores' saves run natively down to the NAND write 0x5003d9da (direct, or posted to the flash task through 0x5003d95c, whose callback runs after it), which writes the image to its mirror and to the host; the next session's registry bootstrap restores M and E from those images ('MlR.', 'ElR.'); the SCPU window's backed-up words (the clock signature 0x00, the B store 0x08..0x3c) and the sub-CPU's memory S-SCPUDEV keeps (its RTC: the host's local time, read once at the session's start, plus the offset the camera's own clock setting left, advancing with lab time in the session; and its backup registers) come back too, and the window clock starts at that date, so the start shows no date prompt (instead of S-SETSAVE). A session is then a function of that state, that one clock read and its inputs: session.json records both per session (src/lab/nvramdoc.mjs), and --replay starts from them in memory",
  "H-STOREINIT": "the property store's module init (E143 0x503ee2d6, the fifth of the settings init chain 0x503dae30, which the boot runs between the registry bootstrap and the settings-DB init; the body's read by src/fw/facts.mjs propStore) natively at the store init, between the two: it keeps the data pointers of the mode store's three objects (the banks, the recalled rows, the working copy), which a mode change stages the settings from; the chain's other inits do not run",
  "H-SCPUSTART": "the firmware's PER_SCPU started natively at the store init (act_tsk of its static task, as the boot chain would long before; its entry allowed) with the sub-CPU's model at the far end of its link: the task pulses the reset pin, waits for pin 102, sends 0x85 {2} and takes its reply natively; checked: the task waiting, the gate open, that one frame (docs/hle-gaps.md 4.7.1)",
  "S-SIO2": "PER_SIO's channel API for the one channel PER_SCPU opens (channel 2 on E143; PER_SIO's registers, init and interrupt handlers are not modelled): open calls the opener's callback, a full-duplex transfer hands its bytes to the sub-CPU's model and writes its answer to the rx buffer, and its end is delivered at the MN's next idle point in interrupt context, the rx callback with the descriptor and then the tx callback, as the driver's interrupt calls them; another channel's calls run natively as before (the EVF panel's channel 0), another kind of transfer on PER_SCPU's stops the session",
  "S-SCPUDEV": "the sub-CPU at the far end of the link (src/lab/scpudev.mjs; docs/om1-scpu-spec.md 3): its ready line (pin 102), message line (the window's port 3, dropped while a message of its own waits for the MN's poll [2, 0x8f], whose reply carries it), SPI slave and command manager from its firmware's code: the 10-byte receive, the power-on gate (only 0x85 and 0x02 before 0x85 {2}; anything else stops the session, as it stops the sub-CPU), replies [length, command, data] padded to 4, long writes and reads in chunks. Its handlers: 0x85 (the reply its handler builds; the gate opens at the release), the date (0x01 sets the RTC and its valid flag, backup register 1, for status 0, clears the flag otherwise; 0x81 answers the RTC, advancing with lab time (from the host's clock at the session's start under S-NVRAM), or 2019-01-01 with status 10501 while the flag is clear), the backup words 0x06 / 0x86 (0 on a blank camera), the port scan 0x88 ({result, not busy}: bit 0 PC13, bit 1 PC5, low in the lab, which keeps the USB switch 0x0400 at the idle image's state; the read enables the scan's report, a later change of PC13 is posted as the message 0x08), the GIO read 0x82 of those two ports and the power manager's 0x12 {5}, answered with the message 0x12 {5}; 0x85's releases set its power state (steady, bkground, pwr_save, standby, hibernation) and, for a power-off, drop its messages, stop the link as the sub-CPU leaves steady (pin 102 low) and stop the session at the next request (the wake is not modelled). Any other command stops the session naming it",
  "H-UIINSCAN": "(a body whose UI_IN has the request, fact scpu.port_scan: E143, E146, E147) UI_IN's module init's port scan (0x5005d36a, not run with the init) natively at play bring-up: the request 0x88 over the link, the reply's bit 0 to group 4's switch 0x0400 through the group-4 producer; checked: one 0x88 frame, not busy, no errlog, group 4 still the idle image (docs/hle-gaps.md 4.7.1)",
  "A-SCPUDEV-1": "the sub-CPU acts only at the MN's idle points, one action (a level change, or the handling of one event) per step and in zero lab time; a transfer's end is delivered first. The real sub-CPU answers within microseconds while PER_SCPU arms each wait before it blocks, so only the order is modelled",
  "A-LINKPINS-1": "pin 102's GIO interrupt is level-sensitive: type 0 its high level, type 1 its low level; a status bit stays set while its level holds, and a write clears only bits whose level has gone (PER_SCPU's callbacks disable the interrupt first, and the sub-CPU raises and drops the pin back to back, D)",
  "S-SCPUBOARD": "(OM_EMU_SCPU=native: the sub-CPU's own firmware on the STM32L4 machine in S-SCPUDEV's place, src/lab/scpum4.mjs) the sub-CPU's board: nothing attached but the MN's link (no battery pack answers on USART1 / USART2, no I2C device acknowledges: the chargers, the PBH IO expander, the USB PD controller; every ADC channel reads 0; LSE present, HSE absent; the hardware-phase straps on their pull-ups, phase 7) and the port scan's inputs PC13 and PC5 held low, S-SCPUDEV's levels: PC13 low keeps UI_IN's switch 0x0400 at the idle image's state and selects bkground at a power-off, where its pull-up would take the sub-CPU into standby 3 s after reset. What the camera's board answers is ?",
  "A-SCPUM4-1": "(OM_EMU_SCPU=native) the sub-CPU's time runs in step with lab time: before it takes an input of the MN's (a pin, a transfer) it runs up to the lab time of that input, and at the MN's idle points up to the lab's now; each input also opens an answer window of 50 ms of its own time (0.5 s after its power-on or reset) in which it runs on at the idle points while lab time stands still, stopping at each change of its link lines, which reach the MN one per idle point (A-SCPUDEV-1's order); a transfer's bytes pass its SPI2 at the link's clock, eight bit times of its own each, in zero lab time. The windows let it boot and answer while the MN waits on it in zero lab time and stay short of its command manager's 1000-tick monitor",
  "A-SCPUM4-2": "(OM_EMU_SCPU=native) a link line the sub-CPU does not drive (its pin not an output, an open-drain 1, the reset held) reads as S-SCPUDEV's lines while its reset is held: pin 102 low, the message line high; what the board makes of a released pin is ?",
  "A-SCPUM4-3": "(OM_EMU_SCPU=native) MN pin 107 high holds the sub-CPU's NRST low, S-SCPUDEV's polarity: a pin reset of the STM32L4 that keeps its backup domain (the RTC, the backup registers) and its SRAM; the sub-CPU is powered on at the link's start with a blank backup domain (the camera's has run since its battery went in, ?)",
  "S-MOVRATE": "(a body whose movie record time divides by the movie info's frame rate without a test: E118, X) the MN103's DIVU by 0, whose quotient the manual leaves undefined (emu/FIDELITY-NOTES.md 3.2): the rate is the movie recorder's set-up's, which runs on CPU 2 at a movie take's start or a movie's playback, so it is 0 on the camera too until then (docs/model-survey.md finding 59). While it is 0 the divide is not executed, its quotient taken as 0, and the record time runs on natively and fills its block; the quotient goes only to the block's +20, which two of the query's seven callers read, neither met in the lab's start. What the camera's quotient is, ?",
  "S-LONGTIMER": "the system timer module's long timers (1000 ms and more, set through api_system.c 0x5041fd71 / 0x5041fd0d by the HLS timer service): when one is due in lab time the module's event 0x03010000 | number is published, as the module would",
  "S-BOOTDONE": "the HLS components' boot completion: the camera base (Cab_CameraBase) and the still-shooting category wait in their state 3 for event 415, which the application's HighLevel init sends as TRA 415 through the transaction exec (X), and S-TRAACK answers at the exec; S-BOOTDONE dispatches 415 to each waiting there, and 420 (the shooting mode) to the camera base waiting in its state 11, so the shoot mode, the category and Cmp_ShootingComponent are created and run on the OXF main thread (HIGHLEVEL_MAIN, started by S-CAMAPP). The component's sub-CPU status read (0x5012b8b7) returns 0. Not installed under control camapp 3, where the transaction path runs natively and the application's own TRA 415 and the mode change's 420 bring the camera base to its state 13 and the category to its state 11 (X)",
  "S-HISTEND": "(control camapp 3) the VSC histogram's end in DISPLAY cmd 15's wait: the shooting component starts the VSC's histogram on the TFT channel (0x501e14a4: INTEN1 bit 8, HIST1 = 1; X), a run every 50 ms, each ended by the VSC model (A-VSCHIST-1), its interrupt taken natively and its done callback (0x501d71e1) run by task 16 (X). DISPLAY cmd 15 (0x501d709f), which the menu sends inside a display run, waits up to 50 ms for the flag only that callback sets (D); in a display run lab time stands still, so the lab clock runs a frame at a time to the run's end (at most two frames) and the wait then runs natively and returns E_OK (X). The camera's DISPLAY task waits the same time for the same end (I)",
  "A-VSCHIST-1": "(control camapp 3) a run of the VSC's histogram unit, started by a write of HIST1 bit 0 (D: 0x501e14a4 writes HIST1 = 1 for every run), measures the frame that begins at the channel's next boundary and ends at the boundary after it, where INTST1 bit 8 is set and, with INTEN1 bit 8, raises the channel's IRQ; a run is one-shot. The firmware waits for the run's registers to latch before it starts one (0x501d6e17..a2, D), so a whole latched frame is the earliest the run can cover (I); the unit's real time per run is not known (?), and only the lab's pace depends on it (a run every 50 ms of lab time, X)",
  "A-VSCHIST-2": "(control camapp 3) the bins of a run whose source plane (taken as the IMG plane HIST2[17:16] names, I: the set-up 0x501e127f stores there the index of the IMG plane whose DMA address is the request's, else 0, and the start path passes no address, so the field is 0, D) had its DMAEN bit clear in the latched bank read as 0, trusted only while the firmware discards them: the written DMAEN bit 5 (IMG1) clear and HIST2[17:16] 0 at the read (the firmware's test, 0x501e1462, also takes 3, which the set-up does not write, D; the model refuses it), the test after which 0x501d70e6 overwrites the bins it read with 0 and puts 64 in bin 5 (0x501d712d..0x501d7154, D). What the unit counts with no source plane is ?; any other read of the bins is the model's error HIST_UNMODELLED (what the unit counts and how, HIST3's halves among it, is ?)",
  "A-VSCHIST-3": "(control camapp 3) the VSC histogram unit's registers HIST1, HISTAREA1-3, HIST2 and HIST3, written in the forms of their only writers (the set-up 0x501e127f, 0x501e1488 and the start 0x501e14a4; no other store names their addresses and no call of the generic writer 0x501e2ce6 passes their indices, D), leave the TFT's composite unchanged (src/dev/vsccompose.mjs histForm; A13 otherwise refuses them, FEATURE_UNOBSERVED): the unit is a measurement the CPU reads back (the bins at +0x4000, 0x501e150e) and the histogram the camera shows is drawn by CPU 2's OSD_DRAW_CPU2 into a GUI layer from them (D, X: docs/hle-gaps.md 4.6.2); that the unit adds nothing to the output is I (a photo of the panel with a run on settles it). Forms: HIST1 0 or 1; HIST2 bit 20 with the bin count's code, the clip and scale bits and a source plane 0..2, bits 12 and 31..24 clear; HIST3 any; HISTAREA1 / HISTAREA2 a non-empty area inside the window; HISTAREA3 HISTAREA2's y. Any other value stays FEATURE_UNOBSERVED (docs/hle-gaps.md 4.2.4)",
  "H-IMGPROINIT": "(control camapp 3) the image library's init 0x5046d7ab, which USTART2's stage calls (0x501e91d8) and the lab does not run, in part, natively at the application's start: its IRQ attach 0x5048c3a0 (the library's 14 IRQs, each attached on CPUs 0..3 and disabled there, IRQ 300 with the imgpro unit's handler 0x5048bfe3 at level 4 among them), its request ids' bitmap clear 0x5048ba3a and, of the units' init 0x50481211, only the imgpro unit 0x9c600000's own init 0x5050a6b2 (S-IMGPRO). The rest of 0x50481211 (the units at 0x9c200000 and the others, which the lab does not model) and 0x5048d57f do not run. Without the attach a request's go (0x5050a8ba) enables IRQ 300 at level 0 and the unit's end is never taken: the request's wait runs out after 1000 ms and the kind's end runs anyway (X; docs/hle-gaps.md 4.3.1)",
  "S-STAGE9": "(control camapp 3) the image's stage 9 readied: bit 8 of the stages' ready word (src/fw/facts.mjs bootState) set at the application's start, as the boot's per-segment step 0x50024eda would set it after the segment's read; the lab's image holds every stage's code (as for S-BOOTSTAGE and H-AUDSTART) and module 9 has no static constructors (0x501e6102, D). The menu's image player (CapImg_ImagePlayer 0x50bad41b -> api_play 0x504067b9 -> the play buffer's 0x50a6c59b, command 0x300) waits for it in 2 ms sleeps (0x50024de8(9)); without it the OXF main thread slept there for good and the menu stayed at ID_ST_MENU_ENTRY (X; docs/hle-gaps.md 4.3.1)",
  "S-IMGPRO": "the imgpro unit at 0x9c600000, the image library's unit 7 (src/dev/imgpro.mjs, board imgpro; docs/om1-imgpro-spec.md): its registers as storage (the power, control and parameter words its driver 0x5050a6b2..0x5050b547 names as operands; any other address a bus error, kind 6's parameter blocks, which its set-up 0x5050b328 writes through a base register, among them), the status write 1 to clear, IRQ 300 high while its end bit and the enable are set, a run started by +0x00c then +0x018 written 1 while powered up. Of the runs only kind 14's fills are computed (op 3: mode 4 the linear fill, mode 5 the rectangle fill, from the address, pitch, sizes and 32-bit value the set-up 0x5050b118 writes, and only when no other parameter word was written since the last start; how the unit reads these words is I, and the value is taken as a little-endian word at 4-byte aligned addresses, I) and their bytes written to the bus's memory; every other operation (kind 13's copies, kind 16, kind 17's scaler, which writes no +0x380, kind 6, whose op 3 writes +0x380..+0x3ac whole), a fill whose value's phase off a 4-byte boundary would matter and a read of kind 16's result are refused (a bus error). Only control camapp 3 reaches it: the menu's fill of the through image's bank (900 x 600 pixels, 0x800b800b, X; docs/hle-gaps.md 4.3.1)",
  "A-IMGPRO-1": "(with S-IMGPRO) a run of the imgpro unit writes its bytes and raises its end 1 ms of lab time after its start (I: the unit's time is not known; the request's wait allows 1000 ms, 0x5049362a, so only the lab's pace depends on it)",
  "S-CPU3": "the posts to CPU 3 through ring [3][0] are taken off the ring in order and acknowledged, each by its function: DISP_FRAME's remote calls of 0x5002587a (each setting bits of DISP_FRAME's flag), after each step, S-DISPFRAME then running one turn of DISP_FRAME for their bits; on E143 MDET's post, at once at its poster's return, and LAF's event setters, the EMS2 clear and PDT's and TRC's dispatches (src/fw/models.mjs mdet.events, mdet.posts; the dispatches with the core register at 3), each run in interrupt context, S-MDETDL then running CPU 3's tasks (mdet.mjs); a CPU 0 wait for LAF's answer (mdet_laf_end's on the flag 0x600430c4's id) is preceded by this service, the waiting call's stack kept (nested); a post of any other function stops the session; the lab has no CPU 3",
  "S-RELSEQ": "the modules' notifications of a release as the callbacks the HLS shooting reactive posts for them (0x50af4451, CBC_SHOOTING_COMMON), while the application's shooting service runs (from startShootingService 0x50ae1124 to endShootingService 0x50ad7e8a; in playback S1 only takes the application back to shooting): S1 down -> START_FOCUS, END_FOCUS (OK, or NG when S-SCENE's live view has nothing focusable under its AF point); S2 down -> START_SHOOTING_PICTURE, START_EXPOSE, END_EXPOSE after the shutter time in use, END_SHOOTING_PICTURE, START_RECVIEW, END_RECVIEW 500 ms later, then START_THROUGH_IMAGE_PROCESS (the through image's restart, on which the GUIs of the E118 family, E142, E140, E130, E133, E145, E129 and E132 leave the rec view's display); the application's RECORDING_MOVIE function starts a recording (READY_MOVIE, START_SHOOTING_MOVIE, START_RECORDING_MOVIE, UPDATE_SHOOTING_TIME every second) or ends it (STOP_SHOOTING_MOVIE, END_RECORDING_MOVIE); meanwhile the shooting phase query 0x50ab57e9 answers the movie phases of the shooting component's sequence (113 ready, 114 ready finish, 115 recording, 117 end), so getMovieState is 1 and the GUI lays out its REC mark. The callbacks due at one lab time (END_EXPOSE and END_SHOOTING_PICTURE) are posted together before the application runs, as the modules' notifications would reach its queue while it works (E145's application defers an event until END_SHOOTING_PICTURE, X). The order follows the callbacks' names (I). No image is developed: S-RECVIEW shows the capture's frame",
  "S-SHUTTERSND": "(a host that plays sound: the players' pages) the mechanical shutter's sound at each release S-RELSEQ makes, synthesized (src/lab/shuttersnd.mjs: seeded noise through decaying resonators, no audio asset): an open click at START_EXPOSE and a close click with the charge motor at END_EXPOSE, the shutter time in use later (S-SCENE's, else 1/125 s), sent to the page over the lab's audio output (src/lab/audio.mjs, GET /api/audio) and played with WebAudio once a key or a click has started it. On the camera that sound is the mechanism's own, not the firmware's: the stock firmware plays nothing at a release and the electronic shutter is silent (I: the patch tool om-c, on the same base images, has to add both a call of the sound engine's play method before the capture's begin and the sound; in the lab's S2, where S-RELSEQ stands in for the release and that capture begin does not run, the play method is not called, X of the lab only); which drive settings select the electronic shutter is not decoded (?), so every release sounds as the mechanical shutter. Nothing about the clicks is measured from a camera (I)",
};
const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');

export class CamApp {
  constructor(session) {
    this.s = session;
    this.acks = [];            // module requests waiting for their reply
    this.dispsync = new Set(); // S-DISPSYNC: the device codes with a synced display request waiting
    this.dispsync_released = 0; // S-DISPSYNC: the releases so far (the player lists the stand-in once one ran)
    this.log = [];             // [kind, detail] of every stand-in action, the session's record
    this.reactive = null;
    this.timed = [];           // [due lab ns, CBS name, param] posts
    this.long_timers = new Map();   // S-LONGTIMER: timer number -> due lab ns
    this.movie_rate_answered = 0;   // S-MOVRATE: the record time's calls answered while the frame rate is 0
    this.funcs = [];           // function direct ids the application started in the step
    this.recording = null;     // the lab ns a recording started, or null
    this.movie_phase = null;   // S-RELSEQ: the shooting phase the phase query answers during a movie, or null
    this.card_used_ms = 0;     // S-CARD: the recordings' time so far, off the movie time left
    this.card_shots = CARD_SHOTS;   // S-CARD: the card's shots before any image (bin/modelcheck.mjs's count probe sets it)
    this.images = [];          // S-CARD: the pictures taken, { folder, number, release, ... }: the lab's record of each
    this.play_list = [];       // S-PLAYSEQ: the card's pictures at the play start, { folder, number }
    this.release = 0;          // S-CARD: the releases (S2 down while shooting) so far; views: release -> S-SCENE's view
    this.views = new Map();    // of its capture; view_release: the release whose view S-SCENE gives next
    this.view_release = null;
    this.play_pending = [];    // S-PLAYSEQ: play requests to finish after the step
    this.play_cur = null;      // S-PLAYCOMP: the index of the image shown (in play_list)
    this.play_exec = null;     // S-PLAYSEQ: the play request whose transaction runs next
    this.tra_deleted = 0;      // S-TRAACK: the requests deleted after their exec
    this.outdev = this.s.hdmi_port && MODEL === 'E143' ? [] : null;   // S-OUTDEV: TRA 588 requests to take after the step
    this.outdev_done = [];     // S-OUTDEV: [device, second, CapIod's state after the event]
    this.outdev_prop = undefined;   // S-OUTDEV: the output-device property CapIod writes in the event (null: none yet)
    this.aflock = false;       // S-AFLOCK: installed (E143 with UI_OUT running); af_stage: null, 'ready' (S1 down) or
    this.af_stage = null;      // 'focus' (the AF lock holds); aflock_fed: the END_FOCUS(OK)s fed so far (the player
    this.aflock_fed = 0;       // lists the stand-in once one was)
    this.components = !!session.opts.camapp_components;   // S-BOOTDONE / S-CPU3: the HLS components run (control camapp 2)
    // control camapp 3: the components with the transaction path native (TRAACK_KEPT); tra_native: [id, caller, the
    // exec's result or null where its return was not observed] of each transaction handed to the exec
    this.native_tra = this.components && !!session.opts.camapp_native_tra;
    this.tra_native = [];
    this.tra_returns = new Map();
    this.hist_ends = 0;        // S-HISTEND: DISPLAY cmd 15's histogram waits the lab clock ran to the run's end
    this.hist_waited = [];     // camapp 3: [d0, lab ns] where each of cmd 15's histogram waits returned
    this.imgpro_inited = false; // camapp 3: H-IMGPROINIT and S-STAGE9 done
    this.media = null;         // S-MDACTRL / S-MEDIA (media.mjs): with the file system native
    // subject.mjs: subject detection's frames, on a body that gives its facts (models.mjs subject): S-SUBJECT's writes
    // where MDET_DL does not run natively, else the setting, the live condition and the placement S-TAKEMDET and S-DML use
    this.subject = MODEL_INFO.subject ? new SubjectFrames(session, this, MODEL_INFO.subject, (mode) => this.frame_mode(mode), FRAME_MODE_AF) : null;
    // S-TAKEMDET / S-MDETDL / S-LEARNDATA (mdet.mjs): CPU 3's MDET_DL natively with S-DML, on a body that gives its
    // facts (models.mjs mdet) and the subject ones; df_bits: DISP_FRAME's bits a nested drain left (S-CPU3)
    this.mdet = MODEL_INFO.mdet && this.subject ? new MdetDl(session, this, MODEL_INFO.mdet) : null;
    this.take_mode = null;     // S-TAKEFRAME: the frame mode last set
    this.df_bits = 0;
    this.take = null;          // the TAKE probe (take.mjs, --take probe): TAKE_FUNC and TAKE_FUNC_CP natively
    this.shoot_mode = false;   // S-BOOTDONE: 420 sent
    this.boot_finished = false; // S-BOOTDONE: the category left its state 3
    this.started = false;
    this.shooting = false;     // S-RELSEQ: the shooting service runs
    // S-SHUTTERSND (shuttersnd.mjs): the mechanical shutter's sound at each release, where the host plays sound
    this.shutter_sound = session.audio ? new ShutterSound(session.audio) : null;
  }
  // S-CAMAPP: run inside the session's step 'camapp start'.
  start() {
    const s = this.s, lab = s.lab;
    for (const e of CA_TASK_ENTRIES) lab.lt.allow.add(e);
    // a ported model's: every module-9 read of its build (fact app.module9_readers, src/fw/facts.mjs); E143's: those
    // its application reaches (CA_MODULE9_READERS)
    for (const r of [...CA_MODULE9_READERS, ...fact('app.module9_readers', [])]) lab.takeover_allowed.add(r);
    if (this.native_tra) for (const r of CMP_MODULE9_READERS) lab.takeover_allowed.add(r);
    lab.prop_sites.push(CA_PROP_SITE);
    this.install();
    if (this.native_tra) this.imgpro_init();                                       // H-IMGPROINIT, S-STAGE9
    for (const a of CARD_STATE) lab.sim.write(a, pack('<I', CARD_MOUNTED));       // S-CARD
    if (!s.storage) lab.sim.write(CARD_DETECT.table, pack('<H', CARD_INSERTED));    // natively: the DCF card-in (storage.mjs)
    if (this.slens()) {                                                             // S-LENS
      lab.sim.write(LENS_ATTACHED, Uint8Array.of(1));
      lab.sim.write(LENS_READY, Uint8Array.of(1));
    }
    const rv = fact('recview', RECVIEW_E143);                                       // S-RVSTANDBY
    if (rv) lab.sim.write(rv.word, pack('<I', rv.standby));                         // (null: no rec view word read, facts.mjs)
    // S-DISPFRAME, where the port places DISP_FRAME's start and loop (the E118 family's three cores run no CPU 3 task
    // and the port places only some of them, X; whether and where it draws its AF frames is ?)
    if (DF_FUNCTIONS.every((a) => !isUnmapped(a))) this.dispframe_start();
    if (this.slens()) this.lens_mount();                                            // S-LENS
    lab.call(HL_CREATE, null, null, null, 2000000);
    // camapp 3: the OXF main thread runs before HL_INIT, whose TRA 415 waits in the receiver for its answer
    // (TRAACK_KEPT's comment)
    if (this.native_tra) this.highlevel_main();
    lab.call(HL_INIT, null, null, null, 2000000);
    s.settle('S-CAMAPP HighLevel');
    this.boot_done();                                                               // S-BOOTDONE: the camera base's 415
    lab.call(BROKER_INIT, null, null, null, 2000000);
    s.settle('S-CAMAPP broker');
    if (this.components && !this.native_tra) {
      this.highlevel_main();
      this.boot_done();
    }
    this.take?.bring_up();                                                          // H-TAKEINIT (take.mjs)
    const tid = [...lab.nk.tasks()].filter(([, [e]]) => e === CA_MAIN).map(([t]) => t);
    if (tid.length !== 1) throw new FirmwareError(`S-CAMAPP: static tasks with entry ${h8(CA_MAIN)}: ${tid}`);
    const [rc] = lab.nk.svc('act_tsk', { d0: tid[0] });
    if (rc !== 0) throw new FirmwareError(`S-CAMAPP: act_tsk(${tid[0]}) = ${rc}`);
    s.settle('S-CAMAPP CA_MAIN');
    lab.gui_await();                                                                // H-GUIBYAPP
    this.pump();
    this.frame_mode(FRAME_MODE_AF);                                                 // S-TAKEFRAME
    this.started = true;
    this.expose();                                                                  // S-EXPOSE
  }
  // camapp 3: H-IMGPROINIT (the image library's init in part) and S-STAGE9 (the image's stage 9 readied); see
  // IMGPRO_IRQ_ATTACH's comment
  imgpro_init() {
    const lab = this.s.lab, unit = lab.sim.m.devices.imgpro;
    if (!unit) throw new FirmwareError('H-IMGPROINIT: the board has no imgpro unit (src/fw/board.mjs imgpro)');
    for (const fn of [IMGPRO_IRQ_ATTACH, IMGPRO_IDS_CLEAR, IMGPRO_UNIT_INIT]) lab.call(fn, null, null, null, 200000);
    if (unit.powered || unit.runs) throw new FirmwareError(`H-IMGPROINIT: the unit's init left it ${unit.powered ? 'powered' : 'with a run'}`);
    const at = bootFacts().stage + ((STAGE_PLAY - 1) >> 3), bit = 1 << ((STAGE_PLAY - 1) & 7), b = lab.sim.read(at, 1)[0];
    if (b & bit) throw new FirmwareError(`S-STAGE9: the stage word ${h8(bootFacts().stage)} has stage ${STAGE_PLAY}'s bit before the start`);
    lab.sim.write(at, Uint8Array.of(b | bit));
    this.imgpro_inited = true;
    this.log.push(['imgpro', `the library's IRQs attached, the unit's init run; stage ${STAGE_PLAY} readied`]);
  }
  // S-CAMAPP: act_tsk of the OXF main thread (task 57, HIGHLEVEL_MAIN), then a settle
  highlevel_main() {
    const s = this.s, lab = s.lab;
    const hl = [...lab.nk.tasks()].filter(([, [e]]) => e === HL_MAIN).map(([t]) => t);
    if (hl.length !== 1) throw new FirmwareError(`S-CAMAPP: static tasks with entry ${h8(HL_MAIN)}: ${hl}`);
    const [hrc] = lab.nk.svc('act_tsk', { d0: hl[0] });
    if (hrc !== 0) throw new FirmwareError(`S-CAMAPP: act_tsk(${hl[0]}) = ${hrc}`);
    s.settle('S-CAMAPP HIGHLEVEL_MAIN');
  }
  // S-LENS applies on a body with a lens mount whose lens does not run natively (play.mjs lens, lens.mjs)
  slens() { return LENS_MOUNT && !this.s.lens; }
  // S-LENS: the 12-40 mounted (see S-LENS above)
  lens_mount() {
    const lab = this.s.lab, sim = lab.sim;
    const u16 = (v) => pack('<H', v & 0xFFFF);
    sim.write(LENS_VALID, Uint8Array.of(1));
    const record = lensStatic();
    sim.write(LENS_RECORD, pack('<I', record));
    sim.write(LENS_STATE, pack('<I', 0x8000));                    // L_STATUS_M
    sim.write(LENS_STATE + 12, u16(LENS_AP[0]));                  // L_APACTnow
    sim.write(LENS_STATE + 14, u16(LENS_AP[0]));                  // L_APACTnow(infinity)
    sim.write(LENS_CHARACTER + 4, Uint8Array.from(LENS_ID));      // L_ID[]
    sim.write(LENS_CHARACTER + 10, Uint8Array.from(LENS_NAME, (c) => c.charCodeAt(0)));   // L_NAME[]
    sim.write(LENS_CHARACTER + 42, Uint8Array.of(LENS_ZOOM.length));                     // L_ZMENCdiv: the zoom entries
    sim.write(LENS_CHARACTER + 48, u16(LENS_ZOOM[0]));            // L_FLwide
    sim.write(LENS_CHARACTER + 50, u16(LENS_ZOOM.at(-1)));        // L_FLtele
    const entry = (at, fl) => { sim.write(at, u16(fl)); for (let k = 0; k < 4; k++) sim.write(at + 2 + 2 * k, u16(LENS_AP[k % 2])); };
    entry(LENS_ZOOM_ENTRY, LENS_ZOOM[0]);                         // L_FLenc, L_APmin, L_APmax, L_APACTmin, L_APACTmax
    lab.call(LENS_COMMIT_STATE, null, null, null, 200000);
    lab.call(LENS_COMMIT_CHARACTER, null, null, null, 200000);
    const table = lensZoomTable();
    LENS_ZOOM.forEach((fl, i) => { if (i) entry(record + table + 16 * i, fl); });
    this.zoom = 0;
    for (const f of LENS_DERIVE) lab.call(f, null, null, null, 200000);
  }
  // S-CARD: the lens's focal length in mm now (a capture's): the native lens's zoom (lens.mjs), S-LENS's zoom step, or
  // null with no lens on the mount (a body with a built-in lens, whose focal length the lab does not read)
  lens_focal() {
    if (this.s.lens) return this.s.lens.mcu.focal();
    return this.slens() ? LENS_ZOOM[this.zoom] : null;
  }
  // S-CARD: the camera's clock now (a capture's) as its own read gives it (CLOCK_READ, run natively): {date: [year,
  // month, day, hour, minute, second], status}, or null on a build where the read is not placed
  clock() {
    if (isUnmapped(CLOCK_READ)) return null;
    const lab = this.s.lab, rec = lab.alloc(new Uint8Array(CLOCK_RECORD), 4);
    lab.call(CLOCK_READ, { a0: rec }, null, null, 2000000);
    const b = lab.sim.read(rec, CLOCK_RECORD);
    return { date: [b[0] | b[1] << 8, b[2], b[3], b[4], b[5], b[6]], status: b[CLOCK_STATUS] | b[CLOCK_STATUS + 1] << 8 };
  }
  // S-LENS: the zoom step nearest focal_mm (L_ZMENC), committed, and the driver's current focal length again
  lens_zoom(focal_mm) {
    const lab = this.s.lab;
    if (this.s.lens) { this.s.lens.zoom(focal_mm); return; }        // the native lens: its zoom ring (lens.mjs)
    if (!LENS_MOUNT) return;
    let z = 0;
    LENS_ZOOM.forEach((fl, i) => { if (Math.abs(fl - focal_mm) < Math.abs(LENS_ZOOM[z] - focal_mm)) z = i; });
    if (z === this.zoom) return;
    lab.sim.write(LENS_STATE + 4, Uint8Array.of(z));
    lab.call(LENS_COMMIT_STATE, null, null, null, 200000);
    lab.call(LENS_FOCAL_NOW, null, null, null, 200000);
    this.zoom = z;
  }
  // S-EXPOSE: the camera's exposure plan for the scene's brightness; null before the application has started or off
  // the shooting screen (the last plan stays)
  expose() {
    const s = this.s, lab = s.lab;
    if (!this.started || lab.state() !== STATE_SHOOTING) return this.plan ?? null;
    const sc = s.scene ?? SC.defaultScene();
    this.lens_zoom(sc.lens.focal_mm);
    const bv = Math.round((sc.ev - 5) * 256);
    for (const id of BV_OBJECTS) lab.call(PROP_SET, { d0: id, d1: 0, a0: 0, a1: bv & 0xFFFF }, null, null, 2000000);
    lab.call(EXPOSE_CALC, { d0: 0 }, null, null, 20000000);
    s.settle('S-EXPOSE');
    const at = (k) => { const v = lab.sim.read(AE_PLAN + PLAN[k], 2); return ((v[0] | v[1] << 8) << 16) >> 16; };
    const tv = at('tv'), av = at('av'), sv = at('sv');
    this.plan = { bv, tv, av, sv, shutter_s: 2 ** (-tv / 256), aperture: 2 ** (av / 512), iso: 3.125 * 2 ** (sv / 256) };
    if (s.scene) s.scene.exposure.camera = { shutter_s: this.plan.shutter_s, aperture: this.plan.aperture, iso: this.plan.iso };
    return this.plan;
  }
  // S-DISPFRAME: DISP_FRAME's start on the lab CPU and the TFT channel's face-plane colours (see DF_COLOUR_INIT)
  dispframe_start() {
    const s = this.s, lab = s.lab;
    lab.assume('A19', true, [EVF_CHANNEL, TFT_CHANNEL]);
    lab.wrap(K_CFLUSH, (prev) => (h, r) => (disasm(r.mdr) === DF_FLUSH_RETURN ? h.finish(r) : prev(h, r)), 'K-CFLUSH');
    lab.wrap(OLYTASS, (prev) => (h, r) => (DF_SWAP_SLEEPS.has(disasm(r.mdr)) ? lab._sleep(h, r) : prev(h, r)), 'S-DISPFRAME (swap wait)');
    lab.call(DF_COLOUR_INIT, null, null, null, 2000000);
    for (const [id, at] of DF_SETTINGS) lab.sim.write(at, pack('<I', lab.call(PROP_DATA, { d0: id }, null, null, 5000000).a0 >>> 0));
    const rgb = lab.alloc(new Uint8Array(8), 4), word = lab.alloc(new Uint8Array(4), 4);
    for (let i = 0; i < FACE_COLOURS; i++) {
      lab.call(DF_COLOUR, { d0: i, a0: rgb, a1: rgb + 1, d1: rgb + 2 }, null, null, 200000);
      const [R, G, B] = lab.sim.read(rgb, 3);
      const cr = ((((R << 15) - G * 27440 - B * 5328) >> 16) + 128) & 0xFF;      // 0x501db1c8..0x501db22b
      const cb = (((-11056 * R - 21712 * G + (B << 15)) >> 16) + 128) & 0xFF, y = ((19595 * R + 38470 * G + 7471 * B) >> 16) & 0xFF;
      lab.sim.write(word, pack('<I', (cr << 16) | (cb << 8) | y));
      for (const ch of [EVF_CHANNEL, TFT_CHANNEL]) lab.call(FACE_COLOUR_SET, { d0: ch, d1: i, a0: word }, null, null, 200000);
    }
    lab.sim.write(TFT_FRAME_STATE, Uint8Array.of(0));
    s.settle('S-DISPFRAME start');
    this.df_state = 0;
  }
  // One turn of DISP_FRAME's loop for the flag bits a2 (0x5100d0a5..0x5100d150), its calls native.
  dispframe_turn(a2) {
    const s = this.s, lab = s.lab, pend0 = lab.sim.read(DF_PENDING, 1)[0];
    let d1 = lab.sim.read(DF_MODE, 1)[0];
    if (a2 === 0x80) {
      if ((pend0 & 0x4F) && (d1 & 0x4F)) {
        if (!(~d1 & pend0 & 0x4F)) return;
        a2 &= ~0x80; d1 &= pend0;
      }
    } else if (a2 & 0x80) { d1 &= pend0; a2 &= ~0x80; }
    const pend = d1 & ~((lab.sim.u32(DF_MASK & ~3) >>> 16) >>> 8) & 0xFF;
    lab.sim.write(DF_PENDING, Uint8Array.of(pend));
    const st = lab.call(DF_STATE, null, null, null, 5000000).d0 & 0xFF;
    if (this.df_state !== st && this.df_state) lab.call(DF_ERASE, { d0: this.df_state }, null, null, 20000000);
    this.df_state = st;
    if (!(pend & 0x4F)) lab.call(DF_ERASE, { d0: st }, null, null, 20000000);
    else lab.call(DF_DRAW, { d0: st, d1: a2 }, null, null, 20000000);
    s.settle('S-DISPFRAME');
    this.log.push(['dispframe', `flag ${h8(a2)} pending ${h8(pend)} state ${st}`]);
  }
  // S-TAKEFRAME: the frame display mode the TAKE module sets (0x500256d9), S-SUBJECT's too (its subject bit). A build
  // with no frame plane of this form (fact frame_plane null, src/fw/models.mjs: the E118 family's) is given none
  frame_mode(mode) {
    const s = this.s;
    this.take_mode = mode;
    if (isUnmapped(FRAME_MODE_SET) && fact('frame_plane', null) === null) {
      this.log.push(['takeframe', `none: the build has no frame plane of E143's form (mode ${mode})`]);
      return;
    }
    s.lab.call(FRAME_MODE_SET, { d0: mode }, null, null, 2000000);
    s.settle('S-TAKEFRAME');
    this.drain_cpu3();
  }
  // S-TAKEFRAME's subject bit where MDET_DL runs natively (mdet.mjs S-TAKEMDET calls it at each tick): on while MDET
  // is started and the live scene is shown, as TAKE's live-view request adds its request 1 (I: its conditions, spec
  // U10), so that MDET's UP_FACE posts reach DISP_FRAME (0x50025747 acts only with the bit, D); off otherwise, the
  // frames going with it
  take_subject_frames(on) {
    const want = FRAME_MODE_AF | (on ? FRAME_MODE_SUBJECT : 0);
    if (want !== this.take_mode) this.frame_mode(want);
  }
  // S-AFOSD: the AF module's OSD upload of the indicator and frames (cx, cy, w, h each). A build whose frame plane has
  // no AF upload (fact frame_plane, its mode-3 upload null: E145, src/fw/facts.mjs framePlane), or that has no frame
  // plane of this form (frame_plane null), is given none
  af_upload(indicator, frames) {
    const s = this.s, lab = s.lab;
    if (isUnmapped(AF_UPLOAD) && (fact('frame_plane', null)?.uploads[2] ?? null) === null) {
      this.log.push(['afosd', `none: the frame plane has no AF upload (indicator ${indicator}, ${frames.length} frame(s))`]);
      return;
    }
    const buf = lab.alloc(pack('<' + 'H'.repeat(4 * Math.max(1, frames.length)), ...(frames.length ? frames.flat() : [0, 0, 0, 0])), 4);
    lab.call(AF_UPLOAD, { d0: indicator, d1: frames.length, a0: buf }, null, null, 2000000);
    s.settle('S-AFOSD');
    this.log.push(['afosd', `indicator ${indicator}, ${frames.length} frame(s)`]);
    this.drain_cpu3();
  }
  // S-AFLOCK (TAKE_STATUS_SET's comment): 'ready' at S1 down, before START_FOCUS; 'focus' at END_FOCUS(OK), before
  // its post (the take capability's notifyAFOK comes with the AF module's result, before the application's
  // callback, I); 'release' at S1 up. The take status through its own setter and clear, natively; the AF lock's
  // callback CBS_AF_LOCK (CBS_AF_LOCK's comment) posted after END_FOCUS(OK) with 1 (af_lock_post) and at the release
  // of a lock with 0, while the shooting service runs
  af_lock(stage) {
    if (!this.aflock || (stage === 'release' && this.af_stage === null)) return;
    const lab = this.s.lab;
    if (stage === 'release') {
      if (this.af_stage === 'focus' && this.shooting) this.af_lock_post(0);
      lab.call(TAKE_STATUS_CLEAR, { d0: SEQ_READY | SEQ_READY_FINISH }, null, null, 200000);
      lab.sim.write(TAKE_IS_FOCUS, pack('<I', 0));
      this.af_stage = null;
    } else {
      lab.call(TAKE_STATUS_SET, { d0: stage === 'ready' ? SEQ_READY : SEQ_READY_FINISH }, null, null, 200000);
      if (stage === 'focus') { lab.sim.write(TAKE_IS_FOCUS, pack('<I', 1)); this.aflock_fed += 1; }
      this.af_stage = stage;
    }
    const word0 = lab.call(TAKE_STATUS_GET, { d0: 0 }, null, null, 200000).d0;
    this.log.push(['aflock', `${stage}: take status word 0 ${h8(word0)}, isFocus ${lab.sim.u32(TAKE_IS_FOCUS)}, the AF indicator ${this.af_stage === 'focus' ? AF_INDICATOR_FOCUS : 'native'}`]);
  }
  // S-AFLOCK: CBS_AF_LOCK(locked) through S-RELSEQ's post (the shooting reactive's own, as its "haL" case posts it)
  af_lock_post(locked) {
    const lab = this.s.lab;
    this.log.push(['cbs', `AF_LOCK(${locked})`]);
    lab.call(SHOOT_POST, { a0: this.find_reactive(), d0: CBS_AF_LOCK, d1: locked }, null, null, 50000000);
    this.s.settle('S-AFLOCK AF_LOCK');
  }
  install() {
    this.module_queues = module_queues(this.s.lab.image);
    // with the file system native (storage.mjs) the file module's own task, FILECLBK, takes its queue's requests
    const fileq = this.s.storage ? this.s.storage.f.fileclbk.queue : null;
    if (fileq !== null) this.module_queues.delete(fileq);
    // with UI_OUT run (H-UIOUTSTART, play.mjs) its task answers the requests to its second queue, UI_OUT_EXEC, itself
    // (src/fw/models.mjs ui_out: E143 0x5014f6aa..0x5014f736, E134's init links its counterpart the same way)
    const uioutq = this.s.ui_out_tid ? apiQueues().UI_OUT_EXEC : null;
    if (uioutq !== null) this.module_queues.delete(uioutq);
    // with --audio on AUD_MAIN takes its queue AUD_EXEC natively, synchronous sends included (src/lab/audiohw.mjs
    // H-AUDSTART)
    const audq = this.s.audio_hw ? this.s.audio_hw.exec_queue() : null;
    if (audq !== null) this.module_queues.delete(audq);
    // with the native lens (lens.mjs) LENS_MAIN (E143's task 92) and LENS_COMMAND (task 91) wait on their queues
    // (X: the tasks in the queues' receive-wait lists after the bring-up), so S-MODACK, which takes the message,
    // would take it from them: the two queues leave it; a synchronous send to them still returns E_OK below, the
    // lab's own stand-in refusing it
    if (this.s.lens) for (const q of [apiQueues().LENS_EXEC, apiQueues().LENS_COMMAND]) if (q !== null) this.module_queues.delete(q);
    if (this.s.storage?.f.hls) { this.media = new HlsMedia(this.s, this.s.storage); this.media.install(); }   // its HLS side (card_fs.hls)
    this.s.lab.panel_done = true;                                                  // S-PANELDONE (menu.mjs)
    const lab = this.s.lab;
    lab.xcpu_served.add(CPU3);                                                     // S-CPU3: S-CPU2 leaves bank 3 to drain_cpu3
    if (this.native_tra) lab.dispq_accept(HIST_DONE_SEND);                         // the histogram's cmd 16
    if (this.native_tra) lab.assume('A-VSCHIST-3', true, [0, 1, 2]);              // its registers in a composite
    if (this.native_tra) lab.wrap(OLY_EV_WAIT, (prev) => (h, r) => {                // S-HISTEND
      if (disasm(r.mdr) !== HIST_WAIT_RETURN || !lab.in_display_run()) { prev(h, r); return; }
      const from = `S-HISTEND from ${where(r.mdr)}`, busy = [0, 1, 2].filter((c) => lab.vsc.hist(c).state !== 0);
      if (busy.length > 1) throw new FirmwareError(`${from}: the histogram runs on channels ${busy.join(', ')}`);
      if (!busy.length) {
        // the run has ended: its interrupt or its done callback is still to come, and the wait takes it natively
        const vsc = (c, off) => lab.sim.u32(VSC_CHANNEL[c] + off);
        const irq = [0, 1, 2].some((c) => vsc(c, VSC_INTST1) & vsc(c, VSC_INTEN1) & HIST_END_BIT);
        const u16 = (at) => { const x = lab.sim.read(at, 2); return x[0] | x[1] << 8; };
        const write = u16(DEFER_WRITE);
        let queued = false;
        for (let k = u16(DEFER_READ), n = 0; k !== write && n < DEFER_SLOTS; k = (k + 1) % DEFER_SLOTS, n++) {
          if (lab.sim.u32(DEFER_RING + DEFER_SLOT_BYTES * k) === runtime(HIST_DONE_CALLBACK)) queued = true;
        }
        if (!irq && !queued) throw new FirmwareError(`${from}: no histogram run, no end interrupt and no done callback queued to set the flag`);
        this.log.push(['histend', `DISPLAY cmd 15's histogram wait from ${where(r.mdr)}: the run already ended (${irq ? 'its interrupt' : 'its done callback'} pending)`]);
        prev(h, r);
        return;
      }
      const c = busy[0], n0 = lab.vsc.hist(c).runs, saved = { ...r };
      for (let k = 0; lab.vsc.hist(c).runs === n0; k++) {
        if (k >= HIST_END_FRAMES) throw new FirmwareError(`${from}: the run on channel ${c} did not end in ${k} frames`);
        lab.run_to_frame(c, from);
      }
      this.hist_ends += 1;
      this.log.push(['histend', `DISPLAY cmd 15's histogram wait from ${where(r.mdr)}: the run on channel ${c} ended at lab ${lab.lab_time()} ns`]);
      if (lab.sim.packet('G' + packRegs(saved)) !== 'OK') throw new AssertionError('');
      prev(h, saved);
    }, 'S-HISTEND');
    // the wait's result where it returns (its d0, which cmd 15 does not read) and the lab time, for the record
    if (this.native_tra) lab.observe(HIST_WAIT_RETURN, (l, r) => this.hist_waited.push([r.d0 | 0, l.lab_time()]), 'obs-hist-wait');
    // camapp 3 (TRAACK_KEPT): the receiver substance's send and the remote-call method run natively, not S-RPC
    if (this.native_tra) for (const entries of RPC_ENTRIES) for (const e of entries) {
      if (lab.hooks.get(runtime(e))?.[1] !== 'S-RPC') throw new FirmwareError(`camapp 3: ${h8(e)} is not S-RPC's hook`);
      lab.hooks.delete(runtime(e));
    }
    if (ON_LAB_MODEL && uioutq !== null && !this.components) {                    // S-AFLOCK (TAKE_STATUS_SET's comment)
      this.aflock = true;
      lab.hook(AF_STATE_GET, (h, r) => {                                           // the AF module's state getter
        if (this.af_stage !== 'focus' || !(r.a0 >>> 0)) { lab.passthrough(r); return; }
        lab.sim.write(r.a0 >>> 0, pack('<HHH', AF_INDICATOR_FOCUS, 0, 0));
        h.finish(r);
      }, 'S-AFLOCK');
    }
    lab.dispq_deliver = [];                                                        // S-DISPQ's replies (pump)
    lab.wrap(OLYQEWR, (prev) => (h, r) => {                                         // on top of S-DISPQ's hook
      const q = r.d0 & 0xFFFF;
      if (disasm(r.mdr) === API_SEND_RETURN && this.module_queues.has(q)) {
        const p = lab.sim.u32(r.a0 >>> 0);
        this.acks.push({ q, w: [0, 1, 2, 3].map((k) => lab.sim.u32(p + 4 * k)) });
        h.finish(r, { d0: 0 });                                                    // taken: not left in the queue
        return;
      }
      return prev(h, r);
    }, 'S-MODACK');
    const own = lab._sync_send.bind(lab);
    lab._sync_send = (h, r) => {
      const q = r.d0 & 0xFFFF;
      if (q === fileq || q === uioutq || q === audq) return lab.passthrough(r);   // FILECLBK, UI_OUT and AUD_MAIN reply natively
      if (!this.module_queues.has(q)) {
        try { return own(h, r); } catch (e) { if (!/its receiver does not run in the lab/.test(e.message)) throw e; }
      }
      this.log.push(['sync', `queue ${q} cmd ${r.d1} from ${where(r.mdr)}`]);
      h.finish(r, { d0: 0 });
    };
    const tra = (h, r, calls) => {
      const req = r.a1 >>> 0, b = req ? lab.sim.read(req + 4, 2) : null;
      this.log.push(['tra', `${b ? b[0] | (b[1] << 8) : -1} from ${where(r.mdr)}`]);
      if (b && this.media && (b[0] | (b[1] << 8)) === this.media.f.ctrl.request) this.media.control(req);   // S-MDACTRL
      if (b && this.outdev !== null && !this.native_tra && (b[0] | (b[1] << 8)) === TRA_OUTPUT_DEVICE) {   // S-OUTDEV
        const [device, second, third] = unpack('<3I', lab.sim.read(req + 32, 12));
        if (device !== OUTPUT_HDMI) throw new FirmwareError(`S-OUTDEV: TRA ${TRA_OUTPUT_DEVICE} from ${where(r.mdr)} asks for output device ${device}: only the HDMI output (${OUTPUT_HDMI}) is stood in`);
        this.outdev.push([device, second, third]);
      }
      if (this.play_exec !== null) this.play_answer(this.play_exec);                // S-PLAYSEQ
      this.play_exec = null;
      if (this.native_tra && req && !TRAACK_KEPT.has(b[0] | (b[1] << 8))) { this.tra_through(b[0] | (b[1] << 8), r); return; }   // camapp 3
      if (!req) { if (calls) h.finish_calls(r, { d0: 0 }); else h.finish(r, { d0: 0 }); return; }
      // the request consumed: its vt[1] natively, then 0
      const del = disasm(lab.sim.u32(lab.sim.u32(req) + 4 * REQUEST_DELETE_SLOT));
      this.tra_deleted += 1;
      if (calls) h.finish_calls_after(r, del, { a0: req }); else h.finish_after(r, del, { a0: req });
    };
    // (none on a build whose display sync the rule does not read, src/fw/facts.mjs displaySync)
    const sync = fact('display.sync', DISPLAY_SYNC_E143), rec = sync?.record;
    this.dispsync_fns = sync;
    if (sync) {
      lab.observe(sync.request, (l, r) => {
        const [type, code] = rec ? [unpack('<H', l.sim.read(r.a0 + rec.type, 2))[0], l.sim.u32(r.a0 + rec.device)] : [r.d0 >>> 0, r.d1 >>> 0];
        if (type === (rec?.synced ?? DISPSYNC_REQUEST)) this.dispsync.add(code);
      }, 'S-DISPSYNC');
    }
    lab.observe(SHOOTING_START, () => { this.shooting = true; }, 'S-RELSEQ (shooting service)');
    lab.observe(SHOOTING_END, () => { this.shooting = false; }, 'S-RELSEQ (shooting service end)');
    const fd = fact('func_direct.id', { sp: 28 });
    lab.observe(FUNC_DIRECT_RUN, (l, r) => this.funcs.push(fd.reg ? r[fd.reg] >>> 0 : lab.sim.u32((r.sp >>> 0) + fd.sp)), 'S-RELSEQ function direct');
    lab.hook(TRA_EXEC_CALL, (h, r) => tra(h, r, false), 'S-TRAACK');
    if (this.outdev !== null) lab.observe(OUTDEV_PROP_SET, (l, r) => {               // S-OUTDEV: CapIod's property write
      if ((r.d0 & 0xFFFF) === lab.prop_device && this.outdev_prop !== undefined) this.outdev_prop = r.d1 >>> 0;
    }, 'S-OUTDEV (output-device property)');
    if (this.components) lab.hook(SCPU_STATUS, (h, r) => h.finish(r, { d0: 0 }), 'S-BOOTDONE (sub-CPU status)');
    for (const a of LONG_TIMER_SET) lab.observe(a, (l, r) => {
      const n = r.d0 & 0xFF, ms = r.d1 >>> 0;
      if (ms === 0) this.long_timers.delete(n); else this.long_timers.set(n, l.lab_time() + ms * 1e6);
    }, 'S-LONGTIMER');
    // with the file system native (storage.mjs) the firmware counts the card's remaining shots and movie time itself,
    // and its DCF remain count finds the drive mounted
    const native = !!this.s.storage;
    if (!native) lab.hook(SHOTS_QUERY, (h, r) => {
      const n = Math.max(0, this.card_shots - this.images.length);
      this.log.push(['card', `remaining shots from ${where(r.mdr)}: ${n}`]);
      h.finish(r, { d0: n });
    }, 'S-CARD');
    if (!this.dcf_db()) lab.hook(IMAGE_COUNT, (h, r) => h.finish(r, { d0: (r.d1 >>> 0) === IMAGE_TYPE ? this.card_images() : 0 }), 'S-CARD (images)');
    const mt = MODEL_INFO.dcf_mount_test;                                         // E143's count makes its own
    if (mt && !native) lab.hook(mt.at, (h, r) => {
      const status = r[mt.reg] >>> 0;
      if (!(status & DRIVE_MOUNTED)) {
        r = { ...r, [mt.reg]: (status | DRIVE_ERROR) >>> 0 };
        if (lab.sim.packet('G' + packRegs(r)) !== 'OK') throw new AssertionError('');
        this.log.push(['card', `DCF remain count from ${where(r.mdr)}: drive status ${hex(status)}, not mounted`]);
      }
      lab.passthrough(r);
    }, 'S-CARD (mount test)');
    lab.observe(RSB_EXECUTE, (l, r) => {
      const rsb = r.a0 >>> 0, req = l.sim.u32(rsb + RSB_REQUEST) >>> 0;
      if (!req) return;
      const p = { rsb, id: l.sim.u32(req) >>> 0, notify: l.sim.u32(req + 4) >>> 0, param: l.sim.read(req + 16, 2)[0] | (l.sim.read(req + 17, 1)[0] << 8) };
      this.play_pending.push(p);
      this.play_exec = p;
    }, 'S-PLAYSEQ');
    lab.observe(SYNC_REQUEST, (l, r) => {
      const id = r.d0 >>> 0;
      if (id === SYNC_PLAY_END) this.play_pending.push({ end: true });
      this.play_exec = { sync: id };
    }, 'S-PLAYSEQ (sync)');
    const wrappers = fact('play.wrappers', Object.values(PLAY_COMPONENT).map((entry) => ({ entry }))).map((w) => w.entry);
    const named = new Map(Object.entries(PLAY_COMPONENT).filter(([, at]) => !isUnmapped(at)).map(([name, at]) => [at, name]));
    for (const [at, name] of named) if (!wrappers.includes(at)) throw new FirmwareError(`S-PLAYCOMP: ${name} placed at ${h8(at)}, not a wrapper of the component getter (fact play.wrappers)`);
    for (const at of wrappers) lab.hook(at, (h, r) => this.play_component(named.get(at) ?? `wrapper ${h8(at)}`, h, r), 'S-PLAYCOMP');
    if (!native) lab.hook(MOVIE_TIME_QUERY, (h, r) => {
      const ms = this.recording === null ? 0 : Math.floor((lab.lab_time() - this.recording) / 1e6);
      const left = Math.max(0, CARD_MOVIE_S * 1000 - this.card_used_ms - ms);
      lab.sim.write(r.a0 >>> 0, pack('<IIIIII', left, left, 0, ms, Math.floor(ms / 1000), 0));
      this.log.push(['card', `movie time from ${where(r.mdr)}: ${left} ms left, ${ms} ms recording`]);
      h.finish(r, { d0: 0 });
    }, 'S-CARD (movie time)');
    // S-MOVRATE: the movie record time's division by the movie info's frame rate (fact card.movie_rate,
    // src/fw/facts.mjs movieRate: E118's, which divides without the test E143's time code conversion makes). The rate
    // is the movie recorder's set-up's, 0 until a movie take or a movie's playback, on the camera too
    // (docs/model-survey.md finding 59), and the MN103's DIVU by 0 leaves its quotient undefined
    // (emu/FIDELITY-NOTES.md 3.2): while the rate is 0 the divide is not executed, its quotient taken as 0 (the
    // camera's is ?; MDR, which the function sets again before its next divide, is left), and the record time runs on
    // natively
    const mr = fact('card.movie_rate', null) ?? null;
    if (mr) {
      const o = mr.div - 0x50000000;
      if (lab.image[o] !== 0xF2 || lab.image[o + 1] !== 0x71) throw new FirmwareError(`S-MOVRATE: ${h8(mr.div)} is not divu d0,d1`);
      lab.hook(mr.div, (h, r) => {
        if (lab.sim.read(mr.rate, 1)[0] !== 0) { lab.passthrough(r); return; }
        this.movie_rate_answered += 1;
        if (this.movie_rate_answered === 1) this.log.push(['card', `movie record time's divu at ${where(r.pc)}: frame rate 0, quotient 0 (dividend ${hex(r.d1)})`]);
        if (lab.sim.packet('G' + packRegs({ ...r, d1: 0, pc: (r.pc + 2) >>> 0, fault: 0 })) !== 'OK') throw new AssertionError('');
        lab.passthrough(r);
      }, 'S-MOVRATE');
    }
    lab.hook(TRA_EXEC_CALLS, (h, r) => tra(h, r, true), 'S-TRAACK (calls)');
    lab.assume('A20', true);                                                       // playback's entry writes HILIGHT1 = 0
    lab.observe(AUTO_THROUGH, (l, r) => this.s.scene_through?.((r.d0 >>> 0) !== 0), 'S-THROUGH');
    lab.hook(OUTPUT_DISPLAY, (h, r) => {
      if (this.s.device === 'evf') h.finish(r, { d0: OUTPUT_INTERNAL_EVF }); else lab.passthrough(r);
    }, 'S-OUTDISP');
    // with S-NVRAM the save runs natively down to the NAND write (menu.mjs), which keeps the store for the next session
    if (!lab.env.nvram) lab.hook(SET_SAVE, (h, r) => {
      if (!SET_SAVE_RETURNS.has(disasm(r.mdr))) throw new FirmwareError(`S-SETSAVE: 0x500421cd called from ${where(r.mdr)}; only the menu close (return 0x503f01a4) is listed`);
      this.log.push(['setsave', `settings save from ${where(r.mdr)} skipped`]);
      h.finish(r, { d0: 0 });
    }, 'S-SETSAVE');
    // a later model's save of its whole state block to flash (knob block_save): skipped the same way, from its
    // listed callers only
    const bs = knob('block_save', undefined);
    if (bs) lab.hook(bs.fn, (h, r) => {
      if (!bs.returns.includes(disasm(r.mdr))) throw new FirmwareError(`S-SETSAVE: the block save ${hex(bs.fn)} called from ${where(r.mdr)}, not a listed caller`);
      this.log.push(['setsave', `block save from ${where(r.mdr)} skipped`]);
      h.finish(r, { d0: 0 });
    }, 'S-SETSAVE (block)');
    lab.hook(PHASE_QUERY, (h, r) => {
      if (this.movie_phase === null) lab.passthrough(r); else h.finish(r, { d0: this.movie_phase });
    }, 'S-RELSEQ (shooting phase)');
    // the TAKE probe (take.mjs, --take probe): TAKE_FUNC's queue leaves S-MODACK, S-TAKEREQ on top of its hooks
    if ((this.s.opts.take ?? 'stand-in') === 'probe') { this.take = new TakeProbe(this.s, this); this.take.install(); }
  }
  // S-MODACK: the replies, each followed by a settle (a reply can bring the next request); S-DISPSYNC's releases;
  // S-DISPQ's replies to the application's queue.
  pump() {
    const s = this.s, lab = s.lab, dq = lab.dispq_deliver ?? [];
    for (let n = 0, m = 0, k = 0, d = 0, t = 0; dq.length || this.acks.length || this.play_pending.length || this.dispsync.size || this.take?.pending.length;) {
      if (this.take?.pending.length) {                                             // S-TAKEREQ's replies (take.mjs)
        if (++t > 200) throw new FirmwareError(`S-TAKEREQ: more than 200 replies in one step (${this.take.pending.length} pending)`);
        this.take.deliver();
        continue;
      }
      if (dq.length) {
        if (++d > 200) throw new FirmwareError(`S-DISPQ: more than 200 DISPLAY replies in one step (${dq.length} pending)`);
        const { q, msg } = dq.shift();
        this.log.push(['dispq', `DISPLAY reply [${[...msg].map((b) => b.toString(16).padStart(2, '0')).join('')}] -> queue ${q}`]);
        const desc = lab.alloc(pack('<II', lab.alloc(msg, 4), msg.length), 4);
        lab.call(OLYQEWR, { d0: q, d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000);
        s.settle('S-DISPQ reply');
        continue;
      }
      if (this.dispsync.size) {
        if (++k > 20) throw new FirmwareError(`S-DISPSYNC: more than 20 releases in one step (devices ${[...this.dispsync].join(', ')})`);
        const [code] = this.dispsync;
        this.dispsync.delete(code);
        this.dispsync_released += 1;
        const { sync_set: set, image_sync: image, kind, panels, record: rec } = this.dispsync_fns;
        this.log.push(['dispsync', `sync words cleared, image sync kind ${kind} for device ${code}`]);
        for (const panel of panels) lab.call(set, { d0: DISPSYNC_OFF, d1: panel }, null, null, 2000);
        if (rec) {
          const b = new Uint8Array(DISPSYNC_RECORD), dv = new DataView(b.buffer);
          dv.setUint16(rec.code_at, rec.code, true); dv.setUint32(rec.device_at, code, true);
          lab.call(image, { a0: lab.alloc(b, 4) }, null, null, 2000000);
        } else lab.call(image, { d0: kind, d1: code, a0: DISPSYNC_IMAGE }, null, null, 2000000);
        s.settle('S-DISPSYNC');
        continue;
      }
      if (this.acks.length) {
        if (++n > 200) throw new FirmwareError(`S-MODACK: more than 200 module requests in one step (${this.acks.length} pending)`);
        const { q, w } = this.acks.shift();
        this.log.push(['ack', `queue ${q} [${w.map(h8).join(' ')}] -> queue ${w[0]}`]);
        const payload = lab.alloc(pack('<III', 0, w[1], w[3]), 4);
        const desc = lab.alloc(pack('<II', payload, 12), 4);
        lab.call(OLYQEWR, { d0: w[0], d1: 0xFFFFFFFF, a0: desc }, null, null, 2000000);
        s.settle('S-MODACK reply');
        continue;
      }
      if (++m > 50) throw new FirmwareError(`S-PLAYSEQ: more than 50 play requests in one step (${this.play_pending.length} pending)`);
      this.play_finish(this.play_pending.shift());
    }
    while (this.outdev?.length) this.output_device(this.outdev.shift());           // S-OUTDEV
    // camapp 3: the component's own TRA 588 opened the HDMI device (X); its channel then runs at the format table's
    // timing (DisplayLab.hdmi_line), the harness rule S-OUTDEV's open follows too
    if (this.native_tra && MODEL === 'E143' && !lab.line_ns.has('hdmi') && (lab.sim.u32(OPENED_WORD) & HDMI_MASK)) {
      this.log.push(['outdev', `HDMI open (camapp 3): ${JSON.stringify(lab.hdmi_line(lab.sim.u32(OPENED_WORD) & HDMI_MASK))}`]);
    }
    if (this.media && this.media.busy()) {                                         // S-MDACTRL / S-MEDIA (media.mjs)
      this.media.tick();
      for (const [k, d] of this.media.take_log()) this.log.push([`media ${k}`, d]);
      if (lab.dispq_deliver?.length || this.acks.length || this.play_pending.length || this.dispsync.size) this.pump();
    }
  }
  // camapp 3 (TRAACK_KEPT): the transaction handed to the exec natively; the exec's result recorded at its return
  // address, where no other hook sits, first in first out per address (two tasks' sends from one site that return in
  // the other order would swap their results; none seen)
  tra_through(id, r) {
    const lab = this.s.lab, ra = r.mdr >>> 0, rec = [id, where(r.mdr), null];
    this.tra_native.push(rec);
    if (this.tra_native.length > TRA_NATIVE_LOG) this.tra_native.shift();
    let ret = this.tra_returns.get(ra);
    if (ret === undefined && !lab.hooks.has(ra)) {
      ret = [];
      this.tra_returns.set(ra, ret);
      lab.hook_rt(ra, (h, rr) => { const x = ret.shift(); if (x) x[2] = rr.d0 >>> 0; lab.passthrough(rr); }, 'camapp 3 (TRA result)');
    }
    if (ret) ret.push(rec);
    lab.passthrough(r);
  }
  // S-OUTDEV: the component's event 224 built by its own constructor and made CapIod's current event, then its
  // dispatchEvent natively, as its OXF thread would (S-BOOTDONE's way); CapIod opens the device from there
  output_device([device, second, third]) {
    const lab = this.s.lab, iod = lab.call(IOD_INSTANCE, {}).a0 >>> 0, st = lab.sim.u32(iod + RX_STATE);
    if (st !== IOD_STATE_READY) throw new FirmwareError(`S-OUTDEV: CapIod ${h8(iod)} in state ${st}, not ${IOD_STATE_READY} (where it takes event 224)`);
    const ev = lab.alloc(new Uint8Array(IOD_EVENT_BYTES), 4);
    lab.call(IOD_EVENT_NEW, { a0: ev, d0: device, d1: second, a1: third }, null, null, 20000);
    const dispatch = lab.sim.u32(lab.sim.u32(iod) + 4 * RX_DISPATCH_SLOT), old = lab.sim.u32(iod + RX_EVENT);
    lab.sim.write(iod + RX_EVENT, pack('<I', ev));
    this.log.push(['outdev', `TRA ${TRA_OUTPUT_DEVICE}: event 224 {${device}, ${second}, ${third}} to CapIod ${h8(iod)}`]);
    this.outdev_prop = null;
    try { lab.calls(disasm(dispatch), { a0: iod }, undefined, undefined, 500000000); } finally { lab.sim.write(iod + RX_EVENT, pack('<I', old)); }
    this.outdev_done.push([device, second, lab.sim.u32(iod + RX_STATE)]);
    // S-PROP follows the output-device property CapIod wrote (X: 16 for HDMI, 0x50bea474), so that the application's
    // reads of it at S-PROP's sites see the device the firmware opened, not the lab's last open
    if (this.outdev_prop !== null) {
      lab.props.set(lab.prop_device, this.outdev_prop);
      this.log.push(['outdev', `S-PROP: property ${lab.prop_device} = ${this.outdev_prop}, as CapIod wrote it`]);
    }
    this.outdev_prop = undefined;
    // the HDMI channel runs once the device is open (DisplayLab.hdmi_line: the firmware's format table's timing)
    const opened = lab.sim.u32(OPENED_WORD);
    if (opened & HDMI_MASK) this.log.push(['outdev', `HDMI open: mask ${h8(opened)}, ${JSON.stringify(lab.hdmi_line(opened & HDMI_MASK))}`]);
    this.s.settle('S-OUTDEV');
  }
  // S-CARD: whether the firmware's own DCF database holds the pictures: where REC's recorder records them (storage.mjs
  // record(): the build's recorder read, fact 'recorder'), its registration counts each in the same session, and the
  // media API's image count (IMAGE_COUNT) and each picture's folder and number are the database's (S-CARD's image
  // count and list retired there); this.images keeps the lab's record of each capture
  dcf_db() { return !!this.s.storage?.f.recorder; }
  // S-CARD: the pictures on the card (none while it is out of the slot or not mounted): with the DCF database its count
  // of type 1 in the first slot, read where the media API's getter reads it (fact dcf.counts: the table of 52 bytes a
  // slot, +4 + 4 * type), else S-CARD's list's
  card_images() {
    if (this.s.storage && !this.s.storage.mounted) return 0;
    return this.dcf_db() ? this.s.lab.sim.u32(DCF_COUNTS + 4 + 4 * IMAGE_TYPE) >>> 0 : this.images.length;
  }
  // S-PLAYSEQ: the card's pictures in the order the play module gives them, {folder, number}: with the DCF database
  // its fnode of each index (storage.mjs fnode), else S-CARD's list
  card_list() {
    if (!this.dcf_db()) return this.images;
    const n = this.card_images(), out = [];
    for (let i = 1; i <= n; i++) {
      const p = this.s.storage.fnode(i);
      if (p === null) throw new FirmwareError(`S-PLAYSEQ: the DCF database counts ${n} pictures and has no fnode of index ${i}`);
      out.push(p);
    }
    return out;
  }
  // S-PLAYCOMP: the image shown: the lab's record of its capture where the session took it, else its folder and number
  shown() {
    const p = this.play_cur === null ? null : this.play_list[this.play_cur] ?? null;
    return p && (this.images.find((im) => im.folder === p.folder && im.number === p.number) ?? p);
  }
  // S-CARD, after a format from the menu (media.mjs S-MDACTRL): the card's pictures are gone
  card_formatted() {
    this.log.push(['card', `formatted: ${this.images.length} image(s) gone`]);
    this.images = [];
    this.play_list = [];
    this.play_cur = null;
  }
  // S-PLAYSEQ: one play request finished as the play module would (an asynchronous request through its notify), or
  // the end of the play service
  play_finish(p) {
    const s = this.s, lab = s.lab;
    if (p.end) {
      this.log.push(['play', 'endPlayService']);
      this.play_cur = null;
      s.scene_playview?.(null);                                                     // S-PLAYVIEW
      return;
    }
    if (p.id === PLAY_START) {
      this.play_list = this.card_list();
      this.play_cur = this.play_list.length ? this.play_list.length - 1 : null;
      lab.call(SYNC_RESPONSE_GET, null, null, null, 2000000);                      // the response block, as its first reader makes it
    }
    this.log.push(['play', `request ${p.id} finished`]);
    if (p.id === PLAY_MOVE) lab.sim.write(MOVE_STATE, pack('<H', 0));             // S-PLAYCOMP: the move completes
    const result = lab.alloc(new Uint8Array(4), 4);
    lab.sim.write(SP + 4, new Uint8Array(4));                                       // the notify's stack argument
    lab.calls(disasm(p.notify), { a0: result, a1: p.rsb, d0: p.id, d1: NOTIFY_DONE }, undefined, undefined, 50000000);
    s.settle(`S-PLAYSEQ ${p.id}`);
    if ((p.id === PLAY_SINGLE_FRAME || p.id === PLAY_MOVE) && this.play_cur !== null) s.scene_playview?.(this.views.get(this.shown().release) ?? false);
  }
  // S-PLAYSEQ: the play module's answer to a request while the transaction runs (in S-TRAACK's exec): a synchronous
  // request's response (the PlyComSyncRsb response block, *SYNC_RESPONSE), an asynchronous one's first notification
  // (kind 1: its data copied into the waiting result's buffer, *(*RSB_RESULT + 8), 0x50ad3d95), written as the notify
  // would write them. canMoveCurrent (sync 344, direction u16 at +0 of its parameters): +8 1 (it can: the images
  // wrap around, I), +16 0 (no page change); moveCurrent (9, direction u16 at +16 of the request: 3 left, 4 right):
  // the move result at +4 of the data (MOVE_RESULT, I), and the image shown moves. getNumber (sync 5), which
  // OlyHfwOpePlyCom::getNumber sends where it asks no play component (E143 with its mode word at 3, the E118 family
  // always, D; the addresses in docs/model-survey.md finding 52): +4 the image's index, +8 its file number, +10 its
  // folder (u16), as both read them back (D); the index counts from 1 as the component's getNumber does (I).
  // getStillInfo (sync 3), which PlyCom sends where it asks no component as getNumber: still_record. getHistogram (sync
  // 7): an empty histogram, its flag bytes and bins 0 (HISTOGRAM): the module would count the decoded picture's
  // levels, which the lab does not decode (I); unanswered, the GUI drew whatever the last answer left in the block as
  // bars (X: the E118 family's INFO after getNumber's index at +4).
  play_answer(p) {
    const lab = this.s.lab, n = this.play_list.length;
    if (p.sync === SYNC_GET_NUMBER) {
      const res = lab.sim.u32(SYNC_RESPONSE) >>> 0, img = this.shown();
      if (!res) throw new FirmwareError('S-PLAYSEQ: getNumber before the response block exists');
      lab.sim.write(res + 4, pack('<IHH', img ? this.play_cur + 1 : 0, img ? img.number : 0, img ? img.folder : 0));
      this.log.push(['play', `getNumber: ${img ? `image ${this.play_cur + 1}, ${img.folder}-${String(img.number).padStart(4, '0')}` : 'no image'}`]);
    } else if (p.sync === SYNC_STILL_INFO) {
      const res = lab.sim.u32(SYNC_RESPONSE) >>> 0, img = this.shown();
      if (!res) throw new FirmwareError('S-PLAYSEQ: getStillInfo before the response block exists');
      this.still_record(res, img, 'play');
    } else if (p.sync === SYNC_HISTOGRAM) {
      const res = lab.sim.u32(SYNC_RESPONSE) >>> 0;
      if (!res) throw new FirmwareError('S-PLAYSEQ: getHistogram before the response block exists');
      for (const at of HISTOGRAM.flags) lab.sim.write(res + at, Uint8Array.of(0));
      for (const at of HISTOGRAM.bins) lab.sim.write(res + at, new Uint8Array(HISTOGRAM.bin_bytes));
    } else if (p.sync === SYNC_CAN_MOVE) {
      const res = lab.sim.u32(SYNC_RESPONSE) >>> 0;
      if (!res) throw new FirmwareError('S-PLAYSEQ: canMoveCurrent before the response block exists');
      lab.sim.write(res + 8, pack('<III', n > 1 ? 1 : 0, 0, 0));
    } else if (p.id === PLAY_MOVE && this.play_cur !== null && n) {
      const step = p.param === MOVE_RIGHT ? 1 : p.param === MOVE_LEFT ? -1 : 0;
      this.play_cur = (this.play_cur + step + n) % n;
      const wait = lab.sim.u32(RSB_RESULT) >>> 0;
      if (wait) lab.sim.write((lab.sim.u32(wait + 8) >>> 0) + 4, pack('<I', MOVE_RESULT));
      this.log.push(['play', `moveCurrent ${p.param}: image ${this.play_cur + 1} of ${n}`]);
    }
  }
  // S-CARD: S-SCENE's view of the capture (its scene, time and exposure) at the S2 down of a release
  card_view(view) {
    if (this.view_release === null) return;        // an S2 that released nothing (playback)
    this.views.set(this.view_release, view);
    this.view_release = null;
  }
  // S-PLAYCOMP: one of OlyHfwOpePlyCom's calls into the play component, for the image shown
  play_component(name, h, r) {
    const lab = this.s.lab, img = this.shown();
    const put = (at, fmt, ...v) => lab.sim.write(at >>> 0, pack(fmt, ...v));
    if (name === 'getNumber') {                    // a1 index, d0 file number, d1 folder (0x50acf1a8 -> 0x50c4680f)
      put(r.a1, '<I', img ? this.play_cur + 1 : 0); put(r.d0, '<I', img ? img.number : 0); put(r.d1, '<I', img ? img.folder : 0);
    } else if (name === 'getStillInfo' && img) {   // a1 the struct (the component's vt+240)
      this.still_record(r.a1 >>> 0, img, 'playcomp');
    } else if (!['get_img_type', 'isRecording', 'isProtect', 'getStillInfo'].includes(name)) {
      this.log.push(['playcomp', `${name} from ${where(r.mdr)}: not modelled, 0`]);
    }
    h.finish(r, { d0: 0 });
  }
  // S-PLAYCOMP / S-PLAYSEQ: the still information of the image shown (img; null: none, all 0) at info, in the
  // converter's layout (STILL, fact play.still), from the picture's own record (S-CARD's, kept at its capture): the
  // date the camera's clock gave (S-CARD's clock(): the firmware's own read, each build's default while the clock is
  // not set, X), the size of its file's JPEG (S-RECFILE's, the frame the lab encodes), its exposure time (S-SCENE's at
  // the capture; the release's, DEFAULT_SHUTTER_S, without it), with S-SCENE's capture its f-number, bias and ISO, and
  // the lens's focal length at the capture in tenths of a mm (S-CARD's lens_focal: S-LENS's zoom step or the native
  // lens's). A field the image does not have is 0: the date where the read is not placed, the size of a picture with
  // no file (no file system), the focal length with no lens (a built-in lens's is not read), the f-number, bias and
  // ISO without S-SCENE's capture; the focal length and ISO are left out where the rule reads no layout (fact
  // play.still null, logged). Written alike in the component's struct (S-PLAYCOMP: E143's, E146's, E147's and the
  // E144 family's PlyCom; before 2026-11-02 the size 5184 x 3888 and the exposure alone, no date or focal length, X)
  // and in the play module's response block (S-PLAYSEQ: the E118 family's), which every synchronous answer shares
  // (getNumber's +4..+11, canMoveCurrent's +8..+19): each field whole. kind: the log's key. (The ISO was E143's u32
  // +100 on every body before 2026-10-31, a field the E144 family's converters read as another, X: finding 58.)
  still_record(info, img, kind) {
    const lab = this.s.lab, layout = fact('play.still', STILL_E143) ?? null;
    const put = (at, fmt, ...v) => lab.sim.write(at >>> 0, pack(fmt, ...v));
    const cap = img ? this.views.get(img.release)?.capture ?? null : null, t = cap ? cap.shutter_s : DEFAULT_SHUTTER_S;
    const date = img?.clock?.date ?? [0, 0, 0, 0, 0, 0], size = img?.size ?? [0, 0];
    put(info + STILL.date, '<HBBBBBB', ...date, 0);
    put(info + STILL.size, '<HH', ...size);
    put(info + STILL.exp_time, '<II', ...(!img ? [0, 0] : t >= 1 ? [Math.round(t * 10), 10] : [1, Math.round(1 / t)]));
    put(info + STILL.f_number, '<II', ...(cap ? [Math.round(cap.aperture * 10), 10] : [0, 0]));
    put(info + STILL.exp_bias, '<iI', ...(cap ? [Math.round(cap.ev_offset * 10), 10] : [0, 0]));
    if (layout === null) this.log.push([kind, 'still information: the build\'s converter is of a form the rule does not read (fact play.still null): no focal length or ISO']);
    else {
      put(info + layout.focal.at, layout.focal.size === 2 ? '<H' : '<I', img?.focal_mm ? Math.round(img.focal_mm * 10) : 0);
      put(info + layout.iso.at, layout.iso.size === 2 ? '<H' : '<I', cap ? cap.iso : 0);
    }
    this.log.push([kind, `getStillInfo: ${img ? `image ${this.play_cur + 1}, ${date.join('-')} (clock status ${img.clock?.status ?? '-'}), ${size.join('x')}, ${img.focal_mm ?? '-'} mm` : 'no image'}`]);
  }
  // S-RELSEQ
  // S-CPU3: ring [3][0]'s entries (function, argument) taken off in order and the bank-3 doorbell acknowledged, each
  // by its function: DISP_FRAME's remote call (0x5002587a) adds its bits for one turn of DISP_FRAME after the drain
  // (S-DISPFRAME), MDET's post (src/fw/models.mjs mdet.post.fn) runs CPU 3's side at once (S-MDETDL, mdet.mjs); any
  // other function is an error. nested: the drain runs inside a harness call (the MDET poster's return path), where
  // DISP_FRAME's turn, a harness call of its own, would reuse that call's stack: its bits wait for the next drain
  drain_cpu3(nested = false) {
    const lab = this.s.lab, intc = lab.nk.intc;
    if (intc === null || (!intc.ipi_pending(CPU3) && !this.df_bits)) return;   // nothing posted, nothing left
    const [wp, rp, ring, bit] = lab.ipi_desc(CPU3, 0);
    const mdetFn = this.mdet ? runtime(this.mdet.f.post.fn) : null;
    let bits = this.df_bits;
    this.df_bits = 0;
    while (intc.ipi_pending(CPU3)) {
      // the entries posted so far taken off and the doorbell acknowledged, then each served (an MDET post's service
      // may post more: the next round takes those)
      const w = lab.sim.read(wp, 1)[0], entries = [];
      for (let k = lab.sim.read(rp, 1)[0]; k !== w; k = (k + 1) % 32) entries.push([k, lab.sim.u32(ring + 8 * k), lab.sim.u32(ring + 8 * k + 4)]);
      lab.sim.write(rp, Uint8Array.of(w));
      intc.ipi_request(CPU3, 0, bit);
      for (const [k, fn, arg] of entries) {
        if (fn === runtime(CPU3_REMOTE_CALL)) {
          this.log.push(['cpu3', `remote call argument ${h8(arg)}`]);
          bits |= arg & 0xFF;
        } else if (fn === mdetFn) {
          this.log.push(['cpu3', `MDET post ${h8(arg)}`]);
          this.mdet.serve(arg);                                                     // S-MDETDL
        } else if (this.mdet?.event_fn(fn)) {
          this.log.push(['cpu3', `MDET event ${h8(fn)} ${h8(arg)}`]);
          this.mdet.serve(arg, this.mdet.event_fn(fn));                             // S-MDETDL
        } else {
          throw new FirmwareError(`S-CPU3: ring [3][0] entry ${k}: function ${h8(fn)}, not DISP_FRAME's ${h8(runtime(CPU3_REMOTE_CALL))}${mdetFn === null ? '' : ` or MDET's ${h8(mdetFn)}`}`);
        }
      }
    }
    if (bits && nested) this.df_bits = bits;
    else if (bits) this.dispframe_turn(bits);                                      // S-DISPFRAME
  }
  // S-BOOTDONE: the reactives of BOOT_OBJECTS on the HLS heap (vtable word at their start)
  boot_objects() {
    const lab = this.s.lab, heap = lab.sim.read(HLS_HEAP, HLS_HEAP_END - HLS_HEAP);
    const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength), out = [];
    const want = new Map(BOOT_OBJECTS.map((b) => [b[1], b]));
    for (let o = 0; o + 4 <= heap.length; o += 4) { const b = want.get(dv.getUint32(o, true)); if (b) out.push([b, HLS_HEAP + o]); }
    return out;
  }
  // One event (an object of the event class's vtable with its id at +4) made the reactive's current event and
  // dispatched (its dispatchEvent), as its OXF thread would; then a settle.
  dispatch(obj, dispatch_fn, [vt, id]) {
    const lab = this.s.lab;
    const ev = lab.alloc(new Uint8Array(64), 4);
    lab.sim.write(ev, pack('<IH', vt, id));
    const old = lab.sim.u32(obj + RX_EVENT);
    lab.sim.write(obj + RX_EVENT, pack('<I', ev));
    lab.calls(dispatch_fn, { a0: obj }, undefined, undefined, 200000000);
    lab.sim.write(obj + RX_EVENT, pack('<I', old));
    this.s.settle(`S-BOOTDONE ${id}`);
  }
  boot_done() {
    const lab = this.s.lab;
    if (!this.components || this.native_tra || this.boot_finished) return;      // camapp 3: the firmware's own 415 / 420
    for (let n = 0; n < 8; n++) {
      let did = false;
      for (const [[name, , disp], o] of this.boot_objects()) {
        const st = lab.sim.u32(o + RX_STATE);
        if (st === 3) { this.dispatch(o, disp, EV_BOOT_DONE); this.log.push(['boot', `${name} ${h8(o)}: 415 -> state ${lab.sim.u32(o + RX_STATE)}`]); did = true; }
        else if (st === 11 && name === 'Cab_CameraBase' && !this.shoot_mode) {
          this.shoot_mode = true;
          this.dispatch(o, disp, EV_SHOOT_MODE); this.log.push(['boot', `${name} ${h8(o)}: 420 -> state ${lab.sim.u32(o + RX_STATE)}`]); did = true;
        }
      }
      if (!did) break;
    }
    const cat = this.boot_objects().find(([[name], o]) => name === 'CtgStl_StillImageShooting' && lab.sim.u32(o + RX_STATE) !== 3);
    if (cat) this.boot_finished = true;
  }
  find_reactive() {
    if (this.reactive !== null) return this.reactive;
    const lab = this.s.lab, heap = lab.sim.read(HEAP, HEAP_END - HEAP);
    const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
    for (let o = 0; o + 4 <= heap.length; o += 4) {
      if (dv.getUint32(o, true) === SHOOT_REACTIVE_VT) return (this.reactive = HEAP + o);
    }
    throw new FirmwareError(`S-RELSEQ: the HLS shooting reactive (vtable ${h8(SHOOT_REACTIVE_VT)}) is not on the heap`);
  }
  post(name, param = 0) { this.post_all([[name, param]]); }
  // S-RELSEQ's callbacks [name, param], posted one after another before one settle: the callbacks due at one lab time
  // reach the application's queue together, as the modules' notifications would while it runs. E145's application
  // defers the GUI's event 19 while its release runs, its state table answering it by posting it to itself again,
  // until END_SHOOTING_PICTURE ends the state; posted only after END_EXPOSE's settle, that callback never came and
  // the deferral spun (docs/model-survey.md finding 22)
  post_all(list) {
    const s = this.s, lab = s.lab;
    for (const [name, param] of list) {
      this.log.push(['cbs', `${name}(${param})`]);
      if (Object.hasOwn(MOVIE_PHASE, name)) this.movie_phase = MOVIE_PHASE[name];
      lab.call(SHOOT_POST, { a0: this.find_reactive(), d0: CBS[name], d1: param }, null, null, 50000000);
    }
    s.settle(`S-RELSEQ ${list.map(([name]) => name).join(', ')}`);
    this.pump();
    for (const [name] of list) {
      if (name === 'START_RECVIEW' || name === 'END_RECVIEW') s.scene_recview?.(name === 'START_RECVIEW');   // S-RECVIEW
      if (name === 'END_SHOOTING_PICTURE' && s.storage && !s.storage.mounted) {      // S-CARD: no card mounted
        this.log.push(['card', 'no card mounted: no image, no file']);
      } else if (name === 'END_SHOOTING_PICTURE') {                                   // S-CARD
        // the camera's clock and the lens's focal length at the capture (S-PLAYSEQ's still information)
        const img = { folder: CARD_FOLDER, number: this.images.length + 1, release: this.release, clock: this.clock(), focal_mm: this.lens_focal() };
        this.images.push(img);
        if (s.storage) {                                                               // S-RECFILE (storage.mjs)
          const frame = s.picture_frame(this.views.get(img.release) ?? null);
          img.file = s.storage.write_picture(jpegOfFrame(frame));
          img.folder = img.file.folder; img.number = img.file.number;                 // its DCF name's numbers
          img.size = [frame[0], frame[1]];                                              // the JPEG's own size
        }
        this.log.push(['card', `image ${img.folder}-${String(img.number).padStart(4, '0')} saved`]);
        if (img.file) this.log.push(['card', `file ${img.file.path}, ${img.file.size} bytes`]);
      }
    }
  }
  at(delay_ns, name, param = 0) { this.timed.push([this.s.lab.lab_time() + delay_ns, name, param]); this.timed.sort((a, b) => a[0] - b[0]); }
  // After the session's key step: the release sequence for the shutter stages that went down in it, and a recording
  // started or ended by the application's RECORDING_MOVIE.
  // shooting: whether the shooting service ran as the key went down (S1 in playback ends it and starts the service).
  key(downs, rec_down = false, ups = [], shooting = this.shooting) {
    const sc = this.s.scene, live = sc !== null && sc.liveview;
    if (ups.includes('s1')) this.af_lock('release');   // S-AFLOCK: also when S1 goes up in playback
    if (!shooting) {                               // playback: the modules see no release
      if (downs.length) this.log.push(['cbs', `${downs.join(', ')} down without the shooting service: no release`]);
      downs = []; ups = [];
    }
    if (downs.includes('s1')) {
      this.af_lock('ready');                                                         // S-AFLOCK: the sequence's READY
      this.post('START_FOCUS');
      const ok = !(live && SC.focusAt(sc, this.s.lab.lab_time() / 1e9) === null);
      if (ok) this.af_lock('focus');                                                 // S-AFLOCK: the AF lock
      this.post('END_FOCUS', ok ? 1 : 0);
      if (ok && this.af_stage === 'focus') this.af_lock_post(1);                      // S-AFLOCK: the AF lock's callback
      if (ok) this.af_upload(INDICATOR_FOCUS, [AF_FRAME]); else this.af_upload(INDICATOR_NO_FOCUS, []);   // S-AFOSD
    }
    if (ups.includes('s1')) this.af_upload(0, []);
    if (downs.includes('s2')) {
      this.release += 1;
      this.view_release = this.release;
      this.post('START_SHOOTING_PICTURE');
      this.post('START_EXPOSE');
      const t = live ? SC.exposureOf(sc).shutter_s : DEFAULT_SHUTTER_S;
      this.shutter_sound?.open(this.s.lab.lab_time());                             // S-SHUTTERSND: the exposure starts
      this.at(t * 1e9, 'END_EXPOSE');
      this.at(t * 1e9, 'END_SHOOTING_PICTURE');
      this.at(t * 1e9, 'START_RECVIEW');
      this.at(t * 1e9 + RECVIEW_NS, 'END_RECVIEW');
      this.at(t * 1e9 + RECVIEW_NS, 'START_THROUGH_IMAGE_PROCESS');
      this.tick();
    }
    for (const f of this.funcs) this.log.push(['func', `function direct ${f}`]);
    if (this.recording !== null && (rec_down || this.funcs.includes(FUNC_RECORDING_MOVIE))) {
      this.card_used_ms += Math.floor((this.s.lab.lab_time() - this.recording) / 1e6);
      this.recording = null;                       // the movie key ends a recording (the application leaves it below)
      this.timed = this.timed.filter(([, n]) => n !== 'UPDATE_SHOOTING_TIME');
      for (const n of ['STOP_SHOOTING_MOVIE', 'END_RECORDING_MOVIE']) this.post(n);
    } else if (this.funcs.includes(FUNC_RECORDING_MOVIE)) {
      for (const n of ['START_READY_MOVIE', 'END_READY_MOVIE', 'START_SHOOTING_MOVIE', 'START_RECORDING_MOVIE']) this.post(n);
      this.recording = this.s.lab.lab_time();
      this.at(1e9, 'UPDATE_SHOOTING_TIME', 1);
    }
    this.funcs = [];
  }
  // After lab time passed (an idle slice, a step): the replies, and every timed post that is due.
  tick() {
    this.pump();
    const t = this.s.lab.lab_time();
    for (const [n, due] of [...this.long_timers].sort((a, b) => a[1] - b[1])) {
      if (due > t) continue;
      this.long_timers.delete(n);
      this.log.push(['timer', `long timer ${h8(LONG_TIMER_EVENT | n)} ran out`]);
      this.s.lab.call(MODULE_EVENT_PUBLISH, { d0: LONG_TIMER_EVENT | n, d1: 0 }, null, null, 50000000);
      this.s.settle('S-LONGTIMER');
      this.pump();
    }
    this.boot_done();
    this.drain_cpu3();
    const now = this.s.lab.lab_time();
    while (this.timed.length && this.timed[0][0] <= now) {
      const due = this.timed[0][0], batch = [];
      while (this.timed.length && this.timed[0][0] === due) batch.push(this.timed.shift());
      if (this.shutter_sound && batch.some(([, name]) => name === 'END_EXPOSE')) this.shutter_sound.close(due);   // S-SHUTTERSND: it ends
      this.post_all(batch.map(([, name, param]) => [name, param]));
      for (const [, name, param] of batch) if (name === 'UPDATE_SHOOTING_TIME' && this.recording !== null) this.at(1e9, name, param + 1);
    }
    if (this.mdet) this.mdet.tick();                                                // S-TAKEMDET, S-TAKEFRAME's subject bit
    else this.subject?.tick();                                                      // S-SUBJECT
  }
  take_log() { const out = this.log; this.log = []; if (this.take) for (const [k, d] of this.take.take_log()) out.push([`take ${k}`, d]); return out; }
  status() {
    return { started: this.started, recview_pending: this.timed.some(([, n]) => n === 'END_RECVIEW'), pending: this.timed.map(([, n]) => n),
      recording_s: this.recording === null ? null : +((this.s.lab.lab_time() - this.recording) / 1e9).toFixed(1),
      card_used_s: +(this.card_used_ms / 1000).toFixed(1), card_images: this.card_images(),
      components: this.native_tra ? this.boot_objects().some(([[name], o]) => name === 'CtgStl_StillImageShooting' && this.s.lab.sim.u32(o + RX_STATE) !== 3) : this.boot_finished,
      ...(this.native_tra ? { native_tra: true } : {}),
      reactive: this.reactive === null ? null : h8(this.reactive),
      // the subject frames shown: from MDET's own table where MDET_DL runs (source 'mdet'), else S-SUBJECT's
      ...(this.mdet?.used ? { subject: this.mdet.frames_status(), mdet: this.mdet.status() } : this.subject?.used ? { subject: this.subject.status() } : {}) };
  }
}
