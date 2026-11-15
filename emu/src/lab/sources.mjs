// What a picture the lab shows is, said at the picture, in words, where the lab already knows it: the frame on the
// page's screen and in a scripted session's shot (host/session.mjs: the shot record's source), and a picture the lab
// took in the Card panel. Provenance only: every sentence restates what the stand-ins' rows already say
// (src/lab/playui.mjs STAND_INS S-SCENE, S-RECVIEW, S-PLAYVIEW, S-RECFILE, S-JPEGENC, S-EXIFPRM); nothing here changes
// what is drawn. The two pages carry SOURCES verbatim (web/play.html, web/index.html: test/test_sources.mjs checks
// it) and pick from it as the functions below do.
// - a frame is the lab's: the VSC model's composite of the planes the firmware programmed for the shown device, never a
//   capture of a panel. Once a scene input has turned S-SCENE's live view on in the session (the player's scene_used,
//   which stays: S-SCENE among the stand-ins in use), what its image plane holds is S-SCENE's: the drawn scene (the
//   live view; the frame S-RECVIEW and S-PLAYVIEW hold for the rec view and playback) or black (the live view turned
//   off again, the through image stopped under S-THROUGH, a played picture taken without the live view: src/lab/play.mjs
//   scene_blank, scene_frame, scene_playview). Before that it holds no live-view image.
// - a picture taken in the session has the lab's pixels (src/lab/jpeg.mjs: S-SCENE's frame at the capture, each 8 x 8
//   block its mean; black without the live view), under the firmware's own file header where its recorder runs
//   (S-JPEGENC, the Exif from S-EXIFPRM's inputs) and as the lab's whole file elsewhere (S-RECFILE, no EXIF).
// Worker-safe: no import.
const FRAME = (dev) => `the lab's ${dev} frame: the VSC model's composite of the planes the firmware programmed, not a capture of a panel`;
const SCENE_ON = 'S-SCENE\'s live view has been on in this session: what the image plane holds (the live view, and the frame held for the rec view and playback) is S-SCENE\'s, its drawn scene or black (its live view off or stopped, a picture taken without it), not a sensor image and not the camera\'s development';
const SCENE_OFF = 'S-SCENE\'s live view has not been on in this session: it holds no live-view image';
const PIXELS = 'S-SCENE\'s frame at the capture with each 8 x 8 block its mean (black without the live view), not the camera\'s development';
const ELSEWHERE = 'A file put on the card from elsewhere is what it was.';
export const SOURCES = {
  frame: {
    tft: { off: `${FRAME('TFT')}; ${SCENE_OFF}`, on: `${FRAME('TFT')}; ${SCENE_ON}` },
    evf: { off: `${FRAME('EVF')}; ${SCENE_OFF}`, on: `${FRAME('EVF')}; ${SCENE_ON}` },
  },
  picture: {
    header: `A picture taken in this session is the firmware's own file header (its Exif filled from S-EXIFPRM's inputs) followed by the lab's JPEG (S-JPEGENC): ${PIXELS}. ${ELSEWHERE}`,
    file: `A picture taken in this session is S-RECFILE's file, a JPEG the lab encodes, with no EXIF: ${PIXELS}. ${ELSEWHERE}`,
  },
};
// The frame of a device ('tft' or 'evf'); scene: S-SCENE is among the session's stand-ins in use
export function frameSource(device, scene) {
  if (device !== 'tft' && device !== 'evf') throw new RangeError(`frameSource: device ${JSON.stringify(device)}: tft or evf`);
  return SOURCES.frame[device][scene ? 'on' : 'off'];
}
// A picture the session took, by the stand-ins in use (the status's stand_ins): '' where the lab writes none (a body
// without the card's file system)
export function pictureSource(standIns) {
  const used = new Set(standIns ?? []);
  return used.has('S-JPEGENC') ? SOURCES.picture.header : used.has('S-RECFILE') ? SOURCES.picture.file : '';
}
