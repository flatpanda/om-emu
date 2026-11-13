#!/usr/bin/env node
// The emulated SD card's files from the host: a saved card (.omsd, src/lab/sdcard.mjs cardImage: the file
// OM_EMU_CARD keeps between play sessions, host/card.mjs) made new and formatted by the firmware, listed, and files
// taken off it, put on it and deleted from it between sessions.
//   node emu/bin/card.mjs new CARD.omsd [--model CODE] [--size GiB] [--force]
//   node emu/bin/card.mjs ls CARD.omsd [PATH] [--recursive]
//   node emu/bin/card.mjs get CARD.omsd DOS/PATH LOCAL|-
//   node emu/bin/card.mjs put CARD.omsd LOCAL DOS/PATH [--stamp now|YYYY-MM-DDTHH:MM:SS]
//   node emu/bin/card.mjs mkdir CARD.omsd DOS/PATH [--stamp ...]
//   node emu/bin/card.mjs rm CARD.omsd DOS/PATH
// new: a blank card (--size GiB: above 32 an SDXC card; default the 8 GiB SDHC card) in a headless play session of the
// model (--model, else OM_EMU_MODEL, else E143; its firmware provisioned on first use as bin/play.mjs's), which the
// firmware's insertion formats and mounts (host/card.mjs formatCard): the layout is the firmware's (FAT32 on an SDHC
// card; on an SDXC card whatever the body's format chooses: exFAT on E143). An existing CARD is refused without
// --force. ls and get read the volume with the independent readers (refs/volume.mjs: refs/fat.mjs, refs/exfat.mjs, as
// the tests and the player's Card panel do); put, mkdir and rm write it with src/lab/cardfs.mjs (FAT32: 8.3 names
// only; parent directories made as needed; entries dated 1980-01-01 00:00:00 unless --stamp gives a time: now, or a
// local time) and save CARD again (a temporary file, then a rename). DOS/PATH takes '/' or '\' and is compared
// without case. Exit 0; 1 refused or failed (the reason on stderr after 'card.mjs: '); 2 a usage error (with the
// usage line).
import fs from 'node:fs';
import path from 'node:path';
import { takeModel } from '../host/modelarg.mjs';
import { parseArgs, UsageError } from '../checks/lib/args.mjs';
import { cardImage, cardFromImage, cardSectors, SECTOR } from '../src/lab/sdcard.mjs';
import { openCardFs, cardDevice, fatStamp, FIXED_STAMP, CardFsError } from '../src/lab/cardfs.mjs';
import { openVolume } from '../refs/volume.mjs';
import { mbrPartition } from '../refs/fat.mjs';

const PROG = 'card.mjs';
const CARD = { name: 'card', positional: true, metavar: 'CARD.omsd' };
const STAMP = { opt: '--stamp', type: 'str', metavar: 'now|YYYY-MM-DDTHH:MM:SS' };
const COMMANDS = {
  new: [CARD, { opt: '--size', type: 'str', metavar: 'GiB' }, { opt: '--force', type: 'flag' }],
  ls: [CARD, { name: 'path', positional: true, required: false, metavar: 'PATH' }, { opt: '--recursive', type: 'flag' }],
  get: [CARD, { name: 'path', positional: true, metavar: 'DOS/PATH' }, { name: 'local', positional: true, metavar: 'LOCAL|-' }],
  put: [CARD, { name: 'local', positional: true, metavar: 'LOCAL' }, { name: 'path', positional: true, metavar: 'DOS/PATH' }, STAMP],
  mkdir: [CARD, { name: 'path', positional: true, metavar: 'DOS/PATH' }, STAMP],
  rm: [CARD, { name: 'path', positional: true, metavar: 'DOS/PATH' }],
};
const HELP = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n');

class Refused extends Error {}
const readCard = (file) => {
  let bytes;
  try { bytes = new Uint8Array(fs.readFileSync(file)); } catch (e) { throw new Refused(`${file}: cannot read it (${e.code ?? e.message})`); }
  try { return cardFromImage(bytes); } catch (e) { throw new Refused(`${file}: ${e.message}`); }
};
const saveCard = (file, card) => {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, cardImage(card));
  fs.renameSync(tmp, file);
};
const volumeOf = (card, file) => {
  const read = (lba, n) => card.read(lba, n);
  if (read(0, 1).every((v) => v === 0)) throw new Refused(`${file}: the card is blank (not formatted): node emu/bin/card.mjs new formats one`);
  try { return openVolume(read); } catch (e) { throw new Refused(`${file}: ${e.message}`); }
};
const giB = (sectors) => sectors / 2097152;
const fatDate = (date, time) => `${1980 + (date >> 9)}-${String(date >> 5 & 15).padStart(2, '0')}-${String(date & 31).padStart(2, '0')} ${String(time >> 11).padStart(2, '0')}:${String(time >> 5 & 63).padStart(2, '0')}`;
// --stamp's value as a FAT stamp; fail: the parsed options' usage error
function stampOf(text, fail) {
  if (text === undefined) return FIXED_STAMP;
  if (text === 'now') return fatStamp(new Date());
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d):(\d\d)$/.exec(text);
  if (!m) fail(`--stamp ${text}: now, or a local time YYYY-MM-DDTHH:MM:SS`);
  try { return fatStamp(m.slice(1).map(Number)); } catch (e) { return fail(`--stamp ${text}: ${e.message}`); }
}
const describe = (card, vol) => `${giB(card.sectors)} GiB ${card.kind} card, ${vol.type} '${vol.label.trim()}', ${vol.spc * SECTOR / 1024} KiB clusters, ${vol.freeClusters()} of ${vol.clusters} free`;

async function cmdNew(a) {
  if (fs.existsSync(a.card) && !a.force) throw new Refused(`${a.card} exists (--force to replace it with a new card)`);
  const sectors = a.size === undefined ? null : (() => { try { return cardSectors(a.size); } catch (e) { return a.error(`--size ${a.size}: ${e.message}`); } })();
  const { provision } = await import('../host/firmware.mjs');
  if (await provision(PROG)) return 1;
  const { formatCard } = await import('../host/card.mjs');
  const { MODEL } = await import('../src/fw/model.mjs');
  let r;
  try { r = await formatCard({ sectors }); } catch (e) { if (e instanceof RangeError) a.error(`--size ${a.size}: ${e.message}`); throw new Refused(e.message); }
  fs.mkdirSync(path.dirname(path.resolve(a.card)), { recursive: true });
  saveCard(a.card, r.card);
  const vol = volumeOf(r.card, a.card), part = mbrPartition(r.card.read(0, 1));
  process.stdout.write(`${a.card}: ${MODEL}'s firmware formatted a ${describe(r.card, vol)}${part ? ` (MBR partition type 0x${part.type.toString(16)} at sector ${part.start})` : ''}\n`);
  return 0;
}

function cmdLs(a) {
  const card = readCard(a.card), vol = volumeOf(card, a.card);
  const line = (e, p) => `${e.dir ? 'D' : 'F'} ${String(e.dir ? '' : e.size).padStart(11)}  ${fatDate(e.date, e.time)}  ${p}\n`;
  const walk = (dir, prefix) => {
    for (const e of vol.list(dir)) {
      if (e.name === '.' || e.name === '..') continue;
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      process.stdout.write(line(e, p));
      if (e.dir && a.recursive) walk(vol.type === 'exFAT' ? e : e.cluster, p);
    }
  };
  if (!a.path) {
    process.stdout.write(`# ${describe(card, vol)}\n`);
    walk(vol.type === 'exFAT' ? null : vol.rootCluster, '');
    return 0;
  }
  const e = vol.find(a.path);
  if (!e) throw new Refused(`${a.card}: ${a.path}: no such file or directory`);
  const p = a.path.replace(/^[/\\]+/, '').replaceAll('\\', '/');
  if (!e.dir) process.stdout.write(line(e, p));
  else walk(vol.type === 'exFAT' ? e : e.cluster, p);
  return 0;
}

function cmdGet(a) {
  const card = readCard(a.card), vol = volumeOf(card, a.card), e = vol.find(a.path);
  if (!e) throw new Refused(`${a.card}: ${a.path}: no such file`);
  if (e.dir) throw new Refused(`${a.card}: ${a.path} is a directory`);
  const bytes = vol.data(e);
  if (a.local === '-') process.stdout.write(bytes);
  else {
    fs.writeFileSync(a.local, bytes);
    process.stderr.write(`${PROG}: ${a.path} (${bytes.length} bytes) -> ${a.local}\n`);
  }
  return 0;
}

function cmdWrite(cmd, a) {
  const stamp = cmd === 'rm' ? null : stampOf(a.stamp, a.error);
  let bytes = null;
  if (cmd === 'put') {
    try { bytes = new Uint8Array(fs.readFileSync(a.local)); } catch (e) { throw new Refused(`${a.local}: cannot read it (${e.code ?? e.message})`); }
  }
  const card = readCard(a.card);
  let r;
  try {
    const w = openCardFs(cardDevice(card));
    r = cmd === 'put' ? w.put(a.path, bytes, { stamp }) : cmd === 'mkdir' ? w.mkdir(a.path, { stamp }) : w.rm(a.path);
  } catch (e) { if (e instanceof CardFsError) throw new Refused(`${a.card}: ${e.message}`); throw e; }
  saveCard(a.card, card);
  const made = r.made?.length ? ` (made ${r.made.join(', ')})` : '';
  process.stdout.write(cmd === 'put' ? `${a.card}: ${r.replaced ? 'replaced' : 'wrote'} ${a.path}, ${r.size} bytes in ${r.clusters} cluster(s)${made}\n`
    : cmd === 'mkdir' ? `${a.card}: ${r.made.length ? `made ${r.made.join(', ')}` : `${a.path} was there`}\n`
      : `${a.card}: deleted ${a.path} (${r.size} bytes, ${r.clusters} cluster(s) free again)\n`);
  return 0;
}

async function main(argv) {
  const usageAll = Object.keys(COMMANDS).map((c) => `node emu/bin/card.mjs ${c} ...`).join(' | ');
  if (!argv.length) throw new UsageError('a command is required', `usage: ${usageAll}`);
  if (argv.includes('-h') || argv.includes('--help')) { process.stdout.write(`${HELP}\n`); return 0; }
  const [cmd, ...rest] = argv;
  if (!Object.hasOwn(COMMANDS, cmd)) throw new UsageError(`unknown command ${cmd}`, `usage: ${usageAll}`);
  // get's LOCAL '-' (stdout) is a value, not an option: it goes after '--', the last positional
  const args = cmd === 'get' && rest.includes('-') ? [...rest.filter((x) => x !== '-'), '--', '-'] : rest;
  const a = parseArgs(`${PROG} ${cmd}`, args, COMMANDS[cmd]);
  if (cmd === 'new') return cmdNew(a);
  if (cmd === 'ls') return cmdLs(a);
  if (cmd === 'get') return cmdGet(a);
  return cmdWrite(cmd, a);
}

const argv = takeModel(PROG, process.argv.slice(2));
main(argv).then((rc) => { process.exitCode = rc; }, (e) => {
  if (e instanceof UsageError) { process.stderr.write(`${PROG}: ${e.message}\n${e.usage ? `${e.usage}\n` : ''}`); process.exitCode = 2; return; }
  if (e instanceof Refused) { process.stderr.write(`${PROG}: ${e.message}\n`); process.exitCode = 1; return; }
  throw e;
});
