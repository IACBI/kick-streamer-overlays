'use strict';
// Shared helpers for the unit tests in tests/unit/: the vm loader for kick-core.js, fakes, and the check/report
// functions. tests/run.js runs the areas in order and prints the summary.

const fs = require('fs');

const path = require('path');

const vm = require('vm');

const { startMockKick, CLIENT_ID, CLIENT_SECRET } = require('../mock-kick-api.js');

const ROOT = path.join(__dirname, '..', '..');

const CORE_FILE = path.join(ROOT, 'shared', 'kick-core.js');

const CSS_FILE = path.join(ROOT, 'shared', 'themes.css');

const SETTINGS_FILE = path.join(ROOT, 'AYARLAR.js');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures');

const OVERLAY_PAGES = ['follower-bar.html', 'subscriber-bar.html', 'combined-bar.html', 'info-panel.html', 'chat.html', 'countdown.html', 'ticker.html', 'alerts.html', 'events.html', 'leaderboard.html', 'kicks-bar.html', 'sub-train.html'];

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
  hataNotu: true, hedefKutlama: true, bilgiBaslik: false,
  uyariSn: 6, uyariTakip: true, uyariAbone: true, uyariHediye: true, uyariKicks: true, uyariOdul: true,
  uyariSes: true, uyariSesSeviye: 60, uyariOdulGizle: '', uyariTts: false, uyariTtsUzunluk: 120, uyariTtsYasak: '',
  olaySayisi: 5, liderTur: 'gift', liderSayisi: 5, hedefArtis: 0, kicksHedefi: 1000, trenSn: 120,
  sohbetYatay: false, ozelCss: ''
};

const RELAY = 'http://127.0.0.1:8790';

const CORE_SOURCE = fs.readFileSync(CORE_FILE, 'utf8');

// Label languages, in the order every page loads them (before kick-core.js).
const LANGS = ['tr', 'en', 'es', 'pt', 'de', 'ar'];

const LANG_FILES = LANGS.map((l) => path.join(ROOT, 'shared', 'lang', l + '.js'));

const PKG_VERSION = require('../../package.json').version;

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
    crypto: opts.crypto,
    localStorage: opts.localStorage,
    location: opts.location || { search: opts.search || '' },
    performance: { now: () => env.now },
    requestAnimationFrame: (cb) => { env.frames.push(cb); return env.frames.length; },
    cancelAnimationFrame: () => {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (opts.ayarlar) ctx.KICK_OVERLAY_AYARLAR = opts.ayarlar;
  if (opts.yerel) ctx.KICK_OVERLAY_YEREL = opts.yerel;
  if (!opts.noLang) LANG_FILES.forEach((f) => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f }));
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
  LANGS.forEach((l) => {
    const i = scripts.indexOf('shared/lang/' + l + '.js');
    ok(i >= 0 && i < iCore, 'shared/lang/' + l + '.js must load before shared/kick-core.js');
  });
  if (LOCAL_SETTINGS_PAGES.includes(page)) {
    ok(iLocal >= 0, 'AYARLAR.local.js script missing');
    ok(iSettings < iLocal && iLocal < iCore, 'script order must be AYARLAR.js, AYARLAR.local.js, shared/kick-core.js');
  } else {
    ok(iLocal < 0 && !/AYARLAR\.local\.js/.test(html), 'must not load AYARLAR.local.js (credentials stay out of pages that never call the official API)');
    ok(iSettings < iCore, 'script order must be AYARLAR.js, shared/kick-core.js');
  }
}

const PLURAL_CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];

const slots = (v) => new Set(String(v).match(/\{\w+\}/g) || []);

// Stand-in for the browser's EventSource: records the URL and lets the test emit frames.
function fakeEventSource(list) {
  return class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; this.closed = false; list.push(this); }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach((fn) => fn({ data })); }
    close() { this.closed = true; }
  };
}

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

const HEALTH = (features) => jsonRes({ ok: true, version: PKG_VERSION, clients: 0, features: Object.assign({ chat: false, channel: true, subscribers: false }, features) });

module.exports = { fs, path, vm, startMockKick, CLIENT_ID, CLIENT_SECRET, ROOT, CORE_FILE, CSS_FILE, SETTINGS_FILE, FIXTURE_DIR, OVERLAY_PAGES, STUDIO_PAGE, TEST_LOCAL, DEFAULTS, RELAY, CORE_SOURCE, LANGS, LANG_FILES, PKG_VERSION, counts, Pending, report, check, section, deepEq, eq, eqFields, ok, loadCore, fakeNet, fixture, withSubs, liveBody, liveSubs, officialFake, isTokenCall, isRelayCall, dataCalls, tokenCalls, relayCalls, kickCalls, bearerOf, subscriberSetup, fakeDocument, stripCss, pageHtml, inlineScripts, LOCAL_SETTINGS_PAGES, checkHeadTemplate, PLURAL_CATS, slots, fakeEventSource, flush, fakeClock, setRandom, fakeEl, fakeStorage, throwingStorage, fakeHeadDocument, fakeVisibilityDocument, jsonRes, SUBS_OK, HEALTH };
