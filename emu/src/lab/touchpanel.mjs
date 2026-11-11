// The touch panel controllers S-TPREG answers for (src/lab/play.mjs): the touch driver's I2C reads go to the slave its
// build addresses, and each controller answers the registers its driver reads after the controller's INT, from the
// session's touch (down, move or up at panel pixel x, y of the TFT). Two controllers, by slave (D: the immediate the
// driver's reads pass in d0, the same at every read of the build; X, a byte scan of the 18 expanded images):
// - 0x70, the E143 family's: the data at register 2 (d1), 11 bytes as the driver's report parser takes them: the
//   number of touches, event << 6 | x >> 8, x, id << 4 | y >> 8, y, then 0, 0, 0xcf, 0xff, 0xff, 0xff, the event 0
//   down, 1 up, 2 contact (move), y counted from the panel's bottom edge (as before: E143's TP read 0x501e4f2a from
//   0x501e4fd9; docs/hle-gaps.md 4.4.2);
// - 0x48, the E144 family's and the E118 family's: 16-bit register addresses, the high byte in d1 and the low in a1
//   (src/fw/facts.mjs touchArgs read_addr). After the INT (E144's touch task, its flag's bit 1 -> 0x5018af22 -> the
//   report read 0x5018b4d7, D) the driver reads 10 bytes at 0x0000 and takes byte 0's low nibble as the number of
//   touches (a report of 2 or more is not passed on, 0x5018bc37; one with any of bits 5..7 set is dropped,
//   0x5018bc2c), byte 1's low nibble as the event, byte 2's low and high nibbles as the touch
//   ids of points 0 and 1 (0 none), and point 0's x and y as x = (b5 & 0x0f) << 8 | b3, y = (b5 & 0xf0) << 4 | b4,
//   point 1's from bytes 7..9 alike (0x5018b503..0x5018b557); with event 0 it reads one byte at 0x1c0a and takes the
//   report as an event only with its bit 1 set (0x5018b55a..0x5018b57f, D). With its control area off (0x620c6480 0:
//   the touch init clears it, and in the lab's sessions the camera application's Set_Touch_Panel_Ctrl_Area, API
//   0xd001f, which sets it, is not called, X) the driver passes the controller's event on as it is: 0, 1 and 8 end a touch, 2
//   and 3 carry its point, 4 and 15 are dropped (0x5018bca1..0x5018bcd5, D); with the area on it derives the same
//   codes from the touch ids itself, 2 where an id appears, 3 while it stays, 0 (or 1 or 8, by the press's length)
//   where it goes: 1 where the press it ends began less than 150 ms before (0x5018b9b9, 150000 on the us clock), 8
//   where that tap follows another within 800 ms, else 0 (0x5018b8d4..0x5018ba6b, D). The model gives a down 2 and a
//   move 3, one touch (id 1) at point 0, and an up no touch with event 1 after a down less than 150 ms of lab time
//   before, else event 0 with bit 1 of 0x1c0a set (I: the driver's own codes for the same transitions, without the
//   double tap; which codes the controller gives, and what bit 1 means, are ?). HFW then sees a tap as PRESS and
//   CLICK, a longer press as PRESS and LIFTOFF (X). x and y are the TFT panel's pixels, not flipped
//   (D: the driver checks an area against 720 x 480 at 0x5018a2b1..0x5018a2cc and flips by 719 - x, 479 - y only
//   for the swivelled monitor, 0x5018c2d9; X: HFW's PRESS at the pixel tapped). Every 0x48 driver also reads two
//   bytes at 0x1c14, a version it keeps for its report parser, which reads coordinates for every event from 0xd700
//   on: E120's, E122's and E144's in their display opens' command lists, kept as b1 << 8 | b0 (the E144 family's
//   other bodies hold the same read, X: a byte scan); E118's in its touch task's power-up command list, kept as
//   b0 << 8 | b1 and checked there: 0xc400 goes on to the register set-up, any other value to a download of the
//   controller's firmware from the camera's image (24496 bytes through the touch I2C write), an INT wait and the
//   version again (0xc400 then runs a calibration), and a value outside 0x3000, 0x9e00, 0xc400 and 0xd700 also logs
//   "[TP] Touch IC F/W Version A not available!!" (D, the addresses in docs/model-survey.md findings 85 and 86).
//   The model answers c4 00, 0xc400 to E118's driver: a controller that runs the firmware this camera's build carries
//   (D: the program the download sends sets c4 00 at its register 0x1c14, and the list's two checks take 0xc400
//   alone, before its download and after it, docs/model-survey.md finding 117; what a controller without that program
//   answers before any download is ?; with 0 the download runs and the tap still reaches HFW, X). The others would
//   read 0x00c4, below 0xd700 as 0 is (in the lab's TFT sessions E120's open reads it before S-TPREG is installed,
//   through the lab's plain read, and E122's and E144's not at all, X). Every other register reads 0.
// The controllers' names are not in the images (?), nor their other registers but E118's, which the program its
// driver downloads sets (finding 117) and the model does not follow beyond 0x1c14.
const SLAVE_E143 = 0x70, SLAVE_48 = 0x48;
const EVENT_E143 = { down: 0, move: 2, up: 1 }, EVENT_48 = { down: 2, move: 3, up: 0 }, EVENT_48_TAP = 1;
const REPORT_48 = 0x0000, STATUS_48 = 0x1C0A, STATUS_RELEASE = 0x02, TAP_NS = 150e6;
const VERSION_48 = 0x1C14, VERSION_48_VALUE = [0xC4, 0x00];

// The controller's data at a register for a touch {action, x, y, held_ns: an up's lab time since its down} on a panel h
// pixels high (flip: E143's y counted from the bottom; the player's mutant no-flip serves it unflipped), or null for a
// register it does not model
export const TOUCH_CONTROLLERS = new Map([
  [SLAVE_E143, {
    report(t, h, flip = true) {
      const ry = flip ? h - 1 - t.y : t.y, count = t.action === 'up' ? 0 : 1;
      return new Uint8Array([count, (EVENT_E143[t.action] << 6) | (t.x >> 8), t.x & 0xFF, (0 << 4) | (ry >> 8), ry & 0xFF, 0, 0, 0xC0 | 0x0F, 0xFF, 0xFF, 0xFF]);
    },
    read(addr, n, t, h, flip) { return addr === 2 && n <= 11 ? this.report(t, h, flip).slice(0, n) : null; },
  }],
  [SLAVE_48, {
    report(t) {
      const b = new Uint8Array(10);
      b[1] = t.action === 'up' && t.held_ns < TAP_NS ? EVENT_48_TAP : EVENT_48[t.action];
      if (t.action !== 'up') {
        b[0] = 1; b[2] = 0x01;
        b[3] = t.x & 0xFF; b[4] = t.y & 0xFF; b[5] = (t.y >> 8) << 4 | (t.x >> 8);
      }
      return b;
    },
    read(addr, n, t) {
      if (addr === REPORT_48 && n <= 10) return this.report(t).slice(0, n);
      if (addr === STATUS_48 && n === 1) return Uint8Array.of(t.action === 'up' && this.report(t)[1] === EVENT_48.up ? STATUS_RELEASE : 0);
      if (addr === VERSION_48 && n === 2) return Uint8Array.from(VERSION_48_VALUE);
      return null;
    },
  }],
]);
