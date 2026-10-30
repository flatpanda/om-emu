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
//              which their capabilities' start would send once the modules report ready; S-BOOTDONE dispatches 415 to
//              each that waits there, and 420 (the shooting mode, as OlyHfwOpeComRsbChangeMode makes it for mode
//              0x10000) to the camera base waiting in its state 11. The camera base then creates the shoot mode
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
//              refuses returns E_OK. Nothing a module would write back is written
//   S-DISPSYNC the release of the GUI's synced display updates: while the application's sync word for a panel is
//              set (CameraCommon::setDispSync, which E137's GUI asks for at the start), the GUI's update sends the
//              display manager a request of type 3, which leaves its buffers pending until an image sync names the
//              device (fact display.sync, src/fw/facts.mjs displaySync, which has the evidence). Their one sender, the
//              shooting sequence's stopRecView, does not run in an idle session, so E137's screen stayed one colour
//              and then showed only its wait clock (X). After the step (or idle slice) the lab releases each device
//              with such a request: the sync words of both panels cleared through the application's setter, as
//              stopRecView does, then the image sync of kind 1, the one whose event the manager takes in the state the
//              type-3 request leaves, which commits the pending buffers (D, displaySync has the manager's table).
//              stopRecView's kind 2 is not taken in that state: under it E137's screen came only with its GUI's next
//              update, a 250 ms redraw of a blinking item that the clear made an ordinary request, and E125's GUI,
//              which sends no further update, kept a one-colour frame (X). When the camera releases the sync at the
//              start is not known (I: once its through image shows)
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
//              START_RECVIEW, and END_RECVIEW 500 ms of lab time later. When the application starts its function
//              RECORDING_MOVIE (27; observed at 0x51068e37, past its checks), the recording starts (START_READY_MOVIE,
//              END_READY_MOVIE, START_SHOOTING_MOVIE, START_RECORDING_MOVIE, then UPDATE_SHOOTING_TIME(seconds) every
//              second); the next REC press ends it (STOP_SHOOTING_MOVIE, END_RECORDING_MOVIE: while recording the
//              application starts no function on the key). The application takes only the callbacks in its translation
//              table (0x5108226d, keyed by id - 2 at 0x613062e0): UPDATE_RECORDING_TIME (234) is not among them, and
//              without START_SHOOTING_MOVIE the GUI shows nothing while recording. During the movie the shooting phase
//              query (0x50ab57e9, 100 with no sequence controller) answers the phases the shooting component's sequence
//              would enter (MOVIE_PHASE), so getMovieState is 1 and the GUI lays out its REC mark and recording time.
//              Which notification each module sends, and when, is not known: the order follows the callbacks' names
import { FirmwareError, where, runtime, disasm, SP } from './hle.mjs';
import { AssertionError } from './errors.mjs';
import { packRegs } from './sim.mjs';
import { pack } from '../util/bytes.mjs';
import { hex } from '../util/hex.mjs';
import * as SC from './scene.mjs';
import { jpegOfFrame } from './jpeg.mjs';
import { HlsMedia } from './media.mjs';
import { SubjectFrames } from './subject.mjs';
import { A, MODEL, ON_LAB_MODEL, MODEL_INFO, IMAGE_BASE, knob, fact, isUnmapped } from '../fw/model.mjs';
import { DISPLAY_SYNC_E143, RECVIEW_E143, CBS_E143, LENS_ZOOM_TABLE_E143, CARD_DETECT_E143 } from '../fw/facts.mjs';
//   S-CARD     a card in the SD slot. On a body whose file system runs natively (storage.mjs; MODELS card_fs)
//              the card is a real block device (S-SDCARD) the firmware formats and mounts itself, and of S-CARD only
//              these stay: the HLS media mount state (SD 0x60360bfc and 0x60360c08, read through 0x50aca51d by
//              getMountState) is 8, as the HLS media layer would set it once the file layer reports the mount (the
//              application's card check passes, errFactor 0, and the GUI's count check 0x511ffcc9 too); each picture
//              taken (END_SHOOTING_PICTURE) is kept as an image (IMAGE_COUNT) for playback, and its file is written
//              through the file module (S-RECFILE, storage.mjs) in place of REC_FILE, whose recording modules do not
//              run; the DCF database learns of the file only at the next mount (none while the card is out of the slot,
//              and a format from the menu clears them: media.mjs). The firmware counts the remaining shots
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
//   S-PLAYSEQ  the play module's notifications of the HLS play requests (see RSB_EXECUTE); S-PLAYCOMP answers for the
//              play component the HLS components would create (PLAY_COMPONENT); S-PLAYVIEW (play.mjs) shows the image
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
//   S-EXPOSE   the brightness the exposure plan follows: the AE result TAKE_EXPOSE's command handler 0x50596187 writes
//              (the data objects 0xc12a, 0xc0ba, 0xc0ca, one per metering mode, I; the plan reads the one its metering
//              mode picks, 0x505613ea) is set through the property setter 0x5004188b to the scene's brightness, BV =
//              (EV100 - 5) x 256 (APEX x 256: the plan keeps Tv + Av - Sv = BV), and take_expose_calculate
//              (0x50597e82) runs natively; its plan (0x62a919dc: +6 Tv, +10 Sv, +14 Av) is the camera's shutter,
//              aperture and ISO on the screen and, with S-SCENE, the live view's and the captures' exposure. The
//              scene is S-SCENE's when it has one, else its default (EV 12); the zoom step is the one nearest the
//              scene's focal length. The camera meters the live view continuously (the LV AE task fed from the
//              sensor's 18x18 grids, not run): the lab plans once the application has started and again after each
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
// the target table at 0x606214a0 (docs/om1-shutter-spec.md 2.2) without DISPLAY (0x88), plus PC_PD_CMD_EXEC (0xcf)
export const MODULE_QUEUES = new Set([0x76, 0x3F, 0x64, 0x5A, 0x47, 0x1F, 0x03, 0x09, 0x71, 0x2E, 0x01, 0x5E, 0x7D, 0x1B, 0x7C, 0x08, 0x31, 0xAE, 0x98, 0xCF]);
// the same queues by their id words in the static queue-id table (0x600431c6, id n at +2(n - 1)), which a ported
// model's copy names in its own table (its ids differ: E147 numbers DISPLAY 0x89); module_queues() reads them
export const MODULE_QUEUE_WORDS = [A(0x600432B0), A(0x60043242), A(0x6004328C), A(0x60043278), A(0x60043252), A(0x60043202), A(0x600431CA), A(0x600431D6), A(0x600432A6), A(0x60043220), A(0x600431C6), A(0x60043280), A(0x600432BE), A(0x600431FA), A(0x600432BC), A(0x600431D4), A(0x60043226), A(0x60043320), A(0x600432F4), A(0x60043362)];
// A body's API target table can name module queues E143's has no counterpart of (src/fw/models.mjs modack_queues:
// [queue id, its name in the object-name table]; E132's CATEGORY_MAIN and LOGGER_MAIN): S-MODACK answers them too
export function module_queues(image) {
  const ids = MODULE_QUEUE_WORDS.map((a) => image[a - IMAGE_BASE] | image[a - IMAGE_BASE + 1] << 8);
  if (ON_LAB_MODEL && ids.join() !== [...MODULE_QUEUES].join()) throw new Error('module_queues: E143 table is not MODULE_QUEUES');
  const more = (MODEL_INFO.modack_queues ?? []).map(([q]) => q);
  if (more.some((q) => ids.includes(q))) throw new Error(`module_queues: ${MODEL}'s modack_queues ${more.join(', ')} repeat a queue of E143's table (${ids.join(', ')})`);
  return new Set([...ids, ...more]);
}
const OLYQEWR = A(0x5002C151), API_SEND_RETURN = A(0x503EBA07);
// S-DISPSYNC: the request type that waits for an image sync; the release's sync-word store (value, panels: both, as
// stopRecView passes them), its image sync's kind (the one the type-3 request's pending state takes, displaySync's
// comment) and image-event flag (a0, as stopRecView passes it)
const DISPSYNC_REQUEST = 3, DISPSYNC_OFF = 0, DISPSYNC_PANELS = 2, DISPSYNC_KIND = 1, DISPSYNC_IMAGE = 1;
const TRA_EXEC_CALLS = A(0x50AF7CB9), TRA_EXEC_CALL = A(0x50AF7CBE);
// S-TRAACK: the request's vtable slot the exec deletes a consumed request through (docs/hle-gaps.md 4.1.2, D)
const REQUEST_DELETE_SLOT = 1;
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
// S-PLAYSEQ: the play module's side of the HLS play requests. An asynchronous one (OlyHfwOpePlyComAsyncRsb::execute
// 0x50ad26fb: the request at +236 holds the id, the notify function 0x50ad2bc2 and the RSB) is finished by the module
// calling the notify with (a0 result word, a1 RSB, d0 the request's id, d1 2), which calls the RSB's callback (+228,
// this at +224): PlyCom's (0x50aceb5f) posts CBC_PLAY_COMMON / CBS_END for id 0 (startPlayService), the single-frame
// one's (0x50b7118d) CBC_PLAY_SINGLE_FRAME / CBS_FINISH_DRAW for id 8 (startSingleFrame); the GUI's callback handlers
// turn them into EVT_GUI_END_PLAY_SINGLE_READY (0x5123bd97) and EVT_GUI_END_PLAY_SINGLE_DISPLAY (0x5123bdd2). A
// synchronous request's id is set at 0x50ad4166 (OlyHfwOpePlyComSyncRsb): 1 is endPlayService (0x50acf764).
const RSB_EXECUTE = A(0x50AD26FB), RSB_REQUEST = 236, SYNC_REQUEST = A(0x50AD4166), NOTIFY_DONE = 2;
const PLAY_START = 0, PLAY_SINGLE_FRAME = 8, PLAY_MOVE = 9, SYNC_PLAY_END = 1, SYNC_CAN_MOVE = 344;
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
// pattern): the date at 8 (u16 year, then bytes; left 0, the lab has no clock), the picture size u16 x 2 at 16,
// rationals (u32 numerator, denominator) for the exposure time at 48, the f-number at 56 and the bias at 72 (I: EXIF's),
// the ISO u32 at 100.
const STILL = { size: 16, exp_time: 48, f_number: 56, exp_bias: 72, iso: 100 };
const PICTURE_SIZE = [5184, 3888];   // the OM-1's 4:3 large size, which the screen's 4:3 LF stands for
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
const TFT_FRAME_STATE = A(0xA32DDAF6);
// DISP_FRAME's wait for the frame plane's buffer swap (0x5100d398..: while the channel's shown address is one of its two
// buffers, OlyTaSS(1) and read again, 0x501c4291) sleeps on the display clock (A10, as the display task's sleeps do):
// natively the lab task would sleep with no timer to wake it.
const DF_SWAP_SLEEPS = new Set([A(0x5100D3C5), A(0x5100D424)]), OLYTASS = A(0x5002C6E5);   // 0xa32ddaf4 + 2: 0 when the TFT display setup's configuration word is 0xFACE
// S-TAKEFRAME / S-AFOSD: the CPU 1 side of the frame plane, the shared-memory API DISP_FRAME reads: the frame display
// mode (0x500256d9, the TAKE module's 0x5039f583 at live view) and the AF module's OSD upload (0x500257ce: indicator, frame
// count, frames of cx, cy, w, h; upload_af_info 0x508c8554).
const FRAME_MODE_SET = A(0x500256D9), AF_UPLOAD = A(0x500257CE), FRAME_MODE_AF = 4, AF_FRAME = [400, 300, 60, 60];
const INDICATOR_FOCUS = 1, INDICATOR_NO_FOCUS = 9;
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
"S-CAMAPP": "the camera application runs natively in every session: the boot chain's HighLevel steps (0x50ab222a, 0x50ab22bc), the event broker init 0x502a48b6 and act_tsk(58) at bring-up; its task entries are allowed, its nine module-9 readers join S-TAKEOVER's, its output-device read (0x50b76dbe) joins S-PROP; the application maps keys and moves the GUI itself (docs/om1-shutter-spec.md section 7); control camapp 2 starts a session with the HLS components running too",
  "S-MODACK": "the module tasks do not run: every request the application's API sender posts to a module queue (OlyQeWr returning to 0x503eba07; E143's target table's module queues, and those a body's src/fw/models.mjs modack_queues adds: E132's CATEGORY_MAIN and LOGGER_MAIN) is answered after the step with [status 0, token, word 3] to the reply queue in its word 0, the layout of DISPLAY's replies (0x501c48bf); every synchronous send (0x5002e39d) the lab otherwise refuses returns E_OK. Nothing a module would write back is written (I)",
  "S-DISPSYNC": "the release of the GUI's synced display updates: while the application's sync word for a panel is set (CameraCommon::setDispSync, which E137's GUI asks for at the start), the GUI's update is a request of type 3, which leaves its buffers pending until an image sync; their one sender, the shooting sequence's stopRecView, does not run in an idle session, so E137's screen stayed blank (X). After each step the lab releases each device with such a request: both panels' sync words cleared through the application's setter, as stopRecView does, then the image sync of kind 1, whose event the display manager takes in the state the type-3 request leaves, and the pending buffers are committed (D). stopRecView's kind 2 is not taken there: under it E137's screen came only at its GUI's next update, a 250 ms redraw of a blinking item, and E125's GUI, which sends none, kept a one-colour frame (X). When the camera releases the sync at the start is not known (I: once its through image shows)",
  "S-RVSTANDBY": "the rec view component in standby: the shooting components' RecView does not run; its entryStandby would store state 1 in the application's state word (fact recview), which starts at 0, and getRecViewState takes 0 for a rec view, so E142's GUI showed the rec view's items at the start (EVT_REC_DISP_RECVIEW, 0xf005) instead of the shooting screen (X). The lab stores 1 before the application starts; that the camera's component is in standby then is I",
  "S-TRAACK": "the HLS transaction layer's synchronous exec (0x50af7cb9 / 0x50af7cbe) returns 0: no local handler is ever registered (on the camera either), so every transaction goes to the active state's components, where the shooting component CmpSht_ShootingComponent_NEW answers TRA 990 and 991; it runs only with the HLS components, and the remote channel answers 0xf0000001 (startShootingService fails on TRA 990 without it, X). With the file system native and its HLS side (card_fs.hls: E143, E146) the media control's start (TRA 1511; E146's 1509) also goes to S-MDACTRL (media.mjs)",
  "S-CARD": "a card in the SD slot. With the file system native (a body that runs it, src/fw/models.mjs card_fs; storage.mjs) the card is S-SDCARD's, which the firmware formats and mounts itself at the insertion, and S-CARD keeps only the HLS media mount state (0x60360bfc, 0x60360c08) at 8, as the HLS media layer would set it on the file layer's mount, and the pictures taken (S-RELSEQ's END_SHOOTING_PICTURE) as images of folder 100, numbered from 1, for playback, the media API's image count (0x503feea4) answering their number for type 1 (the firmware's own count of type 1 counts a P*.JPG file in DCIM, X): each one's file is written by S-RECFILE in place of the release's recording modules, which do not run, and the DCF database learns of it at the next mount. The firmware answers the remaining shots and the movie time from the card. While the card is out of the slot (media.mjs S-MEDIA) no picture is kept and the image count is 0; a format from the menu (S-MDACTRL) clears the pictures. On the other bodies the card has no file system: the card driver's detect state of the first slot is 2, inserted (src/fw/facts.mjs cardDetect), set before the application starts; the remaining-shots module query 0x50419164 answers 999 less the images; the movie time query 0x5042da58 answers a time left of 1:00:00 less the time recorded so far, and the current recording's time; a DCF remain count that tests only the drive status's error bits (MODEL_INFO.dcf_mount_test) is given the mount test E143's count makes, so it returns as not mounted. An image is its number, its exposure and S-SCENE's scene at the capture",
  "S-PLAYSEQ": "the play module's notifications: each asynchronous HLS play request (OlyHfwOpePlyComAsyncRsb::execute 0x50ad26fb) is finished after the step by its notify function (0x50ad2bc2) with the request's id and kind 2, as the module would: startPlayService (0) makes PlyCom's callback post CBS_END and the GUI leave ID_ST_PREPARE, startSingleFrame (8) and moveCurrent (9) make the single-frame callback post CBS_FINISH_DRAW and the GUI show the image. While a request's transaction runs (S-TRAACK) the module's answer is written: canMoveCurrent (sync 344) can move whenever there are two images or more (they wrap around), moveCurrent's result is 1 and the image shown moves (direction 3 left, 4 right). That every request finishes at once, with result 0 and no other data, is an inference from the callbacks (I)",
  "S-PLAYCOMP": "the play component's answers (Cmp_PlayComponentBase, which only the HLS components create; OlyHfwOpePlyCom's wrappers 0x50acf156..0x50acf356 are answered in its place) for the image S-PLAYSEQ shows, the newest: getNumber its index, file number and folder 100, getStillInfo its exposure time, f-number, bias and ISO (from S-SCENE at the capture; 1/125 s alone without it) and the picture size 5184 x 3888, the type 0, not protected, no recording; a move's completion clears the single-move state (0x60362a7c), as the component's start_single_move_current does. The other wrappers answer 0, each logged (I)",
  "S-PLAYVIEW": "(with S-SCENE's live view) while the GUI shows a card image, from startSingleFrame's finish to endPlayService (sync request 1), the live-view plane holds the frame S-SCENE renders again from the scene kept with the image (black for an image taken without it): the camera would decode the file onto its image plane, which the lab does not have (I: same plane, same scaling as S-RECVIEW)",
  "S-DISPFRAME": "CPU 3's task DISP_FRAME on the lab CPU: its start (the frame colour table 0x51016eb1, the data pointers of the three settings objects its draws read), the TFT and EVF channels' eight face-plane colours converted from that table as the channel setup does (0x501db1b4), the TFT frame-state byte 0xa32ddaf6 at 0 (the value of a display setup with the configuration word 0xFACE, I), and one turn of its loop, natively, for each post to its flag (ring [3][0], function 0x5002587a); its 1 ms sleeps while it waits for the frame plane's buffer swap (0x5100d398..) run on the display clock (A10), so the VSC latches the new address at a frame boundary. It draws the AF frames, the focus indicator and S-SUBJECT's subject frames into its 8-bit plane (VSC IMG3, format 2); the composite shows the plane under the A19 opt-in",
  "S-RECVIEW": "(with S-SCENE's live view) from START_RECVIEW to END_RECVIEW the live-view plane holds the frame S-SCENE rendered at the capture (S2 down, the exposure in use) instead of the live scene; the camera would show the developed image through its playback path, which the lab does not run (I)",
  "S-TAKEFRAME": "the frame display mode the TAKE module sets for the live view (0x5039f583 -> 0x500256d9): 4, the AF frames and the indicator (the mask TAKE requests in S-AF is I)",
  "S-AFOSD": "the AF module's OSD upload (upload_af_info 0x508c8554 -> 0x500257ce) at S-RELSEQ's END_FOCUS: in focus, indicator 1 and one frame at the AF target (centre 400, 300, 60 x 60 in DISP_FRAME's coordinates, I); not in focus, indicator 9 and no frame (I); at the S1 release, none. A build whose frame plane has no AF upload (E145, the TG-7: modes 1 and 2 only, src/fw/facts.mjs framePlane) is given none: no code of its image stores the plane's mode-3 frames (X, a byte scan), so the camera's AF draws none there either (I)",
  "S-SUBJECT": "(with S-SCENE's live view, while the camera's subject-detection setting names a kind) the subject detection CPU 3's MDET would run: S-SCENE's subjects of that kind (the rider stands for motorsports) written into MDET's frame table as list records (four corners each, through DISP_FRAME's own transform taken back, so they land on the subject as the panel shows it), the getter's aspect pair and active byte set, the frame mode's subject bit added (I) and UP_FACE posted (0x50025747); DISP_FRAME reads the table through FACE's and MDET's getters and draws the frames natively (subject.mjs; docs/om1-subject-spec.md 5.1)",
  "S-LENS": "(unless the lens runs natively: the default on E143, E146 and E147, S-LENSMCU; OM_EMU_LENS=stand-in for S-LENS there) a lens on the mount, the M.Zuiko 12-40mm F2.8 PRO: lens 0's attach and data-valid flags (0xa32d4b9a, 0xa32d4b98) are 1 and its record (0xa32caa8c -> the driver's static 0xa3193780) is filled through the driver's current copies and its own commits 0x502ac838 / 0x502acb96, the zoom entries at +1164; the field layout is the record dump's (0x50118662, 0x50118ab7, 0x50118d20), the values I (12-40 mm, F2.8-F22 as APEX x 256 761 / 2283); the driver's derived apertures and focal lengths run natively; the lens-ready byte 0xa32d4b94 is 1 (0x50127ba2 answers 1, not 0x21, which DISP_FRAME requires, I); set before the application starts",
  "S-EXPOSE": "the brightness the exposure plan follows: the AE result objects 0xc12a / 0xc0ba / 0xc0ca (TAKE_EXPOSE's command handler 0x50596187 writes them; one per metering mode, I) set through the property setter 0x5004188b to the scene's BV = (EV100 - 5) x 256 (S-SCENE's scene, else its default EV 12), the zoom step nearest its focal length; take_expose_calculate 0x50597e82 runs natively, once the application has started and after each input on the shooting screen; its plan (0x62a919dc +6 Tv, +10 Sv, +14 Av) is the shutter, aperture and ISO the screen shows and, in S-SCENE's auto, the live view's and the captures' exposure. The camera meters the live view continuously (its LV AE task, not run)",
  "S-OUTDISP": "while the lab's display switch (SWITCH: H-CONNECT 131 with lOutput 7) has the EVF open, the application's getOutputDisplay (0x5104fd44) answers 6 (INTERNAL_EVF), the device H-CONNECT's lOutput 7 stands for; on the TFT it runs natively. Without it the application, told of the GUI's change, answers the TFT (its EVF branch needs a monitor position the lab's switch bits do not give, docs/om1-shutter-spec.md section 7 item 53) and sends 131 with lOutput 2, and the two alternate. The camera decides from the eye sensor, the monitor position and the settings (I)",
  "S-THROUGH": "(with S-SCENE's live view) the application's through-image control OlyHfwOpeShoot::ctrlAutoThrough (0x50abd373; ctrl 0 as the menu opens, 1 as it closes, D from its log) stops and restarts S-SCENE's frames: while stopped the live-view plane shows black (I: what the camera's plane shows while the through image is stopped)",
  "S-SETSAVE": "the settings store's save to flash (0x500421cd, called by the application as the menu closes, return 0x503f01a4) returns 0 without saving, the value of its path for a store that is not dirty: the flash controller (0x98d01800) is not in the lab and persistence is not modelled; a call from anywhere else is an error",
  "S-NVRAM": "(a host that keeps the camera's non-volatile state, env.nvram: node with OM_EMU_NVRAM=FILE) the settings stores' saves run natively down to the NAND write 0x5003d9da (direct, or posted to the flash task through 0x5003d95c, whose callback runs after it), which writes the image to its mirror and to the host; the next session's registry bootstrap restores M and E from those images ('MlR.', 'ElR.'); the SCPU window's backed-up words (the clock signature 0x00, the B store 0x08..0x3c) and the sub-CPU's memory S-SCPUDEV keeps (its RTC, advancing with the host's local time from the offset the camera's own clock setting left, and its backup registers) come back too, and the window clock starts at that date, so the start shows no date prompt (instead of S-SETSAVE)",
  "H-SCPUSTART": "the firmware's PER_SCPU started natively at the store init (act_tsk of its static task, as the boot chain would long before; its entry allowed) with the sub-CPU's model at the far end of its link: the task pulses the reset pin, waits for pin 102, sends 0x85 {2} and takes its reply natively; checked: the task waiting, the gate open, that one frame (docs/hle-gaps.md 4.7.1)",
  "S-SIO2": "PER_SIO's channel API for the one channel PER_SCPU opens (channel 2 on E143; PER_SIO's registers, init and interrupt handlers are not modelled): open calls the opener's callback, a full-duplex transfer hands its bytes to the sub-CPU's model and writes its answer to the rx buffer, and its end is delivered at the MN's next idle point in interrupt context, the rx callback with the descriptor and then the tx callback, as the driver's interrupt calls them; another channel's calls run natively as before (the EVF panel's channel 0), another kind of transfer on PER_SCPU's stops the session",
  "S-SCPUDEV": "the sub-CPU at the far end of the link (src/lab/scpudev.mjs; docs/om1-scpu-spec.md 3): its ready line (pin 102), message line (the window's port 3, dropped while a message of its own waits for the MN's poll [2, 0x8f], whose reply carries it), SPI slave and command manager from its firmware's code: the 10-byte receive, the power-on gate (only 0x85 and 0x02 before 0x85 {2}; anything else stops the session, as it stops the sub-CPU), replies [length, command, data] padded to 4, long writes and reads in chunks. Its handlers: 0x85 (the reply its handler builds; the gate opens at the release), the date (0x01 sets the RTC and its valid flag, backup register 1, for status 0, clears the flag otherwise; 0x81 answers the RTC, advancing with lab time or the host's clock under S-NVRAM, or 2019-01-01 with status 10501 while the flag is clear), the backup words 0x06 / 0x86 (0 on a blank camera), the port scan 0x88 ({result, not busy}: bit 0 PC13, bit 1 PC5, low in the lab, which keeps the USB switch 0x0400 at the idle image's state; the read enables the scan's report, a later change of PC13 is posted as the message 0x08), the GIO read 0x82 of those two ports and the power manager's 0x12 {5}, answered with the message 0x12 {5}; 0x85's releases set its power state (steady, bkground, pwr_save, standby, hibernation) and, for a power-off, drop its messages, stop the link as the sub-CPU leaves steady (pin 102 low) and stop the session at the next request (the wake is not modelled). Any other command stops the session naming it",
  "H-UIINSCAN": "(a body whose UI_IN has the request, fact scpu.port_scan: E143, E146, E147) UI_IN's module init's port scan (0x5005d36a, not run with the init) natively at play bring-up: the request 0x88 over the link, the reply's bit 0 to group 4's switch 0x0400 through the group-4 producer; checked: one 0x88 frame, not busy, no errlog, group 4 still the idle image (docs/hle-gaps.md 4.7.1)",
  "A-SCPUDEV-1": "the sub-CPU acts only at the MN's idle points, one action (a level change, or the handling of one event) per step and in zero lab time; a transfer's end is delivered first. The real sub-CPU answers within microseconds while PER_SCPU arms each wait before it blocks, so only the order is modelled",
  "A-LINKPINS-1": "pin 102's GIO interrupt is level-sensitive: type 0 its high level, type 1 its low level; a status bit stays set while its level holds, and a write clears only bits whose level has gone (PER_SCPU's callbacks disable the interrupt first, and the sub-CPU raises and drops the pin back to back, D)",
  "S-SCPUBOARD": "(OM_EMU_SCPU=native: the sub-CPU's own firmware on the STM32L4 machine in S-SCPUDEV's place, src/lab/scpum4.mjs) the sub-CPU's board: nothing attached but the MN's link (no battery pack answers on USART1 / USART2, no I2C device acknowledges: the chargers, the PBH IO expander, the USB PD controller; every ADC channel reads 0; LSE present, HSE absent; the hardware-phase straps on their pull-ups, phase 7) and the port scan's inputs PC13 and PC5 held low, S-SCPUDEV's levels: PC13 low keeps UI_IN's switch 0x0400 at the idle image's state and selects bkground at a power-off, where its pull-up would take the sub-CPU into standby 3 s after reset. What the camera's board answers is ?",
  "A-SCPUM4-1": "(OM_EMU_SCPU=native) the sub-CPU's time runs in step with lab time: before it takes an input of the MN's (a pin, a transfer) it runs up to the lab time of that input, and at the MN's idle points up to the lab's now; each input also opens an answer window of 50 ms of its own time (0.5 s after its power-on or reset) in which it runs on at the idle points while lab time stands still, stopping at each change of its link lines, which reach the MN one per idle point (A-SCPUDEV-1's order); a transfer's bytes pass its SPI2 at the link's clock, eight bit times of its own each, in zero lab time. The windows let it boot and answer while the MN waits on it in zero lab time and stay short of its command manager's 1000-tick monitor",
  "A-SCPUM4-2": "(OM_EMU_SCPU=native) a link line the sub-CPU does not drive (its pin not an output, an open-drain 1, the reset held) reads as S-SCPUDEV's lines while its reset is held: pin 102 low, the message line high; what the board makes of a released pin is ?",
  "A-SCPUM4-3": "(OM_EMU_SCPU=native) MN pin 107 high holds the sub-CPU's NRST low, S-SCPUDEV's polarity: a pin reset of the STM32L4 that keeps its backup domain (the RTC, the backup registers) and its SRAM; the sub-CPU is powered on at the link's start with a blank backup domain (the camera's has run since its battery went in, ?)",
  "S-LONGTIMER": "the system timer module's long timers (1000 ms and more, set through api_system.c 0x5041fd71 / 0x5041fd0d by the HLS timer service): when one is due in lab time the module's event 0x03010000 | number is published, as the module would",
  "S-BOOTDONE": "the HLS components' boot completion: the camera base (Cab_CameraBase) and the still-shooting category wait in their state 3 for event 415, which their capabilities would send once the modules report ready; S-BOOTDONE dispatches 415 to each waiting there, and 420 (the shooting mode) to the camera base waiting in its state 11, so the shoot mode, the category and Cmp_ShootingComponent are created and run on the OXF main thread (HIGHLEVEL_MAIN, started by S-CAMAPP). The component's sub-CPU status read (0x5012b8b7) returns 0",
  "S-CPU3": "the posts to CPU 3 (remote calls of 0x5002587a through ring [3][0], each setting bits of DISP_FRAME's flag) are taken off the ring and acknowledged after each step, and S-DISPFRAME runs a turn of DISP_FRAME for their bits; the lab has no CPU 3",
  "S-RELSEQ": "the modules' notifications of a release as the callbacks the HLS shooting reactive posts for them (0x50af4451, CBC_SHOOTING_COMMON), while the application's shooting service runs (from startShootingService 0x50ae1124 to endShootingService 0x50ad7e8a; in playback S1 only takes the application back to shooting): S1 down -> START_FOCUS, END_FOCUS (OK, or NG when S-SCENE's live view has nothing focusable under its AF point); S2 down -> START_SHOOTING_PICTURE, START_EXPOSE, END_EXPOSE after the shutter time in use, END_SHOOTING_PICTURE, START_RECVIEW, END_RECVIEW 500 ms later; the application's RECORDING_MOVIE function starts a recording (READY_MOVIE, START_SHOOTING_MOVIE, START_RECORDING_MOVIE, UPDATE_SHOOTING_TIME every second) or ends it (STOP_SHOOTING_MOVIE, END_RECORDING_MOVIE); meanwhile the shooting phase query 0x50ab57e9 answers the movie phases of the shooting component's sequence (113 ready, 114 ready finish, 115 recording, 117 end), so getMovieState is 1 and the GUI lays out its REC mark. The callbacks due at one lab time (END_EXPOSE and END_SHOOTING_PICTURE) are posted together before the application runs, as the modules' notifications would reach its queue while it works (E145's application defers an event until END_SHOOTING_PICTURE, X). The order follows the callbacks' names (I). No image is developed: S-RECVIEW shows the capture's frame",
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
    this.funcs = [];           // function direct ids the application started in the step
    this.recording = null;     // the lab ns a recording started, or null
    this.movie_phase = null;   // S-RELSEQ: the shooting phase the phase query answers during a movie, or null
    this.card_used_ms = 0;     // S-CARD: the recordings' time so far, off the movie time left
    this.card_shots = CARD_SHOTS;   // S-CARD: the card's shots before any image (bin/modelcheck.mjs's count probe sets it)
    this.images = [];          // S-CARD: the pictures taken, { number, release }
    this.release = 0;          // S-CARD: the releases (S2 down while shooting) so far; views: release -> S-SCENE's view
    this.views = new Map();    // of its capture; view_release: the release whose view S-SCENE gives next
    this.view_release = null;
    this.play_pending = [];    // S-PLAYSEQ: play requests to finish after the step
    this.play_cur = null;      // S-PLAYCOMP: the index of the image shown
    this.play_exec = null;     // S-PLAYSEQ: the play request whose transaction runs next
    this.tra_deleted = 0;      // S-TRAACK: the requests deleted after their exec
    this.components = !!session.opts.camapp_components;   // S-BOOTDONE / S-CPU3: the HLS components run (control camapp 2)
    this.media = null;         // S-MDACTRL / S-MEDIA (media.mjs): with the file system native
    // S-SUBJECT (subject.mjs): subject detection's frames, on a body that gives its facts (models.mjs subject)
    this.subject = MODEL_INFO.subject ? new SubjectFrames(session, this, MODEL_INFO.subject, (mode) => this.frame_mode(mode), FRAME_MODE_AF) : null;
    this.shoot_mode = false;   // S-BOOTDONE: 420 sent
    this.boot_finished = false; // S-BOOTDONE: the category left its state 3
    this.started = false;
    this.shooting = false;     // S-RELSEQ: the shooting service runs
  }
  // S-CAMAPP: run inside the session's step 'camapp start'.
  start() {
    const s = this.s, lab = s.lab;
    for (const e of CA_TASK_ENTRIES) lab.lt.allow.add(e);
    // a ported model's: every module-9 read of its build (fact app.module9_readers, src/fw/facts.mjs); E143's: those
    // its application reaches (CA_MODULE9_READERS)
    for (const r of [...CA_MODULE9_READERS, ...fact('app.module9_readers', [])]) lab.takeover_allowed.add(r);
    lab.prop_sites.push(CA_PROP_SITE);
    this.install();
    for (const a of CARD_STATE) lab.sim.write(a, pack('<I', CARD_MOUNTED));       // S-CARD
    if (!s.storage) lab.sim.write(CARD_DETECT.table, pack('<H', CARD_INSERTED));    // natively: the DCF card-in (storage.mjs)
    if (this.slens()) {                                                             // S-LENS
      lab.sim.write(LENS_ATTACHED, Uint8Array.of(1));
      lab.sim.write(LENS_READY, Uint8Array.of(1));
    }
    const rv = fact('recview', RECVIEW_E143);                                       // S-RVSTANDBY
    lab.sim.write(rv.word, pack('<I', rv.standby));
    this.dispframe_start();                                                         // S-DISPFRAME
    if (this.slens()) this.lens_mount();                                            // S-LENS
    lab.call(HL_CREATE, null, null, null, 2000000);
    lab.call(HL_INIT, null, null, null, 2000000);
    s.settle('S-CAMAPP HighLevel');
    this.boot_done();                                                               // S-BOOTDONE: the camera base's 415
    lab.call(BROKER_INIT, null, null, null, 2000000);
    s.settle('S-CAMAPP broker');
    if (this.components) {
      const hl = [...lab.nk.tasks()].filter(([, [e]]) => e === HL_MAIN).map(([t]) => t);
      if (hl.length !== 1) throw new FirmwareError(`S-CAMAPP: static tasks with entry ${h8(HL_MAIN)}: ${hl}`);
      const [hrc] = lab.nk.svc('act_tsk', { d0: hl[0] });
      if (hrc !== 0) throw new FirmwareError(`S-CAMAPP: act_tsk(${hl[0]}) = ${hrc}`);
      s.settle('S-CAMAPP HIGHLEVEL_MAIN');
      this.boot_done();
    }
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
  // S-TAKEFRAME: the frame display mode the TAKE module sets (0x500256d9), S-SUBJECT's too (its subject bit)
  frame_mode(mode) {
    const s = this.s;
    s.lab.call(FRAME_MODE_SET, { d0: mode }, null, null, 2000000);
    s.settle('S-TAKEFRAME');
    this.drain_cpu3();
  }
  // S-AFOSD: the AF module's OSD upload of the indicator and frames (cx, cy, w, h each). A build whose frame plane has
  // no AF upload (fact frame_plane, its mode-3 upload null: E145, src/fw/facts.mjs framePlane) is given none
  af_upload(indicator, frames) {
    const s = this.s, lab = s.lab;
    if (isUnmapped(AF_UPLOAD) && fact('frame_plane', null)?.uploads[2] === null) {
      this.log.push(['afosd', `none: the frame plane has no AF upload (indicator ${indicator}, ${frames.length} frame(s))`]);
      return;
    }
    const buf = lab.alloc(pack('<' + 'H'.repeat(4 * Math.max(1, frames.length)), ...(frames.length ? frames.flat() : [0, 0, 0, 0])), 4);
    lab.call(AF_UPLOAD, { d0: indicator, d1: frames.length, a0: buf }, null, null, 2000000);
    s.settle('S-AFOSD');
    this.log.push(['afosd', `indicator ${indicator}, ${frames.length} frame(s)`]);
    this.drain_cpu3();
  }
  install() {
    this.module_queues = module_queues(this.s.lab.image);
    // with the file system native (storage.mjs) the file module's own task, FILECLBK, takes its queue's requests
    const fileq = this.s.storage ? this.s.storage.f.fileclbk.queue : null;
    if (fileq !== null) this.module_queues.delete(fileq);
    if (this.s.storage?.f.hls) { this.media = new HlsMedia(this.s, this.s.storage); this.media.install(); }   // its HLS side (card_fs.hls)
    this.s.lab.panel_done = true;                                                  // S-PANELDONE (menu.mjs)
    const lab = this.s.lab;
    lab.xcpu_served.add(CPU3);                                                     // S-CPU3: S-CPU2 leaves bank 3 to drain_cpu3
    lab.wrap(OLYQEWR, (prev) => (h, r) => {                                         // on top of S-DISPQ's hook
      const q = r.d0 & 0xFFFF;
      if (disasm(r.mdr) === API_SEND_RETURN && this.module_queues.has(q)) {
        const p = lab.sim.u32(r.a0 >>> 0);
        this.acks.push({ q, w: [0, 1, 2, 3].map((k) => lab.sim.u32(p + 4 * k)) });
      }
      return prev(h, r);
    }, 'S-MODACK');
    const own = lab._sync_send.bind(lab);
    lab._sync_send = (h, r) => {
      const q = r.d0 & 0xFFFF;
      if (q === fileq) return lab.passthrough(r);                                 // FILECLBK replies natively
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
      if (this.play_exec !== null) this.play_answer(this.play_exec);                // S-PLAYSEQ
      this.play_exec = null;
      if (!req) { if (calls) h.finish_calls(r, { d0: 0 }); else h.finish(r, { d0: 0 }); return; }
      // the request consumed: its vt[1] natively, then 0
      const del = disasm(lab.sim.u32(lab.sim.u32(req) + 4 * REQUEST_DELETE_SLOT));
      this.tra_deleted += 1;
      if (calls) h.finish_calls_after(r, del, { a0: req }); else h.finish_after(r, del, { a0: req });
    };
    const sync = fact('display.sync', DISPLAY_SYNC_E143);
    this.dispsync_fns = sync;
    lab.observe(sync.request, (l, r) => { if ((r.d0 >>> 0) === DISPSYNC_REQUEST) this.dispsync.add(r.d1 >>> 0); }, 'S-DISPSYNC');
    lab.observe(SHOOTING_START, () => { this.shooting = true; }, 'S-RELSEQ (shooting service)');
    lab.observe(SHOOTING_END, () => { this.shooting = false; }, 'S-RELSEQ (shooting service end)');
    const fd = fact('func_direct.id', { sp: 28 });
    lab.observe(FUNC_DIRECT_RUN, (l, r) => this.funcs.push(fd.reg ? r[fd.reg] >>> 0 : lab.sim.u32((r.sp >>> 0) + fd.sp)), 'S-RELSEQ function direct');
    lab.hook(TRA_EXEC_CALL, (h, r) => tra(h, r, false), 'S-TRAACK');
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
    lab.hook(IMAGE_COUNT, (h, r) => h.finish(r, { d0: (r.d1 >>> 0) === IMAGE_TYPE ? this.card_images() : 0 }), 'S-CARD (images)');
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
  }
  // S-MODACK: the replies, each followed by a settle (a reply can bring the next request); S-DISPSYNC's releases.
  pump() {
    const s = this.s, lab = s.lab;
    for (let n = 0, m = 0, k = 0; this.acks.length || this.play_pending.length || this.dispsync.size;) {
      if (this.dispsync.size) {
        if (++k > 20) throw new FirmwareError(`S-DISPSYNC: more than 20 releases in one step (devices ${[...this.dispsync].join(', ')})`);
        const [code] = this.dispsync;
        this.dispsync.delete(code);
        this.dispsync_released += 1;
        this.log.push(['dispsync', `sync words cleared, image sync kind ${DISPSYNC_KIND} for device ${code}`]);
        lab.call(this.dispsync_fns.sync_set, { d0: DISPSYNC_OFF, d1: DISPSYNC_PANELS }, null, null, 2000);
        lab.call(this.dispsync_fns.image_sync, { d0: DISPSYNC_KIND, d1: code, a0: DISPSYNC_IMAGE }, null, null, 2000000);
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
    if (this.media && this.media.busy()) {                                         // S-MDACTRL / S-MEDIA (media.mjs)
      this.media.tick();
      for (const [k, d] of this.media.take_log()) this.log.push([`media ${k}`, d]);
      if (this.acks.length || this.play_pending.length || this.dispsync.size) this.pump();
    }
  }
  // S-CARD: the pictures on the card (none while it is out of the slot or not mounted)
  card_images() { return this.s.storage && !this.s.storage.mounted ? 0 : this.images.length; }
  // S-CARD, after a format from the menu (media.mjs S-MDACTRL): the card's pictures are gone
  card_formatted() {
    this.log.push(['card', `formatted: ${this.images.length} image(s) gone`]);
    this.images = [];
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
      this.play_cur = this.images.length ? this.images.length - 1 : null;
      lab.call(SYNC_RESPONSE_GET, null, null, null, 2000000);                      // the response block, as its first reader makes it
    }
    this.log.push(['play', `request ${p.id} finished`]);
    if (p.id === PLAY_MOVE) lab.sim.write(MOVE_STATE, pack('<H', 0));             // S-PLAYCOMP: the move completes
    const result = lab.alloc(new Uint8Array(4), 4);
    lab.sim.write(SP + 4, new Uint8Array(4));                                       // the notify's stack argument
    lab.calls(disasm(p.notify), { a0: result, a1: p.rsb, d0: p.id, d1: NOTIFY_DONE }, undefined, undefined, 50000000);
    s.settle(`S-PLAYSEQ ${p.id}`);
    if ((p.id === PLAY_SINGLE_FRAME || p.id === PLAY_MOVE) && this.play_cur !== null) s.scene_playview?.(this.views.get(this.images[this.play_cur].release) ?? false);
  }
  // S-PLAYSEQ: the play module's answer to a request while the transaction runs (in S-TRAACK's exec): a synchronous
  // request's response (the PlyComSyncRsb response block, *SYNC_RESPONSE), an asynchronous one's first notification
  // (kind 1: its data copied into the waiting result's buffer, *(*RSB_RESULT + 8), 0x50ad3d95), written as the notify
  // would write them. canMoveCurrent (sync 344, direction u16 at +0 of its parameters): +8 1 (it can: the images
  // wrap around, I), +16 0 (no page change); moveCurrent (9, direction u16 at +16 of the request: 3 left, 4 right):
  // the move result at +4 of the data (MOVE_RESULT, I), and the image shown moves.
  play_answer(p) {
    const lab = this.s.lab, n = this.images.length;
    if (p.sync === SYNC_CAN_MOVE) {
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
    const lab = this.s.lab, img = this.play_cur === null ? null : this.images[this.play_cur];
    const put = (at, fmt, ...v) => lab.sim.write(at >>> 0, pack(fmt, ...v));
    if (name === 'getNumber') {                    // a1 index, d0 file number, d1 folder (0x50acf1a8 -> 0x50c4680f)
      put(r.a1, '<I', img ? this.play_cur + 1 : 0); put(r.d0, '<I', img ? img.number : 0); put(r.d1, '<I', img ? CARD_FOLDER : 0);
    } else if (name === 'getStillInfo' && img) {   // a1 the struct (the component's vt+240)
      const cap = this.views.get(img.release)?.capture ?? null, info = r.a1 >>> 0;
      const t = cap ? cap.shutter_s : DEFAULT_SHUTTER_S;
      put(info + STILL.size, '<HH', ...PICTURE_SIZE);
      put(info + STILL.exp_time, '<II', ...(t >= 1 ? [Math.round(t * 10), 10] : [1, Math.round(1 / t)]));
      if (cap) {
        put(info + STILL.f_number, '<II', Math.round(cap.aperture * 10), 10);
        put(info + STILL.exp_bias, '<iI', Math.round(cap.ev_offset * 10), 10);
        put(info + STILL.iso, '<I', cap.iso);
      }
    } else if (!['get_img_type', 'isRecording', 'isProtect', 'getStillInfo'].includes(name)) {
      this.log.push(['playcomp', `${name} from ${where(r.mdr)}: not modelled, 0`]);
    }
    h.finish(r, { d0: 0 });
  }
  // S-RELSEQ
  // S-CPU3: ring [3][0]'s entries (function, argument) taken off and the bank-3 doorbell acknowledged
  drain_cpu3() {
    const lab = this.s.lab, intc = lab.nk.intc;
    if (intc === null || !intc.ipi_pending(CPU3)) return;
    const [wp, rp, ring, bit] = lab.ipi_desc(CPU3, 0);
    const w = lab.sim.read(wp, 1)[0], rd = lab.sim.read(rp, 1)[0];
    let bits = 0;
    for (let k = rd; k !== w; k = (k + 1) % 32) {
      const fn = lab.sim.u32(ring + 8 * k), arg = lab.sim.u32(ring + 8 * k + 4);
      if (fn !== runtime(CPU3_REMOTE_CALL)) throw new FirmwareError(`S-CPU3: ring [3][0] entry ${k}: function ${h8(fn)}, not ${h8(runtime(CPU3_REMOTE_CALL))}`);
      this.log.push(['cpu3', `remote call argument ${h8(arg)}`]);
      bits |= arg & 0xFF;
    }
    lab.sim.write(rp, Uint8Array.of(w));
    intc.ipi_request(CPU3, 0, bit);
    if (bits) this.dispframe_turn(bits);                                           // S-DISPFRAME
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
    if (!this.components || this.boot_finished) return;
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
        const img = { number: this.images.length + 1, release: this.release };
        this.images.push(img);
        this.log.push(['card', `image ${CARD_FOLDER}-${String(img.number).padStart(4, '0')} saved`]);
        if (s.storage) {                                                               // S-RECFILE (storage.mjs)
          img.file = s.storage.write_picture(jpegOfFrame(s.picture_frame(this.views.get(img.release) ?? null)));
          this.log.push(['card', `file ${img.file.path}, ${img.file.size} bytes`]);
        }
      }
    }
  }
  at(delay_ns, name, param = 0) { this.timed.push([this.s.lab.lab_time() + delay_ns, name, param]); this.timed.sort((a, b) => a[0] - b[0]); }
  // After the session's key step: the release sequence for the shutter stages that went down in it, and a recording
  // started or ended by the application's RECORDING_MOVIE.
  // shooting: whether the shooting service ran as the key went down (S1 in playback ends it and starts the service).
  key(downs, rec_down = false, ups = [], shooting = this.shooting) {
    const sc = this.s.scene, live = sc !== null && sc.liveview;
    if (!shooting) {                               // playback: the modules see no release
      if (downs.length) this.log.push(['cbs', `${downs.join(', ')} down without the shooting service: no release`]);
      downs = []; ups = [];
    }
    if (downs.includes('s1')) {
      this.post('START_FOCUS');
      const ok = !(live && SC.focusAt(sc, this.s.lab.lab_time() / 1e9) === null);
      this.post('END_FOCUS', ok ? 1 : 0);
      if (ok) this.af_upload(INDICATOR_FOCUS, [AF_FRAME]); else this.af_upload(INDICATOR_NO_FOCUS, []);   // S-AFOSD
    }
    if (ups.includes('s1')) this.af_upload(0, []);
    if (downs.includes('s2')) {
      this.release += 1;
      this.view_release = this.release;
      this.post('START_SHOOTING_PICTURE');
      this.post('START_EXPOSE');
      const t = live ? SC.exposureOf(sc).shutter_s : DEFAULT_SHUTTER_S;
      this.at(t * 1e9, 'END_EXPOSE');
      this.at(t * 1e9, 'END_SHOOTING_PICTURE');
      this.at(t * 1e9, 'START_RECVIEW');
      this.at(t * 1e9 + RECVIEW_NS, 'END_RECVIEW');
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
      this.post_all(batch.map(([, name, param]) => [name, param]));
      for (const [, name, param] of batch) if (name === 'UPDATE_SHOOTING_TIME' && this.recording !== null) this.at(1e9, name, param + 1);
    }
    this.subject?.tick();                                                           // S-SUBJECT
  }
  take_log() { const out = this.log; this.log = []; return out; }
  status() {
    return { started: this.started, recview_pending: this.timed.some(([, n]) => n === 'END_RECVIEW'), pending: this.timed.map(([, n]) => n),
      recording_s: this.recording === null ? null : +((this.s.lab.lab_time() - this.recording) / 1e9).toFixed(1),
      card_used_s: +(this.card_used_ms / 1000).toFixed(1), card_images: this.images.length,
      components: this.boot_finished,
      reactive: this.reactive === null ? null : h8(this.reactive),
      ...(this.subject?.used ? { subject: this.subject.status() } : {}) };
  }
}
