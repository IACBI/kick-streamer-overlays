#!/usr/bin/env node
'use strict';
// Live chat relay for the Kick overlay pack.
//
// Kick sends events (chat messages, bans) as signed HTTP POSTs to a public HTTPS address.
// A web page loaded from disk cannot receive those, so this small server does:
//   1. webhook listener (127.0.0.1:WEBHOOK_PORT): accepts POST /kick/webhook only. Expose this
//      port through a tunnel such as cloudflared; nothing else on it is reachable.
//   2. events listener (127.0.0.1:EVENTS_PORT): serves the overlay over Server-Sent Events, plus
//      /health, /channel and /subscribers. It is never exposed publicly.
//
// Run:  node relay/server.js            (Node.js 20 or newer, no packages)
//   or  kick-relay(.exe) from a release, placed next to AYARLAR.js (no Node.js needed)

const crypto = require('crypto');
const http = require('http');
const { HEADER, verifySignature, isFresh, ReplayGuard, TokenBucket, normalizeEvent } = require('./webhook.js');
const { ROOT, loadConfig, fetchTimeout, loadRelayKey, parsePort } = require('./config.js');
const { createKickApi, retryAfterSec } = require('./kick-api.js');
const { createLogger } = require('./log.js');
const { startTunnel, cloudflaredPath } = require('./tunnel.js');
const { createStats } = require('./stats.js');
const { createSite } = require('./site.js');
const path = require('path');

const { version: VERSION } = require('../package.json');
const KEY_TTL_MS = 60 * 60 * 1000;
const FORCE_MIN_GAP_MS = 60 * 1000;      // forged requests must not make the relay hammer Kick
const KEY_FAIL_CACHE_MS = 30 * 1000;
const KEY_TIMEOUT_MS = 5000;
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 20;
const MAX_CLIENT_BUFFER = 1024 * 1024;   // an SSE client that falls this far behind is dropped
const HEARTBEAT_MS = 20000;
const CHANNEL_TTL_MS = 20 * 1000;
const SUBS_TTL_MS = 15 * 1000;
const CACHE_MAX = 20;
const MAX_BLOCK_SEC = 120;
const RESOLVE_GAP_MS = 60 * 1000;
const SLUG = /^[a-z0-9_-]{1,40}$/;
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
const LOOPBACK_NAME = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;
// Alert bodies carry no id of their own; the signed delivery id is unique, so it becomes the overlay's dedupe key.
const ALERT_KINDS = new Set(['follow', 'sub', 'gift', 'kicks', 'reward']);
const CONTROL_GAP_MS = 300;             // dock buttons: fast enough for a double click, not for a flood
const CONTROL_ACTIONS = new Set(['pause', 'resume', 'skip', 'replay']);
const MAX_COUNTDOWN_MIN = 720;          // same limit as the geriSayimDk setting
const MAX_LINES = 12;                   // same limits as the duyuruMetinleri setting (kick-core splitLines)
const MAX_TEXT = 400;
const STATS_FRAME_MS = 300;             // a burst of gifts sends one stats frame, not one per event
const TEST_GAP_MS = 1500;              // test alerts are for setup; a stuck button must not flood the stream
const SAVE_GAP_MS = 500;               // studio saves rewrite a file; one at a time is plenty
const POST_ROUTES = new Set(['/test-alert', '/control', '/overlay', '/stats/reset', '/credentials']);
// Fixed samples, so a test request cannot put any text of its own on stream.
const TEST_ALERTS = {
  follow: { kind: 'follow', username: 'TestFollower' },
  sub: { kind: 'sub', username: 'TestSubscriber', months: 1, renewal: false },
  gift: { kind: 'gift', username: 'TestGifter', count: 5, anonymous: false },
  kicks: { kind: 'kicks', username: 'TestKicks', amount: 100, giftName: 'Test', message: '' },
  reward: { kind: 'reward', username: 'TestRedeemer', title: 'Test reward', cost: 100, message: '' }
};

function send(res, status, body, extra) {
  if (res.headersSent || res.destroyed) { try { res.end(); } catch (e) { /* already gone */ } return; }
  const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  }, extra || {}));
  res.end(payload);
}

// Reads the raw body (for the signature). The declared length is checked first so an oversize
// upload is refused without reading it; a body that lies about its length is cut off at MAX_BODY.
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0) return reject(Object.assign(new Error('bad length'), { status: 400 }));
      if (n > MAX_BODY) return reject(Object.assign(new Error('too large'), { status: 413 }));
    }
    const chunks = [];
    let size = 0, over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_BODY) { over = true; req.pause(); reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('close', () => reject(Object.assign(new Error('aborted'), { status: 400 })));   // no-op once settled
  });
}

// Answers, then drops the connection so the rest of a refused upload is never read. The delay
// lets the response reach the client before the socket is torn down.
function refuse(req, res, status, body, extra) {
  send(res, status, body, Object.assign({ Connection: 'close' }, extra));
  res.once('finish', () => { setTimeout(() => req.destroy(), 1000).unref(); });
}

// Default key source: Kick's public key, cached for an hour. Concurrent callers share one
// request; a failure is remembered for 30 s so a down API is not retried per webhook.
function kickKeySource(o) {
  let pem = null, fetchedAt = 0, failedAt = 0, failure = null, inflight = null;
  async function fetchKey() {
    try {
      const r = await fetchTimeout(o.fetchImpl, `${o.apiBase}/public/v1/public-key`, { headers: { Accept: 'application/json' } }, KEY_TIMEOUT_MS);
      if (!r.ok) throw new Error('public key HTTP ' + r.status);
      const body = await r.json();
      const k = body && body.data && body.data.public_key;
      if (typeof k !== 'string' || !k.includes('BEGIN PUBLIC KEY')) throw new Error('public key missing');
      pem = k;
      fetchedAt = o.now();
      failedAt = 0;
      return pem;
    } catch (e) {
      failedAt = o.now();
      failure = e;
      throw e;
    }
  }
  return async function getKey(force) {
    const now = o.now();
    const age = now - fetchedAt;
    if (pem && age < KEY_TTL_MS && (!force || age < FORCE_MIN_GAP_MS)) return pem;
    if (failedAt && now - failedAt < KEY_FAIL_CACHE_MS) {
      if (pem && age < KEY_TTL_MS) return pem;
      throw failure;
    }
    if (!inflight) inflight = fetchKey().finally(() => { inflight = null; });
    return inflight;
  };
}

const numOrNull = (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};
function parseTime(v) {
  if (typeof v !== 'string' || !v) return null;
  const st = v.replace(' ', 'T');
  const ms = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(st) ? st : st + 'Z');
  return Number.isNaN(ms) ? null : ms;
}

// Same shape as kick-core's parseOfficialChannel, so the overlay can use the answer unchanged.
function subscribersFrom(body) {
  const ch = body && Array.isArray(body.data) ? body.data[0] : null;
  if (!ch || typeof ch !== 'object') return { subs: null, gifted: null, canceled: null, live: null, viewers: null, startMs: null, title: '' };
  const st = ch.stream || {};
  return {
    subs: numOrNull(ch.active_subscribers_count),
    gifted: numOrNull(ch.active_gifted_subscribers_count),
    canceled: numOrNull(ch.canceled_subscribers_count),
    live: typeof st.is_live === 'boolean' ? st.is_live : null,
    viewers: numOrNull(st.viewer_count),
    startMs: parseTime(st.start_time),
    title: typeof ch.stream_title === 'string' ? ch.stream_title : ''
  };
}

// Overlays run from file:// (Origin "null") or a local web server. Origin is only defense in depth:
// a sandboxed iframe sends Origin "null" as well, so the access key is what really gates the API.
function originAllowed(origin) {
  if (origin === 'null') return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_NAME.test(u.hostname);
  } catch (e) { return false; }
}

function createRelay(opts) {
  const o = Object.assign({
    webhookPort: 8788,
    eventsPort: 8790,
    host: '127.0.0.1',
    broadcasterUserId: '',     // when set, events for other broadcasters are dropped
    allowAnyBroadcaster: false,
    publicKeyPem: null,        // tests inject a key; production fetches Kick's
    fetchImpl: globalThis.fetch,
    apiBase: 'https://api.kick.com',
    tokenBase: 'https://id.kick.com',
    kickBase: 'https://kick.com',
    credentials: undefined,    // { id, secret } or false; undefined reads env / AYARLAR.local.js
    channelSlug: undefined,    // undefined reads KICK_CHANNEL / AYARLAR.js
    webhookPreAuthRate: { perSec: 200, burst: 400 },   // unsigned traffic: an emergency ceiling only
    webhookRate: { perSec: 30, burst: 60 },            // signed traffic: what Kick really sends
    accessKey: undefined,      // events port key; undefined reads or creates AYARLAR.relay.js
    statsFile: null,           // stream stats survive a restart when set (main() sets it next to AYARLAR.js)
    labelsDir: null,           // plain-text files for OBS Text sources when set
    siteRoot: ROOT,            // the pages served on the events port
    configRoot: ROOT,          // where AYARLAR.js and AYARLAR.local.js are read and saved
    normalizeEvent,
    logger: console,
    now: () => Date.now()
  }, opts || {});

  // The last few warnings and errors, for the studio's relay check. Messages are the relay's own log lines,
  // which never contain secrets (see log.js).
  const RECENT_MAX = 10;
  const recentErrors = [];
  const baseLogger = o.logger;
  o.logger = Object.assign({}, baseLogger, {
    warn: (...a) => { remember('warn', a); baseLogger.warn(...a); },
    error: (...a) => { remember('error', a); baseLogger.error(...a); }
  });
  function remember(level, args) {
    const msg = args.map((x) => (typeof x === 'string' ? x : x && x.message ? x.message : String(x))).join(' ').slice(0, 200);
    // Wall-clock time on purpose: this runs inside error handlers, where an injected clock may be what failed.
    recentErrors.push({ at: Date.now(), level, msg });
    if (recentErrors.length > RECENT_MAX) recentErrors.shift();
  }
  let tunnelUrl = null;

  const accessKey = o.accessKey === undefined ? loadRelayKey() : String(o.accessKey);
  const keyOk = (given) => {
    if (typeof given !== 'string' || !given || !accessKey) return false;
    const a = Buffer.from(given, 'utf8'), b = Buffer.from(accessKey, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  let fileConfig = null;
  const config = () => fileConfig || (fileConfig = loadConfig({ root: o.configRoot }));
  const site = createSite({ siteRoot: o.siteRoot, configRoot: o.configRoot, accessKey: () => accessKey });
  const credentials = () => (o.credentials === undefined ? config().credentials : (o.credentials || null));
  const slugOption = () => (o.channelSlug === undefined ? config().slug : String(o.channelSlug || ''));

  const api = createKickApi({ fetchImpl: o.fetchImpl, apiBase: o.apiBase, tokenBase: o.tokenBase, credentials, now: o.now });
  const getKey = o.publicKeyPem
    ? async () => o.publicKeyPem
    : kickKeySource(o);
  const replay = new ReplayGuard();
  const preAuth = new TokenBucket(o.webhookPreAuthRate.perSec, o.webhookPreAuthRate.burst);
  const bucket = new TokenBucket(o.webhookRate.perSec, o.webhookRate.burst);
  const clients = new Set();
  let broadcasterId = o.broadcasterUserId ? String(o.broadcasterUserId) : '';
  let heartbeat = null;
  let lastEventAt = null;     // last verified, non-duplicate delivery: proves the tunnel and the Kick app settings work

  // ---- broadcaster id: events are only accepted for a known channel ----
  let resolving = null, lastResolve = -Infinity, lastWarn = -Infinity;
  const chatReady = () => !!broadcasterId || !!o.allowAnyBroadcaster;

  function resolveBroadcaster() {
    if (broadcasterId) return Promise.resolve(true);
    if (resolving) return resolving;
    const slug = slugOption();
    if (!api.hasCredentials() || !slug) return Promise.resolve(false);
    lastResolve = o.now();
    resolving = api.broadcasterId(slug).then((r) => {
      if (r.ok) { broadcasterId = r.id; o.logger.log(`  Broadcaster id for "${slug}" resolved; chat events are accepted.`); return true; }
      o.logger.warn(`  Could not resolve the broadcaster id for "${slug}" (${r.error}).`);
      return false;
    }, () => false).finally(() => { resolving = null; });
    return resolving;
  }

  function warnDropped() {
    const t = o.now();
    if (t - lastWarn < RESOLVE_GAP_MS) return;
    lastWarn = t;
    o.logger.warn('WARNING: chat events are being dropped because the broadcaster id is unknown. '
      + 'Set RELAY_BROADCASTER_ID, or provide KICK_CLIENT_ID / KICK_CLIENT_SECRET and kanal so it can be looked up, '
      + 'or set RELAY_ALLOW_ANY_BROADCASTER=1 to accept events for any channel.');
  }

  // ---- SSE fan-out ----
  function dropClient(res) {
    clients.delete(res);
    try { res.destroy(); } catch (e) { /* already closed */ }
  }

  function writeClient(res, frame) {
    try {
      if (res.writableLength > MAX_CLIENT_BUFFER) return dropClient(res);
      const ok = res.write(frame);
      if (!ok && res.writableLength > MAX_CLIENT_BUFFER) dropClient(res);
    } catch (e) { dropClient(res); }
  }

  // ---- stream stats: recent events, leaderboards, totals, sub train ----
  // The stats clock falls back to wall time: stats are created at startup, before any injected clock is trusted.
  const statsNow = () => { try { return o.now(); } catch (e) { return Date.now(); } };
  const stats = createStats({ now: statsNow, file: o.statsFile, labelsDir: o.labelsDir, logger: o.logger });
  const statsFrame = () => `event: stats
data: ${JSON.stringify(stats.snapshot())}

`;
  let statsTimer = null;
  function statsChanged() {
    if (statsTimer) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      const frame = statsFrame();
      for (const res of Array.from(clients)) writeClient(res, frame);
    }, STATS_FRAME_MS);
    if (statsTimer.unref) statsTimer.unref();
  }

  // The last alert shown, real or test, so the dock can replay it; and whether alerts are paused, which a page
  // that connects later must learn too.
  let lastAlert = null, alertsPaused = false;

  function broadcast(ev) {
    if (ALERT_KINDS.has(ev.kind)) lastAlert = ev;
    const frame = `event: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of Array.from(clients)) writeClient(res, frame);
  }

  // ---- webhook listener (public via tunnel) ----
  async function handleWebhook(req, res) {
    if (req.url !== '/kick/webhook') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

    // Refused before the body is read, so a flood of junk cannot make the relay drain uploads.
    const messageId = req.headers[HEADER.messageId];
    const timestamp = req.headers[HEADER.timestamp];
    const signature = req.headers[HEADER.signature];
    const type = req.headers[HEADER.type];
    if (!messageId || !timestamp || !signature) return refuse(req, res, 401, { error: 'missing headers' });
    if (!isFresh(timestamp, o.now())) return refuse(req, res, 401, { error: 'stale' });
    if (!preAuth.take(o.now())) return refuse(req, res, 429, { error: 'too many requests' }, { 'Retry-After': '1' });

    let raw;
    try { raw = await readRaw(req); } catch (e) {
      return refuse(req, res, e.status || 400, { error: e.status === 413 ? 'too large' : 'bad request' });
    }

    let key;
    try { key = await getKey(false); } catch (e) { return send(res, 503, { error: 'key unavailable' }); }
    let ok = verifySignature({ messageId, timestamp, rawBody: raw, signature, publicKeyPem: key });
    if (!ok) {
      // A key rotation is the usual cause of a sudden failure: refetch, and only retry with a new key.
      let key2 = key;
      try { key2 = await getKey(true); } catch (e) { /* keep the old key: the request stays rejected */ }
      if (key2 !== key) ok = verifySignature({ messageId, timestamp, rawBody: raw, signature, publicKeyPem: key2 });
    }
    if (!ok) return send(res, 401, { error: 'bad signature' });
    if (!bucket.take(o.now())) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '1' });

    // Accepted: Kick may resend, so answer 200 for repeats without showing them again.
    if (!replay.accept(String(messageId), o.now())) return send(res, 200, { ok: true, duplicate: true });
    lastEventAt = o.now();

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    const ev = o.normalizeEvent(String(type || ''), body);
    // A reward keeps one id across its pending and accepted updates, so it is shown once.
    if (ev && ALERT_KINDS.has(ev.kind)) ev.id = ev.kind === 'reward' ? 'reward-' + ev.redemptionId : String(messageId);
    if (ev) {
      if (broadcasterId ? ev.broadcasterId === broadcasterId : o.allowAnyBroadcaster) {
        broadcast(ev);
        // A new stream starts the numbers over; Kick sends is_live true once, when the stream starts.
        if (ev.kind === 'live' && ev.live === true) { stats.reset(); statsChanged(); }
        else if (stats.record(ev)) statsChanged();
      }
      else if (!broadcasterId) {
        warnDropped();
        if (o.now() - lastResolve >= RESOLVE_GAP_MS) resolveBroadcaster();   // maybe it works now; this event is still dropped
      }
    }
    return send(res, 200, { ok: true });
  }

  const webhook = http.createServer((req, res) => {
    handleWebhook(req, res).catch((e) => {
      o.logger.error('webhook handler error:', e && e.message);
      send(res, 500, { error: 'internal' });
    });
  });
  webhook.requestTimeout = 10000;
  webhook.headersTimeout = 8000;
  webhook.keepAliveTimeout = 5000;
  webhook.maxHeadersCount = 50;

  // ---- /channel: Kick's public channel JSON, cached and shared ----
  const channelCache = new Map();      // slug -> { at, text, source }
  const channelInflight = new Map();
  let channelBlockedUntil = 0;

  async function fetchChannel(slug) {
    for (const ver of ['v2', 'v1']) {
      let r;
      try { r = await fetchTimeout(o.fetchImpl, `${o.kickBase}/api/${ver}/channels/${slug}`, { headers: { Accept: 'application/json' } }); } catch (e) { continue; }
      if (r.ok) {
        try {
          const text = await r.text();
          JSON.parse(text);
          return { ok: true, text, source: ver };
        } catch (e) { continue; }
      }
      if (r.status === 403 || r.status === 429) return { ok: false, rate: true, retryAfterSec: retryAfterSec(r.headers) };
      if (r.status === 404 || r.status >= 500) continue;
      return { ok: false };
    }
    return { ok: false };
  }

  async function handleChannel(res, slug) {
    const now = o.now();
    const hit = channelCache.get(slug);
    if (hit && now - hit.at < CHANNEL_TTL_MS) {
      channelCache.delete(slug); channelCache.set(slug, hit);
      return send(res, 200, hit.text, { 'X-Kick-Source': hit.source });
    }
    if (now < channelBlockedUntil) {
      return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': String(Math.ceil((channelBlockedUntil - now) / 1000)) });
    }
    let p = channelInflight.get(slug);
    if (!p) {
      p = fetchChannel(slug).finally(() => channelInflight.delete(slug));
      channelInflight.set(slug, p);
    }
    const r = await p;
    if (r.ok) {
      channelCache.delete(slug);
      channelCache.set(slug, { at: o.now(), text: r.text, source: r.source });
      while (channelCache.size > CACHE_MAX) channelCache.delete(channelCache.keys().next().value);
      return send(res, 200, r.text, { 'X-Kick-Source': r.source });
    }
    if (r.rate) {
      channelBlockedUntil = o.now() + Math.min(r.retryAfterSec, MAX_BLOCK_SEC) * 1000;
      return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': String(r.retryAfterSec) });
    }
    return send(res, 502, { ok: false, error: 'upstream' });
  }

  // ---- /subscribers: official API with the app credentials held here ----
  const subsCache = new Map();         // slug -> { at, value }
  const subsInflight = new Map();

  async function handleSubscribers(res, slug) {
    if (!api.hasCredentials()) return send(res, 503, { ok: false, error: 'no-credentials' });
    const hit = subsCache.get(slug);
    if (hit && o.now() - hit.at < SUBS_TTL_MS) {
      subsCache.delete(slug); subsCache.set(slug, hit);
      return send(res, 200, hit.value);
    }
    let p = subsInflight.get(slug);
    if (!p) {
      p = api.channels(slug).finally(() => subsInflight.delete(slug));
      subsInflight.set(slug, p);
    }
    const r = await p;
    if (r.ok) {
      const value = Object.assign({ ok: true }, subscribersFrom(r.data));
      subsCache.delete(slug);
      subsCache.set(slug, { at: o.now(), value });
      while (subsCache.size > CACHE_MAX) subsCache.delete(subsCache.keys().next().value);
      return send(res, 200, value);
    }
    if (r.error === 'no-credentials') return send(res, 503, { ok: false, error: 'no-credentials' });
    if (r.error === 'auth') return send(res, 401, { ok: false, error: 'auth' });
    if (r.error === 'rate') return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': String(r.retryAfterSec || 60) });
    return send(res, 502, { ok: false, error: 'upstream' });
  }

  // ---- /test-alert: a sample alert to every connected page, for setting up sound and art ----
  let lastTestAt = -Infinity, testSeq = 0;
  function handleTestAlert(res, kind) {
    if (!Object.hasOwn(TEST_ALERTS, kind)) return send(res, 400, { ok: false, error: 'bad kind' });
    const now = o.now();
    if (now - lastTestAt < TEST_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '2' });
    lastTestAt = now;
    testSeq += 1;
    broadcast(Object.assign({ id: `test-${now}-${testSeq}`, test: true }, TEST_ALERTS[kind]));
    return send(res, 200, { ok: true, kind, clients: clients.size });
  }

  // ---- /control: the OBS dock's buttons, as frames every alerts page obeys ----
  const controlFrame = (action) => `event: control\ndata: ${JSON.stringify({ action })}\n\n`;
  let lastControlAt = -Infinity, replaySeq = 0;
  function handleControl(res, action) {
    if (!CONTROL_ACTIONS.has(action)) return send(res, 400, { ok: false, error: 'bad action' });
    const now = o.now();
    if (now - lastControlAt < CONTROL_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '1' });
    lastControlAt = now;
    if (action === 'replay') {
      if (!lastAlert) return send(res, 409, { ok: false, error: 'no alert yet' });
      replaySeq += 1;
      // A new id, or the page would drop it as already seen.
      broadcast(Object.assign({}, lastAlert, { id: `replay-${now}-${replaySeq}`, replay: true }));
    } else {
      if (action === 'pause') alertsPaused = true;
      if (action === 'resume') alertsPaused = false;
      const frame = controlFrame(action);
      for (const c of Array.from(clients)) writeClient(c, frame);
    }
    return send(res, 200, { ok: true, action, paused: alertsPaused, clients: clients.size });
  }

  // ---- /overlay: countdown and announcement changes from the dock, kept for pages that connect later ----
  // Text is the streamer's own (typed into the local dock); it is trimmed and capped like the matching settings,
  // and the pages set it as text only.
  const oneLine = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  let countdownState = null, tickerState = null, lastOverlayAt = -Infinity;
  const overlayFrame = (state) => `event: overlay\ndata: ${JSON.stringify(state)}\n\n`;
  function handleOverlay(res, q) {
    const target = q.get('target');
    let state;
    if (target === 'countdown') {
      const raw = q.get('minutes');
      const min = /^\d{1,3}$/.test(raw || '') ? Number(raw) : NaN;
      if (!(min <= MAX_COUNTDOWN_MIN)) return send(res, 400, { ok: false, error: 'bad minutes' });
      state = { target, deadline: o.now() + min * 60000, total: min * 60000, title: oneLine(q.get('title'), 60) };
    } else if (target === 'ticker') {
      const reset = q.get('reset') === '1';
      const lines = reset ? [] : String(q.get('lines') || '').slice(0, MAX_TEXT).split('|').map((t) => oneLine(t, MAX_TEXT)).filter(Boolean).slice(0, MAX_LINES);
      if (!reset && !lines.length) return send(res, 400, { ok: false, error: 'no lines' });
      state = { target, lines };   // no lines: back to the page's own setting
    } else {
      return send(res, 400, { ok: false, error: 'bad target' });
    }
    const now = o.now();
    if (now - lastOverlayAt < CONTROL_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '1' });
    lastOverlayAt = now;
    if (target === 'countdown') countdownState = state;
    else tickerState = state.lines.length ? state : null;
    const frame = overlayFrame(state);
    for (const c of Array.from(clients)) writeClient(c, frame);
    return send(res, 200, { ok: true, target, clients: clients.size });
  }

  // ---- /settings and /credentials: the studio saves through the relay ----
  // Only a page of an allowed origin may write: the request must carry an Origin and a JSON body, which a form on
  // another site cannot send without a preflight the origin check refuses.
  let lastSaveAt = -Infinity;
  async function handleSave(req, res, p) {
    if (req.headers.origin === undefined) return send(res, 403, { ok: false, error: 'origin required' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'json only' });
    const now = o.now();
    if (now - lastSaveAt < SAVE_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '1' });
    lastSaveAt = now;
    let body;
    try { body = JSON.parse((await readRaw(req)).toString('utf8')); } catch (e) {
      return refuse(req, res, e.status || 400, { ok: false, error: e.status === 413 ? 'too large' : 'bad json' });
    }
    if (p === '/settings') {
      const before = slugOption();
      const r = site.writePublic(body && body.settings);
      if (!r.ok) return send(res, r.error === 'write failed' || r.error === 'pack missing' ? 500 : 400, r);
      fileConfig = null;
      // A new channel needs its own broadcaster id, unless the id was given explicitly.
      if (slugOption() !== before && !o.broadcasterUserId) { broadcasterId = ''; resolveBroadcaster(); }
      o.logger.log('  Settings saved from the studio.');
      return send(res, 200, r);
    }
    const r = site.writeLocal(body);
    if (!r.ok) return send(res, r.error === 'write failed' ? 500 : 400, r);
    fileConfig = null;
    api.clearToken();
    subsCache.clear();
    if (!broadcasterId) resolveBroadcaster();
    o.logger.log(r.saved ? '  Kick app credentials saved from the studio.' : '  Kick app credentials removed from the studio.');
    return send(res, 200, { ok: true, saved: r.saved, credentials: api.hasCredentials() });
  }

  // ---- events listener (local only, for the overlay page) ----
  async function handleEvents(req, res) {
    // Only loopback names are served, so a web page cannot reach this port through DNS rebinding.
    if (!LOOPBACK_HOST.test(req.headers.host || '')) return send(res, 403, { error: 'forbidden host' });
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!originAllowed(origin)) return send(res, 403, { error: 'forbidden origin' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Expose-Headers', 'X-Kick-Source, Retry-After');
    }
    if (req.method === 'OPTIONS') {
      const asked = req.headers['access-control-request-headers'];
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': typeof asked === 'string' ? asked.slice(0, 200) : 'Content-Type, Accept',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store'
      });
      return res.end();
    }
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { error: 'bad request' }); }
    const p = url.pathname;
    // The pack's own pages and assets: public files, no key.
    if (await site.serve(req, res, p)) return;
    // POST is only for the routes with a side effect; everything else is read-only GET. /settings has both.
    const methods = p === '/settings' ? ['GET', 'POST'] : POST_ROUTES.has(p) ? ['POST'] : ['GET'];
    if (!methods.includes(req.method)) return send(res, 405, { error: 'method not allowed' }, { Allow: methods.join(', ') + ', OPTIONS' });
    if (!keyOk(url.searchParams.get('key'))) return send(res, 401, { ok: false, error: 'bad key' });
    if (p === '/settings/rev') return send(res, 200, { ok: true, rev: site.settingsRev() });
    if (p === '/settings' && req.method === 'GET') {
      let settings = {};
      try { settings = site.readPublic(); } catch (e) { o.logger.warn('AYARLAR.js could not be read:', e.message); }
      return send(res, 200, { ok: true, settings, rev: site.settingsRev(), credentials: api.hasCredentials() });
    }
    if (p === '/settings' || p === '/credentials') return handleSave(req, res, p);
    if (p === '/test-alert') return handleTestAlert(res, url.searchParams.get('kind') || '');
    if (p === '/control') return handleControl(res, url.searchParams.get('action') || '');
    if (p === '/overlay') return handleOverlay(res, url.searchParams);
    if (p === '/stats') return send(res, 200, Object.assign({ ok: true }, stats.snapshot()));
    if (p === '/stats/reset') {
      const now = o.now();
      if (now - lastControlAt < CONTROL_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '1' });
      lastControlAt = now;
      stats.reset();
      statsChanged();
      return send(res, 200, { ok: true, clients: clients.size });
    }

    if (p === '/health') {
      return send(res, 200, {
        ok: true, version: VERSION, clients: clients.size, lastEventAt,
        features: { chat: chatReady(), alerts: chatReady(), live: chatReady(), channel: true, subscribers: api.hasCredentials(), settings: true },
        alertsPaused, lastAlert: lastAlert ? lastAlert.kind : null,
        tunnel: tunnelUrl ? tunnelUrl + '/kick/webhook' : null, recentErrors: recentErrors.slice()
      });
    }
    if (p === '/channel' || p === '/subscribers') {
      const slug = url.searchParams.get('slug') || '';
      if (!SLUG.test(slug)) return send(res, 400, { ok: false, error: 'bad slug' });
      return p === '/channel' ? handleChannel(res, slug) : handleSubscribers(res, slug);
    }
    if (p !== '/events') return send(res, 404, { error: 'not found' });
    if (clients.size >= MAX_CLIENTS) return send(res, 503, { error: 'too many clients' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    if (alertsPaused) res.write(controlFrame('pause'));
    // A countdown that ended is not sent again: an old "Going live!" must not replace a fresh page's own countdown.
    if (countdownState && countdownState.deadline > o.now()) res.write(overlayFrame(countdownState));
    if (tickerState) res.write(overlayFrame(tickerState));
    // Only a stream that already has numbers is sent; an empty one is what a page starts with anyway.
    if (stats.hasData()) res.write(statsFrame());
    clients.add(res);
    const remove = () => clients.delete(res);
    res.on('close', remove);
    res.on('error', remove);
  }

  const events = http.createServer((req, res) => {
    Promise.resolve().then(() => handleEvents(req, res)).catch((e) => {
      o.logger.error('events handler error:', e && e.message);
      send(res, 500, { ok: false, error: 'internal' });
    });
  });
  events.maxHeadersCount = 50;

  function listen(server, port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, o.host, () => resolve(server.address().port));
    });
  }

  return {
    webhook, events, clients, broadcast, stats,
    logger: o.logger,
    setTunnel(url) { tunnelUrl = typeof url === 'string' && /^https:\/\//.test(url) ? url : null; },
    chatReady,
    hasPack: site.hasPack,
    async start() {
      const webhookPort = await listen(webhook, o.webhookPort);
      const eventsPort = await listen(events, o.eventsPort);
      heartbeat = setInterval(() => { for (const res of Array.from(clients)) writeClient(res, ': ping\n\n'); }, HEARTBEAT_MS);
      heartbeat.unref();
      if (!chatReady()) await resolveBroadcaster();
      return { webhookPort, eventsPort, chat: chatReady() };
    },
    stop() {
      clearInterval(heartbeat);
      if (statsTimer) { clearTimeout(statsTimer); statsTimer = null; }
      stats.flush();
      for (const res of Array.from(clients)) { try { res.end(); } catch (e) { /* gone */ } }
      clients.clear();
      webhook.close();
      events.close();
      if (webhook.closeIdleConnections) { webhook.closeIdleConnections(); events.closeIdleConnections(); }
    }
  };
}

function isSea() {
  try { return require('node:sea').isSea(); } catch (e) { return false; }
}

// Opens a fixed local URL in the default browser. The URL is built here from a port number, never from input.
function openBrowser(url, log) {
  const { spawn } = require('child_process');
  const bin = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = [url];
  try {
    const child = spawn(bin, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => log.log('  (Could not open a browser; open the address above yourself.)'));
    child.unref();
  } catch (e) { log.log('  (Could not open a browser; open the address above yourself.)'); }
}

// ---- command line ----
// Also the entry of the single-file executable (relay/sea-main.js), where require.main is not this module.
function main(env = process.env, argv = process.argv.slice(2)) {
  let log;
  try { log = createLogger(env.RELAY_LOG_FORMAT); } catch (e) {
    console.error('Could not start the relay:', e.message);
    process.exit(1);
  }
  process.on('unhandledRejection', (/** @type {any} */ e) => log.error('Unhandled error (relay keeps running):', e && e.message ? e.message : e));
  let relay;
  try {
    relay = createRelay({
      webhookPort: parsePort(env.RELAY_WEBHOOK_PORT, 8788, 'RELAY_WEBHOOK_PORT'),
      eventsPort: parsePort(env.RELAY_EVENTS_PORT, 8790, 'RELAY_EVENTS_PORT'),
      broadcasterUserId: String(env.RELAY_BROADCASTER_ID || ''),
      allowAnyBroadcaster: env.RELAY_ALLOW_ANY_BROADCASTER === '1',
      fetchImpl: globalThis.fetch,
      statsFile: path.join(ROOT, 'kick-relay-stats.json'),
      labelsDir: env.RELAY_LABELS === '0' ? null : path.join(ROOT, 'labels'),
      logger: log
    });
  } catch (e) {
    log.error('Could not start the relay:', e.message);
    process.exit(1);
  }
  // Ctrl+C or a service stop closes the sockets and ends open overlay streams before the process exits.
  let tunnel = null;
  const shutdown = (sig) => { log.log(`Kick relay stopping (${sig}).`); if (tunnel) tunnel.stop(); relay.stop(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  log.log(`Kick relay ${VERSION} starting...`);
  relay.start().then(({ webhookPort, eventsPort, chat }) => {
    log.log('Kick relay running.');
    log.log(`  Webhook (expose this through a tunnel): http://127.0.0.1:${webhookPort}/kick/webhook`);
    if (argv.includes('--tunnel') || env.RELAY_TUNNEL === '1') {
      log.log('  Starting a Cloudflare quick tunnel...');
      tunnel = startTunnel({
        port: webhookPort, bin: cloudflaredPath(env), logger: relay.logger,
        onUrl: (url) => {
          relay.setTunnel(url);
          if (url) {
            log.log('');
            log.log(`  Webhook URL for your Kick app: ${url}/kick/webhook`);
            log.log('  Paste it at kick.com/settings/developer -> your app -> Webhook URL. A new tunnel means a new URL.');
            log.log('');
          }
        }
      });
    }
    const studioUrl = `http://127.0.0.1:${eventsPort}/`;
    const packHere = relay.hasPack();
    if (!packHere) log.warn(`  The overlay pack is not in ${ROOT}. Put the relay in the unpacked kick-streamer-overlays folder to use the studio.`);
    log.log('');
    log.log(`  Studio and overlays: ${studioUrl}`);
    log.log('  Open it in your browser, pick a look, press "Save", and paste the overlay links into OBS.');
    log.log('');
    // The executable is usually started with a double click: open the studio for the user. RELAY_OPEN=0 turns it off.
    if (packHere && env.RELAY_OPEN !== '0' && (argv.includes('--open') || isSea())) openBrowser(studioUrl, log);
    if (chat) {
      if (env.RELAY_ALLOW_ANY_BROADCASTER === '1' && !env.RELAY_BROADCASTER_ID) log.log('  Chat and alerts: accepting events for ANY broadcaster (RELAY_ALLOW_ANY_BROADCASTER=1).');
    } else {
      log.warn('  WARNING: broadcaster id unknown, so chat and alert events will be DROPPED.');
      log.warn('  Set RELAY_BROADCASTER_ID, or add Kick app credentials and kanal so it can be looked up.');
      log.warn('  The guided setup does that: "node relay/setup.js" (or "kick-relay setup").');
    }
    log.log(env.RELAY_KEY
      ? '  Overlay access key: taken from RELAY_KEY (overlays need the same value).'
      : '  Overlay access key: stored in AYARLAR.relay.js (overlays load it automatically).');
  }).catch((e) => {
    log.error('Could not start the relay:', e.message);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { createRelay, main, VERSION };
