#!/usr/bin/env node
// Automated checks for the Kick overlay pack. Plain Node, no npm.
//
//   Run from the project root:   node tests/run.js
//
// Prints one line per check plus a summary. Exit code 1 when any check FAILs.
// PENDING means a page is missing or still has old markup; it does not fail the run.
// The core is loaded into a vm context, so these tests run the real shared/kick-core.js.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startMockKick, CLIENT_ID, CLIENT_SECRET } = require('./mock-kick-api.js');

const ROOT = path.join(__dirname, '..');
const CORE_FILE = path.join(ROOT, 'shared', 'kick-core.js');
const CSS_FILE = path.join(ROOT, 'shared', 'themes.css');
const SETTINGS_FILE = path.join(ROOT, 'AYARLAR.js');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const OVERLAY_PAGES = ['follower-bar.html', 'subscriber-bar.html', 'combined-bar.html', 'info-panel.html', 'chat.html', 'countdown.html', 'ticker.html'];
// The studio is a configurator: it generates AYARLAR.js, so it does not load the settings scripts.
const STUDIO_PAGE = 'studio.html';

// Dummy client values, accepted only by the mock. They are not Kick credentials.
const TEST_LOCAL = {
  kickClientId: CLIENT_ID,
  kickClientSecret: CLIENT_SECRET,
  apiBase: 'https://api.kick.test',
  tokenBase: 'https://id.kick.test'
};

const DEFAULTS = {
  kanal: '', stil: 'glass', sekil: 'pill', yaziTipi: 'inter', dil: 'both', animasyon: 'normal',
  renk: '#53fc18', yayinciYazisi: 'Streamer', takipciHedefi: 1000, takipciYedek: 0,
  aboneHedefi: 100, aboneSayisi: 0, oturumFarkiGoster: true, yuzdeGoster: false,
  yenilemeSn: 30, sohbetMaksMesaj: 8, geriSayimDk: 5, geriSayimBaslik: '', duyuruMetinleri: '', duyuruSn: 6,
  geriSayimSaat: '', sohbetKomutGizle: false, sohbetGizliKullanicilar: '', sohbetSilinmeSn: 0,
  hataNotu: true, hedefKutlama: true
};
const RELAY = 'http://127.0.0.1:8790';

const CORE_SOURCE = fs.readFileSync(CORE_FILE, 'utf8');

// ---- Runner ------------------------------------------------------------------

const counts = { PASS: 0, FAIL: 0, PENDING: 0 };

class Pending extends Error {}

function report(status, name, note) {
  counts[status] += 1;
  console.log(status.padEnd(8) + name + (note ? ' - ' + note : ''));
}

async function check(name, fn) {
  try {
    await fn();
    report('PASS', name);
  } catch (err) {
    if (err instanceof Pending) report('PENDING', name, err.message);
    else report('FAIL', name, String((err && err.message) || err).split('\n')[0]);
  }
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

function deepEq(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length &&
    ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
}

// Values from the vm context have their own prototypes, so compare structure, not identity.
function eq(actual, expected, label) {
  if (!deepEq(actual, expected)) {
    throw new Error(label + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function eqFields(obj, expected, prefix) {
  Object.keys(expected).forEach((k) => eq(obj[k], expected[k], (prefix || '') + k));
}

function ok(cond, label) {
  if (!cond) throw new Error(label);
}

// ---- Helpers: core in a vm context, fake network -----------------------------

// Each call gets a fresh context, so module state (token cache) never leaks between checks.
function loadCore(opts = {}) {
  const env = { now: 0, frames: [] };
  const ctx = {
    console,
    Date: opts.Date || Date,
    JSON,
    URLSearchParams,
    AbortController,
    setTimeout: opts.setTimeout || setTimeout,
    clearTimeout: opts.clearTimeout || clearTimeout,
    setInterval,
    clearInterval,
    fetch: opts.fetch || (async () => { throw new TypeError('no fetch in this check'); }),
    WebSocket: opts.WebSocket,
    EventSource: opts.EventSource,
    document: opts.document,
    localStorage: opts.localStorage,
    location: { search: opts.search || '' },
    performance: { now: () => env.now },
    requestAnimationFrame: (cb) => { env.frames.push(cb); return env.frames.length; },
    cancelAnimationFrame: () => {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (opts.ayarlar) ctx.KICK_OVERLAY_AYARLAR = opts.ayarlar;
  if (opts.yerel) ctx.KICK_OVERLAY_YEREL = opts.yerel;
  vm.runInContext(CORE_SOURCE, ctx, { filename: CORE_FILE });
  return { K: ctx.KickOverlay, ctx, env };
}

// Fake fetch. `route(call)` returns {status, body}, throws, or returns a promise of either.
function fakeNet(route) {
  const calls = [];
  async function fetch(url, opts = {}) {
    const call = {
      url: String(url),
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
      signal: opts.signal
    };
    calls.push(call);
    const r = await route(call, calls.length);
    const hdr = {};
    Object.keys(r.headers || {}).forEach((k) => { hdr[k.toLowerCase()] = String(r.headers[k]); });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => (String(name).toLowerCase() in hdr ? hdr[String(name).toLowerCase()] : null) },
      json: async () => r.body
    };
  }
  return { fetch, calls };
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

function withSubs(obj, subs) {
  const copy = JSON.parse(JSON.stringify(obj));
  copy.data[0].active_subscribers_count = subs;
  return copy;
}

function liveBody(subs) {
  return { status: 200, body: withSubs(fixture('official-channels-live.json'), subs) };
}

// Subscriber counts by data-call number (1-based); the last value repeats.
function liveSubs(...values) {
  return (c, n) => liveBody(values[Math.min(n, values.length) - 1]);
}

// Fake official API. Issues tokens tok-1, tok-2, ... Data calls need an issued token.
// Calls to the local relay (RELAY) go to `relay(call, n)` when given; otherwise the relay is "down" (connection refused).
function officialFake({ token, channel = liveSubs(42), relay } = {}) {
  const issued = new Set();
  let tokenSeq = 0;
  let channelSeq = 0;
  let relaySeq = 0;
  return fakeNet(async (c) => {
    if (c.url.startsWith(RELAY)) {
      if (!relay) throw new TypeError('relay down');
      relaySeq += 1;
      return relay(c, relaySeq);
    }
    if (c.url.endsWith('/oauth/token')) {
      tokenSeq += 1;
      if (token) return token(c, tokenSeq);
      issued.add('tok-' + tokenSeq);
      return { status: 200, body: { access_token: 'tok-' + tokenSeq, token_type: 'Bearer', expires_in: 3600 } };
    }
    channelSeq += 1;
    const bearer = String(c.headers.Authorization || '').replace(/^Bearer /, '');
    if (!issued.has(bearer)) return { status: 401, body: { data: {}, message: 'Unauthorized' } };
    return channel(c, channelSeq);
  });
}

const isTokenCall = (c) => c.url.endsWith('/oauth/token');
const isRelayCall = (c) => c.url.startsWith(RELAY);
const dataCalls = (net) => net.calls.filter((c) => !isTokenCall(c) && !isRelayCall(c));
const tokenCalls = (net) => net.calls.filter(isTokenCall);
const relayCalls = (net) => net.calls.filter(isRelayCall);
const kickCalls = (net) => net.calls.filter((c) => !isRelayCall(c));
const bearerOf = (call) => String(call.headers.Authorization || '');

// Source built from a core loaded with the given ayarlar/yerel and a fake network.
function subscriberSetup(net, { ayarlar = { kanal: 'example-channel' }, yerel = TEST_LOCAL } = {}) {
  const { K } = loadCore({ fetch: net.fetch, ayarlar, yerel });
  const s = K.readSettings();
  return { K, s, src: K.createSubscriberSource(s) };
}

function fakeDocument(bodyClass) {
  return {
    body: { className: bodyClass },
    documentElement: { style: { values: {}, setProperty(k, v) { this.values[k] = v; } } }
  };
}

function fakeWebSocket(sockets) {
  return class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
    }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  };
}

function stripCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Overlay page helpers. Missing or not-yet-migrated pages are PENDING, not FAIL.
function pageHtml(page) {
  const file = path.join(ROOT, page);
  if (!fs.existsSync(file)) throw new Pending('page not created yet');
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('shared/kick-core.js')) throw new Pending('still has old markup');
  return html;
}

function inlineScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const type = (/\btype\s*=\s*"([^"]*)"/i.exec(m[1]) || [])[1];
    if (type && !/javascript|ecmascript|module/i.test(type)) continue;
    out.push(m[2]);
  }
  return out;
}

// AYARLAR.local.js holds the Kick app credentials, so only pages that call the official API load it.
const LOCAL_SETTINGS_PAGES = ['subscriber-bar.html', 'combined-bar.html'];

function checkHeadTemplate(html, page) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
  const preconnects = [...html.matchAll(/<link\b[^>]*\brel="preconnect"[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
  ok(preconnects.includes('https://fonts.googleapis.com'), 'preconnect to fonts.googleapis.com missing');
  ok(preconnects.includes('https://fonts.gstatic.com'), 'preconnect to fonts.gstatic.com missing');
  ok(!links.some((h) => /fonts\.googleapis\.com\/css/.test(h)), 'static Google Fonts stylesheet link must not be present (K.loadFont injects it)');
  ok(inlineScripts(html).some((code) => /\bK\.loadFont\(\s*S\s*\)/.test(code)), 'page does not call K.loadFont(S)');
  ok(links.includes('shared/themes.css'), 'shared/themes.css link missing');
  const iSettings = scripts.indexOf('AYARLAR.js');
  const iLocal = scripts.indexOf('AYARLAR.local.js');
  const iCore = scripts.indexOf('shared/kick-core.js');
  ok(iSettings >= 0 && iCore >= 0, 'AYARLAR.js or shared/kick-core.js script missing');
  if (LOCAL_SETTINGS_PAGES.includes(page)) {
    ok(iLocal >= 0, 'AYARLAR.local.js script missing');
    ok(iSettings < iLocal && iLocal < iCore, 'script order must be AYARLAR.js, AYARLAR.local.js, shared/kick-core.js');
  } else {
    ok(iLocal < 0 && !/AYARLAR\.local\.js/.test(html), 'must not load AYARLAR.local.js (credentials stay out of pages that never call the official API)');
    ok(iSettings < iCore, 'script order must be AYARLAR.js, shared/kick-core.js');
  }
}

// ---- Section: core API and settings -------------------------------------------

async function testCoreApi() {
  section('Core API surface');
  const { K } = loadCore();
  await check('kick-core.js loads and exposes the documented API', () => {
    ['readSettings', 'normalize', 'schemaKeys', 'enums', 'label', 'fmt', 'pct', 'applyLook', 'tween',
      'getJson', 'createSubscriberSource', 'connectRelay', 'isDebug', 'loadFont', 'setFill', 'poller', 'relayInfo',
      'text', 'createGoalBar', 'note', 'debug'].forEach((n) => ok(typeof K[n] === 'function', 'missing ' + n));
    ['followers', 'live', 'subBadges', 'time', 'official'].forEach((n) =>
      ok(typeof K.parse[n] === 'function', 'missing parse.' + n));
    ok(typeof K.kick.channel === 'function', 'missing kick.channel');
    eq(K.version, '2.3.0', 'version');
    ['token', 'channel', 'clearToken'].forEach((n) => ok(typeof K.official[n] === 'function', 'missing official.' + n));
  });
}

async function testNormalize() {
  section('Settings: normalize()');
  const { K } = loadCore();

  await check('defaults apply when no values are given', () => {
    eqFields(K.normalize({}), DEFAULTS, '');
    eqFields(K.normalize(null), DEFAULTS, '');
  });

  await check('enum values are case-insensitive; unknown values fall back', () => {
    eq(K.normalize({ stil: 'NEON' }).stil, 'neon', 'stil NEON');
    eq(K.normalize({ stil: 'hexagon' }).stil, 'glass', 'stil hexagon');
    eqFields(K.normalize({ sekil: 'Square', yaziTipi: 'MONO', animasyon: 'OFF', dil: 'EN' }),
      { sekil: 'square', yaziTipi: 'mono', animasyon: 'off', dil: 'en' }, '');
    eqFields(K.normalize({ dil: 'xx', animasyon: 'fast' }), { dil: 'both', animasyon: 'normal' }, '');
  });

  await check('renk accepts only #rgb and #rrggbb', () => {
    eq(K.normalize({ renk: 'red' }).renk, '#53fc18', 'renk red');
    eq(K.normalize({ renk: '#abc' }).renk, '#abc', 'renk #abc');
    eq(K.normalize({ renk: '#AABBCC' }).renk, '#AABBCC', 'renk #AABBCC');
    eq(K.normalize({ renk: '#abcd' }).renk, '#53fc18', 'renk #abcd');
    eq(K.normalize({ renk: 'abc' }).renk, '#53fc18', 'renk without #');
  });

  await check('yenilemeSn is clamped to 10..600 and rounded', () => {
    eq(K.normalize({ yenilemeSn: 1 }).yenilemeSn, 10, 'yenilemeSn 1');
    eq(K.normalize({ yenilemeSn: 9999 }).yenilemeSn, 600, 'yenilemeSn 9999');
    eq(K.normalize({ yenilemeSn: '45' }).yenilemeSn, 45, 'yenilemeSn "45"');
    eq(K.normalize({ yenilemeSn: 45.6 }).yenilemeSn, 46, 'yenilemeSn 45.6');
  });

  await check('integers: bad text falls back; other ranges are clamped', () => {
    eq(K.normalize({ takipciHedefi: 'abc' }).takipciHedefi, 1000, 'takipciHedefi "abc"');
    eq(K.normalize({ takipciHedefi: 0 }).takipciHedefi, 1, 'takipciHedefi 0');
    eq(K.normalize({ takipciHedefi: 1e9 }).takipciHedefi, 1e8, 'takipciHedefi 1e9');
    eq(K.normalize({ takipciYedek: -5 }).takipciYedek, 0, 'takipciYedek -5');
    eq(K.normalize({ aboneHedefi: 0 }).aboneHedefi, 1, 'aboneHedefi 0');
    eq(K.normalize({ sohbetMaksMesaj: 99 }).sohbetMaksMesaj, 20, 'sohbetMaksMesaj 99');
    eq(K.normalize({ sohbetMaksMesaj: 2 }).sohbetMaksMesaj, 3, 'sohbetMaksMesaj 2');
  });

  await check('booleans: "true", 1, "0" and 0 parse; other text falls back', () => {
    eq(K.normalize({ oturumFarkiGoster: 'true' }).oturumFarkiGoster, true, '"true"');
    eq(K.normalize({ yuzdeGoster: 1 }).yuzdeGoster, true, '1');
    eq(K.normalize({ oturumFarkiGoster: 0 }).oturumFarkiGoster, false, '0');
    eq(K.normalize({ oturumFarkiGoster: '0' }).oturumFarkiGoster, false, '"0"');
    eq(K.normalize({ yuzdeGoster: 'maybe' }).yuzdeGoster, false, '"maybe" falls back to default');
  });

  await check('kanal is trimmed and lowercased', () => {
    eq(K.normalize({ kanal: '  ExAmple-Channel  ' }).kanal, 'example-channel', 'kanal');
  });

  await check('yayinciYazisi is cut to 24 characters', () => {
    eq(K.normalize({ yayinciYazisi: 'x'.repeat(30) }).yayinciYazisi.length, 24, 'length');
  });
}

async function testReadSettings() {
  section('Settings: readSettings() precedence and URL rules');

  await check('readSettings: defaults when nothing is set; result is frozen', () => {
    const { K } = loadCore();
    const s = K.readSettings();
    eqFields(s, DEFAULTS, '');
    ok(Object.isFrozen(s), 'settings object is not frozen');
    eq(s.apiBase, 'https://api.kick.com', 'apiBase default');
    eq(s.tokenBase, 'https://id.kick.com', 'tokenBase default');
    eq(s.kickClientId, '', 'kickClientId default');
  });

  await check('readSettings: precedence is AYARLAR.js < AYARLAR.local.js < URL', () => {
    const { K } = loadCore({
      ayarlar: { kanal: 'FromFile', stil: 'neon', takipciHedefi: 500 },
      yerel: { stil: 'minimal', takipciHedefi: 700 },
      search: '?stil=pastel'
    });
    const s = K.readSettings();
    eq(s.kanal, 'fromfile', 'kanal from AYARLAR.js');
    eq(s.stil, 'pastel', 'stil from URL wins');
    eq(s.takipciHedefi, 700, 'takipciHedefi from AYARLAR.local.js');
    eq(s.sekil, 'pill', 'sekil default');
  });

  await check('readSettings: URL values are normalized like file values', () => {
    const { K } = loadCore({ search: '?stil=NEON&yenilemeSn=1&kanal=%20Mixed%20&yuzdeGoster=true&renk=red' });
    const s = K.readSettings();
    eqFields(s, { stil: 'neon', yenilemeSn: 10, kanal: 'mixed', yuzdeGoster: true, renk: '#53fc18' }, '');
  });

  await check('readSettings: URL cannot override Kick credentials or API bases', () => {
    const { K } = loadCore({
      yerel: { kickClientId: 'local-id', kickClientSecret: 'local-secret' },
      search: '?kickClientId=url-id&kickClientSecret=url-secret&apiBase=https://evil.example.com&tokenBase=https://evil.example.com'
    });
    const s = K.readSettings();
    // Messages avoid printing the values on purpose.
    ok(s.kickClientId === 'local-id', 'kickClientId was overridden from the URL');
    ok(s.kickClientSecret === 'local-secret', 'kickClientSecret was overridden from the URL');
    eq(s.apiBase, 'https://api.kick.com', 'apiBase from URL');
    eq(s.tokenBase, 'https://id.kick.com', 'tokenBase from URL');
  });

  await check('readSettings: Kick credentials are read only from AYARLAR.local.js, never from AYARLAR.js', () => {
    const fromFile = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret', apiBase: 'https://api.kick.test', relayAdresi: 'http://127.0.0.1:9999' }
    }).K.readSettings();
    // Messages avoid printing the values on purpose.
    ok(fromFile.kickClientId === '', 'kickClientId was taken from AYARLAR.js');
    ok(fromFile.kickClientSecret === '', 'kickClientSecret was taken from AYARLAR.js');
    eq(fromFile.apiBase, 'https://api.kick.test', 'apiBase may still come from AYARLAR.js');
    eq(fromFile.relayAdresi, 'http://127.0.0.1:9999', 'relayAdresi may still come from AYARLAR.js');
    const both = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret' },
      yerel: { kickClientId: 'local-id', kickClientSecret: 'local-secret' }
    }).K.readSettings();
    ok(both.kickClientId === 'local-id', 'kickClientId must come from AYARLAR.local.js');
    ok(both.kickClientSecret === 'local-secret', 'kickClientSecret must come from AYARLAR.local.js');
    const mixed = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret' },
      yerel: { kickClientId: 'local-id' }
    }).K.readSettings();
    ok(mixed.kickClientSecret === '', 'a file secret must not pair with a local id');
  });

  await check('readSettings: apiBase and tokenBase accept https with a trailing slash (slash removed)', () => {
    const { K } = loadCore({ yerel: { apiBase: 'https://api.kick.test/', tokenBase: 'https://id.kick.test//' } });
    const s = K.readSettings();
    eq(s.apiBase, 'https://api.kick.test', 'apiBase');
    eq(s.tokenBase, 'https://id.kick.test', 'tokenBase');
  });

  await check('readSettings: apiBase accepts http://localhost:PORT/ (with slash)', () => {
    const { K } = loadCore({ yerel: { apiBase: 'http://localhost:8787/', tokenBase: 'http://127.0.0.1:8787/' } });
    const s = K.readSettings();
    eq(s.apiBase, 'http://localhost:8787', 'apiBase');
    eq(s.tokenBase, 'http://127.0.0.1:8787', 'tokenBase');
  });

  await check('readSettings: apiBase and tokenBase accept http://localhost:PORT without a trailing slash', () => {
    const { K } = loadCore({ yerel: { apiBase: 'http://localhost:8787', tokenBase: 'http://localhost:8787' } });
    const s = K.readSettings();
    eq(s.apiBase, 'http://localhost:8787', 'apiBase');
    eq(s.tokenBase, 'http://localhost:8787', 'tokenBase');
  });

  await check('readSettings: apiBase and tokenBase reject other hosts and schemes', () => {
    const bad = ['http://evil.example.com', 'http://localhost.evil.example/', 'http://127.0.0.1.evil.example/',
      'ftp://example.com/', 'javascript:alert(1)', 'http://user@evil.example.com/'];
    bad.forEach((v) => {
      const { K } = loadCore({ yerel: { apiBase: v, tokenBase: v } });
      const s = K.readSettings();
      eq(s.apiBase, 'https://api.kick.com', 'apiBase for ' + v);
      eq(s.tokenBase, 'https://id.kick.com', 'tokenBase for ' + v);
    });
  });

  await check('AYARLAR.js loads and holds no Kick credentials', () => {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SETTINGS_FILE, 'utf8'), sandbox, { filename: SETTINGS_FILE });
    const raw = sandbox.KICK_OVERLAY_AYARLAR;
    ok(raw && typeof raw === 'object', 'KICK_OVERLAY_AYARLAR is not an object');
    ok(!('kickClientId' in raw) && !('kickClientSecret' in raw), 'AYARLAR.js contains Kick credentials');
  });

  await check('.gitignore excludes AYARLAR.local.js', () => {
    const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    ok(lines.includes('AYARLAR.local.js'), 'AYARLAR.local.js is not in .gitignore');
  });
}

// ---- Section: labels, numbers, look, tween -------------------------------------

async function testHelpers() {
  section('Labels, numbers, look');
  const { K, ctx, env } = loadCore();

  await check('label() picks tr, en, or both', () => {
    eq(K.label({ dil: 'tr' }, 'Takipçi', 'Follower'), 'Takipçi', 'tr');
    eq(K.label({ dil: 'en' }, 'Takipçi', 'Follower'), 'Follower', 'en');
    eq(K.label({ dil: 'both' }, 'Takipçi', 'Follower'), 'Takipçi / Follower', 'both');
  });

  await check('fmt() groups thousands and handles bad input', () => {
    eq(K.fmt(1234567), '1,234,567', '1234567');
    eq(K.fmt(0), '0', '0');
    eq(K.fmt('1234'), '1,234', 'string');
    eq(K.fmt(12.6), '13', 'rounds');
    eq(K.fmt(undefined), '0', 'undefined');
    eq(K.fmt('abc'), '0', 'text');
  });

  await check('pct() handles goal 0, bad goals, negatives and values over the goal', () => {
    eq(K.pct(5, 0), 0, 'goal 0');
    eq(K.pct(5, -1), 0, 'negative goal');
    eq(K.pct(150, 100), 100, 'over goal is capped');
    eq(K.pct(-5, 100), 0, 'negative current');
    eq(K.pct(25, 100), 25, 'normal');
    ok(Math.abs(K.pct(1, 3) - 33.333) < 0.01, 'pct(1, 3)');
  });

  await check('applyLook() sets body classes and the accent variables', () => {
    const doc = fakeDocument('keep theme-old shape-x');
    ctx.document = doc;
    K.applyLook(K.normalize({ stil: 'neon', sekil: 'square', yaziTipi: 'mono', animasyon: 'off', renk: '#abc' }));
    const classes = doc.body.className.split(' ');
    ['keep', 'theme-neon', 'shape-square', 'font-mono', 'motion-off'].forEach((c) => ok(classes.includes(c), 'missing ' + c));
    ok(!classes.includes('theme-old') && !classes.includes('shape-x'), 'old look classes were kept');
    eq(doc.documentElement.style.values['--accent'], '#abc', '--accent');
    eq(doc.documentElement.style.values['--accent-rgb'], '170 187 204', '--accent-rgb');
  });

  await check('fmt() uses Turkish separators only for dil=tr, and applyLook() sets the document language', () => {
    ctx.document = fakeDocument('');
    K.applyLook(K.normalize({ dil: 'tr' }));
    eq(K.fmt(1234567), '1.234.567', 'tr');
    eq(ctx.document.documentElement.lang, 'tr', 'lang tr');
    K.applyLook(K.normalize({ dil: 'both' }));
    eq(K.fmt(1234567), '1,234,567', 'both');
    eq(ctx.document.documentElement.lang, 'en', 'lang en');
  });

  await check('tween() with 0 ms jumps straight to the end', () => {
    const seen = [];
    K.tween(0, 10, 0, (v) => seen.push(v));
    eq(seen, [10], 'values');
  });

  await check('tween() eases over time with the frame clock', () => {
    const seen = [];
    K.tween(0, 100, 1000, (v) => seen.push(v));
    env.now = 500;
    env.frames.shift()(500);
    env.now = 1000;
    env.frames.shift()(1000);
    ok(seen.length === 2, 'expected two frames, got ' + seen.length);
    ok(Math.abs(seen[0] - 87.5) < 1e-9, 'mid-frame value ' + seen[0]);
    eq(seen[1], 100, 'end value');
    eq(env.frames.length, 0, 'extra frames requested');
  });
}

// ---- Section: parsers (fixtures) ------------------------------------------------

async function testParsers() {
  section('Parsers (fixtures modeled on the documented responses)');
  const { K } = loadCore();
  const v2off = fixture('kick-v2-channel-offline.json');
  const v2live = fixture('kick-v2-channel-live.json');
  const v1 = fixture('kick-v1-channel.json');
  const officialLive = fixture('official-channels-live.json');
  const officialEmpty = fixture('official-channels-empty.json');
  const officialBad = fixture('official-channels-non-numeric.json');
  const startUtc = Date.UTC(2026, 9, 15, 20, 0, 0);

  await check('followers: v2 numeric string from fixture', () => eq(K.parse.followers(v2off), 12345, 'v2'));
  await check('followers: v1 number from fixture', () => eq(K.parse.followers(v1), 678, 'v1'));
  await check('followers: both fields missing gives null', () => eq(K.parse.followers({}), null, 'missing'));
  await check('followers: empty string gives null', () => eq(K.parse.followers({ followers_count: '' }), null, 'empty'));
  await check('followers: null input gives null', () => eq(K.parse.followers(null), null, 'null input'));

  await check('live: livestream null gives live false', () => {
    eqFields(K.parse.live(v2off), { live: false, viewers: 0, startMs: null }, '');
  });

  await check('live: running stream gives viewers and start time', () => {
    const r = K.parse.live(v2live);
    eq(r.live, true, 'live');
    eq(r.viewers, 12, 'viewers');
    eq(r.startMs, startUtc, 'startMs');
  });

  await check('time: "YYYY-MM-DD HH:MM:SS" is UTC; offsets are respected; junk gives null', () => {
    eq(K.parse.time('2026-10-15 20:00:00'), startUtc, 'space form');
    eq(K.parse.time('2026-10-15T20:00:00Z'), startUtc, 'ISO Z');
    eq(K.parse.time('2026-10-15T22:00:00+02:00'), startUtc, 'offset');
    eq(K.parse.time('nope'), null, 'junk');
    eq(K.parse.time(''), null, 'empty');
  });

  await check('subBadges: sorted from highest months to lowest (fixture)', () => {
    eq(K.parse.subBadges(v2off).map((b) => b.months), [12, 6, 1], 'months order');
    ok(K.parse.subBadges(v2off).every((b) => b.src.startsWith('https://')), 'badge src missing');
  });

  await check('subBadges: entries without an image are dropped', () => {
    eq(K.parse.subBadges({ subscriber_badges: [{ months: 3 }, null] }), [], 'no image');
  });

  await check('official: documented fields from fixture', () => {
    const r = K.parse.official(officialLive);
    eqFields(r, { subs: 42, gifted: 3, canceled: 1, live: true, viewers: 12, title: 'Example stream', startMs: startUtc }, '');
  });

  await check('official: empty data array gives null', () => eq(K.parse.official(officialEmpty), null, 'empty'));

  await check('official: non-numeric counts give null', () => {
    const r = K.parse.official(officialBad);
    eq(r.subs, null, 'subs');
    eq(r.gifted, null, 'gifted');
    eq(r.canceled, null, 'canceled');
    eq(r.viewers, null, 'viewers');
  });

}

// ---- Section: Kick public REST, getJson -----------------------------------------

async function testKickRest() {
  section('Kick public endpoints and getJson()');

  await check('getJson: returns status and data on 200', async () => {
    const net = fakeNet(() => ({ status: 200, body: { a: 1 } }));
    const r = await loadCore({ fetch: net.fetch }).K.getJson('https://example.test/x');
    eq(r.ok, true, 'ok');
    eq(r.status, 200, 'status');
    eq(r.data.a, 1, 'data');
  });

  await check('getJson: HTTP error, bad body and network error map to codes', async () => {
    const K1 = loadCore({ fetch: fakeNet(() => ({ status: 404, body: {} })).fetch }).K;
    const r1 = await K1.getJson('https://example.test/x');
    eq([r1.ok, r1.status, r1.error], [false, 404, 'http'], 'http');
    const K2 = loadCore({ fetch: fakeNet(() => ({ status: 200, body: 'text' })).fetch }).K;
    eq((await K2.getJson('https://example.test/x')).error, 'body', 'body');
    const K3 = loadCore({ fetch: fakeNet(() => { throw new TypeError('fetch failed'); }).fetch }).K;
    eq((await K3.getJson('https://example.test/x')).error, 'network', 'network');
  });

  await check('getJson: a request past timeoutMs resolves with error timeout', async () => {
    const net = fakeNet((c) => new Promise((_, reject) => {
      c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const K = loadCore({ fetch: net.fetch }).K;
    const r = await K.getJson('https://example.test/x', { timeoutMs: 20 });
    eq(r.error, 'timeout', 'error');
  });

  await check('kick.channel: v2 is used first and sends no token', async () => {
    const net = fakeNet(() => ({ status: 200, body: fixture('kick-v2-channel-offline.json') }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.src], [true, 'v2'], 'result');
    eq(net.calls.length, 1, 'requests');
    eq(net.calls[0].url, 'https://kick.com/api/v2/channels/example-channel', 'url');
    ok(!net.calls.some((c) => 'Authorization' in c.headers), 'an Authorization header was sent');
  });

  await check('kick.channel: falls back to v1 when v2 fails', async () => {
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? { status: 404, body: {} }
      : { status: 200, body: fixture('kick-v1-channel.json') }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.src], [true, 'v1'], 'result');
    eq(net.calls[1].url, 'https://kick.com/api/v1/channels/example-channel', 'v1 url');
  });

  await check('kick.channel: both versions failing gives ok false', async () => {
    const net = fakeNet(() => ({ status: 500, body: {} }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.error], [false, 'http'], 'result');
  });
}

// ---- Section: official token and channel ----------------------------------------

async function testOfficial() {
  section('Official API: token and channel');

  await check('official.token: no credentials gives no-credentials without a request', async () => {
    const net = officialFake();
    const { K } = loadCore({ fetch: net.fetch });
    const r = await K.official.token(K.readSettings());
    eq([r.ok, r.error], [false, 'no-credentials'], 'result');
    eq(net.calls.length, 0, 'requests');
  });

  await check('official.token: POST form to tokenBase; secret only in the body', async () => {
    const net = officialFake();
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const r = await K.official.token(s);
    eq(r.ok, true, 'ok');
    eq(net.calls.length, 1, 'requests');
    const c = net.calls[0];
    eq([c.method, c.url], ['POST', 'https://id.kick.test/oauth/token'], 'method and url');
    eq(c.headers['Content-Type'], 'application/x-www-form-urlencoded', 'content type');
    const form = new URLSearchParams(c.body);
    eq(form.get('grant_type'), 'client_credentials', 'grant_type');
    eq(form.get('client_id'), CLIENT_ID, 'client_id');
    ok(form.get('client_secret') === CLIENT_SECRET, 'client_secret missing from the form body');
    ok(!net.calls.some((x) => x.url.includes(CLIENT_SECRET)), 'client secret found in a request URL');
  });

  await check('official.token: token is cached for a second call', async () => {
    const net = officialFake();
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    await K.official.token(s);
    await K.official.token(s);
    eq(tokenCalls(net).length, 1, 'token requests');
  });

  await check('official.token: HTTP 401 from the token endpoint gives http with status 401', async () => {
    const net = officialFake({ token: () => ({ status: 401, body: { message: 'Unauthorized' } }) });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const r = await K.official.token(s);
    eq([r.ok, r.error, r.status], [false, 'http', 401], 'result');
  });

  await check('official.token: a network failure gives network', async () => {
    const net = officialFake({ token: () => { throw new TypeError('fetch failed'); } });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    eq((await K.official.token(s)).error, 'network', 'error');
  });

  await check('official.channel: sends the bearer token and parses the fields', async () => {
    const net = officialFake({ channel: liveSubs(42) });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const t = await K.official.token(s);
    const r = await K.official.channel(s, t.token);
    eqFields(r, { ok: true, status: 200, subs: 42, gifted: 3, canceled: 1, live: true, viewers: 12, title: 'Example stream' }, '');
    const data = dataCalls(net)[0];
    ok(bearerOf(data) === 'Bearer ' + t.token, 'data call did not send the bearer token');
    ok(!data.url.includes(CLIENT_SECRET), 'client secret in data URL');
  });
}

// ---- Section: subscriber source --------------------------------------------------

async function testSubscriberSource() {
  section('Subscriber source');

  await check('manual mode returns aboneSayisi with delta 0 and no network call', async () => {
    const net = fakeNet(() => { throw new TypeError('unexpected request'); });
    const { src } = subscriberSetup(net, { ayarlar: { kanal: 'example-channel', aboneSayisi: 17 }, yerel: {} });
    const r = await src.poll();
    eqFields(r, { mode: 'manual', status: 'manual', total: 17, delta: 0 }, '');
    // Adjusted for v2.3.0: with a kanal set, the first poll probes the relay (/health) to decide the mode.
    eq(kickCalls(net).length, 0, 'requests other than the relay probe');
    eq(net.calls.map((c) => c.url), [RELAY + '/health'], 'only the relay probe');
  });

  await check('token mode: first poll 42 has delta 0; second poll 45 has delta 3', async () => {
    const net = officialFake({ channel: liveSubs(42, 45) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 42, delta: 0 }, 'first ');
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 45, delta: 3 }, 'second ');
  });

  await check('token mode: the token is cached across polls', async () => {
    const net = officialFake({ channel: liveSubs(42, 45, 48) });
    const { src } = subscriberSetup(net);
    await src.poll();
    await src.poll();
    eq(tokenCalls(net).length, 1, 'token requests');
    const data = dataCalls(net);
    ok(bearerOf(data[0]) === bearerOf(data[1]), 'second poll used a different token');
  });

  await check('token mode: a 401 on the data call gives auth, then the next poll requests a new token', async () => {
    const net = officialFake({ channel: (c, n) => (n === 2 ? { status: 401, body: {} } : liveBody(42)) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { status: 'ok', total: 42 }, 'first ');
    eqFields(await src.poll(), { status: 'auth', total: 42 }, 'second ');
    eqFields(await src.poll(), { status: 'ok', total: 42 }, 'third ');
    eq(tokenCalls(net).length, 2, 'token requests');
    ok(bearerOf(dataCalls(net)[2]) === 'Bearer tok-2', 'third poll did not use the new token');
  });

  await check('token mode: a 429 gives rate and keeps the last known total', async () => {
    const net = officialFake({ channel: (c, n) => (n === 2 ? { status: 429, body: {} } : liveBody(42)) });
    const { src } = subscriberSetup(net);
    await src.poll();
    eqFields(await src.poll(), { status: 'rate', total: 42 }, '');
  });

  await check('token mode: a 429 before any value gives rate with total null', async () => {
    const net = officialFake({ channel: () => ({ status: 429, body: {} }) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { status: 'rate', total: null }, '');
  });

  await check('token mode: a thrown network error on the data call gives error', async () => {
    const net = officialFake({ channel: () => { throw new TypeError('fetch failed'); } });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a 500 on the data call gives error', async () => {
    const net = officialFake({ channel: () => ({ status: 500, body: {} }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a network failure on the token request gives error (not auth)', async () => {
    const net = officialFake({ token: () => { throw new TypeError('fetch failed'); } });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a 401 from the token endpoint gives auth', async () => {
    const net = officialFake({ token: () => ({ status: 401, body: {} }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'auth', 'status');
  });

  await check('token mode: subscriber count null gives no-data', async () => {
    const net = officialFake({ channel: () => liveBody(null) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'no-data', 'status');
  });

  await check('token mode: an empty data array gives no-data (Kick answered, no channel data)', async () => {
    const net = officialFake({ channel: () => ({ status: 200, body: { data: [], message: 'ok' } }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'no-data', 'status');
  });

  await check('token mode: no kanal gives no-channel without a request', async () => {
    const net = officialFake();
    const { src } = subscriberSetup(net, { ayarlar: {} });
    eq((await src.poll()).status, 'no-channel', 'status');
    eq(net.calls.length, 0, 'requests');
  });

  await check('missing credentials: source stays in manual mode and official.token says no-credentials', async () => {
    const net = officialFake();
    const { K, s, src } = subscriberSetup(net, { yerel: {} });
    eq(src.mode, 'manual', 'mode');
    eq((await src.poll()).status, 'manual', 'poll status');
    eq((await K.official.token(s)).error, 'no-credentials', 'token error');
    // Adjusted for v2.3.0: the poll probes the relay once; nothing else is requested.
    eq(kickCalls(net).length, 0, 'requests other than the relay probe');
  });
}

// ---- Section: chat feed ----------------------------------------------------------

// Stand-in for the browser's EventSource: records the URL and lets the test emit frames.
function fakeEventSource(list) {
  return class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; list.push(this); }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach((fn) => fn({ data })); }
    close() { this.closed = true; }
  };
}

async function testChatFeed() {
  section('Live chat (local relay)');

  await check('connectRelay: opens the relay stream and forwards chat and ban frames in the overlay shape', () => {
    const sources = [];
    const statuses = [];
    const messages = [];
    const { K } = loadCore({ EventSource: fakeEventSource(sources) });
    const stop = K.connectRelay('http://127.0.0.1:8790/events', { onMessage: (ev) => messages.push(ev), onStatus: (st) => statuses.push(st) });
    try {
      eq(sources.length, 1, 'one stream');
      eq(sources[0].url, 'http://127.0.0.1:8790/events', 'stream url');
      sources[0].onopen();
      sources[0].emit('chat', JSON.stringify({ kind: 'chat', id: 'm-1', username: 'viewer_one', message: 'hello', badges: [] }));
      sources[0].emit('ban', JSON.stringify({ userId: '9', username: 'spammer' }));
      eq(messages.map((m) => m.kind), ['chat', 'ban'], 'kinds');
      eq(messages[0].message, 'hello', 'chat text');
      eq(statuses, ['connecting', 'open'], 'statuses');
    } finally {
      stop();
    }
    eq(sources[0].closed, true, 'stop closes the stream');
  });

  await check('connectRelay: a dropped relay reports reconnecting, and a broken frame is ignored', () => {
    const sources = [];
    const statuses = [];
    const messages = [];
    const { K } = loadCore({ EventSource: fakeEventSource(sources) });
    const stop = K.connectRelay('http://127.0.0.1:8790/events', { onMessage: (ev) => messages.push(ev), onStatus: (st) => statuses.push(st) });
    try {
      sources[0].emit('chat', '{not json');
      sources[0].onerror();
      eq(statuses, ['connecting', 'reconnecting'], 'statuses');
      eq(messages.length, 0, 'no message from a broken frame');
    } finally {
      stop();
    }
  });
}

// ---- Section: mock server and the core against it ---------------------------------

async function testMockServer() {
  section('Mock Kick API (in-process, random port)');
  const mock = await startMockKick({ port: 0 });
  const api = mock.url;
  const formPost = (url, fields) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  const resetMock = () => fetch(api + '/__reset');
  // Returns a token from the mock after a reset, so subscriber counts start at 42.
  async function freshToken() {
    await resetMock();
    const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    return (await r.json()).access_token;
  }
  const channelsUrl = api + '/public/v1/channels?slug=example-channel';

  try {
    await check('mock: OPTIONS preflight returns 204 with CORS headers', async () => {
      const r = await fetch(channelsUrl, { method: 'OPTIONS' });
      eq(r.status, 204, 'status');
      eq(r.headers.get('access-control-allow-origin'), '*', 'allow-origin');
      eq(r.headers.get('access-control-allow-headers'), '*,Authorization', 'allow-headers');
      eq(r.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS', 'allow-methods');
    });

    await check('mock: token request with the test client fields returns a bearer token', async () => {
      await resetMock();
      const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      eq(r.status, 200, 'status');
      const j = await r.json();
      ok(typeof j.access_token === 'string' && j.access_token.length > 0, 'access_token missing');
      eqFields(j, { token_type: 'Bearer', expires_in: 3600 }, '');
    });

    await check('mock: wrong client secret gets 401 JSON', async () => {
      const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: 'wrong' });
      eq(r.status, 401, 'status');
      ok(typeof (await r.json()).message === 'string', 'no message in JSON');
    });

    await check('mock: channels without a bearer token get 401 Unauthorized', async () => {
      await resetMock();
      const r = await fetch(channelsUrl);
      eq(r.status, 401, 'status');
      eq((await r.json()).message, 'Unauthorized', 'message');
    });

    await check('mock: channels return the documented shape; count starts at 42 and steps by 3', async () => {
      const token = await freshToken();
      const auth = { Authorization: 'Bearer ' + token };
      const first = await (await fetch(channelsUrl, { headers: auth })).json();
      const ch = first.data[0];
      eqFields(ch, {
        slug: 'example-channel', broadcaster_user_id: 1, active_subscribers_count: 42,
        active_gifted_subscribers_count: 3, canceled_subscribers_count: 1, stream_title: 'test'
      }, '');
      eqFields(ch.stream, { is_live: true, viewer_count: 12, start_time: '2026-10-15T20:00:00Z' }, 'stream.');
      eq(first.message, 'ok', 'message');
      const second = await (await fetch(channelsUrl, { headers: auth })).json();
      eq(second.data[0].active_subscribers_count, 45, 'second count');
    });

    await check('mock: /__reset restores 42 and revokes issued tokens; /__stats counts calls', async () => {
      const token = await freshToken();
      await fetch(channelsUrl, { headers: { Authorization: 'Bearer ' + token } });
      await resetMock();
      eq((await fetch(channelsUrl, { headers: { Authorization: 'Bearer ' + token } })).status, 401, 'old token after reset');
      const stats = await (await fetch(api + '/__stats')).json();
      eq(stats.tokensIssued, 0, 'tokens issued after reset');
      eq(stats.channelCalls, 1, 'channel calls after reset');
    });

    await check('core against the mock: poll 42 then 45 gives delta 3', async () => {
      await resetMock();
      const K = loadCore({
        fetch: globalThis.fetch,
        ayarlar: { kanal: 'example-channel' },
        yerel: { kickClientId: CLIENT_ID, kickClientSecret: CLIENT_SECRET, apiBase: api + '/', tokenBase: api + '/' }
      }).K;
      const src = K.createSubscriberSource(K.readSettings());
      eqFields(await src.poll(), { status: 'ok', total: 42, delta: 0 }, 'first ');
      eqFields(await src.poll(), { status: 'ok', total: 45, delta: 3 }, 'second ');
    });
  } finally {
    await mock.close();
  }
}

// ---- Section: v2.3.0 core additions ---------------------------------------------------

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Virtual clock for the core's setTimeout/clearTimeout/Date.now. advance() fires due timers in order
// and lets promise chains settle between them. `log` records every delay that was requested.
function fakeClock(start = 1.7e12) {
  const c = { t: start, timers: [], seq: 0, log: [] };
  c.setTimeout = (fn, ms) => {
    c.seq += 1;
    c.log.push(ms);
    c.timers.push({ id: c.seq, at: c.t + (ms || 0), fn });
    return c.seq;
  };
  c.clearTimeout = (id) => { c.timers = c.timers.filter((x) => x.id !== id); };
  c.Date = class FakeDate extends Date { static now() { return c.t; } };
  c.advance = async (ms) => {
    const end = c.t + ms;
    for (;;) {
      await flush();
      const due = c.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      c.timers = c.timers.filter((x) => x !== due);
      c.t = Math.max(c.t, due.at);
      due.fn();
    }
    await flush();
    c.t = end;
  };
  c.opts = () => ({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, Date: c.Date });
  return c;
}

function setRandom(ctx, value) {
  ctx.__rnd = value;
  vm.runInContext('Math.random = function () { return __rnd; }', ctx);
}

function fakeEl() {
  const classes = new Set();
  return {
    hidden: false,
    textContent: '',
    offsetWidth: 0,
    classes,
    style: { vals: {}, setProperty(k, v) { this.vals[k] = v; } },
    classList: {
      add(...c) { c.forEach((x) => classes.add(x)); },
      remove(...c) { c.forEach((x) => classes.delete(x)); },
      toggle(cls, force) {
        const on = force === undefined ? !classes.has(cls) : !!force;
        if (on) classes.add(cls); else classes.delete(cls);
        return on;
      },
      contains: (cls) => classes.has(cls)
    }
  };
}

function fakeStorage(initial = {}) {
  const data = Object.assign({}, initial);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); }
  };
}

function throwingStorage() {
  const boom = () => { throw new Error('storage blocked'); };
  return { getItem: boom, setItem: boom };
}

function fakeHeadDocument() {
  const links = [];
  return {
    links,
    head: { appendChild(el) { links.push(el); } },
    createElement(tag) { return { tag, id: '', rel: '', href: '' }; },
    getElementById(id) { return links.find((l) => l.id === id) || null; }
  };
}

function fakeVisibilityDocument(hidden) {
  const listeners = [];
  return {
    hidden,
    listeners,
    addEventListener(name, fn) { if (name === 'visibilitychange') listeners.push(fn); },
    removeEventListener(name, fn) {
      const i = listeners.indexOf(fn);
      if (name === 'visibilitychange' && i >= 0) listeners.splice(i, 1);
    },
    setHidden(v) { this.hidden = v; listeners.slice().forEach((fn) => fn()); }
  };
}

const jsonRes = (body, headers) => ({ status: 200, body, headers });
const SUBS_OK = (subs) => jsonRes({ ok: true, subs, gifted: 3, canceled: 1, live: true, viewers: 12, startMs: null, title: 'x' });
const HEALTH = (features) => jsonRes({ ok: true, version: '2.3.0', clients: 0, features: Object.assign({ chat: false, channel: true, subscribers: false }, features) });

async function testSettingsV23() {
  section('v2.3.0 settings: new keys, clock, asBool, kanal');
  const { K } = loadCore();

  await check('schemaKeys() includes every new public key', () => {
    ['geriSayimSaat', 'sohbetKomutGizle', 'sohbetGizliKullanicilar', 'sohbetSilinmeSn', 'hataNotu', 'hedefKutlama']
      .forEach((k) => ok(K.schemaKeys().includes(k), 'missing ' + k));
    ok(!K.schemaKeys().includes('relayAdresi'), 'relayAdresi must stay local-only');
  });

  await check('new keys: defaults', () => {
    eqFields(K.normalize({}), {
      geriSayimSaat: '', sohbetKomutGizle: false, sohbetGizliKullanicilar: '', sohbetSilinmeSn: 0, hataNotu: true, hedefKutlama: true
    }, '');
  });

  await check('geriSayimSaat (clock): HH:MM is zero-padded; invalid values give ""', () => {
    eq(K.normalize({ geriSayimSaat: '9:05' }).geriSayimSaat, '09:05', '9:05');
    eq(K.normalize({ geriSayimSaat: '21:30' }).geriSayimSaat, '21:30', '21:30');
    eq(K.normalize({ geriSayimSaat: ' 00:00 ' }).geriSayimSaat, '00:00', 'padded input');
    eq(K.normalize({ geriSayimSaat: '23:59' }).geriSayimSaat, '23:59', '23:59');
    ['24:00', '12:60', '1:5', 'abc', '', '12', '12:30:00', '-1:00', 12.5, null, undefined].forEach((v) =>
      eq(K.normalize({ geriSayimSaat: v }).geriSayimSaat, '', 'value ' + JSON.stringify(v)));
  });

  await check('asBool: case-insensitive true/false, yes/no, on/off, 1/0; junk falls back to the default', () => {
    ['true', 'TRUE', 'True', 'yes', 'YES', 'on', 'On', ' on ', '1', 1, true].forEach((v) =>
      eq(K.normalize({ yuzdeGoster: v }).yuzdeGoster, true, 'true for ' + JSON.stringify(v)));
    ['false', 'FALSE', 'no', 'No', 'off', 'OFF', ' off ', '0', 0, false].forEach((v) =>
      eq(K.normalize({ oturumFarkiGoster: v }).oturumFarkiGoster, false, 'false for ' + JSON.stringify(v)));
    eq(K.normalize({ yuzdeGoster: 'maybe' }).yuzdeGoster, false, 'junk falls back (default false)');
    eq(K.normalize({ oturumFarkiGoster: 'maybe' }).oturumFarkiGoster, true, 'junk falls back (default true)');
    eq(K.normalize({ hataNotu: '' }).hataNotu, true, 'empty falls back');
    eq(K.normalize({ hataNotu: 2 }).hataNotu, true, 'number 2 falls back');
  });

  await check('sohbetSilinmeSn is clamped to 0..600; sohbetGizliKullanicilar is cut to 300', () => {
    eq(K.normalize({ sohbetSilinmeSn: -5 }).sohbetSilinmeSn, 0, '-5');
    eq(K.normalize({ sohbetSilinmeSn: 9999 }).sohbetSilinmeSn, 600, '9999');
    eq(K.normalize({ sohbetSilinmeSn: '45' }).sohbetSilinmeSn, 45, '"45"');
    eq(K.normalize({ sohbetSilinmeSn: 'x' }).sohbetSilinmeSn, 0, 'junk');
    eq(K.normalize({ sohbetGizliKullanicilar: ' Bot1, Bot2 ' }).sohbetGizliKullanicilar, 'Bot1, Bot2', 'trimmed');
    eq(K.normalize({ sohbetGizliKullanicilar: 'x'.repeat(400) }).sohbetGizliKullanicilar.length, 300, 'length');
  });

  await check('new keys can be overridden from the URL', () => {
    const { K: K2 } = loadCore({
      search: '?geriSayimSaat=8:15&sohbetKomutGizle=yes&sohbetGizliKullanicilar=Bot1%2CBot2&sohbetSilinmeSn=30&hataNotu=off&hedefKutlama=0'
    });
    eqFields(K2.readSettings(), {
      geriSayimSaat: '08:15', sohbetKomutGizle: true, sohbetGizliKullanicilar: 'Bot1,Bot2', sohbetSilinmeSn: 30,
      hataNotu: false, hedefKutlama: false
    }, '');
  });

  await check('kanal: kick.com links, @ prefix and extra path are stripped; result is lowercase and <= 40', () => {
    const cases = {
      'https://kick.com/ExAmple': 'example',
      'https://kick.com/example/videos?x=1': 'example',
      'https://www.kick.com/Example': 'example',
      'kick.com/Example': 'example',
      'KICK.COM/Example/': 'example',
      '@Example': 'example',
      '  @Example  ': 'example',
      'https://kick.com/@Example': 'example',
      'example/extra': 'example',
      'example?ref=1': 'example',
      '': '',
      '   ': ''
    };
    Object.keys(cases).forEach((v) => eq(K.normalize({ kanal: v }).kanal, cases[v], 'kanal ' + JSON.stringify(v)));
    eq(K.normalize({ kanal: 'a'.repeat(60) }).kanal, 'a'.repeat(40), 'cut to 40');
    eq(K.normalize({ kanal: 'https://kick.com/' + 'B'.repeat(60) }).kanal, 'b'.repeat(40), 'link then cut to 40');
    eq(K.normalize({ kanal: 123 }).kanal, '', 'number');
  });

  await check('kanal from the URL parameter is cleaned the same way', () => {
    const { K: K2 } = loadCore({ search: '?kanal=https%3A%2F%2Fkick.com%2FMixed' });
    eq(K2.readSettings().kanal, 'mixed', 'kanal');
  });

  await check('relayAdresi: never from the URL; accepted from AYARLAR.js and AYARLAR.local.js', () => {
    eq(loadCore({ search: '?relayAdresi=http://127.0.0.1:9999' }).K.readSettings().relayAdresi, RELAY, 'URL ignored');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://127.0.0.1:9000/' } }).K.readSettings().relayAdresi, 'http://127.0.0.1:9000', 'AYARLAR.js');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://127.0.0.1:9000' }, yerel: { relayAdresi: 'http://localhost:9100' } })
      .K.readSettings().relayAdresi, 'http://localhost:9100', 'local wins');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://evil.example.com:8790' } }).K.readSettings().relayAdresi, RELAY, 'plain http to a non-loopback host is rejected');
  });
}

async function testHelpersV23() {
  section('v2.3.0 helpers: fmt cache, setFill, isDebug, loadFont, text, note, debug');

  await check('fmt() builds one Intl.NumberFormat per locale and stays correct when the locale switches', () => {
    const { K, ctx } = loadCore();
    const Real = vm.runInContext('Intl', ctx);
    let made = 0;
    ctx.Intl = { NumberFormat: function (locale, o) { made += 1; return new Real.NumberFormat(locale, o); } };
    ctx.document = fakeDocument('');
    eq(K.fmt(1234567), '1,234,567', 'en first');
    eq(K.fmt(1000), '1,000', 'en second');
    eq(K.fmt(12.6), '13', 'en rounds');
    eq(made, 1, 'formatters after 3 calls in one locale');
    K.applyLook(K.normalize({ dil: 'tr' }));
    eq(K.fmt(1234567), '1.234.567', 'tr');
    eq(K.fmt(2000), '2.000', 'tr second');
    eq(made, 2, 'formatters after switching to tr');
    K.applyLook(K.normalize({ dil: 'en' }));
    eq(K.fmt(1234567), '1,234,567', 'back to en');
    eq(made, 2, 'switching back reuses the cached formatter');
  });

  await check('fmt() still works when Intl is unavailable', () => {
    const { K, ctx } = loadCore();
    ctx.Intl = undefined;
    eq(K.fmt(1234567), '1,234,567', 'fallback');
  });

  await check('setFill() writes --fill as a 4-digit ratio, clamped to 0..1', () => {
    const { K } = loadCore();
    const el = fakeEl();
    K.setFill(el, 25);
    eq(el.style.vals['--fill'], '0.2500', '25');
    K.setFill(el, 100);
    eq(el.style.vals['--fill'], '1.0000', '100');
    K.setFill(el, 33.3333);
    eq(el.style.vals['--fill'], '0.3333', '33.3333');
    K.setFill(el, 0);
    eq(el.style.vals['--fill'], '0.0000', '0');
    K.setFill(el, 250);
    eq(el.style.vals['--fill'], '1.0000', 'over 100');
    K.setFill(el, -5);
    eq(el.style.vals['--fill'], '0.0000', 'negative');
    K.setFill(el, NaN);
    eq(el.style.vals['--fill'], '0.0000', 'NaN');
    K.setFill(null, 50);
  });

  await check('isDebug(): true only for debug=1 in the URL', () => {
    eq(loadCore({ search: '?debug=1' }).K.isDebug(), true, 'debug=1');
    eq(loadCore({ search: '?kanal=x&debug=1&stil=neon' }).K.isDebug(), true, 'among others');
    eq(loadCore({ search: '?debug=0' }).K.isDebug(), false, 'debug=0');
    eq(loadCore({ search: '?debug=10' }).K.isDebug(), false, 'debug=10');
    eq(loadCore({ search: '?xdebug=1' }).K.isDebug(), false, 'xdebug=1');
    eq(loadCore().K.isDebug(), false, 'no query');
  });

  await check('loadFont(): one Google Fonts link for the chosen family only', () => {
    const urls = {
      inter: 'family=Inter:wght@400;500;600;700;800;900',
      poppins: 'family=Poppins:wght@400;600;700;800',
      nunito: 'family=Nunito:wght@400;600;700;800;900',
      mono: 'family=Roboto+Mono:wght@400;700'
    };
    Object.keys(urls).forEach((font) => {
      const doc = fakeHeadDocument();
      const { K } = loadCore({ document: doc });
      K.loadFont(K.normalize({ yaziTipi: font }));
      eq(doc.links.length, 1, 'links for ' + font);
      const href = doc.links[0].href;
      ok(href.startsWith('https://fonts.googleapis.com/css2?'), 'host for ' + font);
      ok(href.includes(urls[font]), 'family for ' + font + ': ' + href);
      ok(href.endsWith('&display=swap'), 'display=swap for ' + font);
      eq((href.match(/family=/g) || []).length, 1, 'only one family for ' + font);
      eq(doc.links[0].rel, 'stylesheet', 'rel');
    });
  });

  await check('loadFont(): calling again reuses the same link; no document is not an error', () => {
    const doc = fakeHeadDocument();
    const { K } = loadCore({ document: doc });
    K.loadFont(K.normalize({ yaziTipi: 'inter' }));
    K.loadFont(K.normalize({ yaziTipi: 'mono' }));
    eq(doc.links.length, 1, 'still one link');
    ok(doc.links[0].href.includes('Roboto+Mono'), 'switched to mono');
    K.loadFont({});
    ok(doc.links[0].href.includes('Inter'), 'unknown font gives Inter');
    loadCore().K.loadFont(K.normalize({}));
  });

  await check('text(): all keys in tr, en and both; each language stays under 40 characters', () => {
    const keys = ['hint', 'auth', 'rate', 'error', 'noData', 'unreachable', 'stale', 'relayDown'];
    const { K } = loadCore();
    const tr = K.text(K.normalize({ dil: 'tr' }));
    const en = K.text(K.normalize({ dil: 'en' }));
    const both = K.text(K.normalize({ dil: 'both' }));
    eq(Object.keys(tr).sort(), keys.slice().sort(), 'tr keys');
    eq(Object.keys(en).sort(), keys.slice().sort(), 'en keys');
    eq(Object.keys(both).sort(), keys.slice().sort(), 'both keys');
    keys.forEach((k) => {
      ok(typeof tr[k] === 'string' && tr[k].trim() && tr[k].length < 40, 'tr.' + k + ' = ' + tr[k]);
      ok(typeof en[k] === 'string' && en[k].trim() && en[k].length < 40, 'en.' + k + ' = ' + en[k]);
      ok(tr[k] !== en[k], 'tr and en differ for ' + k);
      eq(both[k], tr[k] + ' / ' + en[k], 'both.' + k);
    });
    ok(en.hint.includes('AYARLAR.js'), 'hint mentions AYARLAR.js');
    ok(/unreachable/i.test(en.unreachable), 'unreachable text');
    ok(/out of date/i.test(en.stale), 'stale text');
  });

  await check('note(): sets text and toggles is-hidden', () => {
    const { K } = loadCore();
    const S = K.normalize({});
    const el = fakeEl();
    K.note(el, S, 'Kick unreachable');
    eq(el.textContent, 'Kick unreachable', 'text');
    ok(!el.classes.has('is-hidden'), 'visible with text');
    K.note(el, S, '');
    eq(el.textContent, '', 'cleared');
    ok(el.classes.has('is-hidden'), 'hidden when empty');
    K.note(null, S, 'x');
  });

  await check('note(): hidden when hataNotu=false, unless ?debug=1', () => {
    const quiet = { hataNotu: false };
    const el = fakeEl();
    loadCore().K.note(el, quiet, 'Kick unreachable');
    eq(el.textContent, 'Kick unreachable', 'text is still set');
    ok(el.classes.has('is-hidden'), 'hidden with hataNotu=false');
    const el2 = fakeEl();
    loadCore({ search: '?debug=1' }).K.note(el2, quiet, 'Kick unreachable');
    ok(!el2.classes.has('is-hidden'), 'visible in debug mode');
  });

  await check('debug(): renders one fixed box with key: value lines, merges calls, null removes a key', () => {
    const appended = [];
    const doc = {
      body: { appendChild: (el) => appended.push(el) },
      createElement: () => ({ className: '', textContent: '', style: {} })
    };
    const { K } = loadCore({ search: '?debug=1', document: doc });
    K.debug({ src: 'relay-v2', status: 200 });
    eq(appended.length, 1, 'one element');
    eq(appended[0].className, 'ko-debug', 'class');
    eq(appended[0].textContent, 'src: relay-v2\nstatus: 200', 'first text');
    K.debug({ status: 429, next: '12s' });
    eq(appended.length, 1, 'still one element');
    eq(appended[0].textContent, 'src: relay-v2\nstatus: 429\nnext: 12s', 'merged text');
    K.debug({ src: null });
    eq(appended[0].textContent, 'status: 429\nnext: 12s', 'key removed');
  });

  await check('debug(): does nothing when not in debug mode', () => {
    let created = 0;
    const doc = { body: { appendChild() { created += 1; } }, createElement() { created += 1; return {}; } };
    const { K } = loadCore({ search: '?stil=neon', document: doc });
    K.debug({ src: 'x' });
    eq(created, 0, 'DOM touched');
    loadCore({ search: '?debug=1' }).K.debug({ src: 'x' });
  });

  await check('getJson(): exposes Retry-After (seconds) on failures and X-Kick-Source on success', async () => {
    const net = fakeNet((c, n) => (n === 1
      ? { status: 429, body: {}, headers: { 'Retry-After': '30' } }
      : n === 2 ? { status: 429, body: {}, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }
        : { status: 200, body: { a: 1 }, headers: { 'X-Kick-Source': 'V1' } }));
    const { K } = loadCore({ fetch: net.fetch });
    const r1 = await K.getJson('https://example.test/x');
    eq([r1.ok, r1.status, r1.retryAfterMs], [false, 429, 30000], 'seconds to ms');
    const r2 = await K.getJson('https://example.test/x');
    eq(r2.retryAfterMs, undefined, 'HTTP-date is ignored');
    const r3 = await K.getJson('https://example.test/x');
    eq([r3.ok, r3.source], [true, 'v1'], 'source');
  });
}

async function testCreateGoalBar() {
  section('createGoalBar()');

  function make(over = {}, goal = 1000, withChips = true) {
    const clock = fakeClock();
    const { K, env } = loadCore(clock.opts());
    const S = K.normalize(Object.assign({ animasyon: 'off', yuzdeGoster: true, oturumFarkiGoster: true }, over));
    const els = { bar: fakeEl(), fill: fakeEl(), val: fakeEl(), pct: withChips ? fakeEl() : null, delta: withChips ? fakeEl() : null };
    return { K, env, S, els, clock, gb: K.createGoalBar(els, goal, S) };
  }

  await check('set(): fill variable, value text, no bump or milestone on the first value', () => {
    const { gb, els } = make();
    gb.set(250, 0);
    eq(els.fill.style.vals['--fill'], '0.2500', '--fill');
    eq(els.val.textContent, '250', 'value');
    ok(!els.bar.classes.has('ko-bump'), 'no bump on first value');
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone on first value');
  });

  await check('set(): bump only on increase', () => {
    const { gb, els } = make();
    gb.set(100, 0);
    gb.set(150, 0);
    ok(els.bar.classes.has('ko-bump'), 'bump on increase');
    els.bar.classes.delete('ko-bump');
    gb.set(150, 0);
    ok(!els.bar.classes.has('ko-bump'), 'no bump when unchanged');
    gb.set(120, 0);
    ok(!els.bar.classes.has('ko-bump'), 'no bump on decrease');
    eq(els.val.textContent, '120', 'value follows');
  });

  await check('set(): milestone class on crossing 25/50/75 %, removed after 1.2 s', async () => {
    const { gb, els, clock } = make();
    gb.set(100, 0);
    gb.set(240, 0);
    ok(!els.bar.classes.has('ko-milestone'), '24 % is no milestone');
    gb.set(260, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 25');
    await clock.advance(1199);
    ok(els.bar.classes.has('ko-milestone'), 'still there before 1.2 s');
    await clock.advance(1);
    ok(!els.bar.classes.has('ko-milestone'), 'removed at 1.2 s');
    gb.set(300, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone inside a band');
    gb.set(510, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 50');
    await clock.advance(1200);
    gb.set(760, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 75');
    await clock.advance(1200);
    gb.set(780, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone while staying above 75 %');
  });

  await check('set(): going down across a line and back up counts as crossing again', async () => {
    const { gb, els, clock } = make();
    gb.set(800, 0);
    gb.set(700, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'down: no milestone');
    gb.set(760, 0);
    ok(els.bar.classes.has('ko-milestone'), 'up through 75 again');
    await clock.advance(1200);
  });

  await check('set(): is-goal toggles with total >= goal', () => {
    const { gb, els } = make();
    gb.set(900, 0);
    ok(!els.bar.classes.has('is-goal'), 'below goal');
    gb.set(1000, 0);
    ok(els.bar.classes.has('is-goal'), 'at goal');
    gb.set(1200, 0);
    ok(els.bar.classes.has('is-goal'), 'above goal');
    eq(els.fill.style.vals['--fill'], '1.0000', 'fill capped at 1');
    gb.set(900, 0);
    ok(!els.bar.classes.has('is-goal'), 'goal state removed when total drops');
  });

  await check('set(): hedefKutlama=false gives no milestone and no is-goal', () => {
    const { gb, els } = make({ hedefKutlama: false });
    gb.set(100, 0);
    gb.set(600, 0);
    gb.set(1000, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone');
    ok(!els.bar.classes.has('is-goal'), 'no is-goal');
    ok(els.bar.classes.has('ko-bump'), 'bump is unrelated and still works');
  });

  await check('set(): goal 0 never counts as reached', () => {
    const { gb, els } = make({}, 0);
    gb.set(50, 0);
    ok(!els.bar.classes.has('is-goal'), 'is-goal');
    eq(els.fill.style.vals['--fill'], '0.0000', 'fill');
  });

  await check('set(): percent chip follows yuzdeGoster', () => {
    const a = make({ yuzdeGoster: true });
    a.gb.set(256, 0);
    eq([a.els.pct.hidden, a.els.pct.textContent], [false, '26%'], 'shown');
    const b = make({ yuzdeGoster: false });
    b.gb.set(256, 0);
    eq(b.els.pct.hidden, true, 'hidden');
  });

  await check('set(): delta chip shows +N / -N, is-neg for negatives, hidden for 0 or oturumFarkiGoster=false', () => {
    const a = make();
    a.gb.set(100, 3);
    eq([a.els.delta.hidden, a.els.delta.textContent], [false, '+3'], 'positive');
    ok(!a.els.delta.classes.has('is-neg'), 'not negative');
    a.gb.set(100, -2);
    eq([a.els.delta.hidden, a.els.delta.textContent], [false, '-2'], 'negative');
    ok(a.els.delta.classes.has('is-neg'), 'is-neg');
    a.gb.set(100, 1234);
    eq(a.els.delta.textContent, '+1,234', 'formatted');
    ok(!a.els.delta.classes.has('is-neg'), 'is-neg removed');
    a.gb.set(100, 0);
    eq(a.els.delta.hidden, true, 'zero hides');
    const b = make({ oturumFarkiGoster: false });
    b.gb.set(100, 5);
    eq(b.els.delta.hidden, true, 'setting off hides');
  });

  await check('set(): pct and delta elements may be null', () => {
    const { gb, els } = make({}, 1000, false);
    gb.set(500, 4);
    gb.set(600, 4);
    eq(els.val.textContent, '600', 'value');
  });

  await check('set(): animasyon=normal tweens the value over frames; off jumps', () => {
    const { gb, els, env } = make({ animasyon: 'normal' });
    gb.set(100, 0);
    ok(els.val.textContent !== '100', 'not there yet');
    env.now = 1300;
    env.frames.shift()(1300);
    eq(els.val.textContent, '100', 'after the tween');
    const off = make({ animasyon: 'off' });
    off.gb.set(100, 0);
    eq(off.els.val.textContent, '100', 'immediate');
    eq(off.env.frames.length, 0, 'no frames requested');
  });
}

async function testPoller() {
  section('poller()');

  function setup(fn, over = {}, docOpts = {}) {
    const clock = fakeClock();
    const doc = docOpts.document;
    const { K, ctx } = loadCore(Object.assign(clock.opts(), doc ? { document: doc } : {}));
    setRandom(ctx, 0.5);
    const p = K.poller(fn, Object.assign({ intervalMs: 1000, jitter: 0 }, over));
    return { K, ctx, clock, p };
  }
  const delaysAfterStart = (clock) => clock.log.slice();

  await check('start() runs at once, then every intervalMs after a success', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    await clock.advance(0);
    eq(n, 1, 'immediate run');
    await clock.advance(999);
    eq(n, 1, 'before the interval');
    await clock.advance(1);
    eq(n, 2, 'after 1000 ms');
    await clock.advance(2000);
    eq(n, 4, 'two more intervals');
    p.stop();
  });

  await check('start() twice does not double the polling', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    p.start();
    await clock.advance(3000);
    eq(n, 4, 'runs at 0, 1000, 2000, 3000');
    p.stop();
  });

  await check('jitter keeps the next delay within +/- the jitter fraction', async () => {
    const lows = [], highs = [];
    for (const [rnd, bucket] of [[0, lows], [1, highs]]) {
      const { clock, ctx, p } = setup(async () => ({ ok: true }), { jitter: 0.1 });
      setRandom(ctx, rnd);
      p.start();
      await clock.advance(0);
      bucket.push(clock.log[0]);
      p.stop();
    }
    eq(lows[0], 900, 'low end');
    eq(highs[0], 1100, 'high end');
  });

  await check('failures back off: interval x 2^n, capped at maxBackoffMs', async () => {
    const { clock, p } = setup(async () => ({ ok: false }), { maxBackoffMs: 5000 });
    p.start();
    await clock.advance(0);
    for (let i = 0; i < 5; i += 1) await clock.advance(clock.timers[0].at - clock.t);
    eq(delaysAfterStart(clock).slice(0, 5), [2000, 4000, 5000, 5000, 5000], 'delays');
    p.stop();
  });

  await check('a success after failures resets the backoff', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: n === 3 || n >= 4 }; });
    p.start();
    await clock.advance(0);
    await clock.advance(2000);
    await clock.advance(4000);
    await clock.advance(1000);
    eq(delaysAfterStart(clock).slice(0, 4), [2000, 4000, 1000, 1000], 'delays');
    p.stop();
  });

  await check('a larger retryAfterMs wins over the backoff; a smaller one is ignored', async () => {
    let n = 0;
    const { clock, p } = setup(async () => {
      n += 1;
      return n === 1 ? { ok: false, retryAfterMs: 20000 } : { ok: false, retryAfterMs: 10 };
    }, { maxBackoffMs: 5000 });
    p.start();
    await clock.advance(0);
    eq(clock.log[0], 20000, 'retryAfterMs beyond the cap is honoured');
    await clock.advance(20000);
    eq(clock.log[1], 4000, 'second failure: small retryAfterMs ignored');
    p.stop();
  });

  await check('a throwing fn counts as a failure and polling continues', async () => {
    let n = 0;
    const { clock, p } = setup(() => { n += 1; if (n === 1) throw new Error('boom'); return Promise.resolve({ ok: true }); });
    p.start();
    await clock.advance(0);
    eq(clock.log[0], 2000, 'backoff after a throw');
    await clock.advance(2000);
    eq(n, 2, 'ran again');
    p.stop();
  });

  await check('busy guard: now() while a run is in flight does not start another', async () => {
    let n = 0, release;
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); });
    p.start();
    await clock.advance(0);
    eq(n, 1, 'first run started');
    p.now();
    p.now();
    await clock.advance(5000);
    eq(n, 1, 'no overlap while pending');
    release();
    await clock.advance(0);
    eq(clock.timers.length, 1, 'next run armed after it finished');
    await clock.advance(1000);
    eq(n, 2, 'second run');
    p.stop();
  });

  await check('now() runs immediately and re-arms the timer from the result', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    await clock.advance(0);
    await clock.advance(400);
    await p.now();
    eq(n, 2, 'ran now');
    await clock.advance(999);
    eq(n, 2, 'timer restarted from now()');
    await clock.advance(1);
    eq(n, 3, 'next run one interval after now()');
    p.stop();
  });

  await check('stop() clears the timer and later results do not re-arm', async () => {
    let n = 0, release;
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); });
    p.start();
    await clock.advance(0);
    p.stop();
    release();
    await clock.advance(10000);
    eq(n, 1, 'no more runs');
    eq(clock.timers.length, 0, 'no pending timers');
    await p.now();
    eq(n, 1, 'now() after stop does nothing');

    let m = 0;
    const b = setup(async () => { m += 1; return { ok: true }; });
    b.p.start();
    await b.clock.advance(0);
    eq(b.clock.timers.length, 1, 'timer armed');
    b.p.stop();
    eq(b.clock.timers.length, 0, 'stop clears it');
    await b.clock.advance(5000);
    eq(m, 1, 'no run after stop');
  });

  await check('hidden page: no run is scheduled; becoming visible runs at once', async () => {
    let n = 0;
    const doc = fakeVisibilityDocument(true);
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; }, {}, { document: doc });
    p.start();
    await clock.advance(5000);
    eq(n, 0, 'no run while hidden');
    eq(doc.listeners.length, 1, 'visibility listener added');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 1, 'ran on becoming visible');
    await clock.advance(1000);
    eq(n, 2, 'regular polling resumed');
    doc.hidden = true;
    await clock.advance(1000);
    eq(n, 2, 'a due timer does not poll a hidden page');
    await clock.advance(5000);
    eq(n, 2, 'still paused');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 3, 'resumed with an immediate run');
    p.stop();
    eq(doc.listeners.length, 0, 'visibility listener removed on stop');
  });

  await check('a run that finishes while the page is hidden schedules nothing until it is visible again', async () => {
    let n = 0, release;
    const doc = fakeVisibilityDocument(false);
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); }, {}, { document: doc });
    p.start();
    await clock.advance(0);
    doc.hidden = true;
    release();
    await clock.advance(5000);
    eq(clock.timers.length, 0, 'nothing armed');
    eq(n, 1, 'no new run');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 2, 'run on visible');
    p.stop();
  });
}

async function testRelayInfoAndChannel() {
  section('relayInfo() and kick.channel() (relay first, direct fallback)');
  const S = (over) => Object.assign({ relayAdresi: RELAY }, over);

  await check('relayInfo: GET /health, returns the health object, memoized for later calls', async () => {
    const net = fakeNet(() => HEALTH({ channel: true }));
    const { K } = loadCore({ fetch: net.fetch });
    const a = await K.relayInfo(S());
    const b = await K.relayInfo(S());
    eq(a.version, '2.3.0', 'version');
    eq(a.features.channel, true, 'features');
    eq(net.calls.length, 1, 'requests');
    eq(net.calls[0].url, RELAY + '/health', 'url');
    ok(net.calls[0].signal, 'request has a timeout signal');
    eq(b, a, 'same result');
  });

  await check('relayInfo: concurrent calls share one request', async () => {
    const net = fakeNet(() => HEALTH({}));
    const { K } = loadCore({ fetch: net.fetch });
    await Promise.all([K.relayInfo(S()), K.relayInfo(S()), K.relayInfo(S())]);
    eq(net.calls.length, 1, 'requests');
  });

  await check('relayInfo: uses the configured relayAdresi; none configured gives null without a request', async () => {
    const net = fakeNet(() => HEALTH({}));
    const { K } = loadCore({ fetch: net.fetch });
    await K.relayInfo({ relayAdresi: 'http://127.0.0.1:9000' });
    eq(net.calls[0].url, 'http://127.0.0.1:9000/health', 'url');
    eq(await K.relayInfo({}), null, 'no address');
    eq(await K.relayInfo(null), null, 'no settings');
    eq(net.calls.length, 1, 'requests');
  });

  await check('relayInfo: a failed probe gives null and is retried at most every 5 minutes', async () => {
    const clock = fakeClock();
    let up = false;
    const net = fakeNet(() => { if (!up) throw new TypeError('refused'); return HEALTH({ channel: true }); });
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    eq(await K.relayInfo(S()), null, 'first');
    eq(net.calls.length, 1, 'requests after first');
    up = true;
    await clock.advance(4 * 60 * 1000);
    eq(await K.relayInfo(S()), null, 'within 5 min');
    eq(net.calls.length, 1, 'no new request within 5 min');
    await clock.advance(61 * 1000);
    const info = await K.relayInfo(S());
    eq(info && info.features.channel, true, 'after 5 min the probe is retried');
    eq(net.calls.length, 2, 'requests after retry');
    await K.relayInfo(S());
    eq(net.calls.length, 2, 'success is memoized');
  });

  await check('relayInfo: a non-200 or a body that is not JSON gives null', async () => {
    const K1 = loadCore({ fetch: fakeNet(() => ({ status: 500, body: {} })).fetch }).K;
    eq(await K1.relayInfo(S()), null, '500');
    const K2 = loadCore({ fetch: fakeNet(() => ({ status: 200, body: 'text' })).fetch }).K;
    eq(await K2.relayInfo(S()), null, 'text body');
  });

  await check('relayInfo: gives up after 1500 ms', async () => {
    const clock = fakeClock();
    const net = fakeNet((c) => new Promise((_, reject) => {
      c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    let settled = false;
    const pr = K.relayInfo(S()).then((v) => { settled = true; return v; });
    await clock.advance(1499);
    eq(settled, false, 'still waiting at 1499 ms');
    await clock.advance(1);
    eq(await pr, null, 'null at 1500 ms');
  });

  // kick.channel with the relay
  const v2Body = () => fixture('kick-v2-channel-offline.json');
  function channelNet({ health = () => HEALTH({ channel: true }), relayChannel, direct }) {
    return fakeNet((c) => {
      if (c.url === RELAY + '/health') return health();
      if (c.url.startsWith(RELAY + '/channel')) return relayChannel(c);
      return direct(c);
    });
  }

  await check('kick.channel: relay v2 is used first (src relay-v2) and no direct request is made', async () => {
    const net = channelNet({
      relayChannel: () => ({ status: 200, body: v2Body(), headers: { 'X-Kick-Source': 'v2' } }),
      direct: () => { throw new Error('direct request'); }
    });
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
    eqFields(r, { ok: true, src: 'relay-v2', status: 200 }, '');
    eq(r.data.followers_count, v2Body().followers_count, 'raw data passed through');
    eq(net.calls.map((c) => c.url), [RELAY + '/health', RELAY + '/channel?slug=example-channel'], 'requests');
  });

  await check('kick.channel: X-Kick-Source v1 gives relay-v1; a missing header gives relay-v2', async () => {
    const mk = (headers) => channelNet({
      relayChannel: () => ({ status: 200, body: fixture('kick-v1-channel.json'), headers }),
      direct: () => { throw new Error('direct request'); }
    });
    eq((await loadCore({ fetch: mk({ 'X-Kick-Source': 'v1' }).fetch }).K.kick.channel('example-channel', S())).src, 'relay-v1', 'v1');
    eq((await loadCore({ fetch: mk(undefined).fetch }).K.kick.channel('example-channel', S())).src, 'relay-v2', 'no header');
  });

  await check('kick.channel: a relay failure (502, network) falls back to the direct v2 request', async () => {
    for (const relayChannel of [() => ({ status: 502, body: { ok: false, error: 'upstream' } }), () => { throw new TypeError('reset'); }]) {
      const net = channelNet({ relayChannel, direct: () => ({ status: 200, body: v2Body() }) });
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
      eqFields(r, { ok: true, src: 'v2' }, '');
      eq(net.calls[net.calls.length - 1].url, 'https://kick.com/api/v2/channels/example-channel', 'direct url');
    }
  });

  await check('kick.channel: a relay 429 returns at once with retryAfterMs and does not hit Kick directly', async () => {
    const net = channelNet({
      relayChannel: () => ({ status: 429, body: { ok: false }, headers: { 'Retry-After': '45' } }),
      direct: () => { throw new Error('direct request'); }
    });
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
    eqFields(r, { ok: false, status: 429, retryAfterMs: 45000 }, '');
    eq(kickCalls(net).filter((c) => !c.url.startsWith(RELAY)).length, 0, 'direct requests');
    const net2 = channelNet({ relayChannel: () => ({ status: 429, body: {} }), direct: () => { throw new Error('direct request'); } });
    eq((await loadCore({ fetch: net2.fetch }).K.kick.channel('example-channel', S())).retryAfterMs, 60000, 'default 60 s');
  });

  await check('kick.channel: relay without the channel feature, or relay down, goes straight to direct', async () => {
    const off = channelNet({
      health: () => HEALTH({ channel: false }),
      relayChannel: () => { throw new Error('relay channel request'); },
      direct: () => ({ status: 200, body: v2Body() })
    });
    eq((await loadCore({ fetch: off.fetch }).K.kick.channel('example-channel', S())).src, 'v2', 'feature off');
    const down = channelNet({
      health: () => { throw new TypeError('refused'); },
      relayChannel: () => { throw new Error('relay channel request'); },
      direct: () => ({ status: 200, body: v2Body() })
    });
    eq((await loadCore({ fetch: down.fetch }).K.kick.channel('example-channel', S())).src, 'v2', 'relay down');
  });

  await check('kick.channel: without settings the relay is never contacted', async () => {
    const net = fakeNet(() => ({ status: 200, body: v2Body() }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq(r.src, 'v2', 'src');
    ok(net.calls.every((c) => c.url.startsWith('https://kick.com/')), 'only kick.com requests');
  });

  await check('kick.channel direct: 403 and 429 stop at once (no v1) and carry retryAfterMs', async () => {
    for (const [status, headers, want] of [[403, undefined, 60000], [429, undefined, 60000], [429, { 'Retry-After': '7' }, 7000], [403, { 'Retry-After': '120' }, 120000]]) {
      const net = fakeNet(() => ({ status, body: {}, headers }));
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
      eqFields(r, { ok: false, status, retryAfterMs: want, src: 'v2' }, status + ' ');
      eq(net.calls.length, 1, 'requests for ' + status);
    }
  });

  await check('kick.channel direct: 404, 5xx, network error and timeout fall back to v1', async () => {
    const failures = [
      ['404', () => ({ status: 404, body: {} })],
      ['500', () => ({ status: 500, body: {} })],
      ['503', () => ({ status: 503, body: {} })],
      ['network', () => { throw new TypeError('fetch failed'); }]
    ];
    for (const [name, v2fail] of failures) {
      const net = fakeNet((c) => (c.url.includes('/api/v2/') ? v2fail() : { status: 200, body: fixture('kick-v1-channel.json') }));
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
      eqFields(r, { ok: true, src: 'v1' }, name + ' ');
      eq(net.calls.length, 2, 'requests for ' + name);
    }
    const clock = fakeClock();
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? new Promise((_, reject) => { c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); })
      : { status: 200, body: fixture('kick-v1-channel.json') }));
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    const pr = K.kick.channel('example-channel');
    await clock.advance(10000);
    eqFields(await pr, { ok: true, src: 'v1' }, 'timeout ');
  });

  await check('kick.channel direct: v1 answering 429 after a v2 5xx also carries retryAfterMs', async () => {
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? { status: 500, body: {} }
      : { status: 429, body: {}, headers: { 'Retry-After': '9' } }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eqFields(r, { ok: false, status: 429, retryAfterMs: 9000 }, '');
  });
}

async function testSubscriberRelayAndBaseline() {
  section('Subscriber source: relay mode and persisted baseline');
  const GOOD = (features) => () => HEALTH(Object.assign({ subscribers: true }, features));

  await check('relay mode: mode switches on the first poll; values and delta come from /subscribers', async () => {
    const net = officialFake({
      relay: (c, n) => {
        if (c.url === RELAY + '/health') return GOOD()();
        return SUBS_OK(c.url.includes('slug=example-channel') ? (n === 2 ? 42 : 45) : 0);
      }
    });
    const { src } = subscriberSetup(net, { yerel: {} });
    eq(src.mode, 'manual', 'mode before the first poll');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 42, delta: 0 }, 'first ');
    eq(src.mode, 'relay', 'src.mode after the poll');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 45, delta: 3 }, 'second ');
    eq(relayCalls(net).map((c) => c.url), [RELAY + '/health', RELAY + '/subscribers?slug=example-channel', RELAY + '/subscribers?slug=example-channel'], 'relay requests');
    eq(kickCalls(net).length, 0, 'no direct Kick or token requests');
  });

  await check('relay mode wins over credentials in the page when the relay offers subscribers', async () => {
    const net = officialFake({ relay: (c) => (c.url.endsWith('/health') ? GOOD()() : SUBS_OK(77)) });
    const { src } = subscriberSetup(net);
    eq(src.mode, 'token', 'initial guess with credentials');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 77 }, '');
    eq(tokenCalls(net).length, 0, 'token requests');
  });

  await check('relay mode: HTTP errors map to statuses; the last total is kept; rate carries retryAfterMs', async () => {
    const cases = [
      [503, undefined, 'no-credentials'], [401, undefined, 'auth'], [429, undefined, 'rate'],
      [429, { 'Retry-After': '12' }, 'rate'], [502, undefined, 'error'], [500, undefined, 'error']
    ];
    for (const [status, headers, want] of cases) {
      let n = 0;
      const net = officialFake({
        relay: (c) => {
          if (c.url.endsWith('/health')) return GOOD()();
          n += 1;
          return n === 1 ? SUBS_OK(42) : { status, body: { ok: false }, headers };
        }
      });
      const { src } = subscriberSetup(net, { yerel: {} });
      await src.poll();
      const r = await src.poll();
      eqFields(r, { status: want, total: 42, delta: 0 }, status + ' ');
      if (want === 'rate') eq(r.retryAfterMs, headers ? 12000 : 60000, 'retryAfterMs for ' + status);
    }
  });

  await check('relay mode: subs null gives no-data; a thrown network error gives error (no credentials to fall back to)', async () => {
    const a = subscriberSetup(officialFake({ relay: (c) => (c.url.endsWith('/health') ? GOOD()() : SUBS_OK(null)) }), { yerel: {} });
    eq((await a.src.poll()).status, 'no-data', 'no-data');
    let calls = 0;
    const b = subscriberSetup(officialFake({
      relay: (c) => { if (c.url.endsWith('/health')) return GOOD()(); calls += 1; throw new TypeError('reset'); }
    }), { yerel: {} });
    eq((await b.src.poll()).status, 'error', 'error');
    eq(calls, 1, 'one attempt');
  });

  await check('relay mode with page credentials: an unreachable relay on a poll falls back to the token path', async () => {
    const net = officialFake({
      relay: (c) => { if (c.url.endsWith('/health')) return GOOD()(); throw new TypeError('reset'); },
      channel: liveSubs(50)
    });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 50 }, '');
    eq(tokenCalls(net).length, 1, 'token requests');
  });

  await check('relay without the subscribers feature: token mode with credentials, manual without', async () => {
    const relay = (c) => (c.url.endsWith('/health') ? HEALTH({ subscribers: false }) : { status: 404, body: {} });
    const withCreds = subscriberSetup(officialFake({ relay, channel: liveSubs(42) }));
    eqFields(await withCreds.src.poll(), { mode: 'token', status: 'ok', total: 42 }, 'token ');
    const without = subscriberSetup(officialFake({ relay }), { yerel: {}, ayarlar: { kanal: 'example-channel', aboneSayisi: 9 } });
    eqFields(await without.src.poll(), { mode: 'manual', status: 'manual', total: 9 }, 'manual ');
  });

  await check('the mode is re-evaluated: a relay that starts later is picked up after the 5-minute probe retry', async () => {
    const clock = fakeClock();
    let up = false;
    const net = officialFake({
      relay: (c) => {
        if (c.url.endsWith('/health')) return up ? GOOD()() : (() => { throw new TypeError('refused'); })();
        return SUBS_OK(60);
      }
    });
    const { K } = loadCore(Object.assign({ fetch: net.fetch, ayarlar: { kanal: 'example-channel', aboneSayisi: 5 }, yerel: {} }, clock.opts()));
    const src = K.createSubscriberSource(K.readSettings());
    eq((await src.poll()).mode, 'manual', 'relay down');
    up = true;
    await clock.advance(5 * 60 * 1000 + 1);
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 60 }, '');
    eq(src.mode, 'relay', 'src.mode');
  });

  await check('no kanal: no-channel in relay-less token mode and no request at all', async () => {
    const net = officialFake({ relay: () => GOOD()() });
    const { src } = subscriberSetup(net, { ayarlar: {} });
    eq((await src.poll()).status, 'no-channel', 'status');
    eq(net.calls.length, 0, 'requests');
  });

  await check('token mode: a 429 carries retryAfterMs (header seconds, else 60 s)', async () => {
    const withHeader = officialFake({ channel: () => ({ status: 429, body: {}, headers: { 'Retry-After': '33' } }) });
    eq((await subscriberSetup(withHeader).src.poll()).retryAfterMs, 33000, 'header');
    const noHeader = officialFake({ channel: () => ({ status: 429, body: {} }) });
    eq((await subscriberSetup(noHeader).src.poll()).retryAfterMs, 60000, 'default');
  });

  // Baseline persistence
  const KEY = 'ko:subBase:example-channel';
  function baselineSetup(clock, storage, counts, channel = 'example-channel') {
    const seq = Array.isArray(counts) ? counts : [counts];
    let i = 0;
    const net = officialFake({ channel: () => liveBody(seq[Math.min(i++, seq.length - 1)]) });
    const { K } = loadCore(Object.assign({
      fetch: net.fetch, localStorage: storage,
      ayarlar: { kanal: channel }, yerel: TEST_LOCAL
    }, clock.opts()));
    return K.createSubscriberSource(K.readSettings());
  }

  await check('baseline: the first value is stored as {base, at} under ko:subBase:<kanal>', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    const src = baselineSetup(clock, storage, [42, 45]);
    eqFields(await src.poll(), { total: 42, delta: 0 }, 'first ');
    eq(JSON.parse(storage.data[KEY]), { base: 42, at: clock.t }, 'stored');
    eqFields(await src.poll(), { total: 45, delta: 3 }, 'second ');
    eq(JSON.parse(storage.data[KEY]).base, 42, 'baseline not moved');
  });

  await check('baseline: a new page load within 12 h keeps the stored baseline', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42).poll();
    await clock.advance(11 * 60 * 60 * 1000);
    const r = await baselineSetup(clock, storage, 50).poll();
    eqFields(r, { total: 50, delta: 8 }, '');
  });

  await check('baseline: older than 12 h starts a new baseline and rewrites the storage', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42).poll();
    await clock.advance(12 * 60 * 60 * 1000 + 1);
    const r = await baselineSetup(clock, storage, 50).poll();
    eqFields(r, { total: 50, delta: 0 }, '');
    eq(JSON.parse(storage.data[KEY]), { base: 50, at: clock.t }, 'rewritten');
  });

  await check('baseline: each kanal has its own entry', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42, 'example-channel').poll();
    const r = await baselineSetup(clock, storage, 90, 'other').poll();
    eq(r.delta, 0, 'other channel starts at 0');
    eq(Object.keys(storage.data).sort(), ['ko:subBase:example-channel', 'ko:subBase:other'], 'keys');
  });

  await check('baseline: corrupt or invalid stored data is ignored', async () => {
    for (const bad of ['{not json', 'null', '[]', '{"base":"x","at":1}', JSON.stringify({ base: 42, at: 1.7e12 + 99999999 })]) {
      const clock = fakeClock();
      const storage = fakeStorage({ [KEY]: bad });
      const r = await baselineSetup(clock, storage, 50).poll();
      eq(r.delta, 0, 'delta for ' + bad);
      eq(JSON.parse(storage.data[KEY]).base, 50, 'replaced for ' + bad);
    }
  });

  await check('baseline: blocked storage never breaks polling', async () => {
    const clock = fakeClock();
    const src = baselineSetup(clock, throwingStorage(), [42, 45]);
    eqFields(await src.poll(), { status: 'ok', total: 42, delta: 0 }, 'first ');
    eqFields(await src.poll(), { status: 'ok', total: 45, delta: 3 }, 'second ');
    const noStorage = baselineSetup(clock, undefined, [42, 44]);
    await noStorage.poll();
    eq((await noStorage.poll()).delta, 2, 'no localStorage at all');
  });

  await check('baseline: manual mode never touches storage', async () => {
    const storage = fakeStorage();
    const net = fakeNet(() => { throw new TypeError('offline'); });
    const { K } = loadCore({ fetch: net.fetch, localStorage: storage, ayarlar: { kanal: 'example-channel', aboneSayisi: 17 } });
    const src = K.createSubscriberSource(K.readSettings());
    eqFields(await src.poll(), { status: 'manual', total: 17, delta: 0 }, '');
    eq(Object.keys(storage.data).length, 0, 'storage entries');
  });
}

async function testConnectRelayReconnect() {
  section('connectRelay(): reconnect with backoff');

  function setup(random) {
    const sources = [], statuses = [], messages = [];
    const clock = fakeClock();
    const { K, ctx } = loadCore(Object.assign({ EventSource: fakeEventSource(sources) }, clock.opts()));
    setRandom(ctx, random === undefined ? 0.5 : random);
    const stop = K.connectRelay(RELAY + '/events', { onMessage: (m) => messages.push(m), onStatus: (st) => statuses.push(st) });
    return { sources, statuses, messages, clock, stop };
  }
  const dropClosed = (src) => { src.readyState = 2; src.onerror(); };

  await check('a closed stream is reopened with backoff 1 s, 2 s, 4 s ... capped at 30 s', async () => {
    const { sources, statuses, clock, stop } = setup(0.5);
    const want = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (let i = 0; i < want.length; i += 1) {
      dropClosed(sources[i]);
      ok(sources[i].closed, 'old stream closed #' + i);
      eq(clock.log[i], want[i], 'delay #' + i);
      await clock.advance(want[i] - 1);
      eq(sources.length, i + 1, 'not reopened early #' + i);
      await clock.advance(1);
      eq(sources.length, i + 2, 'reopened #' + i);
      eq(sources[i + 1].url, RELAY + '/events', 'same url');
    }
    eq(statuses[0], 'connecting', 'first status');
    ok(statuses.slice(1).every((s) => s === 'reconnecting'), 'later statuses are reconnecting');
    stop();
  });

  await check('backoff jitter stays within +/- 20 % (and never beyond 30 s)', async () => {
    const lo = setup(0);
    dropClosed(lo.sources[0]);
    eq(lo.clock.log[0], 800, 'low');
    lo.stop();
    const hi = setup(1);
    dropClosed(hi.sources[0]);
    eq(hi.clock.log[0], 1200, 'high');
    hi.stop();
    const cap = setup(1);
    for (let i = 0; i < 8; i += 1) { dropClosed(cap.sources[i]); await cap.clock.advance(30000); }
    ok(cap.clock.log.every((d) => d <= 30000), 'all delays <= 30000: ' + cap.clock.log.join(','));
    eq(cap.clock.log[cap.clock.log.length - 1], 30000, 'capped');
    cap.stop();
  });

  await check('onopen resets the backoff; messages from the reopened stream are forwarded', async () => {
    const { sources, statuses, messages, clock, stop } = setup(0.5);
    dropClosed(sources[0]);
    await clock.advance(1000);
    dropClosed(sources[1]);
    eq(clock.log[1], 2000, 'second delay grew');
    await clock.advance(2000);
    sources[2].onopen();
    eq(statuses[statuses.length - 1], 'open', 'status open');
    sources[2].emit('chat', JSON.stringify({ id: 'm-9', username: 'viewer', message: 'hi' }));
    eq(messages.map((m) => m.kind), ['chat'], 'forwarded from the new stream');
    dropClosed(sources[2]);
    eq(clock.log[2], 1000, 'delay back to 1 s after open');
    stop();
  });

  await check('an error while the browser is still retrying (not CLOSED) does not reopen or close', async () => {
    const { sources, statuses, clock, stop } = setup();
    sources[0].readyState = 0;
    sources[0].onerror();
    await clock.advance(60000);
    eq(sources.length, 1, 'no new stream');
    eq(sources[0].closed, false, 'not closed');
    eq(statuses, ['connecting', 'reconnecting'], 'statuses');
    stop();
  });

  await check('stop() cancels a pending reconnect and closes the stream', async () => {
    const { sources, clock, stop } = setup();
    dropClosed(sources[0]);
    stop();
    await clock.advance(60000);
    eq(sources.length, 1, 'no new stream after stop');
    const second = setup();
    second.stop();
    ok(second.sources[0].closed, 'closed');
  });

  await check('a failing EventSource constructor on reopen schedules another attempt', async () => {
    const sources = [];
    const clock = fakeClock();
    let broken = false;
    const Base = fakeEventSource(sources);
    class Flaky extends Base { constructor(url) { if (broken) throw new Error('blocked'); super(url); } }
    const { K, ctx } = loadCore(Object.assign({ EventSource: Flaky }, clock.opts()));
    setRandom(ctx, 0.5);
    const stop = K.connectRelay(RELAY + '/events', {});
    broken = true;
    dropClosed(sources[0]);
    await clock.advance(1000);
    eq(clock.log.slice(0, 2), [1000, 2000], 'second attempt scheduled with a longer delay');
    broken = false;
    await clock.advance(2000);
    eq(sources.length, 2, 'reopened once the constructor works');
    stop();
  });
}

// ---- Section: themes, components, pages -----------------------------------------

async function testThemesAndPages() {
  section('Themes and pages');
  const css = stripCss(fs.readFileSync(CSS_FILE, 'utf8'));
  const { K, ctx } = loadCore();
  const SELECTOR_PREFIX = { stil: 'theme-', sekil: 'shape-', yaziTipi: 'font-', animasyon: 'motion-' };

  await check('enum lists match the documented values', () => {
    eq(K.enums('stil'), ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'], 'stil');
    eq(K.enums('sekil'), ['pill', 'rounded', 'square'], 'sekil');
    eq(K.enums('yaziTipi'), ['inter', 'poppins', 'nunito', 'mono'], 'yaziTipi');
    eq(K.enums('dil'), ['tr', 'en', 'both'], 'dil');
    eq(K.enums('animasyon'), ['normal', 'low', 'off'], 'animasyon');
  });

  await check('themes.css: braces balance', () => {
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    eq(open, close, 'open vs close braces');
  });

  for (const name of Object.keys(SELECTOR_PREFIX)) {
    await check(`themes.css: every ${name} value has a body selector`, () => {
      K.enums(name).forEach((v) => {
        const cls = SELECTOR_PREFIX[name] + v;
        ok(new RegExp('body\\.' + cls + '(?![\\w-])').test(css), 'missing body.' + cls);
      });
    });
  }

  await check('dil: every value is handled by label() (no CSS class by design)', () => {
    const expected = { tr: 'T', en: 'E', both: 'T / E' };
    K.enums('dil').forEach((v) => eq(K.label(K.normalize({ dil: v }), 'T', 'E'), expected[v], 'dil ' + v));
  });

  await check('applyLook() emits the class for every enum value', () => {
    Object.keys(SELECTOR_PREFIX).forEach((name) => K.enums(name).forEach((v) => {
      ctx.document = fakeDocument('');
      K.applyLook(K.normalize({ [name]: v }));
      const want = SELECTOR_PREFIX[name] + v;
      ok(ctx.document.body.className.split(' ').includes(want), 'applyLook did not set ' + want);
    }));
  });

  await check('themes.css: every overlay component class is defined', () => {
    const components = ['ko-bar', 'ko-fill', 'ko-row', 'ko-cur', 'ko-label', 'ko-sep', 'ko-goal', 'ko-chip', 'is-neg',
      'ko-bump', 'ko-panel', 'is-off', 'ko-dot', 'ko-stat', 'ko-val', 'ko-sep-v', 'ko-feed', 'ko-msg', 'is-leaving',
      'ko-badges', 'ko-badge', 'ko-user', 'ko-text', 'ko-emote', 'ko-bcast', 'ko-note', 'is-hidden', 'ko-hint'];
    components.forEach((c) => ok(new RegExp('\\.' + c + '(?![\\w-])').test(css), 'missing .' + c));
  });

  for (const page of OVERLAY_PAGES) {
    await check(`head template: ${page}`, () => checkHeadTemplate(pageHtml(page), page));
  }

  await check(`studio uses the shared stylesheet and core: ${STUDIO_PAGE}`, () => {
    const html = pageHtml(STUDIO_PAGE);
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    ok(hrefs.includes('shared/themes.css'), 'shared/themes.css link missing');
    ok(srcs.includes('shared/kick-core.js'), 'shared/kick-core.js script missing');
  });
  await check('studio texts: Turkish and English have the same keys, and every key used in the page exists', () => {
    const html = pageHtml(STUDIO_PAGE);
    const start = html.indexOf('var I18N = ');
    const end = html.indexOf('// Enum labels per language');
    ok(start > 0 && end > start, 'I18N table not found');
    const I18N = new vm.Script('(' + html.slice(start + 11, end).trim().replace(/;\s*$/, '') + ')').runInNewContext({});
    const tr = Object.keys(I18N.tr), en = Object.keys(I18N.en);
    eq(tr.filter((k) => !en.includes(k)), [], 'keys only in tr');
    eq(en.filter((k) => !tr.includes(k)), [], 'keys only in en');
    const used = new Set();
    for (const m of html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
    // Keys built from an id at run time.
    ['follower', 'subscriber', 'combined', 'info', 'countdown', 'ticker', 'chat'].forEach((id) => { used.add('ov.' + id); used.add('ov.' + id + '.d'); });
    ['minimal', 'neon', 'pastel', 'gece', 'kagit'].forEach((id) => used.add('preset.' + id));
    ['checker', 'dark', 'light', 'scene'].forEach((id) => used.add('bg.' + id));
    for (let n = 1; n <= 4; n++) used.add('help.c' + n);
    for (let n = 1; n <= 7; n++) { used.add('help.n' + n + '.t'); used.add('help.n' + n + '.d'); }
    // Prefixes of the run-time keys above (t('preset.' + id)) are not keys themselves.
    const missing = [...used].filter((k) => !tr.includes(k) && !/\.$/.test(k) && k !== 'help.n');
    eq(missing, [], 'keys used but not defined');
    for (const k of tr) ok(String(I18N.tr[k]).trim() !== '' && String(I18N.en[k]).trim() !== '', 'empty text: ' + k);
  });
}

// ---- Section: syntax -------------------------------------------------------------

async function testSyntax() {
  section('Syntax');

  await check('kick-core.js parses (vm.Script)', () => {
    new vm.Script(CORE_SOURCE, { filename: CORE_FILE });
  });

  const htmlInRoot = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f));
  const pages = [...new Set([...OVERLAY_PAGES, STUDIO_PAGE, ...htmlInRoot])];
  for (const page of pages) {
    await check(`inline scripts parse: ${page}`, () => {
      const scripts = inlineScripts(pageHtml(page));
      scripts.forEach((code, i) => new vm.Script(code, { filename: page + ' inline #' + (i + 1) }));
    });
  }
}

// ---- Main ------------------------------------------------------------------------

(async function main() {
  await testCoreApi();
  await testNormalize();
  await testReadSettings();
  await testHelpers();
  await testParsers();
  await testKickRest();
  await testOfficial();
  await testSubscriberSource();
  await testChatFeed();
  await testMockServer();
  await testSettingsV23();
  await testHelpersV23();
  await testCreateGoalBar();
  await testPoller();
  await testRelayInfoAndChannel();
  await testSubscriberRelayAndBaseline();
  await testConnectRelayReconnect();
  await testThemesAndPages();
  await testSyntax();

  const total = counts.PASS + counts.FAIL + counts.PENDING;
  console.log('\nSummary: ' + counts.PASS + ' passed, ' + counts.FAIL + ' failed, ' +
    counts.PENDING + ' pending (' + total + ' checks)');
  process.exitCode = counts.FAIL > 0 ? 1 : 0;
})().catch((err) => {
  console.error('Runner error: ' + ((err && err.message) || err));
  process.exitCode = 1;
});
