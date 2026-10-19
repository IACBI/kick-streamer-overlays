'use strict';
// Client for Kick's official API, shared by the relay server and the subscribe script.
// App token: client_credentials grant, cached until 60 s before it expires, dropped on a 401.
// Every result is { ok:true, ... } or { ok:false, error:'no-credentials'|'auth'|'rate'|'upstream', retryAfterSec? }.

const { fetchTimeout } = require('./config.js');

const DEFAULT_RETRY_SEC = 60;

// Retry-After as whole seconds (the HTTP-date form is not used by Kick); a sane default otherwise.
function retryAfterSec(headers) {
  const raw = headers && typeof headers.get === 'function' ? headers.get('retry-after') : null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 3600) : DEFAULT_RETRY_SEC;
}

function classify(status, headers) {
  if (status === 429) return { ok: false, error: 'rate', retryAfterSec: retryAfterSec(headers), status };
  if (status === 400 || status === 401 || status === 403) return { ok: false, error: 'auth', status };
  return { ok: false, error: 'upstream', status };
}

function createKickApi(opts) {
  const o = Object.assign({
    fetchImpl: globalThis.fetch,
    apiBase: 'https://api.kick.com',
    tokenBase: 'https://id.kick.com',
    credentials: null,       // { id, secret } or a function returning it
    now: () => Date.now(),
    timeoutMs: 10000
  }, opts || {});

  const creds = () => (typeof o.credentials === 'function' ? o.credentials() : o.credentials) || null;
  let cached = null;         // { value, expiresAt }
  let pending = null;

  async function requestToken() {
    const c = creds();
    if (!c) return { ok: false, error: 'no-credentials' };
    let res;
    try {
      res = await fetchTimeout(o.fetchImpl, `${o.tokenBase}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.id, client_secret: c.secret }).toString()
      }, o.timeoutMs);
    } catch (e) { return { ok: false, error: 'upstream' }; }
    if (!res.ok) return classify(res.status, res.headers);
    let body = null;
    try { body = await res.json(); } catch (e) { /* handled below */ }
    if (!body || typeof body.access_token !== 'string') return { ok: false, error: 'upstream' };
    // expires_in is seconds per RFC 6749; fall back to 10 min if it is missing.
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 600;
    cached = { value: body.access_token, expiresAt: o.now() + Math.max(ttl - 60, 1) * 1000 };
    return { ok: true, token: cached.value };
  }

  function token() {
    if (!creds()) return Promise.resolve({ ok: false, error: 'no-credentials' });
    if (cached && o.now() < cached.expiresAt) return Promise.resolve({ ok: true, token: cached.value });
    if (!pending) pending = requestToken().finally(() => { pending = null; });
    return pending;
  }

  function clearToken() { cached = null; }

  // GET /public/v1/channels?slug=... -> { ok:true, data:<raw JSON body> }
  async function channels(slug) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await token();
      if (!t.ok) return t;
      let res;
      try {
        res = await fetchTimeout(o.fetchImpl, `${o.apiBase}/public/v1/channels?slug=${encodeURIComponent(slug)}`, {
          headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/json' }
        }, o.timeoutMs);
      } catch (e) { return { ok: false, error: 'upstream' }; }
      if (res.status === 401) {
        clearToken();
        if (attempt === 0) continue;     // the token may simply have been revoked: one fresh try
        return { ok: false, error: 'auth', status: 401 };
      }
      if (!res.ok) return classify(res.status, res.headers);
      try { return { ok: true, data: await res.json() }; } catch (e) { return { ok: false, error: 'upstream' }; }
    }
    return { ok: false, error: 'auth' };
  }

  // Looks up the broadcaster user id for a channel slug.
  async function broadcasterId(slug) {
    const r = await channels(slug);
    if (!r.ok) return r;
    const ch = r.data && Array.isArray(r.data.data) && r.data.data[0];
    if (!ch || ch.broadcaster_user_id == null) return { ok: false, error: 'not-found' };
    return { ok: true, id: String(ch.broadcaster_user_id) };
  }

  return { hasCredentials: () => !!creds(), token, clearToken, channels, broadcasterId };
}

module.exports = { createKickApi, retryAfterSec };
