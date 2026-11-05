'use strict';
// The overlay pack served from the relay's local port, so the studio, the dock and every overlay open from
// http://127.0.0.1:8790/ instead of file://. One address works in any browser and in OBS (a "Local file" source
// cannot reach the relay), and settings saved from the studio reach every overlay without new links.
//
// Only the pack's own files are served: the top-level pages and a few folders, by extension. Nothing else in the
// folder (AYARLAR.local.js with the Kick secret, the stats file, the relay executable) can be read through it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2'
};
const DIRS = new Set(['shared', 'alerts', 'badges', 'branding']);
const PAGE = /^[a-z0-9-]+\.html$/;
const MAX_FILE = 64 * 1024 * 1024;
const LOOPBACK_NAME = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;
const PUBLIC_FILE = 'AYARLAR.js';
const LOCAL_FILE = 'AYARLAR.local.js';
const BACKUP_FILE = 'AYARLAR.backup.js';

// Same headers on every page: no sniffing, and no other site may frame the dock or the studio.
const PUBLIC_KEY_SCRIPT = `// Served by a relay on a public address. The key is not in this file: the page's link or this browser has it.
window.KICK_RELAY_SELF = true;
(function () {
  var k = null;
  try { k = new URLSearchParams(location.search).get('key'); } catch (e) { k = null; }
  if (!k) { try { k = localStorage.getItem('kickRelayKey'); } catch (e) { k = null; } }
  if (k && /^[A-Za-z0-9_-]{32,128}$/.test(k)) window.KICK_RELAY_KEY = k;
})();
`;

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Cross-Origin-Resource-Policy': 'same-origin'
};

/**
 * Maps a URL path to a file the pack may serve, or null.
 * @param {string} root
 * @param {string} pathname
 * @returns {{ file: string, type: string } | null}
 */
function resolveStatic(root, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return null; }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p.startsWith('.'))) return null;
  if (parts.length === 1 ? !PAGE.test(parts[0]) : !DIRS.has(parts[0])) return null;
  const type = TYPES[path.extname(parts[parts.length - 1]).toLowerCase()];
  if (!type) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, ...parts);
  if (!file.startsWith(base + path.sep)) return null;
  return { file, type };
}

// The access key as a script for pages the relay serves itself. Only a page of this origin may load it: another
// web site could include it with a <script> tag, which no CORS rule stops, so the browser's Sec-Fetch-Site header
// decides. A client without that header (not a browser) is not a web page another site controls.
function keyScriptAllowed(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined) return site === 'same-origin' || site === 'none';
  const ref = req.headers.referer;
  if (!ref) return true;
  try { return LOOPBACK_NAME.test(new URL(ref).hostname); } catch (e) { return false; }
}

// Reads window.<name> from a classic settings file without running it in the relay's own context.
function readWindowValue(file, name) {
  if (!fs.existsSync(file)) return undefined;
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 1000 });
  return sandbox.window[name];
}

// kick-core.js under Node, for the same normalization the overlays apply. Loaded once, on first use.
function loadCore(siteRoot) {
  const sandbox = { console };
  vm.createContext(sandbox);
  const file = path.join(siteRoot, 'shared', 'kick-core.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 2000 });
  return sandbox.KickOverlay;
}

// Writes next to the target and renames, so an overlay never loads a half-written file.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* gone */ } throw e; }
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The pack's pages and the settings files, for one relay.
 * @param {{ siteRoot: string, configRoot: string, accessKey: () => string, publicMode?: boolean }} o
 */
function createSite(o) {
  let core = null;
  const K = () => core || (core = loadCore(o.siteRoot));
  const publicFile = () => path.join(o.configRoot, PUBLIC_FILE);
  const localFile = () => path.join(o.configRoot, LOCAL_FILE);

  function sendText(req, res, status, type, body, extra) {
    const buf = Buffer.from(body, 'utf8');
    res.writeHead(status, Object.assign({ 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store' }, BASE_HEADERS, extra || {}));
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  async function sendFile(req, res, hit) {
    let st;
    try {
      // A link inside the folder must not lead outside it.
      const real = await fs.promises.realpath(hit.file);
      const base = await fs.promises.realpath(o.siteRoot);
      if (!real.startsWith(base + path.sep)) return false;
      st = await fs.promises.stat(real);
      if (!st.isFile() || st.size > MAX_FILE) return false;
      hit = { file: real, type: hit.type };
    } catch (e) { return false; }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const headers = Object.assign({ 'Content-Type': hit.type, 'Cache-Control': 'no-cache', ETag: etag }, BASE_HEADERS);
    if (hit.type === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return true; }
    const stream = fs.createReadStream(hit.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }

  /**
   * Serves a page or asset. Returns false when the path is not one of the pack's files.
   * @returns {Promise<boolean>}
   */
  async function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname === '/') {
      res.writeHead(302, Object.assign({ Location: '/studio.html', 'Cache-Control': 'no-store', 'Content-Length': 0 }, BASE_HEADERS));
      res.end();
      return true;
    }
    if (pathname === '/AYARLAR.relay.js') {
      // On a public address anyone can load the pages, so the key is never handed out: the owner's browser brings it
      // (the studio asks once and keeps it; an OBS link carries it).
      if (o.publicMode) {
        sendText(req, res, 200, 'text/javascript; charset=utf-8', PUBLIC_KEY_SCRIPT);
        return true;
      }
      if (!keyScriptAllowed(req)) {
        sendText(req, res, 403, 'text/javascript; charset=utf-8', '// Only pages served by this relay can load its key.\n');
        return true;
      }
      sendText(req, res, 200, 'text/javascript; charset=utf-8',
        `// Served by the relay for its own pages.\nwindow.KICK_RELAY_KEY = ${JSON.stringify(o.accessKey())};\nwindow.KICK_RELAY_SELF = true;\n`);
      return true;
    }
    // The pages that read app credentials get an empty file: the relay keeps the secret and answers for it.
    if (pathname === '/' + LOCAL_FILE) {
      sendText(req, res, 200, 'text/javascript; charset=utf-8', '// The relay keeps the Kick app credentials; pages never receive them.\n');
      return true;
    }
    if (pathname === '/' + PUBLIC_FILE) {
      let text;
      try { text = fs.readFileSync(publicFile(), 'utf8'); } catch (e) { text = 'window.KICK_OVERLAY_AYARLAR = window.KICK_OVERLAY_AYARLAR || {};\n'; }
      sendText(req, res, 200, 'text/javascript; charset=utf-8', text);
      return true;
    }
    const hit = resolveStatic(o.siteRoot, pathname);
    return hit ? sendFile(req, res, hit) : false;
  }

  // A number that changes whenever AYARLAR.js does, by the studio or by hand. Pages served here poll it.
  function settingsRev() {
    try { return Math.floor(fs.statSync(publicFile()).mtimeMs); } catch (e) { return 0; }
  }

  function readPublic() {
    const v = readWindowValue(publicFile(), 'KICK_OVERLAY_AYARLAR');
    return isPlainObject(v) ? v : {};
  }

  /**
   * Saves the public settings to AYARLAR.js. Values are normalized by kick-core, and only those that differ from
   * the defaults are written, as plain data. The previous file is kept as AYARLAR.backup.js.
   * @param {any} raw
   */
  function writePublic(raw) {
    if (!isPlainObject(raw)) return { ok: false, error: 'bad settings' };
    let core;
    try { core = K(); } catch (e) { return { ok: false, error: 'pack missing' }; }
    const keys = core.schemaKeys();
    const known = {};
    const aliasOf = core.aliases();
    Object.keys(aliasOf).forEach((name) => { if (Object.hasOwn(raw, name)) known[name] = raw[name]; });
    keys.forEach((k) => { if (Object.hasOwn(raw, k)) known[k] = raw[k]; });
    // relayAdresi is local-only and kept from the file: a page served here already talks to this relay.
    const before = readPublic();
    const s = core.normalize(known), d = core.normalize({});
    // Written with the English names, which every reader accepts; the Turkish ones still work in hand-written files.
    const en = {};
    const aliases = core.aliases();
    Object.keys(aliases).forEach((name) => { en[aliases[name]] = name; });
    const out = {};
    keys.forEach((k) => { if (s[k] !== d[k]) out[en[k] || k] = s[k]; });
    const relay = typeof before.relayAdresi === 'string' ? before.relayAdresi : before.relayAddress;
    if (typeof relay === 'string') out.relayAddress = relay;
    const text = '// Kick Overlay Pack settings, saved by the studio. Every key is described in docs/settings.md.\n'
      + '// Edit here or in the studio; overlays served by the relay pick up a change within a few seconds.\n'
      + 'window.KICK_OVERLAY_AYARLAR = ' + JSON.stringify(out, null, 2) + ';\n';
    try {
      if (fs.existsSync(publicFile())) fs.copyFileSync(publicFile(), path.join(o.configRoot, BACKUP_FILE));
      writeAtomic(publicFile(), text);
    } catch (e) { return { ok: false, error: 'write failed' }; }
    return { ok: true, rev: settingsRev(), channel: s.kanal || '' };
  }

  /**
   * Saves the Kick app credentials to AYARLAR.local.js (git-ignored). Both fields are needed; empty strings
   * remove them. The values are never sent back.
   * @param {any} body
   */
  function writeLocal(body) {
    if (!isPlainObject(body)) return { ok: false, error: 'bad body' };
    const id = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const secret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    if ((id === '') !== (secret === '')) return { ok: false, error: 'both needed' };
    if (id.length > 200 || secret.length > 200 || /[\s'"\\]/.test(id + secret)) return { ok: false, error: 'bad value' };
    let current = {};
    try { const v = readWindowValue(localFile(), 'KICK_OVERLAY_YEREL'); if (isPlainObject(v)) current = v; } catch (e) { /* broken file: replaced */ }
    /** @type {Record<string, unknown>} */
    const next = Object.assign({}, current);
    if (id) { next.kickClientId = id; next.kickClientSecret = secret; } else { delete next.kickClientId; delete next.kickClientSecret; }
    const text = '// Kick app credentials, saved by the studio through the relay. Keep this file private; it is git-ignored.\n'
      + 'window.KICK_OVERLAY_YEREL = ' + JSON.stringify(next, null, 2) + ';\n';
    try { writeAtomic(localFile(), text); } catch (e) { return { ok: false, error: 'write failed' }; }
    return { ok: true, saved: !!id };
  }

  // Whether the pack's pages sit next to the relay (the executable may have been started from another folder).
  const hasPack = () => fs.existsSync(path.join(o.siteRoot, 'studio.html')) && fs.existsSync(path.join(o.siteRoot, 'shared', 'kick-core.js'));

  return { serve, settingsRev, readPublic, writePublic, writeLocal, hasPack };
}

module.exports = { createSite, resolveStatic, keyScriptAllowed, TYPES };
