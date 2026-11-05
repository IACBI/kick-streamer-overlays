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
const PKG_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

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
const ACCESS_KEY = 'test-key-0123456789abcdef0123456789abcdef';
const withKey = (p, key = ACCESS_KEY) => p + (p.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key);

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

const fixture = (name) => JSON.parse(require('fs').readFileSync(path.join(__dirname, 'fixtures', `webhook-${name}.json`), 'utf8'));

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
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Opens the overlay event stream and collects "event:" frames.
function openSse(port) {
  const frames = [];
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port, path: withKey('/events') }, (res) => {
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

function get(port, p, method = 'GET', headers, body) {
  return new Promise((resolve, reject) => {
    const h = {};
    for (const [k, v] of Object.entries(headers || {})) if (v !== undefined) h[k] = v;
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
// Events-port requests carry the access key; `get` alone is used for keyless probes.
const eget = (port, p, method, headers) => get(port, withKey(p), method, headers);

// Status only: for streams that would never end, so the body is not read.
function statusOf(port, p, headers) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', () => resolve(0));
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
    check('normalizeEvent ignores event types the overlays do not show', W.normalizeEvent('channel.reward.redemption.updated', { broadcaster: { user_id: 1 }, status: 'accepted' }) === null);
    check('normalizeEvent rejects a follow without a follower', W.normalizeEvent('channel.followed', {}) === null);
    check('normalizeEvent caps very long text', W.normalizeEvent('chat.message.sent', { content: 'x'.repeat(5000), sender: {} }).message.length === 500);
  }
  {
    const eqJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const follow = W.normalizeEvent('channel.followed', fixture('channel-followed'));
    check('alerts: a documented follow maps to kind follow', eqJson(follow, { kind: 'follow', broadcasterId: '123456789', userId: '987654321', username: 'follower_name' }), JSON.stringify(follow));
    const sub = W.normalizeEvent('channel.subscription.new', fixture('subscription-new'));
    check('alerts: a new subscription carries its months and is not a renewal', sub.kind === 'sub' && sub.months === 1 && sub.renewal === false && sub.username === 'subscriber_name' && sub.createdAt === '2025-01-14T16:08:06Z', JSON.stringify(sub));
    const ren = W.normalizeEvent('channel.subscription.renewal', fixture('subscription-renewal'));
    check('alerts: a renewal is flagged and keeps its month count', ren.kind === 'sub' && ren.renewal === true && ren.months === 3);
    const odd = W.normalizeEvent('channel.subscription.new', Object.assign(fixture('subscription-new'), { duration: 'soon' }));
    const strMonths = W.normalizeEvent('channel.subscription.new', Object.assign(fixture('subscription-new'), { duration: '6' }));
    check('alerts: an unreadable duration still alerts, as month 1; a numeric string is read', odd.months === 1 && strMonths.months === 6);
    const gift = W.normalizeEvent('channel.subscription.gifts', fixture('subscription-gifts'));
    check('alerts: a gift names the gifter and counts the giftees', gift.kind === 'gift' && gift.anonymous === false && gift.username === 'gifter_name' && gift.count === 1 && eqJson(gift.giftees, ['giftee_name']), JSON.stringify(gift));
    const anon = W.normalizeEvent('channel.subscription.gifts', fixture('subscription-gifts-anonymous'));
    check('alerts: an anonymous gift has no name or user id, and still counts', anon.anonymous === true && anon.username === '' && anon.userId === '' && anon.count === 2, JSON.stringify(anon));
    const bigGift = Object.assign(fixture('subscription-gifts'), { giftees: Array.from({ length: 50 }, (_, i) => ({ user_id: i, username: 'g' + i })) });
    const big = W.normalizeEvent('channel.subscription.gifts', bigGift);
    check('alerts: a 50-sub gift counts all 50 but lists only 10 names', big.count === 50 && big.giftees.length === 10);
    check('alerts: a gift without giftees is rejected', W.normalizeEvent('channel.subscription.gifts', Object.assign(fixture('subscription-gifts'), { giftees: [] })) === null);
    const kicks = W.normalizeEvent('kicks.gifted', fixture('kicks-gifted'));
    check('alerts: Kicks carry the amount, gift name and message', eqJson(kicks, { kind: 'kicks', broadcasterId: '123456789', userId: '987654321', username: 'gift_sender', amount: 500, giftName: 'Rage Quit', message: 'w', createdAt: '2025-10-20T04:00:08.634Z' }), JSON.stringify(kicks));
    const kf = fixture('kicks-gifted');
    check('alerts: Kicks with a zero, negative, fractional or missing amount are rejected',
      [0, -5, 1.5, 'lots', undefined].every((amount) => W.normalizeEvent('kicks.gifted', Object.assign({}, kf, { gift: Object.assign({}, kf.gift, { amount }) })) === null));
    const longMsg = W.normalizeEvent('kicks.gifted', Object.assign({}, kf, { gift: Object.assign({}, kf.gift, { message: 'y'.repeat(900), name: 'n'.repeat(90) }) }));
    check('alerts: a long Kicks message and gift name are capped', longMsg.message.length === 200 && longMsg.giftName.length === 40);
    const rf = fixture('reward-redemption');
    const reward = W.normalizeEvent('channel.reward.redemption.updated', rf);
    check('rewards: a pending redemption carries the reward, cost, input and redemption id', eqJson(reward, { kind: 'reward', redemptionId: '01KBHE78QE4HZY1617DK5FC7YD', broadcasterId: '333', userId: '123', username: 'redeemer_name', title: 'Pick the next game', cost: 500, message: 'Play Valorant next', createdAt: '2025-12-02T22:54:19.323Z' }), JSON.stringify(reward));
    check('rewards: accepted is shown, rejected and unknown statuses are not',
      W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { status: 'accepted' })) !== null &&
      ['rejected', 'canceled', undefined].every((status) => W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { status })) === null));
    check('rewards: a missing redeemer, reward title or redemption id is rejected',
      W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { redeemer: null })) === null &&
      W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { reward: { cost: 5 } })) === null &&
      W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { id: '' })) === null);
    const longReward = W.normalizeEvent('channel.reward.redemption.updated', Object.assign({}, rf, { user_input: 'z'.repeat(900), reward: Object.assign({}, rf.reward, { title: 't'.repeat(90), cost: -3 }) }));
    check('rewards: long text is capped and a bad cost becomes 0', longReward.message.length === 200 && longReward.title.length === 60 && longReward.cost === 0);
    check('alerts: a payload under the wrong type is rejected',
      W.normalizeEvent('channel.followed', fixture('subscription-new')) === null &&
      W.normalizeEvent('channel.subscription.new', fixture('channel-followed')) === null &&
      W.normalizeEvent('kicks.gifted', fixture('channel-followed')) === null);
    check('alerts: a non-object user or broadcaster is rejected',
      W.normalizeEvent('channel.followed', { follower: 'bob' }) === null &&
      W.normalizeEvent('channel.followed', Object.assign(fixture('channel-followed'), { broadcaster: 5 })) === null &&
      W.normalizeEvent('channel.followed', { follower: { username: '   ' } }) === null);
    check('EVENT_TYPES lists chat, bans, the six alert events and the two stream events, each once', W.EVENT_TYPES.length === 10 && new Set(W.EVENT_TYPES).size === 10 && W.EVENT_TYPES.includes('kicks.gifted') && W.EVENT_TYPES.includes('channel.reward.redemption.updated') && W.EVENT_TYPES.includes('livestream.status.updated') && W.EVENT_TYPES.includes('livestream.metadata.updated'));

    const { subscribedEvents, subscriptionBody, EVENTS } = require(path.join(__dirname, '..', 'relay', 'subscribe.js'));
    const subBody = subscriptionBody([{ name: 'chat.message.sent', version: 1 }], '113812015');
    check('subscribe: broadcaster_user_id is sent as a number (Kick answers 400 to a string)', subBody.broadcaster_user_id === 113812015 && subBody.method === 'webhook' && subBody.events.length === 1);
    const have = subscribedEvents({ data: [{ event: 'chat.message.sent', version: 1 }, { event: 'kicks.gifted' }, null, { id: 'x' }] });
    check('subscribe: existing subscriptions are read by event name, junk entries skipped', have.size === 2 && have.has('chat.message.sent') && have.has('kicks.gifted'));
    check('subscribe: an empty or odd list response means nothing is subscribed', subscribedEvents(null).size === 0 && subscribedEvents({ data: 'x' }).size === 0);
    check('subscribe: requests every relay event at version 1', EVENTS.length === W.EVENT_TYPES.length && EVENTS.every((e) => e.version === 1));

    const started = W.normalizeEvent('livestream.status.updated', fixture('livestream-status-started'));
    check('stream: a documented start maps to kind live with its title and start time', eqJson(started, { kind: 'live', broadcasterId: '123456789', live: true, title: 'Stream Title', startedAt: '2025-01-01T11:00:00+11:00', endedAt: '' }), JSON.stringify(started));
    const ended = W.normalizeEvent('livestream.status.updated', fixture('livestream-status-ended'));
    check('stream: a documented end maps to live false with its end time', ended.kind === 'live' && ended.live === false && ended.endedAt === '2025-01-01T15:00:00+11:00', JSON.stringify(ended));
    check('stream: a status without a boolean is_live is rejected',
      W.normalizeEvent('livestream.status.updated', Object.assign(fixture('livestream-status-started'), { is_live: 'true' })) === null
      && W.normalizeEvent('livestream.status.updated', { broadcaster: { user_id: 1 } }) === null);
    const meta = W.normalizeEvent('livestream.metadata.updated', fixture('livestream-metadata'));
    check('stream: a documented metadata update maps to kind meta with the title', eqJson(meta, { kind: 'meta', broadcasterId: '123456789', title: 'Stream Title' }), JSON.stringify(meta));
    check('stream: metadata without a string title is rejected',
      W.normalizeEvent('livestream.metadata.updated', { broadcaster: { user_id: 1 }, metadata: {} }) === null
      && W.normalizeEvent('livestream.metadata.updated', { broadcaster: { user_id: 1 } }) === null);
    const longTitle = W.normalizeEvent('livestream.metadata.updated', { broadcaster: { user_id: 1 }, metadata: { title: '  ' + 't'.repeat(500) + '  ' } });
    check('stream: a long title is trimmed and capped at 140 characters', longTitle.title.length === 140 && longTitle.title[0] === 't');
    check('stream: a status body under the metadata type, and the reverse, are rejected',
      W.normalizeEvent('livestream.metadata.updated', fixture('livestream-status-started')) === null
      && W.normalizeEvent('livestream.status.updated', fixture('livestream-metadata')) === null);
  }

  console.log('\n== relay: webhook listener (real sockets)');
  const relay = createRelay({ publicKeyPem: publicKey, accessKey: ACCESS_KEY, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015', credentials: false, channelSlug: '', logger: quietLogger() });
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
  const unk = await post(webhookPort, { id: 'x-1', ts, body: unknown, sig: sign('x-1', ts, unknown, privateKey), type: 'channel.poll.started' });
  await sleep(100);
  check('an event type the overlays do not show is acknowledged and not streamed', unk.status === 200 && !stream.frames.some((f) => f.data.id === 'x-1'));

  // Alerts: the documented payloads, signed like Kick signs them, reach the stream with the delivery id as their id.
  const before = Date.now();
  for (const [file, type, id] of [
    ['channel-followed', 'channel.followed', 'al-follow'],
    ['subscription-new', 'channel.subscription.new', 'al-sub'],
    ['subscription-gifts', 'channel.subscription.gifts', 'al-gift'],
    ['kicks-gifted', 'kicks.gifted', 'al-kicks']
  ]) {
    const b = JSON.stringify(Object.assign(fixture(file), { broadcaster: Object.assign(fixture(file).broadcaster, { user_id: 113812015 }) }));
    const r = await post(webhookPort, { id, ts, body: b, sig: sign(id, ts, b, privateKey), type });
    check(`signed ${type} is accepted (200)`, r.status === 200, `status=${r.status}`);
  }
  await sleep(150);
  const alertFrames = stream.frames.filter((f) => /^al-/.test(f.data.id));
  check('each alert reaches the stream once, under its own event name', alertFrames.map((f) => f.event + ':' + f.data.id).join() === 'follow:al-follow,sub:al-sub,gift:al-gift,kicks:al-kicks', alertFrames.map((f) => f.event + ':' + f.data.id).join());
  const fol = alertFrames.find((f) => f.event === 'follow');
  check('the follow alert carries the follower name', !!fol && fol.data.username === 'follower_name' && fol.data.kind === 'follow');
  const redo = JSON.stringify(Object.assign(fixture('channel-followed'), { broadcaster: { user_id: 113812015 } }));
  await post(webhookPort, { id: 'al-follow', ts, body: redo, sig: sign('al-follow', ts, redo, privateKey), type: 'channel.followed' });
  await sleep(100);
  check('a redelivered alert is shown once', stream.frames.filter((f) => f.data.id === 'al-follow').length === 1);
  const otherFollow = JSON.stringify(fixture('channel-followed'));   // broadcaster 123456789: not this channel
  await post(webhookPort, { id: 'al-other', ts, body: otherFollow, sig: sign('al-other', ts, otherFollow, privateKey), type: 'channel.followed' });
  await sleep(100);
  check('an alert for another broadcaster is not shown', !stream.frames.some((f) => f.data.id === 'al-other'));

  // Rewards: Kick sends the redemption again when it is accepted; the overlay must see one alert, not two.
  for (const [id, status] of [['rw-1', 'pending'], ['rw-2', 'accepted'], ['rw-3', 'rejected']]) {
    const b = JSON.stringify(Object.assign(fixture('reward-redemption'), { status, broadcaster: { user_id: 113812015 } }));
    await post(webhookPort, { id, ts, body: b, sig: sign(id, ts, b, privateKey), type: 'channel.reward.redemption.updated' });
  }
  await sleep(150);
  const rw = stream.frames.filter((f) => f.event === 'reward');
  check('a reward redemption streams under one id for pending and accepted; rejected is not streamed',
    rw.length === 2 && rw.every((f) => f.data.id === 'reward-01KBHE78QE4HZY1617DK5FC7YD') && rw[0].data.title === 'Pick the next game', JSON.stringify(rw.map((f) => f.data.id)));

  // Stream events: a signed start and a title change reach the stream as live and meta frames.
  for (const [file, type, id] of [
    ['livestream-status-started', 'livestream.status.updated', 'st-live'],
    ['livestream-metadata', 'livestream.metadata.updated', 'st-meta']
  ]) {
    const b = JSON.stringify(Object.assign(fixture(file), { broadcaster: Object.assign(fixture(file).broadcaster, { user_id: 113812015 }) }));
    await post(webhookPort, { id, ts, body: b, sig: sign(id, ts, b, privateKey), type });
  }
  await sleep(150);
  const liveFrame = stream.frames.find((f) => f.event === 'live');
  const metaFrame = stream.frames.find((f) => f.event === 'meta');
  check('a signed stream start reaches the overlay stream as a live frame', !!liveFrame && liveFrame.data.live === true && liveFrame.data.startedAt === '2025-01-01T11:00:00+11:00', JSON.stringify(liveFrame && liveFrame.data));
  check('a signed title change reaches the overlay stream as a meta frame', !!metaFrame && metaFrame.data.title === 'Stream Title');
  const hAfter = JSON.parse((await eget(eventsPort, '/health')).body);
  check('/health reports when the last verified event arrived, and alerts are ready', typeof hAfter.lastEventAt === 'number' && hAfter.lastEventAt >= before && hAfter.features.alerts === true, JSON.stringify(hAfter));

  const badJson = 'not json';
  const bj = await post(webhookPort, { id: 'j-1', ts, body: badJson, sig: sign('j-1', ts, badJson, privateKey) });
  check('a validly signed body that is not JSON gets 400', bj.status === 400, `status=${bj.status}`);

  const big = 'x'.repeat(70 * 1024);
  const huge = await post(webhookPort, { id: 'big-1', ts, body: big, sig: sign('big-1', ts, big, privateKey) });
  check('a body over 64 KB is refused', huge.status === 413, `status=${huge.status}`);

  check('webhook port: GET is refused (405)', (await get(webhookPort, '/kick/webhook')).status === 405);
  check('webhook port: any other path is not found (404)', (await get(webhookPort, '/events')).status === 404);
  check('events port: unknown paths are not found (404)', (await eget(eventsPort, '/kick/webhook')).status === 404);
  check('events port: POST is refused (405)', (await eget(eventsPort, '/events', 'POST')).status === 405);
  check('events port: a foreign Host header is refused (403, DNS rebinding)', (await eget(eventsPort, '/health', 'GET', { Host: 'evil.example' })).status === 403);
  const health = await eget(eventsPort, '/health');
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
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-relay-cfg-'));
    fs.writeFileSync(path.join(tmp, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = { kanal: "FromFile" };');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.local.js'), 'window.KICK_OVERLAY_YEREL = { kickClientId: "fid", kickClientSecret: "fsecret" };');
    const fromFiles = CFG.loadConfig({ root: tmp, env: {} });
    const fromEnv = CFG.loadConfig({ root: tmp, env: { KICK_CLIENT_ID: 'eid', KICK_CLIENT_SECRET: 'esecret', KICK_CHANNEL: 'EnvChan' } });
    check('loadConfig reads the settings files', fromFiles.slug === 'fromfile' && fromFiles.credentials && fromFiles.credentials.id === 'fid');
    check('loadConfig prefers the environment', fromEnv.slug === 'envchan' && fromEnv.credentials.id === 'eid');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = { channel: "EnglishName" };');
    check('loadConfig accepts the English "channel" name', CFG.loadConfig({ root: tmp, env: {} }).slug === 'englishname');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = { kanal: "Turkish", channel: "English" };');
    check('loadConfig: kanal wins over channel', CFG.loadConfig({ root: tmp, env: {} }).slug === 'turkish');
    fs.writeFileSync(path.join(tmp, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = { kanal: "FromFile" };');
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
      v2: { status: 200, headers: {} }, v1: { status: 200, headers: {} }, delayMs: 0,
      subs: [], subPosts: []
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
      if (u.pathname === '/public/v1/events/subscriptions') {
        const tok = /^Bearer (.+)$/.exec(req.headers.authorization || '');
        if (!tok || !m.valid.has(tok[1])) return reply(401, { error: 'unauthorized' });
        if (req.method === 'GET') return reply(200, { data: m.subs.map((e, i) => ({ id: 'sub-' + i, event: e })) });
        const b = JSON.parse(raw);
        m.subPosts.push(b);
        b.events.forEach((e) => m.subs.push(e.name));
        return reply(200, { data: b.events.map((e, i) => ({ name: e.name, subscription_id: 'new-' + i })) });
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
  const baseOpts = (extra) => Object.assign({ webhookPort: 0, eventsPort: 0, publicKeyPem: publicKey, accessKey: ACCESS_KEY, broadcasterUserId: '1', credentials: false, channelSlug: '', logger: quietLogger() }, mockOpts, extra || {});

  // ======================================================================================
  console.log('\n== relay: events listener, CORS and /health');
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    const allowed = ['null', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://[::1]:8080', 'https://localhost'];
    for (const origin of allowed) {
      const res = await eget(ep, '/health', 'GET', { Origin: origin });
      check(`CORS: origin ${origin} is allowed and echoed`, res.status === 200 && res.headers['access-control-allow-origin'] === origin && /origin/i.test(res.headers.vary || ''), `status=${res.status} acao=${res.headers['access-control-allow-origin']}`);
    }
    const none = await eget(ep, '/health');
    check('CORS: no Origin header is allowed, no ACAO sent, Vary: Origin present', none.status === 200 && none.headers['access-control-allow-origin'] === undefined && /origin/i.test(none.headers.vary || ''));
    const denied = ['http://evil.example', 'https://kick.com', 'http://localhost.evil.example', 'http://127.0.0.1.evil.com', 'file://', 'ftp://localhost', 'not a url'];
    for (const origin of denied) {
      const res = await eget(ep, '/health', 'GET', { Origin: origin });
      check(`CORS: origin ${origin} is refused (403) without ACAO`, res.status === 403 && res.headers['access-control-allow-origin'] === undefined, `status=${res.status}`);
    }
    const deniedChannel = await eget(ep, '/channel?slug=abc', 'GET', { Origin: 'http://evil.example' });
    check('CORS: a refused origin cannot reach /channel either', deniedChannel.status === 403);
    check('CORS: readable response headers are exposed', /X-Kick-Source/i.test((await eget(ep, '/health', 'GET', { Origin: 'null' })).headers['access-control-expose-headers'] || ''));

    const pre = await eget(ep, '/channel?slug=abc', 'OPTIONS', { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' });
    check('OPTIONS preflight from an allowed origin answers 204 with allow headers', pre.status === 204 && pre.headers['access-control-allow-origin'] === 'http://localhost:5173' && /GET/.test(pre.headers['access-control-allow-methods'] || '') && pre.body === '', `status=${pre.status}`);
    const preBad = await eget(ep, '/channel?slug=abc', 'OPTIONS', { Origin: 'http://evil.example' });
    check('OPTIONS preflight from a foreign origin is refused (403)', preBad.status === 403);
    const preHost = await eget(ep, '/health', 'OPTIONS', { Host: 'evil.example' });
    check('OPTIONS with a foreign Host is refused (403)', preHost.status === 403);
    const put = await eget(ep, '/health', 'PUT');
    check('PUT is refused (405) with an Allow header', put.status === 405 && /GET/.test(put.headers.allow || ''));

    const h = JSON.parse((await eget(ep, '/health')).body);
    check('/health has the documented shape and the package.json version', h.ok === true && h.version === PKG_VERSION && h.clients === 0 && h.features && typeof h.features.chat === 'boolean' && h.features.channel === true && typeof h.features.subscribers === 'boolean', JSON.stringify(h));
    check('/health: chat true with a broadcaster id, subscribers false without credentials', h.features.chat === true && h.features.subscribers === false);
    check('/health ignores a query string', (await eget(ep, '/health?x=1')).status === 200);
    check('/events with a CORS origin still streams (SSE)', await new Promise((resolve) => {
      const q = http.get({ host: '127.0.0.1', port: ep, path: withKey('/events'), headers: { Origin: 'null' } }, (res) => { resolve(res.statusCode === 200 && /event-stream/.test(res.headers['content-type']) && res.headers['access-control-allow-origin'] === 'null'); q.destroy(); });
      q.on('error', () => {});
    }));
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: /test-alert');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const st = openSse(ep);
    await sleep(100);
    check('/test-alert: GET is refused (405, POST only)', (await eget(ep, '/test-alert?kind=follow')).status === 405);
    check('/test-alert: POST without the key gets 401', (await get(ep, '/test-alert?kind=follow', 'POST', { Origin: 'null' })).status === 401);
    check('/test-alert: a foreign origin is refused (403)', (await eget(ep, '/test-alert?kind=follow', 'POST', { Origin: 'http://evil.example' })).status === 403);
    check('/test-alert: an unknown kind gets 400', (await eget(ep, '/test-alert?kind=chat', 'POST')).status === 400);
    check('POST to a read-only route is refused (405)', (await eget(ep, '/health', 'POST')).status === 405);
    const ok = await eget(ep, '/test-alert?kind=gift&username=Evil', 'POST', { Origin: 'null' });
    check('/test-alert: POST from the studio (Origin null) with the key is accepted', ok.status === 200 && JSON.parse(ok.body).clients === 1 && ok.headers['access-control-allow-origin'] === 'null', ok.body);
    check('/test-alert: a second request within the gap gets 429', (await eget(ep, '/test-alert?kind=sub', 'POST')).status === 429);
    clock.advance(2000);
    check('/test-alert: allowed again after the gap', (await eget(ep, '/test-alert?kind=kicks', 'POST')).status === 200);
    await sleep(100);
    const f = st.frames.filter((x) => x.data.test === true);
    check('/test-alert: fixed samples reach the stream; query text is never used', f.length === 2 && f[0].event === 'gift' && f[0].data.username === 'TestGifter' && f[1].event === 'kicks' && /^test-/.test(f[0].data.id) && f[0].data.id !== f[1].data.id, JSON.stringify(f));
    const pre = await eget(ep, '/test-alert?kind=follow', 'OPTIONS', { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' });
    check('/test-alert: preflight allows POST', pre.status === 204 && /POST/.test(pre.headers['access-control-allow-methods'] || ''));
    st.close();
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: --tunnel (cloudflared quick tunnel)');
  {
    const { EventEmitter } = require('events');
    const T = require(path.join(__dirname, '..', 'relay', 'tunnel.js'));
    check('tunnelUrlOf: finds the quick tunnel address in cloudflared output',
      T.tunnelUrlOf('2026-11-03T10:00:00Z INF |  https://teach-partition-agents-disc.trycloudflare.com  |') === 'https://teach-partition-agents-disc.trycloudflare.com' &&
      T.tunnelUrlOf('INF Requesting new quick Tunnel on trycloudflare.com...') === null &&
      T.tunnelUrlOf('see https://evil.example/x.trycloudflare.com.evil') === null &&
      T.tunnelUrlOf('http://plain.trycloudflare.com') === null);
    check('cloudflaredPath: RELAY_CLOUDFLARED wins, then the Windows install folder, then PATH',
      T.cloudflaredPath({ RELAY_CLOUDFLARED: 'D:/tools/cf.exe' }, { platform: 'win32', exists: () => true }) === 'D:/tools/cf.exe' &&
      T.cloudflaredPath({ 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }, { platform: 'win32', exists: (p) => p === 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe' }) === 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe' &&
      T.cloudflaredPath({ ProgramFiles: 'C:\\Program Files' }, { platform: 'win32', exists: () => false }) === 'cloudflared' &&
      T.cloudflaredPath({}, { platform: 'linux', exists: () => true }) === 'cloudflared');

    // A fake cloudflared: each spawn returns a process the test drives by hand.
    const procs = [], calls = [];
    const fakeSpawn = (bin, args, options) => {
      calls.push({ bin, args, options });
      const p = new EventEmitter();
      p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
      p.killed = false; p.kill = () => { p.killed = true; setImmediate(() => p.emit('exit', null)); };
      procs.push(p);
      return p;
    };
    const urls = [];
    const lg = quietLogger();
    const t = T.startTunnel({ port: 8788, bin: 'cloudflared', spawnImpl: fakeSpawn, logger: lg, onUrl: (u) => urls.push(u), restartMs: [20], startTimeoutMs: 200 });
    check('startTunnel: runs cloudflared with fixed arguments and no shell', calls.length === 1 && calls[0].bin === 'cloudflared' &&
      calls[0].args.join(' ') === 'tunnel --no-autoupdate --url http://127.0.0.1:8788' && calls[0].options.shell === false, JSON.stringify(calls[0]));
    procs[0].stderr.emit('data', Buffer.from('INF Requesting new quick Tunnel...\nINF |  https://first-one.trycloudflare'));
    procs[0].stderr.emit('data', Buffer.from('.com  |\n'));
    check('startTunnel: reports the address, even when a line arrives in pieces', t.url() === 'https://first-one.trycloudflare.com' && urls.join() === 'https://first-one.trycloudflare.com', JSON.stringify(urls));
    procs[0].emit('exit', 1);
    await sleep(60);
    procs[1].stdout.emit('data', Buffer.from('|  https://second-one.trycloudflare.com  |\n'));
    check('startTunnel: restarts after an exit and announces the new address', procs.length === 2 && urls.join() === 'https://first-one.trycloudflare.com,,https://second-one.trycloudflare.com', JSON.stringify(urls));
    t.stop();
    await sleep(60);
    check('startTunnel: stop kills cloudflared and does not restart it', procs[1].killed === true && procs.length === 2);

    const quiet = T.startTunnel({ port: 1, spawnImpl: fakeSpawn, logger: lg, restartMs: [10000], startTimeoutMs: 50 });
    await sleep(120);
    check('startTunnel: cloudflared that never reports an address is stopped after the timeout', procs[2].killed === true);
    quiet.stop();

    const errs = [];
    const missing = T.startTunnel({ port: 1, spawnImpl: () => { const p = fakeSpawn(); setImmediate(() => p.emit('error', Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }))); return p; },
      logger: { log() {}, warn() {}, error: (...a) => errs.push(a.join(' ')) }, restartMs: [10] });
    await sleep(60);
    check('startTunnel: a missing cloudflared is reported once and not retried', errs.length === 1 && /not found/.test(errs[0]) && procs.length === 4, JSON.stringify(errs));
    missing.stop();

    const r = createRelay(baseOpts({ logger: { log() {}, warn() {}, error() {} } }));
    const { eventsPort: ep } = await r.start();
    let h = JSON.parse((await eget(ep, '/health')).body);
    check('/health: no tunnel by default, and an empty error list', h.tunnel === null && Array.isArray(h.recentErrors) && h.recentErrors.length === 0, JSON.stringify(h));
    r.setTunnel('https://abc.trycloudflare.com');
    r.logger.warn('Tunnel stopped (exit 1); starting it again in 2 s.');
    for (let i = 0; i < 12; i++) r.logger.error('error', i);
    h = JSON.parse((await eget(ep, '/health')).body);
    check('/health: the webhook URL through the tunnel, and the last 10 warnings and errors', h.tunnel === 'https://abc.trycloudflare.com/kick/webhook' && h.recentErrors.length === 10 && h.recentErrors[9].msg === 'error 11' && h.recentErrors[0].level === 'error', JSON.stringify(h.recentErrors.slice(0, 2)));
    r.setTunnel('javascript:alert(1)');
    check('/health: only an https tunnel address is kept', JSON.parse((await eget(ep, '/health')).body).tunnel === null);
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: /control (OBS dock)');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const st = openSse(ep);
    await sleep(100);
    const ctl = async (action, headers) => { clock.advance(400); return eget(ep, '/control?action=' + action, 'POST', headers); };
    check('/control: GET is refused (405)', (await eget(ep, '/control?action=pause')).status === 405);
    check('/control: POST without the key gets 401', (await get(ep, '/control?action=pause', 'POST', { Origin: 'null' })).status === 401);
    check('/control: a foreign origin is refused (403)', (await ctl('pause', { Origin: 'http://evil.example' })).status === 403);
    check('/control: an unknown action gets 400', (await ctl('shutdown')).status === 400);
    check('/control: replay before any alert gets 409', (await ctl('replay')).status === 409);

    const p = await ctl('pause', { Origin: 'null' });
    check('/control: pause from the dock (Origin null) is accepted and reported', p.status === 200 && JSON.parse(p.body).paused === true, p.body);
    check('/control: a second request inside the gap gets 429', (await eget(ep, '/control?action=resume', 'POST')).status === 429);
    check('/health reports the paused state', JSON.parse((await eget(ep, '/health')).body).alertsPaused === true);
    const late = openSse(ep);
    await sleep(150);
    check('/control: a page that connects while paused is told at once', late.frames.length === 1 && late.frames[0].event === 'control' && late.frames[0].data.action === 'pause', JSON.stringify(late.frames));
    late.close();
    await ctl('skip');
    await ctl('resume');
    clock.advance(2000);
    await eget(ep, '/test-alert?kind=sub', 'POST');
    const rp = await ctl('replay');
    await sleep(150);
    const controls = st.frames.filter((f) => f.event === 'control').map((f) => f.data.action);
    check('/control: pause, skip and resume reach the stream in order', controls.join() === 'pause,skip,resume', controls.join());
    const subs = st.frames.filter((f) => f.event === 'sub');
    check('/control: replay sends the last alert again under a new id', rp.status === 200 && subs.length === 2 && subs[1].data.replay === true && subs[1].data.username === subs[0].data.username && subs[1].data.id !== subs[0].data.id && /^replay-/.test(subs[1].data.id), JSON.stringify(subs.map((f) => f.data.id)));
    const h = JSON.parse((await eget(ep, '/health')).body);
    check('/health reports resumed and the last alert kind', h.alertsPaused === false && h.lastAlert === 'sub', JSON.stringify(h));
    st.close();
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: /overlay (countdown and announcements from the dock)');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const st = openSse(ep);
    await sleep(100);
    const ov = async (q, method = 'POST') => { clock.advance(400); return eget(ep, '/overlay?' + q, method); };
    check('/overlay: GET is refused (405)', (await ov('target=ticker&lines=a', 'GET')).status === 405);
    check('/overlay: POST without the key gets 401', (await get(ep, '/overlay?target=ticker&lines=a', 'POST', { Origin: 'null' })).status === 401);
    check('/overlay: an unknown target gets 400', (await ov('target=chat&lines=a')).status === 400);
    for (const m of ['-1', '721', '1.5', 'abc', '']) check(`/overlay: countdown minutes "${m}" gets 400`, (await ov('target=countdown&minutes=' + encodeURIComponent(m))).status === 400);
    check('/overlay: a ticker update without lines gets 400', (await ov('target=ticker&lines=' + encodeURIComponent(' | | '))).status === 400);
    const start = clock.now();
    const cd = await ov('target=countdown&minutes=10&title=' + encodeURIComponent('  Back\nsoon  '));
    const end = clock.now();   // the test clock runs with real time, so the deadline is checked within the request window
    check('/overlay: a countdown is accepted', cd.status === 200 && JSON.parse(cd.body).target === 'countdown', cd.body);
    check('/overlay: a second request inside the gap gets 429', (await eget(ep, '/overlay?target=ticker&lines=x', 'POST')).status === 429);
    const long = 'x'.repeat(500);
    await ov('target=ticker&lines=' + encodeURIComponent(' One |  | Two  ' + '| L'.repeat(20) + '|' + long));
    await sleep(150);
    const frames = st.frames.filter((f) => f.event === 'overlay');
    const c = frames[0] && frames[0].data, t = frames[1] && frames[1].data;
    check('/overlay: the countdown frame carries the deadline, the length and a one-line title', c && c.target === 'countdown' && c.deadline >= start + 400 + 600000 && c.deadline <= end + 600000 && c.total === 600000 && c.title === 'Back soon', JSON.stringify(c));
    check('/overlay: ticker lines are trimmed, empty ones dropped, at most 12, within 400 characters in all', t && t.lines[0] === 'One' && t.lines[1] === 'Two' && t.lines.length === 12 && t.lines.join('|').length <= 400, JSON.stringify(t && t.lines.slice(0, 3)));
    const late = openSse(ep);
    await sleep(150);
    check('/overlay: a page that connects later gets the running countdown and the current lines', late.frames.length === 2 && late.frames[0].data.target === 'countdown' && late.frames[1].data.target === 'ticker', JSON.stringify(late.frames.map((f) => f.data.target)));
    late.close();
    clock.advance(11 * 60000);
    await ov('target=ticker&reset=1');
    const later = openSse(ep);
    await sleep(150);
    check('/overlay: an ended countdown and reset lines are not sent to new pages', later.frames.length === 0, JSON.stringify(later.frames));
    later.close();
    const reset = st.frames.filter((f) => f.event === 'overlay').pop();
    check('/overlay: reset sends an empty list (back to the page setting)', reset && reset.data.target === 'ticker' && Array.isArray(reset.data.lines) && reset.data.lines.length === 0, JSON.stringify(reset && reset.data));
    st.close();
    r.stop();
  }

  // ======================================================================================
  console.log('\n== relay: guided setup');
  {
    const fs = require('fs');
    const { runSetup, saveChannel } = require(path.join(__dirname, '..', 'relay', 'setup.js'));
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-relay-setup-'));
    const pubText = '// my settings\nwindow.KICK_OVERLAY_AYARLAR = {\n  // Kick channel name\n  kanal: "",\n  stil: "glass"\n};\n';
    fs.writeFileSync(path.join(dir, 'AYARLAR.js'), pubText);
    fs.writeFileSync(path.join(dir, 'AYARLAR.local.js'), 'window.KICK_OVERLAY_YEREL = { apiBase: "https://api.kick.com", kickClientId: "old" };');
    const SECRET = 'setup-secret-value-123';
    const calls = [];
    const fakeFetch = async (url, opts) => {
      calls.push(String(url));
      if (/\/oauth\/token$/.test(url)) {
        const f = new URLSearchParams(String(opts.body));
        if (f.get('client_secret') !== SECRET) return new Response('{"error":"invalid_client"}', { status: 401 });
        return new Response(JSON.stringify({ access_token: 't1', expires_in: 3600 }), { status: 200 });
      }
      if (/\/public\/v1\/channels/.test(url)) {
        const slug = new URL(url).searchParams.get('slug');
        return new Response(JSON.stringify({ data: slug === 'iacbi' ? [{ broadcaster_user_id: 42, slug }] : [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    };
    const script = (answers) => {
      const asked = [], said = [];
      return { asked, said, io: { root: dir, env: {}, fetchImpl: fakeFetch, say: (l) => said.push(l),
        ask: async (q, hidden) => { asked.push({ q, hidden: !!hidden }); return answers.shift() || ''; } } };
    };
    let s = script(['', 'iacbi', 'bad id with spaces', 'my-client-id', 'wrong-secret', 'n']);
    let saved = await runSetup(s.io);
    check('setup: the channel is asked again until given, a bad Client ID is refused', s.asked.filter((a) => /Channel/.test(a.q)).length === 2 && s.said.some((l) => /does not look like a Client ID/.test(l)));
    check('setup: only the secret is asked hidden', s.asked.filter((a) => a.hidden).length === 1 && /Secret/.test(s.asked.find((a) => a.hidden).q));
    check('setup: rejected credentials and "n" save nothing', saved === false && s.said.some((l) => /rejected/.test(l)) && /kickClientId: "old"/.test(fs.readFileSync(path.join(dir, 'AYARLAR.local.js'), 'utf8')));
    s = script(['IACBI', 'my-client-id', SECRET]);
    saved = await runSetup(s.io);
    const local = fs.readFileSync(path.join(dir, 'AYARLAR.local.js'), 'utf8');
    const sandbox = { window: {} };
    require('vm').runInNewContext(local, sandbox);
    check('setup: working credentials are saved, other local keys kept', saved === true && sandbox.window.KICK_OVERLAY_YEREL.kickClientId === 'my-client-id' && sandbox.window.KICK_OVERLAY_YEREL.kickClientSecret === SECRET && sandbox.window.KICK_OVERLAY_YEREL.apiBase === 'https://api.kick.com', JSON.stringify(Object.keys(sandbox.window.KICK_OVERLAY_YEREL)));
    check('setup: the secret is never printed', !s.said.some((l) => l.includes(SECRET)));
    const pubAfter = fs.readFileSync(path.join(dir, 'AYARLAR.js'), 'utf8');
    check('setup: kanal is set in AYARLAR.js, comments and other lines kept', pubAfter === pubText.replace('kanal: ""', 'kanal: "iacbi"'), pubAfter);
    s = script(['', 'my-client-id', SECRET]);
    await runSetup(s.io);
    check('setup: Enter keeps the channel already in AYARLAR.js', s.asked[0].q.includes('[iacbi]') && fs.readFileSync(path.join(dir, 'AYARLAR.js'), 'utf8') === pubAfter);
    s = script(['nochannel', 'my-client-id', SECRET, 'y']);
    saved = await runSetup(s.io);
    check('setup: an unknown channel is reported, and "y" saves anyway', saved === true && s.said.some((l) => /was not found/.test(l)));
    fs.writeFileSync(path.join(dir, 'AYARLAR.js'), 'window.KICK_OVERLAY_AYARLAR = {};\n');
    check('setup: a settings file without a kanal line is left alone', saveChannel(dir, 'iacbi') === false && fs.readFileSync(path.join(dir, 'AYARLAR.js'), 'utf8') === 'window.KICK_OVERLAY_AYARLAR = {};\n');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ======================================================================================
  console.log('\n== relay: events access key');
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    const bad = 'test-key-0123456789abcdef0123456789abcdeX';
    for (const p of ['/health', '/subscribers?slug=iacbi', '/channel?slug=iacbi', '/nope']) {
      const x = await get(ep, p, 'GET', { Origin: 'null' });
      check(`access key: ${p} with Origin null and no key gets 401`, x.status === 401 && JSON.parse(x.body).error === 'bad key', `status=${x.status}`);
    }
    check('access key: /events with Origin null and no key gets 401', (await statusOf(ep, '/events', { Origin: 'null' })) === 401);
    check('access key: no Origin and no key gets 401', (await get(ep, '/health')).status === 401);
    check('access key: a wrong key gets 401', (await get(ep, '/health?key=' + bad, 'GET', { Origin: 'null' })).status === 401);
    check('access key: a wrong-length key gets 401', (await get(ep, '/health?key=short', 'GET', { Origin: 'null' })).status === 401);
    check('access key: an empty key gets 401', (await get(ep, '/health?key=', 'GET', { Origin: 'null' })).status === 401);
    check('access key: /events with a wrong key gets 401', (await statusOf(ep, '/events?key=' + bad, { Origin: 'null' })) === 401);
    const okKey = await eget(ep, '/health', 'GET', { Origin: 'null' });
    check('access key: the right key with Origin null gets 200 and CORS echo', okKey.status === 200 && okKey.headers['access-control-allow-origin'] === 'null');
    check('access key: /events with the right key streams (200)', (await statusOf(ep, withKey('/events'), { Origin: 'null' })) === 200);
    const pre = await get(ep, '/health', 'OPTIONS', { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' });
    check('access key: OPTIONS preflight still answers 204 without a key', pre.status === 204);
    r.stop();
  }
  {
    const fs = require('fs');
    const CFG = require(path.join(__dirname, '..', 'relay', 'config.js'));
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-relay-key-'));
    try {
      const file = path.join(dir, 'AYARLAR.relay.js');
      const k1 = CFG.loadRelayKey({ root: dir, env: {} });
      const text = fs.readFileSync(file, 'utf8');
      check('loadRelayKey creates AYARLAR.relay.js in the exact format with a 64-hex key', text === `window.KICK_RELAY_KEY = "${k1}";\n` && /^[0-9a-f]{64}$/.test(k1), text.slice(0, 40));
      check('loadRelayKey returns the same key on the next call', CFG.loadRelayKey({ root: dir, env: {} }) === k1);
      check('loadRelayKey: RELAY_KEY from the environment wins', CFG.loadRelayKey({ root: dir, env: { RELAY_KEY: 'env-key-0123456789abcdef0123456789abcdef' } }) === 'env-key-0123456789abcdef0123456789abcdef');
      let weak = null;
      try { CFG.loadRelayKey({ root: dir, env: { RELAY_KEY: 'short' } }); } catch (e) { weak = e; }
      check('loadRelayKey: a weak RELAY_KEY is refused, not silently used', !!weak && /RELAY_KEY/.test(weak.message));
      const portErr = (v) => { try { CFG.parsePort(v, 1, 'P'); return false; } catch (e) { return true; } };
      check('parsePort: unset uses the default, valid numbers pass', CFG.parsePort(undefined, 8788, 'P') === 8788 && CFG.parsePort('', 8788, 'P') === 8788 && CFG.parsePort(' 9000 ', 1, 'P') === 9000);
      check('parsePort: junk, 0, negatives and out-of-range values are refused', ['abc', '0', '-1', '65536', '80.5', '1e3'].every(portErr));
      fs.writeFileSync(file, 'window.KICK_RELAY_KEY = "short";\n');
      const k2 = CFG.loadRelayKey({ root: dir, env: {} });
      check('loadRelayKey replaces a garbage key', /^[0-9a-f]{64}$/.test(k2) && k2 !== 'short' && CFG.loadRelayKey({ root: dir, env: {} }) === k2);
      fs.writeFileSync(file, 'this is not javascript (');
      const k3 = CFG.loadRelayKey({ root: dir, env: {} });
      check('loadRelayKey replaces an unreadable file', /^[0-9a-f]{64}$/.test(k3) && fs.readFileSync(file, 'utf8') === `window.KICK_RELAY_KEY = "${k3}";\n`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ======================================================================================
  console.log('\n== relay: /channel');
  {
    const clock = mkClock();
    const r = createRelay(baseOpts({ now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const a = await eget(ep, '/channel?slug=iacbi');
    check('/channel: 200 with the raw upstream JSON and X-Kick-Source: v2', a.status === 200 && a.body === '{"id":1,"slug":"iacbi","v":"v2"}' && a.headers['x-kick-source'] === 'v2', a.body);
    check('/channel: JSON content type', /application\/json/.test(a.headers['content-type']));
    const before = mock.hits.v2;
    const b = await eget(ep, '/channel?slug=iacbi');
    check('/channel: a repeat within 20 s is served from the cache', b.status === 200 && b.body === a.body && mock.hits.v2 === before);
    clock.advance(21000);
    await eget(ep, '/channel?slug=iacbi');
    check('/channel: the cache expires after 20 s', mock.hits.v2 === before + 1);

    mock.delayMs = 120;
    const base2 = mock.hits.v2;
    const many = await Promise.all([1, 2, 3, 4, 5].map(() => eget(ep, '/channel?slug=shared')));
    mock.delayMs = 0;
    check('/channel: concurrent requests share one upstream call', many.every((x) => x.status === 200) && mock.hits.v2 === base2 + 1, `hits=${mock.hits.v2 - base2}`);

    const lruBase = mock.hits.v2;
    for (let i = 0; i < 22; i++) await eget(ep, '/channel?slug=lru' + i);
    await eget(ep, '/channel?slug=lru21');
    check('/channel: recent slugs stay cached', mock.hits.v2 === lruBase + 22);
    await eget(ep, '/channel?slug=lru0');
    check('/channel: the cache holds at most 20 slugs (oldest evicted)', mock.hits.v2 === lruBase + 23, `hits=${mock.hits.v2 - lruBase}`);

    for (const bad of ['', 'Bad Slug', 'UPPER', '../etc', 'a'.repeat(41), 'x%00y', 'a.b']) {
      const x = await eget(ep, '/channel?slug=' + encodeURIComponent(bad));
      check(`/channel: invalid slug ${JSON.stringify(bad.slice(0, 12))} gets 400`, x.status === 400, `status=${x.status}`);
    }
    check('/channel: a missing slug gets 400', (await eget(ep, '/channel')).status === 400);

    mock.v2 = { status: 404, headers: {} };
    const f1 = await eget(ep, '/channel?slug=fallback404');
    check('/channel: v2 404 falls back to v1 (X-Kick-Source: v1)', f1.status === 200 && f1.headers['x-kick-source'] === 'v1' && /"v":"v1"/.test(f1.body));
    mock.v2 = { status: 503, headers: {} };
    const f2 = await eget(ep, '/channel?slug=fallback503');
    check('/channel: v2 5xx falls back to v1', f2.status === 200 && f2.headers['x-kick-source'] === 'v1');
    mock.v1 = { status: 500, headers: {} };
    const f3 = await eget(ep, '/channel?slug=bothdown');
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
    const rl = await eget(ep, '/channel?slug=limited');
    check('/channel: upstream 429 gives 429 with the upstream Retry-After', rl.status === 429 && rl.headers['retry-after'] === '7' && JSON.parse(rl.body).error === 'rate', `status=${rl.status} ra=${rl.headers['retry-after']}`);
    check('/channel: v1 is not tried after a 429', mock.hits.v1 === v1Before);
    const hitsNow = mock.hits.v2;
    const again = await eget(ep, '/channel?slug=limited2');
    check('/channel: during the wait the relay does not call upstream again', again.status === 429 && mock.hits.v2 === hitsNow && Number(again.headers['retry-after']) >= 1 && Number(again.headers['retry-after']) <= 7);
    r.stop();
    const r2 = createRelay(baseOpts());
    const { eventsPort: ep2 } = await r2.start();
    mock.v2 = { status: 403, headers: {} };
    const f = await eget(ep2, '/channel?slug=forbidden');
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
    check('/health: subscribers true when credentials exist', JSON.parse((await eget(ep, '/health')).body).features.subscribers === true);
    const t0 = mock.hits.token, c0 = mock.hits.channels;
    const s = await eget(ep, '/subscribers?slug=iacbi');
    const sj = JSON.parse(s.body);
    check('/subscribers: 200 with the overlay shape', s.status === 200 && sj.ok === true && sj.subs === 17 && sj.gifted === 3 && sj.canceled === 1 && sj.live === true && sj.viewers === 5 && sj.startMs === Date.parse('2026-10-16T10:00:00Z') && sj.title === 'Test stream', s.body);
    check('/subscribers: token requested as a client_credentials form post', mock.hits.token === t0 + 1 && /x-www-form-urlencoded/.test(mock.tokenType) && mock.tokenForm.grant_type === 'client_credentials' && mock.tokenForm.client_id === 'test-id');
    await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: cached for 15 s per slug', mock.hits.channels === c0 + 1);
    clock.advance(16000);
    await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: refetched after 15 s, reusing the cached token', mock.hits.channels === c0 + 2 && mock.hits.token === t0 + 1);
    clock.advance(3600 * 1000);
    await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: a new token is requested after the old one expires', mock.hits.token === t0 + 2);

    const ghost = await eget(ep, '/subscribers?slug=ghost');
    const gj = JSON.parse(ghost.body);
    check('/subscribers: a channel with no data still answers 200 with nulls', ghost.status === 200 && gj.ok === true && gj.subs === null && gj.live === null);
    check('/subscribers: invalid slug gets 400', (await eget(ep, '/subscribers?slug=Bad!')).status === 400 && (await eget(ep, '/subscribers')).status === 400);

    mock.channelsMode = 'revoke-once';
    const tk = mock.hits.token;
    clock.advance(16000);
    const rv = await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: a 401 clears the token and retries once with a fresh one', rv.status === 200 && mock.hits.token === tk + 1, `status=${rv.status} tokens=${mock.hits.token - tk}`);

    mock.channelsMode = 'rate';
    mock.retryAfter = '9';
    clock.advance(16000);
    const rate = await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: upstream 429 gives 429 {error:"rate"} with Retry-After', rate.status === 429 && JSON.parse(rate.body).error === 'rate' && rate.headers['retry-after'] === '9', `ra=${rate.headers['retry-after']}`);
    mock.channelsMode = '500';
    const up = await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: upstream 5xx gives 502 {error:"upstream"}', up.status === 502 && JSON.parse(up.body).error === 'upstream');
    mock.channelsMode = 'ok';
    r.stop();
  }
  {
    const r = createRelay(baseOpts());
    const { eventsPort: ep } = await r.start();
    const x = await eget(ep, '/subscribers?slug=iacbi');
    check('/subscribers: no credentials gives 503 {error:"no-credentials"}', x.status === 503 && JSON.parse(x.body).error === 'no-credentials');
    r.stop();
    const r2 = createRelay(baseOpts({ credentials: { id: 'test-id', secret: 'WRONG' } }));
    const { eventsPort: ep2 } = await r2.start();
    const y = await eget(ep2, '/subscribers?slug=iacbi');
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
    check('broadcaster id is resolved at startup from the channel slug', ports.chat === true && JSON.parse((await eget(ports.eventsPort, '/health')).body).features.chat === true);
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
    const h2 = JSON.parse((await eget(p2.eventsPort, '/health')).body);
    check('unresolved broadcaster: /health reports chat false, other features still on', h2.features.chat === false && h2.features.channel === true && p2.chat === false);
    const d = await sendChat(p2.webhookPort, 'bs-3', 4242);
    await sleep(120);
    check('unresolved broadcaster: the event is acknowledged (200) but dropped', d.status === 200 && st2.frames.length === 0);
    check('unresolved broadcaster: a clear warning is logged', lg2.warns.some((w) => /dropped/.test(w) && /RELAY_BROADCASTER_ID/.test(w) && /RELAY_ALLOW_ANY_BROADCASTER/.test(w)), lg2.warns.join(' | ').slice(0, 120));
    check('unresolved broadcaster: /channel still works', (await eget(p2.eventsPort, '/channel?slug=iacbi')).status === 200);
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
    check('RELAY_ALLOW_ANY_BROADCASTER accepts any channel and /health chat is true', st4.frames.some((f) => f.data.id === 'bs-4') && JSON.parse((await eget(p4.eventsPort, '/health')).body).features.chat === true);
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
      const req = http.request({ host: '127.0.0.1', port: wp, path: '/kick/webhook', method: 'POST', headers: { 'Kick-Event-Message-Id': 'o-2', 'Kick-Event-Message-Timestamp': t, 'Kick-Event-Signature': 'AAAA' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
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

    const before = JSON.parse((await eget(ep, '/health')).body).clients;
    st.close();
    await sleep(150);
    check('SSE: a disconnected client is removed', before >= 1 && JSON.parse((await eget(ep, '/health')).body).clients === 0);

    let boom = true;
    const fl = createRelay(baseOpts({ logger: lg, now: () => { if (boom) throw new Error('clock exploded'); return Date.now(); } }));
    const fp = await fl.start();
    const w500 = await post(fp.webhookPort, { id: 'e-1', ts: t, body: '{}', sig: 'AAAA' });
    check('a webhook handler error answers 500 JSON', w500.status === 500 && JSON.parse(w500.body).error === 'internal', `status=${w500.status}`);
    const e500 = await eget(fp.eventsPort, '/channel?slug=abc');
    check('an events handler error answers 500 JSON', e500.status === 500 && JSON.parse(e500.body).ok === false && /json/.test(e500.headers['content-type']), `status=${e500.status}`);
    check('handler errors are logged', lg.errors.length >= 2);
    boom = false;
    check('the relay keeps serving after a handler error', (await eget(fp.eventsPort, '/health')).status === 200);
    fl.stop();
    r.stop();
  }
  {
    // Regression (BB-002): forged requests with fresh headers must not use up the trusted budget.
    const ts0 = String(Math.floor(Date.now() / 1000));
    const r = createRelay(baseOpts({ webhookRate: { perSec: 0, burst: 1 } }));
    const { webhookPort: wp } = await r.start();
    const forged = chatBody('rl-forged', 'forged');
    const f1 = await post(wp, { id: 'rl-forged', ts: ts0, body: forged, sig: 'AAAA' });
    const real = chatBody('rl-real', 'real');
    const r1 = await post(wp, { id: 'rl-real', ts: ts0, body: real, sig: sign('rl-real', ts0, real, privateKey) });
    check('webhook: a forged request does not use the trusted budget (401, then signed 200)', f1.status === 401 && r1.status === 200, `forged=${f1.status} signed=${r1.status}`);
    r.stop();

    const r2 = createRelay(baseOpts({ webhookRate: { perSec: 0, burst: 2 } }));
    const { webhookPort: wp2 } = await r2.start();
    const trusted = [];
    let retry = null;
    for (let i = 0; i < 4; i++) {
      const b = chatBody('rl-t' + i, 'signed');
      const x = await post(wp2, { id: 'rl-t' + i, ts: ts0, body: b, sig: sign('rl-t' + i, ts0, b, privateKey) });
      trusted.push(x.status);
      if (x.status === 429) retry = x.headers['retry-after'];
    }
    check('webhook: signed events beyond the trusted burst get 429 with Retry-After: 1', trusted.join() === '200,200,429,429' && retry === '1', `${trusted.join()} ra=${retry}`);
    r2.stop();

    const r3 = createRelay(baseOpts({ webhookPreAuthRate: { perSec: 0, burst: 2 } }));
    const { webhookPort: wp3 } = await r3.start();
    const pre = [];
    for (let i = 0; i < 5; i++) {
      const x = await post(wp3, { id: 'pa-' + i, ts: ts0, body: '{}', sig: 'AAAA' });
      pre.push(x.status);
    }
    check('webhook: forged requests with fresh headers hit the pre-auth ceiling (429)', pre.join() === '401,401,429,429,429', pre.join());
    r3.stop();
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
  console.log('== relay: /subscribe from the studio');
  {
    mock.subs = ['chat.message.sent'];
    mock.subPosts = [];
    const clock = mkClock();
    const r = createRelay(baseOpts({ credentials: { id: 'test-id', secret: mock.secret }, channelSlug: 'iacbi', broadcasterUserId: '', now: clock.now }));
    const { eventsPort: ep } = await r.start();
    const sub = (headers) => get(ep, withKey('/subscribe'), 'POST', Object.assign({ Origin: 'null', 'Content-Type': 'application/json' }, headers || {}), '{}');
    check('subscribe: GET is refused (405)', (await eget(ep, '/subscribe')).status === 405);
    check('subscribe: no Origin is refused', (await sub({ Origin: undefined })).status === 403);
    const first = await sub();
    const fb = JSON.parse(first.body);
    check('subscribe: creates only the missing events, as numbers for broadcaster_user_id', first.status === 200 && fb.added.length === 9 && fb.existing.join() === 'chat.message.sent'
      && mock.subPosts.length === 1 && mock.subPosts[0].broadcaster_user_id === 4242 && mock.subPosts[0].method === 'webhook', first.body);
    check('subscribe: a second click within 5 s gets 429', (await sub()).status === 429);
    clock.advance(6000);
    const second = JSON.parse((await sub()).body);
    check('subscribe: once everything exists nothing more is requested', second.ok && second.added.length === 0 && mock.subPosts.length === 1);
    const h = JSON.parse((await eget(ep, '/health')).body);
    check('subscribe: the broadcaster id is known afterwards, so chat is accepted', h.features.chat === true);
    r.stop();
    const r2 = createRelay(baseOpts({ credentials: false, channelSlug: 'iacbi' }));
    const p2 = (await r2.start()).eventsPort;
    const no = await get(p2, withKey('/subscribe'), 'POST', { Origin: 'null', 'Content-Type': 'application/json' }, '{}');
    check('subscribe: without credentials it answers 503 no-credentials', no.status === 503 && JSON.parse(no.body).error === 'no-credentials');
    r2.stop();
    const r3 = createRelay(baseOpts({ credentials: { id: 'test-id', secret: 'wrong' }, channelSlug: 'iacbi' }));
    const p3 = (await r3.start()).eventsPort;
    const bad = await get(p3, withKey('/subscribe'), 'POST', { Origin: 'null', 'Content-Type': 'application/json' }, '{}');
    check('subscribe: rejected credentials answer 401 auth', bad.status === 401 && JSON.parse(bad.body).error === 'auth', bad.body);
    r3.stop();
  }

  mock.close();

  console.log('\n== relay: logging and the command line (child processes)');
  {
    const { createLogger } = require(path.join(__dirname, '..', 'relay', 'log.js'));
    const sink = () => { const s = { text: '', write(c) { s.text += c; return true; } }; return s; };
    const out = sink(), err = sink();
    const j = createLogger('json', { out, err, now: () => Date.parse('2026-11-03T10:00:00Z') });
    j.log('started on %d', 8790);
    j.warn('careful:', { a: 1 });
    const lines = (out.text + err.text).trim().split('\n').map((l) => JSON.parse(l));
    check('json logger: one parseable object per line with time, level and the formatted message',
      lines.length === 2 && lines[0].time === '2026-11-03T10:00:00.000Z' && lines[0].level === 'info' && lines[0].msg === 'started on 8790' && lines[1].level === 'warn' && lines[1].msg === 'careful: { a: 1 }', out.text + err.text);
    check('json logger: warnings and errors go to stderr, info to stdout', out.text.split('\n').filter(Boolean).length === 1 && err.text.split('\n').filter(Boolean).length === 1);
    const t = sink();
    createLogger(undefined, { out: t, err: t }).log('plain', 1);
    check('text logger (default) writes what console would', t.text === 'plain 1\n', JSON.stringify(t.text));
    let bad = null;
    try { createLogger('xml'); } catch (e) { bad = e; }
    check('an unknown log format is refused with the allowed values', !!bad && /text, json/.test(bad.message));

    const { spawn } = require('child_process');
    const freePort = () => new Promise((r) => { const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const runRelay = (env, until) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'relay', 'server.js')], { env: Object.assign({}, process.env, { KICK_CLIENT_ID: '', KICK_CLIENT_SECRET: '', KICK_CHANNEL: '' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
      let outText = '', errText = '';
      child.stdout.on('data', (c) => { outText += c; if (until && until(outText)) resolve({ child, out: outText, err: errText }); });
      child.stderr.on('data', (c) => { errText += c; });
      child.on('exit', (code, signal) => resolve({ child, code, signal, out: outText, err: errText }));
    });
    const [wp, ep] = [await freePort(), await freePort()];
    const key = 'cli-key-0123456789abcdef0123456789abcdef';
    const run = await runRelay({ RELAY_LOG_FORMAT: 'json', RELAY_WEBHOOK_PORT: String(wp), RELAY_EVENTS_PORT: String(ep), RELAY_KEY: key, RELAY_ALLOW_ANY_BROADCASTER: '1' }, (o) => /Overlay access key/.test(o));
    const startLines = run.out.trim().split('\n');
    check('CLI: RELAY_LOG_FORMAT=json makes every startup line a JSON object', startLines.length >= 4 && startLines.every((l) => { try { const o = JSON.parse(l); return o.level === 'info' && typeof o.msg === 'string'; } catch (e) { return false; } }), run.out.slice(0, 200));
    const h = await get(ep, withKey('/health', key));
    check('CLI: the started relay serves /health on the configured port', h.status === 200 && JSON.parse(h.body).version === PKG_VERSION, h.body);
    if (process.platform !== 'win32') {
      // run.out is what was printed up to startup; collect what follows, until 'close' (all stdout read).
      let tail = '';
      run.child.stdout.on('data', (c) => { tail += c; });
      const closed = new Promise((r) => run.child.on('close', (code) => r(code)));
      run.child.kill('SIGTERM');
      const code = await closed;
      check('CLI: SIGTERM stops the relay cleanly (exit 0, logged)', code === 0 && /stopping \(SIGTERM\)/.test(tail), `code=${code} ${tail.trim()}`);
    } else {
      // Windows has no catchable SIGTERM for a child; CI checks the clean stop on Linux.
      run.child.kill();
    }
    const badFmt = await runRelay({ RELAY_LOG_FORMAT: 'xml', RELAY_KEY: key });
    check('CLI: a bad RELAY_LOG_FORMAT stops at startup with exit 1', badFmt.code === 1 && /RELAY_LOG_FORMAT/.test(badFmt.err), badFmt.err);
    const badPort = await runRelay({ RELAY_EVENTS_PORT: '99999', RELAY_KEY: key });
    check('CLI: an invalid port stops at startup with exit 1', badPort.code === 1 && /RELAY_EVENTS_PORT/.test(badPort.err), badPort.err);
  }

  // ======================================================================================
  console.log('\n== relay: stream stats (recent events, leaderboards, label files)');
  {
    const os = require('os');
    const fs = require('fs');
    const { createStats, SUB_WINDOW_MS } = require(path.join(__dirname, '..', 'relay', 'stats.js'));
    const clock = mkClock();
    const st = createStats({ now: clock.now, logger: quietLogger() });
    check('stats: nothing counted at start', st.hasData() === false && st.snapshot().recent.length === 0);
    check('stats: test alerts, replays, chat and malformed alerts are not counted',
      [{ kind: 'follow', username: 'T', test: true }, { kind: 'sub', username: 'R', replay: true }, { kind: 'chat', username: 'C' }, { kind: 'follow', username: '  ' }, null]
        .every((ev) => st.record(ev) === false) && !st.hasData());
    st.record({ kind: 'follow', username: 'Mia' });
    st.record({ kind: 'sub', username: 'Kenji', months: 3 });
    st.record({ kind: 'gift', username: 'Alex', count: 5 });
    st.record({ kind: 'gift', username: 'alex', count: 2 });
    st.record({ kind: 'gift', anonymous: true, username: '', count: 4 });
    st.record({ kind: 'kicks', username: 'Luna', amount: 500 });
    st.record({ kind: 'kicks', username: 'Noah', amount: 100 });
    st.record({ kind: 'kicks', username: 'Noah', amount: 450 });
    let snap = st.snapshot();
    check('stats: totals add up follows, subs, gifted subs and Kicks', JSON.stringify(snap.totals) === JSON.stringify({ follows: 1, subs: 1, gifted: 11, kicks: 1050 }), JSON.stringify(snap.totals));
    check('stats: gifters merge names in any case under the latest spelling; anonymous gifts stay off the board',
      snap.topGifters.length === 1 && snap.topGifters[0].name === 'alex' && snap.topGifters[0].count === 7, JSON.stringify(snap.topGifters));
    check('stats: Kicks board is sorted by amount', snap.topKicks.map((x) => x.name + '=' + x.amount).join() === 'Noah=550,Luna=500', JSON.stringify(snap.topKicks));
    check('stats: recent events are newest first, with the fields the overlay shows', snap.recent.length === 8 && snap.recent[0].kind === 'kicks' && snap.recent[0].amount === 450 && snap.recent[3].anonymous === true && snap.recent[3].name === '' && snap.recent[6].months === 3, JSON.stringify(snap.recent.slice(0, 4)));
    check('stats: the sub train sees subscriptions and gifted subscriptions', snap.subTimes.reduce((a, t) => a + t.n, 0) === 12, JSON.stringify(snap.subTimes));
    clock.advance(SUB_WINDOW_MS + 1000);
    check('stats: sub train entries expire after the window', st.snapshot().subTimes.length === 0);
    {
      const tc = mkClock();
      const tr = createStats({ now: tc.now, logger: quietLogger() });
      for (let i = 0; i < 4; i++) { tr.record({ kind: 'sub', username: 'u' + i }); tc.advance(SUB_WINDOW_MS - 60000); }
      check('stats: a long sub train keeps every link of its chain', tr.snapshot().subTimes.length === 4, String(tr.snapshot().subTimes.length));
      tc.advance(SUB_WINDOW_MS);
      tr.record({ kind: 'gift', username: 'g', count: 3 });
      const left = tr.snapshot().subTimes;
      check('stats: a gap longer than the window starts a new chain', left.length === 1 && left[0].n === 3, JSON.stringify(left));
    }
    for (let i = 0; i < 30; i++) st.record({ kind: 'follow', username: 'f' + i });
    check('stats: recent events are capped at 20', st.snapshot().recent.length === 20);
    const lab = st.labels();
    check('stats: label texts for OBS Text sources', lab['latest-follower.txt'] === 'f29' && lab['top-gifter.txt'] === 'alex (7)' && lab['top-kicks.txt'] === 'Noah (550)' && lab['subs-total.txt'] === '12' && lab['latest-gifter.txt'] === 'Anonymous', JSON.stringify(lab));
    st.reset();
    snap = st.snapshot();
    check('stats: reset starts every number over', !st.hasData() && snap.totals.kicks === 0 && snap.topGifters.length === 0 && snap.recent.length === 0);

    // Saved state and label files, in a throwaway folder.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ko-relay-stats-'));
    const file = path.join(dir, 'kick-relay-stats.json');
    const labelsDir = path.join(dir, 'labels');
    const a = createStats({ file, labelsDir, logger: quietLogger() });
    a.flush();
    check('stats: nothing is written before the first event', !fs.existsSync(file) && !fs.existsSync(labelsDir));
    a.record({ kind: 'kicks', username: 'Luna', amount: 300 });
    a.record({ kind: 'follow', username: 'Mia' });
    a.flush();
    check('stats: the state file and the label files are written', fs.existsSync(file) && fs.readFileSync(path.join(labelsDir, 'top-kicks.txt'), 'utf8') === 'Luna (300)' && fs.readFileSync(path.join(labelsDir, 'latest-follower.txt'), 'utf8') === 'Mia' && !fs.existsSync(file + '.tmp'));
    const b = createStats({ file, logger: quietLogger() });
    check('stats: a restarted relay picks up the saved numbers', b.hasData() && b.snapshot().totals.kicks === 300 && b.snapshot().topKicks[0].name === 'Luna');
    fs.writeFileSync(file, JSON.stringify({ since: 'x', totals: { follows: -5, kicks: 1.5, subs: 2 }, recent: [{ kind: 'follow', name: '<b>x</b>'.repeat(30), at: 1 }, { kind: 'nope', name: 'y', at: 1 }, 7], gifters: { a: { name: 'Al', count: 'many' }, b: { name: 'Bo', count: 3 } }, latest: { follow: 'x' } }));
    const c = createStats({ file, logger: quietLogger() }).snapshot();
    check('stats: a damaged state file keeps only valid fields', c.totals.follows === 0 && c.totals.kicks === 0 && c.totals.subs === 2 && c.recent.length === 1 && c.recent[0].name.length === 60 && c.topGifters.length === 1 && c.topGifters[0].name === 'Bo' && c.latest.follow === null, JSON.stringify(c));
    fs.writeFileSync(file, '{not json');
    const warnLog = quietLogger();
    check('stats: an unreadable state file starts from zero with a warning', !createStats({ file, logger: warnLog }).hasData() && warnLog.warns.length === 1);
    fs.rmSync(dir, { recursive: true, force: true });

    // Through the relay: signed alerts update the stats, which reach the pages and GET /stats.
    const rc = mkClock();
    const r = createRelay(baseOpts({ now: rc.now, broadcasterUserId: '113812015' }));
    const { webhookPort: wp, eventsPort: ep } = await r.start();
    const first = openSse(ep);
    await sleep(100);
    check('stats: a page connecting before any event gets no stats frame', !first.frames.some((x) => x.event === 'stats'));
    const ts = new Date().toISOString();
    const signed = (fx, type, id) => {
      const body = JSON.stringify(Object.assign(fixture(fx), { broadcaster: Object.assign(fixture(fx).broadcaster, { user_id: 113812015 }) }));
      return post(wp, { id, ts, body, sig: sign(id, ts, body, privateKey), type });
    };
    await signed('kicks-gifted', 'kicks.gifted', 'sx-kicks');
    await signed('subscription-gifts', 'channel.subscription.gifts', 'sx-gift');
    await signed('channel-followed', 'channel.followed', 'sx-follow');
    await sleep(500);
    const sf = first.frames.filter((x) => x.event === 'stats');
    check('stats: a burst of alerts sends one throttled stats frame', sf.length === 1 && sf[0].data.recent.length === 3, JSON.stringify(sf.map((x) => x.data.recent.length)));
    const g = JSON.parse((await eget(ep, '/stats')).body);
    check('GET /stats returns the snapshot', g.ok === true && g.recent.length === 3 && g.totals.follows === 1 && g.topKicks.length === 1, JSON.stringify(g.totals));
    check('GET /stats needs the key', (await get(ep, '/stats')).status === 401);
    const late = openSse(ep);
    await sleep(150);
    check('stats: a page connecting later gets the current stats at once', late.frames.length === 1 && late.frames[0].event === 'stats' && late.frames[0].data.recent.length === 3);
    late.close();
    await eget(ep, '/test-alert?kind=follow', 'POST');
    await sleep(500);
    check('stats: a test alert from the studio is not counted', JSON.parse((await eget(ep, '/stats')).body).totals.follows === 1);
    check('POST /stats/reset: GET is refused (405)', (await eget(ep, '/stats/reset')).status === 405);
    check('POST /stats/reset: a foreign origin is refused (403)', (await eget(ep, '/stats/reset', 'POST', { Origin: 'http://evil.example' })).status === 403);
    rc.advance(2000);
    const rs = await eget(ep, '/stats/reset', 'POST', { Origin: 'null' });
    check('POST /stats/reset from the dock clears the stats', rs.status === 200 && JSON.parse((await eget(ep, '/stats')).body).recent.length === 0, rs.body);
    check('POST /stats/reset: a second request inside the gap gets 429', (await eget(ep, '/stats/reset', 'POST')).status === 429);
    await sleep(500);
    const lastFrame = first.frames.filter((x) => x.event === 'stats').pop();
    check('stats: the reset reaches the pages as an empty stats frame', lastFrame && lastFrame.data.recent.length === 0 && lastFrame.data.totals.kicks === 0);
    await signed('channel-followed', 'channel.followed', 'sx-follow-2');
    await signed('livestream-status-started', 'livestream.status.updated', 'sx-live');
    await sleep(500);
    check('stats: the stream going live starts the numbers over', JSON.parse((await eget(ep, '/stats')).body).recent.length === 0);
    first.close();
    r.stop();
  }

  console.log('== relay: serves the pack and saves settings');
  {
    const os = require('os');
    const fsx = require('fs');
    const cfg = fsx.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-site-'));
    fsx.writeFileSync(path.join(cfg, 'AYARLAR.local.js'), "window.KICK_OVERLAY_YEREL = { kickClientId: 'old-id', kickClientSecret: 'very-secret-value' };\n");
    const r = createRelay({ publicKeyPem: publicKey, accessKey: ACCESS_KEY, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015',
      configRoot: cfg, siteRoot: path.join(__dirname, '..'), fetchImpl: async () => { throw new Error('offline'); }, logger: quietLogger() });
    const { eventsPort: ep } = await r.start();
    const postJson = (p, body, headers) => get(ep, withKey(p), 'POST', Object.assign({ 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + ep }, headers || {}), JSON.stringify(body));

    const root = await get(ep, '/');
    check('site: / redirects to the studio', root.status === 302 && root.headers.location === '/studio.html');
    const page = await get(ep, '/follower-bar.html');
    check('site: an overlay page is served without a key, as HTML with nosniff', page.status === 200 && /text\/html/.test(page.headers['content-type']) && page.headers['x-content-type-options'] === 'nosniff' && page.body.includes('kick-core.js'));
    const css = await get(ep, '/shared/themes.css');
    check('site: shared assets are served with their type and an ETag', css.status === 200 && /text\/css/.test(css.headers['content-type']) && !!css.headers.etag);
    const again = await get(ep, '/shared/themes.css', 'GET', { 'If-None-Match': css.headers.etag });
    check('site: an unchanged file answers 304', again.status === 304);
    const blocked = await Promise.all(['/package.json', '/relay/server.js', '/tests/run.js', '/shared/../package.json', '/shared/%2e%2e/package.json',
      '/shared/..%2fpackage.json', '/.git/config', '/shared/.hidden.js', '/kick-relay-stats.json', '/AYARLAR.backup.js', '/shared/kick-core.js%00.png']
      .map(async (p) => [p, (await get(ep, p)).status]));
    check('site: files outside the pack, dot files and traversal are not served', blocked.every(([, st]) => st === 404 || st === 400 || st === 401), JSON.stringify(blocked));
    const local = await get(ep, '/AYARLAR.local.js');
    check('site: AYARLAR.local.js is an empty stub; the secret never leaves the relay', local.status === 200 && !local.body.includes('very-secret-value') && !local.body.includes('old-id'));
    const keySame = await get(ep, '/AYARLAR.relay.js', 'GET', { 'Sec-Fetch-Site': 'same-origin' });
    check('site: the key script goes to the relay\'s own pages and marks them', keySame.status === 200 && keySame.body.includes(ACCESS_KEY) && keySame.body.includes('KICK_RELAY_SELF = true'));
    const keyCross = await get(ep, '/AYARLAR.relay.js', 'GET', { 'Sec-Fetch-Site': 'cross-site' });
    check('site: another site cannot load the key script', keyCross.status === 403 && !keyCross.body.includes(ACCESS_KEY));
    const keyRef = await get(ep, '/AYARLAR.relay.js', 'GET', { Referer: 'https://evil.example/' });
    check('site: a foreign referer without Sec-Fetch-Site is refused too', keyRef.status === 403 && !keyRef.body.includes(ACCESS_KEY));
    const pub = await get(ep, '/AYARLAR.js');
    check('site: AYARLAR.js falls back to an empty settings object', pub.status === 200 && pub.body.includes('KICK_OVERLAY_AYARLAR'));

    const rev0 = JSON.parse((await eget(ep, '/settings/rev')).body).rev;
    check('settings: GET /settings needs the key', (await get(ep, '/settings')).status === 401);
    check('settings: POST without an Origin is refused', (await postJson('/settings', { settings: {} }, { Origin: undefined })).status === 403);
    check('settings: POST from a foreign origin is refused', (await postJson('/settings', { settings: {} }, { Origin: 'https://evil.example' })).status === 403);
    check('settings: POST that is not JSON is refused (415)', (await get(ep, withKey('/settings'), 'POST', { 'Content-Type': 'text/plain', Origin: 'null' }, '{}')).status === 415);
    const saved = await postJson('/settings', { settings: { kanal: 'https://kick.com/Some_Channel', stil: 'neon', takipciHedefi: '5000', yenilemeSn: 1, bilinmeyen: 'x', ozelCss: '@import url(https://evil.example/x.css);' } });
    const savedBody = JSON.parse(saved.body);
    check('settings: POST /settings saves and answers with the new revision', saved.status === 200 && savedBody.ok === true && savedBody.channel === 'some_channel', saved.body);
    const file = fsx.readFileSync(path.join(cfg, 'AYARLAR.js'), 'utf8');
    const vmx = require('vm');
    const box = { window: {} };
    vmx.runInNewContext(file, box);
    const w = box.window.KICK_OVERLAY_AYARLAR;
    check('settings: values are normalized, unknown keys and unsafe CSS are dropped, defaults are left out',
      w.kanal === 'some_channel' && w.stil === 'neon' && w.takipciHedefi === 5000 && w.yenilemeSn === 10 && !('bilinmeyen' in w) && !('ozelCss' in w) && !('sekil' in w), JSON.stringify(w));
    check('settings: the file is plain data (one assignment, no code)', /^\/\/[^\n]*\n\/\/[^\n]*\nwindow\.KICK_OVERLAY_AYARLAR = \{[\s\S]*\};\n$/.test(file));
    const got = JSON.parse((await eget(ep, '/settings')).body);
    check('settings: GET /settings returns what was saved', got.ok && got.settings.kanal === 'some_channel' && got.credentials === true);
    await sleep(20);
    const rev1 = JSON.parse((await eget(ep, '/settings/rev')).body).rev;
    check('settings: the revision changes after a save', rev1 !== rev0 && rev1 > 0);
    check('settings: a second save inside the gap gets 429', (await postJson('/settings', { settings: {} })).status === 429);
    await sleep(600);
    await postJson('/settings', { settings: { kanal: 'other' } });
    check('settings: the previous file is kept as AYARLAR.backup.js', fsx.readFileSync(path.join(cfg, 'AYARLAR.backup.js'), 'utf8').includes('some_channel'));
    check('settings: the served AYARLAR.js is the saved one', (await get(ep, '/AYARLAR.js')).body.includes('"other"'));

    await sleep(600);
    check('credentials: only one of the two fields is refused', (await postJson('/credentials', { clientId: 'abc', clientSecret: '' })).status === 400);
    await sleep(600);
    const cr = await postJson('/credentials', { clientId: 'new-id', clientSecret: 'new-secret' });
    check('credentials: POST /credentials saves them and never echoes the secret', cr.status === 200 && !cr.body.includes('new-secret') && JSON.parse(cr.body).saved === true);
    const localText = fsx.readFileSync(path.join(cfg, 'AYARLAR.local.js'), 'utf8');
    check('credentials: AYARLAR.local.js holds the new values', localText.includes('new-id') && localText.includes('new-secret') && !localText.includes('old-id'));
    await sleep(600);
    await postJson('/credentials', { clientId: '', clientSecret: '' });
    const health = JSON.parse((await eget(ep, '/health')).body);
    check('credentials: empty fields remove them; /health says subscribers is off', !fsx.readFileSync(path.join(cfg, 'AYARLAR.local.js'), 'utf8').includes('new-id') && health.features.subscribers === false && health.features.settings === true);
    r.stop();
    fsx.rmSync(cfg, { recursive: true, force: true });
  }

  console.log('== relay: record mode');
  {
    const os = require('os');
    const fsx = require('fs');
    const { redact } = require(path.join(__dirname, '..', 'relay', 'record.js'));
    const { checkFolder } = require(path.join(__dirname, '..', 'tools', 'check-recordings.js'));
    const red = redact({ sender: { user_id: 555, username: 'Viewer_One', channel_slug: 'viewer_one', profile_picture: 'https://x/p.png' },
      broadcaster: { user_id: 555, username: 'viewer_one' }, content: 'hello there', badges: [{ type: 'vip' }], amount: 100 });
    check('record: names, ids, pictures and text are replaced; the same person keeps one placeholder',
      red.sender.username === 'user_1' && red.broadcaster.username === 'user_1' && red.sender.user_id === 1001 && red.broadcaster.user_id === 1001
      && red.content === 'redacted text (11 chars)' && red.sender.profile_picture.includes('redacted') && red.badges[0].type === 'vip' && red.amount === 100, JSON.stringify(red));
    const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'kick-record-'));
    const r = createRelay({ publicKeyPem: publicKey, accessKey: ACCESS_KEY, webhookPort: 0, eventsPort: 0, broadcasterUserId: '113812015', credentials: false, channelSlug: '', recordDir: dir, logger: quietLogger() });
    const { webhookPort } = await r.start();
    const ts = String(Math.floor(Date.now() / 1000));
    const body = chatBody('rec-1', 'my secret message');
    await post(webhookPort, { id: 'rec-1', ts, body, sig: sign('rec-1', ts, body, privateKey) });
    await post(webhookPort, { id: 'rec-bad', ts, body, sig: sign('rec-bad', ts, body, otherKey.privateKey) });
    const files = fsx.readdirSync(dir);
    const text = files.length ? fsx.readFileSync(path.join(dir, files[0]), 'utf8') : '';
    check('record: one file per verified webhook, none for a bad signature', files.length === 1 && /chat.message.sent.json$/.test(files[0]), files.join());
    check('record: the saved file holds no name or message text', text && !text.includes('viewer_one') && !text.includes('my secret message') && text.includes('"type": "chat.message.sent"'));
    const checked = checkFolder(dir);
    check('check-recordings: a recorded chat message still maps to a chat event', checked.length === 1 && checked[0].status === 'ok' && checked[0].kind === 'chat', JSON.stringify(checked));
    r.stop();
    fsx.rmSync(dir, { recursive: true, force: true });
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('relay tests aborted:', e); process.exit(2); });
