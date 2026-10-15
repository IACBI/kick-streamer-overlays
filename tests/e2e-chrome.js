#!/usr/bin/env node
/*
 * End-to-end checks in headless Chrome, driven over the DevTools protocol.
 * No npm packages. Needs Chrome or Edge installed (or set CHROME_PATH).
 *
 *   node tests/e2e-chrome.js                 offline checks (no network)
 *   node tests/e2e-chrome.js --live          also calls the real Kick REST API
 *   node tests/e2e-chrome.js --token         also runs the token path against tests/mock-kick-api.js
 *   node tests/e2e-chrome.js --shots <dir>   save PNG screenshots to <dir>
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const argOf = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const LIVE = flag('--live');
const TOKEN = flag('--token');
const SHOTS = argOf('--shots');
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find((p) => fs.existsSync(p));

// Errors caused by the sandbox, not by the pack: the optional local file and offline fonts.
const BENIGN = [/AYARLAR\.local\.js/, /fonts\.(googleapis|gstatic)\.com/];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unexpected = (logs) => logs.filter((l) => !BENIGN.some((re) => re.test(`${l.url} ${l.text}`)));
const short = (v) => JSON.stringify(v).slice(0, 200);

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    } else if (m.method) {
      listeners.forEach((f) => f(m));
    }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((ok, bad) => {
        const id = ++nextId;
        pending.set(id, { resolve: ok, reject: bad });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      on: (f) => listeners.push(f),
      close: () => ws.close()
    });
    ws.onerror = () => reject(new Error('CDP websocket failed'));
  });
}

async function launchChrome() {
  if (!CHROME) throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-e2e-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`${BASE}/json/version`); if (r.ok) return proc; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  proc.kill();
  throw new Error('Chrome DevTools did not start');
}

// Opens a file:// page from `dir` as a fresh target. Listeners attach before navigation.
async function openPageFrom(dir, fileName, query, size) {
  const target = await (await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(target.webSocketDebuggerUrl);
  const logs = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({ kind: 'exception', text: (d.exception && d.exception.description) || d.text, url: d.url || '' });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push({ kind: 'console', text: m.params.args.map((a) => a.value ?? a.description).join(' '), url: '' });
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      logs.push({ kind: 'log', text: m.params.entry.text, url: m.params.entry.url || '' });
    }
  });
  await c.send('Runtime.enable');
  await c.send('Log.enable');
  await c.send('Page.enable');
  if (size) await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: pathToFileURL(path.join(dir, fileName)).href + (query || '') });
  return {
    logs,
    eval: async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
      return r.result.value;
    },
    shot: async (name) => {
      if (!SHOTS) return;
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    },
    close: async () => {
      try { c.close(); } catch (e) { /* already closed */ }
      await fetch(`${BASE}/json/close/${target.id}`).catch(() => {});
    }
  };
}
const openPage = (fileName, query, size) => openPageFrom(ROOT, fileName, query, size);

// ---- offline scenarios (empty kanal, no network) -----------------------------

async function offlineChecks() {
  console.log('\n== offline (empty kanal, no network)');

  const f = await openPage('follower-bar.html', '', [520, 90]);
  await sleep(2500);
  const fInfo = await f.eval(`({
    cls: document.body.className,
    hint: !!document.querySelector('.ko-hint'),
    label: document.getElementById('lbl').textContent
  })`);
  check('follower-bar: look classes on body', /theme-glass/.test(fInfo.cls) && /shape-pill/.test(fInfo.cls) && /font-inter/.test(fInfo.cls) && /motion-normal/.test(fInfo.cls), fInfo.cls);
  check('follower-bar: setup hint with empty kanal', fInfo.hint);
  check('follower-bar: label is "Takipçi / Follower"', fInfo.label === 'Takipçi / Follower', fInfo.label);
  check('follower-bar: no unexpected errors', unexpected(f.logs).length === 0, short(unexpected(f.logs)));
  await f.shot('follower.png');
  await f.close();

  const s = await openPage('subscriber-bar.html', '', [520, 90]);
  await sleep(2500);
  const sInfo = await s.eval(`({
    hint: !!document.querySelector('.ko-hint:not([hidden])'),
    val: document.getElementById('val').textContent,
    deltaHidden: document.getElementById('delta').hidden
  })`);
  check('subscriber-bar: setup hint with empty kanal', sInfo.hint);
  check('subscriber-bar: shows 0 without a count', sInfo.val === '0', sInfo.val);
  check('subscriber-bar: no session delta chip', sInfo.deltaHidden);
  check('subscriber-bar: no unexpected errors', unexpected(s.logs).length === 0, short(unexpected(s.logs)));
  await s.shot('subscriber.png');
  await s.close();

  const cb = await openPage('combined-bar.html', '', [520, 180]);
  await sleep(2500);
  const cbInfo = await cb.eval(`({ rows: document.querySelectorAll('.ko-bar').length, hint: !!document.querySelector('.ko-hint:not([hidden])') })`);
  check('combined-bar: two goal rows', cbInfo.rows === 2, String(cbInfo.rows));
  check('combined-bar: setup hint with empty kanal', cbInfo.hint);
  check('combined-bar: no unexpected errors', unexpected(cb.logs).length === 0, short(unexpected(cb.logs)));
  await cb.shot('combined.png');
  await cb.close();

  const ip = await openPage('info-panel.html', '', [300, 80]);
  await sleep(2500);
  const ipInfo = await ip.eval(`({ off: document.getElementById('panel').classList.contains('is-off'), hint: !!document.querySelector('.ko-hint') })`);
  check('info-panel: hidden while no channel is set', ipInfo.off);
  check('info-panel: setup hint with empty kanal', ipInfo.hint);
  check('info-panel: no unexpected errors', unexpected(ip.logs).length === 0, short(unexpected(ip.logs)));
  await ip.close();

  const ch = await openPage('chat.html', '', [460, 760]);
  await sleep(5000);
  const chInfo = await ch.eval(`({ msgs: document.querySelectorAll('.ko-msg:not(.is-leaving)').length })`);
  check('chat: preview mode shows sample messages', chInfo.msgs >= 1, `count=${chInfo.msgs}`);
  check('chat: never more than sohbetMaksMesaj (8) messages', chInfo.msgs <= 8, `count=${chInfo.msgs}`);
  check('chat: no unexpected errors', unexpected(ch.logs).length === 0, short(unexpected(ch.logs)));
  await ch.shot('chat.png');
  await ch.close();

  const st = await openPage('studio.html', '', [1280, 900]);
  await sleep(2500);
  const stInfo = await st.eval(`({
    settings: (document.querySelector('textarea') || {}).value || '',
    themeHits: Array.from(document.querySelectorAll('button,label,[role=radio],[role=button]')).filter((e) => /neon/i.test(e.textContent)).length
  })`);
  check('studio: generated settings file contains KICK_OVERLAY_AYARLAR', /KICK_OVERLAY_AYARLAR/.test(stInfo.settings));
  check('studio: theme choices rendered', stInfo.themeHits >= 1, `hits=${stInfo.themeHits}`);
  check('studio: no unexpected errors', unexpected(st.logs).length === 0, short(unexpected(st.logs)));
  await st.shot('studio.png');
  await st.close();
}

// ---- live scenarios (real Kick REST API) -------------------------------------

async function liveChecks() {
  console.log('\n== live (real Kick REST API, network required)');

  const f = await openPage('follower-bar.html', '?kanal=xqc&takipciHedefi=2000000', [520, 90]);
  await sleep(4000);
  const fv = await f.eval(`document.getElementById('cur').textContent`);
  const fnum = Number(String(fv).replace(/,/g, ''));
  check('live follower-bar: real follower count shown for xqc', fnum > 100000, `shown=${fv}`);
  check('live follower-bar: no unexpected errors', unexpected(f.logs).length === 0, short(unexpected(f.logs)));
  await f.close();

  const ch = await openPage('chat.html', '?kanal=xqc', [460, 760]);
  await sleep(7000);
  const chInfo = await ch.eval(`({
    note: (document.querySelector('.ko-note') || {}).textContent || '',
    msgs: document.querySelectorAll('.ko-msg:not(.is-leaving)').length
  })`);
  check('live chat: no fake messages while the feed is rejected', chInfo.msgs === 0, `count=${chInfo.msgs}`);
  check('live chat: says there is no live connection', /bağlantısı yok|bağlanıyor/i.test(chInfo.note), `note="${chInfo.note}"`);
  await ch.close();

  const s = await openPage('subscriber-bar.html', '?kanal=xqc', [520, 90]);
  await sleep(3000);
  const sInfo = await s.eval(`({ val: document.getElementById('val').textContent, note: (document.querySelector('.ko-note') || {}).textContent || '' })`);
  check('live subscriber-bar: no credentials means manual count (0), no network', sInfo.val === '0' && sInfo.note === '', `val=${sInfo.val} note="${sInfo.note}"`);
  await s.close();
}

// ---- token path against the local mock (copy of the project; real files untouched) ----

async function tokenChecks() {
  console.log('\n== token path (local mock, test credentials)');
  const mockPath = path.join(__dirname, 'mock-kick-api.js');
  if (!fs.existsSync(mockPath)) { check('token: mock server present', false, 'tests/mock-kick-api.js missing'); return; }
  const mock = require(mockPath);
  const port = 8787;
  const server = await mock.startMockKick({ port });
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-token-'));
  for (const f of ['AYARLAR.js', 'follower-bar.html', 'subscriber-bar.html', 'combined-bar.html', 'info-panel.html', 'chat.html']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(copy, f));
  }
  fs.cpSync(path.join(ROOT, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'AYARLAR.local.js'),
    'window.KICK_OVERLAY_YEREL = {\n' +
    '  kickClientId: "test-client-id",\n' +
    '  kickClientSecret: "test-client-secret",\n' +
    `  apiBase: "http://127.0.0.1:${port}",\n` +
    `  tokenBase: "http://127.0.0.1:${port}"\n` +
    '};\n');
  try {
    const sb = await openPageFrom(copy, 'subscriber-bar.html', '?kanal=xqc&yenilemeSn=10', [520, 90]);
    await sleep(3000);
    const a = await sb.eval(`({ val: document.getElementById('val').textContent, hidden: document.getElementById('delta').hidden })`);
    check('token subscriber-bar: first poll shows mock total 42', a.val === '42', `val=${a.val}`);
    check('token subscriber-bar: no delta on the first value', a.hidden === true);
    await sleep(11000);
    const b = await sb.eval(`({ val: document.getElementById('val').textContent, delta: document.getElementById('delta').textContent, hidden: document.getElementById('delta').hidden })`);
    check('token subscriber-bar: second poll shows 45 with +3 this stream', b.val === '45' && !b.hidden && /\+3/.test(b.delta), `val=${b.val} delta=${b.delta}`);
    check('token subscriber-bar: no unexpected errors', unexpected(sb.logs).length === 0, short(unexpected(sb.logs)));
    await sb.shot('subscriber-token.png');
    await sb.close();
  } finally {
    await server.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = await launchChrome();
  try {
    await offlineChecks();
    if (LIVE) await liveChecks();
    if (TOKEN) await tokenChecks();
  } finally {
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E aborted:', e.message); process.exit(2); });
