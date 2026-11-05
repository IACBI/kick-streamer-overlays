'use strict';
// Record mode (--record or RELAY_RECORD=1): every verified webhook from Kick is saved to recordings/ with the
// personal data replaced, so real deliveries can become test fixtures and a change in Kick's payloads shows up
// before it breaks an overlay. tools/check-recordings.js runs the saved files through the relay's event mapping.

const fs = require('fs');
const path = require('path');

const MAX_FILES = 500;
const MAX_BYTES = 64 * 1024;
// Keys whose text identifies a person or repeats what they wrote. Structure and every other value are kept.
const NAME_KEYS = new Set(['username', 'channel_slug', 'slug']);
const TEXT_KEYS = new Set(['content', 'message', 'title', 'stream_title', 'bio']);
const ID_KEYS = new Set(['user_id', 'broadcaster_user_id', 'id', 'message_id', 'redemption_id']);
const PICTURE_KEYS = new Set(['profile_picture', 'avatar', 'banner_picture']);

/**
 * A copy of a webhook body with names, ids, pictures and message text replaced by stable placeholders. The same
 * value maps to the same placeholder within one body, so relations (sender is broadcaster, say) survive.
 * @param {unknown} body
 */
function redact(body) {
  const names = new Map(), ids = new Map();
  const nameOf = (v) => { if (!names.has(v)) names.set(v, `user_${names.size + 1}`); return names.get(v); };
  const idOf = (v) => { const k = String(v); if (!ids.has(k)) ids.set(k, 1000 + ids.size + 1); return ids.get(k); };
  function walk(node, key) {
    if (Array.isArray(node)) return node.map((n) => walk(n, key));
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
      return out;
    }
    if (node === null || node === undefined || typeof node === 'boolean') return node;
    if (NAME_KEYS.has(key) && typeof node === 'string' && node) return nameOf(node.toLowerCase());
    if (ID_KEYS.has(key) && (typeof node === 'number' || typeof node === 'string') && String(node) !== '') {
      const n = idOf(node);
      return typeof node === 'number' ? n : String(n);
    }
    if (PICTURE_KEYS.has(key) && typeof node === 'string' && node) return 'https://files.kick.com/images/redacted.webp';
    if (TEXT_KEYS.has(key) && typeof node === 'string' && node) return `redacted text (${node.length} chars)`;
    return node;
  }
  return walk(body, '');
}

/**
 * Saves redacted webhooks as recordings/<time>-<type>.json, at most MAX_FILES per run.
 * @param {{ dir: string, logger: { log: Function, warn: Function } }} o
 */
function createRecorder(o) {
  let count = 0, warned = false;
  try { fs.mkdirSync(o.dir, { recursive: true }); } catch (e) { o.logger.warn('Record mode: cannot create', o.dir, e.message); }
  return {
    /** @param {string} type @param {unknown} body */
    save(type, body) {
      if (count >= MAX_FILES) {
        if (!warned) { warned = true; o.logger.warn(`Record mode: ${MAX_FILES} files saved; the rest of this run is not recorded.`); }
        return;
      }
      const safeType = String(type || 'unknown').replace(/[^a-z0-9._-]/gi, '_').slice(0, 60);
      const text = JSON.stringify({ type: safeType, recordedAt: new Date().toISOString(), body: redact(body) }, null, 2) + '\n';
      if (Buffer.byteLength(text) > MAX_BYTES) return;
      count += 1;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.writeFileSync(path.join(o.dir, `${stamp}-${String(count).padStart(3, '0')}-${safeType}.json`), text, 'utf8'); } catch (e) {
        o.logger.warn('Record mode: could not save a webhook:', e.message);
      }
    }
  };
}

module.exports = { redact, createRecorder };
