// REC_FILE natively on E143, E146 and E147, on the E144 family's E144, E148, E139, E134, E137, E142, E140 and
// E125, on E130, E133 and E129, whose REC is the version before the family's, and on the E118 family's E122, E118
// and E120 (src/fw/models.mjs rec_native; docs/hle-gaps.md 4.8.10, docs/model-survey.md findings 131 to 136): S2's
// picture
// file recorded by REC_FILE's own task from the packet REC_IMAGE posts it, with the file's header made by REC_IMAGE's
// own header maker. Addresses and offsets are E143's (D unless tagged); each body's are the ones the rule reads (fact
// 'rec_file', src/fw/facts.mjs recFile, on the E144 family recFileQueue, on E130, E133 and E129 recFileInline, on
// the E118 family recFileFrame). The other bodies keep S-RECFILE (src/lab/storage.mjs).
//
// REC's packet (316 bytes): its fields by the firmware's own names, from the packet dump 0x50541561 (D). REC_MAIN
// builds it (0x50539e89..0x50539f0e clear it), REC_IMAGE posts it to REC_FILE's queue REC_EXEC_FILE 69 (0x6004324e)
// with 0x5053990f after its image (0x50542359; for the modes 4100, 4103, 4105 and 4115 at once, 0x50541f16): of the six
// references to the queue's id, three are REC_FILE's own (its init 0x5053f189, its receive and its exit), two
// REC_IMAGE's and one the object-name list's, so nothing else posts to it (D). REC_FILE (task 27, 0x5053f1a4) waits on
// flag 265 (0x60043182) for the pattern 3: 2 the queue (its receive 0x5054dd40, 316 bytes, then the handler 0x5053f354,
// which returns to 0x5053f20d), 1 REC's packet ring (its receive 0x5054ebc8(1), then the same handler, returning to
// 0x5053f249). The queue post after the image is not a normal JPEG's (E143, docs/hle-gaps.md 4.3.3, D): REC_IMAGE's
// 0x505422f1 posts there only where 0x5054ca14 gives 0 (Mode 4097 with the record's +38006 not 0 and 0x5054bf6c not 0,
// which needs the record's +38764 to be 22); a normal JPEG goes into the ring (0x5054eaf0, 120 slots of 316 bytes at
// 0xa3323a38) and REC_FILE's flag is set across the cores (0x5054de46, by REC's bind table 0xa332ce5c, entry 7:
// REC_FILE's flag, pattern 1, core 0, then cpu_conn 0x50035afd). E146 and E147 (D): the packet is 276 bytes with other
// offsets (their dump's), and REC_IMAGE keeps the image's address and size not in it but in an image record of 52
// bytes that the packet's +180 points at, which REC_IMAGE's task keeps on its stack and inits itself; REC_FILE is
// task 27 and REC_IMAGE task 28 there too, and a normal JPEG takes the same ring (docs/hle-gaps.md 4.3.5).
// The E144 family's REC version (D on E144, docs/model-survey.md findings 118 to 123): the packet is 300 bytes, every
// field in it; REC_FILE (task 31 on E144) waits on its queue alone, with no event flag, and REC_IMAGE's
// rec_make_image_finish posts a still's packet to that queue (S-RECIMAGE's post is that route there); the EXIF init
// flushes no cache and rec_jpeg_exec clears no header area through the image engine (no K-CFLUSH answer, no fill stood
// in); the clock read is the rule's. No rule reads REC_IMAGE's task there (fact 'rec_image' is recFile's version's).
// The REC version before the family's (E130, E133 and E129; D on E130, docs/model-survey.md findings 131 to 136, the
// addresses at src/fw/facts.mjs recFileInline): the packet is 284 bytes with other offsets (REC_MAIN fills it from
// the request it dumps field by field; the names here are E143's for the same uses, I); REC_FILE (task 30) waits on
// its queue alone and inlines its start and finish; its record step is rec_make_file, which keeps its file context
// (84 bytes) on its own stack and records through the whole-file recorder's builders, so the lab reads the file's
// fnode and stamp at the registration's entry (fact rec_file.context, contexts null); it reads no Media2 and no
// RecordDevice (null: not written); REC_IMAGE's task posts a still's packet to REC_FILE's queue (S-RECIMAGE's post
// is the camera's route) with Free set from rec_bracket_update's result, 1 for the frame that ends a shot, and
// REC_FILE then answers the requester's ObjResponse queue with the status (also where Dst is 0): S-RECIMAGE sets
// Free and takes the reply (fact rec_file.reply), as S-RECREQ does on E143; the EXIF init flushes no cache,
// rec_jpeg_exec clears no header area, and the header maker divides by no crop area (it makes the area from
// ImgAspect and the image size's code: crop [])
// The E118 family's REC version (E122, E118, E120; D on E122, docs/model-survey.md findings 143 to 146; every address
// and offset the rule's, src/fw/facts.mjs recFileFrame, with E122's as its evidence: this file names none of them,
// src/lab's literals being E143's, bin/port.mjs): the packet is 216 bytes (280 on E118 and E120) with no dump, its
// fields read from the code that uses them; REC_FILE (task 33) keeps it on its stack and waits on its queue
// REC_EXEC_FILE alone, to which REC_IMAGE's task posts a still's packet with REC's post; it calls rec_make_file (E118
// through rec_file_destination_record, by RecordDevice bit 0), whose rec_file_record keeps the file context in its
// own frame and makes the DCF steps itself: the open (code 0x32), the reservation, a call of the file system's
// allocation in REC_FILE's own task, the chain write, a message {REC_POST_FILE, , 0x54, block} to the file module
// with the reply read from the queue REC_POST_FILE, which FILECLBK's reply answers natively, the directory entry
// (0x66) and the registration (0x33); then the buffer freed to REC's pool, the shot's DCF checkout (no pending entry:
// REC's checkout warning, E143's) and, unless the packet's Free is 0 and its Dst is not, REC's reply {Status, +16,
// +20} to the packet's ObjResponse. The EXIF init flushes no cache, rec_jpeg_exec takes the file's buffer from REC's
// pool, clears no header area and sets BuffAddr1 / BuffSize1 itself, and the header maker divides by none of the
// block's zeros (no crop area, no zoom ratio set)
//
//   H-EXIFINIT  the EXIF module's init (0x504298bd, the start function's call at 0x501e9a7c, not run by the lab)
//               natively before the first picture: the EXIF parameter template (0x62a6c358, 92252 bytes; 0x5042aca2:
//               the versions 0231 / 0100, R98, and Make and Model from the settings store, ids 11073 and 25329, through
//               0x5042ceb5), then the cache flush K-CFLUSH 0x5004e68a (called from 0x504298ef), answered
//   H-RECINIT   REC's module init (0x50539665, the start function's call at 0x501e9806) natively before the first
//               picture: its queues bound to its tasks' flags (REC_FILE's at 0x5053f189), REC's memory pools
//               (0x5054b00d)
//   H-RECFILE   REC_FILE (task 27) started with act_tsk, as the start function starts REC's tasks after the init (I:
//               which call starts it is not read); it then waits on its flag (the E144 family's on its queue)
//   H-RECPRECON (where the rule reads the EXIF set, exif.set: E143, E146, E147) IMG_PRECON's module init (0x502a49b3,
//               USTART2's stage's call at 0x501e8ec0, which the lab's start does not run) natively before the first
//               picture, unless H-EXPINIT ran it (src/lab/take.mjs, --take probe with --cpu2 native): its two queues
//               bound to its flag (0x5002c285), its 13 settings from id 50674 on reset to their defaults (0x50041dbc;
//               X: the values the lab's store holds already), properties copied from the settings store (0x5004188b)
//               and the white-balance preset table 0xa31f1bd0 (0x5039950e), whose rows the EXIF set's gains read
//               (docs/hle-gaps.md 4.3.11)
//   S-EXIFPRM   the shot's EXIF parameter block (pExifParam, the packet's +28; on the camera TAKE's per-shot record,
//               0x503afc3e(HandleTarget), 92252 bytes), as TAKE's takepic hands it to REC, whose shooting values
//               takepic fills and the lab does not run: the template copied by TAKE's own copy (0x504298f9, TAKE's
//               call 0x503bba70); the camera's clock read natively (0x5012b7cd) into the capture's time record at
//               +37800 (I: TAKE's; the EXIF set formats the dates from there, 0x5042c16e); the crop areas +40858 (JPEG)
//               and +40866 (RAW), whose zero the header maker would divide by and which neither the EXIF set (D: no
//               access in 0x5042b50d..0x5042cd6f; X: 0 after it) nor REC writes, {0, 0, 1, 1} (I: the full frame, by
//               0x5054a031..0x5054a0ad's arithmetic (x + 1) * width / xden - 1); the fields REC_IMAGE reads that
//               TAKE's fill takes from the settings store (below); then, where the rule reads it (exif.set: E143, E146,
//               E147), the EXIF set natively (0x5042992d, takepic's call at 0x503bd48e with a0 the block;
//               docs/hle-gaps.md 4.3.11): the dates (0x5042c16a..0x5042c196: 0x5012bd20 with the format 0x4200 into
//               DateTimeOriginal +4089, copied to CreateDate +4109 and DateTime +1364), the digital zoom ratio +4228
//               (EXIF 0xa404; X: 0/100, which the header maker 0x504287f1 divides by its denominator), the maker
//               notes' white-balance gains from H-RECPRECON's table (TAKE's arithmetic block 0x5039821c, 18 calls,
//               X; with the table's zeros it divides by zero at 0x50398ca5, X) and the shooting values from takepic's
//               fields (0x503bcdac..0x503bcee1: Tv +38164 and Av +38178 from its exposure record, Sv +38174 from
//               TAKE's state), which stay the template's 0: their source is TAKE_MAIN's request, not run in the lab
//               (D), so ExposureTime is the set's 1 s of Tv 0 (0x50573517 from 0x5042c41f), FNumber 0/10 (the lens
//               flag +37982 bit 12 clear, 0x5042c460) and focal length, the lens and the image size the template's.
//               Where the rule reads no EXIF set (the E144 family, recFileInline's and the E118 family's versions) it
//               does not run, and S-EXIFPRM formats the dates natively as it does and sets the zoom ratio 1/1 (I: no
//               digital zoom), the shooting values the template's 0. Also the record's fields REC_IMAGE
//               reads (below) that TAKE's fill takes from the settings store, each
//               read natively with the settings read 0x500417da as TAKE's fill reads it (D): the bracket's +38074,
//               +38076, +38078, +38080 (ids 35217, 38737, 38769, 38785, halfwords) and +38086 (id 40401, a byte), from
//               0x503bbd26..0x503bbd98, from which rec_bracket_entry (0x5053b1dc) takes the last frame's index
//               (0x5053b33f..0x5053b375; with them 0 it is 65535 and REC_IMAGE loops, X), and the aspect +38122 (id
//               12417, a byte, 0x503bc035..0x503bc044), which rec_bracket_update makes the packet's ImgAspect
//               (0x5053b45d..0x5053b469); on E146 and E147 at the offsets the rule reads (+37726.., the aspect +37774)
//   REC_IMAGE's own task makes the packet's file buffer and header and hands it to REC_FILE natively, from the packet
//   REC_PREPRO's task posts it (H-RECIMAGE, S-RECREQ; docs/hle-gaps.md 4.3.3; on E146 and E147 since 2026-11-10, at
//   the addresses the rule reads, fact 'rec_image', src/fw/facts.mjs recImage, docs/hle-gaps.md 4.3.5, where the post
//   to REC_IMAGE's queue is REC_RAWNR's, the task REC_PREPRO posts a normal still to there, D):
//   H-RECSHARED REC's shared objects' init (0x5054dbe8: the packet rings' heads 0xa33235fc and slots 0xa3323a38, the
//               flag bind table 0xa332ce5c with REC_FILE's flag at entry 7, its done byte 0xa332ce59), natively before
//               the first picture: on the camera REC_MAIN_CPU2's task (0x5053d5dc) runs it at its start on CPU 2
//               (0x5053d5e4; also 0x5054ede9), which the lab does not run. Without it REC_IMAGE's set of REC_FILE's
//               flag finds no entry and REC_FILE never takes the packet (X)
//   H-RECIMGPRO the image library's IRQ attach (0x5048c3a0), its request ids' bitmap clear (0x5048ba3a) and the imgpro
//               unit's init (0x5050a6b2) natively before the first picture where the application's start did not run
//               them (camapp 3's H-IMGPROINIT does): REC's header clear asks the unit for a fill (below), whose end
//               comes as IRQ 300 (docs/hle-gaps.md 4.3.1)
//   H-RECIMAGE  REC_IMAGE (static task 28, 0x50541c45) started with act_tsk after REC_FILE (I: which call starts it is
//               not read); it waits on its queue REC_EXEC_IMAGE 70 (its id at 0x60043250; its receive 0x505398bf, 316
//               bytes) and handles each packet in its own task: rec_bracket_entry and _update (0x5053b1dc, 0x5053b39c:
//               FileType, ImgAspect, Free), rec_make_image_pre (0x50541db7), rec_make_image (0x50541e55) by Mode to
//               rec_make_image_exec (0x5054208e) and rec_jpeg_exec (0x505497e5: the buffer from REC's pool 3, the
//               header clear, whose aligned middle the imgpro unit fills (0x5048ee61, kind 14 mode 4, S-IMGPRO), the
//               encode (S-JPEGENC), rec_jpeg_make_header, BuffAddr1 / BuffSize1), rec_make_image_finish (0x50541ec5) to
//               0x505422f1, which hands the packet to REC_FILE through REC's ring (above), and pAlive's word cleared
//               (0x50541d5f), for each frame until rec_bracket_finish (0x5053b761) finds the last done
//   S-RECREQ    the request REC_IMAGE takes, where TAKE, api_rec, REC_MAIN and REC_PREPRO do not run: the packet as
//               REC_MAIN builds it (the fields below, every other 0 as its clear leaves it; ImgAspect left to
//               REC_IMAGE) with pAlive (+0) a word of the lab's, set to 1, posted to REC_IMAGE's queue with REC's post
//               0x5053990f as REC_PREPRO's task posts it after rec_precon_exec (0x5054edcf: the only post to that queue
//               on CPU 0, D); and the requester's side of REC_FILE's completion: with the packet's Free set
//               (REC_IMAGE's rec_bracket_update sets it, X) REC_FILE replies {Status, Number, Packet} to the
//               ObjResponse queue (0x5053984b from its handler, 0x5053f3bb), which no requester owns in the lab
//               (ObjResponse 0): the reply is taken there and answered as sent. Lab time runs until the reply and until
//               REC_IMAGE and REC_FILE wait on their inputs again. (S-RECIMAGE on E146 and E147 retired 2026-11-10:
//               REC_IMAGE runs natively there, its rec_jpeg_exec in its own task; docs/hle-gaps.md 4.3.5)
//   S-RECIMAGE  (the E144 family) REC_IMAGE's part (its task does not run there: its addresses are not read by a rule):
//               the packet as REC_IMAGE hands a single-slot JPEG to REC_FILE (the fields below), REC_IMAGE's
//               rec_jpeg_exec run natively on it, which allocates the file's buffer from REC's pool 3 (0x5054bb12),
//               clears the header area, has the image made (S-JPEGENC), builds the header with rec_jpeg_make_header
//               (0x50549bf1: the EXIF parameters, SOI, APP1 Exif by the EXIF module's serializer 0x50429935 with its
//               Olympus maker notes and IFD1's thumbnail slot, APP1 XMP; HeaderSize 41984) and sets BuffAddr1 /
//               BuffSize1 to Addr / Size (0x50549a00); then REC_IMAGE's post 0x5053990f natively, and lab time runs
//               until REC_FILE has handled the packet (its handler's return, 0x5053f20d). On the E144 family that post
//               to REC_FILE's queue is the route rec_make_image_finish takes for a still (docs/model-survey.md finding
//               119); on E143 a normal JPEG goes through REC's ring (above, docs/hle-gaps.md 4.3.3). Where the body
//               keeps the image in an image record (E146 and E147, not the E144 family) the record first: REC_IMAGE's
//               own init of it on a record the lab allocates. On the E118 family the packet is REC_IMAGE's for a
//               still as far as REC_FILE and rec_jpeg_exec read it (Mode 4097, HandleTarget 1, pExifParam, Media 0,
//               FileType 1 as a halfword, the extension table's `JPG`; ImgAspect 1; on E118 RecordDevice 1, the card;
//               NoRecord, Free and Dst 0, I: what REC_IMAGE's rec_bracket_update gives Free is not read), and with
//               Free 0 and Dst 0 REC_FILE replies to the packet's ObjResponse, which no requester owns in the lab
//               (ObjResponse 0): the reply is taken at REC's reply and answered as sent, as S-RECREQ takes E143's
//   S-JPEGENC   the image pipeline's work inside rec_jpeg_exec, where the lab has no image pipeline: the JPEG encode
//               writes the lab's JPEG stream (src/lab/jpeg.mjs, without its JFIF APP0: SOI, DQT, SOF0, DHT, SOS, the
//               data, EOI) at Addr + HeaderSize and sets Size (+192; on E146 and E147 the image record's +12) to
//               HeaderSize + the stream's length (I: the file's size, as REC_FILE writes BuffSize1 bytes from
//               BuffAddr1); the header maker, which runs after the encode (0x505498ab, then 0x505498c3), ends its XMP
//               segment 2 bytes past HeaderSize and writes them (X: 0a 00), over the stream's SOI (I: the camera's
//               encoder, too, writes a whole JPEG there). rec_jpeg_make_image (0x50549b42) runs in turn
//               rec_ImgPro_CreateParam (0x50542363), the image library's create (0x50491699), rec_ImgPro_ImageParam
//               (0x50542528), the run (0x50542407: 0x50492758, 0x504929e9), rec_ImgPro_Jpeg_Result (0x50542ce1) and the
//               release (0x5054322e) (D). Where REC_IMAGE runs natively (E143; E146 and E147 at the points the rule
//               reads, fact 'rec_image' encode, since 2026-11-11) all run natively but three steps from the first
//               the lab cannot run (docs/hle-gaps.md 4.3.4, 4.3.9): ImageParam's call of the library's parameter set
//               (0x50542c97 to 0x50491c9f) is skipped with the status 0, the run returns 0, and Jpeg_Result writes the
//               stream and Size. The set divides the request's white balance R and B gains by the smaller of its two
//               G gains (0x505099e0 from 0x50509ac9), which ImageParam copies from the shot record's +37810.. and
//               REC_PREPRO's rec_precon_wb_exec fills on the camera: 0 here (X, D). ImageParam's body natively asks
//               TAKE's shot table for its four sources' buffers (rec_ImgProCtrl_Src_Bayer, _Thumb, _ThumbICam1,
//               _ThumbICam2, by HandleTarget), which TAKE does not fill in the lab: each logs 0x25000402 and gives
//               handle 0, for which MM's handle-to-address 0x50534dd1 logs 0x08010004 (X; the record's errlog, the
//               logs from the post to the parameter set's call). Natively Jpeg_Result sets Size to
//               HeaderSize + the library's primary size and then copies 51200 bytes from the record's +41052 after
//               the primary with a kind 13 request to the imgpro unit, Size grown by as much (D); the lab makes
//               neither (with the lab's PlayPic 1 it would add the preview's length too, X, D). What the run would do
//               (docs/hle-gaps.md 4.3.9): it builds one request of the image library's kind 0 (D), whose pipeline
//               unit at 0x9c200000 starts the JPEG codec at 0x99900000 / 0x99901000, which takes no buffer address of
//               its own (D), so the primary is made in the development's pass from the shot's Bayer source (I); the
//               lab has neither the unit nor the source, so the run stays stood in, with the lab's stream. On the
//               E144 family rec_jpeg_make_image as a whole, in S-RECIMAGE's call. (Until 2026-11-10 on E146 and
//               E147 also the header clear's fill, which runs natively on the imgpro unit now that REC_IMAGE's
//               task does, 4.3.5; until 2026-11-11 on E146 and E147 rec_jpeg_make_image as a whole)
//
// REC_FILE then runs natively in its task: rec_file_destination_record (0x50540345) by RecordDevice bit 0 to
// rec_make_file (0x5053f294) and rec_file_record (0x5053fec0): the DCF open of the next number (0x5054a894), the
// cluster reservation (0x5054a9e3), the chain write (0x5054aa51), the directory entry (0x5054acea) and the registration
// (0x5054ae50), each a FILECLBK request; then the buffer freed to its pool (0x5054bbfd), the shot's DCF checkout
// (0x50540784 -> 0x5087e0de: no pending entry, 0xd01, REC's warning 0x1e001001: the media check-in, api 0x5040f2ec from
// the HLS side, does not run), and the release of the resources REC_MAIN would have taken (0x50540cac: 0x500044f2 with
// 101..104 refused, warnings 0x1e01500d). With Free (+302) 0 REC_FILE sends no completion: with it set it replies
// {Status, Number, Packet} to the ObjResponse queue (+32, 0x5053984b) and posts the HandleTarget's events (0x50025095,
// 0x5054059e..0x505405ae), which only a requester (TAKE through api_rec, which does not run) would take: REC_IMAGE
// sets Free, so S-RECREQ takes the reply (the events' 0x50025095 returns at once unless 0xa31f1d26 is 119, D).
import { FirmwareError, runtime, disasm, where } from './hle.mjs';
import { pack } from '../util/bytes.mjs';
import { K_CFLUSH } from './menu.mjs';
import { MODEL_INFO, fact, A } from '../fw/model.mjs';
import { REC_FILE_E143, REC_IMAGE_E143 } from '../fw/facts.mjs';

export class RecError extends FirmwareError {}

const h8 = (v) => '0x' + (v >>> 0).toString(16).padStart(8, '0');
// REC_FILE natively on a body that gives rec_native (src/fw/models.mjs), at the addresses and layouts the rule reads
// (fact 'rec_file', src/fw/facts.mjs recFile, with their evidence): E143's REC_FILE_E143 there, the EXIF init
// 0x504298bd with its cache flush's return 0x504298f6 (H-EXIFINIT), the template 0x62a6c358 (0x504298c6) and TAKE's
// copy of it to a shot 0x504298f9, REC's init 0x50539665 (H-RECINIT), REC_FILE 0x5053f1a4 with its flag 0x60043182,
// its queue 0x6004324e and its handler's return 0x5053f20d, REC_IMAGE's post of a packet (a0) to a queue (d0)
// 0x5053990f, rec_jpeg_make_image 0x50549b42 (where recImage reads S-JPEGENC's points), the clock read 0x5012b7cd
// (fact 'recorder'), the date
// format 0x5012bd20 and the string copy 0x50003843, REC_FILE's file contexts (92 bytes) for Media 0 and Media 1
// 0x62a8c4e4 and 0x62a8c540 (picked by Media's value, 0x5053ff29; not Media's and Media2's, as said before
// 2026-11-11). The bodies' differences (E146 and E147: the packet of 276 bytes with other offsets, the
// image's address and size in REC_IMAGE's image record, another EXIF parameter block's size and offsets past its
// tags; the E144 family, by recFileQueue: the packet of 300 bytes, REC_FILE's queue with no flag, no cache flush and
// no fill (cflush and fill null), one file context or two, the clock read clock_read; E130, E133 and E129, by
// recFileInline: the packet of 284 bytes, no Media2 or RecordDevice, the context on rec_make_file's stack, REC_FILE's
// reply) are the rule's values; docs/hle-gaps.md 4.8.10
export const REC_NATIVE = MODEL_INFO.rec_native === true;
// REC_IMAGE's task natively (H-RECSHARED, H-RECIMGPRO, H-RECIMAGE, S-RECREQ; docs/hle-gaps.md 4.3.3, 4.3.5), wherever
// REC_FILE runs natively in recFile's REC version (E143, E146, E147; the E144 family's keeps S-RECIMAGE), at the
// addresses the rule reads (fact 'rec_image', src/fw/facts.mjs recImage, with their evidence; E143's REC_IMAGE_E143
// there, the values given here by hand before the rule):
//   task      REC_IMAGE: static task 28, its entry, the word that holds its queue's id (REC_EXEC_IMAGE 70; read by its
//             receive 0x50541c4e, by REC_PREPRO's post 0x5054edda and by the object-name list, which only names it)
//   shared    REC's shared objects' init (REC_MAIN_CPU2's start, 0x5053d5e4) and its done byte (0x5054dd19)
//   imgpro    the image library's IRQ attach, its id bitmap's clear and the imgpro unit's init (camapp.mjs
//             H-IMGPROINIT's three), run by H-RECIMGPRO where the application's start did not run them
//   reply     REC's reply to a packet's ObjResponse (a0 the packet, d0 the status) and REC_FILE's call of it at its
//             handler's end (the return 0x5053f3c0, after its completion 0x5054051e and with Free set, 0x5053f3a5)
//   alive     pAlive's offset in the packet (the dump's first field), which REC_IMAGE clears after its image
//             (0x50541d5f)
//   settings  the settings read (d0 the id, a0 0 the store, d1 0), TAKE's at each of the reads below
//   take      TAKE's fill of the shot's record from the settings store: [setting id, record offset, bytes] as it reads
//             each (0x503bbd26..0x503bbd98 the bracket, 0x503bc035..0x503bc044 the aspect)
//   encode    S-JPEGENC's points inside rec_jpeg_make_image (docs/hle-gaps.md 4.3.4, 4.3.9; E143's were given here by
//             hand, REC_ENCODE_E143, until 2026-11-11, while E146 and E147 kept rec_jpeg_make_image as a whole):
//             rec_ImgPro_ImageParam's call
//             set_call (a call d32, 7 bytes) of the image library's parameter set (set), which divides the request's
//             white balance gains; the run; rec_ImgPro_Jpeg_Result (result), which sets Size; and, run natively and
//             observed, the release and the create's handle, at id in the image (the packet's ImgProID[0], the dump's
//             +36; on E146 and E147 the image record's +0; checked against the handle ImageParam hands the set in
//             d0); packet: ImageParam's frame slot of its a0, the packet (0x50542528), at the set's call
export const recImageFacts = () => fact('rec_image', REC_IMAGE_E143);
// the shot's EXIF parameter block (S-EXIFPRM): the fields the lab writes are the rule's (exif: E143's the EXIF module's
// tag table at body 0x6058e0, {u16 tag, u16 type, u32 bytes, u32 offset}, gives DateTime 0x0132 +1364, DateTimeOriginal
// 0x9003 +4089, CreateDate 0x9004 +4109, DigitalZoomRatio 0xa404 +4228)
// the packet's fields (the dump 0x50541561's names: fact rec_file packet) and what S-RECREQ gives them; every other
// field 0, as REC_MAIN's clear leaves it (0x50539e89..0x50539f0e); ImgAspect REC_IMAGE sets from the record's aspect
// (S-RECIMAGE's below)
const STILL = 4097;          // Mode: REC_MAIN's still (0x5053a349); REC_IMAGE makes its image
const NO_MEDIA = 0xFFFF;     // Media2: no second slot (0x5053dd14)
const CARD = 1;              // RecordDevice bit 0: the card (0x50540392, 0x50540418)
const JPEG = 1;              // FileType: the extension and DCF kind tables' index 1 (0x5053fee3; JPG, kind 1)
const SHOT = 1;              // HandleTarget: TAKE's shot id (I: the lab's one shot; 0x5053a41e accepts 1..117)
// ImgAspect, S-RECIMAGE's (the E144 family): 1, which E143's aspect setting 12417 holds in the lab's store and its
// maker notes give as 4:3 (X, exiftool); where REC_IMAGE runs natively it sets it from the record's aspect (S-EXIFPRM)
const ASPECT = 1;
const JFIF_APP0 = 0xE0;
// REC_FILE's file context and its DCF block (src/lab/storage.mjs REC for the fnode's and dnode's fields): the same on
// E146 and E147 (D: rec_file_record stores the context's +78 and +52 as E143's does; X: their files' fnodes and
// folders read back through them match the card) and on the E144 family's eight (D on E144 and E142, the same stores;
// X, the same read back; docs/model-survey.md finding 120)
const CTX = { dcf: 8, fnode: 36, status: 84 }, DCF_STAMP = 16;
// (the E118 family's file, read at FILECLBK's reply) the DCF block's fnode (the open's back at +24, as E143's, D:
// src/fw/facts.mjs recFileFrame's record), FILECLBK's message {reply queue, word, code, block} (STORAGE_LIB there)
// and its reply of a message put back on its queue (src/lab/storage.mjs REQUEUE)
const DCF_FNODE = 24, MSG = { code: 8, block: 12 }, REQUEUE = 0xFFF0;
const SLICE_MS = 5, LIMIT_MS = 20000, WAI = 4;
// HeaderSize: rec_jpeg_make_header's (0x5054a5b9), and the header area rec_jpeg_exec reserves before the encode: its
// buffer's size estimate adds it (0x5054a7b3) and its clear covers it (0x5054986f); the encoder's stream follows it
// (I). E143's here; each body's is the rule's (jpeg.header: 41984 on E146 and E147 too)
export const HEADER = REC_FILE_E143.jpeg.header;
// IMG_PRECON's module init (H-RECPRECON), E143's, at its place in the build (bin/port.mjs; src/lab/take.mjs's H-EXPINIT
// runs the same function)
const PRECON_INIT = 0x502A49B3;
// the rule's facts for this model (E143's given at REC_FILE_E143); throws on a body without them
export const recFacts = () => fact('rec_file', REC_FILE_E143);

export class RecFile {
  // storage: src/lab/storage.mjs Storage (its session, its fnode and name layouts, the recorder's clock read)
  constructor(storage) {
    this.st = storage; this.s = storage.s; this.lab = storage.lab;
    this.R = recFacts();
    // the camera's clock read (S-EXIFPRM): the rule's where it reads one (recFileQueue, the E144 family's), else the
    // recorder's, the same function (fact 'recorder': E143's 0x5012b7cd, D)
    this.clock_read = this.R.clock_read ?? storage.f.recorder?.time;
    if (this.clock_read === undefined) throw new RecError('S-EXIFPRM: neither the rule (rec_file.clock_read) nor the recorder (fact \'recorder\') gives the camera\'s clock read');
    this.handled = null;           // the last packet's status at REC_FILE's handler return
    this.context = null;           // the last file's {fnode, dcf, stamp} where rec_make_file keeps its context on its
                                   // stack (recFileInline's version)
    this.reply = null;             // REC_FILE's reply to the last packet's requester, taken (recFileInline's version)
    this.pictures = 0;
    this.started = false;
    // REC_IMAGE natively (the rule's facts) where REC is recFile's version, REC_FILE on its flag (src/fw/facts.mjs
    // readPlacedFacts reads 'rec_image' there); the E144 family's (recFileQueue: REC_FILE on its queue alone, no flag)
    // keeps S-RECIMAGE
    this.image = this.R.task.flag !== null ? recImageFacts() : null;
    this.imgpro_init = false;      // H-RECIMGPRO run (the application's start had not run the image library's init)
    this.precon_init = false;      // H-RECPRECON run (H-EXPINIT had not run IMG_PRECON's init)
    this.exif_sets = 0;            // the EXIF set's native runs (S-EXIFPRM, where the rule reads it)
    this.images = [];              // each picture's REC_IMAGE run {task, encoded, reply, alive, fills, take}
    // the E118 family's REC version (recFileFrame): REC_FILE's file context is rec_file_record's frame's, so each
    // picture's file is read from the registration's block at FILECLBK's reply, and REC_FILE's reply is taken (the
    // rule's record steps; recFileInline's version has no file context either, but its registration's, context)
    this.frame = this.R.record !== undefined;
    this.records = [];             // (the family) each picture's REC_FILE run {requests, allocs, reply, file}
  }
  get header() { return this.R.jpeg.header; }
  // whether H-RECIMGPRO runs (or ran) at the first picture: where camapp 3's H-IMGPROINIT did not run at the start
  imgpro_by_rec() { return !!this.image && !this.s.camapp?.imgpro_inited; }
  // whether the EXIF set runs natively (the rule reads it), and whether H-RECPRECON runs (or ran) at the first picture:
  // there, where H-EXPINIT did not run IMG_PRECON's init
  exif_set() { return this.R.exif.set !== undefined; }
  precon_by_rec() { return this.exif_set() && this.s.camapp?.take?.exp_tid == null; }
  // H-EXIFINIT, H-RECINIT, H-RECFILE (with REC_IMAGE natively also H-RECSHARED, H-RECIMGPRO, H-RECIMAGE; with the EXIF
  // set natively also H-RECPRECON), at the first picture (I: in the lab nothing reads REC's or the EXIF module's state
  // before it, as TAKE, REC_MAIN and REC_PREPRO do not run; at the bring-up they would shift every later session's
  // instruction counts for no change the firmware sees)
  bring_up() {
    this.started = true;
    const lab = this.lab, R = this.R, X = R.exif, I = this.image;
    if (X.cflush !== null) lab.wrap(K_CFLUSH, (prev) => (h, r) => disasm(r.mdr) === X.cflush ? h.finish(r) : prev(h, r), 'K-CFLUSH');
    lab.call(X.init, null, null, null, 2000000);
    const make = this.text(X.template + X.tags.make, 24);
    if (!make) throw new RecError(`H-EXIFINIT: the EXIF template ${h8(X.template)} has no Make after the init`);
    if (this.precon_by_rec()) {
      const rc = lab.call(A(PRECON_INIT), null, null, null, 2000000).d0 & 0xFFFF;
      if (rc !== 0) throw new RecError(`H-RECPRECON: IMG_PRECON's init ${h8(A(PRECON_INIT))} returned ${rc}`);
      this.s.settle('H-RECPRECON');
      this.precon_init = true;
    }
    // REC's init returns 0, or 8191 after its error log where a part of it fails (D on E143 and E144; X: 0 on both)
    const ri = lab.call(R.init, null, null, null, 2000000).d0 | 0;
    if (ri !== 0) throw new RecError(`H-RECINIT: REC's init ${h8(R.init)} returned ${ri}`);
    this.s.settle('H-RECINIT');
    if (I) {
      lab.call(I.shared.init, null, null, null, 2000000);
      if (lab.sim.read(I.shared.done, 1)[0] !== 1) throw new RecError(`H-RECSHARED: REC's shared init ${h8(I.shared.init)} left its done byte ${h8(I.shared.done)} unset`);
      if (this.imgpro_by_rec()) {
        const unit = lab.sim.m.devices.imgpro;
        if (!unit) throw new RecError('H-RECIMGPRO: the board has no imgpro unit (src/fw/board.mjs imgpro)');
        for (const fn of I.imgpro) lab.call(fn, null, null, null, 200000);
        if (unit.powered || unit.runs) throw new RecError(`H-RECIMGPRO: the unit's init left it ${unit.powered ? 'powered' : 'with a run'}`);
        this.imgpro_init = true;
      }
    }
    lab.lt.allow.add(R.task.entry);
    const [rc] = lab.nk.svc('act_tsk', { d0: R.task.id });
    if (rc !== 0) throw new RecError(`H-RECFILE: act_tsk(${R.task.id}) = ${rc}`);
    this.s.settle('H-RECFILE');
    if (!this.waiting()) throw new RecError(`H-RECFILE: REC_FILE (task ${R.task.id}) is not waiting on its input after its start`);
    if (I) {
      lab.lt.allow.add(I.task.entry);
      const [rc2] = lab.nk.svc('act_tsk', { d0: I.task.id });
      if (rc2 !== 0) throw new RecError(`H-RECIMAGE: act_tsk(${I.task.id}) = ${rc2}`);
      this.s.settle('H-RECIMAGE');
      if (!this.waiting(I.task.id)) throw new RecError(`H-RECIMAGE: REC_IMAGE (task ${I.task.id}) is not waiting on its queue after its start`);
    }
    this.st.log.push(['rec', `EXIF template Make '${make}', REC_FILE (task ${R.task.id})${I ? ` and REC_IMAGE (task ${I.task.id})` : ''} waiting`]);
  }
  text(a, n) { return String.fromCharCode(...this.lab.sim.read(a, n)).replace(/\0[\s\S]*$/, '').trimEnd(); }
  // a task waiting without a timeout (REC_FILE by default)
  waiting(t = this.R.task.id) {
    const lab = this.lab;
    return (lab.nk.state(t) & 0xF) === WAI && !lab.nk.timed_waiters().includes(t);
  }
  // S-EXIFPRM: the shot's EXIF parameter block; returns its address and the capture's clock record
  exif_param() {
    const lab = this.lab, sim = lab.sim, X = this.R.exif, D = X.date, x = lab.alloc(new Uint8Array(X.size), 64);
    lab.call(X.copy, { a0: x }, null, null, 2000000);
    lab.call(this.clock_read, { a0: x + X.time }, null, null, 2000000);
    for (const at of X.crop) sim.write(x + at, pack('<HHHH', 0, 0, 1, 1));
    // the fields REC_IMAGE reads that TAKE's fill takes from the settings store, read as it reads them (where REC_IMAGE
    // runs natively); the EXIF set reads the aspect too (0x5042c356)
    const take = {};
    for (const [id, at, n] of this.image?.take ?? []) {
      const v = lab.call(this.image.settings, { d0: id, d1: 0, a0: 0 }, null, null, 2000000).d0 & (n === 1 ? 0xFF : 0xFFFF);
      sim.write(x + at, n === 1 ? Uint8Array.of(v) : pack('<H', v));
      take[id] = v;
    }
    if (this.exif_set()) {
      // the EXIF set natively, as takepic calls it once its fill is made: the dates, the zoom ratio, the gains
      lab.call(X.set, { a0: x }, null, null, 2000000);
      this.exif_sets += 1;
    } else {
      lab.call(D.format, { a0: x + D.original, a1: x + X.time, d0: D.code }, null, null, 2000000);
      for (const to of [D.created, D.modified]) lab.call(D.copy, { a0: x + to, a1: x + D.original }, null, null, 2000000);
      if (X.tags.zoom !== null) sim.write(x + X.tags.zoom, pack('<II', 1, 1));
    }
    const t = sim.read(x + X.time, 10);
    return { x, clock: { date: [t[0] | t[1] << 8, t[2], t[3], t[4], t[5], t[6]], status: t[8] | t[9] << 8 }, date: this.text(x + D.original, 20), take };
  }
  // The picture's file from the lab's JPEG (a JFIF file, src/lab/jpeg.mjs): S-EXIFPRM, then S-RECREQ and REC_IMAGE
  // natively with S-JPEGENC (the E144 family: S-RECIMAGE), then REC_FILE natively. media: the packet's Media, the
  // drive REC_FILE records on (0, or 1 for the second slot's card: DevRec_Rec's apiRecInfo.slot[0], which REC_MAIN
  // copies there, docs/hle-gaps.md 4.8.12; Media2 stays none: the double-slot record is not made here). Returns the
  // file's record {path, size, folder, number, cluster, stamp, clock, header, date}
  record(jpeg, media = 0) {
    const lab = this.lab, sim = lab.sim, R = this.R, P = R.packet.fields, who = this.image ? 'S-RECREQ' : 'S-RECIMAGE';
    if (!this.started) this.bring_up();
    if (!this.waiting()) throw new RecError(`${who}: REC_FILE (task ${R.task.id}) is not waiting on its input`);
    if (this.image && !this.waiting(this.image.task.id)) throw new RecError(`${who}: REC_IMAGE (task ${this.image.task.id}) is not waiting on its queue`);
    const stream = encoderStream(jpeg);
    const { x, clock, date, take } = this.exif_param();
    const pk = lab.alloc(new Uint8Array(R.packet.size), 4);
    const put = (field, fmt, v) => sim.write(pk + P[field], pack(fmt, v));
    put('pExifParam', '<I', x); put('HandleTarget', '<I', SHOT); put('Mode', '<H', STILL); put('Media', '<H', media);
    if (this.frame) {       // the E118 family's packet: FileType a halfword, no second slot; RecordDevice on E118 only
      put('FileType', '<H', JPEG);
      if (P.RecordDevice !== undefined) put('RecordDevice', '<H', CARD);
    } else {
      // (null: the version's record path reads no such field, src/fw/facts.mjs recFileInline)
      if (P.Media2 !== null) put('Media2', '<H', NO_MEDIA);
      if (P.RecordDevice !== null) put('RecordDevice', '<H', CARD);
      put('FileType', '<B', JPEG);
    }
    const { header, size } = this.image ? this.image_native(pk, stream, take) : this.image_lab(pk, stream);
    // the file, from REC_FILE's context of the packet's Media (rec_file_record picks it by Media's value, the second
    // for 1: 0x5053ff29..0x5053ff37, D; its fnode and DCF block, storage.mjs REC's layouts); where rec_make_file keeps
    // the context on its stack (recFileInline: contexts null), from the fnode and the stamp it held at the
    // registration (image_lab); on the E118 family from the registration's block as FILECLBK replied to it
    // (frame_watch). Those two forms record on the first slot alone in the lab
    if ((this.frame || R.contexts === null) && media !== 0) throw new RecError(`REC_FILE: Media ${media} on a body whose REC version the lab records on the first slot alone`);
    const kept = !this.frame && R.contexts === null ? this.context : null, ctx = this.frame || kept ? null : R.contexts[media];
    if (!this.frame && R.contexts === null && !kept) throw new RecError('REC_FILE: its record step did not reach the registration');
    if (!this.frame && !kept && ctx === undefined) throw new RecError(`REC_FILE: no file context of Media ${media} is read on this body (fact rec_file contexts)`);
    const file = {
      ...(this.frame ? this.records.at(-1).file
        : kept ? { ...this.dcf_file(kept.fnode, kept.dcf, 'its context at the registration'), stamp: kept.stamp }
          : this.dcf_file(sim.u32(ctx + CTX.fnode) >>> 0, sim.u32(ctx + CTX.dcf) >>> 0, `its context ${h8(ctx)}`, media)),
      clock, header, date,
    };
    if (file.size !== size) throw new RecError(`REC_FILE: the fnode's size ${file.size}, the packet's ${size}`);
    this.pictures += 1;
    return file;
  }
  // A recorded file by its fnode fn and its DCF block blk (storage.mjs REC's layouts) on the slot of Media media (the
  // file layer's letter 'C' + media): {path, size, folder, number, cluster, stamp}
  dcf_file(fn, blk, what, media = 0) {
    const sim = this.lab.sim, F = this.st.rec_layout(), dn = fn ? sim.u32(fn + F.f.dnode) >>> 0 : 0;
    if (!fn || !dn) throw new RecError(`REC_FILE: ${what} holds fnode ${h8(fn)}, folder ${h8(dn)}`);
    const w16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; }, names = this.st.f.names;
    return {
      path: `${String.fromCharCode(names.drive.charCodeAt(0) + media)}:\\DCIM\\${this.text(dn + F.d.name, 11)}\\${this.text(fn + F.f.name, 8)}.${this.text(fn + F.f.ext, 4)}`,
      size: sim.u32(fn + F.f.size) >>> 0, folder: w16(dn + F.d.number), number: w16(fn + F.f.number),
      cluster: sim.u32(fn + F.f.cluster) >>> 0, stamp: sim.u32(blk + DCF_STAMP) >>> 0,
    };
  }
  // (the E118 family) REC_FILE's run on S-RECIMAGE's packet, watched: its requests to the file module, [code, status]
  // as FILECLBK replies to each (the message {reply queue, word, code, block}, fact storage's fileclbk.reply; a reply
  // of 0xfff0, the message put back, is not one), the file from the registration's block; its own cluster allocation
  // {drive, bytes, mode}; and its reply to the packet's ObjResponse, taken (S-RECIMAGE). Returns {run, done}
  frame_watch() {
    const lab = this.lab, sim = lab.sim, R = this.R, st = this.st, C = st.f.rec.codes, P = R.packet.fields;
    const run = { requests: [], allocs: [], reply: null, file: null }, hooked = [st.f.fileclbk.reply, R.record.alloc, R.reply.fn];
    const u16 = (a) => { const b = sim.read(a, 2); return b[0] | b[1] << 8; };
    lab.observe(st.f.fileclbk.reply, (l, r) => {
      const msg = r.a0 >>> 0, code = sim.u32(msg + MSG.code) >>> 0, status = r.d0 & 0xFFFF;
      if (status === REQUEUE) return;
      run.requests.push([code, status]);
      if (code === C.register && status === 0) { const blk = sim.u32(msg + MSG.block) >>> 0; run.file = this.dcf_file(sim.u32(blk + DCF_FNODE) >>> 0, blk, `the registration's block ${h8(blk)}`); }
    }, 'obs-rec-fileclbk');
    lab.observe(R.record.alloc, (l, r) => { run.allocs.push({ drive: r.d0 & 0xFFFF, bytes: r.d1 >>> 0, mode: sim.u32(r.a1 >>> 0) >>> 0 }); }, 'obs-rec-alloc');
    lab.hook(R.reply.fn, (h, r) => {
      if (disasm(r.mdr) !== R.reply.from) throw new RecError(`S-RECIMAGE: REC's reply ${h8(R.reply.fn)} from ${where(r.mdr)}: only REC_FILE's (return ${h8(R.reply.from)}) is taken`);
      const p = r.a0 >>> 0;
      run.reply = { status: r.d0 & 0xFFFF, free: u16(p + P.Free), dst: u16(p + P.Dst) };
      h.finish(r, { d0: 1 });
    }, 'S-RECIMAGE');
    return { run, done: () => { for (const a of hooked) lab.hooks.delete(runtime(a)); } };
  }
  // (the E118 family) what REC_FILE did with the packet: its four requests in order, each answered 0, one allocation
  // of the file's bytes, the file registered, the reply with the status 0
  frame_check(run, size) {
    const C = this.st.f.rec.codes, want = [C.open, C.write, C.entry, C.register], rec = run.requests.filter(([c]) => [...want, C.cancel].includes(c));
    this.records.push(run);
    if (JSON.stringify(rec) !== JSON.stringify(want.map((c) => [c, 0])) || run.allocs.length !== 1 || run.allocs[0].bytes !== size || !run.file || run.reply?.status !== 0) {
      throw new RecError(`REC_FILE: its requests ${JSON.stringify(run.requests.map(([c, v]) => [`0x${c.toString(16)}`, `0x${v.toString(16)}`]))} (want the open, the chain write, the entry and the registration, each answered 0), its allocations ${JSON.stringify(run.allocs)} (want one of ${size} bytes), the file ${JSON.stringify(run.file)}, its reply ${JSON.stringify(run.reply)}`);
    }
  }
  // S-RECREQ's post of the packet pk to REC_IMAGE's queue (REC_PREPRO's post; on E146 and E147 REC_RAWNR's),
  // REC_IMAGE's task natively with S-JPEGENC's encode (the lab's stream), REC_FILE natively, S-RECREQ's reply taken;
  // lab time runs until the reply and both tasks wait again. Returns {header, size} as REC_FILE's packet has them at
  // its reply
  image_native(pk, stream, take) {
    const lab = this.lab, sim = lab.sim, R = this.R, J = R.jpeg, P = R.packet.fields, I = this.image, who = 'S-RECREQ';
    const imgpro = lab.sim.m.devices.imgpro, runs0 = imgpro?.runs ?? 0;
    const alive = lab.alloc(new Uint8Array(4), 4);
    sim.write(alive, pack('<I', 1));
    sim.write(pk + I.alive, pack('<I', alive));
    const u32 = (p, f) => sim.u32(p + P[f]) >>> 0;
    // S-JPEGENC, in REC_IMAGE's task, for this packet only (the header maker runs after it): the lab's stream at the
    // image's address and its Size, which are the packet's, or where the body keeps them in REC_IMAGE's image record
    // (E146, E147), the record's the packet points at. Inside rec_jpeg_make_image, at the rule's points: ImageParam's
    // call of the library's parameter set skipped with the status 0, the run returning 0 and Jpeg_Result writing the
    // stream and Size, the rest of rec_jpeg_make_image natively
    const E = I.encode, M = J.image;
    const c = sim.read(runtime(E.set_call), 7);
    if (c[0] !== 0xDD || ((E.set_call + (c[1] | c[2] << 8 | c[3] << 16 | c[4] << 24)) >>> 0) !== E.set) throw new RecError(`S-JPEGENC: ${h8(E.set_call)} is not ImageParam's call of the parameter set ${h8(E.set)}`);
    const run = { task: null, encoded: 0, set: 0, run: 0, id: 0, handle: 0, released: 0, addr: null, reply: null, errlog: null };
    const ours = (at, what) => { if (u32(at, 'pExifParam') !== u32(pk, 'pExifParam')) throw new RecError(`S-JPEGENC: ${what} on a packet ${h8(at)} that is not S-RECREQ's`); };
    // the image: the packet, or REC_IMAGE's image record the packet points at
    const image = (at) => (M.record ? sim.u32(at + M.record.at) >>> 0 : at);
    const encode = (at) => {
      const img = image(at), addr = sim.u32(img + M.addr) >>> 0;
      sim.write(addr + J.header, stream);
      sim.write(img + M.size, pack('<I', J.header + stream.length));
      run.encoded += 1; run.addr = addr;
      run.task = lab.lt.current() === lab.nk.tcb(I.task.id) ? I.task.id : null;
    };
    const hooked = [I.reply.fn, E.set_call, E.run, E.result, E.release];
    // the firmware's error logs from the post to the parameter set's call (ImageParam's sources, docs/hle-gaps.md
    // 4.3.4): [code, caller] each; and the handle ImageParam hands the set (d0, loaded from the image right before the
    // call, the rule's form), which the run's read at the rule's id must match
    const e0 = lab.kernel.errors.length;
    lab.hook(E.set_call, (h, r) => {
      ours(sim.u32(r.sp + E.packet) >>> 0, "ImageParam's call of the parameter set");
      run.set += 1; run.handle = r.d0 >>> 0;
      run.errlog = lab.kernel.errors.slice(e0).map(([c, , , w]) => [h8(c), /disasm (0x[0-9a-f]+)/.exec(w)?.[1] ?? w]);
      h.skip_call({ ...r, d0: 0 });
    }, 'S-JPEGENC');
    lab.hook(E.run, (h, r) => { const at = r.a0 >>> 0; ours(at, 'the run'); run.run += 1; run.id = sim.u32(image(at) + E.id) >>> 0; h.finish(r, { d0: 0 }); }, 'S-JPEGENC');
    lab.observe(E.release, (l, r) => { ours(r.a0 >>> 0, 'the release'); run.released += 1; }, 'obs-rec-release');
    lab.hook(E.result, (h, r) => { const at = r.a0 >>> 0; ours(at, 'rec_ImgPro_Jpeg_Result'); encode(at); h.finish(r); }, 'S-JPEGENC');
    // S-RECREQ: REC_FILE's reply at its handler's end, taken as the requester would take it
    lab.hook(I.reply.fn, (h, r) => {
      if (disasm(r.mdr) !== I.reply.from) throw new RecError(`S-RECREQ: REC's reply ${h8(I.reply.fn)} from ${where(r.mdr)}: only REC_FILE's (return ${h8(I.reply.from)}) is taken`);
      const p = r.a0 >>> 0;
      run.reply = { status: r.d0 & 0xFFFF, header: u32(p, 'HeaderSize'), addr: u32(p, 'BuffAddr1'), size: u32(p, 'BuffSize1'), aspect: sim.read(p + P.ImgAspect, 1)[0], free: sim.read(p + P.Free, 1)[0] };
      h.finish(r, { d0: 1 });
    }, 'S-RECREQ');
    try {
      const q = sim.read(I.task.queue, 2), r = lab.call(R.packet.post, { a0: pk, d0: q[0] | q[1] << 8 }, null, null, 2000000);
      if (r.d0 !== 1) throw new RecError(`${who}: the post ${h8(R.packet.post)} to REC_IMAGE's queue returned ${r.d0 | 0}`);
      const t0 = lab.lab_time();
      for (;;) {
        this.s.settle(`${who} REC_IMAGE`);
        if (run.reply && this.waiting() && this.waiting(I.task.id)) break;
        if (lab.lab_time() - t0 > LIMIT_MS * 1e6) throw new RecError(`${who}: no reply from REC_FILE after ${LIMIT_MS} ms of lab time (REC_IMAGE state 0x${lab.nk.state(I.task.id).toString(16)}, encoded ${run.encoded})`);
        lab.elapse(SLICE_MS, `${who} REC_IMAGE`);
      }
    } finally { for (const a of hooked) lab.hooks.delete(runtime(a)); }
    const y = run.reply, fills = (imgpro?.log ?? []).filter((f) => f.n > runs0);
    // S-JPEGENC's steps
    const steps = { set: run.set, run: run.run, result: run.encoded, id: run.id, handle: run.handle, released: run.released };
    const record = { task: run.task, encoded: run.encoded, steps, errlog: run.errlog, reply: y, alive: sim.u32(alive) >>> 0, fills: fills.map((f) => ({ mode: f.mode, dst: f.dst, bytes: f.bytes, rows: f.rows, value: f.value })), take };
    this.images.push(record);
    if (run.encoded !== 1 || run.set !== 1 || run.run !== 1 || !run.id || run.id !== run.handle || run.released !== 1 || run.task !== I.task.id || y.status !== 0 || y.header !== J.header || y.addr !== run.addr || y.size !== y.header + stream.length || record.alive !== 0) {
      throw new RecError(`${who}: REC_IMAGE encoded ${run.encoded} times${run.task === I.task.id ? ' in its task' : ''} (S-JPEGENC's steps ${JSON.stringify(steps)}), REC_FILE replied status 0x${y.status.toString(16)}, HeaderSize ${y.header}, BuffAddr1 ${h8(y.addr)} (the encode's ${h8(run.addr)}), BuffSize1 ${y.size} (the stream ${stream.length} bytes), pAlive ${record.alive}`);
    }
    return { header: y.header, size: y.size };
  }
  // The E144 family, and E130, E133 and E129 (no REC_IMAGE task natively): S-RECIMAGE (rec_jpeg_exec in the lab's call
  // on the packet pk, S-JPEGENC's encode and the fill where the body has one), REC_IMAGE's post to REC_FILE's queue,
  // then lab time until REC_FILE's handler returns. Returns {header, size} from the packet
  image_lab(pk, stream) {
    const lab = this.lab, sim = lab.sim, R = this.R, J = R.jpeg, I = J.image, P = R.packet.fields, who = 'S-RECIMAGE';
    sim.write(pk + P.ImgAspect, Uint8Array.of(ASPECT));
    // REC_IMAGE's image record where the body keeps the image's address and size there (E146 and E147, which run
    // REC_IMAGE natively; none on the E144 family): REC_IMAGE's own init of it, which clears it and points the packet
    // at it
    if (I.record) lab.call(I.record.init, { a0: pk, a1: lab.alloc(new Uint8Array(I.record.bytes), 4) }, null, null, 2000000);
    const image = () => (I.record ? sim.u32(pk + I.record.at) >>> 0 : pk);
    // S-JPEGENC: the encode and the header area's fill, for this run of rec_jpeg_exec only
    let encoded = 0;
    lab.hook(J.make_image, (h, r) => {
      const at = image(), addr = sim.u32(at + I.addr) >>> 0;   // (the header maker runs after the encode)
      sim.write(addr + J.header, stream);
      sim.write(at + I.size, pack('<I', J.header + stream.length));
      encoded += 1;
      h.finish(r, { d0: 0 });
    }, 'S-JPEGENC');
    if (J.fill !== null) lab.hook(J.fill, (h, r) => {
      if (disasm(r.mdr) !== J.fill_return) throw new RecError(`S-JPEGENC: the image engine's fill ${h8(J.fill)} from ${where(r.mdr)}: only REC's header clear (return ${h8(J.fill_return)}) is stood in`);
      sim.write(r.a0 >>> 0, new Uint8Array(r.d0 >>> 0).fill(r.d1 & 0xFF));
      h.finish(r, { d0: 0 });
    }, 'S-JPEGENC');
    try { lab.call(J.exec, { a0: pk }, null, null, 2000000); } finally {
      lab.hooks.delete(runtime(J.make_image)); if (J.fill !== null) lab.hooks.delete(runtime(J.fill));
    }
    const u32 = (f) => sim.u32(pk + P[f]) >>> 0, u16 = (f) => { const b = sim.read(pk + P[f], 2); return b[0] | b[1] << 8; };
    const header = u32('HeaderSize'), addr = sim.u32(image() + I.addr) >>> 0, size = u32('BuffSize1');
    if (encoded !== 1 || u16('Status') !== 0 || header !== J.header || u32('BuffAddr1') !== addr || size !== header + stream.length) {
      throw new RecError(`${who}: rec_jpeg_exec left Status 0x${u16('Status').toString(16)}, HeaderSize ${header}, Addr ${h8(addr)}, BuffAddr1 ${h8(u32('BuffAddr1'))}, BuffSize1 ${size} (the stream ${stream.length} bytes, encoded ${encoded} times)`);
    }
    // REC_IMAGE's post, then REC_FILE's handling, observed at its handler's return
    this.handled = null; this.context = null; this.reply = null;
    lab.observe(R.task.handled, (l, r) => { this.handled = r.d0 & 0xFFFF; }, 'obs-rec-file');
    const hooked = [R.task.handled];
    // the version before the E144 family's (recFileInline): Free as REC_IMAGE's task sets it for the frame that ends a
    // shot (I: the lab's one frame), with which REC_FILE answers the requester's ObjResponse queue (as it does with
    // Dst 0, which the lab leaves, so the reply does not test Free, X): no requester owns one in the lab, so the reply
    // is taken at REC_FILE's call of it and answered as sent; and the file's context, on rec_make_file's stack, read
    // at the registration's entry (a0), where it holds the fnode and the DCF block (the E118 family: frame_watch)
    if (R.reply && !this.frame) {
      sim.write(pk + P.Free, Uint8Array.of(1));
      lab.hook(R.reply.fn, (h, r) => {
        if (disasm(r.mdr) !== R.reply.from) throw new RecError(`${who}: REC's reply ${h8(R.reply.fn)} from ${where(r.mdr)}: only REC_FILE's (return ${h8(R.reply.from)}) is taken`);
        this.reply = { status: r.d0 & 0xFFFF, shot: sim.u32((r.a0 >>> 0) + P.pExifParam) >>> 0 };   // (a0: REC_FILE's copy of the packet)
        h.finish(r, { d0: 1 });
      }, 'S-RECIMAGE');
      hooked.push(R.reply.fn);
    }
    if (R.contexts === null && !this.frame) {
      const C = R.context;
      lab.observe(C.at, (l, r) => {
        // (the whole-file recorder calls the same registration: only REC_FILE's task records in the lab)
        if (lab.lt.current() !== lab.nk.tcb(R.task.id)) throw new RecError(`${who}: the registration ${h8(C.at)} outside REC_FILE's task (${R.task.id}), from ${where(r.mdr)}`);
        const c = r.a0 >>> 0, dcf = sim.u32(c + C.dcf) >>> 0;
        this.context = { fnode: sim.u32(c + C.fnode) >>> 0, dcf, stamp: sim.u32(dcf + DCF_STAMP) >>> 0 };
      }, 'obs-rec-register');
      hooked.push(C.at);
    }
    const watch = this.frame ? this.frame_watch() : null;
    try {
      const q = sim.read(R.task.queue, 2), r = lab.call(R.packet.post, { a0: pk, d0: q[0] | q[1] << 8 }, null, null, 2000000);
      if (r.d0 !== 1) throw new RecError(`${who}: the post ${h8(R.packet.post)} to REC_FILE's queue returned ${r.d0 | 0}`);
      const t0 = lab.lab_time();
      for (;;) {
        this.s.settle(`${who} REC_FILE`);
        if (this.handled !== null && this.waiting()) break;
        if (lab.lab_time() - t0 > LIMIT_MS * 1e6) throw new RecError(`${who}: REC_FILE has not handled the packet after ${LIMIT_MS} ms of lab time`);
        lab.elapse(SLICE_MS, `${who} REC_FILE`);
      }
    } finally { for (const a of hooked) lab.hooks.delete(runtime(a)); watch?.done(); }
    if (this.handled !== 0) throw new RecError(`REC_FILE: the packet's status 0x${this.handled.toString(16)}`);
    if (R.reply && !this.frame && (this.reply?.status !== 0 || this.reply.shot !== u32('pExifParam'))) throw new RecError(`${who}: REC_FILE's reply ${JSON.stringify(this.reply)}, want status 0 for the packet of the shot ${h8(u32('pExifParam'))}`);
    if (watch) this.frame_check(watch.run, size);
    return { header, size };
  }
}
// The stand-ins a RecFile uses (src/lab/player.mjs's list): with REC_IMAGE natively (H-RECIMGPRO where the
// application's start did not run the image library's init; H-RECPRECON where the EXIF set runs natively and
// H-EXPINIT did not run IMG_PRECON's init), the E144 family's and recFileInline's with S-RECIMAGE
export function recStandIns(rec) {
  return rec.image ? ['H-EXIFINIT', ...(rec.precon_by_rec() ? ['H-RECPRECON'] : []), 'H-RECINIT', 'H-RECSHARED', ...(rec.imgpro_by_rec() ? ['H-RECIMGPRO'] : []), 'H-RECFILE', 'H-RECIMAGE', 'S-EXIFPRM', 'S-RECREQ', 'S-JPEGENC']
    : ['H-EXIFINIT', 'H-RECINIT', 'H-RECFILE', 'S-EXIFPRM', 'S-RECIMAGE', 'S-JPEGENC'];
}
// The lab's JPEG as the encoder's stream: without the JFIF APP0 that follows its SOI (the file's APPn segments are the
// header's)
export function encoderStream(jpeg) {
  if (jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new RangeError('encoderStream: no SOI');
  if (jpeg[2] !== 0xFF || jpeg[3] !== JFIF_APP0) return jpeg;
  const end = 4 + (jpeg[4] << 8 | jpeg[5]);
  const out = new Uint8Array(jpeg.length - (end - 2));
  out.set(jpeg.subarray(0, 2)); out.set(jpeg.subarray(end), 2);
  return out;
}
