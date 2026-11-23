// The strict mode's allowlist (src/lab/strict.mjs): stock firmware's own sites of the strict classes, per model, so
// that --strict reports only sites a modification adds. Each entry: kind (a strict class), at [lo, hi) the accessing
// instructions' pcs in the code notation (0x50000000 + block offset), addr [lo, hi) the run-time addresses accessed
// (cached view), why; at or addr absent: any. Built 2026-11-22 from the stock sessions emu/test/test_strict.mjs
// STOCK_SESSIONS runs (two scripts on E143, E147 and E142: S1, S2 and its picture, playback, the menu, INFO, the
// dials, the EVF, a restart, delete) with --strict on and nothing allowed: every site those sessions met is here, and
// strictStock re-runs them to check that nothing else reports (X). A stock site no session reaches still reports.
// A site whose instruction lies on bytes a patch changed is never allowed.
//
// What the sessions met (X), by class:
//   misaligned     none: the CPU core faults every misaligned access and the session stops (strict or not), so a
//                  stock session that passes has none on its path
//   image-store    E143 and E147: the reset head's second copy (E143 0x50000178, E147 0x50000167) puts a range in place
//                  that stock code writes from the boot's first instructions on (E143 4,434 store sites, E147 4,810):
//                  in-place statics, the block's own .data (I, from the stores). And one table setter on all three
//                  bodies (E143 0x510bb065, E147 0x510d4672, E142 0x50cf0bbe: `mov a0,(d1,a1)` into the table that
//                  word +4 of row d0 of a row table names), whose stock rows point into a section's range (E143 and
//                  E147 section 7, E142 0x61111c84.., section 6 by caduceus-ep7's E-P7 section table, their report)
//                  and receive words like 0xbb262626 at the boot. E142 stores nowhere else in the image, as
//                  caduceus-ep7's sweep of its absolute stores found (their report)
//   init-read      none on E142 (no CPU load of a preload row's source after the boot)
//   unloaded-read  none on E143 and E147 in the loaded-ranges mode
export const STRICT_ALLOW = {
  E143: [
    { kind: 'image-store', addr: [0x6034d000, 0x60379fc0], why: "the reset head's copy at 0x50000178 puts 0x6034d000..0x60379fc0 in place; stock code writes it from the boot on (in-place statics, I)" },
    { kind: 'image-store', at: [0x510bb074, 0x510bb076], why: 'table setter 0x510bb065: word d1 of the table at word +4 of row d0 of 0x603708ec; a stock row points into section 7 (0x6145b7e0..)' },
  ],
  E147: [
    { kind: 'image-store', addr: [0x60357000, 0x60387094], why: "the reset head's copy at 0x50000167 puts 0x60357000..0x60387094 in place; stock code writes it from the boot on (in-place statics, I)" },
    { kind: 'image-store', at: [0x510d4681, 0x510d4683], why: 'table setter 0x510d4672: word d1 of the table at word +4 of row d0 of 0x60379534; a stock row points into section 7 (0x614a65d8..)' },
  ],
  E142: [
    { kind: 'image-store', at: [0x50cf0bcd, 0x50cf0bcf], why: 'table setter 0x50cf0bbe: word d1 of the table at word +4 of row d0 of 0x61fc1644 (preload row 2\'s copy); a stock row points into 0x61111c84.. (section 6 by caduceus-ep7\'s table)' },
  ],
};
