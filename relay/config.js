'use strict';
// Settings shared by the relay server and the subscribe script: Kick app credentials and the
// channel name. Environment variables win, then AYARLAR.local.js / AYARLAR.js next to the repo.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FETCH_TIMEOUT_MS = 10000;
const RELAY_KEY_FILE = 'AYARLAR.relay.js';
const RELAY_KEY_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;

// Reads window.<key> from a classic settings file. The file is the user's own local config.
function readSetting(file, key) {
  if (!fs.existsSync(file)) return undefined;
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 1000 });
  return sandbox.window[key];
}

// Same normalization as the overlay's "kanal" setting, so both sides agree on the slug.
function normalizeSlug(value) {
  let s = String(value == null ? '' : value).trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\//i, '').replace(/^@/, '');
  s = s.split(/[/?#]/)[0];
  return s.toLowerCase().slice(0, 40);
}

// Never throws: a broken settings file is reported in `warnings` and treated as absent.
function loadConfig(opts) {
  const o = Object.assign({ root: ROOT, env: process.env }, opts || {});
  const warnings = [];
  const safe = (file, key) => {
    try { return readSetting(path.join(o.root, file), key); } catch (e) {
      warnings.push(`${file} could not be read (${e.message})`);
      return undefined;
    }
  };
  const local = safe('AYARLAR.local.js', 'KICK_OVERLAY_YEREL') || {};
  const pub = safe('AYARLAR.js', 'KICK_OVERLAY_AYARLAR') || {};
  const id = o.env.KICK_CLIENT_ID || local.kickClientId;
  const secret = o.env.KICK_CLIENT_SECRET || local.kickClientSecret;
  return {
    credentials: id && secret ? { id: String(id), secret: String(secret) } : null,
    slug: normalizeSlug(o.env.KICK_CHANNEL || pub.kanal),
    warnings
  };
}

// fetch with a hard timeout, so a stalled upstream can never hang a request or the relay.
function fetchTimeout(fetchImpl, url, options, ms) {
  return fetchImpl(url, Object.assign({}, options, { signal: AbortSignal.timeout(ms || FETCH_TIMEOUT_MS) }));
}

// The events port key. Overlays read it from AYARLAR.relay.js; a sandboxed iframe can send
// Origin "null" too, so this key is what keeps other local pages out of the events API.
function loadRelayKey(opts) {
  const o = Object.assign({ root: ROOT, env: process.env }, opts || {});
  if (typeof o.env.RELAY_KEY === 'string' && o.env.RELAY_KEY) return o.env.RELAY_KEY;
  const file = path.join(o.root, RELAY_KEY_FILE);
  let key;
  try { key = readSetting(file, 'KICK_RELAY_KEY'); } catch (e) { key = undefined; }
  if (typeof key === 'string' && RELAY_KEY_FORMAT.test(key)) return key;
  key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, `window.KICK_RELAY_KEY = "${key}";\n`, { mode: 0o600 });
  return key;
}

module.exports = { ROOT, FETCH_TIMEOUT_MS, readSetting, normalizeSlug, loadConfig, fetchTimeout, loadRelayKey };
