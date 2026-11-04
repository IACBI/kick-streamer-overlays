'use strict';

const {
  fs, path, ROOT, TEST_LOCAL, RELAY, PKG_VERSION, check, section, eq, eqFields, ok, loadCore, fakeNet, fixture,
  liveBody, liveSubs, officialFake, tokenCalls, relayCalls, kickCalls, subscriberSetup, fakeEventSource,
  fakeClock, setRandom, fakeStorage, throwingStorage, SUBS_OK, HEALTH
} = require('./harness.js');

async function testChatFeed() {
  section('Live chat (local relay)');

  await check('README and docs/: every relative link points at a file, and every #anchor exists', () => {
    // GitHub's heading ids: lower case, punctuation dropped, spaces to hyphens.
    const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const anchors = (file) => {
      const src = fs.readFileSync(file, 'utf8');
      return new Set([...src.matchAll(/<a id="([^"]+)"/g)].map((m) => m[1])
        .concat([...src.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]))));
    };
    const files = ['README.md'].concat(fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f));
    files.forEach((rel) => {
      const file = path.join(ROOT, rel);
      const src = fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const m of src.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:)/.test(href)) continue;
        const [p, hash] = href.split('#');
        const target = p ? path.resolve(path.dirname(file), p) : file;
        ok(fs.existsSync(target), rel + ': missing file ' + href);
        if (hash && target.endsWith('.md') && fs.existsSync(target)) ok(anchors(target).has(hash), rel + ': missing anchor ' + href);
      }
    });
  });

  await check('README badges: the theme and overlay counts match the code', () => {
    const { K } = loadCore({});
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const badge = (name) => { const m = readme.match(new RegExp('badge/' + name + '-([0-9]+)-')); return m ? Number(m[1]) : null; };
    const overlays = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'studio.html' && f !== 'dock.html').length;
    eq(badge('themes'), K.enums('stil').length, 'themes badge');
    eq(badge('overlays'), overlays, 'overlays badge');
  });

  await check('connectRelay: opens the relay stream and forwards chat, ban, alert and stream frames in the overlay shape', () => {
    const sources = [];
    const statuses = [];
    const messages = [];
    const { K } = loadCore({ EventSource: fakeEventSource(sources) });
    const stop = K.connectRelay('http://127.0.0.1:8790/events', { onMessage: (ev) => messages.push(ev), onStatus: (st) => statuses.push(st) });
    try {
      eq(sources.length, 1, 'one stream');
      eq(sources[0].url, 'http://127.0.0.1:8790/events', 'stream url');
      sources[0].onopen();
      sources[0].emit('chat', JSON.stringify({ kind: 'chat', id: 'm-1', username: 'viewer_one', message: 'hello', badges: [] }));
      sources[0].emit('ban', JSON.stringify({ userId: '9', username: 'spammer' }));
      ['follow', 'sub', 'gift', 'kicks'].forEach((name, i) => sources[0].emit(name, JSON.stringify({ id: 'a-' + i, username: 'u' + i })));
      sources[0].emit('live', JSON.stringify({ live: true, startedAt: '2026-10-15T20:00:00Z', title: 't' }));
      sources[0].emit('meta', JSON.stringify({ title: 'new title' }));
      sources[0].emit('livestream', JSON.stringify({ id: 'x' }));
      eq(messages.map((m) => m.kind), ['chat', 'ban', 'follow', 'sub', 'gift', 'kicks', 'live', 'meta'], 'kinds (an unknown event name is not listened to)');
      eq(messages[0].message, 'hello', 'chat text');
      eq(statuses, ['connecting', 'open'], 'statuses');
    } finally {
      stop();
    }
    eq(sources[0].closed, true, 'stop closes the stream');
  });

  await check('connectRelay: a dropped relay reports reconnecting, and a broken frame is ignored', () => {
    const sources = [];
    const statuses = [];
    const messages = [];
    const { K } = loadCore({ EventSource: fakeEventSource(sources) });
    const stop = K.connectRelay('http://127.0.0.1:8790/events', { onMessage: (ev) => messages.push(ev), onStatus: (st) => statuses.push(st) });
    try {
      sources[0].emit('chat', '{not json');
      sources[0].onerror();
      eq(statuses, ['connecting', 'reconnecting'], 'statuses');
      eq(messages.length, 0, 'no message from a broken frame');
    } finally {
      stop();
    }
  });
}

async function testRelayInfoAndChannel() {
  section('relayInfo() and kick.channel() (relay first, direct fallback)');
  const S = (over) => Object.assign({ relayAdresi: RELAY }, over);

  await check('relayInfo: GET /health, returns the health object, memoized for later calls', async () => {
    const net = fakeNet(() => HEALTH({ channel: true }));
    const { K } = loadCore({ fetch: net.fetch });
    const a = await K.relayInfo(S());
    const b = await K.relayInfo(S());
    eq(a.version, PKG_VERSION, 'version');
    eq(a.features.channel, true, 'features');
    eq(net.calls.length, 1, 'requests');
    eq(net.calls[0].url, RELAY + '/health', 'url');
    ok(net.calls[0].signal, 'request has a timeout signal');
    eq(b, a, 'same result');
  });

  await check('relay requests carry the access key from KICK_RELAY_KEY (read at call time); none set leaves the URL alone', async () => {
    const net = fakeNet(() => HEALTH({}));
    const { K, ctx } = loadCore({ fetch: net.fetch });
    eq(K.relayUrl(RELAY + '/channel?slug=a'), RELAY + '/channel?slug=a', 'no key');
    ctx.KICK_RELAY_KEY = 'k 1';
    eq(K.relayUrl(RELAY + '/health'), RELAY + '/health?key=k%201', 'key on a bare path');
    eq(K.relayUrl(RELAY + '/channel?slug=a'), RELAY + '/channel?slug=a&key=k%201', 'key after an existing query');
    await K.relayInfo(S());
    eq(net.calls[0].url, RELAY + '/health?key=k%201', 'probe url');
  });

  await check('relayInfo: concurrent calls share one request', async () => {
    const net = fakeNet(() => HEALTH({}));
    const { K } = loadCore({ fetch: net.fetch });
    await Promise.all([K.relayInfo(S()), K.relayInfo(S()), K.relayInfo(S())]);
    eq(net.calls.length, 1, 'requests');
  });

  await check('relayInfo: uses the configured relayAdresi; none configured gives null without a request', async () => {
    const net = fakeNet(() => HEALTH({}));
    const { K } = loadCore({ fetch: net.fetch });
    await K.relayInfo({ relayAdresi: 'http://127.0.0.1:9000' });
    eq(net.calls[0].url, 'http://127.0.0.1:9000/health', 'url');
    eq(await K.relayInfo({}), null, 'no address');
    eq(await K.relayInfo(null), null, 'no settings');
    eq(net.calls.length, 1, 'requests');
  });

  await check('relayInfo: a failed probe gives null and is retried at most every 5 minutes', async () => {
    const clock = fakeClock();
    let up = false;
    const net = fakeNet(() => { if (!up) throw new TypeError('refused'); return HEALTH({ channel: true }); });
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    eq(await K.relayInfo(S()), null, 'first');
    eq(net.calls.length, 1, 'requests after first');
    up = true;
    await clock.advance(4 * 60 * 1000);
    eq(await K.relayInfo(S()), null, 'within 5 min');
    eq(net.calls.length, 1, 'no new request within 5 min');
    await clock.advance(61 * 1000);
    const info = await K.relayInfo(S());
    eq(info && info.features.channel, true, 'after 5 min the probe is retried');
    eq(net.calls.length, 2, 'requests after retry');
    await K.relayInfo(S());
    eq(net.calls.length, 2, 'success is memoized');
  });

  await check('relayInfo: a non-200 or a body that is not JSON gives null', async () => {
    const K1 = loadCore({ fetch: fakeNet(() => ({ status: 500, body: {} })).fetch }).K;
    eq(await K1.relayInfo(S()), null, '500');
    const K2 = loadCore({ fetch: fakeNet(() => ({ status: 200, body: 'text' })).fetch }).K;
    eq(await K2.relayInfo(S()), null, 'text body');
  });

  await check('relayInfo: gives up after 1500 ms', async () => {
    const clock = fakeClock();
    const net = fakeNet((c) => new Promise((_, reject) => {
      c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    let settled = false;
    const pr = K.relayInfo(S()).then((v) => { settled = true; return v; });
    await clock.advance(1499);
    eq(settled, false, 'still waiting at 1499 ms');
    await clock.advance(1);
    eq(await pr, null, 'null at 1500 ms');
  });

  // kick.channel with the relay
  const v2Body = () => fixture('kick-v2-channel-offline.json');
  function channelNet({ health = () => HEALTH({ channel: true }), relayChannel, direct }) {
    return fakeNet((c) => {
      if (c.url === RELAY + '/health') return health();
      if (c.url.startsWith(RELAY + '/channel')) return relayChannel(c);
      return direct(c);
    });
  }

  await check('kick.channel: relay v2 is used first (src relay-v2) and no direct request is made', async () => {
    const net = channelNet({
      relayChannel: () => ({ status: 200, body: v2Body(), headers: { 'X-Kick-Source': 'v2' } }),
      direct: () => { throw new Error('direct request'); }
    });
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
    eqFields(r, { ok: true, src: 'relay-v2', status: 200 }, '');
    eq(r.data.followers_count, v2Body().followers_count, 'raw data passed through');
    eq(net.calls.map((c) => c.url), [RELAY + '/health', RELAY + '/channel?slug=example-channel'], 'requests');
  });

  await check('kick.channel: X-Kick-Source v1 gives relay-v1; a missing header gives relay-v2', async () => {
    const mk = (headers) => channelNet({
      relayChannel: () => ({ status: 200, body: fixture('kick-v1-channel.json'), headers }),
      direct: () => { throw new Error('direct request'); }
    });
    eq((await loadCore({ fetch: mk({ 'X-Kick-Source': 'v1' }).fetch }).K.kick.channel('example-channel', S())).src, 'relay-v1', 'v1');
    eq((await loadCore({ fetch: mk(undefined).fetch }).K.kick.channel('example-channel', S())).src, 'relay-v2', 'no header');
  });

  await check('kick.channel: a relay failure (502, network) falls back to the direct v2 request', async () => {
    for (const relayChannel of [() => ({ status: 502, body: { ok: false, error: 'upstream' } }), () => { throw new TypeError('reset'); }]) {
      const net = channelNet({ relayChannel, direct: () => ({ status: 200, body: v2Body() }) });
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
      eqFields(r, { ok: true, src: 'v2' }, '');
      eq(net.calls[net.calls.length - 1].url, 'https://kick.com/api/v2/channels/example-channel', 'direct url');
    }
  });

  await check('kick.channel: a relay 429 returns at once with retryAfterMs and does not hit Kick directly', async () => {
    const net = channelNet({
      relayChannel: () => ({ status: 429, body: { ok: false }, headers: { 'Retry-After': '45' } }),
      direct: () => { throw new Error('direct request'); }
    });
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel', S());
    eqFields(r, { ok: false, status: 429, retryAfterMs: 45000 }, '');
    eq(kickCalls(net).filter((c) => !c.url.startsWith(RELAY)).length, 0, 'direct requests');
    const net2 = channelNet({ relayChannel: () => ({ status: 429, body: {} }), direct: () => { throw new Error('direct request'); } });
    eq((await loadCore({ fetch: net2.fetch }).K.kick.channel('example-channel', S())).retryAfterMs, 60000, 'default 60 s');
  });

  await check('kick.channel: relay without the channel feature, or relay down, goes straight to direct', async () => {
    const off = channelNet({
      health: () => HEALTH({ channel: false }),
      relayChannel: () => { throw new Error('relay channel request'); },
      direct: () => ({ status: 200, body: v2Body() })
    });
    eq((await loadCore({ fetch: off.fetch }).K.kick.channel('example-channel', S())).src, 'v2', 'feature off');
    const down = channelNet({
      health: () => { throw new TypeError('refused'); },
      relayChannel: () => { throw new Error('relay channel request'); },
      direct: () => ({ status: 200, body: v2Body() })
    });
    eq((await loadCore({ fetch: down.fetch }).K.kick.channel('example-channel', S())).src, 'v2', 'relay down');
  });

  await check('kick.channel: without settings the relay is never contacted', async () => {
    const net = fakeNet(() => ({ status: 200, body: v2Body() }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eq(r.src, 'v2', 'src');
    ok(net.calls.every((c) => c.url.startsWith('https://kick.com/')), 'only kick.com requests');
  });

  await check('kick.channel direct: 403 and 429 stop at once (no v1) and carry retryAfterMs', async () => {
    for (const [status, headers, want] of [[403, undefined, 60000], [429, undefined, 60000], [429, { 'Retry-After': '7' }, 7000], [403, { 'Retry-After': '120' }, 120000]]) {
      const net = fakeNet(() => ({ status, body: {}, headers }));
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
      eqFields(r, { ok: false, status, retryAfterMs: want, src: 'v2' }, status + ' ');
      eq(net.calls.length, 1, 'requests for ' + status);
    }
  });

  await check('kick.channel direct: 404, 5xx, network error and timeout fall back to v1', async () => {
    const failures = [
      ['404', () => ({ status: 404, body: {} })],
      ['500', () => ({ status: 500, body: {} })],
      ['503', () => ({ status: 503, body: {} })],
      ['network', () => { throw new TypeError('fetch failed'); }]
    ];
    for (const [name, v2fail] of failures) {
      const net = fakeNet((c) => (c.url.includes('/api/v2/') ? v2fail() : { status: 200, body: fixture('kick-v1-channel.json') }));
      const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
      eqFields(r, { ok: true, src: 'v1' }, name + ' ');
      eq(net.calls.length, 2, 'requests for ' + name);
    }
    const clock = fakeClock();
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? new Promise((_, reject) => { c.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); })
      : { status: 200, body: fixture('kick-v1-channel.json') }));
    const { K } = loadCore(Object.assign({ fetch: net.fetch }, clock.opts()));
    const pr = K.kick.channel('example-channel');
    await clock.advance(10000);
    eqFields(await pr, { ok: true, src: 'v1' }, 'timeout ');
  });

  await check('kick.channel direct: v1 answering 429 after a v2 5xx also carries retryAfterMs', async () => {
    const net = fakeNet((c) => (c.url.includes('/api/v2/')
      ? { status: 500, body: {} }
      : { status: 429, body: {}, headers: { 'Retry-After': '9' } }));
    const r = await loadCore({ fetch: net.fetch }).K.kick.channel('example-channel');
    eqFields(r, { ok: false, status: 429, retryAfterMs: 9000 }, '');
  });
}

async function testSubscriberRelayAndBaseline() {
  section('Subscriber source: relay mode and persisted baseline');
  const GOOD = (features) => () => HEALTH(Object.assign({ subscribers: true }, features));

  await check('relay mode: mode switches on the first poll; values and delta come from /subscribers', async () => {
    const net = officialFake({
      relay: (c, n) => {
        if (c.url === RELAY + '/health') return GOOD()();
        return SUBS_OK(c.url.includes('slug=example-channel') ? (n === 2 ? 42 : 45) : 0);
      }
    });
    const { src } = subscriberSetup(net, { yerel: {} });
    eq(src.mode, 'manual', 'mode before the first poll');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 42, delta: 0 }, 'first ');
    eq(src.mode, 'relay', 'src.mode after the poll');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 45, delta: 3 }, 'second ');
    eq(relayCalls(net).map((c) => c.url), [RELAY + '/health', RELAY + '/subscribers?slug=example-channel', RELAY + '/subscribers?slug=example-channel'], 'relay requests');
    eq(kickCalls(net).length, 0, 'no direct Kick or token requests');
  });

  await check('relay mode wins over credentials in the page when the relay offers subscribers', async () => {
    const net = officialFake({ relay: (c) => (c.url.endsWith('/health') ? GOOD()() : SUBS_OK(77)) });
    const { src } = subscriberSetup(net);
    eq(src.mode, 'token', 'initial guess with credentials');
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 77 }, '');
    eq(tokenCalls(net).length, 0, 'token requests');
  });

  await check('relay mode: HTTP errors map to statuses; the last total is kept; rate carries retryAfterMs', async () => {
    const cases = [
      [503, undefined, 'no-credentials'], [401, undefined, 'auth'], [429, undefined, 'rate'],
      [429, { 'Retry-After': '12' }, 'rate'], [502, undefined, 'error'], [500, undefined, 'error']
    ];
    for (const [status, headers, want] of cases) {
      let n = 0;
      const net = officialFake({
        relay: (c) => {
          if (c.url.endsWith('/health')) return GOOD()();
          n += 1;
          return n === 1 ? SUBS_OK(42) : { status, body: { ok: false }, headers };
        }
      });
      const { src } = subscriberSetup(net, { yerel: {} });
      await src.poll();
      const r = await src.poll();
      eqFields(r, { status: want, total: 42, delta: 0 }, status + ' ');
      if (want === 'rate') eq(r.retryAfterMs, headers ? 12000 : 60000, 'retryAfterMs for ' + status);
    }
  });

  await check('relay mode: subs null gives no-data; a thrown network error gives error (no credentials to fall back to)', async () => {
    const a = subscriberSetup(officialFake({ relay: (c) => (c.url.endsWith('/health') ? GOOD()() : SUBS_OK(null)) }), { yerel: {} });
    eq((await a.src.poll()).status, 'no-data', 'no-data');
    let calls = 0;
    const b = subscriberSetup(officialFake({
      relay: (c) => { if (c.url.endsWith('/health')) return GOOD()(); calls += 1; throw new TypeError('reset'); }
    }), { yerel: {} });
    eq((await b.src.poll()).status, 'error', 'error');
    eq(calls, 1, 'one attempt');
  });

  await check('relay mode with page credentials: an unreachable relay on a poll falls back to the token path', async () => {
    const net = officialFake({
      relay: (c) => { if (c.url.endsWith('/health')) return GOOD()(); throw new TypeError('reset'); },
      channel: liveSubs(50)
    });
    const { src } = subscriberSetup(net);
    eqFields(await src.poll(), { mode: 'token', status: 'ok', total: 50 }, '');
    eq(tokenCalls(net).length, 1, 'token requests');
  });

  await check('relay without the subscribers feature: token mode with credentials, manual without', async () => {
    const relay = (c) => (c.url.endsWith('/health') ? HEALTH({ subscribers: false }) : { status: 404, body: {} });
    const withCreds = subscriberSetup(officialFake({ relay, channel: liveSubs(42) }));
    eqFields(await withCreds.src.poll(), { mode: 'token', status: 'ok', total: 42 }, 'token ');
    const without = subscriberSetup(officialFake({ relay }), { yerel: {}, ayarlar: { kanal: 'example-channel', aboneSayisi: 9 } });
    eqFields(await without.src.poll(), { mode: 'manual', status: 'manual', total: 9 }, 'manual ');
  });

  await check('the mode is re-evaluated: a relay that starts later is picked up after the 5-minute probe retry', async () => {
    const clock = fakeClock();
    let up = false;
    const net = officialFake({
      relay: (c) => {
        if (c.url.endsWith('/health')) return up ? GOOD()() : (() => { throw new TypeError('refused'); })();
        return SUBS_OK(60);
      }
    });
    const { K } = loadCore(Object.assign({ fetch: net.fetch, ayarlar: { kanal: 'example-channel', aboneSayisi: 5 }, yerel: {} }, clock.opts()));
    const src = K.createSubscriberSource(K.readSettings());
    eq((await src.poll()).mode, 'manual', 'relay down');
    up = true;
    await clock.advance(5 * 60 * 1000 + 1);
    eqFields(await src.poll(), { mode: 'relay', status: 'ok', total: 60 }, '');
    eq(src.mode, 'relay', 'src.mode');
  });

  await check('no kanal: no-channel in relay-less token mode and no request at all', async () => {
    const net = officialFake({ relay: () => GOOD()() });
    const { src } = subscriberSetup(net, { ayarlar: {} });
    eq((await src.poll()).status, 'no-channel', 'status');
    eq(net.calls.length, 0, 'requests');
  });

  await check('token mode: a 429 carries retryAfterMs (header seconds, else 60 s)', async () => {
    const withHeader = officialFake({ channel: () => ({ status: 429, body: {}, headers: { 'Retry-After': '33' } }) });
    eq((await subscriberSetup(withHeader).src.poll()).retryAfterMs, 33000, 'header');
    const noHeader = officialFake({ channel: () => ({ status: 429, body: {} }) });
    eq((await subscriberSetup(noHeader).src.poll()).retryAfterMs, 60000, 'default');
  });

  // Baseline persistence
  const KEY = 'ko:subBase:example-channel';
  function baselineSetup(clock, storage, counts, channel = 'example-channel') {
    const seq = Array.isArray(counts) ? counts : [counts];
    let i = 0;
    const net = officialFake({ channel: () => liveBody(seq[Math.min(i++, seq.length - 1)]) });
    const { K } = loadCore(Object.assign({
      fetch: net.fetch, localStorage: storage,
      ayarlar: { kanal: channel }, yerel: TEST_LOCAL
    }, clock.opts()));
    return K.createSubscriberSource(K.readSettings());
  }

  await check('baseline: the first value is stored as {base, at} under ko:subBase:<kanal>', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    const src = baselineSetup(clock, storage, [42, 45]);
    eqFields(await src.poll(), { total: 42, delta: 0 }, 'first ');
    eq(JSON.parse(storage.data[KEY]), { base: 42, at: clock.t }, 'stored');
    eqFields(await src.poll(), { total: 45, delta: 3 }, 'second ');
    eq(JSON.parse(storage.data[KEY]).base, 42, 'baseline not moved');
  });

  await check('baseline: a new page load within 12 h keeps the stored baseline', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42).poll();
    await clock.advance(11 * 60 * 60 * 1000);
    const r = await baselineSetup(clock, storage, 50).poll();
    eqFields(r, { total: 50, delta: 8 }, '');
  });

  await check('baseline: older than 12 h starts a new baseline and rewrites the storage', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42).poll();
    await clock.advance(12 * 60 * 60 * 1000 + 1);
    const r = await baselineSetup(clock, storage, 50).poll();
    eqFields(r, { total: 50, delta: 0 }, '');
    eq(JSON.parse(storage.data[KEY]), { base: 50, at: clock.t }, 'rewritten');
  });

  await check('baseline: each kanal has its own entry', async () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    await baselineSetup(clock, storage, 42, 'example-channel').poll();
    const r = await baselineSetup(clock, storage, 90, 'other').poll();
    eq(r.delta, 0, 'other channel starts at 0');
    eq(Object.keys(storage.data).sort(), ['ko:subBase:example-channel', 'ko:subBase:other'], 'keys');
  });

  await check('baseline: corrupt or invalid stored data is ignored', async () => {
    for (const bad of ['{not json', 'null', '[]', '{"base":"x","at":1}', JSON.stringify({ base: 42, at: 1.7e12 + 99999999 })]) {
      const clock = fakeClock();
      const storage = fakeStorage({ [KEY]: bad });
      const r = await baselineSetup(clock, storage, 50).poll();
      eq(r.delta, 0, 'delta for ' + bad);
      eq(JSON.parse(storage.data[KEY]).base, 50, 'replaced for ' + bad);
    }
  });

  await check('baseline: blocked storage never breaks polling', async () => {
    const clock = fakeClock();
    const src = baselineSetup(clock, throwingStorage(), [42, 45]);
    eqFields(await src.poll(), { status: 'ok', total: 42, delta: 0 }, 'first ');
    eqFields(await src.poll(), { status: 'ok', total: 45, delta: 3 }, 'second ');
    const noStorage = baselineSetup(clock, undefined, [42, 44]);
    await noStorage.poll();
    eq((await noStorage.poll()).delta, 2, 'no localStorage at all');
  });

  await check('baseline: manual mode never touches storage', async () => {
    const storage = fakeStorage();
    const net = fakeNet(() => { throw new TypeError('offline'); });
    const { K } = loadCore({ fetch: net.fetch, localStorage: storage, ayarlar: { kanal: 'example-channel', aboneSayisi: 17 } });
    const src = K.createSubscriberSource(K.readSettings());
    eqFields(await src.poll(), { status: 'manual', total: 17, delta: 0 }, '');
    eq(Object.keys(storage.data).length, 0, 'storage entries');
  });
}

async function testConnectRelayReconnect() {
  section('connectRelay(): reconnect with backoff');

  function setup(random) {
    const sources = [], statuses = [], messages = [];
    const clock = fakeClock();
    const { K, ctx } = loadCore(Object.assign({ EventSource: fakeEventSource(sources) }, clock.opts()));
    setRandom(ctx, random === undefined ? 0.5 : random);
    const stop = K.connectRelay(RELAY + '/events', { onMessage: (m) => messages.push(m), onStatus: (st) => statuses.push(st) });
    return { sources, statuses, messages, clock, stop };
  }
  const dropClosed = (src) => { src.readyState = 2; src.onerror(); };

  await check('a closed stream is reopened with backoff 1 s, 2 s, 4 s ... capped at 30 s', async () => {
    const { sources, statuses, clock, stop } = setup(0.5);
    const want = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (let i = 0; i < want.length; i += 1) {
      dropClosed(sources[i]);
      ok(sources[i].closed, 'old stream closed #' + i);
      eq(clock.log[i], want[i], 'delay #' + i);
      await clock.advance(want[i] - 1);
      eq(sources.length, i + 1, 'not reopened early #' + i);
      await clock.advance(1);
      eq(sources.length, i + 2, 'reopened #' + i);
      eq(sources[i + 1].url, RELAY + '/events', 'same url');
    }
    eq(statuses[0], 'connecting', 'first status');
    ok(statuses.slice(1).every((s) => s === 'reconnecting'), 'later statuses are reconnecting');
    stop();
  });

  await check('backoff jitter stays within +/- 20 % (and never beyond 30 s)', async () => {
    const lo = setup(0);
    dropClosed(lo.sources[0]);
    eq(lo.clock.log[0], 800, 'low');
    lo.stop();
    const hi = setup(1);
    dropClosed(hi.sources[0]);
    eq(hi.clock.log[0], 1200, 'high');
    hi.stop();
    const cap = setup(1);
    for (let i = 0; i < 8; i += 1) { dropClosed(cap.sources[i]); await cap.clock.advance(30000); }
    ok(cap.clock.log.every((d) => d <= 30000), 'all delays <= 30000: ' + cap.clock.log.join(','));
    eq(cap.clock.log[cap.clock.log.length - 1], 30000, 'capped');
    cap.stop();
  });

  await check('onopen resets the backoff; messages from the reopened stream are forwarded', async () => {
    const { sources, statuses, messages, clock, stop } = setup(0.5);
    dropClosed(sources[0]);
    await clock.advance(1000);
    dropClosed(sources[1]);
    eq(clock.log[1], 2000, 'second delay grew');
    await clock.advance(2000);
    sources[2].onopen();
    eq(statuses[statuses.length - 1], 'open', 'status open');
    sources[2].emit('chat', JSON.stringify({ id: 'm-9', username: 'viewer', message: 'hi' }));
    eq(messages.map((m) => m.kind), ['chat'], 'forwarded from the new stream');
    dropClosed(sources[2]);
    eq(clock.log[2], 1000, 'delay back to 1 s after open');
    stop();
  });

  await check('an error while the browser is still retrying (not CLOSED) does not reopen or close', async () => {
    const { sources, statuses, clock, stop } = setup();
    sources[0].readyState = 0;
    sources[0].onerror();
    await clock.advance(60000);
    eq(sources.length, 1, 'no new stream');
    eq(sources[0].closed, false, 'not closed');
    eq(statuses, ['connecting', 'reconnecting'], 'statuses');
    stop();
  });

  await check('OBS "Local file" pages (http://absolute) skip the relay: no stream, no probe, a blocked status', async () => {
    const sources = [];
    let fetched = 0;
    const { K } = loadCore({ EventSource: fakeEventSource(sources), location: { protocol: 'http:', hostname: 'absolute', search: '' },
      fetch: async () => { fetched += 1; throw new TypeError('should not fetch'); } });
    const statuses = [];
    const stop = K.connectRelay('http://127.0.0.1:8790/events', { onStatus: (st) => statuses.push(st) });
    eq(statuses, ['blocked'], 'status');
    eq(sources.length, 0, 'no EventSource');
    stop();
    eq(await K.relayInfo(K.normalize({})), null, 'relayInfo');
    eq(fetched, 0, 'no request');
    eq(K.relayBlocked(), true, 'relayBlocked');
    eq(/studio link/.test(K.relayBlockedNote(K.normalize({ dil: 'en' }))), true, 'note');
    const file = loadCore({ location: { protocol: 'file:', hostname: '', search: '' } }).K;
    eq(file.relayBlocked(), false, 'a file:// link is not blocked');
    ['127.0.0.1', 'localhost', '[::1]'].forEach((hostname) =>
      eq(loadCore({ location: { protocol: 'http:', hostname, search: '' } }).K.relayBlocked(), false, 'local server ' + hostname));
  });

  await check('pages served from a web site (GitHub Pages) skip the relay and say the downloaded pack is needed', async () => {
    const sources = [];
    let fetched = 0;
    const { K } = loadCore({ EventSource: fakeEventSource(sources), location: { protocol: 'https:', hostname: 'iacbi.github.io', search: '' },
      fetch: async () => { fetched += 1; throw new TypeError('should not fetch'); } });
    const statuses = [];
    K.connectRelay('http://127.0.0.1:8790/events', { onStatus: (st) => statuses.push(st) })();
    eq(statuses, ['blocked'], 'status');
    eq(sources.length, 0, 'no EventSource');
    eq(await K.relayInfo(K.normalize({})), null, 'relayInfo');
    eq(fetched, 0, 'no request to 127.0.0.1');
    eq(K.relayBlockedNote(K.normalize({ dil: 'en' })), 'Live features need the downloaded pack', 'note');
  });

  await check('stop() cancels a pending reconnect and closes the stream', async () => {
    const { sources, clock, stop } = setup();
    dropClosed(sources[0]);
    stop();
    await clock.advance(60000);
    eq(sources.length, 1, 'no new stream after stop');
    const second = setup();
    second.stop();
    ok(second.sources[0].closed, 'closed');
  });

  await check('a failing EventSource constructor on reopen schedules another attempt', async () => {
    const sources = [];
    const clock = fakeClock();
    let broken = false;
    const Base = fakeEventSource(sources);
    class Flaky extends Base { constructor(url) { if (broken) throw new Error('blocked'); super(url); } }
    const { K, ctx } = loadCore(Object.assign({ EventSource: Flaky }, clock.opts()));
    setRandom(ctx, 0.5);
    const stop = K.connectRelay(RELAY + '/events', {});
    broken = true;
    dropClosed(sources[0]);
    await clock.advance(1000);
    eq(clock.log.slice(0, 2), [1000, 2000], 'second attempt scheduled with a longer delay');
    broken = false;
    await clock.advance(2000);
    eq(sources.length, 2, 'reopened once the constructor works');
    stop();
  });
}

module.exports = { testChatFeed, testRelayInfoAndChannel, testSubscriberRelayAndBaseline, testConnectRelayReconnect };
