// Lightweight runtime constants and pure helpers split out of src/fw/facts.mjs.
// Zero dependencies on the offline firmware-rule scanner so browser/runtime modules
// can import E143 constants and address helpers without pulling in facts.mjs.
export const valueAt = (o, path) => path.split('.').reduce((v, k) => (v != null && Object.hasOwn(v, k) ? v[k] : undefined), o);
export const RESET_HEAD = 0x400, BASE_PAGE_OFFSET = 0x020;
export const cached = (a) => (a >= 0xA0000000 && a < 0xC0000000 ? a - 0x40000000 : a) >>> 0;
export const alias = (a) => (a >= 0xA0000000 ? a - 0x40000000 : a + 0x40000000) >>> 0;
export const HEAD_COPY_MODE = 0x10200, FLASH_VIEW = 0x50000000;
export const RES_TABLES_SPAN = 0x180, RES_SUB_SPAN = 0x60;   // E143: the last table store 0x149 bytes past the entry, the count 0x4a past the sizes
export const INDEX_READ = 0x800, LOADER_SPAN = 0x800;   // the span: E143's string limit is 0x3d0 bytes after the index read
export const GUI_TAKE_E143 = 0x510C2A2E;
export const GUICALLER_E143 = 0x60368B88;
export const GUI_TASK_E143 = 0x5115BA0C;
export const STATE_LOG_E143 = 0x5124BA59;
export const STATE_TABLE_E143 = 0x61596FB8, STATE_PARENTS_E143 = 12;
export const MENU_STATE_NAMES = ['SS_MENU', 'ID_ST_MENU'];
export const ICON_RETURN_E143 = 0x51257D3D, ICON_TABLE_E143 = 0x62B3E364, ICON_AUX_E143 = 0x60370AF8;
export const API_OBJECT_E143 = 0x603613B0;
export const GUI_DEVICES_E143 = 0x62B3DC94, GPI_TEXT_CALLBACK_E143 = 0x510BC7D8;
export const DISPLAY_TASK_INIT_E143 = 0x501C2F13;
export const OLYQEWR_E143 = 0x5002C151;
export const DISPLAY_SYNC_E143 = { request: 0x503E4DD5, image_sync: 0x503E50EC, sync_set: 0x50AB43CD, kind: 1, panels: [2] };
export const VSC_LEVEL_WORDS = [0x2E0, 0x2E4, 0x2E8];
export const RECVIEW_E143 = { word: 0x6035E9C8, standby: 1 };
export const CBS_E143 = { START_FOCUS: 213, END_FOCUS: 214, START_SHOOTING_PICTURE: 210, START_EXPOSE: 136, END_EXPOSE: 21,
  END_SHOOTING_PICTURE: 211, START_RECVIEW: 89, END_RECVIEW: 27, START_READY_MOVIE: 205, END_READY_MOVIE: 206,
  START_RECORDING_MOVIE: 216, END_RECORDING_MOVIE: 217, START_SHOOTING_MOVIE: 92, STOP_SHOOTING_MOVIE: 97,
  UPDATE_SHOOTING_TIME: 108, START_THROUGH_IMAGE_PROCESS: 258 };
export const MODE_DIAL_E143 = { table: 0x602243A0, names: [[1, 'P'], [2, 'A'], [3, 'S'], [4, 'M'], [10, 'MOVIE'], [53, 'MY_MODE1'],
  [54, 'MY_MODE2'], [55, 'MY_MODE3'], [56, 'MY_MODE4'], [62, 'B']] };
export const PROP_STORE_E143 = { init: 0x503EE2D6, objects: 0x62A65E0C };
export const SETTINGS_CHAIN_E143 = { entry: 0x503DAE30, steps: [0x503EB7F4, 0x50424AB5, 0x504221BA, 0x5041F937, 0x503EDEEA, 0x503EE2D6, 0x503F0304,
  0x5040E420, 0x5042539D, 0x503EA27E, 0x504219FA, 0x503DE4FB, 0x503ED252, 0x503F55CA], tail: [0x503E8E8F, 0x50421080, 0x503ED455] };
export const CTORS_E143 = [[0x60714E78, 15], [0x60EF9AD0, 48], [0x615C71D4, 64], [0x617D0310, 6]];
export const ERRLOG_E143 = 0x50047313;
export const HANDLER_TABLE_E143 = 0xA32600C0;
export const KCB0_E143 = 0x6004381C, INIT_TASK_E143 = 0x5002CCA5;
export const OLYQERD_E143 = 0x5002C067, DISPLAY_LOOP_E143 = 0x501C3035;
export const DISPLAY_START_E143 = [0x501C3075];
export const DISPLAY_REPLIES_E143 = [0x501C4913, 0x501C4974];
export const UI_IN_E143 = 0x5014B736, UI_IN_FLAG_E143 = 0x60043010;
export const UI_IN_POST_E143 = 0x5014C956, UI_IN_SINK_E143 = 0xA32DABA4;
export const POWER_OFF_E143 = {
  pwr: { init: 0x50044EB6, id_word: 0x60042D3A },
  shutdown: { object: 0x50AFCCD5, slot: 2, entry: 0x50AFD2D7, mode: 1, reason: 1 },
  flash_save: 0x50AF6A15, start_shutdown: 0x50AF654B, log: { nand: [0x4E820000, 0x200000], ret: 0x518F742F }, end: 0x50044DEE,
  ioexp: { body: { post: 0x50056A85, flag: 0x60043170 }, pbh: { post: 0x50054EDE, flag: 0x60043180 } },
  poll: { at: 0x5005CEAF, pin: 102 },
};
export const POWER_OFF_LIB = { ioexp_write: 1 };
export const POWER_LATER_E143 = { handler: 0x5004408F, early: 0x50044ED7, late: 0x50044F7D, a: 0xA32BFB58, c: 0xA32BFB59 };
export const TOUCH_INIT_E143 = 0x501E3DCA, TOUCH_TASK_E143 = 0x501E3EAC, TOUCH_TASK_ID_E143 = 0x60042DCC, OLYTAST_E143 = 0x5002C546;
export const OLYEVWT_E143 = 0x5002BDD8, TP_FLAG_E143 = 0x6004306C;
export const TOUCH_TASK_QUEUE_E143 = { flag: 0x6004306C, queue: 0x600432E8, bit: 8 };
export const WUP_TSK_E143 = 0x50016BF0, OLYTAWU_E143 = 0x5002C6A7;
export const TSND_DTQ_E143 = 0x50016578;
export const DB_INIT_E143 = 0x503C5473, FLASH_SAVE_E143 = 0x503EEE94, DB_SAVE_RETURN_E143 = 0x503C5537;
export const DIAL_INIT_E143 = 0x5014B7C7, DIAL_TABLE_PTR_E143 = 0xA32DAAB0;
export const TOUCH_E143 = { i2c_write: 0x501E4DFD, i2c_read: 0x501E4F2A }, TOUCH_WALK = 0x20;
export const TP_OPEN_E143 = 0x501E40DA;
export const TP_MASK_E143 = 0x501E41D1, TP_MASK_WORD_E143 = 0x62A3EBC0;
export const LENS_COMMAND_QUEUE_E143 = 0x60043226;
export const LENS_DRIVER_E143 = {
  module_init: 0x502A5D10, cache_init: 0x502A6371, task_vars: 0x502A5DFF,
  tasks: [0x502A5E37, 0x50115A08, 0x502A8193], exec_queue: 0x60043220,
  flags: { valid: 0xA32D4B98, attach: 0xA32D4B9A, ready: 0xA32D4B94 }, cache_area: [0x416E0000, 0x1C0000],
};
export const LENS_FOCAL_NOW_E143 = 0x50129980, LENS_ZOOM_TABLE_E143 = 1164;
export const LENS_RECORD_E143 = 0xA32CAA8C;
export const IIC_WAITS_E143 = [0x5004CBF6];
export const TOUCH_ARGS_E143 = { write_len: { sp: 20 }, read_len: { reg: 'a1' }, read_addr: ['d1'] };
export const FACE_COLOUR_SET_E143 = 0x501E061A;
export const SHOOTING_E143 = { start: 0x50AE1124, end: 0x50AD7E8A, auto_through: 0x50ABD373 };
export const SHOTS_QUERY_E143 = 0x50419164;
export const CARD_DETECT_E143 = { table: 0xA33AF3D4, drives: 2 };
export const CARD_SLOTS_E143 = { port: 12, detect: { fn: 0x508B0221, switches: [0x1506, 0x1518], pins: [[0xA32C5314, 7], [0xA32C5318, 0]] },
  record: { mode: 1129, slot: 1130 } };
export const DPC_E143 = { init: 0x50050279 };
export const AD_E143 = { init: 0x5004D3C3, configs: 0x60118724, table: 0xA32BFF10, count: 0xA32BFF14, irq: 319 };
export const SIO_E143 = { tx_start: 0x5005DC03, rx_start: 0x5005DEF6, done: [0xA32C96B0, 0xA32C96DC], dispatch: 0x5005ED65, restart: 0xA32C9760, channels: 0xA32C9E48, map_init: 0x5005F0B2 };
export const BOOT_E143 = { key: 0xA32DAB30, stage: 0xA32DF1F4 };
export const SECTIONS_E143 = { loader: 0x50024E6B, switch: 0x50024E02, table: 0x60029B1C, copied: 0xA32DF1F8,
  ends: [0x60045E3A, 0x60045E42, 0x60045E7A, 0x60045E4A, 0x60045E6A, 0x60045E52, 0x60045E5A, 0x60045E72, 0x60045E62, 0x60045E83],
  head: [0x50000155, 0x50000178, 0x5000019B, 0x500001BA, 0x500001DC] };
export const SECTION_SWITCH = [0x04, 0xa0, 0x01, 0xc0, null, 0xa0, null, 0xc1, null, 0x28, 0xff, 0x54, 0xfc, 0xdc, null, null, null, null, 0xf3, 0x80, 0xf0, 0xf4];
export const SECTION_ROW = 12;
export const STORAGE_E143 = {
  init: 0x5088FC8D, tasks: [0x60042D42, 0x60042D2A], fileclbk: { entry: 0x5088FCFC, queue: 0x1F, busy: 0x62AE4CD0, reply: 0x508900C4 },
  fat_error: 48, nand: { access: 0x500022C2, area: [0x41A00000, 0x80000], read: 0x10200, write: 0x10100 },
  command: 0x508AD03C, command_fields: { code: 24, arg: 28, resp: 32, buffer: 48, count: 52, block: 56, status: 74 },
  album_init: 0x508B67E8, status: 0x508A8327, cflush: 0x508881FA,
  card_power: { send: 0x50059656, ret: 0x508B033C }, card_switch: null,
  names: { folder: 'OMSYS', file: 'P101', ext: 'JPG' },
};
export const STORAGE_LIB = {
  codes: { mount: 0x51, format: 0x55, dcf: 0xF0, number: 0x31 }, unformatted: 0xE08, card_out: 2, card_info: 0x12,
  fileif: { open: 0x10001, close: 0x10002, write: 0x10003, mkdir: 0x1000C }, drive: 'C',
  rec: { codes: { open: 0x32, reserve: 0xF1, write: 0x54, entry: 0x66, register: 0x33, cancel: 0x36 }, kind: 1 },
};
export const MEDIA_LIB = { mount: { unmounted: 0, mounted: 8, rec_end: 2, end: 8 }, switch_event: 0x02020000, cab: { closure: 28, fn: 16, format: 1 } };
export const RECORDER_E143 = { time: 0x5012B7CD };
export const DCF_COUNTS_E143 = 0xA33AA5B4;
export const ERASE_E143 = { object_delete: 0x503FD974, attribute: 0x503FDCB1, erase_all: 0x503FDAF6, unlock_all: 0x503FF28B, rating_erase: 0x5040263E };
export const MEDIA_STATUS_E143 = 0x60360BEC;
export const MOUNT_STATE_E143 = 0x60360BFC;
export const REC_FILE_E143 = {
  exif: {
    init: 0x504298BD, cflush: 0x504298F6, template: 0x62A6C358, copy: 0x504298F9, size: 92252, time: 37800,
    date: { format: 0x5012BD20, code: 0x4200, copy: 0x50003843, original: 4089, created: 4109, modified: 1364 },
    tags: { make: 1480, model: 1504, zoom: 4228 }, crop: [40858, 40866], set: 0x5042992D,
  },
  init: 0x50539665,
  task: { id: 27, entry: 0x5053F1A4, flag: 0x60043182, queue: 0x6004324E, handled: 0x5053F20D },
  packet: {
    size: 316, post: 0x5053990F,
    fields: { pExifParam: 28, HandleTarget: 116, BuffAddr1: 144, BuffSize1: 148, HeaderSize: 184, Status: 208, Mode: 210,
      Media: 214, Media2: 216, RecordDevice: 218, ImgAspect: 299, Free: 302, FileType: 314, Command: 52, RecordMediaMode: 297 },
  },
  jpeg: {
    make_image: 0x50549B42, header: 41984,
    image: { record: null, addr: 188, size: 192 },
  },
  contexts: [0x62A8C4E4, 0x62A8C540], clock_set: 0x5012B7A7,
};
export const REC_IMAGE_E143 = {
  task: { id: 28, entry: 0x50541C45, queue: 0x60043250 },
  shared: { init: 0x5054DBE8, done: 0xA332CE59 },
  imgpro: [0x5048C3A0, 0x5048BA3A, 0x5050A6B2],
  reply: { fn: 0x5053984B, from: 0x5053F3C0 },
  alive: 0,
  settings: 0x500417DA,
  take: [[35217, 38074, 2], [38737, 38076, 2], [38769, 38078, 2], [38785, 38080, 2], [40401, 38086, 1], [12417, 38122, 1],
    [38017, 38037, 1, 6, 40209], [49169, 38008, 2], [17601, 38772, 1]],
  encode: { set_call: 0x50542C97, set: 0x50491C9F, run: 0x50542407, result: 0x50542CE1, release: 0x5054322E, id: 36, packet: 24 },
};
export const IMGPRO_UNIT_E143 = 0x9C600000;
export const DUAL_SLOT_E143 = { slot: { record: null, at: 313 }, addr: 168, size: 172, one: [37998, 38014, 38018], two: [38000, 38016, 38020],
  types: [37896, 37898] };
export const TAKE_REQUESTS_E143 = { api_post: 0x503EBE71, take_send: 0x502CE58C, control_post: 5, func29: { command: 29, param: 0x62A3F2BE },
  kind_at: 8, queue_at: 4, event: 0x04080032 };
export const TAKE_API_POST_E143 = 0x503EBE46, TAKE_SEND_E143 = 0x502CE57B, TAKE_CONTROL_40_E143 = 0x50417EFD;
export const TAKE_FUNC29_E143 = 0x503A05FB, TAKE_API_E143 = 0x50417CD9, TAKE_PACKET_KEEP_E143 = 0x503C275C;
export const TAKE_EVENT_POST_E143 = 0x503C3262, TAKE_REPLY_E143 = 0x502CE5E6, TAKE_MAIN_E143 = 0x503996C3;
export const TAKE_COMMANDS = { Idle: [0, 7], RdyTrig2Wait: [7, 11] };
export const TAKE_EXPOSURE_E143 = { record: { size: 96, fill: 0x503BF619, flags: 0x40000000, reads: [[41002, 6], [41034, 8], [41018, 10], [41082, 12]] },
  range: { fn: 0x50599812, low: 38166, high: 38168 }, copy: [[6, 38164], [8, 38172], [10, 38178], [56, 38170], [60, 38180], [58, 38176]] };
export const TAKE_COPY_E143 = 0x503BCDAC, TAKE_FILL_E143 = 0x503BBD26;
export const TAKE_SHOT_E143 = { alloc: 0x5040F43A, free: 0x5040F52E, kind: { setting: 49698, value: 2 }, take: { alloc: 0x503AF59E, free: 0x503AF80B },
  record: { fn: 0x503AFC3E, table: 0x62A494A4, entry: 32, ids: 116, flag: 4, at: 20 } };
export const TAKE_FILLS_E143 = { context: 0x62A4A358, packet: 0x62A4A350,
  mode: { build: 0x503C28C7, bytes: 0x62A4CE68, copy: 0x503C4509, record: 0x62A4CE80, standby: 0x503B09DD },
  ring: { get: 0x503BAEB6, free: 0x503BAF23 }, record: { fn: 0x503BBA51, modes: [0x62A4B190, 0x62A4B1BC] },
  take: { capture: 0x503BCAA2, key: 0x503BAA2D, count: 0x62A4AF68, after: 0x503BC4FE },
  pic: { fn: 0x503BCD51, mode: 3122, af: 0x509B08F0, crop: [40858, 40866], lens: 0x503BD137, third: 0x503BD1FA },
  strobe: { request: 0x503B8126, at: 3144, status: 3140, decision: 0x501BC976, props: { fill: 0x501C20B0, table: 0x60350410, count: 122 } } };
export const AF_MKNT_E143 = 0x509B08F0;
export const BROKER_E143 = 0x502A48B6;
export const FUNC_DIRECT_E143 = 0x51068E37;
export const dramSize = ({ banks: [[base, size, count]] }) => cached(base) + size * count - 0x60000000;
export const COMPONENT_GETTER_E143 = 0x50D7570B;
export const STILL_CONVERT_E143 = 0x50ACC981, STILL_WRAPPER_E143 = 0x50ACF1FA;
export const STILL_E143 = { convert: STILL_CONVERT_E143, focal: { at: 148, size: 4 }, iso: { at: 100, size: 4 } };
export const AE_INTERP = 0x50563138, AE_INIT_E143 = 0x50560B29;
export const FRAME_PERIOD_E143 = { tft: { vtotal: 0x501D8ABA, word: 0xA32DB47C }, evf: { vtotal: 0x50023BAB, word: 0xA32DB428 } };
export const HW_TIMER_INIT_E143 = 0x500642DD, HW_TIMER_PTR_E143 = 0xA32CA47C;
export const K_CRT_CALL_E143 = 0x5005A6CB, K_CRT_134D_E143 = 0x3FFE134D;
export const TAKE_FRAME_E143 = 0x5039F583, FRAME_MODE_SET_E143 = 0x500256D9;
export const AF_UPLOAD_E143 = 0x500257CE;
export const PROP_DEVICE_SITES_E143 = [0x503EFF61, 0x50B76DBE];
export const EVF_PROP_VALUE = 8;
export const API_SEND_RETURN_E143 = 0x503EBA07;
export const API_TARGETS_E143 = { XTC_APP_EXEC: 0, PLAY_EXEC: 3, TFT_EXEC: 4, TAKE_EXEC: 6, REC_EXEC_MAIN: 12,
  FILECLBK_UEXEC: 14, ADJ_SLF_EXEC: 33, BC_EXEC: 34, UI_OUT_EXEC: 39, LENS_EXEC: 18, ADJ_EXEC: 24, TAKE_FUNC: 25,
  ZOOM_EXEC: 26, FCS_EXEC: 27, PWR_EXEC: 28, AUD_EXEC: 37, LENS_COMMAND: 40, MOVE_MAIN: 41, C3D: 42 };
export const PC_PD_NAME = 'PC_PD_CMD_EXEC';
export const PLAY_TASK_NAMES = ['PLAY_MAIN', 'PLAY_LOAD', 'PLAY_IMAGE', 'PLAY_SOUND', 'PLAY_DECODE', 'PLAY_LOADDRAW'];
export const PLAY_TASKS_E143 = [[0x60042D58, 'PLAY_MAIN'], [0x60042D56, 'PLAY_LOAD'], [0x60042D54, 'PLAY_IMAGE'], [0x60042D5A, 'PLAY_SOUND'],
  [0x60042E12, 'PLAY_DECODE'], [0x60042E14, 'PLAY_LOADDRAW']];
export const PLAY_DECODE_E143 = {
  issue: 0x5048F331, issue_from: [0x518B4476, 0x518B4792], wait: 0x5048F6E4, wait_from: [0x518B4484, 0x518B47A0],
  request: { src: 0, format: 8, width: 12, height: 14, area_width: 16, area_height: 18, work: 28, bytes: 36 },
  dest: { addr: 0, format: 8, pitch: 10, width: 12, height: 14 },
};
export const PLAY_ISSUE_E143 = PLAY_DECODE_E143.issue;
