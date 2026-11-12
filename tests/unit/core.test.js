'use strict';

const {
  fs, path, vm, ROOT, SETTINGS_FILE, DEFAULTS, PKG_VERSION, check, section, eq, eqFields, ok, loadCore,
  fakeDocument
} = require('./harness.js');

// ---- Section: core API and settings -------------------------------------------

async function testCoreApi() {
  section('Core API surface');
  const { K } = loadCore();
  await check('kick-core.js loads and exposes the documented API', () => {
    ['readSettings', 'normalize', 'schemaKeys', 'enums', 't', 'useLang', 'speechLang', 'fmt', 'pct', 'applyLook', 'tween',
      'getJson', 'createSubscriberSource', 'connectRelay', 'isDebug', 'loadFont', 'setFill', 'poller', 'relayInfo',
      'text', 'createGoalBar', 'note', 'debug'].forEach((n) => ok(typeof K[n] === 'function', 'missing ' + n));
    ['followers', 'live', 'subBadges', 'time', 'official'].forEach((n) =>
      ok(typeof K.parse[n] === 'function', 'missing parse.' + n));
    ok(typeof K.kick.channel === 'function', 'missing kick.channel');
    eq(K.version, PKG_VERSION, 'version (kept equal to package.json by tools/sync-version.js)');
    ['token', 'channel', 'clearToken'].forEach((n) => ok(typeof K.official[n] === 'function', 'missing official.' + n));
  });
}

async function testNormalize() {
  section('Settings: normalize()');
  const { K } = loadCore();

  await check('defaults apply when no values are given', () => {
    eqFields(K.normalize({}), DEFAULTS, '');
    eqFields(K.normalize(null), DEFAULTS, '');
  });

  await check('enum values are case-insensitive; unknown values fall back', () => {
    eq(K.normalize({ stil: 'NEON' }).stil, 'neon', 'stil NEON');
    eq(K.normalize({ stil: 'hexagon' }).stil, 'glass', 'stil hexagon');
    eqFields(K.normalize({ sekil: 'Square', yaziTipi: 'MONO', animasyon: 'OFF', dil: 'EN' }),
      { sekil: 'square', yaziTipi: 'mono', animasyon: 'off', dil: 'en' }, '');
    eqFields(K.normalize({ dil: 'xx', animasyon: 'fast' }), { dil: 'both', animasyon: 'normal' }, '');
  });

  await check('renk accepts only #rgb and #rrggbb', () => {
    eq(K.normalize({ renk: 'red' }).renk, '#53fc18', 'renk red');
    eq(K.normalize({ renk: '#abc' }).renk, '#abc', 'renk #abc');
    eq(K.normalize({ renk: '#AABBCC' }).renk, '#AABBCC', 'renk #AABBCC');
    eq(K.normalize({ renk: '#abcd' }).renk, '#53fc18', 'renk #abcd');
    eq(K.normalize({ renk: 'abc' }).renk, '#53fc18', 'renk without #');
  });

  await check('yenilemeSn is clamped to 10..600 and rounded', () => {
    eq(K.normalize({ yenilemeSn: 1 }).yenilemeSn, 10, 'yenilemeSn 1');
    eq(K.normalize({ yenilemeSn: 9999 }).yenilemeSn, 600, 'yenilemeSn 9999');
    eq(K.normalize({ yenilemeSn: '45' }).yenilemeSn, 45, 'yenilemeSn "45"');
    eq(K.normalize({ yenilemeSn: 45.6 }).yenilemeSn, 46, 'yenilemeSn 45.6');
  });

  await check('integers: bad text falls back; other ranges are clamped', () => {
    eq(K.normalize({ takipciHedefi: 'abc' }).takipciHedefi, 1000, 'takipciHedefi "abc"');
    eq(K.normalize({ takipciHedefi: 0 }).takipciHedefi, 1, 'takipciHedefi 0');
    eq(K.normalize({ takipciHedefi: 1e9 }).takipciHedefi, 1e8, 'takipciHedefi 1e9');
    eq(K.normalize({ takipciYedek: -5 }).takipciYedek, 0, 'takipciYedek -5');
    eq(K.normalize({ aboneHedefi: 0 }).aboneHedefi, 1, 'aboneHedefi 0');
    eq(K.normalize({ sohbetMaksMesaj: 99 }).sohbetMaksMesaj, 20, 'sohbetMaksMesaj 99');
    eq(K.normalize({ sohbetMaksMesaj: 2 }).sohbetMaksMesaj, 3, 'sohbetMaksMesaj 2');
  });

  await check('booleans: "true", 1, "0" and 0 parse; other text falls back', () => {
    eq(K.normalize({ oturumFarkiGoster: 'true' }).oturumFarkiGoster, true, '"true"');
    eq(K.normalize({ yuzdeGoster: 1 }).yuzdeGoster, true, '1');
    eq(K.normalize({ oturumFarkiGoster: 0 }).oturumFarkiGoster, false, '0');
    eq(K.normalize({ oturumFarkiGoster: '0' }).oturumFarkiGoster, false, '"0"');
    eq(K.normalize({ yuzdeGoster: 'maybe' }).yuzdeGoster, false, '"maybe" falls back to default');
  });

  await check('kanal is trimmed and lowercased', () => {
    eq(K.normalize({ kanal: '  ExAmple-Channel  ' }).kanal, 'example-channel', 'kanal');
  });

  await check('yayinciYazisi is cut to 24 characters', () => {
    eq(K.normalize({ yayinciYazisi: 'x'.repeat(30) }).yayinciYazisi.length, 24, 'length');
  });
}

async function testReadSettings() {
  section('Settings: readSettings() precedence and URL rules');

  await check('readSettings: defaults when nothing is set; result is frozen', () => {
    const { K } = loadCore();
    const s = K.readSettings();
    eqFields(s, DEFAULTS, '');
    ok(Object.isFrozen(s), 'settings object is not frozen');
    eq(s.apiBase, 'https://api.kick.com', 'apiBase default');
    eq(s.tokenBase, 'https://id.kick.com', 'tokenBase default');
    eq(s.kickClientId, '', 'kickClientId default');
  });

  await check('readSettings: precedence is AYARLAR.js < AYARLAR.local.js < URL', () => {
    const { K } = loadCore({
      ayarlar: { kanal: 'FromFile', stil: 'neon', takipciHedefi: 500 },
      yerel: { stil: 'minimal', takipciHedefi: 700 },
      search: '?stil=pastel'
    });
    const s = K.readSettings();
    eq(s.kanal, 'fromfile', 'kanal from AYARLAR.js');
    eq(s.stil, 'pastel', 'stil from URL wins');
    eq(s.takipciHedefi, 700, 'takipciHedefi from AYARLAR.local.js');
    eq(s.sekil, 'pill', 'sekil default');
  });

  await check('readSettings: English names work in AYARLAR.js, AYARLAR.local.js and the URL', () => {
    const { K } = loadCore({
      ayarlar: { channel: 'FromFile', theme: 'neon', followerGoal: 500, alertSeconds: 99 },
      yerel: { theme: 'minimal', relayAddress: 'http://127.0.0.1:9100' },
      search: '?shape=square&alertFollows=false'
    });
    const s = K.readSettings();
    eqFields(s, { kanal: 'fromfile', stil: 'minimal', takipciHedefi: 500, uyariSn: 30, sekil: 'square', uyariTakip: false, relayAdresi: 'http://127.0.0.1:9100' }, '');
    ok(!('channel' in s) && !('theme' in s), 'aliases are resolved, not copied into the settings');
  });

  await check('readSettings: within one source the Turkish name wins; a later source wins under either name', () => {
    const { K } = loadCore({ ayarlar: { stil: 'neon', theme: 'pastel', kanal: 'a' }, search: '?channel=b' });
    const s = K.readSettings();
    eq(s.stil, 'neon', 'Turkish key beats its alias in AYARLAR.js');
    eq(s.kanal, 'b', 'URL alias beats the file');
  });

  await check('readSettings: the relayAddress alias is local-only, like relayAdresi', () => {
    const { K } = loadCore({ search: '?relayAddress=https://evil.example.com&relayAdresi=https://evil.example.com' });
    eq(K.readSettings().relayAdresi, 'http://127.0.0.1:8790', 'relay address from the URL');
  });

  await check('settings: unknown keys and an own __proto__ from parsed JSON never reach the settings', () => {
    const { K } = loadCore({ ayarlar: JSON.parse('{"__proto__": {"stil": "neon"}, "evil": 1, "kanal": "ok"}') });
    const s = K.readSettings();
    eq(s.stil, 'glass', 'stil from a polluted prototype');
    eq(s.kanal, 'ok', 'kanal');
    ok(!('evil' in s), 'unknown key copied');
    eq(K.normalize(JSON.parse('{"__proto__": {"renk": "#ffffff"}}')).renk, '#53fc18', 'normalize ignores __proto__');
  });

  await check('aliases: every English name points at a real setting, and none shadows a Turkish key', () => {
    const { K } = loadCore();
    const al = K.aliases();
    const keys = K.schemaKeys().concat(['relayAdresi']);
    Object.keys(al).forEach((en) => {
      ok(keys.includes(al[en]), en + ' -> ' + al[en] + ' is not a setting');
      ok(!keys.includes(en), en + ' is also a Turkish key');
    });
    eq(new Set(Object.values(al)).size, Object.keys(al).length, 'one alias per setting');
    eq(K.schemaKeys().filter((k) => !Object.values(al).includes(k)), [], 'public settings without an English name');
  });

  await check('alert settings: uyariSn is clamped to 3..30; the four kinds are booleans', () => {
    const { K } = loadCore();
    eqFields(K.normalize({ uyariSn: 1 }), { uyariSn: 3 }, '');
    eqFields(K.normalize({ uyariSn: '12' }), { uyariSn: 12 }, '');
    eqFields(K.normalize({ uyariSn: 600, uyariKicks: '0', uyariHediye: 'yes' }), { uyariSn: 30, uyariKicks: false, uyariHediye: true }, '');
  });

  await check('alert sound settings: volume is clamped to 0..100; alertSound and alertVolume are aliases', () => {
    const { K } = loadCore();
    eqFields(K.normalize({ uyariSesSeviye: -5 }), { uyariSesSeviye: 0 }, '');
    eqFields(K.normalize({ uyariSesSeviye: '250', uyariSes: '0' }), { uyariSesSeviye: 100, uyariSes: false }, '');
    eqFields(K.normalize({ alertVolume: 35, alertSound: 'false' }), { uyariSesSeviye: 35, uyariSes: false }, '');
  });

  await check('createAlertMedia: no sound when off or at 0; built-in tone when no file; unknown kinds are ignored', async () => {
    const { K } = loadCore();
    const off = K.createAlertMedia(K.normalize({ uyariSes: false }), ['follow']);
    await off.ready;
    eq(off.play('follow'), 'off', 'sound off');
    const zero = K.createAlertMedia(K.normalize({ uyariSesSeviye: 0 }), ['follow']);
    await zero.ready;
    eq(zero.play('follow'), 'off', 'volume 0');
    const on = K.createAlertMedia(K.normalize({}), ['follow', 'nope']);
    await on.ready;
    eq(on.play('nope'), 'off', 'unknown kind');
    eq(on.art('follow'), null, 'no art without a file');
    // The test sandbox has no Web Audio, so the tone path reports it could not play.
    eq(on.play('follow'), 'blocked', 'no Web Audio');
    eq(Object.keys(K.alertTones).sort(), ['follow', 'gift', 'kicks', 'reward', 'sub'], 'one tone per alert kind');
  });

  await check('rewardHidden: listed reward titles are hidden, any case; others and empty titles are not', () => {
    const { K } = loadCore();
    const s = K.normalize({ alertRewardsHidden: ' Hydrate | Shake  the screen ' });
    eq(s.uyariOdulGizle, 'Hydrate | Shake  the screen', 'alias alertRewardsHidden');
    eq(K.rewardHidden(s, 'hydrate'), true, 'case');
    eq(K.rewardHidden(s, 'Shake  the screen'), true, 'second title');
    eq(K.rewardHidden(s, 'Hydrate now'), false, 'whole title only');
    eq(K.rewardHidden(s, ''), false, 'empty title');
    eq(K.rewardHidden(K.normalize({}), 'Hydrate'), false, 'nothing hidden by default');
  });

  await check('stats settings: defaults, aliases and clamping', () => {
    const { K } = loadCore();
    eqFields(K.normalize({}), { olaySayisi: 5, liderTur: 'gift', liderSayisi: 5 });
    eqFields(K.normalize({ eventsCount: 8, leaderboardType: 'kicks', leaderboardCount: 3 }), { olaySayisi: 8, liderTur: 'kicks', liderSayisi: 3 }, 'alias ');
    eqFields(K.normalize({ olaySayisi: 99, liderTur: 'bits', liderSayisi: 1 }), { olaySayisi: 10, liderTur: 'gift', liderSayisi: 3 }, 'clamped ');
  });

  await check('parseStats: keeps well-formed entries, drops odd ones, never throws', () => {
    const { K } = loadCore();
    const empty = { totals: { follows: 0, subs: 0, gifted: 0, kicks: 0 }, recent: [], topGifters: [], topKicks: [], subTimes: [] };
    for (const bad of [null, undefined, 'x', 5, [], { totals: 'x', recent: {}, topGifters: 'x' }]) eq(JSON.parse(JSON.stringify(K.parseStats(bad))), empty, 'empty for ' + JSON.stringify(bad));
    const p = K.parseStats({
      totals: { follows: 3, subs: -1, gifted: 2.7, kicks: 'lots' },
      recent: [
        { kind: 'follow', name: '  Mia \t ', at: 5 },
        { kind: 'gift', anonymous: true, name: 'hidden', count: 3, at: 4 },
        { kind: 'gift', name: '', count: 1, at: 3 },
        { kind: 'chat', name: 'x', at: 2 },
        { kind: 'sub', name: 'Kenji', months: 0, at: 1 },
        null
      ],
      topGifters: [{ name: 'Alex', count: 4 }, { name: 'NoCount' }, { name: '', count: 2 }],
      topKicks: [{ name: 'Luna', amount: 500 }, { name: 'Zero', amount: 0 }],
      subTimes: [{ at: 1, n: 2 }, { at: 'x', n: 1 }, { at: 2, n: 0 }]
    });
    eq(JSON.parse(JSON.stringify(p.totals)), { follows: 3, subs: 0, gifted: 2, kicks: 0 }, 'totals');
    eq(p.recent.map((e) => e.kind + ':' + e.name + ':' + e.anonymous), ['follow:Mia:false', 'gift::true', 'sub:Kenji:false'], 'recent');
    eq(p.recent[2].months, 1, 'months floor');
    eq(p.recent[1].count, 3, 'gift count');
    eq(p.topGifters.map((x) => x.name + '=' + x.count), ['Alex=4'], 'gifters');
    eq(p.topKicks.map((x) => x.name + '=' + x.amount), ['Luna=500'], 'kicks');
    eq(p.subTimes.length, 1, 'sub times');
    const many = K.parseStats({ recent: Array.from({ length: 40 }, (_, i) => ({ kind: 'follow', name: 'u' + i, at: i })) });
    eq(many.recent.length, 20, 'recent capped');
  });

  await check('ozelCss: plain rules pass; anything that can load from elsewhere rejects the whole value', () => {
    const { K } = loadCore();
    const css = (v) => K.normalize({ customCss: v }).ozelCss;
    eq(css('  .ko-label { letter-spacing: 2px; } /* note */ '), '.ko-label { letter-spacing: 2px; }', 'plain rule kept, comment dropped');
    eq(css('.ko-bar{background:linear-gradient(#000,#111)}'), '.ko-bar{background:linear-gradient(#000,#111)}', 'gradients are fine');
    for (const bad of [
      '.a{background:url(https://evil.example/x.png)}', '.a{background:URL ( //evil.example/x )}', '@import "https://evil.example/x.css";',
      '@font-face{font-family:x}', '.a{background-image:image-set("https://evil.example/a.png" 1x)}', '.a{background:-webkit-image-set("x" 1x)}',
      '.a{content:"\\75 rl(x)"}', '.a{background:url/**/(x)}', '.a{x:expression(alert(1))}', '@namespace x url(y);',
      '</style><script>', '.a{behavior:url(x.htc)}', 'x'.repeat(2001)
    ]) eq(css(bad), '', 'rejected: ' + bad.slice(0, 40));
    eq(css(42), '', 'not a string');
  });

  await check('sohbetYatay: off by default, alias chatHorizontal', () => {
    const { K } = loadCore();
    eq(K.normalize({}).sohbetYatay, false, 'default');
    eq(K.normalize({ chatHorizontal: 'on' }).sohbetYatay, true, 'alias');
  });

  await check('stepGoal: off at 0; a reached goal rises by whole steps past the total', () => {
    const { K } = loadCore();
    eq(K.stepGoal(1000, 0, 5000), 1000, 'step 0 = off');
    eq(K.stepGoal(1000, 250, 999), 1000, 'not reached');
    eq(K.stepGoal(1000, 250, 1000), 1250, 'reached exactly');
    eq(K.stepGoal(1000, 250, 1749), 1750, 'several steps');
    eq(K.stepGoal(1000, 250, 1750), 2000, 'on a step');
    eq(K.normalize({ goalStep: 50, kicksGoal: 2000, subTrainSeconds: 45 }).hedefArtis, 50, 'alias goalStep');
    eqFields(K.normalize({ hedefArtis: -3, kicksHedefi: 0, trenSn: 9999 }), { hedefArtis: 0, kicksHedefi: 1, trenSn: 600 }, 'clamped ');
  });

  await check('createGoalBar: with hedefArtis the shown goal steps up and the percentage follows it', () => {
    const { K } = loadCore();
    const mk = () => ({ textContent: '', hidden: false, style: { setProperty() {} }, classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } });
    const els = { fill: mk(), pct: mk(), goal: mk() };
    const bar = K.createGoalBar(els, 100, K.normalize({ hedefArtis: 50, yuzdeGoster: true, animasyon: 'off' }));
    eq(els.goal.textContent, '100', 'initial goal');
    bar.set(40);
    eq(els.pct.textContent, '40%', 'below the goal');
    bar.set(120);
    eq(els.goal.textContent + ' ' + els.pct.textContent, '150 80%', 'stepped once');
    bar.set(260);
    eq(els.goal.textContent, '300', 'stepped past the total');
    bar.destroy();
  });

  await check('subTrain: counts the chain of subscriptions inside the window, ends after it', () => {
    const { K } = loadCore();
    const W = 60000;
    eq(K.subTrain([], W, 1000), null, 'no subs');
    eq(K.subTrain(null, W, 1000), null, 'bad input');
    const t = [{ at: 0, n: 1 }, { at: 100000, n: 2 }, { at: 130000, n: 5 }, { at: 170000, n: 1 }];
    eq(JSON.parse(JSON.stringify(K.subTrain(t, W, 180000))), { count: 8, endsAt: 230000 }, 'the chain after the 100 s gap');
    eq(K.subTrain(t, W, 230000), null, 'ended at the window');
    eq(K.subTrain([{ at: 'x', n: 1 }, { at: 10, n: 0 }], W, 20), null, 'odd entries ignored');
  });

  await check('eventText and sampleStats: labels per kind and language; the sample fills both overlays', () => {
    const { K } = loadCore();
    const en = K.normalize({ dil: 'en' }), tr = K.normalize({ dil: 'tr' });
    eq(K.eventText(en, { kind: 'follow', name: 'Mia' }).detail, 'followed', 'follow en');
    eq(K.eventText(tr, { kind: 'follow', name: 'Mia' }).detail, 'takip etti', 'follow tr');
    eq(K.eventText(en, { kind: 'sub', name: 'S', months: 6 }).detail, 'subscribed for 6 months', 'sub months');
    eq(K.eventText(en, { kind: 'sub', name: 'S', months: 1 }).detail, 'subscribed', 'sub first');
    eq(K.eventText(en, { kind: 'gift', name: 'A', count: 1 }).detail, 'gifted a sub', 'one gift');
    const anon = K.eventText(en, { kind: 'gift', name: '', anonymous: true, count: 5 });
    eq(anon.name + ' ' + anon.detail, 'Anonymous gifted 5 subs', 'anonymous gift');
    eq(K.eventText(en, { kind: 'kicks', name: 'L', amount: 1500 }).detail, '1,500 Kicks', 'kicks');
    const s = K.sampleStats(1000000);
    ok(s.recent.length >= 10 && s.topGifters.length >= 5 && s.topKicks.length >= 5, 'sample covers 10 events and 5 names');
  });

  await check('ttsText: off by default; reads Kicks and reward messages; drops links; blocks words; cuts at a word', () => {
    const { K } = loadCore();
    const ev = { kind: 'kicks', username: 'Luna', message: 'GG well played' };
    eq(K.ttsText(K.normalize({}), ev), '', 'off by default');
    const on = K.normalize({ alertTts: true, alertTtsMaxLength: 20, alertTtsBlockedWords: ' BadWord , ,spam' });
    eq(on.uyariTts === true && on.uyariTtsUzunluk === 20 && on.uyariTtsYasak === 'BadWord , ,spam', true, 'aliases');
    eq(K.ttsText(on, ev), 'Luna: GG well played', 'kicks message');
    eq(K.ttsText(on, { kind: 'reward', username: 'Rin', message: 'see https://evil.example/x and www.x.io now' }), 'Rin: see and now', 'links dropped');
    eq(K.ttsText(on, { kind: 'follow', username: 'Mia', message: 'hi' }), '', 'only kicks and reward');
    eq(K.ttsText(on, { kind: 'kicks', username: 'Luna', message: '   ' }), '', 'empty message');
    eq(K.ttsText(on, { kind: 'kicks', username: 'Luna', message: 'you are a BADWORDer' }), '', 'blocked inside a word, any case');
    eq(K.ttsText(on, { kind: 'kicks', username: 'spammer', message: 'hello' }), '', 'blocked in the name');
    eq(K.ttsText(on, { kind: 'kicks', username: 'Luna', message: 'one two three four five six' }), 'Luna: one two three four', 'cut at a word break (20 characters)');
    eq(K.ttsText(on, { kind: 'kicks', username: 'Luna', message: 'x'.repeat(50) }), 'Luna: ' + 'x'.repeat(20), 'one long word is cut hard');
    eq(K.normalize({ uyariTtsUzunluk: 5 }).uyariTtsUzunluk, 20, 'length clamped');
  });

  await check('obsSceneCollection: an importable OBS collection with one Browser source per overlay', () => {
    const { K } = loadCore({ crypto: require('crypto').webcrypto });
    const c = K.obsSceneCollection({ name: 'Kick Overlay Pack', scene: 'Kick Overlays', items: [
      { name: 'Kick · Chat', url: 'file:///C:/pack/chat.html?kanal=iacbi', width: 460, height: 760, x: 1420, y: 150 },
      { name: 'Kick · Alerts', url: 'file:///C:/pack/alerts.html', width: 640, height: 200, x: 640, y: 60, audio: true },
      { name: 'Kick · Countdown', url: 'file:///C:/pack/countdown.html', width: 520, height: 190, x: 700, y: 445, visible: false }
    ] });
    // OBS's importer refuses a file without name, current_scene and sources.
    eq([c.name, c.current_scene, c.current_program_scene], ['Kick Overlay Pack', 'Kick Overlays', 'Kick Overlays'], 'header');
    eq(c.scene_order, [{ name: 'Kick Overlays' }], 'scene order');
    const scene = c.sources[0];
    eq([scene.id, scene.name, c.sources.length], ['scene', 'Kick Overlays', 4], 'scene first, then the browser sources');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    eq(c.sources.every((x) => UUID.test(x.uuid)), true, 'every uuid is a 36-character v4 UUID');
    eq(new Set(c.sources.map((x) => x.uuid)).size, 4, 'uuids are unique');
    const chat = c.sources[1];
    eq([chat.id, chat.settings.is_local_file, chat.settings.url, chat.settings.width, chat.settings.height], ['browser_source', false, 'file:///C:/pack/chat.html?kanal=iacbi', 460, 760], 'browser source settings');
    eq([chat.settings.reroute_audio, c.sources[2].settings.reroute_audio], [undefined, true], 'only the alerts source routes its audio through OBS');
    const items = scene.settings.items;
    eq(items.map((i) => i.source_uuid), c.sources.slice(1).map((x) => x.uuid), 'scene items point at their sources');
    eq(items.map((i) => i.visible), [true, true, false], 'visibility');
    eq([items[0].pos, items[0].scale, items[0].align], [{ x: 1420, y: 150 }, { x: 1, y: 1 }, 5], 'top-left aligned, pixel position, unscaled');
    eq([scene.settings.id_counter, items.map((i) => i.id)], [3, [1, 2, 3]], 'item ids');
  });

  await check('readSettings: URL values are normalized like file values', () => {
    const { K } = loadCore({ search: '?stil=NEON&yenilemeSn=1&kanal=%20Mixed%20&yuzdeGoster=true&renk=red' });
    const s = K.readSettings();
    eqFields(s, { stil: 'neon', yenilemeSn: 10, kanal: 'mixed', yuzdeGoster: true, renk: '#53fc18' }, '');
  });

  await check('readSettings: URL cannot override Kick credentials or API bases', () => {
    const { K } = loadCore({
      yerel: { kickClientId: 'local-id', kickClientSecret: 'local-secret' },
      search: '?kickClientId=url-id&kickClientSecret=url-secret&apiBase=https://evil.example.com&tokenBase=https://evil.example.com'
    });
    const s = K.readSettings();
    // Messages avoid printing the values on purpose.
    ok(s.kickClientId === 'local-id', 'kickClientId was overridden from the URL');
    ok(s.kickClientSecret === 'local-secret', 'kickClientSecret was overridden from the URL');
    eq(s.apiBase, 'https://api.kick.com', 'apiBase from URL');
    eq(s.tokenBase, 'https://id.kick.com', 'tokenBase from URL');
  });

  await check('readSettings: Kick credentials are read only from AYARLAR.local.js, never from AYARLAR.js', () => {
    const fromFile = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret', apiBase: 'https://api.kick.test', relayAdresi: 'http://127.0.0.1:9999' }
    }).K.readSettings();
    // Messages avoid printing the values on purpose.
    ok(fromFile.kickClientId === '', 'kickClientId was taken from AYARLAR.js');
    ok(fromFile.kickClientSecret === '', 'kickClientSecret was taken from AYARLAR.js');
    eq(fromFile.apiBase, 'https://api.kick.test', 'apiBase may still come from AYARLAR.js');
    eq(fromFile.relayAdresi, 'http://127.0.0.1:9999', 'relayAdresi may still come from AYARLAR.js');
    const both = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret' },
      yerel: { kickClientId: 'local-id', kickClientSecret: 'local-secret' }
    }).K.readSettings();
    ok(both.kickClientId === 'local-id', 'kickClientId must come from AYARLAR.local.js');
    ok(both.kickClientSecret === 'local-secret', 'kickClientSecret must come from AYARLAR.local.js');
    const mixed = loadCore({
      ayarlar: { kickClientId: 'file-id', kickClientSecret: 'file-secret' },
      yerel: { kickClientId: 'local-id' }
    }).K.readSettings();
    ok(mixed.kickClientSecret === '', 'a file secret must not pair with a local id');
  });

  await check('readSettings: apiBase and tokenBase accept https with a trailing slash (slash removed)', () => {
    const { K } = loadCore({ yerel: { apiBase: 'https://api.kick.test/', tokenBase: 'https://id.kick.test//' } });
    const s = K.readSettings();
    eq(s.apiBase, 'https://api.kick.test', 'apiBase');
    eq(s.tokenBase, 'https://id.kick.test', 'tokenBase');
  });

  await check('readSettings: apiBase accepts http://localhost:PORT/ (with slash)', () => {
    const { K } = loadCore({ yerel: { apiBase: 'http://localhost:8787/', tokenBase: 'http://127.0.0.1:8787/' } });
    const s = K.readSettings();
    eq(s.apiBase, 'http://localhost:8787', 'apiBase');
    eq(s.tokenBase, 'http://127.0.0.1:8787', 'tokenBase');
  });

  await check('readSettings: apiBase and tokenBase accept http://localhost:PORT without a trailing slash', () => {
    const { K } = loadCore({ yerel: { apiBase: 'http://localhost:8787', tokenBase: 'http://localhost:8787' } });
    const s = K.readSettings();
    eq(s.apiBase, 'http://localhost:8787', 'apiBase');
    eq(s.tokenBase, 'http://localhost:8787', 'tokenBase');
  });

  await check('readSettings: apiBase and tokenBase reject other hosts and schemes', () => {
    const bad = ['http://evil.example.com', 'http://localhost.evil.example/', 'http://127.0.0.1.evil.example/',
      'ftp://example.com/', 'javascript:alert(1)', 'http://user@evil.example.com/'];
    bad.forEach((v) => {
      const { K } = loadCore({ yerel: { apiBase: v, tokenBase: v } });
      const s = K.readSettings();
      eq(s.apiBase, 'https://api.kick.com', 'apiBase for ' + v);
      eq(s.tokenBase, 'https://id.kick.com', 'tokenBase for ' + v);
    });
  });

  await check('AYARLAR.js loads and holds no Kick credentials', () => {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SETTINGS_FILE, 'utf8'), sandbox, { filename: SETTINGS_FILE });
    const raw = sandbox.KICK_OVERLAY_AYARLAR;
    ok(raw && typeof raw === 'object', 'KICK_OVERLAY_AYARLAR is not an object');
    ok(!('kickClientId' in raw) && !('kickClientSecret' in raw), 'AYARLAR.js contains Kick credentials');
  });

  await check('AYARLAR.js uses the English setting names, every one known, and sets nothing away from its default', () => {
    const sandbox = {};
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(SETTINGS_FILE, 'utf8'), sandbox, { filename: SETTINGS_FILE });
    const raw = sandbox.KICK_OVERLAY_AYARLAR;
    const { K } = loadCore();
    const names = K.aliases();
    const unknown = Object.keys(raw).filter((k) => !Object.prototype.hasOwnProperty.call(names, k));
    eq(unknown.join(), '', 'keys that are not English setting names');
    eqFields(K.normalize(raw), K.normalize({}), 'shipped value of ');
  });

  await check('preview and quiet mode answer to the English parameter names and to the original ones', () => {
    ['?preview=1', '?onizleme=1', '?theme=neon&preview=1'].forEach((search) => {
      ok(loadCore({ search }).K.isPreview() === true, 'preview for ' + search);
    });
    ['', '?preview=0', '?xpreview=1', '?preview=10'].forEach((search) => {
      ok(loadCore({ search }).K.isPreview() === false, 'no preview for ' + search);
    });
  });

  await check('.gitignore excludes AYARLAR.local.js', () => {
    const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
    ok(lines.includes('AYARLAR.local.js'), 'AYARLAR.local.js is not in .gitignore');
  });
}

// ---- Section: labels, numbers, look, tween -------------------------------------

async function testHelpers() {
  section('Labels, numbers, look');
  const { K, ctx, env } = loadCore();

  await check('t() picks the language, joins tr / en for both, and falls back to English, then the key', () => {
    eq(K.t({ dil: 'tr' }, 'bar.follower'), 'Takipçi', 'tr');
    eq(K.t({ dil: 'en' }, 'bar.follower'), 'Follower', 'en');
    eq(K.t({ dil: 'both' }, 'bar.follower'), 'Takipçi / Follower', 'both');
    eq(K.t({ dil: 'de' }, 'bar.subscriber'), 'Abonnenten', 'de');
    eq(K.t({ dil: 'xx' }, 'bar.follower'), 'Follower', 'unknown language');
    eq(K.t({ dil: 'en' }, 'no.such.key'), 'no.such.key', 'unknown key');
    const saved = ctx.KICK_LANG.es['bar.follower'];
    delete ctx.KICK_LANG.es['bar.follower'];
    eq(K.t({ dil: 'es' }, 'bar.follower'), 'Follower', 'missing in es');
    ctx.KICK_LANG.es['bar.follower'] = saved;
    eq(K.t({ dil: 'en' }, 'dock.refused', { status: 503 }), 'The relay refused the request (HTTP 503).', 'named slot');
    eq(K.t({ dil: 'en' }, 'dock.refused'), 'The relay refused the request (HTTP {status}).', 'unfilled slot stays');
  });

  await check('t() picks plural forms with Intl.PluralRules and formats {n}', () => {
    eq(K.t({ dil: 'en' }, 'event.gifted', { n: 1 }), 'gifted a sub', 'en one');
    eq(K.t({ dil: 'en' }, 'event.gifted', { n: 1500 }), 'gifted 1,500 subs', 'en other');
    eq(K.t({ dil: 'de' }, 'alert.months', { n: 1 }), '1 Monat', 'de one');
    eq(K.t({ dil: 'de' }, 'alert.months', { n: 3 }), '3 Monate', 'de other');
    eq(K.t({ dil: 'tr' }, 'event.gifted', { n: 3 }), '3 abonelik hediye etti', 'tr has no plural');
    eq(K.t({ dil: 'ar' }, 'board.subs', { n: 2 }), 'اشتراكان', 'ar two');
    eq(K.t({ dil: 'ar' }, 'board.subs', { n: 5 }), '5 اشتراكات', 'ar few');
    eq(K.t({ dil: 'ar' }, 'board.subs', { n: 11 }), '11 اشتراكًا', 'ar many');
    eq(K.t({ dil: 'both' }, 'board.subs', { n: 2 }), '2 abonelik / 2 subs', 'both');
  });

  await check('useLang() sets lang, dir and the number locale; speechLang() picks the voice', () => {
    const cases = { tr: ['tr', 'ltr', '1.234.567'], en: ['en', 'ltr', '1,234,567'], both: ['en', 'ltr', '1,234,567'],
      es: ['es', 'ltr', '1.234.567'], pt: ['pt', 'ltr', '1.234.567'], de: ['de', 'ltr', '1.234.567'], ar: ['ar', 'rtl', '1,234,567'] };
    Object.keys(cases).forEach((dil) => {
      ctx.document = fakeDocument('');
      K.useLang(K.normalize({ dil }));
      const [lang, dir, n] = cases[dil];
      eq(ctx.document.documentElement.lang, lang, dil + ' lang');
      eq(ctx.document.documentElement.dir, dir, dil + ' dir');
      eq(K.fmt(1234567), n, dil + ' number');
    });
    eq(K.speechLang({ dil: 'both' }), 'tr-TR', 'both speaks Turkish');
    eq(K.speechLang({ dil: 'ar' }), 'ar-SA', 'ar');
    eq(K.speechLang({ dil: 'pt' }), 'pt-BR', 'pt');
    K.useLang(K.normalize({ dil: 'en' }));
  });

  await check('fmt() groups thousands and handles bad input', () => {
    eq(K.fmt(1234567), '1,234,567', '1234567');
    eq(K.fmt(0), '0', '0');
    eq(K.fmt('1234'), '1,234', 'string');
    eq(K.fmt(12.6), '13', 'rounds');
    eq(K.fmt(undefined), '0', 'undefined');
    eq(K.fmt('abc'), '0', 'text');
  });

  await check('pct() handles goal 0, bad goals, negatives and values over the goal', () => {
    eq(K.pct(5, 0), 0, 'goal 0');
    eq(K.pct(5, -1), 0, 'negative goal');
    eq(K.pct(150, 100), 100, 'over goal is capped');
    eq(K.pct(-5, 100), 0, 'negative current');
    eq(K.pct(25, 100), 25, 'normal');
    ok(Math.abs(K.pct(1, 3) - 33.333) < 0.01, 'pct(1, 3)');
  });

  await check('applyLook() sets body classes and the accent variables', () => {
    const doc = fakeDocument('keep theme-old shape-x');
    ctx.document = doc;
    K.applyLook(K.normalize({ stil: 'neon', sekil: 'square', yaziTipi: 'mono', animasyon: 'off', renk: '#abc' }));
    const classes = doc.body.className.split(' ');
    ['keep', 'theme-neon', 'shape-square', 'font-mono', 'motion-off'].forEach((c) => ok(classes.includes(c), 'missing ' + c));
    ok(!classes.includes('theme-old') && !classes.includes('shape-x'), 'old look classes were kept');
    eq(doc.documentElement.style.values['--accent'], '#abc', '--accent');
    eq(doc.documentElement.style.values['--accent-rgb'], '170 187 204', '--accent-rgb');
  });

  await check('fmt() uses Turkish separators only for dil=tr, and applyLook() sets the document language', () => {
    ctx.document = fakeDocument('');
    K.applyLook(K.normalize({ dil: 'tr' }));
    eq(K.fmt(1234567), '1.234.567', 'tr');
    eq(ctx.document.documentElement.lang, 'tr', 'lang tr');
    K.applyLook(K.normalize({ dil: 'both' }));
    eq(K.fmt(1234567), '1,234,567', 'both');
    eq(ctx.document.documentElement.lang, 'en', 'lang en');
  });

  await check('applyLook() picks the chip text colour by WCAG contrast with the accent', () => {
    const pick = (renk) => {
      const doc = fakeDocument('');
      ctx.document = doc;
      K.applyLook(K.normalize({ renk }));
      const v = doc.documentElement.style.values;
      eq(v['--chip-bg'], renk, '--chip-bg is the accent');
      return v['--chip-text'];
    };
    eq(pick('#53fc18'), '#0b0b0d', 'bright green gets dark text');
    eq(pick('#ffd400'), '#0b0b0d', 'yellow gets dark text');
    eq(pick('#7c3aed'), '#ffffff', 'violet gets white text');
    eq(pick('#e11d48'), '#ffffff', 'red gets white text');
    eq(pick('#ffffff'), '#0b0b0d', 'white gets dark text');
    eq(pick('#000000'), '#ffffff', 'black gets white text');
    eq(pick('#abc'), '#0b0b0d', 'short hex works');
  });

  await check('tween() with 0 ms jumps straight to the end', () => {
    const seen = [];
    K.tween(0, 10, 0, (v) => seen.push(v));
    eq(seen, [10], 'values');
  });

  await check('tween() calls onDone after the last frame, not after a cancel, and at once for 0 ms', () => {
    const { K: K2, env: env2 } = loadCore();
    const log = [];
    K2.tween(0, 10, 0, () => log.push('f'), () => log.push('done'));
    eq(log, ['f', 'done'], 'zero duration');
    const seen = [];
    K2.tween(0, 10, 100, () => seen.push('f'), () => seen.push('done'));
    env2.now = 50;
    env2.frames.shift()(50);
    eq(seen, ['f'], 'not done mid-way');
    env2.now = 100;
    env2.frames.shift()(100);
    eq(seen, ['f', 'f', 'done'], 'done after the final frame');
    const c = [];
    const cancel = K2.tween(0, 10, 100, () => c.push('f'), () => c.push('done'));
    cancel();
    env2.frames.shift()(100);
    eq(c, [], 'cancelled tween stays silent');
  });

  await check('tween() jumps to the end when the OS asks for reduced motion', () => {
    const { K: K2, ctx: ctx2, env: env2 } = loadCore();
    ctx2.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q) });
    const seen = [];
    let done = 0;
    K2.tween(0, 100, 1000, (v) => seen.push(v), () => { done += 1; });
    eq(seen, [100], 'values');
    eq(done, 1, 'onDone');
    eq(env2.frames.length, 0, 'no frames requested');
    ctx2.matchMedia = () => ({ matches: false });
    K2.tween(0, 100, 1000, (v) => seen.push(v));
    eq(env2.frames.length, 1, 'frames come back without the preference');
  });

  await check('tween() eases over time with the frame clock', () => {
    const seen = [];
    K.tween(0, 100, 1000, (v) => seen.push(v));
    env.now = 500;
    env.frames.shift()(500);
    env.now = 1000;
    env.frames.shift()(1000);
    ok(seen.length === 2, 'expected two frames, got ' + seen.length);
    ok(Math.abs(seen[0] - 87.5) < 1e-9, 'mid-frame value ' + seen[0]);
    eq(seen[1], 100, 'end value');
    eq(env.frames.length, 0, 'extra frames requested');
  });
}

module.exports = { testCoreApi, testNormalize, testReadSettings, testHelpers };
