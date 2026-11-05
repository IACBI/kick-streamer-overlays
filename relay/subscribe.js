#!/usr/bin/env node
'use strict';
// Creates Kick webhook subscriptions on your channel: chat messages and bans for the chat overlay, follows,
// subscriptions, gifted subscriptions and Kicks for the alert overlay, and stream start/end and title changes
// for the info panel.
//
// Needs a Kick developer app. Credentials come from the environment (KICK_CLIENT_ID,
// KICK_CLIENT_SECRET) or from AYARLAR.local.js next to AYARLAR.js. They are never printed.
//
//   node relay/subscribe.js            create the missing subscriptions for the channel in AYARLAR.js
//   node relay/subscribe.js --list     list the subscriptions that exist for the channel
//   kick-relay-win-x64.exe subscribe [--list]   the same from the single-file relay executable
//
// Kick sends the events to the webhook address configured in your Kick app settings. This
// script does not set that address; see the README for where to find it.

const { loadConfig, fetchTimeout } = require('./config.js');
const { createKickApi } = require('./kick-api.js');
const { EVENT_TYPES } = require('./webhook.js');

const EVENTS = EVENT_TYPES.map((name) => ({ name, version: 1 }));

async function call(url, options, fetchImpl) {
  const res = await fetchTimeout(fetchImpl || fetch, url, options);
  let body = null;
  try { body = await res.json(); } catch (e) { /* no JSON body */ }
  if (!res.ok) throw Object.assign(new Error(`${options && options.method || 'GET'} ${new URL(url).pathname} returned HTTP ${res.status}`), { code: 'upstream', status: res.status });
  return body;
}

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * Makes sure the channel has a webhook subscription for every event the overlays use. Only the missing ones are
 * requested, so a second run cannot create duplicates (which would make Kick deliver everything twice).
 * Errors carry a code: no-credentials, no-channel, auth, not-found, upstream.
 * @param {{ api: any, slug: string, apiBase?: string, fetchImpl?: typeof fetch, list?: boolean }} o
 */
async function ensureSubscriptions(o) {
  const apiBase = o.apiBase || 'https://api.kick.com';
  if (!o.api.hasCredentials()) throw fail('no-credentials', 'Kick app credentials are missing (set KICK_CLIENT_ID and KICK_CLIENT_SECRET, or AYARLAR.local.js).');
  if (!o.slug) throw fail('no-channel', 'Set kanal in AYARLAR.js (or KICK_CHANNEL).');
  const t = await o.api.token();
  if (!t.ok) throw fail(t.error === 'auth' ? 'auth' : 'upstream', t.error === 'auth' ? 'Kick rejected the app credentials.' : `could not get an access token (${t.error})`);
  const b = await o.api.broadcasterId(o.slug);
  if (!b.ok) throw fail(b.error === 'not-found' ? 'not-found' : 'upstream', b.error === 'not-found' ? `channel "${o.slug}" was not found` : `could not look up the channel (${b.error})`);
  const auth = { Authorization: `Bearer ${t.token}`, Accept: 'application/json' };
  const existing = await call(`${apiBase}/public/v1/events/subscriptions?broadcaster_user_id=${encodeURIComponent(b.id)}`, { headers: auth }, o.fetchImpl);
  const have = subscribedEvents(existing);
  const items = existing && Array.isArray(existing.data) ? existing.data : [];
  if (o.list) return { broadcasterId: b.id, items, added: [], existing: EVENTS.filter((e) => have.has(e.name)).map((e) => e.name), ids: [] };
  const missing = EVENTS.filter((e) => !have.has(e.name));
  let ids = [];
  if (missing.length) {
    const body = await call(`${apiBase}/public/v1/events/subscriptions`, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify(subscriptionBody(missing, b.id))
    }, o.fetchImpl);
    ids = findIds(body);
  }
  return { broadcasterId: b.id, items, added: missing.map((e) => e.name), existing: EVENTS.filter((e) => have.has(e.name)).map((e) => e.name), ids };
}

// Finds every "subscription_id" in an arbitrary response, so the output does not depend on its nesting.
function findIds(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => findIds(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'subscription_id' && (typeof v === 'string' || typeof v === 'number')) out.push(String(v));
      else findIds(v, out);
    }
  }
  return out;
}

// Event names that already have a subscription, from the list response (each item names its event in "event").
function subscribedEvents(body) {
  const items = body && Array.isArray(body.data) ? body.data : [];
  return new Set(items.map((s) => s && (s.event || s.name)).filter((n) => typeof n === 'string'));
}

// Request body for POST /events/subscriptions. Kick answers 400 when broadcaster_user_id is a string,
// and the relay keeps ids as strings, so it is converted here.
function subscriptionBody(events, broadcasterId) {
  return { events, method: 'webhook', broadcaster_user_id: Number(broadcasterId) };
}

/** @param {string[]} argv command line arguments after the script name */
async function main(argv) {
  const list = argv.includes('--list');
  const cfg = loadConfig();
  cfg.warnings.forEach((w) => console.warn('Warning:', w));
  const api = createKickApi({ credentials: cfg.credentials });
  const r = await ensureSubscriptions({ api, slug: cfg.slug, list });
  console.log(`Channel "${cfg.slug}" has broadcaster id ${r.broadcasterId}.`);
  if (list) {
    console.log(r.items.length ? `${r.items.length} subscription(s):` : 'No subscriptions yet.');
    r.items.forEach((s) => console.log(`  ${s.event || s.name || '?'}  ${s.id || s.subscription_id || ''}`));
    return;
  }
  if (r.added.length === 0) {
    console.log(`Already subscribed to all ${EVENTS.length} events. Nothing to do.`);
    return;
  }
  console.log(`Subscribed to: ${r.added.join(', ')}.`);
  if (r.existing.length) console.log(`Already subscribed before: ${r.existing.join(', ')}.`);
  console.log(r.ids.length ? `Subscription ids: ${r.ids.join(', ')}` : 'Kick accepted the request.');
  console.log('Next: start the relay and make its webhook address public (see README).');
}

/** Runs the command line and exits 1 with the reason on failure. @param {string[]} argv */
function cli(argv) {
  return main(argv).catch((e) => {
    console.error('Subscription failed:', e.message);
    process.exit(1);
  });
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { cli, EVENTS, subscribedEvents, subscriptionBody, ensureSubscriptions };
