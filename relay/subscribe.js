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

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EVENTS = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'moderation.banned', version: 1 }
];

// Reads window.<key> from a classic settings file. The file is the user's own local config.
function readSetting(file, key) {
  if (!fs.existsSync(file)) return undefined;
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file, timeout: 1000 });
  return sandbox.window[key];
}

function credentials() {
  const local = readSetting(path.join(ROOT, 'AYARLAR.local.js'), 'KICK_OVERLAY_YEREL') || {};
  const id = process.env.KICK_CLIENT_ID || local.kickClientId;
  const secret = process.env.KICK_CLIENT_SECRET || local.kickClientSecret;
  if (!id || !secret) throw new Error('Kick app credentials are missing (set KICK_CLIENT_ID and KICK_CLIENT_SECRET, or AYARLAR.local.js).');
  return { id, secret };
}

function channelSlug() {
  const s = readSetting(path.join(ROOT, 'AYARLAR.js'), 'KICK_OVERLAY_AYARLAR') || {};
  const slug = String(process.env.KICK_CHANNEL || s.kanal || '').trim().toLowerCase();
  if (!slug) throw new Error('Set kanal in AYARLAR.js (or KICK_CHANNEL).');
  return slug;
}

async function call(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch (e) { /* no JSON body */ }
  if (!res.ok) throw new Error(`${options && options.method || 'GET'} ${new URL(url).pathname} returned HTTP ${res.status}`);
  return body;
}

async function accessToken({ id, secret }) {
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
  const body = await call('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString()
  });
  if (!body || typeof body.access_token !== 'string') throw new Error('no access token in the response');
  return body.access_token;
}

async function broadcasterId(token, slug) {
  const body = await call(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const ch = body && Array.isArray(body.data) && body.data[0];
  if (!ch || ch.broadcaster_user_id == null) throw new Error(`channel "${slug}" was not found`);
  return ch.broadcaster_user_id;
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
  const creds = credentials();
  const slug = channelSlug();
  const token = await accessToken(creds);
  const bid = await broadcasterId(token, slug);
  const auth = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
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
