'use strict';
// The Kick adapter: everything the relay knows about Kick in one place. The server asks it to read a webhook
// delivery, check its signature, turn the body into an overlay event, look up a channel and manage event
// subscriptions; the server itself only handles HTTP, rate limits, the overlay stream and the studio.
// When Kick changes its API, this file and the modules it wraps (webhook.js, kick-api.js, subscribe.js) are where
// the fix goes; tools/kick-drift.js and tools/check-recordings.js tell you when that is needed.

const { HEADER, verifySignature, isFresh, normalizeEvent } = require('./webhook.js');
const { createKickApi, retryAfterSec } = require('./kick-api.js');
const { ensureSubscriptions } = require('./subscribe.js');
const { fetchTimeout } = require('./config.js');

const KEY_TTL_MS = 60 * 60 * 1000;
const FORCE_MIN_GAP_MS = 60 * 1000;      // forged requests must not make the relay hammer Kick
const KEY_FAIL_CACHE_MS = 30 * 1000;
const KEY_TIMEOUT_MS = 5000;
const WEBHOOK_PATH = '/kick/webhook';
const DEVELOPER_URL = 'kick.com/settings/developer';

/**
 * Kick's webhook public key, cached for an hour. Concurrent callers share one request; a failure is remembered for
 * 30 s so a down API is not retried per webhook. `force` refetches (key rotation), at most once a minute.
 * @param {{ fetchImpl: typeof fetch, apiBase: string, now: () => number }} o
 * @returns {(force?: boolean) => Promise<string>}
 */
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

/**
 * The subscriber and stream numbers from an official /public/v1/channels answer. Same shape as kick-core's
 * parseOfficialChannel, so the overlay can use the answer unchanged.
 * @param {any} body
 */
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

/**
 * @typedef {{ id: string, timestamp: string, signature: string, type: string }} Delivery
 * @typedef {{ ok: true, text: string, source: string } | { ok: false, rate?: boolean, retryAfterSec?: number }} ChannelResult
 */

/**
 * Builds the Kick adapter.
 * @param {{ fetchImpl: typeof fetch, apiBase: string, tokenBase: string, kickBase: string, credentials: () => any,
 *   now: () => number, publicKeyPem?: string | null, normalizeEvent?: typeof normalizeEvent }} o
 */
function createKickAdapter(o) {
  const api = createKickApi({ fetchImpl: o.fetchImpl, apiBase: o.apiBase, tokenBase: o.tokenBase, credentials: o.credentials, now: o.now });
  const getKey = o.publicKeyPem ? async () => o.publicKeyPem : kickKeySource(o);
  const normalize = o.normalizeEvent || normalizeEvent;

  return {
    name: 'kick',
    webhookPath: WEBHOOK_PATH,
    developerUrl: DEVELOPER_URL,
    api,

    /**
     * The signed-delivery headers, or null when one that is required is missing.
     * @param {import('http').IncomingHttpHeaders} headers
     * @returns {Delivery | null}
     */
    readDelivery(headers) {
      const one = (v) => (Array.isArray(v) ? v[0] : v);
      const d = { id: one(headers[HEADER.messageId]), timestamp: one(headers[HEADER.timestamp]), signature: one(headers[HEADER.signature]), type: String(one(headers[HEADER.type]) || '') };
      return d.id && d.timestamp && d.signature ? d : null;
    },

    /** Whether the delivery time is close enough to now to accept (replay window). */
    isFresh: (/** @type {Delivery} */ d, /** @type {number} */ nowMs) => isFresh(d.timestamp, nowMs),

    /**
     * Checks the signature. On a mismatch the key is refetched once (rotation) and only a new key is tried again.
     * Throws when no key can be had at all.
     * @param {Delivery} d
     * @param {Buffer} raw
     * @returns {Promise<boolean>}
     */
    async verify(d, raw) {
      const key = await getKey(false);
      const check = (pem) => verifySignature({ messageId: d.id, timestamp: d.timestamp, rawBody: raw, signature: d.signature, publicKeyPem: pem });
      if (check(key)) return true;
      let key2 = key;
      try { key2 = await getKey(true); } catch (e) { /* keep the old key: the request stays rejected */ }
      return key2 !== key && check(key2);
    },

    /** The overlay event for a verified body, or null for a type the overlays do not show. */
    normalize: (/** @type {string} */ type, /** @type {any} */ body) => normalize(type, body),

    /**
     * Public channel data, v2 first and v1 as the fallback. Rate limits are reported, not retried.
     * @param {string} slug
     * @returns {Promise<ChannelResult>}
     */
    async fetchChannel(slug) {
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
    },

    subscribersFrom,

    /** Creates the missing event subscriptions for the channel (see subscribe.js for the error codes). */
    subscribe: (/** @type {string} */ slug) => ensureSubscriptions({ api, slug, apiBase: o.apiBase, fetchImpl: o.fetchImpl })
  };
}

module.exports = { createKickAdapter, kickKeySource, subscribersFrom, WEBHOOK_PATH };
