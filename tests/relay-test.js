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

function get(port, p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method }, (res) => {
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
    check('isFresh does not reject an unreadable timestamp', W.isFresh('soon', now));
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
  const relay = createRelay({ publicKeyPem: publicKey, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015' });
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
  const health = await get(eventsPort, '/health');
  check('events port: health reports the connected overlay', health.status === 200 && /"clients":1/.test(health.body), health.body);
  check('events port: responses allow the overlay page to read them (CORS)', health.headers['access-control-allow-origin'] === '*');

  stream.close();
  relay.stop();

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('relay tests aborted:', e); process.exit(2); });
