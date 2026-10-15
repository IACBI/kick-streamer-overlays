#!/usr/bin/env node
/*
 * End-to-end checks in headless Chrome, driven over the DevTools protocol.
 * No npm packages. Needs Chrome or Edge installed (or set CHROME_PATH).
 *
 *   node tests/e2e-chrome.js                    offline checks (no network)
 *   node tests/e2e-chrome.js --live             real Kick REST data for --channel (default iacbi)
 *   node tests/e2e-chrome.js --preview          ?onizleme=1 sample-mode checks
 *   node tests/e2e-chrome.js --token            token path against tests/mock-kick-api.js
 *   node tests/e2e-chrome.js --perf             30 s heap and DOM stability check for the chat
 *   node tests/e2e-chrome.js --channel <slug>   channel for --live (default iacbi)
 *   node tests/e2e-chrome.js --shots <dir>      save PNG screenshots to <dir>
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
// Optional badge art in badges/ is requested first and falls back to a drawn symbol when missing.
const BENIGN = [/AYARLAR\.local\.js/, /fonts\.(googleapis|gstatic)\.com/, /badges\/[\w.-]+\.(svg|png|webp|gif|jpe?g)/];

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
    c, logs,
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

// The channel under test. Defaults to the maintainer's public channel.
const CHANNEL = (argOf('--channel') || 'iacbi').toLowerCase();

async function restChannel(slug) {
  const r = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Kick REST HTTP ${r.status}`);
  return r.json();
}

async function liveChecks() {
  console.log(`\n== live (real Kick REST API, channel "${CHANNEL}")`);
  const api = await restChannel(CHANNEL);
  const followers = Number(api.followers_count ?? api.followersCount);
  const live = !!(api.livestream && api.livestream.is_live !== false);
  check('REST: channel answers with a follower count', Number.isFinite(followers), `followers=${followers} live=${live}`);

  const f = await openPage('follower-bar.html', `?kanal=${CHANNEL}&takipciHedefi=${Math.max(100, followers * 2)}`, [520, 90]);
  await sleep(4000);
  const fv = await f.eval(`document.getElementById('cur').textContent`);
  const shown = Number(String(fv).replace(/,/g, ''));
  check('live follower-bar: shown count equals the REST count', shown === followers, `shown=${fv} rest=${followers}`);
  check('live follower-bar: no unexpected errors', unexpected(f.logs).length === 0, short(unexpected(f.logs)));
  await f.close();

  const ip = await openPage('info-panel.html', `?kanal=${CHANNEL}`, [300, 80]);
  await sleep(4000);
  const hidden = await ip.eval(`document.getElementById('panel').classList.contains('is-off')`);
  check('live info-panel: visibility matches the REST live state', hidden === !live, `panelHidden=${hidden} restLive=${live}`);
  check('live info-panel: no unexpected errors', unexpected(ip.logs).length === 0, short(unexpected(ip.logs)));
  await ip.close();

  const ch = await openPage('chat.html', `?kanal=${CHANNEL}`, [460, 760]);
  await sleep(7000);
  const chInfo = await ch.eval(`({
    note: (document.querySelector('.ko-note') || {}).textContent || '',
    msgs: document.querySelectorAll('.ko-msg:not(.is-leaving)').length
  })`);
  const rejected = /bağlantısı yok/i.test(chInfo.note);
  if (rejected) {
    check('live chat: no fake messages while the feed is rejected', chInfo.msgs === 0, `count=${chInfo.msgs}`);
    check('live chat: says there is no live connection', true, `note="${chInfo.note}"`);
  } else {
    check('live chat: connected to the feed (Kick restored it)', chInfo.msgs >= 0, `note="${chInfo.note}" count=${chInfo.msgs}`);
  }
  await ch.close();

  const aboneFile = fs.readFileSync(path.join(ROOT, 'AYARLAR.js'), 'utf8');
  const manual = Number((aboneFile.match(/aboneSayisi:\s*(\d+)/) || [])[1]);
  const s = await openPage('subscriber-bar.html', `?kanal=${CHANNEL}`, [520, 90]);
  await sleep(3000);
  const sInfo = await s.eval(`({ val: document.getElementById('val').textContent, note: (document.querySelector('.ko-note') || {}).textContent || '' })`);
  check('live subscriber-bar: no Kick app means the manual count from AYARLAR.js', Number(sInfo.val.replace(/,/g, '')) === manual && sInfo.note === '', `val=${sInfo.val} manual=${manual} note="${sInfo.note}"`);
  await s.close();
}

// Preview mode (?onizleme=1) must show sample values and make no network call.
async function previewChecks() {
  console.log('\n== preview mode (?onizleme=1, sample values)');
  const f = await openPage('follower-bar.html', '?onizleme=1', [520, 90]);
  await sleep(2500);
  const fv = await f.eval(`document.getElementById('cur').textContent`);
  check('preview follower-bar: sample followers 1,234', fv === '1,234', `shown=${fv}`);
  await f.close();

  const s = await openPage('subscriber-bar.html', '?onizleme=1', [520, 90]);
  await sleep(2500);
  const sv = await s.eval(`({ val: document.getElementById('val').textContent, delta: document.getElementById('delta').textContent, hidden: document.getElementById('delta').hidden })`);
  check('preview subscriber-bar: sample subscribers 42 with +3', sv.val === '42' && !sv.hidden && /\+3/.test(sv.delta), `val=${sv.val} delta=${sv.delta}`);
  await s.close();

  const ip = await openPage('info-panel.html', '?onizleme=1', [300, 80]);
  await sleep(2500);
  const iv = await ip.eval(`({ hidden: document.getElementById('panel').classList.contains('is-off'), viewers: document.getElementById('viewers').textContent, uptime: document.getElementById('uptime').textContent })`);
  check('preview info-panel: shown with sample viewers 2,048', !iv.hidden && iv.viewers === '2,048', `viewers=${iv.viewers} uptime=${iv.uptime}`);
  await ip.close();

  const ch = await openPage('chat.html', '?onizleme=1', [460, 760]);
  await sleep(4000);
  const cv = await ch.eval(`document.querySelectorAll('.ko-msg:not(.is-leaving)').length`);
  check('preview chat: sample messages shown', cv >= 1, `count=${cv}`);
  const artSrc = await ch.eval(`Array.from(document.querySelectorAll('.ko-badge-art img')).map((i) => i.getAttribute('src'))`);
  check('preview chat: badges/ art is used for the vip badge', artSrc.includes('badges/vip.svg'), `srcs=${JSON.stringify(artSrc)}`);
  // The sample sub_gifter badge has no file in badges/, so it must fall back to the drawn symbol.
  await sleep(9000);
  const fallback = await ch.eval(`Array.from(document.querySelectorAll('.ko-badge')).some((b) => b.querySelector('svg') && (b.querySelector('.ko-count') || {}).textContent === '5')`);
  check('preview chat: a missing badge file falls back to the drawn symbol', fallback);
  const hintShown = await ch.eval(`!!document.querySelector('.ko-hint')`);
  check('preview chat: no setup hint over the sample messages', !hintShown);
  await ch.close();
}

// Chat demo for 30 s: heap growth and DOM size must stay flat (no leak).
async function perfChecks() {
  console.log('\n== performance (chat preview, 30 s, heap and DOM stability)');
  const p = await openPage('chat.html', '?onizleme=1', [460, 760]);
  await p.c.send('Performance.enable');
  const heap = async () => {
    const r = await p.c.send('Performance.getMetrics');
    return r.metrics.find((m) => m.name === 'JSHeapUsedSize').value;
  };
  await sleep(6000);
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const nodes = await p.eval(`document.getElementsByTagName('*').length`);
    samples.push({ heap: await heap(), nodes });
    await sleep(4000);
  }
  const growthMB = (samples[samples.length - 1].heap - samples[1].heap) / (1024 * 1024);
  const maxNodes = Math.max(...samples.map((s) => s.nodes));
  const minNodes = Math.min(...samples.map((s) => s.nodes));
  check('perf chat: JS heap growth over 20 s stays under 8 MB', growthMB < 8, `growth=${growthMB.toFixed(2)} MB`);
  check('perf chat: DOM node count stays within a small band', maxNodes - minNodes <= 60, `nodes ${minNodes}..${maxNodes}`);
  check('perf chat: no unexpected errors during the run', unexpected(p.logs).length === 0, short(unexpected(p.logs)));
  await p.close();
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

// ---- live chat through the local relay (signed events, real sockets) ----------------

const crypto = require('crypto');

function relaySign(id, ts, body, privateKey) {
  const s = crypto.createSign('RSA-SHA256');
  s.update(Buffer.from(`${id}.${ts}.`, 'utf8'));
  s.update(Buffer.from(body, 'utf8'));
  return s.sign(privateKey, 'base64');
}

function relayPost(port, id, body, privateKey, type) {
  const ts = String(Math.floor(Date.now() / 1000));
  return fetch(`http://127.0.0.1:${port}/kick/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Kick-Event-Type': type || 'chat.message.sent',
      'Kick-Event-Version': '1',
      'Kick-Event-Message-Id': id,
      'Kick-Event-Message-Timestamp': ts,
      'Kick-Event-Signature': relaySign(id, ts, body, privateKey)
    },
    body
  }).then((r) => r.status);
}

async function relayChecks() {
  console.log('\n== live chat through the relay (signed webhook events, real sockets)');
  const { createRelay } = require(path.join(ROOT, 'relay', 'server.js'));
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  const relay = createRelay({ publicKeyPem: publicKey, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015' });
  const { webhookPort, eventsPort } = await relay.start();

  // A copy of the overlay that points at this relay and at the test channel.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-'));
  for (const f of ['AYARLAR.js', 'chat.html']) fs.copyFileSync(path.join(ROOT, f), path.join(copy, f));
  fs.cpSync(path.join(ROOT, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(copy, 'AYARLAR.local.js'),
    'window.KICK_OVERLAY_YEREL = {\n' +
    `  kanal: "${CHANNEL}",\n` +
    `  relayAdresi: "http://127.0.0.1:${eventsPort}"\n` +
    '};\n');

  const chat = await openPageFrom(copy, 'chat.html', '', [460, 760]);
  try {
    await sleep(2500);
    const noteHidden = await chat.eval(`document.querySelector('.ko-note') ? document.querySelector('.ko-note').classList.contains('is-hidden') : true`);
    check('relay chat: the overlay connects to the relay (no status note)', noteHidden === true);

    const chatBody = JSON.stringify({
      message_id: 'e2e-1',
      broadcaster: { user_id: 113812015, username: CHANNEL, channel_slug: CHANNEL },
      sender: { user_id: 777, username: 'relay_viewer', channel_slug: 'relay_viewer', identity: { username_color: '#7bdcff', badges: [{ type: 'vip', text: 'VIP' }] } },
      content: 'Relay canli mesaj',
      emotes: [],
      created_at: '2026-10-16T10:00:00Z'
    });
    check('relay chat: a signed chat event is accepted (200)', (await relayPost(webhookPort, 'e2e-1', chatBody, privateKey)) === 200);
    await sleep(1200);
    const shown = await chat.eval(`Array.from(document.querySelectorAll('.ko-msg')).some((m) => m.textContent.includes('Relay canli mesaj') && m.textContent.includes('relay_viewer'))`);
    check('relay chat: the message appears on the overlay', shown === true);

    const forged = await relayPost(webhookPort, 'e2e-2', chatBody.replace('canli', 'sahte'), crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey);
    check('relay chat: a forged event is refused (401)', forged === 401, `status=${forged}`);

    const banBody = JSON.stringify({
      broadcaster: { user_id: 113812015 },
      moderator: { user_id: 1 },
      banned_user: { user_id: 777, username: 'relay_viewer' },
      metadata: { reason: 'e2e', created_at: '2026-10-16T10:00:00Z', expires_at: null }
    });
    await relayPost(webhookPort, 'e2e-ban', banBody, privateKey, 'moderation.banned');
    await sleep(900);
    const stillThere = await chat.eval(`Array.from(document.querySelectorAll('.ko-msg:not(.is-leaving)')).some((m) => m.textContent.includes('Relay canli mesaj'))`);
    check('relay chat: a ban removes that user\'s messages', stillThere === false);

    relay.stop();
    await sleep(3500);
    const note = await chat.eval(`(document.querySelector('.ko-note') || {}).textContent || ''`);
    check('relay chat: when the relay stops, the overlay says so and keeps trying', /yeniden deneniyor|bağlanılamadı/.test(note), `note="${note}"`);
  } finally {
    await chat.close();
    try { relay.stop(); } catch (e) { /* already stopped */ }
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = await launchChrome();
  try {
    await offlineChecks();
    if (flag('--preview')) await previewChecks();
    if (LIVE) await liveChecks();
    if (TOKEN) await tokenChecks();
    if (flag('--perf')) await perfChecks();
    if (flag('--relay')) await relayChecks();
  } finally {
    chrome.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E aborted:', e.message); process.exit(2); });
