#!/usr/bin/env node
'use strict';
// Live chat relay for the Kick overlay pack.
//
// Kick sends events (chat messages, bans) as signed HTTP POSTs to a public HTTPS address.
// A web page loaded from disk cannot receive those, so this small server does:
//   1. webhook listener (127.0.0.1:WEBHOOK_PORT): accepts POST /kick/webhook only (relay/kick.js reads and checks it). Expose this
//      port through a tunnel such as cloudflared; nothing else on it is reachable.
//   2. events listener (127.0.0.1:EVENTS_PORT): serves the overlay over Server-Sent Events, plus
//      /health, /channel and /subscribers. It is never exposed publicly.
//
// Run:  node relay/server.js            (Node.js 20 or newer, no packages)
//   or  kick-relay(.exe) from a release, placed next to AYARLAR.js (no Node.js needed)

const crypto = require('crypto');
const http = require('http');
const { ReplayGuard, TokenBucket, normalizeEvent } = require('./webhook.js');
const { createKickAdapter, WEBHOOK_PATH } = require('./kick.js');
const { ROOT, loadConfig, loadRelayKey, parsePort } = require('./config.js');
const { createLogger } = require('./log.js');
const { startTunnel, cloudflaredPath, cloudflaredFound } = require('./tunnel.js');
const { createStats } = require('./stats.js');
const { createSite } = require('./site.js');
const { createRecorder } = require('./record.js');
const { createKickLive } = require('./kick-live.js');
const path = require('path');

const { version: VERSION } = require('../package.json');
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 20;
const MAX_CLIENT_BUFFER = 1024 * 1024;   // an SSE client that falls this far behind is dropped
const HEARTBEAT_MS = 20000;
const CHANNEL_TTL_MS = 20 * 1000;
const SUBS_TTL_MS = 15 * 1000;
const CACHE_MAX = 20;
const MAX_BLOCK_SEC = 120;
const RESOLVE_GAP_MS = 60 * 1000;
const LIVE_RETRY_MS = 60 * 1000;          // the channel lookup for the live feed, when kick.com did not answer
const DUP_MS = 2 * 60 * 1000;            // the live feed and a webhook may report the same event; the second is dropped
const DUP_CHAT_MS = 5000;
const DUP_MAX = 4000;
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
const POST_ROUTES = new Set(['/test-alert', '/control', '/overlay', '/stats/reset', '/credentials', '/subscribe']);
const SUBSCRIBE_GAP_MS = 5000;         // each run asks Kick three or four times
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
    publicUrl: null,           // server mode: the https address a reverse proxy serves this relay on
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
    recordDir: null,           // record mode: redacted copies of verified webhooks go here
    kickLive: false,           // Kick's realtime chat feed (relay/kick-live.js); main() turns it on
    WebSocketImpl: undefined,
    onConfigChange: () => {},  // after the studio saved settings or credentials
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

  // Server mode: one public https address in front of the events port. Its host and origin are accepted besides the
  // loopback ones, Kick's webhook is taken on the same port, and pages never receive the access key.
  let publicOrigin = null, publicHost = null;
  if (o.publicUrl) {
    let u;
    try { u = new URL(String(o.publicUrl)); } catch (e) { throw new Error('RELAY_PUBLIC_URL is not a URL', { cause: e }); }
    if (u.protocol !== 'https:' || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
      throw new Error('RELAY_PUBLIC_URL must be a plain https:// address, such as https://overlays.example.com');
    }
    publicOrigin = u.origin;
    publicHost = u.host.toLowerCase();
  }
  const hostOk = (h) => LOOPBACK_HOST.test(h || '') || (publicHost !== null && String(h || '').toLowerCase() === publicHost);
  const originOk = (origin) => originAllowed(origin) || (publicOrigin !== null && origin === publicOrigin);

  const accessKey = o.accessKey === undefined ? loadRelayKey({ root: o.configRoot }) : String(o.accessKey);
  const keyOk = (given) => {
    if (typeof given !== 'string' || !given || !accessKey) return false;
    const a = Buffer.from(given, 'utf8'), b = Buffer.from(accessKey, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  let fileConfig = null;
  const config = () => fileConfig || (fileConfig = loadConfig({ root: o.configRoot }));
  const site = createSite({ siteRoot: o.siteRoot, configRoot: o.configRoot, accessKey: () => accessKey, publicMode: publicOrigin !== null });
  const credentials = () => (o.credentials === undefined ? config().credentials : (o.credentials || null));
  const slugOption = () => (o.channelSlug === undefined ? config().slug : String(o.channelSlug || ''));

  const kick = createKickAdapter(Object.assign({}, o, { credentials }));
  const api = kick.api;
  const recorder = o.recordDir ? createRecorder({ dir: o.recordDir, logger: o.logger }) : null;
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

  // The live feed and the webhooks can both report one event. Chat has an id on both; alerts are matched by what
  // they show. Only a match from the OTHER source counts: two equal gifts in a row from one source are two gifts.
  const seen = new Map();     // key -> { t, src }
  function duplicate(ev, src) {
    const t = o.now();
    const who = String(ev.username || '').toLowerCase();
    /** @type {[string, number][]} */
    const keys = ev.kind === 'chat'
      ? [['msg:' + who + ':' + ev.message, DUP_CHAT_MS]]
      : ev.kind === 'ban' ? [['ban:' + who, 10000]]
      : ALERT_KINDS.has(ev.kind) && ev.kind !== 'reward' ? [[ev.kind + ':' + who + ':' + (ev.months || ev.count || ev.amount || ''), DUP_MS]]
      : [];
    if (ev.kind === 'chat' && ev.id) keys.push(['id:' + ev.id, DUP_MS]);
    let dup = false;
    for (const [k, win] of keys) {
      const at = seen.get(k);
      if (at && at.src !== src && t - at.t < win) dup = true;
      else seen.set(k, { t, src });
    }
    if (seen.size > DUP_MAX) {
      for (const [k, at] of seen) if (t - at.t >= DUP_MS) seen.delete(k);
      for (const k of seen.keys()) { if (seen.size <= DUP_MAX / 2) break; seen.delete(k); }
    }
    return dup;
  }

  /** @param {any} ev @param {'webhook' | 'live'} src */
  function deliver(ev, src) {
    if (duplicate(ev, src)) return;
    broadcast(ev);
    // A new stream starts the numbers over; Kick sends is_live true once, when the stream starts.
    if (ev.kind === 'live' && ev.live === true) { stats.reset(); statsChanged(); }
    else if (stats.record(ev)) statsChanged();
  }

  // ---- Kick's realtime feed: chat and subscriptions with no Kick app and no tunnel ----
  let liveTimer = null, liveSlug = '';
  const live = o.kickLive ? createKickLive({
    fetchImpl: o.fetchImpl, WebSocketImpl: o.WebSocketImpl, logger: o.logger,
    onEvent: (ev) => {
      if (ALERT_KINDS.has(ev.kind)) ev.id = 'live-' + crypto.randomUUID();
      deliver(ev, 'live');
    }
  }) : null;

  // Looks the channel's chat room up on kick.com and follows it. The same answer gives the broadcaster id, so webhook
  // events are accepted too, even before Kick app credentials exist.
  async function followLive() {
    if (!live) return;
    clearTimeout(liveTimer);
    const slug = slugOption();
    liveSlug = slug;
    if (!slug || !SLUG.test(slug)) { live.follow(''); return; }
    const r = /** @type {{ ok: boolean, text?: string }} */ (await kick.fetchChannel(slug).catch(() => ({ ok: false })));
    if (slug !== liveSlug) return;
    let j;
    try { j = r.ok && r.text ? JSON.parse(r.text) : null; } catch (e) { j = null; }
    const room = j && j.chatroom && j.chatroom.id;
    if (!room) {
      o.logger.warn(`  Kick live feed: could not look up the chat room of "${slug}"; trying again in a minute.`);
      liveTimer = setTimeout(followLive, LIVE_RETRY_MS);
      if (liveTimer.unref) liveTimer.unref();
      return;
    }
    if (!broadcasterId && !o.broadcasterUserId && j.user_id) broadcasterId = String(j.user_id);
    live.follow(room, j.id);
  }

  const liveOn = () => !!live && live.status().state === 'live';

  // ---- webhook listener (public via tunnel) ----
  async function handleWebhook(req, res) {
    if (req.url !== kick.webhookPath) return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

    // Refused before the body is read, so a flood of junk cannot make the relay drain uploads.
    const delivery = kick.readDelivery(req.headers);
    if (!delivery) return refuse(req, res, 401, { error: 'missing headers' });
    if (!kick.isFresh(delivery, o.now())) return refuse(req, res, 401, { error: 'stale' });
    if (!preAuth.take(o.now())) return refuse(req, res, 429, { error: 'too many requests' }, { 'Retry-After': '1' });

    let raw;
    try { raw = await readRaw(req); } catch (e) {
      return refuse(req, res, e.status || 400, { error: e.status === 413 ? 'too large' : 'bad request' });
    }

    let ok;
    try { ok = await kick.verify(delivery, raw); } catch (e) { return send(res, 503, { error: 'key unavailable' }); }
    if (!ok) return send(res, 401, { error: 'bad signature' });
    if (!bucket.take(o.now())) return send(res, 429, { error: 'too many requests' }, { 'Retry-After': '1' });

    // Accepted: Kick may resend, so answer 200 for repeats without showing them again.
    if (!replay.accept(String(delivery.id), o.now())) return send(res, 200, { ok: true, duplicate: true });
    lastEventAt = o.now();

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    if (recorder) recorder.save(delivery.type, body);
    const ev = kick.normalize(delivery.type, body);
    // A reward keeps one id across its pending and accepted updates, so it is shown once.
    if (ev && ALERT_KINDS.has(ev.kind)) ev.id = ev.kind === 'reward' ? 'reward-' + ev.redemptionId : String(delivery.id);
    if (ev) {
      if (broadcasterId ? ev.broadcasterId === broadcasterId : o.allowAnyBroadcaster) deliver(ev, 'webhook');
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
      p = kick.fetchChannel(slug).finally(() => channelInflight.delete(slug));
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
      const value = Object.assign({ ok: true }, kick.subscribersFrom(r.data));
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
      if (slugOption() !== before) followLive();
      o.logger.log('  Settings saved from the studio.');
      o.onConfigChange('settings');
      return send(res, 200, r);
    }
    const r = site.writeLocal(body);
    if (!r.ok) return send(res, r.error === 'write failed' ? 500 : 400, r);
    fileConfig = null;
    api.clearToken();
    subsCache.clear();
    if (!broadcasterId) resolveBroadcaster();
    o.logger.log(r.saved ? '  Kick app credentials saved from the studio.' : '  Kick app credentials removed from the studio.');
    o.onConfigChange('credentials');
    return send(res, 200, { ok: true, saved: r.saved, credentials: api.hasCredentials() });
  }

  // ---- /subscribe: the studio's "Connect chat and alerts" creates the missing Kick event subscriptions ----
  let lastSubscribeAt = -Infinity;
  const SUBSCRIBE_STATUS = { 'no-credentials': 503, 'no-channel': 400, auth: 401, 'not-found': 404, upstream: 502 };
  async function handleSubscribe(req, res) {
    if (req.headers.origin === undefined) return send(res, 403, { ok: false, error: 'origin required' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { ok: false, error: 'json only' });
    const now = o.now();
    if (now - lastSubscribeAt < SUBSCRIBE_GAP_MS) return send(res, 429, { ok: false, error: 'rate' }, { 'Retry-After': '5' });
    lastSubscribeAt = now;
    try {
      const r = await kick.subscribe(slugOption());
      if (!broadcasterId && !o.allowAnyBroadcaster) { broadcasterId = r.broadcasterId; }
      o.logger.log(r.added.length ? `  Subscribed to ${r.added.length} Kick event(s) from the studio.` : '  Kick event subscriptions checked from the studio: all present.');
      return send(res, 200, { ok: true, added: r.added, existing: r.existing });
    } catch (e) {
      const code = e && e.code && Object.hasOwn(SUBSCRIBE_STATUS, e.code) ? e.code : 'upstream';
      o.logger.warn('Kick event subscription failed:', e && e.message);
      return send(res, SUBSCRIBE_STATUS[code], { ok: false, error: code });
    }
  }

  // ---- events listener (local only, for the overlay page) ----
  async function handleEvents(req, res) {
    // Only loopback names (and in server mode the public address) are served, so a web page cannot reach this port
    // through DNS rebinding.
    if (!hostOk(req.headers.host)) return send(res, 403, { error: 'forbidden host' });
    if (publicOrigin !== null && req.url === kick.webhookPath) return handleWebhook(req, res);
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!originOk(origin)) return send(res, 403, { error: 'forbidden origin' });
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
    if (p === '/subscribe') return handleSubscribe(req, res);
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
        ok: true, version: VERSION, clients: clients.size, lastEventAt, channel: slugOption(),
        features: { chat: chatReady() || liveOn(), alerts: chatReady() || liveOn(), live: chatReady(), channel: true, subscribers: api.hasCredentials(), settings: true },
        alertsPaused, lastAlert: lastAlert ? lastAlert.kind : null,
        tunnel: tunnelUrl ? tunnelUrl + kick.webhookPath : publicOrigin ? publicOrigin + kick.webhookPath : null,
        server: publicOrigin !== null, recentErrors: recentErrors.slice(),
        live: live ? live.status() : null
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

  function listen(server, port, host) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host || o.host, () => resolve(server.address().port));
    });
  }

  return {
    webhook, events, clients, broadcast, stats,
    logger: o.logger,
    setTunnel(url) { tunnelUrl = typeof url === 'string' && /^https:\/\//.test(url) ? url : null; },
    chatReady,
    hasPack: site.hasPack,
    hasCredentials: () => api.hasCredentials(),
    async start() {
      // In server mode Kick posts to the events port; the separate webhook listener stays on loopback.
      const webhookPort = await listen(webhook, o.webhookPort, publicOrigin !== null ? '127.0.0.1' : o.host);
      const eventsPort = await listen(events, o.eventsPort);
      heartbeat = setInterval(() => { for (const res of Array.from(clients)) writeClient(res, ': ping\n\n'); }, HEARTBEAT_MS);
      heartbeat.unref();
      if (!chatReady()) await resolveBroadcaster();
      if (live) await followLive();
      return { webhookPort, eventsPort, chat: chatReady(), live: !!live };
    },
    stop() {
      clearInterval(heartbeat);
      clearTimeout(liveTimer);
      if (live) live.stop();
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
  // Server mode (RELAY_PUBLIC_URL): settings, key and stats live in RELAY_DATA_DIR (a volume in a container), the relay
  // listens on RELAY_HOST, and no tunnel or browser is started.
  const publicUrl = env.RELAY_PUBLIC_URL || null;
  const DATA = env.RELAY_DATA_DIR ? path.resolve(env.RELAY_DATA_DIR) : ROOT;
  let relay;
  try {
    relay = createRelay({
      host: env.RELAY_HOST || '127.0.0.1',
      publicUrl,
      configRoot: DATA,
      webhookPort: parsePort(env.RELAY_WEBHOOK_PORT, 8788, 'RELAY_WEBHOOK_PORT'),
      eventsPort: parsePort(env.RELAY_EVENTS_PORT, 8790, 'RELAY_EVENTS_PORT'),
      broadcasterUserId: String(env.RELAY_BROADCASTER_ID || ''),
      allowAnyBroadcaster: env.RELAY_ALLOW_ANY_BROADCASTER === '1',
      fetchImpl: globalThis.fetch,
      statsFile: path.join(DATA, 'kick-relay-stats.json'),
      labelsDir: env.RELAY_LABELS === '0' ? null : path.join(DATA, 'labels'),
      recordDir: argv.includes('--record') || env.RELAY_RECORD === '1' ? path.join(DATA, 'recordings') : null,
      onConfigChange: () => maybeTunnel(),
      kickLive: env.RELAY_KICK_LIVE !== '0',
      logger: log
    });
  } catch (e) {
    log.error('Could not start the relay:', e.message);
    process.exit(1);
  }
  // Ctrl+C or a service stop closes the sockets and ends open overlay streams before the process exits.
  let tunnel = null, webhookPortNow = 0;
  // --tunnel (or RELAY_TUNNEL=1) always starts the quick tunnel. The executable also starts it by itself once Kick app
  // credentials exist and cloudflared is installed, because a double-click user has no other way to get live events.
  // RELAY_TUNNEL=0 turns that off. The tunnel exposes only the signed webhook path.
  const tunnelAsked = argv.includes('--tunnel') || env.RELAY_TUNNEL === '1';
  const tunnelAuto = !tunnelAsked && !publicUrl && env.RELAY_TUNNEL !== '0' && isSea();
  function maybeTunnel() {
    if (tunnel || !webhookPortNow || !relay) return;
    if (!tunnelAsked && !(tunnelAuto && relay.hasCredentials() && cloudflaredFound(env, { root: ROOT }))) return;
    log.log(tunnelAsked ? '  Starting a Cloudflare quick tunnel...' : '  Starting a Cloudflare quick tunnel (cloudflared found; RELAY_TUNNEL=0 turns this off)...');
    tunnel = startTunnel({
      port: webhookPortNow, bin: cloudflaredPath(env, { root: ROOT }), logger: relay.logger,
      onUrl: (url) => {
        relay.setTunnel(url);
        if (url) {
          log.log('');
          log.log(`  Webhook URL for your Kick app: ${url}${WEBHOOK_PATH}`);
          log.log('  Paste it at kick.com/settings/developer -> your app -> Webhook URL. A new tunnel means a new URL.');
          log.log('');
        }
      }
    });
  }
  const shutdown = (sig) => { log.log(`Kick relay stopping (${sig}).`); if (tunnel) tunnel.stop(); relay.stop(); process.exit(0); };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  log.log(`Kick relay ${VERSION} starting...`);
  relay.start().then(({ webhookPort, eventsPort, chat }) => {
    log.log('Kick relay running.');
    if (publicUrl) log.log(`  Server mode. Webhook URL for your Kick app: ${new URL(publicUrl).origin}${WEBHOOK_PATH}`);
    else log.log(`  Webhook (expose this through a tunnel): http://127.0.0.1:${webhookPort}${WEBHOOK_PATH}`);
    if (argv.includes('--record') || env.RELAY_RECORD === '1') log.log(`  Record mode: verified webhooks are saved, without names or message text, to ${path.join(DATA, 'recordings')}`);
    webhookPortNow = webhookPort;
    maybeTunnel();
    const studioUrl = publicUrl ? new URL(publicUrl).origin + '/' : `http://127.0.0.1:${eventsPort}/`;
    const packHere = relay.hasPack();
    if (!packHere) log.warn(`  The overlay pack is not in ${ROOT}. Put the relay in the unpacked kick-streamer-overlays folder to use the studio.`);
    log.log('');
    log.log(`  Studio and overlays: ${studioUrl}`);
    log.log(publicUrl
      ? '  Open it, enter the access key once (RELAY_KEY, or AYARLAR.relay.js in the data folder), and copy the links into OBS.'
      : '  Open it in your browser, pick a look, press "Save", and paste the overlay links into OBS.');
    log.log('');
    // The executable is usually started with a double click: open the studio for the user. RELAY_OPEN=0 turns it off.
    if (packHere && !publicUrl && env.RELAY_OPEN !== '0' && (argv.includes('--open') || isSea())) openBrowser(studioUrl, log);
    if (chat) {
      if (env.RELAY_ALLOW_ANY_BROADCASTER === '1' && !env.RELAY_BROADCASTER_ID) log.log('  Chat and alerts: accepting events for ANY broadcaster (RELAY_ALLOW_ANY_BROADCASTER=1).');
    } else {
      log.warn('  WARNING: no channel yet, so chat and alerts cannot start.');
      log.warn('  Set your channel in the studio and press Save, or set RELAY_BROADCASTER_ID.');
      log.warn('  The guided setup does that: "node relay/setup.js" (or "kick-relay setup").');
    }
    log.log(env.RELAY_KEY
      ? '  Overlay access key: taken from RELAY_KEY (overlays need the same value).'
      : publicUrl
        ? `  Overlay access key: stored in ${path.join(DATA, 'AYARLAR.relay.js')}. Pages on the public address never receive it.`
        : '  Overlay access key: stored in AYARLAR.relay.js (overlays load it automatically).');
  }).catch((e) => {
    log.error('Could not start the relay:', e.message);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { createRelay, main, VERSION };
