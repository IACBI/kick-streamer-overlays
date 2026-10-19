#!/usr/bin/env node
'use strict';
// Creates Kick webhook subscriptions for chat messages and bans on your channel.
//
// Needs a Kick developer app. Credentials come from the environment (KICK_CLIENT_ID,
// KICK_CLIENT_SECRET) or from AYARLAR.local.js next to AYARLAR.js. They are never printed.
//
//   node relay/subscribe.js            create the subscriptions for the channel in AYARLAR.js
//   node relay/subscribe.js --list     list the subscriptions that exist for the channel
//
// Kick sends the events to the webhook address configured in your Kick app settings. This
// script does not set that address; see the README for where to find it.

const { loadConfig, fetchTimeout } = require('./config.js');
const { createKickApi } = require('./kick-api.js');

const EVENTS = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'moderation.banned', version: 1 }
];

async function call(url, options) {
  const res = await fetchTimeout(fetch, url, options);
  let body = null;
  try { body = await res.json(); } catch (e) { /* no JSON body */ }
  if (!res.ok) throw new Error(`${options && options.method || 'GET'} ${new URL(url).pathname} returned HTTP ${res.status}`);
  return body;
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

async function main() {
  const list = process.argv.includes('--list');
  const cfg = loadConfig();
  cfg.warnings.forEach((w) => console.warn('Warning:', w));
  if (!cfg.credentials) throw new Error('Kick app credentials are missing (set KICK_CLIENT_ID and KICK_CLIENT_SECRET, or AYARLAR.local.js).');
  if (!cfg.slug) throw new Error('Set kanal in AYARLAR.js (or KICK_CHANNEL).');
  const slug = cfg.slug;
  const api = createKickApi({ credentials: cfg.credentials });
  const t = await api.token();
  if (!t.ok) throw new Error(t.error === 'auth' ? 'Kick rejected the app credentials.' : `could not get an access token (${t.error})`);
  const b = await api.broadcasterId(slug);
  if (!b.ok) throw new Error(b.error === 'not-found' ? `channel "${slug}" was not found` : `could not look up the channel (${b.error})`);
  const bid = b.id;
  const auth = { Authorization: `Bearer ${t.token}`, Accept: 'application/json' };
  console.log(`Channel "${slug}" has broadcaster id ${bid}.`);

  if (list) {
    const body = await call(`https://api.kick.com/public/v1/events/subscriptions?broadcaster_user_id=${encodeURIComponent(bid)}`, { headers: auth });
    const items = (body && Array.isArray(body.data)) ? body.data : [];
    console.log(items.length ? `${items.length} subscription(s):` : 'No subscriptions yet.');
    items.forEach((s) => console.log(`  ${s.event || s.name || '?'}  ${s.id || s.subscription_id || ''}`));
    return;
  }

  const body = await call('https://api.kick.com/public/v1/events/subscriptions', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ events: EVENTS, method: 'webhook', broadcaster_user_id: bid })
  });
  const ids = findIds(body);
  console.log(`Subscribed to: ${EVENTS.map((e) => e.name).join(', ')}.`);
  console.log(ids.length ? `Subscription ids: ${ids.join(', ')}` : 'Kick accepted the request.');
  console.log('Next: start the relay (node relay/server.js) and make its webhook address public (see README).');
}

main().catch((e) => {
  console.error('Subscription failed:', e.message);
  process.exit(1);
});
