// S-HDMISINK: the sink the lab puts on the HDMI port (src/dev/hdmi.mjs, the play input hdmi plug; docs/hle-gaps.md 4.9):
// a 1080p60 monitor's EDID composed for the lab by the VESA E-EDID 1.3 and CTA-861 layouts, not captured from a
// monitor. Base block: manufacturer ZZZ (no vendor), product 1, serial 0, week 1 of 2026; digital input, 60 x 34 cm,
// gamma 2.2, RGB, the preferred timing first; sRGB chromaticity; 640x480, 800x600, 1024x768 at 60 Hz established,
// 1920x1080 at 60 Hz standard; the descriptors 1080p60 (148.5 MHz), range limits 56-76 Hz / 30-83 kHz / 170 MHz,
// the name "OM-EMU LAB" (the third descriptor, where the firmware's parse copies the name from) and a dummy; one
// extension. Extension: CTA-861 revision 3 (basic audio, YCbCr 4:4:4 and 4:2:2, one native timing), a video block
// with VICs 16 (native, 1080p60), 4, 3, 2, 1, an audio block (LPCM, 2 channels, 32 / 44.1 / 48 kHz, 16 / 20 / 24
// bits), the HDMI vendor block (IEEE OUI 00-0C-03, physical address 1.0.0.0) and the 1080p60 timing again. Each block
// ends in its checksum.
const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
const DTD_1080P60 = [0x02, 0x3a, 0x80, 0x18, 0x71, 0x38, 0x2d, 0x40, 0x58, 0x2c, 0x45, 0x00, 0x58, 0x54, 0x21, 0x00, 0x00, 0x1e];
export const SINK_NAME = 'OM-EMU LAB';
export const SINK_VICS = [16, 4, 3, 2, 1];

// a block's checksum byte: its 128 bytes sum to 0 mod 256
function checksum(b) {
  let s = 0;
  for (let i = 0; i < 127; i++) s += b[i];
  b[127] = (256 - (s & 255)) & 255;
  return b;
}
// The sink's EDID, 256 bytes. checksum: false leaves the base block's checksum off by one (a negative control: the
// firmware retries the block and gives up, docs/hle-gaps.md 4.9).
export function sinkEdid({ checksum: valid = true } = {}) {
  const base = new Uint8Array(128);
  base.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
  base.set([0x6b, 0x5a, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 1, 2026 - 1990, 1, 3], 8);
  base.set([0x80, 60, 34, 0x78, 0x0a], 20);
  base.set([0xee, 0x91, 0xa3, 0x54, 0x4c, 0x99, 0x26, 0x0f, 0x50, 0x54], 25);
  base.set([0x21, 0x08, 0x00], 35);
  base.set([0xd1, 0xc0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 38);
  base.set(DTD_1080P60, 54);
  base.set([0, 0, 0, 0xfd, 0, 56, 76, 30, 83, 17, 0x00, 0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20], 72);
  base.set([0, 0, 0, 0xfc, 0, ...ascii(`${SINK_NAME}\n`.padEnd(13, ' '))], 90);
  base.set([0, 0, 0, 0x10, 0], 108);
  base[126] = 1;
  const data = [0x40 | SINK_VICS.length, 0x80 | SINK_VICS[0], ...SINK_VICS.slice(1),
    0x23, 0x09, 0x07, 0x07,
    0x65, 0x03, 0x0c, 0x00, 0x10, 0x00];
  const ext = new Uint8Array(128);
  ext.set([0x02, 0x03, 4 + data.length, 0x71, ...data]);
  ext.set(DTD_1080P60, 4 + data.length);
  checksum(base); checksum(ext);
  if (!valid) base[127] ^= 1;
  const edid = new Uint8Array(256);
  edid.set(base);
  edid.set(ext, 128);
  return edid;
}
