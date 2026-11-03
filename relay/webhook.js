'use strict';
// Kick webhook helpers: signature verification, freshness, replay protection, and event mapping.
// Pure functions only (no sockets), so they can be tested directly.

const crypto = require('crypto');

// Documented headers. The signed message is "<message-id>.<timestamp>.<raw body>".
const HEADER = {
  signature: 'kick-event-signature',
  messageId: 'kick-event-message-id',
  timestamp: 'kick-event-message-timestamp',
  type: 'kick-event-type'
};

// Accepted timestamp skew. The docs do not state a window, so this is a conservative choice.
const MAX_SKEW_MS = 5 * 60 * 1000;

function verifySignature({ messageId, timestamp, rawBody, signature, publicKeyPem }) {
  if (!messageId || !timestamp || !signature || !publicKeyPem) return false;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(Buffer.from(`${messageId}.${timestamp}.`, 'utf8'));
    verifier.update(rawBody);
    return verifier.verify(publicKeyPem, Buffer.from(signature, 'base64'));
  } catch (e) {
    return false;
  }
}

// Accepts epoch seconds, epoch milliseconds, or an ISO date. Returns ms, or null if unreadable.
function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

// True when the timestamp is within the allowed skew. An unreadable timestamp is rejected: the
// signed timestamp is the only bound on how long a captured request stays replayable.
function isFresh(timestamp, nowMs) {
  const ms = parseTimestamp(timestamp);
  if (ms === null) return false;
  return Math.abs(nowMs - ms) <= MAX_SKEW_MS;
}

// Remembers message ids for a while so a redelivered event is not shown twice.
class ReplayGuard {
  constructor(ttlMs = 20 * 60 * 1000, max = 10000) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.seen = new Map();   // message id -> expiry (ms)
  }
  // Returns true the first time an id is seen (and records it), false on a repeat.
  accept(id, nowMs) {
    for (const [k, exp] of this.seen) {
      if (exp <= nowMs) this.seen.delete(k);
      else break;            // Map keeps insertion order, so expired entries are at the front
    }
    if (this.seen.has(id)) return false;
    if (this.seen.size >= this.max) this.seen.delete(this.seen.keys().next().value);
    this.seen.set(id, nowMs + this.ttlMs);
    return true;
  }
}

// Global request limiter for the public webhook port: refills `perSec` tokens a second up to `burst`.
class TokenBucket {
  constructor(perSec = 30, burst = 60) {
    this.perSec = perSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = null;
  }
  take(nowMs) {
    if (this.last !== null) this.tokens = Math.min(this.burst, this.tokens + Math.max(0, nowMs - this.last) * this.perSec / 1000);
    this.last = nowMs;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

const cap = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
const idOf = (v) => (v == null ? '' : String(v));

// Maps a documented Kick event to the small shape the overlay understands.
// Returns null for events the overlay does not show, and for a body whose shape does not match
// the declared type (the type header is signed, but a buggy or hostile sender could still pair it
// with the wrong payload).
function normalizeEvent(type, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (type === 'chat.message.sent') {
    if (typeof body.content !== 'string' || body.banned_user !== undefined) return null;
    if (body.sender !== undefined && !isObj(body.sender)) return null;
    if (body.broadcaster !== undefined && !isObj(body.broadcaster)) return null;
    const sender = body.sender || {};
    const ident = sender.identity || {};
    const badges = Array.isArray(ident.badges) ? ident.badges.slice(0, 12).map((b) => ({
      type: cap(String((b && b.type) || ''), 40).toLowerCase(),
      text: cap(String((b && b.text) || ''), 40),
      count: Number.isSafeInteger(Number(b && b.count)) ? Number(b.count) : 0
    })) : [];
    return {
      kind: 'chat',
      id: idOf(body.message_id),
      senderId: idOf(sender.user_id),
      broadcasterId: idOf(body.broadcaster && body.broadcaster.user_id),
      username: cap(String(sender.username || sender.channel_slug || '?'), 60),
      color: cap(String(ident.username_color || ''), 16),
      message: cap(String(body.content || ''), 500),
      badges,
      createdAt: cap(String(body.created_at || ''), 40)
    };
  }
  if (type === 'moderation.banned') {
    if (!isObj(body.banned_user) || body.content !== undefined) return null;
    if (body.broadcaster !== undefined && !isObj(body.broadcaster)) return null;
    const u = body.banned_user;
    return {
      kind: 'ban',
      userId: idOf(u.user_id),
      broadcasterId: idOf(body.broadcaster && body.broadcaster.user_id),
      username: cap(String(u.username || '').toLowerCase(), 60)
    };
  }
  if (type === 'livestream.status.updated' || type === 'livestream.metadata.updated') return normalizeStream(type, body, isObj);
  return normalizeAlert(type, body, isObj);
}

const MAX_TITLE = 140;
const titleOf = (v) => (typeof v === 'string' ? cap(v.trim(), MAX_TITLE) : '');

// Stream start/end and title changes (docs.kick.com/events/event-types, version 1), for the info panel.
// `is_live` is the one field the panel acts on, so a status body without a boolean there is rejected.
function normalizeStream(type, body, isObj) {
  if (body.broadcaster !== undefined && !isObj(body.broadcaster)) return null;
  const broadcasterId = idOf(body.broadcaster && body.broadcaster.user_id);
  if (type === 'livestream.status.updated') {
    if (typeof body.is_live !== 'boolean') return null;
    return {
      kind: 'live', broadcasterId, live: body.is_live, title: titleOf(body.title),
      startedAt: cap(String(body.started_at || ''), 40), endedAt: cap(String(body.ended_at || ''), 40)
    };
  }
  if (!isObj(body.metadata) || typeof body.metadata.title !== 'string') return null;
  return { kind: 'meta', broadcasterId, title: titleOf(body.metadata.title) };
}

const nameOf = (u) => (u && typeof u.username === 'string' ? cap(u.username.trim(), 60) : '');
const countOf = (v, min) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isSafeInteger(n) && n >= min ? n : null;
};
const MAX_GIFTEES_SHOWN = 10;

// Follow, subscription and Kicks events (docs.kick.com/events/event-types, version 1), for the alert overlay.
// Every alert names a real user except an anonymous gift, whose gifter fields are null by design.
function normalizeAlert(type, body, isObj) {
  if (body.broadcaster !== undefined && !isObj(body.broadcaster)) return null;
  const broadcasterId = idOf(body.broadcaster && body.broadcaster.user_id);
  const createdAt = cap(String(body.created_at || ''), 40);
  if (type === 'channel.followed') {
    const u = body.follower;
    if (!isObj(u) || !nameOf(u)) return null;
    return { kind: 'follow', broadcasterId, userId: idOf(u.user_id), username: nameOf(u) };
  }
  if (type === 'channel.subscription.new' || type === 'channel.subscription.renewal') {
    const u = body.subscriber;
    if (!isObj(u) || !nameOf(u)) return null;
    // duration is the subscription length in months; a missing or odd value still shows the alert, as month 1.
    return {
      kind: 'sub', broadcasterId, userId: idOf(u.user_id), username: nameOf(u),
      months: countOf(body.duration, 1) || 1, renewal: type === 'channel.subscription.renewal', createdAt
    };
  }
  if (type === 'channel.subscription.gifts') {
    const g = body.gifter;
    if (!isObj(g) || !Array.isArray(body.giftees) || body.giftees.length === 0) return null;
    const anonymous = g.is_anonymous === true || !nameOf(g);
    return {
      kind: 'gift', broadcasterId, anonymous,
      userId: anonymous ? '' : idOf(g.user_id), username: anonymous ? '' : nameOf(g),
      count: body.giftees.length,
      giftees: body.giftees.slice(0, MAX_GIFTEES_SHOWN).map(nameOf).filter(Boolean),
      createdAt
    };
  }
  if (type === 'kicks.gifted') {
    const u = body.sender, gift = body.gift;
    if (!isObj(u) || !nameOf(u) || !isObj(gift)) return null;
    const amount = countOf(gift.amount, 1);
    if (amount === null) return null;
    return {
      kind: 'kicks', broadcasterId, userId: idOf(u.user_id), username: nameOf(u), amount,
      giftName: cap(typeof gift.name === 'string' ? gift.name.trim() : '', 40),
      message: cap(typeof gift.message === 'string' ? gift.message.trim() : '', 200),
      createdAt
    };
  }
  return null;
}

// Every event type the relay understands; relay/subscribe.js subscribes to exactly these.
const EVENT_TYPES = [
  'chat.message.sent', 'moderation.banned',
  'channel.followed', 'channel.subscription.new', 'channel.subscription.renewal', 'channel.subscription.gifts',
  'kicks.gifted',
  'livestream.status.updated', 'livestream.metadata.updated'
];

module.exports = { HEADER, MAX_SKEW_MS, EVENT_TYPES, verifySignature, parseTimestamp, isFresh, ReplayGuard, TokenBucket, normalizeEvent };
