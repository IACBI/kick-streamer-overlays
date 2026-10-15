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
const OVERLAY_PAGES = ['follower-bar.html', 'subscriber-bar.html', 'combined-bar.html', 'info-panel.html', 'chat.html'];
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
  yenilemeSn: 30, sohbetMaksMesaj: 8
};

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
    Date,
    JSON,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: opts.fetch || (async () => { throw new TypeError('no fetch in this check'); }),
    WebSocket: opts.WebSocket,
    document: opts.document,
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
    const r = await route(call);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
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
function officialFake({ token, channel = liveSubs(42) } = {}) {
  const issued = new Set();
  let tokenSeq = 0;
  let channelSeq = 0;
  return fakeNet(async (c) => {
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
const dataCalls = (net) => net.calls.filter((c) => !isTokenCall(c));
const tokenCalls = (net) => net.calls.filter(isTokenCall);
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

function checkHeadTemplate(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  const links = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
  ok(links.some((h) => h.startsWith('https://fonts.googleapis.com/css2?')), 'Google Fonts stylesheet link missing');
  ok(links.includes('shared/themes.css'), 'shared/themes.css link missing');
  const iSettings = scripts.indexOf('AYARLAR.js');
  const iLocal = scripts.indexOf('AYARLAR.local.js');
  const iCore = scripts.indexOf('shared/kick-core.js');
  ok(iSettings >= 0 && iLocal >= 0 && iCore >= 0, 'AYARLAR.js, AYARLAR.local.js or shared/kick-core.js script missing');
  ok(iSettings < iLocal && iLocal < iCore, 'script order must be AYARLAR.js, AYARLAR.local.js, shared/kick-core.js');
}

// ---- Section: core API and settings -------------------------------------------

async function testCoreApi() {
  section('Core API surface');
  const { K } = loadCore();
  await check('kick-core.js loads and exposes the documented API', () => {
    ['readSettings', 'normalize', 'schemaKeys', 'enums', 'label', 'fmt', 'pct', 'applyLook', 'tween',
      'getJson', 'createSubscriberSource', 'connectChat'].forEach((n) => ok(typeof K[n] === 'function', 'missing ' + n));
    ['followers', 'chatroomId', 'live', 'subBadges', 'time', 'chatEvent', 'official'].forEach((n) =>
      ok(typeof K.parse[n] === 'function', 'missing parse.' + n));
    ok(typeof K.kick.channel === 'function', 'missing kick.channel');
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

  await check('chatroomId: id from fixture; missing gives null', () => {
    eq(K.parse.chatroomId(v2off), 2002, 'fixture');
    eq(K.parse.chatroomId({}), null, 'missing');
  });

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

  await check('chatEvent: chat message from a JSON string payload', () => {
    const ev = K.parse.chatEvent({
      event: 'App\\Events\\ChatMessageEvent',
      data: JSON.stringify({
        id: 'm-1', content: 'hello',
        sender: { id: 5, username: 'viewer_one', identity: { color: '#ff0000', badges: [{ type: 'moderator' }] } }
      })
    });
    eqFields(ev, { kind: 'chat', id: 'm-1', username: 'viewer_one', color: '#ff0000', message: 'hello', senderId: '5' }, '');
  });

  await check('chatEvent: delete, ban and clear events', () => {
    eqFields(K.parse.chatEvent({ event: 'App\\Events\\MessageDeletedEvent', data: { message: { id: 'm-1' } } }),
      { kind: 'delete', messageId: 'm-1' }, 'delete ');
    eqFields(K.parse.chatEvent({ event: 'App\\Events\\UserBannedEvent', data: { user: { id: 9, username: 'Spammer' } } }),
      { kind: 'ban', userId: '9', username: 'spammer' }, 'ban ');
    eq(K.parse.chatEvent({ event: 'App\\Events\\ChatroomClearEvent', data: {} }).kind, 'clear', 'clear');
  });

  await check('chatEvent: pusher internal, unknown and broken payloads give null', () => {
    eq(K.parse.chatEvent({ event: 'pusher:ping', data: {} }), null, 'pusher:ping');
    eq(K.parse.chatEvent({ event: 'pusher_internal:subscription_succeeded', data: {} }), null, 'internal');
    eq(K.parse.chatEvent({ event: 'App\\Events\\SomethingElse', data: {} }), null, 'unknown');
    eq(K.parse.chatEvent({ event: 'App\\Events\\ChatMessageEvent', data: '{not json' }), null, 'bad JSON');
    eq(K.parse.chatEvent(null), null, 'null');
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
    eq(net.calls.length, 0, 'requests');
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
    eq(net.calls.length, 0, 'requests');
  });
}

// ---- Section: chat feed ----------------------------------------------------------

async function testChatFeed() {
  section('Chat feed (Pusher)');

  await check('connectChat: subscribes to both chatroom channels once connected', () => {
    const sockets = [];
    const statuses = [];
    const { K } = loadCore({ WebSocket: fakeWebSocket(sockets) });
    const stop = K.connectChat(2002, { onMessage() {}, onStatus: (st) => statuses.push(st) });
    try {
      ok(sockets.length === 1, 'expected one socket, got ' + sockets.length);
      const sock = sockets[0];
      sock.readyState = 1;
      sock.onmessage({ data: JSON.stringify({ event: 'pusher:connection_established', data: '{"socket_id":"1.1"}' }) });
      const subs = sock.sent.filter((m) => m.event === 'pusher:subscribe').map((m) => m.data.channel);
      eq(subs, ['chatrooms.2002', 'chatrooms.2002.v2'], 'subscribed channels');
      eq(statuses, ['connecting', 'open'], 'statuses');
    } finally {
      stop();
    }
  });

  await check('connectChat: pusher:error 4001 gives rejected and does not reconnect', () => {
    const sockets = [];
    const statuses = [];
    const { K } = loadCore({ WebSocket: fakeWebSocket(sockets) });
    const stop = K.connectChat(2002, { onMessage() {}, onStatus: (st) => statuses.push(st) });
    try {
      const sock = sockets[0];
      sock.readyState = 1;
      sock.onmessage({ data: JSON.stringify({ event: 'pusher:error', data: { code: 4001, message: 'not in this cluster' } }) });
      eq(statuses, ['connecting', 'rejected'], 'statuses');
      eq(sockets.length, 1, 'sockets opened');
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

// ---- Section: themes, components, pages -----------------------------------------

async function testThemesAndPages() {
  section('Themes and pages');
  const css = stripCss(fs.readFileSync(CSS_FILE, 'utf8'));
  const { K, ctx } = loadCore();
  const SELECTOR_PREFIX = { stil: 'theme-', sekil: 'shape-', yaziTipi: 'font-', animasyon: 'motion-' };

  await check('enum lists match SPEC.md', () => {
    eq(K.enums('stil'), ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal'], 'stil');
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

  await check('themes.css: every component named in SPEC.md is defined', () => {
    const components = ['ko-bar', 'ko-fill', 'ko-row', 'ko-cur', 'ko-label', 'ko-sep', 'ko-goal', 'ko-chip', 'is-neg',
      'ko-bump', 'ko-panel', 'is-off', 'ko-dot', 'ko-stat', 'ko-val', 'ko-sep-v', 'ko-feed', 'ko-msg', 'is-leaving',
      'ko-badges', 'ko-badge', 'ko-user', 'ko-text', 'ko-emote', 'ko-bcast', 'ko-note', 'is-hidden', 'ko-hint'];
    components.forEach((c) => ok(new RegExp('\\.' + c + '(?![\\w-])').test(css), 'missing .' + c));
  });

  for (const page of OVERLAY_PAGES) {
    await check(`head template: ${page}`, () => checkHeadTemplate(pageHtml(page)));
  }

  await check(`studio uses the shared stylesheet and core: ${STUDIO_PAGE}`, () => {
    const html = pageHtml(STUDIO_PAGE);
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    ok(hrefs.includes('shared/themes.css'), 'shared/themes.css link missing');
    ok(srcs.includes('shared/kick-core.js'), 'shared/kick-core.js script missing');
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
