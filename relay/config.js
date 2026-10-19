'use strict';
// Settings shared by the relay server and the subscribe script: Kick app credentials and the
// channel name. Environment variables win, then AYARLAR.local.js / AYARLAR.js next to the repo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FETCH_TIMEOUT_MS = 10000;

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

module.exports = { ROOT, FETCH_TIMEOUT_MS, readSetting, normalizeSlug, loadConfig, fetchTimeout };
