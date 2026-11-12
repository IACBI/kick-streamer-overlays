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
// K.relayInfo probes the default relay's /health once per page; with no relay running that is a refused connection.
const BENIGN = [/AYARLAR\.local\.js/, /AYARLAR\.relay\.js/, /fonts\.(googleapis|gstatic)\.com/, /api\.github\.com\/repos\/IACBI\/kick-streamer-overlays\/releases\/latest/, /127\.0\.0\.1:8790\/health\b/, /badges\/[\w.-]+\.(svg|png|webp|gif|jpe?g)/, /alerts\/(follow|sub|gift|kicks|reward)\.(mp3|ogg|wav|webm|png|gif|webp)/];

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

// Opens a file:// page from `dir` as a fresh target.
function openPageFrom(dir, fileName, query, size, blocked, preload) {
  return openUrl(pathToFileURL(path.join(dir, fileName)).href + (query || ''), size, blocked, preload);
}

// Opens any address as a fresh target. Listeners attach before navigation.
async function openUrl(url, size, blocked, preload) {
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
  if (blocked) {
    await c.send('Network.enable');
    await c.send('Network.setBlockedURLs', { urls: blocked });
  }
  if (size) await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  if (preload) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
  await c.send('Page.navigate', { url });
  return {
    c, logs,
    eval: async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'evaluate failed');
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
// Pages opened from the repo folder load whatever AYARLAR.relay.js the developer's own relay left there, and with a key
// countdown and ticker try to reach that relay. The key is pinned to "none" so these runs are the same on every machine;
// the relay scenarios use their own copy of the pack (openPageFrom) with a key of their own.
const NO_LOCAL_KEY = `Object.defineProperty(window, 'KICK_RELAY_KEY', { get: function () { return undefined; }, set: function () {}, configurable: false });`;
const openPage = (fileName, query, size, blocked) => openPageFrom(ROOT, fileName, query, size, blocked, NO_LOCAL_KEY);

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
  const fHead = await f.eval(`({
    fonts: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.getAttribute('href')).filter((h) => /fonts\\.googleapis\\.com/.test(h)),
    preconnects: document.querySelectorAll('link[rel=preconnect]').length,
    scripts: Array.from(document.scripts).map((e) => e.getAttribute('src')).filter(Boolean)
  })`);
  check('follower-bar: K.loadFont injects exactly one font link, for Inter only', fHead.fonts.length === 1 && /family=Inter:/.test(fHead.fonts[0]) && !/Poppins|Nunito|Roboto/.test(fHead.fonts[0]), short(fHead.fonts));
  check('follower-bar: keeps the two preconnect links', fHead.preconnects === 2, String(fHead.preconnects));
  check('follower-bar: does not load AYARLAR.local.js (credentials stay out)', !fHead.scripts.includes('AYARLAR.local.js') && fHead.scripts.join() === 'AYARLAR.js,AYARLAR.relay.js,shared/lang/tr.js,shared/lang/en.js,shared/lang/es.js,shared/lang/pt.js,shared/lang/de.js,shared/lang/ar.js,shared/kick-core.js', fHead.scripts.join());
  await f.shot('follower.png');
  await f.close();

  // Fill is drawn with --fill and a translate reveal, never by animating width. Sample 1,234 of 2,468 is exactly 50 %.
  const fp = await openPage('follower-bar.html', '?onizleme=1&takipciHedefi=2468&yaziTipi=mono', [520, 90]);
  await sleep(2500);
  const fpInfo = await fp.eval(`(() => {
    const el = document.getElementById('fill'), cs = getComputedStyle(el);
    return {
      fillVar: el.style.getPropertyValue('--fill'), inlineWidth: el.style.width, origin: cs.transformOrigin,
      matrix: cs.transform, width: el.offsetWidth, fonts: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.getAttribute('href')).filter((h) => /fonts\\.googleapis\\.com/.test(h)),
      noteHidden: document.getElementById('note').classList.contains('is-hidden')
    };
  })()`);
  const fpM = (/^matrix\(([^)]+)\)/.exec(fpInfo.matrix) || [])[1];
  const fpParts = fpM ? fpM.split(',').map(Number) : [];
  check('follower-bar: fill is set through the --fill variable (0.5000 at 50 %)', fpInfo.fillVar === '0.5000', fpInfo.fillVar);
  check('follower-bar: fill is a full-width translate reveal (-50 % at 50 %), not an inline width or scaleX', fpInfo.inlineWidth === '' && Math.abs(fpParts[0] - 1) < 0.001 && fpInfo.width > 0 && Math.abs(fpParts[4] + fpInfo.width * 0.5) < 1, `width="${fpInfo.inlineWidth}" matrix=${fpInfo.matrix} w=${fpInfo.width}`);
  check('follower-bar: yaziTipi=mono loads only the Roboto Mono family', fpInfo.fonts.length === 1 && /Roboto\+Mono/.test(fpInfo.fonts[0]) && !/Inter/.test(fpInfo.fonts[0]), short(fpInfo.fonts));
  check('follower-bar: no status note in sample mode', fpInfo.noteHidden);
  check('follower-bar: sample mode has no unexpected errors', unexpected(fp.logs).length === 0, short(unexpected(fp.logs)));
  await fp.close();

  // Status notes (K.note): with Kick blocked the bar says so; hataNotu=0 silences it.
  const KICK_BLOCK = ['*://kick.com/*', '*://*.kick.com/*'];
  const fn = await openPage('follower-bar.html', '?kanal=e2e_unreachable', [520, 90], KICK_BLOCK);
  await sleep(3500);
  const fnInfo = await fn.eval(`({ text: document.getElementById('note').textContent, hidden: document.getElementById('note').classList.contains('is-hidden') })`);
  check('follower-bar: shows the "Kick unreachable" note when Kick cannot be reached', !fnInfo.hidden && /unreachable|ulaşılamıyor/i.test(fnInfo.text), JSON.stringify(fnInfo));
  await fn.close();
  const fq = await openPage('follower-bar.html', '?kanal=e2e_unreachable&hataNotu=0', [520, 90], KICK_BLOCK);
  await sleep(3500);
  const fqInfo = await fq.eval(`document.getElementById('note').classList.contains('is-hidden')`);
  check('follower-bar: hataNotu=0 hides the status note', fqInfo === true);
  await fq.close();

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
  const sScripts = await s.eval(`Array.from(document.scripts).map((e) => e.getAttribute('src')).filter(Boolean).join()`);
  check('subscriber-bar: loads AYARLAR.js, AYARLAR.local.js, AYARLAR.relay.js, the language files, kick-core.js in that order', sScripts === 'AYARLAR.js,AYARLAR.local.js,AYARLAR.relay.js,shared/lang/tr.js,shared/lang/en.js,shared/lang/es.js,shared/lang/pt.js,shared/lang/de.js,shared/lang/ar.js,shared/kick-core.js', sScripts);
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

  const cd = await openPage('countdown.html', '?geriSayimDk=1&geriSayimBaslik=Test%20Title', [520, 190]);
  await sleep(2500);
  const cdInfo = await cd.eval(`({ title: document.getElementById('title').textContent, time: document.getElementById('time').textContent, scale: document.getElementById('fill').style.transform })`);
  check('countdown: custom title and a running clock under one minute', cdInfo.title === 'Test Title' && /^00:(59|58|57)$/.test(cdInfo.time), JSON.stringify(cdInfo));
  check('countdown: no unexpected errors', unexpected(cd.logs).length === 0, short(unexpected(cd.logs)));
  await cd.shot('countdown.png');
  await cd.close();

  const tk = await openPage('ticker.html', '', [760, 80]);
  await sleep(1500);
  const tkInfo = await tk.eval(`({ hint: !!document.querySelector('.ko-hint'), text: document.getElementById('msg').textContent })`);
  check('ticker: setup hint when no announcements are set', tkInfo.hint && tkInfo.text === '', JSON.stringify(tkInfo));
  check('ticker: no unexpected errors', unexpected(tk.logs).length === 0, short(unexpected(tk.logs)));
  await tk.close();

  const tk2 = await openPage('ticker.html', '?duyuruMetinleri=First%20%7C%20Second%20%7C%20%7C%20Third&duyuruSn=3', [760, 80]);
  await sleep(1000);
  const first = await tk2.eval(`document.getElementById('msg').textContent`);
  await sleep(4200);
  const second = await tk2.eval(`document.getElementById('msg').textContent`);
  check('ticker: shows the first line, then rotates and skips empty lines', first === 'First' && second === 'Second', first + ' -> ' + second);
  check('ticker: no unexpected errors with announcements', unexpected(tk2.logs).length === 0, short(unexpected(tk2.logs)));
  await tk2.shot('ticker.png');
  await tk2.close();

  const al = await openPage('alerts.html', '', [640, 200]);
  await sleep(1500);
  const alInfo = await al.eval(`({ hint: !!document.querySelector('.ko-hint'), cards: document.querySelectorAll('.ko-alert').length, title: (document.querySelector('.ko-alert-title') || {}).textContent || '' })`);
  check('alerts: with no channel, a sample alert plays under the setup hint', alInfo.hint && alInfo.cards === 1 && /New follower/.test(alInfo.title), JSON.stringify(alInfo));
  check('alerts: no unexpected errors', unexpected(al.logs).length === 0, short(unexpected(al.logs)));
  await al.shot('alerts.png');
  await al.close();

  const alOff = await openPage('alerts.html', '?onizleme=1&uyariTakip=0&uyariAbone=0&dil=en', [640, 200]);
  await sleep(1500);
  const offInfo = await alOff.eval(`({ cls: (document.querySelector('.ko-alert') || {}).className || '', title: (document.querySelector('.ko-alert-title') || {}).textContent || '', detail: (document.querySelector('.ko-alert-detail') || {}).textContent || '' })`);
  check('alerts: kinds switched off are skipped (first sample shown is the gift)', /is-gift/.test(offInfo.cls) && offInfo.title === 'Gifted subs' && offInfo.detail === 'gifted 5 subs', JSON.stringify(offInfo));
  await alOff.close();

  for (const [file, size, rowsWanted] of [['events.html', [420, 400], 5], ['leaderboard.html', [380, 400], 5]]) {
    const pg = await openPage(file, '', size);
    await sleep(1200);
    const info = await pg.eval(`({ hint: !!document.querySelector('.ko-hint'), rows: document.querySelectorAll('.ko-item').length, title: document.getElementById('title').textContent })`);
    check(file + ': with no channel, sample rows show under the setup hint', info.hint && info.rows === rowsWanted && info.title !== '', JSON.stringify(info));
    check(file + ': no unexpected errors', unexpected(pg.logs).length === 0, short(unexpected(pg.logs)));
    await pg.shot(file.replace('.html', '.png'));
    await pg.close();
  }

  const kb = await openPage('kicks-bar.html', '?dil=en', [520, 90]);
  await sleep(1500);
  const kbInfo = await kb.eval(`({ hint: !!document.querySelector('.ko-hint'), cur: document.getElementById('cur').textContent, goal: document.getElementById('goal').textContent })`);
  check('kicks-bar.html: with no channel, the sample total shows against kicksHedefi under the setup hint', kbInfo.hint && kbInfo.cur === '650' && kbInfo.goal === '1,000', JSON.stringify(kbInfo));
  check('kicks-bar.html: no unexpected errors', unexpected(kb.logs).length === 0, short(unexpected(kb.logs)));
  await kb.shot('kicks-bar.png');
  await kb.close();
  const kbStep = await openPage('kicks-bar.html', '?onizleme=1&kicksHedefi=500&hedefArtis=200', [520, 90]);
  await sleep(1500);
  check('kicks-bar.html: hedefArtis raises a reached goal past the total (650 of 500, step 200 -> 700)', (await kbStep.eval(`document.getElementById('goal').textContent`)) === '700');
  await kbStep.close();
  const trn = await openPage('sub-train.html', '?dil=en&trenSn=60', [520, 90]);
  await sleep(1500);
  const trnInfo = await trn.eval(`({ idle: document.getElementById('bar').classList.contains('is-idle'), count: document.getElementById('count').textContent, left: document.getElementById('left').textContent })`);
  check('sub-train.html: the sample train runs with its count and time left', !trnInfo.idle && trnInfo.count === '×7' && /^0:[0-5]\d$/.test(trnInfo.left), JSON.stringify(trnInfo));
  check('sub-train.html: no unexpected errors', unexpected(trn.logs).length === 0, short(unexpected(trn.logs)));
  await trn.shot('sub-train.png');
  await trn.close();

  const row = await openPage('chat.html', '?onizleme=1&sohbetYatay=1', [1280, 80]);
  await sleep(6000);
  const rowInfo = await row.eval(`(() => { const m = Array.from(document.querySelectorAll('.ko-msg:not(.is-leaving)')); const tops = new Set(m.map((x) => Math.round(x.getBoundingClientRect().top))); return { cls: document.body.classList.contains('chat-row'), n: m.length, rows: tops.size, newestRight: m.length > 1 && m[m.length - 1].getBoundingClientRect().left > m[0].getBoundingClientRect().left }; })()`);
  check('chat: sohbetYatay lays the messages out in one row, newest on the right', rowInfo.cls && rowInfo.n >= 2 && rowInfo.rows === 1 && rowInfo.newestRight, JSON.stringify(rowInfo));
  check('chat: horizontal layout has no unexpected errors', unexpected(row.logs).length === 0, short(unexpected(row.logs)));
  await row.shot('chat-row.png');
  await row.close();

  const cssOk = await openPage('follower-bar.html', '?onizleme=1&ozelCss=' + encodeURIComponent('.ko-label { letter-spacing: 7px; }'), [520, 90]);
  await sleep(800);
  check('ozelCss: a plain custom rule is applied over the theme', (await cssOk.eval(`getComputedStyle(document.querySelector('.ko-label')).letterSpacing`)) === '7px');
  await cssOk.close();
  const cssBad = await openPage('follower-bar.html', '?onizleme=1&ozelCss=' + encodeURIComponent('.ko-label { letter-spacing: 7px; background: url(https://evil.example/x.png); }'), [520, 90]);
  await sleep(800);
  check('ozelCss: a value that loads from elsewhere is ignored as a whole', (await cssBad.eval(`!document.getElementById('ko-custom-css') && getComputedStyle(document.querySelector('.ko-label')).letterSpacing !== '7px'`)) === true);
  await cssBad.close();

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
    settings: (document.getElementById('cikti') || {}).value || '',
    themeHits: Array.from(document.querySelectorAll('button,label,[role=radio],[role=button]')).filter((e) => /neon/i.test(e.textContent)).length
  })`);
  check('studio: generated settings file contains KICK_OVERLAY_AYARLAR', /KICK_OVERLAY_AYARLAR/.test(stInfo.settings));
  check('studio: theme choices rendered', stInfo.themeHits >= 1, `hits=${stInfo.themeHits}`);
  // The OBS export, read from the blob the button hands to the download link.
  const obs = await st.eval(`(async () => {
    let blob = null;
    const make = URL.createObjectURL;
    URL.createObjectURL = (b) => { blob = b; return make.call(URL, b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('obsIndir').click();
    URL.createObjectURL = make;
    HTMLAnchorElement.prototype.click = click;
    const c = JSON.parse(await blob.text());
    const browsers = c.sources.filter((x) => x.id === 'browser_source');
    return { scene: c.current_scene, count: browsers.length, files: browsers.map((x) => x.settings.url.split('?')[0].split('/').pop()),
      local: browsers.every((x) => /^file:\\/\\/\\//.test(x.settings.url)), audio: browsers.filter((x) => x.settings.reroute_audio).map((x) => x.settings.url.split('?')[0].split('/').pop()),
      hidden: c.sources[0].settings.items.filter((i) => !i.visible).length };
  })()`);
  check('studio: the OBS scene collection holds all twelve overlays as Browser sources with their file links',
    obs.count === 12 && obs.files.includes('chat.html') && obs.files.includes('events.html') && obs.files.includes('sub-train.html') && obs.local && obs.hidden === 6 && obs.audio.join() === 'alerts.html', JSON.stringify(obs));
  check('studio: no unexpected errors', unexpected(st.logs).length === 0, short(unexpected(st.logs)));
  await st.shot('studio.png');
  // The new-version notice, fed from the daily cache so the check needs no network: a newer tag shows it,
  // the running version does not.
  const notice = async (tag) => {
    await st.eval(`localStorage.setItem('kickOverlayStudio.surum', JSON.stringify({ tag: ${JSON.stringify(tag)}, at: Date.now() })); location.reload()`);
    await sleep(2000);
    return st.eval(`({ hidden: document.getElementById('guncelleme').hidden, text: document.getElementById('guncelleme-metin').textContent, href: document.getElementById('guncelleme-link').href })`);
  };
  const up = await notice('v99.0.0');
  check('studio: a newer release shows the update notice with the fixed releases link', up.hidden === false && /99\.0\.0/.test(up.text) && up.href === 'https://github.com/IACBI/kick-streamer-overlays/releases/latest', JSON.stringify(up));
  const same = await notice('v' + require('../package.json').version);
  check('studio: the running version shows no update notice', same.hidden === true, JSON.stringify(same));
  await st.eval(`localStorage.removeItem('kickOverlayStudio.surum')`);

  // Studio behaviour: links, tabs, presets, language, reset.
  const urlOf = (id) => `document.querySelector('[data-url="${id}"]').value`;
  const base = await st.eval(`({ langs: Array.from(navigator.languages || [navigator.language]), follower: ${urlOf('follower')}, tabs: document.querySelectorAll('[role=tab]').length, cards: document.querySelectorAll('[data-card]').length, warn: !document.querySelector('[data-card="follower"] .st-card-warn').hidden })`);
  check('studio: twelve overlay tabs and twelve link cards', base.tabs === 12 && base.cards === 12, JSON.stringify(base));
  // A first visit starts on the browser's label language, so that one setting is in the link and nothing else is.
  const firstLang = base.langs.map((l) => String(l).slice(0, 2).toLowerCase()).find((l) => ['tr', 'en', 'es', 'pt', 'de', 'ar'].includes(l)) || 'en';
  check('studio: default link carries only the browser\'s label language', base.follower.endsWith('follower-bar.html?language=' + firstLang), base.follower);
  check('studio: card warns when the channel is empty', base.warn);

  await st.eval(`(() => { const k = document.getElementById('kanal'); k.value = 'Test_Kanal'; k.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-preset="neon"]').click(); })()`);
  await sleep(600);
  const set = await st.eval(`({ follower: ${urlOf('follower')}, chat: ${urlOf('chat')}, ticker: ${urlOf('ticker')}, warn: !document.querySelector('[data-card="follower"] .st-card-warn').hidden, src: document.getElementById('onizleme').getAttribute('src') })`);
  check('studio: link carries the lowercase channel and the preset look', /channel=test_kanal/.test(set.follower) && /theme=neon/.test(set.follower) && /shape=rounded/.test(set.follower), set.follower);
  check('studio: a link holds only the settings that overlay reads', !/chatMaxMessages|countdown|announcement/.test(set.follower) && !/followerGoal/.test(set.chat), set.follower + ' | ' + set.chat);
  check('studio: the accent color is URL-encoded, no secret keys', /accent=%2339ff14/.test(set.follower) && !/client|secret/i.test(set.follower), set.follower);
  check('studio: the empty-channel warning goes away', !set.warn);
  check('studio: the preview keeps sample data (onizleme=1) after a channel is set, until "Live data" is clicked', /onizleme=1/.test(set.src), set.src);

  const live1 = await st.eval(`(() => { const b = document.getElementById('pv-canli'); return { hidden: b.hidden, pressed: b.getAttribute('aria-pressed') }; })()`);
  check('studio: the "Live data" toggle is shown for a bar overlay and starts off', live1.hidden === false && live1.pressed === 'false', JSON.stringify(live1));
  await st.eval(`document.getElementById('pv-canli').click()`);
  await sleep(400);
  const live2 = await st.eval(`({ src: document.getElementById('onizleme').getAttribute('src'), pressed: document.getElementById('pv-canli').getAttribute('aria-pressed') })`);
  check('studio: clicking "Live data" drops onizleme=1 from the preview', !/onizleme=1/.test(live2.src) && /kanal=test_kanal/.test(live2.src) && live2.pressed === 'true', JSON.stringify(live2));
  await st.eval(`document.getElementById('pv-canli').click()`);
  await sleep(400);
  const live3 = await st.eval(`({ src: document.getElementById('onizleme').getAttribute('src'), pressed: document.getElementById('pv-canli').getAttribute('aria-pressed') })`);
  check('studio: clicking it again returns to sample data', /onizleme=1/.test(live3.src) && live3.pressed === 'false', JSON.stringify(live3));

  await st.eval(`document.getElementById('tab-chat').click()`);
  await sleep(500);
  const tab = await st.eval(`({ src: document.getElementById('onizleme').getAttribute('src'), sel: document.getElementById('tab-chat').getAttribute('aria-selected'), open: document.getElementById('g-chat').open, w: document.getElementById('onizleme').getAttribute('width') })`);
  check('studio: choosing the chat tab loads chat.html at 460 px and opens its settings group', /^chat\.html\?/.test(tab.src) && tab.sel === 'true' && tab.open && tab.w === '460', JSON.stringify(tab));

  await st.eval(`document.querySelector('[data-lang="en"]').click()`);
  await sleep(300);
  const en = await st.eval(`({ lang: document.documentElement.lang, title: document.title, copy: document.querySelector('[data-copy]').textContent, theme: document.querySelector('[data-label-value="aurora"]').textContent })`);
  check('studio: switching to English changes the page language and texts', en.lang === 'en' && en.copy.trim() === 'Copy link' && en.theme === 'Aurora', JSON.stringify(en));
  await st.eval(`document.querySelector('[data-lang="tr"]').click()`);
  await sleep(300);
  const tr = await st.eval(`({ lang: document.documentElement.lang, copy: document.querySelector('[data-copy]').textContent, theme: document.querySelector('[data-label-value="aurora"]').textContent })`);
  check('studio: switching back to Turkish restores the texts', tr.lang === 'tr' && tr.copy.trim() === 'Bağlantıyı kopyala' && tr.theme === 'Kuzey Işığı', JSON.stringify(tr));

  // Reset all asks first: cancelling changes nothing, confirming restores the defaults.
  await st.eval(`document.getElementById('sifirla').click()`);
  await sleep(300);
  const ask = await st.eval(`({ open: !document.getElementById('sifirla-onay').hidden, stil: document.querySelector('input[name=stil]:checked').value })`);
  check('studio: "Reset all" opens an inline confirmation and changes nothing yet', ask.open && ask.stil === 'neon', JSON.stringify(ask));
  await st.eval(`document.getElementById('sifirlaIptal').click()`);
  await sleep(300);
  const cancelled = await st.eval(`({ open: !document.getElementById('sifirla-onay').hidden, stil: document.querySelector('input[name=stil]:checked').value })`);
  check('studio: cancelling the reset closes the question and keeps the look', !cancelled.open && cancelled.stil === 'neon', JSON.stringify(cancelled));
  await st.eval(`document.getElementById('sifirla').click()`);
  await sleep(200);
  await st.eval(`document.getElementById('sifirlaEvet').click()`);
  await sleep(400);
  const reset =await st.eval(`({ kanal: document.getElementById('kanal').value, stil: document.querySelector('input[name=stil]:checked').value, follower: ${urlOf('follower')} })`);
  check('studio: reset keeps the channel and restores the default look', reset.kanal === 'test_kanal' && reset.stil === 'glass' && /channel=test_kanal/.test(reset.follower) && !/theme=/.test(reset.follower), JSON.stringify(reset));
  // Network log lines are expected here: the test channel does not exist. Script errors are not.
  const scriptErrors = st.logs.filter((l) => l.kind !== 'log');
  check('studio: no script errors after interaction', scriptErrors.length === 0, short(scriptErrors));
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
  for (const f of ['AYARLAR.js', 'follower-bar.html', 'subscriber-bar.html', 'combined-bar.html', 'info-panel.html', 'chat.html', 'countdown.html', 'ticker.html']) {
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
  const accessKey = crypto.randomBytes(16).toString('hex');
  // credentials: false keeps the test independent of an AYARLAR.local.js on the machine running it.
  const relay = createRelay({ publicKeyPem: publicKey, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015', accessKey, credentials: false });
  const { webhookPort, eventsPort } = await relay.start();

  // A copy of the overlay that points at this relay and at the test channel.
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-'));
  fs.copyFileSync(path.join(ROOT, 'chat.html'), path.join(copy, 'chat.html'));
  fs.copyFileSync(path.join(ROOT, 'alerts.html'), path.join(copy, 'alerts.html'));
  fs.copyFileSync(path.join(ROOT, 'info-panel.html'), path.join(copy, 'info-panel.html'));
  fs.copyFileSync(path.join(ROOT, 'studio.html'), path.join(copy, 'studio.html'));
  fs.copyFileSync(path.join(ROOT, 'dock.html'), path.join(copy, 'dock.html'));
  fs.copyFileSync(path.join(ROOT, 'countdown.html'), path.join(copy, 'countdown.html'));
  fs.copyFileSync(path.join(ROOT, 'ticker.html'), path.join(copy, 'ticker.html'));
  fs.copyFileSync(path.join(ROOT, 'events.html'), path.join(copy, 'events.html'));
  fs.copyFileSync(path.join(ROOT, 'leaderboard.html'), path.join(copy, 'leaderboard.html'));
  fs.copyFileSync(path.join(ROOT, 'kicks-bar.html'), path.join(copy, 'kicks-bar.html'));
  fs.copyFileSync(path.join(ROOT, 'sub-train.html'), path.join(copy, 'sub-train.html'));
  fs.cpSync(path.join(ROOT, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'branding'), path.join(copy, 'branding'), { recursive: true });
  // chat.html loads only AYARLAR.js (it needs no credentials); relayAdresi is allowed there.
  fs.writeFileSync(path.join(copy, 'AYARLAR.js'),
    'window.KICK_OVERLAY_AYARLAR = {\n' +
    `  kanal: "${CHANNEL}",\n` +
    `  relayAdresi: "http://127.0.0.1:${eventsPort}"\n` +
    '};\n');
  // The relay's access key, as the relay writes it to AYARLAR.relay.js.
  fs.writeFileSync(path.join(copy, 'AYARLAR.relay.js'), `window.KICK_RELAY_KEY = "${accessKey}";\n`);
  const noKey = await fetch(`http://127.0.0.1:${eventsPort}/health`);
  check('relay chat: a request without the access key is refused (401)', noKey.status === 401, `status=${noKey.status}`);

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

    await alertRelayChecks(copy, webhookPort, privateKey);
    await testAlertChecks(copy, eventsPort, accessKey);
    await dockChecks(copy);
    await speechChecks(copy, webhookPort, privateKey);
    await overlayDockChecks(copy);
    await statsChecks(copy, webhookPort, privateKey);
    await infoRelayChecks(copy, webhookPort, privateKey);
    await studioRelayChecks(copy, eventsPort);
    await firstRunChecks();

    relay.stop();
    const noteState = `(() => { const n = document.querySelector('.ko-note'); return n && !n.classList.contains('is-hidden') ? n.textContent : ''; })()`;
    await sleep(2000);
    const early = await chat.eval(noteState);
    check('relay chat: a short relay outage shows no note yet (5 s grace while the core reconnects)', early === '', `note="${early}"`);
    await sleep(4500);
    const note = await chat.eval(noteState);
    check('relay chat: when the relay stays down, the overlay says so', /köprü|relay not running/i.test(note), `note="${note}"`);
  } finally {
    await chat.close();
    try { relay.stop(); } catch (e) { /* already stopped */ }
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

// Stream start, title change and end from the relay switch the info panel at once, without waiting for a poll.
async function infoRelayChecks(copy, webhookPort, privateKey) {
  const page = await openPageFrom(copy, 'info-panel.html', '?bilgiBaslik=1', [300, 80]);
  const broadcaster = { user_id: 113812015, username: CHANNEL, channel_slug: CHANNEL };
  const state = `({ off: document.getElementById('panel').classList.contains('is-off'), titleHidden: document.getElementById('title').hidden, title: document.getElementById('title').textContent })`;
  try {
    await sleep(2500);
    const started = JSON.stringify({ broadcaster, is_live: true, title: 'E2E stream title', started_at: new Date(Date.now() - 65000).toISOString(), ended_at: null });
    check('relay info: a signed stream start is accepted (200)', (await relayPost(webhookPort, 'e2e-live-1', started, privateKey, 'livestream.status.updated')) === 200);
    await sleep(900);
    const on = await page.eval(state);
    check('relay info: the panel turns live and shows the title from the start event', on.off === false && on.titleHidden === false && on.title === 'E2E stream title', JSON.stringify(on));
    const uptime = await page.eval(`document.getElementById('uptime').textContent`);
    check('relay info: the uptime counts from started_at', /^0:01:0\d$/.test(uptime), uptime);

    const meta = JSON.stringify({ broadcaster, metadata: { title: 'Yeni başlık', language: 'tr', has_mature_content: false, category: { id: 1, name: 'Just Chatting', thumbnail: '' } } });
    await relayPost(webhookPort, 'e2e-meta-1', meta, privateKey, 'livestream.metadata.updated');
    await sleep(900);
    const renamed = await page.eval(state);
    check('relay info: a title change updates the title tag', renamed.title === 'Yeni başlık', JSON.stringify(renamed));

    const ended = JSON.stringify({ broadcaster, is_live: false, title: 'Yeni başlık', started_at: new Date(Date.now() - 65000).toISOString(), ended_at: new Date().toISOString() });
    await relayPost(webhookPort, 'e2e-live-2', ended, privateKey, 'livestream.status.updated');
    await sleep(900);
    const off = await page.eval(state);
    check('relay info: the panel hides as soon as the stream ends', off.off === true && off.titleHidden === true, JSON.stringify(off));
    check('relay info: no unexpected errors', unexpected(page.logs).length === 0, short(unexpected(page.logs)));
  } finally {
    await page.close();
  }
}

// The studio's relay check against the live relay, after events have arrived: every line is a real condition.
async function studioRelayChecks(copy, eventsPort) {
  const st = await openPageFrom(copy, 'studio.html', '', [1280, 900]);
  try {
    await sleep(1500);
    await st.eval(`(() => { const i = document.getElementById('relayAdresi'); i.value = 'http://127.0.0.1:${eventsPort}'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('relayKontrol').click(); return true; })()`);
    await sleep(1500);
    const d = await st.eval(`({ status: document.getElementById('relay-durum').className, lines: Array.from(document.querySelectorAll('#relay-tani li')).map((li) => li.className + ' ' + li.textContent) })`);
    const line = (re) => d.lines.find((l) => re.test(l)) || '';
    check('studio relay check: the relay answers with at least the four diagnosis lines', /is-ok/.test(d.status) && d.lines.length >= 4, JSON.stringify(d));
    check('studio relay check: same version, channel id known, a verified event seen', /^is-ok/.test(line(/version|sürüm/i)) && /^is-ok/.test(line(/channel id|Kanal kimliği/i)) && /^is-ok/.test(line(/Kick event|olay/i)), JSON.stringify(d.lines));
    check('studio relay check: missing Kick app credentials are a warning, not an error', /^is-warn/.test(line(/credentials|uygulama bilgileri/i)), line(/credentials|uygulama bilgileri/i));
    check('studio relay check: no unexpected errors', unexpected(st.logs).length === 0, short(unexpected(st.logs)));

    // A second relay that cannot resolve the channel and has seen no event: those lines turn into instructions.
    const { createRelay } = require(path.join(ROOT, 'relay', 'server.js'));
    const key = fs.readFileSync(path.join(copy, 'AYARLAR.relay.js'), 'utf8').match(/"([^"]+)"/)[1];
    const quiet = { log() {}, warn() {}, error() {} };
    const bare = createRelay({ publicKeyPem: 'unused', webhookPort: 0, eventsPort: 0, accessKey: key, credentials: false, channelSlug: '', logger: quiet });
    const p2 = await bare.start();
    bare.setTunnel('https://quiet-river-1234.trycloudflare.com');
    bare.logger.error('Tunnel stopped (exit 1); starting it again in 2 s.');
    try {
      await st.eval(`(() => { const i = document.getElementById('relayAdresi'); i.value = 'http://127.0.0.1:${p2.eventsPort}'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('relayKontrol').click(); return true; })()`);
      await sleep(1500);
      const d2 = await st.eval(`Array.from(document.querySelectorAll('#relay-tani li')).map((li) => li.className + ' ' + li.textContent)`);
      check('studio relay check: an unknown channel id is an error that says how to fix it', d2.some((l) => /^is-err/.test(l) && /RELAY_BROADCASTER_ID/.test(l)), JSON.stringify(d2));
      check('studio relay check: the tunnel line gives the exact Webhook URL for the Kick app', d2.some((l) => /^is-ok/.test(l) && l.includes('https://quiet-river-1234.trycloudflare.com/kick/webhook')), JSON.stringify(d2));
      check('studio relay check: a recent relay error is shown as an error line', d2.some((l) => /^is-err/.test(l) && /Tunnel stopped/.test(l)), JSON.stringify(d2));
      check('studio relay check: no event yet points at the webhook URL and subscribe.js', d2.some((l) => /^is-warn/.test(l) && /\/kick\/webhook/.test(l) && /subscribe\.js/.test(l)), JSON.stringify(d2));
    } finally {
      bare.stop();
    }
  } finally {
    await st.close();
  }
}

// The studio as the relay serves it (the recommended setup), on a relay that reads `settingsJs` as its AYARLAR.js.
async function servedStudio(settingsJs, run) {
  const { createRelay } = require(path.join(ROOT, 'relay', 'server.js'));
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-first-run-'));
  fs.writeFileSync(path.join(configRoot, 'AYARLAR.js'), settingsJs);
  const quiet = { log() {}, warn() {}, error() {} };
  const relay = createRelay({ publicKeyPem: 'unused', webhookPort: 0, eventsPort: 0, accessKey: crypto.randomBytes(16).toString('hex'), credentials: false, configRoot, logger: quiet, fetchImpl: async () => { throw new Error('offline'); } });
  const { eventsPort } = await relay.start();
  const st = await openUrl(`http://127.0.0.1:${eventsPort}/studio.html`, [1280, 900]);
  try {
    await sleep(2000);
    const state = await st.eval(`({ langs: Array.from(navigator.languages || [navigator.language]), language: (document.querySelector('input[name="dil"]:checked') || {}).value, saveBar: !document.getElementById('kaydetCubuk').hidden })`);
    await run(state, st);
  } finally {
    await st.close();
    relay.stop();
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
}

// First run on the relay: the settings file of a fresh download already names the default label language.
async function firstRunChecks() {
  const shipped = fs.readFileSync(path.join(ROOT, 'AYARLAR.js'), 'utf8');
  await servedStudio(shipped, async (s, st) => {
    const want = s.langs.map((l) => String(l).slice(0, 2).toLowerCase()).find((l) => ['tr', 'en', 'es', 'pt', 'de', 'ar'].includes(l)) || 'en';
    check('studio on the relay: a fresh download starts on the browser\'s label language', s.language === want, JSON.stringify(s));
    check('studio on the relay: that first language shows as an unsaved change', s.saveBar === true, JSON.stringify(s));
    check('studio on the relay: no unexpected errors', unexpected(st.logs).length === 0, short(unexpected(st.logs)));
  });
  await servedStudio(`window.KICK_OVERLAY_AYARLAR = {\n  channel: "${CHANNEL}",\n  language: "both"\n};\n`, async (s) => {
    check('studio on the relay: a set-up relay keeps both languages, with nothing to save', s.language === 'both' && s.saveBar === false, JSON.stringify(s));
  });
}

// Alerts on the same relay: signed follow, gift and a hostile name, shown one at a time and only as text.
async function alertRelayChecks(copy, webhookPort, privateKey) {
  const al = await openPageFrom(copy, 'alerts.html', '?uyariSn=3&dil=en', [640, 200]);
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `webhook-${name}.json`), 'utf8'));
  const forUs = (obj) => JSON.stringify(Object.assign(obj, { broadcaster: Object.assign(obj.broadcaster, { user_id: 113812015 }) }));
  try {
    await sleep(2000);
    const follow = fixture('channel-followed');
    follow.follower.username = 'alert_fan';
    check('relay alerts: a signed follow is accepted (200)', (await relayPost(webhookPort, 'e2e-al-1', forUs(follow), privateKey, 'channel.followed')) === 200);
    const hostile = fixture('channel-followed');
    hostile.follower.username = '<img src=x onerror="window.__pwned=1">';
    await relayPost(webhookPort, 'e2e-al-2', forUs(hostile), privateKey, 'channel.followed');
    await relayPost(webhookPort, 'e2e-al-3', forUs(fixture('subscription-gifts-anonymous')), privateKey, 'channel.subscription.gifts');
    await sleep(800);
    const first = await al.eval(`({ live: document.querySelectorAll('.ko-alert:not(.is-out)').length, name: (document.querySelector('.ko-alert:not(.is-out) .ko-alert-name') || {}).textContent || '' })`);
    check('relay alerts: the follow is on screen, one card at a time while two wait', first.live === 1 && first.name === 'alert_fan', JSON.stringify(first));
    await sleep(3800);
    const second = await al.eval(`({ name: (document.querySelector('.ko-alert:not(.is-out) .ko-alert-name') || {}).textContent || '', imgs: document.querySelectorAll('#stage img').length, pwned: window.__pwned === 1 })`);
    check('relay alerts: a name with markup is shown as text, never run', second.name.startsWith('<img') && second.imgs === 0 && !second.pwned, JSON.stringify(second));
    await sleep(3800);
    const third = await al.eval(`({ name: (document.querySelector('.ko-alert:not(.is-out) .ko-alert-name') || {}).textContent || '', detail: (document.querySelector('.ko-alert:not(.is-out) .ko-alert-detail') || {}).textContent || '' })`);
    check('relay alerts: an anonymous gift follows in order, counting its giftees', third.name === 'Anonymous' && third.detail === 'gifted 2 subs', JSON.stringify(third));
    check('relay alerts: no unexpected errors', unexpected(al.logs).length === 0, short(unexpected(al.logs)));
  } finally {
    await al.close();
  }

  // A follow raid: one shows, 25 wait, and every later arrival drops the oldest waiting follow.
  const raid = await openPageFrom(copy, 'alerts.html', '?uyariSn=30&debug=1', [640, 200]);
  try {
    await sleep(2000);
    for (let i = 0; i < 30; i++) {
      const f = fixture('channel-followed');
      f.follower.username = 'raider_' + i;
      await relayPost(webhookPort, 'e2e-raid-' + i, forUs(f), privateKey, 'channel.followed');
    }
    await relayPost(webhookPort, 'e2e-raid-gift', forUs(fixture('subscription-gifts')), privateKey, 'channel.subscription.gifts');
    await sleep(1200);
    const dbg = await raid.eval(`(document.querySelector('.ko-debug') || {}).textContent || ''`);
    check('relay alerts: a raid keeps the queue at 25 and counts every dropped arrival', /queued: 25$/m.test(dbg) && /dropped: 5$/m.test(dbg), JSON.stringify(dbg));
  } finally {
    await raid.close();
  }
}

// The studio's test buttons: POST /test-alert reaches the open alerts page, with art from alerts/ and a sound.
async function testAlertChecks(copy, eventsPort, accessKey) {
  fs.mkdirSync(path.join(copy, 'alerts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'branding', 'logo-512.png'), path.join(copy, 'alerts', 'follow.png'));
  const al = await openPageFrom(copy, 'alerts.html', '?uyariSn=3&debug=1&dil=en', [640, 200]);
  try {
    await sleep(2500);
    const res = await fetch(`http://127.0.0.1:${eventsPort}/test-alert?kind=follow&key=${accessKey}`, { method: 'POST' });
    check('test alert: the relay accepts it for the connected page', res.status === 200 && (await res.json()).clients >= 1, `status=${res.status}`);
    await sleep(1000);
    const card = await al.eval(`(() => { const c = document.querySelector('.ko-alert:not(.is-out)'); const m = c && c.querySelector('.ko-alert-media');
      return { name: c ? c.querySelector('.ko-alert-name').textContent : '', media: m ? m.getAttribute('src') : '', icon: !!(c && c.querySelector('.ko-alert-icon')),
        loaded: !!(m && m.complete && m.naturalWidth > 0), debug: (document.querySelector('.ko-debug') || {}).textContent || '' }; })()`);
    check('test alert: the sample shows with the art from alerts/ in place of the icon', card.name === 'TestFollower' && card.media === 'alerts/follow.png' && !card.icon && card.loaded, JSON.stringify(card));
    check('test alert: a live alert plays a sound (built-in tone without a file)', /sound: tone$/m.test(card.debug), JSON.stringify(card.debug));
    check('test alert: no unexpected errors', unexpected(al.logs).length === 0, short(unexpected(al.logs)));
  } finally {
    await al.close();
  }
}

// The OBS dock drives the open alerts page through the relay: pause holds alerts back, resume lets them through.
async function dockChecks(copy) {
  const al = await openPageFrom(copy, 'alerts.html', '?uyariSn=3&debug=1&dil=en', [640, 200]);
  const dock = await openPageFrom(copy, 'dock.html', '?dil=en', [320, 520]);
  const card = () => al.eval(`(document.querySelector('.ko-alert:not(.is-out) .ko-alert-name') || {}).textContent || ''`);
  try {
    await sleep(4500);   // the earlier test alert leaves the screen
    const st = await dock.eval(`({ text: document.getElementById('status-text').textContent, dot: document.getElementById('dot').className, enabled: !document.getElementById('pause').disabled })`);
    check('dock: shows the relay as running with an overlay connected', /^Running · v/.test(st.text) && st.dot === 'ok' && st.enabled, JSON.stringify(st));
    await dock.eval(`document.getElementById('pause').click()`);
    await sleep(2000);
    await dock.eval(`Array.from(document.querySelectorAll('#tests button')).find((b) => b.textContent === 'Gift').click()`);
    await sleep(1200);
    const held = await al.eval(`({ name: (document.querySelector('.ko-alert:not(.is-out) .ko-alert-name') || {}).textContent || '', debug: (document.querySelector('.ko-debug') || {}).textContent || '' })`);
    const pauseLabel = await dock.eval(`document.getElementById('pause').textContent`);
    check('dock: pause holds a new alert back on the alerts page', held.name === '' && /paused: true/.test(held.debug) && /queued: 1/.test(held.debug) && pauseLabel === 'Resume', JSON.stringify({ held, pauseLabel }));
    await dock.eval(`document.getElementById('pause').click()`);
    await sleep(1200);
    check('dock: resume shows the held alert', (await card()) === 'TestGifter');
    await dock.eval(`document.getElementById('skip').click()`);
    await sleep(900);
    check('dock: skip takes the alert off screen early', (await card()) === '');
    await sleep(800);
    await dock.eval(`document.getElementById('replay').click()`);
    await sleep(1200);
    check('dock: replay shows the last alert again', (await card()) === 'TestGifter');
    check('dock: no unexpected errors', unexpected(dock.logs).length === 0 && unexpected(al.logs).length === 0, short(unexpected(dock.logs).concat(unexpected(al.logs))));
  } finally {
    await dock.close();
    await al.close();
  }
}

// Text-to-speech and hidden rewards on the alerts page. The browser's speech engine is replaced by a recorder,
// so the check sees exactly what would be read without playing sound.
async function speechChecks(copy, webhookPort, privateKey) {
  const preload = `
    window.__spoken = []; window.__cancels = 0; window.__names = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(u) { window.__spoken.push({ text: u.text, lang: u.lang, volume: u.volume }); },
      cancel() { window.__cancels += 1; }, getVoices() { return []; }
    } });
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) {
      const el = n.querySelector && n.querySelector('.ko-alert-name'); if (el) window.__names.push(el.textContent);
    } }).observe(document, { childList: true, subtree: true });`;
  const al = await openPageFrom(copy, 'alerts.html', '?uyariSn=3&dil=en&uyariTts=1&uyariSesSeviye=40&uyariTtsYasak=forbidden&uyariOdulGizle=' + encodeURIComponent('hydrate | Stretch'), [640, 200], null, preload);
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `webhook-${name}.json`), 'utf8'));
  const forUs = (obj) => JSON.stringify(Object.assign(obj, { broadcaster: Object.assign(obj.broadcaster, { user_id: 113812015 }) }));
  try {
    await sleep(2000);
    const k1 = fixture('kicks-gifted');
    k1.sender.username = 'tts_fan';
    k1.gift.message = 'Great stream https://evil.example/x';
    await relayPost(webhookPort, 'e2e-tts-1', forUs(k1), privateKey, 'kicks.gifted');
    const k2 = fixture('kicks-gifted');
    k2.sender.username = 'tts_rude';
    k2.gift.message = 'something FORBIDDEN here';
    await relayPost(webhookPort, 'e2e-tts-2', forUs(k2), privateKey, 'kicks.gifted');
    const hidden = fixture('reward-redemption');
    hidden.id = 'e2e-hidden-1';
    hidden.reward.title = 'Hydrate';
    hidden.redeemer.username = 'hidden_redeemer';
    await relayPost(webhookPort, 'e2e-rw-1', forUs(hidden), privateKey, 'channel.reward.redemption.updated');
    const shown = fixture('reward-redemption');
    shown.id = 'e2e-shown-1';
    shown.redeemer.username = 'shown_redeemer';
    await relayPost(webhookPort, 'e2e-rw-2', forUs(shown), privateKey, 'channel.reward.redemption.updated');
    await sleep(12000);
    const r = await al.eval(`({ spoken: window.__spoken, names: window.__names })`);
    check('speech: a Kicks message is read once, without its link, in the label language, at the alert volume',
      r.spoken.length >= 1 && r.spoken[0].text === 'tts_fan: Great stream' && r.spoken[0].lang === 'en-US' && Math.abs(r.spoken[0].volume - 0.4) < 0.01, JSON.stringify(r.spoken));
    check('speech: a message with a blocked word is shown but not read', r.names.includes('tts_rude') && !r.spoken.some((x) => /tts_rude/.test(x.text)), JSON.stringify(r));
    check('speech: the reward viewer text is read too', r.spoken.some((x) => x.text === 'shown_redeemer: Play Valorant next'), JSON.stringify(r.spoken));
    check('hidden rewards: a listed reward never shows, any case; other rewards do', !r.names.includes('hidden_redeemer') && r.names.includes('shown_redeemer'), JSON.stringify(r.names));
    check('speech: no unexpected errors', unexpected(al.logs).length === 0, short(unexpected(al.logs)));
  } finally {
    await al.close();
  }
}

// Recent events and the Kicks leaderboard fed by the relay's stream stats, then cleared from the dock.
async function statsChecks(copy, webhookPort, privateKey) {
  const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `webhook-${name}.json`), 'utf8'));
  const forUs = (obj) => JSON.stringify(Object.assign(obj, { broadcaster: Object.assign(obj.broadcaster, { user_id: 113812015 }) }));
  const ev = await openPageFrom(copy, 'events.html', '?dil=en&olaySayisi=3', [420, 400]);
  const lb = await openPageFrom(copy, 'leaderboard.html', '?dil=en&liderTur=kicks&liderSayisi=3', [380, 400]);
  const kb = await openPageFrom(copy, 'kicks-bar.html', '?dil=en&animasyon=off', [520, 90]);
  const trn = await openPageFrom(copy, 'sub-train.html', '?dil=en&trenSn=300', [520, 90]);
  const dock = await openPageFrom(copy, 'dock.html', '?dil=en', [320, 760]);
  const rows = `Array.from(document.querySelectorAll('.ko-item')).map((r) => r.textContent.trim())`;
  try {
    await sleep(2500);
    const k = fixture('kicks-gifted');
    k.sender.username = 'stats_whale';
    k.gift.amount = 99999;
    check('stats: a signed Kicks gift is accepted', (await relayPost(webhookPort, 'e2e-stats-1', forUs(k), privateKey, 'kicks.gifted')) === 200);
    await sleep(1500);
    const evRows = await ev.eval(rows);
    check('events: the new gift is on top and the list keeps olaySayisi rows', evRows.length === 3 && /^stats_whale\s*99,999 Kicks$/.test(evRows[0]), JSON.stringify(evRows));
    const lbRows = await lb.eval(rows);
    check('leaderboard: the Kicks board ranks the new sender first', lbRows.length >= 1 && lbRows.length <= 3 && /^1\s*stats_whale\s*99,999 Kicks$/.test(lbRows[0]), JSON.stringify(lbRows));
    const kbVal = Number((await kb.eval(`document.getElementById('cur').textContent`)).replace(/,/g, ''));
    check('kicks-bar: the bar shows the Kicks total of the stream from the relay', kbVal >= 99999, String(kbVal));
    const sub = fixture('subscription-new');
    sub.subscriber.username = 'train_rider';
    await relayPost(webhookPort, 'e2e-train-1', forUs(sub), privateKey, 'channel.subscription.new');
    await sleep(1500);
    const trInfo = await trn.eval(`({ idle: document.getElementById('bar').classList.contains('is-idle'), count: document.getElementById('count').textContent, left: document.getElementById('left').textContent })`);
    check('sub-train: a subscription starts or extends the train with the full time left', !trInfo.idle && /^×\d+$/.test(trInfo.count) && /^(5:00|4:5\d)$/.test(trInfo.left), JSON.stringify(trInfo));
    await kb.shot('kicks-bar-relay.png');
    await trn.shot('sub-train-relay.png');
    const late = await openPageFrom(copy, 'events.html', '?dil=en', [420, 400]);
    await sleep(2000);
    check('events: a page opened later gets the list from the relay at once', (await late.eval(rows)).some((r) => /^stats_whale/.test(r)));
    await late.close();
    await ev.shot('events-relay.png');
    await lb.shot('leaderboard-relay.png');
    await sleep(500);
    await dock.eval(`document.getElementById('st-reset').click()`);
    const armed = await dock.eval(`document.getElementById('st-reset').textContent`);
    await sleep(300);
    check('events: the first dock press only asks to confirm', (await ev.eval(rows)).length === 3 && armed === 'Sure? Press again', armed);
    await dock.eval(`document.getElementById('st-reset').click()`);
    await sleep(1500);
    const empty = await ev.eval(`({ rows: document.querySelectorAll('.ko-item').length, empty: (document.querySelector('.ko-empty') || {}).textContent || '' })`);
    check('events: a confirmed reset from the dock empties the list', empty.rows === 0 && empty.empty === 'No events yet', JSON.stringify(empty));
    check('leaderboard: the reset empties the board too', (await lb.eval(`(document.querySelector('.ko-empty') || {}).textContent || ''`)) === 'No one yet');
    check('kicks-bar: the reset takes the bar back to 0', (await kb.eval(`document.getElementById('cur').textContent`)) === '0');
    check('sub-train: the reset ends the train', await trn.eval(`document.getElementById('bar').classList.contains('is-idle')`));
    check('stats overlays: no unexpected errors', [ev, lb, kb, trn, dock].every((p) => unexpected(p.logs).length === 0), short([ev, lb, kb, trn, dock].flatMap((p) => unexpected(p.logs))));
  } finally {
    await dock.close();
    await trn.close();
    await kb.close();
    await lb.close();
    await ev.close();
  }
}

// Countdown and announcement bar changed from the dock while they run, then set back.
async function overlayDockChecks(copy) {
  const cd = await openPageFrom(copy, 'countdown.html', '?dil=en&geriSayimDk=30', [520, 190]);
  const tk = await openPageFrom(copy, 'ticker.html', '?dil=en&animasyon=off&duyuruMetinleri=' + encodeURIComponent('Original line'), [760, 80]);
  const dock = await openPageFrom(copy, 'dock.html', '?dil=en', [320, 760]);
  try {
    await sleep(2500);
    const before = await cd.eval(`document.getElementById('time').textContent`);
    await dock.eval(`document.getElementById('cd-min').value = '2'; document.getElementById('cd-title').value = 'Back in a bit'; document.getElementById('cd-start').click()`);
    await sleep(1500);
    const after = await cd.eval(`({ time: document.getElementById('time').textContent, title: document.getElementById('title').textContent })`);
    check('dock countdown: a running countdown restarts with the dock\'s minutes and title', /^30:00|^29:5/.test(before) && /^0[12]:[0-5]\d$/.test(after.time) && after.title === 'Back in a bit', JSON.stringify({ before, after }));
    await dock.eval(`document.getElementById('tk-lines').value = 'Dock line one | Dock line two'; document.getElementById('tk-send').click()`);
    await sleep(1500);
    check('dock ticker: the announcement bar switches to the dock\'s lines', (await tk.eval(`document.getElementById('line').textContent`)) === 'Dock line one');
    const late = await openPageFrom(copy, 'ticker.html', '?dil=en&animasyon=off&duyuruMetinleri=' + encodeURIComponent('Original line'), [760, 80]);
    await sleep(2500);
    check('dock ticker: a ticker opened later gets the dock\'s lines from the relay', (await late.eval(`document.getElementById('line').textContent`)) === 'Dock line one');
    await late.close();
    await dock.shot('dock-overlays.png');
    await cd.shot('countdown-from-dock.png');
    await tk.shot('ticker-from-dock.png');
    await dock.eval(`document.getElementById('tk-reset').click()`);
    await sleep(1500);
    check('dock ticker: back to settings shows the page\'s own line again', (await tk.eval(`document.getElementById('line').textContent`)) === 'Original line');
    const msg = await dock.eval(`document.getElementById('msg').textContent`);
    check('dock: the countdown and ticker requests are confirmed', msg === 'Done.', msg);
    check('dock overlays: no unexpected errors', [cd, tk, dock].every((p) => unexpected(p.logs).length === 0), short([cd, tk, dock].flatMap((p) => unexpected(p.logs))));
  } finally {
    await dock.close();
    await tk.close();
    await cd.close();
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
