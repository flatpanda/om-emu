// Firmware-free unit tests for ?selftest=1 in emu/web/ui.mjs, emu/web/play.html and emu/web/index.html:
//   - syntax-checks and purity-checks web/ui.mjs and every <script> block in both pages
//   - verifies both pages load ui.css + ./ui.mjs, wire /api/pagetest, and carry the Card panel markup
//   - verifies web/ui.mjs selftest() invokes cardPanelSteps(step, ...) and reports via postPagetest
//   - executes the real exported cardPanelSteps() against a mock DOM/card state for both normal
//     Take out / Put in round-trips and refused-eject models, verifying the card is never left
//     ejected and both cardpanel.open and active tab state are restored
//   node emu/test/test_web_selftest.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { cardPanelSteps } from '../web/ui.mjs';

const EMU = path.resolve(new URL('..', import.meta.url).pathname);
const tester = () => {
  const bad = [];
  let checks = 0;
  return { bad, ok: (cond, what) => { checks++; if (!cond) bad.push(what); }, get checks() { return checks; } };
};

function extractScripts(html) {
  const scripts = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    scripts.push({ isModule: /\btype\s*=\s*["']module["']/i.test(m[1]), code: m[2] });
  }
  return scripts;
}

function checkScriptSyntax(code, isModule, filename) {
  try {
    if (isModule) {
      // Strip static ES import/export declarations and wrap in an async function so top-level await parses cleanly in vm.Script
      const body = code
        .replace(/^\s*import\s+[\s\S]*?;\s*$/gm, '')
        .replace(/^\s*export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '');
      new vm.Script(`(async () => {\n${body}\n});`, { filename });
    } else {
      new vm.Script(code, { filename });
    }
    return null;
  } catch (e) {
    return e;
  }
}

async function runCardPanelScenario({ initialOpen, initialTab, refuseRemove }) {
  const state = {
    card: null,
    cardReading: null,
    activeTab: initialTab,
    open: initialOpen,
    readCount: 0,
    removeCount: 0,
    insertCount: 0,
  };
  const makeCard = (present) => ({
    slot: { session: true, present, mounted: present, kind: 'SDXC', sectors: 64 * 2097152 },
    volume: { type: 'exFAT', label: 'OM-1', free_bytes: 60 * 1024 ** 3 },
    files: [],
  });
  const cardStateEl = { textContent: '' };
  const cardFilesEl = { innerHTML: '' };
  const eventLogEl = { textContent: '' };
  const removeBtn = { disabled: true, onclick: null, click() { if (!this.disabled && this.onclick) this.onclick(); } };
  const insertBtn = { disabled: true, onclick: null, click() { if (!this.disabled && this.onclick) this.onclick(); } };
  const readBtn = { disabled: false, onclick: null, click() { if (!this.disabled && this.onclick) this.onclick(); } };

  const applyCard = (present) => {
    state.card = makeCard(present);
    cardStateEl.textContent = `${present ? 'in the slot, mounted by the firmware' : 'out of the slot'} · a 64 GiB SDXC card · exFAT "OM-1" · 0 files`;
    cardFilesEl.innerHTML = '<p class="note">no files on the card</p>';
    removeBtn.disabled = !present;
    insertBtn.disabled = present;
  };
  const scheduleRefresh = (present) => {
    state.cardReading = Promise.resolve().then(() => {
      applyCard(present);
      state.cardReading = null;
    });
  };

  readBtn.onclick = () => {
    state.readCount++;
    scheduleRefresh(state.card ? state.card.slot.present : true);
  };
  removeBtn.onclick = () => {
    state.removeCount++;
    removeBtn.disabled = insertBtn.disabled = true;
    if (refuseRemove) {
      eventLogEl.textContent = '! refused: no S-MEDIA\n' + eventLogEl.textContent;
      scheduleRefresh(true);
    } else {
      scheduleRefresh(false);
    }
  };
  insertBtn.onclick = () => {
    state.insertCount++;
    removeBtn.disabled = insertBtn.disabled = true;
    scheduleRefresh(true);
  };

  if (initialOpen) applyCard(true);

  const cardpanel = {
    get open() { return state.open; },
    set open(v) {
      const next = !!v;
      const changed = next !== state.open;
      state.open = next;
      if (changed && next) scheduleRefresh(state.card ? state.card.slot.present : true);
    },
  };
  const els = {
    cardpanel,
    'card-remove': removeBtn,
    'card-insert': insertBtn,
    'card-read': readBtn,
    'card-state': cardStateEl,
    'card-files': cardFilesEl,
    eventlog: eventLogEl,
  };
  const tabButtons = ['keys', 'screens', 'fw', 'touch', 'events', 'standins'].map((t) => ({
    dataset: { tab: t },
    click() { state.activeTab = t; },
  }));
  const mockDoc = {
    querySelector(sel) {
      if (sel === '#tabs button.sel') return tabButtons.find((b) => b.dataset.tab === state.activeTab) || null;
      const m = /^#tabs button\[data-tab="([^"]+)"\]$/.exec(sel);
      if (m) return tabButtons.find((b) => b.dataset.tab === m[1]) || null;
      return null;
    },
  };
  const until = async (pred, _ms) => {
    for (let i = 0; i < 40; i++) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 1));
    }
    return false;
  };

  const steps = [];
  await cardPanelSteps(
    (name, ok, extra) => steps.push({ name, ok, ...(extra || {}) }),
    { $: (id) => els[id] || null, document: mockDoc, until, getCard: () => state.card, getCardReading: () => state.cardReading },
  );
  return { steps, state };
}

export async function webSelftestUnits() {
  const t = tester(), { ok } = t;
  const NODE_RE = [
    [/from\s+['"]node:/, 'node: import'],
    [/\brequire\s*\(/, 'require()'],
    [/\bprocess\./, 'process'],
  ];

  // 1. Shared UI module (web/ui.mjs) syntax, purity, and selftest wiring
  const uiSrc = fs.readFileSync(path.join(EMU, 'web', 'ui.mjs'), 'utf8');
  const uiErr = checkScriptSyntax(uiSrc, true, 'ui.mjs');
  ok(uiErr === null, `ui.mjs parses cleanly: ${uiErr ? uiErr.message : 'ok'}`);
  for (const [re, what] of NODE_RE) {
    const clean = uiSrc.replace(/\/\/.*$/gm, '');
    ok(!re.test(clean), `ui.mjs has no ${what}`);
  }
  ok(uiSrc.includes('await cardPanelSteps(step,'), 'ui.mjs: selftest() calls cardPanelSteps(step, ...)');
  ok(uiSrc.includes('await host.postPagetest(R);'), 'ui.mjs: selftest() posts report via host.postPagetest(R)');
  ok(typeof cardPanelSteps === 'function', 'ui.mjs exports cardPanelSteps');

  // 2. Both HTML pages: syntax, purity, shared asset links, markup, and /api/pagetest wiring
  for (const page of ['play.html', 'index.html']) {
    const html = fs.readFileSync(path.join(EMU, 'web', page), 'utf8');
    const scripts = extractScripts(html);
    ok(scripts.length >= 1, `${page}: has at least one <script> block (found ${scripts.length})`);
    ok(html.includes('<link rel="stylesheet" href="ui.css">'), `${page}: links ui.css`);

    for (let i = 0; i < scripts.length; i++) {
      const err = checkScriptSyntax(scripts[i].code, scripts[i].isModule, `${page}#script${i}`);
      ok(err === null, `${page} script #${i} parses cleanly: ${err ? err.message : 'ok'}`);
      for (const [re, what] of NODE_RE) {
        const clean = scripts[i].code.replace(/\/\/.*$/gm, '');
        ok(!re.test(clean), `${page} script #${i} has no ${what}`);
      }
    }

    for (const id of ['cardpanel', 'card-remove', 'card-insert', 'card-read', 'card-state', 'card-files']) {
      ok(html.includes(`id="${id}"`), `${page}: markup contains id="${id}"`);
    }
    const mainScript = scripts[scripts.length - 1].code;
    ok(mainScript.includes("from './ui.mjs'"), `${page}: imports shared UI from ./ui.mjs`);
    ok(mainScript.includes('/api/pagetest'), `${page}: wires postPagetest to /api/pagetest`);
  }

  // 3. Behavioral test A: closed panel, default tab, normal Take out -> Put in round-trip
  const a = await runCardPanelScenario({ initialOpen: false, initialTab: 'keys', refuseRemove: false });
  ok(a.steps.length === 4 && a.steps.every((s) => s.ok),
    `ui.mjs scenario A (normal round-trip): all 4 Card panel steps pass: ${JSON.stringify(a.steps)}`);
  ok(a.state.readCount === 1 && a.state.removeCount === 1 && a.state.insertCount === 1,
    `ui.mjs scenario A: clicked read (1), remove (1), insert (1): ${JSON.stringify({ r: a.state.readCount, out: a.state.removeCount, in: a.state.insertCount })}`);
  ok(a.state.open === false && a.state.activeTab === 'keys' && a.state.card?.slot?.present === true,
    `ui.mjs scenario A: restored cardpanel.open=false, activeTab='keys', and card present=true`);

  // 4. Behavioral test B: already-open panel, non-default tab, refused remove
  const b = await runCardPanelScenario({ initialOpen: true, initialTab: 'events', refuseRemove: true });
  ok(b.steps.length === 4 && b.steps.every((s) => s.ok),
    `ui.mjs scenario B (refused remove): all 4 Card panel steps pass: ${JSON.stringify(b.steps)}`);
  ok(b.state.open === true && b.state.activeTab === 'events' && b.state.card?.slot?.present === true && b.state.insertCount === 0,
    `ui.mjs scenario B: restored cardpanel.open=true, activeTab='events', card present=true without extra insert`);

  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await webSelftestUnits();
  console.log(`web selftest units: ${r.checks - r.bad.length}/${r.checks}`);
  r.bad.forEach((x) => console.log('  ', x));
  process.exit(r.bad.length ? 1 : 0);
}
