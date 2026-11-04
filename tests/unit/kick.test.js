'use strict';

const {
  startMockKick, CLIENT_ID, CLIENT_SECRET, RELAY, check, section, eq, eqFields, ok, loadCore, fakeNet, fixture,
  liveBody, liveSubs, officialFake, dataCalls, tokenCalls, kickCalls, bearerOf, subscriberSetup
} = require('./harness.js');

// ---- Section: parsers (fixtures) ------------------------------------------------

async function testParsers() {
  section('Parsers (fixtures modeled on the documented responses)');
  const { K } = loadCore();
  const v2off = fixture('kick-v2-channel-offline.json');
  const v2live = fixture('kick-v2-channel-live.json');
  const v1 = fixture('kick-v1-channel.json');
  const officialLive = fixture('official-channels-live.json');
  const officialEmpty = fixture('official-channels-empty.json');
  const officialBad = fixture('official-channels-non-numeric.json');
  const startUtc = Date.UTC(2026, 9, 15, 20, 0, 0);

  await check('followers: v2 numeric string from fixture', () => eq(K.parse.followers(v2off), 12345, 'v2'));
  await check('followers: v1 number from fixture', () => eq(K.parse.followers(v1), 678, 'v1'));
  await check('followers: both fields missing gives null', () => eq(K.parse.followers({}), null, 'missing'));
  await check('followers: empty string gives null', () => eq(K.parse.followers({ followers_count: '' }), null, 'empty'));
  await check('followers: null input gives null', () => eq(K.parse.followers(null), null, 'null input'));

  await check('live: livestream null gives live false', () => {
    eqFields(K.parse.live(v2off), { live: false, viewers: 0, startMs: null }, '');
  });

  await check('live: running stream gives viewers and start time', () => {
    const r = K.parse.live(v2live);
    eq(r.live, true, 'live');
    eq(r.viewers, 12, 'viewers');
    eq(r.startMs, startUtc, 'startMs');
    eq(r.title, 'Example stream', 'title');
  });

  await check('live: offline has an empty title; a missing or non-string title is empty', () => {
    eq(K.parse.live(v2off).title, '', 'offline');
    eq(K.parse.live({ livestream: { is_live: true, viewer_count: 1 } }).title, '', 'missing');
    eq(K.parse.live({ livestream: { is_live: true, session_title: 42 } }).title, '', 'number');
    eq(K.parse.live({ livestream: { is_live: true, session_title: '  ' + 'a'.repeat(300) } }).title.length, 140, 'capped');
  });

  await check('time: "YYYY-MM-DD HH:MM:SS" is UTC; offsets are respected; junk gives null', () => {
    eq(K.parse.time('2026-10-15 20:00:00'), startUtc, 'space form');
    eq(K.parse.time('2026-10-15T20:00:00Z'), startUtc, 'ISO Z');
    eq(K.parse.time('2026-10-15T22:00:00+02:00'), startUtc, 'offset');
    eq(K.parse.time('nope'), null, 'junk');
    eq(K.parse.time(''), null, 'empty');
  });

  await check('subBadges: sorted from highest months to lowest (fixture)', () => {
    eq(K.parse.subBadges(v2off).map((b) => b.months), [12, 6, 1], 'months order');
    ok(K.parse.subBadges(v2off).every((b) => b.src.startsWith('https://')), 'badge src missing');
  });

  await check('subBadges: entries without an image are dropped', () => {
    eq(K.parse.subBadges({ subscriber_badges: [{ months: 3 }, null] }), [], 'no image');
  });

  await check('official: documented fields from fixture', () => {
    const r = K.parse.official(officialLive);
    eqFields(r, { subs: 42, gifted: 3, canceled: 1, live: true, viewers: 12, title: 'Example stream', startMs: startUtc }, '');
  });

  await check('official: empty data array gives null', () => eq(K.parse.official(officialEmpty), null, 'empty'));

  await check('official: non-numeric counts give null', () => {
    const r = K.parse.official(officialBad);
    eq(r.subs, null, 'subs');
    eq(r.gifted, null, 'gifted');
    eq(r.canceled, null, 'canceled');
    eq(r.viewers, null, 'viewers');
  });

}

// ---- Section: Kick public REST, getJson -----------------------------------------

async function testKickRest() {
  section('Kick public endpoints and getJson()');

  await check('getJson: returns status and data on 200', async () => {
    const net = fakeNet(() => ({ status: 200, body: { a: 1 } }));
    const r = await loadCore({ fetch: net.fetch }).K.getJson('https://example.test/x');
    eq(r.ok, true, 'ok');
    eq(r.status, 200, 'status');
    eq(r.data.a, 1, 'data');
  });

  await check('getJson: HTTP error, bad body and network error map to codes', async () => {
    const K1 = loadCore({ fetch: fakeNet(() => ({ status: 404, body: {} })).fetch }).K;
    const r1 = await K1.getJson('https://example.test/x');
    eq([r1.ok, r1.status, r1.error], [false, 404, 'http'], 'http');
    const K2 = loadCore({ fetch: fakeNet(() => ({ status: 200, body: 'text' })).fetch }).K;
    eq((await K2.getJson('https://example.test/x')).error, 'body', 'body');
    const K3 = loadCore({ fetch: fakeNet(() => { throw new TypeError('fetch failed'); }).fetch }).K;
    eq((await K3.getJson('https://example.test/x')).error, 'network', 'network');
  });

  await check('getJson: a request past timeoutMs resolves with error timeout', async () => {
    const net = fakeNet((c) => new Promise((_, reject) => {
      c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const K = loadCore({ fetch: net.fetch }).K;
    const r = await K.getJson('https://example.test/x', { timeoutMs: 20 });
    eq(r.error, 'timeout', 'error');
  });

  await check('kick.channel: v2 is used first and sends no token', async () => {
    const net = fakeNet(() => ({ status: 200, body: fixture('kick-v2-channel-offline.json') }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.src], [true, 'v2'], 'result');
    eq(net.calls.length, 1, 'requests');
    eq(net.calls[0].url, 'https://kick.com/api/v2/channels/example-channel', 'url');
    ok(!net.calls.some((c) => 'Authorization' in c.headers), 'an Authorization header was sent');
  });

  await check('kick.channel: falls back to v1 when v2 fails', async () => {
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? { status: 404, body: {} }
      : { status: 200, body: fixture('kick-v1-channel.json') }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.src], [true, 'v1'], 'result');
    eq(net.calls[1].url, 'https://kick.com/api/v1/channels/example-channel', 'v1 url');
  });

  await check('kick.channel: both versions failing gives ok false', async () => {
    const net = fakeNet(() => ({ status: 500, body: {} }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq([r.ok, r.error], [false, 'http'], 'result');
  });
}

// ---- Section: official token and channel ----------------------------------------

async function testOfficial() {
  section('Official API: token and channel');

  await check('official.token: no credentials gives no-credentials without a request', async () => {
    const net = officialFake();
    const { K } = loadCore({ fetch: net.fetch });
    const r = await K.official.token(K.readSettings());
    eq([r.ok, r.error], [false, 'no-credentials'], 'result');
    eq(net.calls.length, 0, 'requests');
  });

  await check('official.token: POST form to tokenBase; secret only in the body', async () => {
    const net = officialFake();
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const r = await K.official.token(s);
    eq(r.ok, true, 'ok');
    eq(net.calls.length, 1, 'requests');
    const c = net.calls[0];
    eq([c.method, c.url], ['POST', 'https://id.kick.test/oauth/token'], 'method and url');
    eq(c.headers['Content-Type'], 'application/x-www-form-urlencoded', 'content type');
    const form = new URLSearchParams(c.body);
    eq(form.get('grant_type'), 'client_credentials', 'grant_type');
    eq(form.get('client_id'), CLIENT_ID, 'client_id');
    ok(form.get('client_secret') === CLIENT_SECRET, 'client_secret missing from the form body');
    ok(!net.calls.some((x) => x.url.includes(CLIENT_SECRET)), 'client secret found in a request URL');
  });

  await check('official.token: token is cached for a second call', async () => {
    const net = officialFake();
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    await K.official.token(s);
    await K.official.token(s);
    eq(tokenCalls(net).length, 1, 'token requests');
  });

  await check('official.token: HTTP 401 from the token endpoint gives http with status 401', async () => {
    const net = officialFake({ token: () => ({ status: 401, body: { message: 'Unauthorized' } }) });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const r = await K.official.token(s);
    eq([r.ok, r.error, r.status], [false, 'http', 401], 'result');
  });

  await check('official.token: a network failure gives network', async () => {
    const net = officialFake({ token: () => { throw new TypeError('fetch failed'); } });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    eq((await K.official.token(s)).error, 'network', 'error');
  });

  await check('official.channel: sends the bearer token and parses the fields', async () => {
    const net = officialFake({ channel: liveSubs(42) });
    const { K, s } = subscriberSetup(net, { ayarlar: {} });
    const t = await K.official.token(s);
    const r = await K.official.channel(s, t.token);
    eqFields(r, { ok: true, status: 200, subs: 42, gifted: 3, canceled: 1, live: true, viewers: 12, title: 'Example stream' }, '');
    const data = dataCalls(net)[0];
    ok(bearerOf(data) === 'Bearer ' + t.token, 'data call did not send the bearer token');
    ok(!data.url.includes(CLIENT_SECRET), 'client secret in data URL');
  });
}

// ---- Section: subscriber source --------------------------------------------------

async function testSubscriberSource() {
  section('Subscriber source');

  await check('manual mode returns aboneSayisi with delta 0 and no network call', async () => {
    const net = fakeNet(() => { throw new TypeError('unexpected request'); });
    const { src } = subscriberSetup(net, { ayarlar: { kanal: 'example-channel', aboneSayisi: 17 }, yerel: {} });
    const r = await src.poll();
    eqFields(r, { mode: 'manual', status: 'manual', total: 17, delta: 0 }, '');
    // Adjusted for v2.3.0: with a kanal set, the first poll probes the relay (/health) to decide the mode.
    eq(kickCalls(net).length, 0, 'requests other than the relay probe');
    eq(net.calls.map((c) => c.url), [RELAY + '/health'], 'only the relay probe');
  });

  await check('token mode: first poll 42 has delta 0; second poll 45 has delta 3', async () => {
    const net = officialFake({ channel: liveSubs(42, 45) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 42, delta: 0 }, 'first ');
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 45, delta: 3 }, 'second ');
  });

  await check('token mode: the token is cached across polls', async () => {
    const net = officialFake({ channel: liveSubs(42, 45, 48) });
    const { src } = subscriberSetup(net);
    await src.poll();
    await src.poll();
    eq(tokenCalls(net).length, 1, 'token requests');
    const data = dataCalls(net);
    ok(bearerOf(data[0]) === bearerOf(data[1]), 'second poll used a different token');
  });

  await check('token mode: a 401 on the data call gives auth, then the next poll requests a new token', async () => {
    const net = officialFake({ channel: (c, n) => (n === 2 ? { status: 401, body: {} } : liveBody(42)) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { status: 'ok', total: 42 }, 'first ');
    eqFields(await src.poll(), { status: 'auth', total: 42 }, 'second ');
    eqFields(await src.poll(), { status: 'ok', total: 42 }, 'third ');
    eq(tokenCalls(net).length, 2, 'token requests');
    ok(bearerOf(dataCalls(net)[2]) === 'Bearer tok-2', 'third poll did not use the new token');
  });

  await check('token mode: a 429 gives rate and keeps the last known total', async () => {
    const net = officialFake({ channel: (c, n) => (n === 2 ? { status: 429, body: {} } : liveBody(42)) });
    const { src } = subscriberSetup(net);
    await src.poll();
    eqFields(await src.poll(), { status: 'rate', total: 42 }, '');
  });

  await check('token mode: a 429 before any value gives rate with total null', async () => {
    const net = officialFake({ channel: () => ({ status: 429, body: {} }) });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { status: 'rate', total: null }, '');
  });

  await check('token mode: a thrown network error on the data call gives error', async () => {
    const net = officialFake({ channel: () => { throw new TypeError('fetch failed'); } });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a 500 on the data call gives error', async () => {
    const net = officialFake({ channel: () => ({ status: 500, body: {} }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a network failure on the token request gives error (not auth)', async () => {
    const net = officialFake({ token: () => { throw new TypeError('fetch failed'); } });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'error', 'status');
  });

  await check('token mode: a 401 from the token endpoint gives auth', async () => {
    const net = officialFake({ token: () => ({ status: 401, body: {} }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'auth', 'status');
  });

  await check('token mode: subscriber count null gives no-data', async () => {
    const net = officialFake({ channel: () => liveBody(null) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'no-data', 'status');
  });

  await check('token mode: an empty data array gives no-data (Kick answered, no channel data)', async () => {
    const net = officialFake({ channel: () => ({ status: 200, body: { data: [], message: 'ok' } }) });
    const { src } = subscriberSetup(net);
    eq((await src.poll()).status, 'no-data', 'status');
  });

  await check('token mode: no kanal gives no-channel without a request', async () => {
    const net = officialFake();
    const { src } = subscriberSetup(net, { ayarlar: {} });
    eq((await src.poll()).status, 'no-channel', 'status');
    eq(net.calls.length, 0, 'requests');
  });

  await check('missing credentials: source stays in manual mode and official.token says no-credentials', async () => {
    const net = officialFake();
    const { K, s, src } = subscriberSetup(net, { yerel: {} });
    eq(src.mode, 'manual', 'mode');
    eq((await src.poll()).status, 'manual', 'poll status');
    eq((await K.official.token(s)).error, 'no-credentials', 'token error');
    // Adjusted for v2.3.0: the poll probes the relay once; nothing else is requested.
    eq(kickCalls(net).length, 0, 'requests other than the relay probe');
  });
}

// ---- Section: mock server and the core against it ---------------------------------

async function testMockServer() {
  section('Mock Kick API (in-process, random port)');
  const mock = await startMockKick({ port: 0 });
  const api = mock.url;
  const formPost = (url, fields) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  const resetMock = () => fetch(api + '/__reset');
  // Returns a token from the mock after a reset, so subscriber counts start at 42.
  async function freshToken() {
    await resetMock();
    const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
    return (await r.json()).access_token;
  }
  const channelsUrl = api + '/public/v1/channels?slug=example-channel';

  try {
    await check('mock: OPTIONS preflight returns 204 with CORS headers', async () => {
      const r = await fetch(channelsUrl, { method: 'OPTIONS' });
      eq(r.status, 204, 'status');
      eq(r.headers.get('access-control-allow-origin'), '*', 'allow-origin');
      eq(r.headers.get('access-control-allow-headers'), '*,Authorization', 'allow-headers');
      eq(r.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS', 'allow-methods');
    });

    await check('mock: token request with the test client fields returns a bearer token', async () => {
      await resetMock();
      const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET });
      eq(r.status, 200, 'status');
      const j = await r.json();
      ok(typeof j.access_token === 'string' && j.access_token.length > 0, 'access_token missing');
      eqFields(j, { token_type: 'Bearer', expires_in: 3600 }, '');
    });

    await check('mock: wrong client secret gets 401 JSON', async () => {
      const r = await formPost(api + '/oauth/token', { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: 'wrong' });
      eq(r.status, 401, 'status');
      ok(typeof (await r.json()).message === 'string', 'no message in JSON');
    });

    await check('mock: channels without a bearer token get 401 Unauthorized', async () => {
      await resetMock();
      const r = await fetch(channelsUrl);
      eq(r.status, 401, 'status');
      eq((await r.json()).message, 'Unauthorized', 'message');
    });

    await check('mock: channels return the documented shape; count starts at 42 and steps by 3', async () => {
      const token = await freshToken();
      const auth = { Authorization: 'Bearer ' + token };
      const first = await (await fetch(channelsUrl, { headers: auth })).json();
      const ch = first.data[0];
      eqFields(ch, {
        slug: 'example-channel', broadcaster_user_id: 1, active_subscribers_count: 42,
        active_gifted_subscribers_count: 3, canceled_subscribers_count: 1, stream_title: 'test'
      }, '');
      eqFields(ch.stream, { is_live: true, viewer_count: 12, start_time: '2026-10-15T20:00:00Z' }, 'stream.');
      eq(first.message, 'ok', 'message');
      const second = await (await fetch(channelsUrl, { headers: auth })).json();
      eq(second.data[0].active_subscribers_count, 45, 'second count');
    });

    await check('mock: /__reset restores 42 and revokes issued tokens; /__stats counts calls', async () => {
      const token = await freshToken();
      await fetch(channelsUrl, { headers: { Authorization: 'Bearer ' + token } });
      await resetMock();
      eq((await fetch(channelsUrl, { headers: { Authorization: 'Bearer ' + token } })).status, 401, 'old token after reset');
      const stats = await (await fetch(api + '/__stats')).json();
      eq(stats.tokensIssued, 0, 'tokens issued after reset');
      eq(stats.channelCalls, 1, 'channel calls after reset');
    });

    await check('core against the mock: poll 42 then 45 gives delta 3', async () => {
      await resetMock();
      const K = loadCore({
        fetch: globalThis.fetch,
        ayarlar: { kanal: 'example-channel' },
        yerel: { kickClientId: CLIENT_ID, kickClientSecret: CLIENT_SECRET, apiBase: api + '/', tokenBase: api + '/' }
      }).K;
      const src = K.createSubscriberSource(K.readSettings());
      eqFields(await src.poll(), { status: 'ok', total: 42, delta: 0 }, 'first ');
      eqFields(await src.poll(), { status: 'ok', total: 45, delta: 3 }, 'second ');
    });
  } finally {
    await mock.close();
  }
}

module.exports = { testParsers, testKickRest, testOfficial, testSubscriberSource, testMockServer };
