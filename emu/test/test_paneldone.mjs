// Unit tests for S-PANELDONE's gate (src/lab/menu.mjs flagSatisfied and readFlagPattern).
// Firmware-free standalone test:
//   node emu/test/test_paneldone.mjs
import {
  TWF_ANDW, TWF_ORW, KCB_LIMITS, KCB_FLGCB, FLG_LIMIT_OFF, FLGCB_PTN,
  flagSatisfied, readFlagPattern,
} from '../src/lab/menu.mjs';

function makeFakeKernel({ cpu = 0, maxFlg = 300, slots = new Map() } = {}) {
  const mem = new Map();
  const putU16 = (addr, val) => {
    mem.set(addr, val & 0xFF);
    mem.set(addr + 1, (val >>> 8) & 0xFF);
  };
  const putU32 = (addr, val) => {
    const v = val >>> 0;
    mem.set(addr, v & 0xFF);
    mem.set(addr + 1, (v >>> 8) & 0xFF);
    mem.set(addr + 2, (v >>> 16) & 0xFF);
    mem.set(addr + 3, (v >>> 24) & 0xFF);
  };
  const limitsAddr = 0x1000;
  const tableAddr = 0x2000;
  putU16(limitsAddr + FLG_LIMIT_OFF, maxFlg);
  for (const [idx, entry] of slots) {
    if (entry === null) {
      putU32(tableAddr + 4 * (idx - 1), 0);
      continue;
    }
    const flgcbAddr = 0x4000 + idx * 0x40;
    putU32(tableAddr + 4 * (idx - 1), flgcbAddr);
    putU16(flgcbAddr, entry.hdr ?? idx);
    putU32(flgcbAddr + FLGCB_PTN, entry.ptn ?? 0);
  }
  const nk = {
    cpu,
    kcb(off) {
      if (off === KCB_LIMITS) return limitsAddr;
      if (off === KCB_FLGCB) return tableAddr;
      return 0;
    },
  };
  const sim = {
    read(addr, len) {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = mem.get(addr + i) ?? 0;
      return out;
    },
    u32(addr) {
      const b = this.read(addr, 4);
      return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
    },
  };
  return { nk, sim };
}

export function panelDoneUnits() {
  const bad = [];
  let checks = 0;
  const ok = (cond, what) => { checks++; if (!cond) bad.push(what); };

  // 1. Wait mode constants match Olympus uITRON (wai_flg / twai_flg)
  ok(TWF_ANDW === 0, `TWF_ANDW should be 0, got ${TWF_ANDW}`);
  ok(TWF_ORW === 1, `TWF_ORW should be 1, got ${TWF_ORW}`);

  // 2. TWF_ANDW: all requested bits must be set
  ok(flagSatisfied(0x01, 0x01, TWF_ANDW) === true, 'AND exact single bit');
  ok(flagSatisfied(0x05, 0x05, TWF_ANDW) === true, 'AND exact multi-bit');
  ok(flagSatisfied(0x0F, 0x05, TWF_ANDW) === true, 'AND superset satisfies');
  ok(flagSatisfied(0x01, 0x03, TWF_ANDW) === false, 'AND partial bit overlap must not satisfy');
  ok(flagSatisfied(0x04, 0x06, TWF_ANDW) === false, 'AND partial overlap (0x4 vs 0x6) must not satisfy');
  ok(flagSatisfied(0x02, 0x01, TWF_ANDW) === false, 'AND disjoint bits must not satisfy');
  ok(flagSatisfied(0x00, 0x01, TWF_ANDW) === false, 'AND zero flgptn must not satisfy');
  ok(flagSatisfied(0x80000001, 0x80000001, TWF_ANDW) === true, 'AND bit 31 unsigned match');
  ok(flagSatisfied(0x80000000, 0x80000001, TWF_ANDW) === false, 'AND bit 31 partial overlap');
  ok(flagSatisfied(-1, 0x80000000, TWF_ANDW) === true, 'AND signed -1 treated as 0xFFFFFFFF');

  // 3. TWF_ORW: any requested bit set suffices
  ok(flagSatisfied(0x01, 0x01, TWF_ORW) === true, 'OR exact single bit');
  ok(flagSatisfied(0x01, 0x03, TWF_ORW) === true, 'OR partial bit overlap satisfies');
  ok(flagSatisfied(0x04, 0x06, TWF_ORW) === true, 'OR partial overlap (0x4 vs 0x6) satisfies');
  ok(flagSatisfied(0x0F, 0x05, TWF_ORW) === true, 'OR superset satisfies');
  ok(flagSatisfied(0x08, 0x07, TWF_ORW) === false, 'OR disjoint bits must not satisfy');
  ok(flagSatisfied(0x00, 0x01, TWF_ORW) === false, 'OR zero flgptn must not satisfy');
  ok(flagSatisfied(0x80000000, 0x80000001, TWF_ORW) === true, 'OR bit 31 overlap satisfies');
  ok(flagSatisfied(0x7FFFFFFF, 0x80000000, TWF_ORW) === false, 'OR bit 31 disjoint must not satisfy');

  // 4. Zero wait pattern: never satisfied (uITRON returns E_PAR)
  ok(flagSatisfied(0x00, 0x00, TWF_ANDW) === false, 'AND zero waiptn on zero flgptn');
  ok(flagSatisfied(0xFFFFFFFF, 0x00, TWF_ANDW) === false, 'AND zero waiptn on all-ones flgptn');
  ok(flagSatisfied(0x00, 0x00, TWF_ORW) === false, 'OR zero waiptn on zero flgptn');
  ok(flagSatisfied(0xFFFFFFFF, 0x00, TWF_ORW) === false, 'OR zero waiptn on all-ones flgptn');

  // 5. Invalid wait modes: negative controls
  ok(flagSatisfied(0xFF, 0x01, 2) === false, 'invalid wfmode 2 must not satisfy');
  ok(flagSatisfied(0xFF, 0x01, 3) === false, 'invalid wfmode 3 must not satisfy');
  ok(flagSatisfied(0xFF, 0x01, -1) === false, 'invalid wfmode -1 must not satisfy');
  ok(flagSatisfied(0xFF, 0x01, undefined) === false, 'undefined wfmode must not satisfy');

  // 6. readFlagPattern: FLGCB lookup and safe fallbacks
  const { nk, sim } = makeFakeKernel({
    cpu: 0,
    maxFlg: 300,
    slots: new Map([
      [10, { hdr: 10, ptn: 0x80000005 }],
      [11, { hdr: 0, ptn: 0x1 }],      // deleted/unallocated slot (hdr == 0)
      [12, null],                      // null FLGCB pointer
    ]),
  });
  ok(readFlagPattern(nk, sim, 10) === 0x80000005, 'readFlagPattern reads allocated CPU-0 flag');
  ok(readFlagPattern(nk, sim, 11) === null, 'readFlagPattern returns null for deleted flag (hdr 0)');
  ok(readFlagPattern(nk, sim, 12) === null, 'readFlagPattern returns null for null FLGCB pointer');
  ok(readFlagPattern(nk, sim, 0) === null, 'readFlagPattern returns null for id 0');
  ok(readFlagPattern(nk, sim, 301) === null, 'readFlagPattern returns null for id > maxFlg');
  ok(readFlagPattern(nk, sim, 0x100A) === null, 'readFlagPattern returns null for other CPU flag');
  ok(readFlagPattern(null, sim, 10) === null, 'readFlagPattern falls back to null when nk is null');
  ok(readFlagPattern(nk, null, 10) === null, 'readFlagPattern falls back to null when sim is null');
  ok(readFlagPattern({}, sim, 10) === null, 'readFlagPattern falls back to null when nk has no kcb()');

  return { checks, bad };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { checks, bad } = panelDoneUnits();
  if (bad.length) {
    console.error(`test_paneldone: FAIL (${bad.length}/${checks}):\n  ${bad.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`test_paneldone: PASS (${checks} checks)`);
}
