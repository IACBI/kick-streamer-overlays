#!/usr/bin/env node
'use strict';
// Tests for the chat relay: signatures, replay protection, freshness, event mapping, and the
// two listeners. Uses a locally generated RSA key in place of Kick's public key, and real HTTP
// sockets on random ports. Run: node tests/relay-test.js

const crypto = require('crypto');
const http = require('http');
const path = require('path');

const { createRelay } = require(path.join(__dirname, '..', 'relay', 'server.js'));
const W = require(path.join(__dirname, '..', 'relay', 'webhook.js'));

const results = [];
function check(name, ok, detail) {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function quietLogger() {
  const l = { logs: [], warns: [], errors: [] };
  l.log = (...a) => l.logs.push(a.join(' '));
  l.warn = (...a) => l.warns.push(a.join(' '));
  l.error = (...a) => l.errors.push(a.join(' '));
  return l;
}
function mkClock() {
  let off = 0;
  return { now: () => Date.now() + off, advance: (ms) => { off += ms; } };
}
const listenOn = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// A stand-in for Kick's key pair, so signatures can be produced exactly as Kick does.
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const otherKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function sign(messageId, timestamp, bodyStr, keyPem) {
  const s = crypto.createSign('RSA-SHA256');
  s.update(Buffer.from(`${messageId}.${timestamp}.`, 'utf8'));
  s.update(Buffer.from(bodyStr, 'utf8'));
  return s.sign(keyPem, 'base64');
}

function chatBody(id, text, broadcasterId) {
  return JSON.stringify({
    message_id: id,
    broadcaster: { user_id: broadcasterId || 113812015, username: 'iacbi', channel_slug: 'iacbi' },
    sender: { user_id: 555, username: 'viewer_one', channel_slug: 'viewer_one', identity: {
      username_color: '#53fc18', badges: [{ type: 'vip', text: 'VIP' }, { type: 'sub_gifter', text: 'Gifter', count: 5 }] } },
    content: text,
    emotes: [],
    created_at: '2026-10-16T10:00:00Z'
  });
}

function post(port, { id, ts, body, sig, type = 'chat.message.sent', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/kick/webhook', method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Kick-Event-Type': type,
        'Kick-Event-Version': '1',
        'Kick-Event-Message-Id': id,
        'Kick-Event-Message-Timestamp': ts,
        'Kick-Event-Signature': sig
      }, headers)
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Opens the overlay event stream and collects "event:" frames.
function openSse(port) {
  const frames = [];
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev && data) frames.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    });
  });
  req.on('error', () => {});
  return { frames, close: () => req.destroy() };
}

function get(port, p, method = 'GET', headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('== relay: pure helpers');
  {
    const msg = 'abc.123.{"x":1}';
    const sig = crypto.createSign('RSA-SHA256').update(msg).sign(privateKey, 'base64');
    check('verifySignature accepts a correct signature', W.verifySignature({ messageId: 'abc', timestamp: '123', rawBody: Buffer.from('{"x":1}'), signature: sig, publicKeyPem: publicKey }));
    check('verifySignature rejects a body that was changed', !W.verifySignature({ messageId: 'abc', timestamp: '123', rawBody: Buffer.from('{"x":2}'), signature: sig, publicKeyPem: publicKey }));
    check('verifySignature rejects a different key', !W.verifySignature({ messageId: 'abc', timestamp: '123', rawBody: Buffer.from('{"x":1}'), signature: sig, publicKeyPem: otherKey.publicKey }));
    check('verifySignature rejects garbage without throwing', !W.verifySignature({ messageId: 'abc', timestamp: '123', rawBody: Buffer.from('{}'), signature: 'not-base64!!', publicKeyPem: publicKey }));
  }
  {
    const now = Date.parse('2026-10-16T10:00:00Z');
    check('parseTimestamp reads epoch seconds', W.parseTimestamp('1781600400') === 1781600400000);
    check('parseTimestamp reads epoch milliseconds', W.parseTimestamp('1781600400000') === 1781600400000);
    check('parseTimestamp reads ISO dates', W.parseTimestamp('2026-10-16T10:00:00Z') === now);
    check('parseTimestamp returns null for junk', W.parseTimestamp('soon') === null);
    check('isFresh accepts a timestamp within the skew', W.isFresh(String(now / 1000 - 60), now));
    check('isFresh rejects a timestamp 10 minutes old', !W.isFresh(String(now / 1000 - 600), now));
    check('isFresh rejects an unreadable timestamp', !W.isFresh('soon', now) && !W.isFresh('', now) && !W.isFresh(undefined, now));
  }
  {
    const g = new W.ReplayGuard(1000, 3);
    check('ReplayGuard accepts the first delivery', g.accept('m1', 0));
    check('ReplayGuard rejects a repeat', !g.accept('m1', 10));
    check('ReplayGuard forgets an id after its ttl', g.accept('m1', 2000));
    g.accept('a', 3000); g.accept('b', 3000); g.accept('c', 3000);
    check('ReplayGuard stays within its size limit', g.seen.size <= 3, `size=${g.seen.size}`);
  }
  {
    const chat = W.normalizeEvent('chat.message.sent', JSON.parse(chatBody('m9', 'hi there')));
    check('normalizeEvent maps a chat message', chat.kind === 'chat' && chat.message === 'hi there' && chat.username === 'viewer_one' && chat.color === '#53fc18', JSON.stringify(chat).slice(0, 120));
    check('normalizeEvent keeps badges with counts', chat.badges.length === 2 && chat.badges[1].count === 5);
    const ban = W.normalizeEvent('moderation.banned', { broadcaster: { user_id: 1 }, banned_user: { user_id: 9, username: 'SpamBot' }, metadata: {} });
    check('normalizeEvent maps a ban and lowercases the name', ban.kind === 'ban' && ban.username === 'spambot' && ban.userId === '9');
    check('normalizeEvent ignores events the overlay does not show', W.normalizeEvent('channel.followed', {}) === null);
    check('normalizeEvent caps very long text', W.normalizeEvent('chat.message.sent', { content: 'x'.repeat(5000), sender: {} }).message.length === 500);
  }

  console.log('\n== relay: webhook listener (real sockets)');
  const relay = createRelay({ publicKeyPem: publicKey, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015', credentials: false, channelSlug: '', logger: quietLogger() });
  const { webhookPort, eventsPort } = await relay.start();
  const stream = openSse(eventsPort);
  await sleep(150);

  const now = Date.now();
  const ts = String(Math.floor(now / 1000));
  const body1 = chatBody('msg-1', 'hello chat');
  const ok1 = await post(webhookPort, { id: 'msg-1', ts, body: body1, sig: sign('msg-1', ts, body1, privateKey) });
  check('signed chat event is accepted (200)', ok1.status === 200, `status=${ok1.status}`);
  await sleep(150);
  const got1 = stream.frames.find((f) => f.event === 'chat' && f.data.id === 'msg-1');
  check('accepted chat event reaches the overlay stream', !!got1 && got1.data.message === 'hello chat', JSON.stringify(got1 && got1.data).slice(0, 120));

  const body2 = chatBody('msg-2', 'forged');
  const bad = await post(webhookPort, { id: 'msg-2', ts, body: body2, sig: sign('msg-2', ts, body2, otherKey.privateKey) });
  check('event signed by another key is rejected (401)', bad.status === 401, `status=${bad.status}`);

  const body3 = chatBody('msg-3', 'original');
  const sig3 = sign('msg-3', ts, body3, privateKey);
  const tampered = await post(webhookPort, { id: 'msg-3', ts, body: body3.replace('original', 'changed'), sig: sig3 });
  check('edited body is rejected (401)', tampered.status === 401, `status=${tampered.status}`);

  const staleTs = String(Math.floor(now / 1000) - 3600);
  const body4 = chatBody('msg-4', 'old');
  const stale = await post(webhookPort, { id: 'msg-4', ts: staleTs, body: body4, sig: sign('msg-4', staleTs, body4, privateKey) });
  check('an hour-old signed event is rejected as stale (401)', stale.status === 401, `status=${stale.status}`);

  const replay = await post(webhookPort, { id: 'msg-1', ts, body: body1, sig: sign('msg-1', ts, body1, privateKey) });
  await sleep(100);
  const count1 = stream.frames.filter((f) => f.event === 'chat' && f.data.id === 'msg-1').length;
  check('a redelivered event is acknowledged but shown once', replay.status === 200 && count1 === 1, `status=${replay.status} shown=${count1}`);

  const noHeaders = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: webhookPort, path: '/kick/webhook', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.end('{}');
  });
  check('a request without Kick headers is rejected (401)', noHeaders === 401, `status=${noHeaders}`);

  const body5 = chatBody('msg-5', 'other channel', 999);
  const other = await post(webhookPort, { id: 'msg-5', ts, body: body5, sig: sign('msg-5', ts, body5, privateKey) });
  await sleep(100);
  check('an event for another broadcaster is accepted but not shown', other.status === 200 && !stream.frames.some((f) => f.data.id === 'msg-5'));

  const ban = JSON.stringify({ broadcaster: { user_id: 113812015 }, banned_user: { user_id: 77, username: 'SpamBot' }, metadata: {} });
  const banRes = await post(webhookPort, { id: 'ban-1', ts, body: ban, sig: sign('ban-1', ts, ban, privateKey), type: 'moderation.banned' });
  await sleep(100);
  check('a signed ban reaches the overlay stream', banRes.status === 200 && stream.frames.some((f) => f.event === 'ban' && f.data.username === 'spambot'));

  const unknown = JSON.stringify({ foo: 1 });
  const unk = await post(webhookPort, { id: 'x-1', ts, body: unknown, sig: sign('x-1', ts, unknown, privateKey), type: 'channel.followed' });
  check('an event type the overlay does not show is acknowledged and ignored', unk.status === 200);

  const badJson = 'not json';
  const bj = await post(webhookPort, { id: 'j-1', ts, body: badJson, sig: sign('j-1', ts, badJson, privateKey) });
  check('a validly signed body that is not JSON gets 400', bj.status === 400, `status=${bj.status}`);

  const big = 'x'.repeat(70 * 1024);
  const huge = await post(webhookPort, { id: 'big-1', ts, body: big, sig: sign('big-1', ts, big, privateKey) });
  check('a body over 64 KB is refused', huge.status === 413, `status=${huge.status}`);

  check('webhook port: GET is refused (405)', (await get(webhookPort, '/kick/webhook')).status === 405);
  check('webhook port: any other path is not found (404)', (await get(webhookPort, '/events')).status === 404);
  check('events port: unknown paths are not found (404)', (await get(eventsPort, '/kick/webhook')).status === 404);
  check('events port: POST is refused (405)', (await get(eventsPort, '/events', 'POST')).status === 405);
  check('events port: a foreign Host header is refused (403, DNS rebinding)', (await get(eventsPort, '/health', 'GET', { Host: 'evil.example' })).status === 403);
  const health = await get(eventsPort, '/health');
  check('events port: health reports the connected overlay', health.status === 200 && /"clients":1/.test(health.body), health.body);
  check('events port: no wildcard CORS header and Vary: Origin is set', health.headers['access-control-allow-origin'] === undefined && /origin/i.test(health.headers.vary || ''));

  stream.close();
  relay.stop();

  // ======================================================================================
  console.log('\n== relay: pure helpers (2.3.0)');
  {
    const b = new W.TokenBucket(2, 3);
    const t0 = 1000;
    const first = [b.take(t0), b.take(t0), b.take(t0), b.take(t0)];
    check('TokenBucket allows the burst then refuses', first.join() === 'true,true,true,false', first.join());
    check('TokenBucket refills over time', b.take(t0 + 600) === true && b.take(t0 + 600) === false);
    const chatOnBan = W.normalizeEvent('chat.message.sent', { broadcaster: { user_id: 1 }, banned_user: { user_id: 9, username: 'x' } });
    check('normalizeEvent: a ban body under the chat type is rejected', chatOnBan === null);
    check('normalizeEvent: a chat body under the ban type is rejected', W.normalizeEvent('moderation.banned', JSON.parse(chatBody('m1', 'hi'))) === null);
    check('normalizeEvent: chat without text content is rejected', W.normalizeEvent('chat.message.sent', { content: 5, sender: {} }) === null);
    check('normalizeEvent: non-object sender is rejected', W.normalizeEvent('chat.message.sent', { content: 'x', sender: 'bob' }) === null);
    check('normalizeEvent: arrays and null bodies are rejected', W.normalizeEvent('chat.message.sent', []) === null && W.normalizeEvent('moderation.banned', null) === null);
    const CFG = require(path.join(__dirname, '..', 'relay', 'config.js'));
    check('normalizeSlug follows the kanal rules', CFG.normalizeSlug('  https://kick.com/@Foo_Bar/videos ') === 'foo_bar' && CFG.normalizeSlug('@Name') === 'name' && CFG.normalizeSlug('kick.com/ABC') === 'abc' && CFG.normalizeSlug('x'.repeat(60)).length === 40, CFG.normalizeSlug('  https://kick.com/@Foo_Bar/videos '));
    const fs = require('fs');
    const tmp = path.join(require('os').tmpdir(), 'ko-relay-cfg-' + process.pid);
    fs.mkdirSync(tmp, { recursive: true });
    fs.writeFileSync(path.join(tmp, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = { kanal: "FromFile" };');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.local.js'), 'window.KICK_OVERLAY_YEREL = { kickClientId: "fid", kickClientSecret: "fsecret" };');
    const fromFiles = CFG.loadConfig({ root: tmp, env: {} });
    const fromEnv = CFG.loadConfig({ root: tmp, env: { KICK_CLIENT_ID: 'eid', KICK_CLIENT_SECRET: 'esecret', KICK_CHANNEL: 'EnvChan' } });
    check('loadConfig reads the settings files', fromFiles.slug === 'fromfile' && fromFiles.credentials && fromFiles.credentials.id === 'fid');
    check('loadConfig prefers the environment', fromEnv.slug === 'envchan' && fromEnv.credentials.id === 'eid');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.local.js'), 'this is not javascript (');
    const broken = CFG.loadConfig({ root: tmp, env: {} });
    check('loadConfig survives a broken settings file', broken.credentials === null && broken.warnings.length === 1 && broken.slug === 'fromfile');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ======================================================================================
  // A local stand-in for Kick (token, official channels, public key, kick.com channel JSON).
  const SUBS_BODY = (slug) => (slug === 'ghost' ? { data: [] } : { data: [{
    slug, broadcaster_user_id: 4242, active_subscribers_count: 17, active_gifted_subscribers_count: 3,
    canceled_subscribers_count: 1, stream_title: 'Test stream', stream: { is_live: true, viewer_count: 5, start_time: '2026-10-16T10:00:00Z' } }] });
  async function startMock() {
    const m = {
      hits: { token: 0, channels: 0, key: 0, v2: 0, v1: 0 },
      seq: 0, valid: new Set(), secret: 'test-secret', expiresIn: 3600, tokenForm: null, tokenType: '',
      channelsMode: 'ok', retryAfter: '9', keyMode: 'ok', keyPem: publicKey,
      v2: { status: 200, headers: {} }, v1: { status: 200, headers: {} }, delayMs: 0
    };
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://x');
      const reply = (st, obj, h) => {
        const p = typeof obj === 'string' ? obj : JSON.stringify(obj);
        res.writeHead(st, Object.assign({ 'Content-Type': 'application/json' }, h || {}));
        res.end(p);
      };
      let raw = '';
      for await (const c of req) raw += c;
      if (m.delayMs) await sleep(m.delayMs);
      if (req.method === 'POST' && u.pathname === '/oauth/token') {
        m.hits.token++;
        m.tokenType = req.headers['content-type'] || '';
        const f = new URLSearchParams(raw);
        m.tokenForm = Object.fromEntries(f);
        if (f.get('grant_type') !== 'client_credentials' || f.get('client_id') !== 'test-id' || f.get('client_secret') !== m.secret) return reply(401, { error: 'invalid_client' });
        const t = 'tok-' + (++m.seq);
        m.valid.add(t);
        return reply(200, { access_token: t, token_type: 'Bearer', expires_in: m.expiresIn });
      }
      if (u.pathname === '/public/v1/public-key') {
        m.hits.key++;
        if (m.keyMode === 'fail') return reply(500, { error: 'down' });
        return reply(200, { data: { public_key: m.keyPem } });
      }
      if (u.pathname === '/public/v1/channels') {
        m.hits.channels++;
        const tok = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (m.channelsMode === 'revoke-once') { m.channelsMode = 'ok'; m.valid.clear(); return reply(401, { error: 'unauthorized' }); }
        if (!tok || !m.valid.has(tok[1])) return reply(401, { error: 'unauthorized' });
        if (m.channelsMode === 'rate') return reply(429, { error: 'slow' }, { 'Retry-After': m.retryAfter });
        if (m.channelsMode === '500') return reply(500, { error: 'boom' });
        return reply(200, SUBS_BODY(u.searchParams.get('slug')));
      }
      const mm = /^\/api\/(v1|v2)\/channels\/([^/]+)$/.exec(u.pathname);
      if (mm) {
        m.hits[mm[1]]++;
        const cfg = m[mm[1]];
        if (cfg.status !== 200) return reply(cfg.status, { error: 'x' }, cfg.headers);
        return reply(200, `{"id":1,"slug":"${mm[2]}","v":"${mm[1]}"}`);
      }
      reply(404, { error: 'nf' });
    });
    const port = await listenOn(server);
    m.base = `http://127.0.0.1:${port}`;
    m.close = () => { server.close(); if (server.closeAllConnections) server.closeAllConnections(); };
    return m;
  }
  const mock = await startMock();
  const mockOpts = { apiBase: mock.base, tokenBase: mock.base, kickBase: mock.base };
  const baseOpts = (extra) => Object.assign({ webhookPort: 0, eventsPort: 0, publicKeyPem: publicKey, broadcasterUserId: '1', credentials: false, channelSlug: '', logger: quietLogger() }, mockOpts, extra || {});

  // ======================================================================================
  console.log('\n== relay: events listener, CORS and /health');
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    const allowed = ['null', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080', 'https://localhost'];
    for (const origin of allowed) {
      const res = await get(ep, '/health', 'GET', { Origin: origin });
      check(`CORS: origin ${origin} is allowed and echoed`, res.status === 200 && res.headers['access-control-allow-origin'] === origin && /origin/i.test(res.headers.vary || ''), `status=${res.status} acao=${res.headers['access-control-allow-origin']}`);
    }
    const none = await get(ep, '/health');
    check('CORS: no Origin header is allowed, no ACAO sent, Vary: Origin present', none.status === 200 && none.headers['access-control-allow-origin'] === undefined && /origin/i.test(none.headers.vary || ''));
    const denied = ['http://evil.example', 'https://kick.com', 'http://localhost.evil.example', 'http://127.0.0.1.evil.com', 'file://', 'ftp://localhost', 'not a url'];
    for (const origin of denied) {
      const res = await get(ep, '/health', 'GET', { Origin: origin });
      check(`CORS: origin ${origin} is refused (403) without ACAO`, res.status === 403 && res.headers['access-control-allow-origin'] === undefined, `status=${res.status}`);
    }
    const deniedChannel = await get(ep, '/channel?slug=abc', 'GET', { Origin: 'http://evil.example' });
    check('CORS: a refused origin cannot reach /channel either', deniedChannel.status === 403);
    check('CORS: readable response headers are exposed', /X-Kick-Source/i.test((await get(ep, '/health', 'GET', { Origin: 'null' })).headers['access-control-expose-headers'] || ''));

    const pre = await get(ep, '/channel?slug=abc', 'OPTIONS', { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' });
    check('OPTIONS preflight from an allowed origin answers 204 with allow headers', pre.status === 204 && pre.headers['access-control-allow-origin'] === 'http://localhost:5173' && /GET/.test(pre.headers['access-control-allow-methods'] || '') && pre.body === '', `status=${pre.status}`);
    const preBad = await get(ep, '/channel?slug=abc', 'OPTIONS', { Origin: 'http://evil.example' });
    check('OPTIONS preflight from a foreign origin is refused (403)', preBad.status === 403);
    const preHost = await get(ep, '/health', 'OPTIONS', { Host: 'evil.example' });
    check('OPTIONS with a foreign Host is refused (403)', preHost.status === 403);
    const put = await get(ep, '/health', 'PUT');
    check('PUT is refused (405) with an Allow header', put.status === 405 && /GET/.test(put.headers.allow || ''));

    const h = JSON.parse((await get(ep, '/health')).body);
    check('/health has the 2.3.0 shape', h.ok === true && h.version === '2.3.0' && h.clients === 0 && h.features && typeof h.features.chat === 'boolean' && h.features.channel === true && typeof h.features.subscribers === 'boolean', JSON.stringify(h));
    check('/health: chat true with a broadcaster id, subscribers false without credentials', h.features.chat === true && h.features.subscribers === false);
    check('/health ignores a query string', (await get(ep, '/health?x=1')).status === 200);
    check('/events with a CORS origin still streams (SSE)', await new Promise((resolve) => {
      const q = http.get({ host: '127.0.0.1', port: ep, path: '/events', headers: { Origin: 'null' } }, (res) => { resolve(res.statusCode === 200 && /event-stream/.test(res.headers['content-type']) && res.headers['access-control-allow-origin'] === 'null'); q.destroy(); });
      q.on('error', () => {});
    }));
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: /channel');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const a = await get(ep, '/channel?slug=iacbi');
    check('/channel: 200 with the raw upstream JSON and X-Kick-Source: v2', a.status === 200 && a.body === '{"id":1,"slug":"iacbi","v":"v2"}' && a.headers['x-kick-source'] === 'v2', a.body);
    check('/channel: JSON content type', /application\/json/.test(a.headers['content-type']));
    const before = mock.hits.v2;
    const b = await get(ep, '/channel?slug=iacbi');
    check('/channel: a repeat within 20 s is served from the cache', b.status === 200 && b.body === a.body && mock.hits.v2 === before);
    clock.advance(21000);
    await get(ep, '/channel?slug=iacbi');
    check('/channel: the cache expires after 20 s', mock.hits.v2 === before + 1);

    mock.delayMs = 120;
    const base2 = mock.hits.v2;
    const many = await Promise.all([1, 2, 3, 4, 5].map(() => get(ep, '/channel?slug=shared')));
    mock.delayMs = 0;
    check('/channel: concurrent requests share one upstream call', many.every((x) => x.status === 200) && mock.hits.v2 === base2 + 1, `hits=${mock.hits.v2 - base2}`);

    const lruBase = mock.hits.v2;
    for (let i = 0; i < 22; i++) await get(ep, '/channel?slug=lru' + i);
    await get(ep, '/channel?slug=lru21');
    check('/channel: recent slugs stay cached', mock.hits.v2 === lruBase + 22);
    await get(ep, '/channel?slug=lru0');
    check('/channel: the cache holds at most 20 slugs (oldest evicted)', mock.hits.v2 === lruBase + 23, `hits=${mock.hits.v2 - lruBase}`);

    for (const bad of ['', 'Bad Slug', 'UPPER', '../etc', 'a'.repeat(41), 'x%00y', 'a.b']) {
      const x = await get(ep, '/channel?slug=' + encodeURIComponent(bad));
      check(`/channel: invalid slug ${JSON.stringify(bad.slice(0, 12))} gets 400`, x.status === 400, `status=${x.status}`);
    }
    check('/channel: a missing slug gets 400', (await get(ep, '/channel')).status === 400);

    mock.v2 = { status: 404, headers: {} };
    const f1 = await get(ep, '/channel?slug=fallback404');
    check('/channel: v2 404 falls back to v1 (X-Kick-Source: v1)', f1.status === 200 && f1.headers['x-kick-source'] === 'v1' && /"v":"v1"/.test(f1.body));
    mock.v2 = { status: 503, headers: {} };
    const f2 = await get(ep, '/channel?slug=fallback503');
    check('/channel: v2 5xx falls back to v1', f2.status === 200 && f2.headers['x-kick-source'] === 'v1');
    mock.v1 = { status: 500, headers: {} };
    const f3 = await get(ep, '/channel?slug=bothdown');
    check('/channel: both versions failing gives 502 upstream', f3.status === 502 && JSON.parse(f3.body).error === 'upstream');
    mock.v1 = { status: 200, headers: {} };
    mock.v2 = { status: 200, headers: {} };
    r.stop();
  }
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    mock.v2 = { status: 429, headers: { 'Retry-After': '7' } };
    const v1Before = mock.hits.v1;
    const rl = await get(ep, '/channel?slug=limited');
    check('/channel: upstream 429 gives 429 with the upstream Retry-After', rl.status === 429 && rl.headers['retry-after'] === '7' && JSON.parse(rl.body).error === 'rate', `status=${rl.status} ra=${rl.headers['retry-after']}`);
    check('/channel: v1 is not tried after a 429', mock.hits.v1 === v1Before);
    const hitsNow = mock.hits.v2;
    const again = await get(ep, '/channel?slug=limited2');
    check('/channel: during the wait the relay does not call upstream again', again.status === 429 && mock.hits.v2 === hitsNow && Number(again.headers['retry-after']) >= 1 && Number(again.headers['retry-after']) <= 7);
    r.stop();
    const r2 = createRelay(baseOpts());
    const { eventsPort: ep2 } = await r2.start();
    mock.v2 = { status: 403, headers: {} };
    const f = await get(ep2, '/channel?slug=forbidden');
    check('/channel: upstream 403 gives 429 with the default Retry-After of 60', f.status === 429 && f.headers['retry-after'] === '60', `ra=${f.headers['retry-after']}`);
    mock.v2 = { status: 200, headers: {} };
    r2.stop();
  }

  // ======================================================================================
  console.log('\n== relay: /subscribers');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ credentials: { id: 'test-id', secret: 'test-secret' }, now: clock.now }));
    const { eventsPort: ep } = await r.start();
    check('/health: subscribers true when credentials exist', JSON.parse((await get(ep, '/health')).body).features.subscribers === true);
    const t0 = mock.hits.token, c0 = mock.hits.channels;
    const s = await get(ep, '/subscribers?slug=iacbi');
    const sj = JSON.parse(s.body);
    check('/subscribers: 200 with the overlay shape', s.status === 200 && sj.ok === true && sj.subs === 17 && sj.gifted === 3 && sj.canceled === 1 && sj.live === true && sj.viewers === 5 && sj.startMs === Date.parse('2026-10-16T10:00:00Z') && sj.title === 'Test stream', s.body);
    check('/subscribers: token requested as a client_credentials form post', mock.hits.token === t0 + 1 && /x-www-form-urlencoded/.test(mock.tokenType) && mock.tokenForm.grant_type === 'client_credentials' && mock.tokenForm.client_id === 'test-id');
    await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: cached for 15 s per slug', mock.hits.channels === c0 + 1);
    clock.advance(16000);
    await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: refetched after 15 s, reusing the cached token', mock.hits.channels === c0 + 2 && mock.hits.token === t0 + 1);
    clock.advance(3600 * 1000);
    await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: a new token is requested after the old one expires', mock.hits.token === t0 + 2);

    const ghost = await get(ep, '/subscribers?slug=ghost');
    const gj = JSON.parse(ghost.body);
    check('/subscribers: a channel with no data still answers 200 with nulls', ghost.status === 200 && gj.ok === true && gj.subs === null && gj.live === null);
    check('/subscribers: invalid slug gets 400', (await get(ep, '/subscribers?slug=Bad!')).status === 400 && (await get(ep, '/subscribers')).status === 400);

    mock.channelsMode = 'revoke-once';
    const tk = mock.hits.token;
    clock.advance(16000);
    const rv = await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: a 401 clears the token and retries once with a fresh one', rv.status === 200 && mock.hits.token === tk + 1, `status=${rv.status} tokens=${mock.hits.token - tk}`);

    mock.channelsMode = 'rate';
    mock.retryAfter = '9';
    clock.advance(16000);
    const rate = await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: upstream 429 gives 429 {error:"rate"} with Retry-After', rate.status === 429 && JSON.parse(rate.body).error === 'rate' && rate.headers['retry-after'] === '9', `ra=${rate.headers['retry-after']}`);
    mock.channelsMode = '500';
    const up = await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: upstream 5xx gives 502 {error:"upstream"}', up.status === 502 && JSON.parse(up.body).error === 'upstream');
    mock.channelsMode = 'ok';
    r.stop();
  }
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    const x = await get(ep, '/subscribers?slug=iacbi');
    check('/subscribers: no credentials gives 503 {error:"no-credentials"}', x.status === 503 && JSON.parse(x.body).error === 'no-credentials');
    r.stop();
    const r2 = createRelay(baseOpts({ credentials: { id: 'test-id', secret: 'WRONG' } }));
    const { eventsPort: ep2 } = await r2.start();
    const y = await get(ep2, '/subscribers?slug=iacbi');
    check('/subscribers: rejected credentials give 401 {error:"auth"}', y.status === 401 && JSON.parse(y.body).error === 'auth');
    r2.stop();
  }

  // ======================================================================================
  console.log('\n== relay: broadcaster safety');
  {
    const ts2 = String(Math.floor(Date.now() / 1000));
    const sendChat = (port, id, bid) => { const b = chatBody(id, 'hi ' + id, bid); return post(port, { id, ts: ts2, body: b, sig: sign(id, ts2, b, privateKey) }); };

    const r = createRelay(baseOpts({ broadcasterUserId: '', credentials: { id: 'test-id', secret: 'test-secret' }, channelSlug: 'iacbi' }));
    const ports = await r.start();
    const st = openSse(ports.eventsPort);
    await sleep(100);
    check('broadcaster id is resolved at startup from the channel slug', ports.chat === true && JSON.parse((await get(ports.eventsPort, '/health')).body).features.chat === true);
    await sendChat(ports.webhookPort, 'bs-1', 4242);
    await sendChat(ports.webhookPort, 'bs-2', 999);
    await sleep(120);
    check('resolved broadcaster: its events are shown, other channels are not', st.frames.some((f) => f.data.id === 'bs-1') && !st.frames.some((f) => f.data.id === 'bs-2'));
    st.close(); r.stop();

    const lg2 = quietLogger();
    const r2 = createRelay(baseOpts({ broadcasterUserId: '', logger: lg2 }));
    const p2 = await r2.start();
    const st2 = openSse(p2.eventsPort);
    await sleep(100);
    const h2 = JSON.parse((await get(p2.eventsPort, '/health')).body);
    check('unresolved broadcaster: /health reports chat false, other features still on', h2.features.chat === false && h2.features.channel === true && p2.chat === false);
    const d = await sendChat(p2.webhookPort, 'bs-3', 4242);
    await sleep(120);
    check('unresolved broadcaster: the event is acknowledged (200) but dropped', d.status === 200 && st2.frames.length === 0);
    check('unresolved broadcaster: a clear warning is logged', lg2.warns.some((w) => /dropped/.test(w) && /RELAY_BROADCASTER_ID/.test(w) && /RELAY_ALLOW_ANY_BROADCASTER/.test(w)), lg2.warns.join(' | ').slice(0, 120));
    check('unresolved broadcaster: /channel still works', (await get(p2.eventsPort, '/channel?slug=iacbi')).status === 200);
    st2.close(); r2.stop();

    const r3 = createRelay(baseOpts({ broadcasterUserId: '', credentials: { id: 'test-id', secret: 'test-secret' }, channelSlug: 'ghost' }));
    const p3 = await r3.start();
    check('an unknown channel leaves chat unresolved (no crash)', p3.chat === false);
    r3.stop();

    const r4 = createRelay(baseOpts({ broadcasterUserId: '', allowAnyBroadcaster: true }));
    const p4 = await r4.start();
    const st4 = openSse(p4.eventsPort);
    await sleep(100);
    await sendChat(p4.webhookPort, 'bs-4', 31337);
    await sleep(120);
    check('RELAY_ALLOW_ANY_BROADCASTER accepts any channel and /health chat is true', st4.frames.some((f) => f.data.id === 'bs-4') && JSON.parse((await get(p4.eventsPort, '/health')).body).features.chat === true);
    st4.close(); r4.stop();
  }

  // ======================================================================================
  console.log('\n== relay: webhook hardening');
  {
    const clock = mkClock();
    const lg = quietLogger();
    const r = createRelay(baseOpts({ broadcasterUserId: '113812015', logger: lg, now: clock.now }));
    const { webhookPort: wp, eventsPort: ep } = await r.start();
    const st = openSse(ep);
    await sleep(100);
    const t = String(Math.floor(clock.now() / 1000));
    check('webhook server timeouts and header limit are set', r.webhook.requestTimeout === 10000 && r.webhook.headersTimeout === 8000 && r.webhook.keepAliveTimeout === 5000 && r.webhook.maxHeadersCount === 50);

    const bodyU = chatBody('u-1', 'bad ts');
    const un = await post(wp, { id: 'u-1', ts: 'soon', body: bodyU, sig: sign('u-1', 'soon', bodyU, privateKey) });
    check('a validly signed event with an unparseable timestamp is rejected (401)', un.status === 401, `status=${un.status}`);

    const mismatch = JSON.stringify({ broadcaster: { user_id: 113812015 }, banned_user: { user_id: 5, username: 'zed' } });
    const mm = await post(wp, { id: 'sh-1', ts: t, body: mismatch, sig: sign('sh-1', t, mismatch, privateKey), type: 'chat.message.sent' });
    const chat2 = chatBody('sh-2', 'x');
    const mm2 = await post(wp, { id: 'sh-2', ts: t, body: chat2, sig: sign('sh-2', t, chat2, privateKey), type: 'moderation.banned' });
    await sleep(100);
    check('an event whose body does not match its type is acknowledged but not shown', mm.status === 200 && mm2.status === 200 && st.frames.length === 0);

    const over = 'x'.repeat(70 * 1024);
    const declared = await post(wp, { id: 'o-1', ts: t, body: over, sig: 'AAAA' });
    check('oversize body: refused up front from Content-Length (413)', declared.status === 413, `status=${declared.status}`);
    const chunked = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port: wp, path: '/kick/webhook', method: 'POST', headers: { 'Kick-Event-Message-Id': 'o-2' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', () => resolve('error'));
      req.write('y'.repeat(40 * 1024)); req.write('y'.repeat(40 * 1024)); req.end();
    });
    check('oversize body without Content-Length (chunked) is cut off with 413', chunked === 413, `status=${chunked}`);
    const okBody = chatBody('ok-after', 'still alive');
    const fine = await post(wp, { id: 'ok-after', ts: t, body: okBody, sig: sign('ok-after', t, okBody, privateKey) });
    check('the webhook still works after refused uploads', fine.status === 200);

    let destroyed = false;
    const slow = { writableLength: 2 * 1024 * 1024, write() { return false; }, destroy() { destroyed = true; }, end() {} };
    const healthy = { writableLength: 0, got: 0, write() { this.got++; return true; }, destroy() {}, end() {} };
    r.clients.add(slow); r.clients.add(healthy);
    r.broadcast({ kind: 'chat', id: 'bp' });
    check('SSE: a client over 1 MB behind is destroyed and removed', destroyed && !r.clients.has(slow));
    check('SSE: other clients still get the event', healthy.got === 1 && r.clients.has(healthy));
    const thrower = { writableLength: 0, write() { throw new Error('boom'); }, destroy() {}, end() {} };
    r.clients.add(thrower);
    r.broadcast({ kind: 'chat', id: 'bp2' });
    check('SSE: a client whose write throws is removed without breaking the others', !r.clients.has(thrower) && healthy.got === 2);
    r.clients.delete(healthy);

    const before = JSON.parse((await get(ep, '/health')).body).clients;
    st.close();
    await sleep(150);
    check('SSE: a disconnected client is removed', before >= 1 && JSON.parse((await get(ep, '/health')).body).clients === 0);

    let boom = true;
    const fl = createRelay(baseOpts({ logger: lg, now: () => { if (boom) throw new Error('clock exploded'); return Date.now(); } }));
    const fp = await fl.start();
    const w500 = await post(fp.webhookPort, { id: 'e-1', ts: t, body: '{}', sig: 'AAAA' });
    check('a webhook handler error answers 500 JSON', w500.status === 500 && JSON.parse(w500.body).error === 'internal', `status=${w500.status}`);
    const e500 = await get(fp.eventsPort, '/channel?slug=abc');
    check('an events handler error answers 500 JSON', e500.status === 500 && JSON.parse(e500.body).ok === false && /json/.test(e500.headers['content-type']), `status=${e500.status}`);
    check('handler errors are logged', lg.errors.length >= 2);
    boom = false;
    check('the relay keeps serving after a handler error', (await get(fp.eventsPort, '/health')).status === 200);
    fl.stop();
    r.stop();
  }
  {
    const r = createRelay(baseOpts({ webhookRate: { perSec: 1, burst: 3 } }));
    const { webhookPort: wp } = await r.start();
    const codes = [];
    let retry = null;
    for (let i = 0; i < 7; i++) {
      const x = await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: wp, path: '/kick/webhook', method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, ra: res.headers['retry-after'] })); });
        req.end('{}');
      });
      codes.push(x.status);
      if (x.status === 429) retry = x.ra;
    }
    check('webhook rate limit: the burst passes, then 429 with Retry-After', codes.slice(0, 3).every((c) => c === 401) && codes.slice(4).every((c) => c === 429) && retry === '1', codes.join());
    r.stop();
  }
  {
    const clock = mkClock();
    mock.keyMode = 'ok'; mock.keyPem = publicKey;
    const hits0 = mock.hits.key;
    const r = createRelay(baseOpts({ publicKeyPem: null, broadcasterUserId: '113812015', now: clock.now }));
    const { webhookPort: wp } = await r.start();
    const t = String(Math.floor(clock.now() / 1000));
    mock.delayMs = 100;
    const batch = await Promise.all([1, 2, 3, 4, 5].map((i) => { const id = 'k-' + i, b = chatBody(id, 'k'); return post(wp, { id, ts: t, body: b, sig: sign(id, t, b, privateKey) }); }));
    mock.delayMs = 0;
    check('public key: concurrent first requests share one key fetch', batch.every((x) => x.status === 200) && mock.hits.key === hits0 + 1, `fetches=${mock.hits.key - hits0}`);

    clock.advance(61000);
    const t2 = String(Math.floor(clock.now() / 1000));
    const forged = chatBody('k-forged', 'f');
    const k1 = mock.hits.key;
    const fr = await post(wp, { id: 'k-forged', ts: t2, body: forged, sig: sign('k-forged', t2, forged, otherKey.privateKey) });
    check('bad signature with an unchanged key: refetched once, still 401', fr.status === 401 && mock.hits.key === k1 + 1);

    clock.advance(61000);
    const t3 = String(Math.floor(clock.now() / 1000));
    mock.keyPem = otherKey.publicKey;
    const rotated = chatBody('k-rot', 'new key');
    const rr = await post(wp, { id: 'k-rot', ts: t3, body: rotated, sig: sign('k-rot', t3, rotated, otherKey.privateKey) });
    check('key rotation: a bad signature triggers a refetch and passes with the new key', rr.status === 200, `status=${rr.status}`);
    r.stop();

    mock.keyMode = 'fail';
    const r2 = createRelay(baseOpts({ publicKeyPem: null, now: clock.now }));
    const { webhookPort: wp2 } = await r2.start();
    const f0 = mock.hits.key;
    const t4 = String(Math.floor(clock.now() / 1000));
    const x1 = await post(wp2, { id: 'f-1', ts: t4, body: '{}', sig: 'AAAA' });
    const x2 = await post(wp2, { id: 'f-2', ts: t4, body: '{}', sig: 'AAAA' });
    check('public key: a failed fetch answers 503 and is not retried for 30 s', x1.status === 503 && x2.status === 503 && mock.hits.key === f0 + 1, `fetches=${mock.hits.key - f0}`);
    clock.advance(31000);
    const t5 = String(Math.floor(clock.now() / 1000));
    mock.keyMode = 'ok'; mock.keyPem = publicKey;
    const b5 = chatBody('f-3', 'back');
    const x3 = await post(wp2, { id: 'f-3', ts: t5, body: b5, sig: sign('f-3', t5, b5, privateKey) });
    check('public key: after 30 s the fetch is tried again and recovers', x3.status === 200 && mock.hits.key === f0 + 2);
    r2.stop();
  }
  mock.close();

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('relay tests aborted:', e); process.exit(2); });
