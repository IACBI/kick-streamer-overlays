#!/usr/bin/env node
'use strict';
// Live chat relay for the Kick overlay pack.
//
// Kick sends events (chat messages, bans) as signed HTTP POSTs to a public HTTPS address.
// A web page loaded from disk cannot receive those, so this small server does:
//   1. webhook listener (127.0.0.1:WEBHOOK_PORT): accepts POST /kick/webhook only. Expose this
//      port through a tunnel such as cloudflared; nothing else on it is reachable.
//   2. events listener (127.0.0.1:EVENTS_PORT): serves the overlay over Server-Sent Events.
//      It is never exposed publicly.
//
// Run:  node relay/server.js            (Node.js 18 or newer, no packages)

const http = require('http');
const { HEADER, verifySignature, isFresh, ReplayGuard, normalizeEvent } = require('./webhook.js');

const KEY_URL = 'https://api.kick.com/public/v1/public-key';
const KEY_TTL_MS = 60 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const MAX_CLIENTS = 20;

function send(res, status, body, extra) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  }, extra || {}));
  res.end(payload);
}

// Reads the raw body (for the signature) and rejects anything over MAX_BODY.
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Default key source: Kick's public key, cached for an hour. A forced refetch (after a bad
// signature, in case Kick rotated the key) happens at most once a minute, so forged requests
// cannot make the relay hammer Kick's API.
const FORCE_MIN_GAP_MS = 60 * 1000;

function kickKeySource(fetchImpl) {
  let pem = null, fetchedAt = 0;
  return async function getKey(force) {
    const age = Date.now() - fetchedAt;
    if (pem && (age < KEY_TTL_MS && (!force || age < FORCE_MIN_GAP_MS))) return pem;
    const r = await fetchImpl(KEY_URL, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('public key HTTP ' + r.status);
    const body = await r.json();
    const k = body && body.data && body.data.public_key;
    if (typeof k !== 'string' || !k.includes('BEGIN PUBLIC KEY')) throw new Error('public key missing');
    pem = k;
    fetchedAt = Date.now();
    return pem;
  };
}

function createRelay(opts) {
  const o = Object.assign({
    webhookPort: 8788,
    eventsPort: 8790,
    host: '127.0.0.1',
    broadcasterUserId: '',     // when set, events for other broadcasters are dropped
    publicKeyPem: null,        // tests inject a key; production fetches Kick's
    fetchImpl: globalThis.fetch,
    now: () => Date.now()
  }, opts || {});

  const getKey = o.publicKeyPem
    ? async () => o.publicKeyPem
    : kickKeySource(o.fetchImpl);
  const replay = new ReplayGuard();
  const clients = new Set();

  function broadcast(ev) {
    const frame = `event: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of clients) res.write(frame);
  }

  // ---- webhook listener (public via tunnel) ----
  const webhook = http.createServer(async (req, res) => {
    if (req.url !== '/kick/webhook') return send(res, 404, { error: 'not found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

    let raw;
    try { raw = await readRaw(req); } catch (e) { return send(res, e.status || 400, { error: 'bad request' }, { Connection: 'close' }); }

    const messageId = req.headers[HEADER.messageId];
    const timestamp = req.headers[HEADER.timestamp];
    const signature = req.headers[HEADER.signature];
    const type = req.headers[HEADER.type];
    if (!messageId || !timestamp || !signature) return send(res, 401, { error: 'missing headers' });

    let key;
    try { key = await getKey(false); } catch (e) { return send(res, 503, { error: 'key unavailable' }); }
    let ok = verifySignature({ messageId, timestamp, rawBody: raw, signature, publicKeyPem: key });
    if (!ok) {
      // A key rotation is the usual cause of a sudden failure: refetch once and try again.
      try { key = await getKey(true); } catch (e) { return send(res, 503, { error: 'key unavailable' }); }
      ok = verifySignature({ messageId, timestamp, rawBody: raw, signature, publicKeyPem: key });
    }
    if (!ok) return send(res, 401, { error: 'bad signature' });
    if (!isFresh(timestamp, o.now())) return send(res, 401, { error: 'stale' });

    // Accepted: Kick may resend, so answer 200 for repeats without showing them again.
    if (!replay.accept(String(messageId), o.now())) return send(res, 200, { ok: true, duplicate: true });

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad json' }); }
    const ev = normalizeEvent(String(type || ''), body);
    if (ev && (!o.broadcasterUserId || ev.broadcasterId === o.broadcasterUserId)) broadcast(ev);
    return send(res, 200, { ok: true });
  });

  // ---- events listener (local only, for the overlay page) ----
  const events = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });
    if (req.url === '/health') return send(res, 200, { ok: true, clients: clients.size });
    if (req.url !== '/events') return send(res, 404, { error: 'not found' });
    if (clients.size >= MAX_CLIENTS) return send(res, 503, { error: 'too many clients' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    clients.add(res);
    const beat = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(beat); clients.delete(res); });
  });

  function listen(server, port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, o.host, () => resolve(server.address().port));
    });
  }

  return {
    webhook, events,
    async start() {
      const webhookPort = await listen(webhook, o.webhookPort);
      const eventsPort = await listen(events, o.eventsPort);
      return { webhookPort, eventsPort };
    },
    stop() {
      for (const res of clients) res.end();
      clients.clear();
      webhook.close();
      events.close();
    }
  };
}

// ---- command line ----
if (require.main === module) {
  const env = process.env;
  const relay = createRelay({
    webhookPort: Number(env.RELAY_WEBHOOK_PORT || 8788),
    eventsPort: Number(env.RELAY_EVENTS_PORT || 8790),
    broadcasterUserId: String(env.RELAY_BROADCASTER_ID || ''),
    fetchImpl: globalThis.fetch
  });
  relay.start().then(({ webhookPort, eventsPort }) => {
    console.log('Kick relay running.');
    console.log(`  Webhook (expose this through a tunnel): http://127.0.0.1:${webhookPort}/kick/webhook`);
    console.log(`  Overlay events (local only):            http://127.0.0.1:${eventsPort}/events`);
    if (!env.RELAY_BROADCASTER_ID) console.log('  Tip: set RELAY_BROADCASTER_ID to accept only your channel.');
  }).catch((e) => {
    console.error('Could not start the relay:', e.message);
    process.exit(1);
  });
}

module.exports = { createRelay };
