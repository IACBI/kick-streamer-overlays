'use strict';
// Guided setup: asks for the channel and the Kick app credentials, checks them against Kick, and saves them.
//   node relay/setup.js      or      kick-relay(.exe) setup
// The credentials go to the git-ignored AYARLAR.local.js and the channel to AYARLAR.js, the files the relay and
// the overlays already read. The secret is never echoed or printed.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { ROOT, readSetting, normalizeSlug } = require('./config.js');
const { createKickApi } = require('./kick-api.js');

const LOCAL_FILE = 'AYARLAR.local.js';
const PUBLIC_FILE = 'AYARLAR.js';
const CRED = /^[^\s"'`\\]{1,400}$/;
const SLUG = /^[a-z0-9_-]{1,40}$/;
// The kanal line of AYARLAR.js as shipped; the rest of the file (comments included) is left as it is.
const KANAL_LINE = /^(\s*kanal\s*:\s*)(["'])[^"'\n]*\2/m;

/**
 * Writes the credentials into AYARLAR.local.js, keeping any other keys already there. The file is rewritten as
 * plain JSON, so comments in it are not kept.
 * @param {string} root
 * @param {{ id: string, secret: string }} creds
 */
function saveCredentials(root, creds) {
  const file = path.join(root, LOCAL_FILE);
  let current;
  try { current = readSetting(file, 'KICK_OVERLAY_YEREL') || {}; } catch (e) { current = {}; }
  const next = Object.assign({}, typeof current === 'object' ? current : {}, { kickClientId: creds.id, kickClientSecret: creds.secret });
  const text = '// Kick app credentials. Private: never share or commit this file (.gitignore lists it).\n'
    + `window.KICK_OVERLAY_YEREL = ${JSON.stringify(next, null, 2)};\n`;
  fs.writeFileSync(file, text, { mode: 0o600 });
}

/**
 * Sets kanal in AYARLAR.js in place. Returns false when the file has no kanal line to change.
 * @param {string} root
 * @param {string} slug
 */
function saveChannel(root, slug) {
  const file = path.join(root, PUBLIC_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
  if (!KANAL_LINE.test(text)) return false;
  fs.writeFileSync(file, text.replace(KANAL_LINE, (m, head) => `${head}"${slug}"`));
  return true;
}

/**
 * Runs the questions. `ask(question, hidden)` returns the answer; `say(line)` prints.
 * @param {{ ask: (q: string, hidden?: boolean) => Promise<string>, say: (line: string) => void, root?: string,
 *   env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch, apiBase?: string, tokenBase?: string }} io
 * @returns {Promise<boolean>} true when the settings were saved
 */
async function runSetup(io) {
  const o = Object.assign({ root: ROOT, env: process.env, fetchImpl: globalThis.fetch }, io);
  const say = o.say;
  let pub;
  try { pub = readSetting(path.join(o.root, PUBLIC_FILE), 'KICK_OVERLAY_AYARLAR') || {}; } catch (e) { pub = {}; }
  const known = normalizeSlug(pub.kanal !== undefined ? pub.kanal : pub.channel);

  say('Kick relay setup');
  say('You need a Kick app: kick.com/settings/developer -> Create app. Its Client ID and Client Secret are on the app page.');
  say('');

  let slug = '';
  while (!slug) {
    const a = normalizeSlug(await o.ask(known ? `Channel name [${known}]: ` : 'Channel name (as in kick.com/NAME): '));
    slug = a || known;
    if (!SLUG.test(slug)) { say('  Use only letters, digits, "_" and "-".'); slug = ''; }
  }
  let id = '';
  while (!id) {
    id = (await o.ask('Client ID: ')).trim();
    if (!CRED.test(id)) { say('  That does not look like a Client ID.'); id = ''; }
  }
  let secret = '';
  while (!secret) {
    secret = (await o.ask('Client Secret (not shown while typing): ', true)).trim();
    if (!CRED.test(secret)) { say('  That does not look like a Client Secret.'); secret = ''; }
  }

  say('');
  say('Checking with Kick...');
  const apiOpts = { fetchImpl: o.fetchImpl, credentials: { id, secret } };
  if (o.apiBase) apiOpts.apiBase = o.apiBase;
  if (o.tokenBase) apiOpts.tokenBase = o.tokenBase;
  const api = createKickApi(apiOpts);
  const t = await api.token();
  let ok = false;
  if (!t.ok) {
    say(t.error === 'auth' ? '  Kick rejected the Client ID or Client Secret.' : `  Could not reach Kick (${t.error}).`);
  } else {
    const b = await api.broadcasterId(slug);
    if (b.ok) { ok = true; say(`  OK: the app works and channel "${slug}" was found.`); }
    else say(b.error === 'not-found' ? `  The app works, but channel "${slug}" was not found.` : `  The app works, but the channel lookup failed (${b.error}).`);
  }
  if (!ok) {
    const again = (await o.ask('Save anyway? [y/N]: ')).trim().toLowerCase();
    if (again !== 'y' && again !== 'yes' && again !== 'e' && again !== 'evet') { say('Nothing was saved.'); return false; }
  }

  saveCredentials(o.root, { id, secret });
  say(`Saved the app credentials to ${LOCAL_FILE} (private, git-ignored).`);
  if (slug !== known) {
    if (saveChannel(o.root, slug)) say(`Set kanal to "${slug}" in ${PUBLIC_FILE}.`);
    else say(`Could not find the kanal line in ${PUBLIC_FILE}: set kanal: "${slug}" there yourself.`);
  }
  if (o.env.KICK_CLIENT_ID || o.env.KICK_CLIENT_SECRET) say('Note: KICK_CLIENT_ID / KICK_CLIENT_SECRET are set in this shell and win over the saved file.');
  say('');
  say('Next: subscribe to the events once (setup does not do this), then start (or restart) the relay:');
  say('  node relay/subscribe.js   or   kick-relay subscribe');
  say('  node relay/server.js --tunnel   or   kick-relay --tunnel');
  return true;
}

// One line reader for the whole run: a piped answer file arrives in one chunk, and a reader per question would
// drop the lines after the first. When input ends, every open question fails instead of looping on ''.
let reader = null;
const queued = [], waiting = [];
let inputEnded = false;
function openReader() {
  reader = readline.createInterface({ input: process.stdin, terminal: false });
  reader.on('line', (l) => { if (waiting.length) waiting.shift().resolve(l); else queued.push(l); });
  reader.on('close', () => {
    reader = null;
    if (!process.stdin.isTTY || process.stdin.readableEnded) inputEnded = true;
    while (waiting.length) waiting.shift().reject(new Error('input ended'));
  });
}
function nextLine() {
  if (queued.length) return Promise.resolve(queued.shift());
  if (inputEnded) return Promise.reject(new Error('input ended'));
  if (!reader) openReader();
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

// Reads one answer from the terminal. A hidden answer is read in raw mode, so nothing typed appears on screen.
function terminalAsk(question, hidden) {
  const input = process.stdin, output = process.stdout;
  if (!hidden || !input.isTTY || typeof input.setRawMode !== 'function') {
    output.write(question);
    return nextLine();
  }
  // The line reader would also collect the raw keystrokes, secret included, so it is closed first.
  if (reader) { const r = reader; reader = null; r.removeAllListeners('close'); r.close(); }
  return new Promise((resolve, reject) => {
    output.write(question);
    let buf = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const finish = (err) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (err) reject(err); else resolve(buf);
    };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(null);
        if (ch === '\u0003') return finish(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else if (ch >= ' ') buf += ch;
      }
    }
    input.on('data', onData);
  });
}

/** Runs the command line and exits 1 on failure. */
function cli() {
  return runSetup({ ask: terminalAsk, say: (l) => console.log(l) }).then((saved) => {
    process.exitCode = saved ? 0 : 1;
  }, (e) => {
    console.error('Setup stopped:', e.message);
    process.exit(1);
  });
}

if (require.main === module) cli();

module.exports = { cli, runSetup, saveCredentials, saveChannel };
