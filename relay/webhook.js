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
  return null;
}

module.exports = { HEADER, MAX_SKEW_MS, verifySignature, parseTimestamp, isFresh, ReplayGuard, TokenBucket, normalizeEvent };
