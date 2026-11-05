'use strict';
// Kick's own realtime feed, the one kick.com's chat uses: no developer app, no tunnel, no webhook.
//
// The relay asks web.kick.com for an anonymous connection token, opens Kick's realtime socket (Centrifugo protocol,
// JSON) and subscribes to the channel's chat room (chat, deletions, bans, subscriptions) and to the channel itself
// (Kicks). Kick lets only kick.com pages open that socket from a browser, so
// it has to run here, in the relay, and not in an overlay. The feed is not a documented API: anything Kick changes in
// it ends in a reconnect loop with a clear log line, and the signed webhooks keep working beside it.

const crypto = require('crypto');

const AUTH_URL = 'https://web.kick.com/api/v1/realtime/auth/connection';
const SOCKET_URL = 'wss://realtime.us-east-1.platform.kick.com/connection/websocket';
const MIN_RETRY_MS = 2000;
const MAX_RETRY_MS = 60000;
const STABLE_MS = 60000;            // a connection that lasted this long resets the retry delay
const IDLE_MS = 75000;              // the server pings every 25 s; this much silence means the socket is dead
const FETCH_TIMEOUT_MS = 10000;
const MAX_FRAME = 256 * 1024;

const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);
const str = (v, n) => cap(typeof v === 'string' ? v.trim() : '', n);
const idOf = (v) => (typeof v === 'number' || typeof v === 'string' ? cap(String(v), 64) : '');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v, min) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return Number.isSafeInteger(n) && n >= min ? n : null;
};
const nameOf = (u) => (isObj(u) ? str(u.username, 60) : '');

/**
 * Turns one realtime event into the relay's event shape (the same one relay/webhook.js makes from a webhook),
 * or null for events the overlays do not show.
 * @param {string} name e.g. "App\\Events\\ChatMessageEvent"
 * @param {any} b the event's data
 */
function normalizeLive(name, b) {
  if (!isObj(b)) return null;
  const ev = name.replace(/^App\\Events\\/, '');
  if (ev === 'ChatMessageEvent') {
    const s = b.sender;
    if (!isObj(s) || typeof b.content !== 'string' || !nameOf(s)) return null;
    const ident = isObj(s.identity) ? s.identity : {};
    const list = Array.isArray(ident.badges) ? ident.badges : [];
    return {
      kind: 'chat',
      id: idOf(b.id),
      senderId: idOf(s.id),
      broadcasterId: '',
      username: nameOf(s),
      color: str(ident.color, 16),
      message: cap(b.content, 500),
      badges: list.slice(0, 12).filter(isObj).map((x) => ({
        type: str(x.type, 40).toLowerCase(), text: str(x.text, 40), count: count(x.count, 0) || 0
      })),
      createdAt: str(b.created_at, 40)
    };
  }
  if (ev === 'MessageDeletedEvent') {
    const id = isObj(b.message) ? idOf(b.message.id) : '';
    return id ? { kind: 'delete', id } : null;
  }
  if (ev === 'UserBannedEvent') {
    const u = b.user;
    if (!isObj(u)) return null;
    return { kind: 'ban', userId: idOf(u.id), broadcasterId: '', username: nameOf(u).toLowerCase() };
  }
  if (ev === 'SubscriptionEvent') {
    if (!str(b.username, 60)) return null;
    const months = count(b.months, 1) || 1;
    return { kind: 'sub', broadcasterId: '', userId: '', username: str(b.username, 60), months, renewal: months > 1, createdAt: '' };
  }
  if (ev === 'GiftedSubscriptionsEvent') {
    const giftees = Array.isArray(b.gifted_usernames) ? b.gifted_usernames.filter((x) => typeof x === 'string') : [];
    if (giftees.length === 0) return null;
    const gifter = str(b.gifter_username, 60);
    return {
      kind: 'gift', broadcasterId: '', anonymous: !gifter, userId: '', username: gifter,
      count: giftees.length, giftees: giftees.slice(0, 10).map((x) => cap(x.trim(), 60)).filter(Boolean), createdAt: ''
    };
  }
  if (ev === 'KicksGifted') {
    const u = b.sender, gift = b.gift;
    if (!nameOf(u) || !isObj(gift)) return null;
    const amount = count(gift.amount, 1);
    if (amount === null) return null;
    return {
      kind: 'kicks', broadcasterId: '', userId: idOf(u.id), username: nameOf(u), amount,
      giftName: str(gift.name, 40), message: str(b.message, 200), createdAt: str(b.created_at, 40)
    };
  }
  return null;
}

/**
 * One realtime connection for one channel, reconnecting by itself.
 * @param {{ fetchImpl: typeof fetch, WebSocketImpl?: any, logger: any, onEvent: (ev: any) => void,
 *   onState?: (s: string) => void, authUrl?: string, socketUrl?: string, random?: () => number }} o
 */
function createKickLive(o) {
  const WS = o.WebSocketImpl || globalThis.WebSocket;
  const authUrl = o.authUrl || AUTH_URL;
  const socketUrl = o.socketUrl || SOCKET_URL;
  const random = o.random || Math.random;
  let room = '', channel = '', ws = null, timer = null, idle = null, retryMs = MIN_RETRY_MS, openedAt = 0;
  let state = 'off', stopped = true, lastError = '', warned = '';

  function setState(s) {
    if (s === state) return;
    state = s;
    if (o.onState) o.onState(s);
  }

  // One line per kind of failure, not one per retry: a down feed must not flood the relay log.
  // Kick's error texts end up in the message, so line breaks and other control characters are removed: a
  // crafted reason must not forge extra log lines or reach the studio's relay check as more than one line.
  function fail(msg) {
    // eslint-disable-next-line no-control-regex -- matching control characters is the point here
    const clean = String(msg).replace(/\r|\n/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');
    lastError = clean;
    if (warned !== clean) { warned = clean; o.logger.warn('  Kick live feed: ' + clean + ' Retrying by itself.'); }
  }

  async function token() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await o.fetchImpl(authUrl, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: crypto.randomUUID() })
      });
      if (!r.ok) throw new Error(`token request answered ${r.status}.`);
      const j = await r.json();
      const tk = j && j.data && j.data.token;
      if (typeof tk !== 'string' || !tk) throw new Error('token request gave no token.');
      return tk;
    } finally { clearTimeout(t); }
  }

  function close() {
    clearTimeout(idle);
    if (ws) {
      const s = ws; ws = null;
      s.onopen = s.onmessage = s.onerror = s.onclose = null;
      try { s.close(); } catch (e) { /* already closed */ }
    }
  }

  function retry() {
    close();
    if (stopped) return;
    setState('connecting');
    if (openedAt && Date.now() - openedAt >= STABLE_MS) retryMs = MIN_RETRY_MS;
    openedAt = 0;
    const wait = retryMs * (0.75 + random() * 0.5);
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    clearTimeout(timer);
    timer = setTimeout(connect, wait);
    if (timer.unref) timer.unref();
  }

  function alive() {
    clearTimeout(idle);
    idle = setTimeout(() => { fail('no data for a while.'); retry(); }, IDLE_MS);
    if (idle.unref) idle.unref();
  }

  function onFrame(line) {
    let d;
    try { d = JSON.parse(line); } catch (e) { return; }
    if (!isObj(d)) return;
    if (Object.keys(d).length === 0) { ws.send('{}'); return; }      // server ping
    if (d.error && d.id === 3) { o.logger.warn('  Kick live feed: Kick refused the channel feed, so Kicks come only through webhooks.'); return; }
    if (d.error) { fail(`Kick refused the ${d.id === 1 ? 'connection' : 'chat room'} (${str(d.error.message, 80) || (Number.isSafeInteger(d.error.code) ? d.error.code : 'error')}).`); retry(); return; }
    if (d.id === 1 && d.connect) {
      ws.send(JSON.stringify({ id: 2, subscribe: { channel: `chatrooms.${room}.v2` } }));
      if (channel) ws.send(JSON.stringify({ id: 3, subscribe: { channel: `channel_${channel}` } }));
      return;
    }
    if (d.id === 3) return;
    if (d.id === 2 && d.subscribe) {
      openedAt = Date.now();
      if (warned) o.logger.log('  Kick live feed: connected again.');
      else o.logger.log('  Kick live feed: connected, chat and subscriptions arrive without a tunnel.');
      warned = ''; lastError = '';
      setState('live');
      return;
    }
    const pub = d.push && d.push.pub && d.push.pub.data;
    if (!isObj(pub) || typeof pub.event !== 'string') return;
    let body = pub.data;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return; } }
    const ev = normalizeLive(pub.event, body);
    if (ev) o.onEvent(ev);
  }

  async function connect() {
    if (stopped) return;
    if (!WS) { fail('this Node.js has no WebSocket (Node.js 22 or newer is needed).'); setState('off'); return; }
    let tk;
    try { tk = await token(); } catch (e) { fail(e && e.name === 'AbortError' ? 'token request timed out.' : (e && e.message) || 'token request failed.'); retry(); return; }
    if (stopped) return;
    try { ws = new WS(socketUrl); } catch (e) { fail('could not open the socket.'); retry(); return; }
    alive();
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, connect: { token: tk, name: 'js' } }));
    ws.onmessage = (m) => {
      alive();
      const text = typeof m.data === 'string' ? m.data : '';
      if (text.length > MAX_FRAME) return;
      for (const line of text.split('\n')) if (line && ws) onFrame(line);
    };
    ws.onerror = () => {};
    ws.onclose = (e) => { if (!stopped) { fail(`socket closed (${e && Number.isSafeInteger(e.code) ? e.code : '?'}${e && e.reason ? ' ' + str(e.reason, 60) : ''}).`); retry(); } };
  }

  return {
    /**
     * Starts (or moves) the feed to a channel's chat room id and channel id; an empty room stops it.
     * @param {string | number} chatroomId @param {string | number} [channelId]
     */
    follow(chatroomId, channelId) {
      const next = chatroomId ? String(chatroomId) : '';
      const nextCh = channelId && /^\d{1,15}$/.test(String(channelId)) ? String(channelId) : '';
      if (next === room && nextCh === channel && !stopped) return;
      this.stop();
      room = next; channel = nextCh;
      if (!room || !/^\d{1,15}$/.test(room)) { room = ''; channel = ''; return; }
      stopped = false; retryMs = MIN_RETRY_MS; warned = '';
      setState('connecting');
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      close();
      setState('off');
    },
    status: () => ({ state, room, error: lastError })
  };
}

module.exports = { createKickLive, normalizeLive, AUTH_URL, SOCKET_URL };
