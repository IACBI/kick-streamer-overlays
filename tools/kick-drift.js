#!/usr/bin/env node
'use strict';
// Checks that the Kick endpoints the pack relies on still answer in the shape it parses. Run daily by
// .github/workflows/kick-drift.yml, so a change on Kick's side shows up as an issue before streamers notice.
//
//   node tools/kick-drift.js [channel]      (default: KICK_DRIFT_CHANNEL or "iacbi")
//
// Exit 1 only when Kick answered and the answer no longer parses. A block (403, 429) or an outage is reported as
// inconclusive and exits 0: GitHub's runners are often refused by Kick's bot protection, and that is not drift.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TIMEOUT_MS = 15000;

function loadCore() {
  const ctx = { console, Intl, Date, JSON, Math };
  vm.createContext(ctx);
  const file = path.join(__dirname, '..', 'shared', 'kick-core.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  return ctx.KickOverlay;
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'kick-streamer-overlays drift check' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) { return { status: 0, error: e.message }; }
  let body = null;
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, body };
}

/**
 * One check: `ok` true (shape as expected), false (drift), or null (inconclusive).
 * @typedef {{ name: string, ok: boolean | null, detail: string }} Result
 */

/** @param {string} channel @returns {Promise<Result[]>} */
async function run(channel) {
  const K = loadCore();
  const out = [];
  const inconclusive = (r) => r.status === 0 || r.status === 403 || r.status === 429 || r.status >= 500;

  const key = await getJson('https://api.kick.com/public/v1/public-key');
  if (inconclusive(key)) out.push({ name: 'webhook public key', ok: null, detail: `HTTP ${key.status || key.error}` });
  else {
    const pem = key.body && key.body.data && key.body.data.public_key;
    out.push({ name: 'webhook public key', ok: key.status === 200 && typeof pem === 'string' && pem.includes('BEGIN PUBLIC KEY'), detail: `HTTP ${key.status}` });
  }

  for (const ver of ['v2', 'v1']) {
    const r = await getJson(`https://kick.com/api/${ver}/channels/${encodeURIComponent(channel)}`);
    const name = `public channel ${ver}`;
    if (inconclusive(r)) { out.push({ name, ok: null, detail: `HTTP ${r.status || r.error}` }); continue; }
    if (r.status !== 200 || !r.body) { out.push({ name, ok: false, detail: `HTTP ${r.status}, no JSON` }); continue; }
    const followers = K.parse.followers(r.body);
    const live = K.parse.live(r.body);
    const ok = typeof followers === 'number' && followers >= 0 && live && typeof live.live === 'boolean';
    out.push({ name, ok, detail: ok ? `followers ${followers}, live ${live.live}` : 'followers or livestream fields not found' });
  }
  return out;
}

if (require.main === module) {
  const channel = (process.argv[2] || process.env.KICK_DRIFT_CHANNEL || 'iacbi').toLowerCase();
  run(channel).then((results) => {
    for (const r of results) console.log(`${r.ok === true ? 'ok          ' : r.ok === false ? 'DRIFT       ' : 'inconclusive'}  ${r.name}: ${r.detail}`);
    const drift = results.filter((r) => r.ok === false);
    if (drift.length) console.log(`\n${drift.length} check(s) show that Kick changed: ${drift.map((r) => r.name).join(', ')}.`);
    process.exit(drift.length ? 1 : 0);
  }, (e) => { console.error('drift check aborted:', e.message); process.exit(2); });
}

module.exports = { run };
