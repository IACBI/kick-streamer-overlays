'use strict';

const {
  vm, RELAY, check, section, eq, eqFields, ok, loadCore, fakeNet, fakeDocument, fakeClock, setRandom, fakeEl,
  fakeHeadDocument, fakeVisibilityDocument
} = require('./harness.js');

async function testSettingsV23() {
  section('v2.3.0 settings: new keys, clock, asBool, kanal');
  const { K } = loadCore();

  await check('schemaKeys() includes every new public key', () => {
    ['geriSayimSaat', 'sohbetKomutGizle', 'sohbetGizliKullanicilar', 'sohbetSilinmeSn', 'hataNotu', 'hedefKutlama']
      .forEach((k) => ok(K.schemaKeys().includes(k), 'missing ' + k));
    ok(!K.schemaKeys().includes('relayAdresi'), 'relayAdresi must stay local-only');
  });

  await check('new keys: defaults', () => {
    eqFields(K.normalize({}), {
      geriSayimSaat: '', sohbetKomutGizle: false, sohbetGizliKullanicilar: '', sohbetSilinmeSn: 0, hataNotu: true, hedefKutlama: true
    }, '');
  });

  await check('geriSayimSaat (clock): HH:MM is zero-padded; invalid values give ""', () => {
    eq(K.normalize({ geriSayimSaat: '9:05' }).geriSayimSaat, '09:05', '9:05');
    eq(K.normalize({ geriSayimSaat: '21:30' }).geriSayimSaat, '21:30', '21:30');
    eq(K.normalize({ geriSayimSaat: ' 00:00 ' }).geriSayimSaat, '00:00', 'padded input');
    eq(K.normalize({ geriSayimSaat: '23:59' }).geriSayimSaat, '23:59', '23:59');
    ['24:00', '12:60', '1:5', 'abc', '', '12', '12:30:00', '-1:00', 12.5, null, undefined].forEach((v) =>
      eq(K.normalize({ geriSayimSaat: v }).geriSayimSaat, '', 'value ' + JSON.stringify(v)));
  });

  await check('asBool: case-insensitive true/false, yes/no, on/off, 1/0; junk falls back to the default', () => {
    ['true', 'TRUE', 'True', 'yes', 'YES', 'on', 'On', ' on ', '1', 1, true].forEach((v) =>
      eq(K.normalize({ yuzdeGoster: v }).yuzdeGoster, true, 'true for ' + JSON.stringify(v)));
    ['false', 'FALSE', 'no', 'No', 'off', 'OFF', ' off ', '0', 0, false].forEach((v) =>
      eq(K.normalize({ oturumFarkiGoster: v }).oturumFarkiGoster, false, 'false for ' + JSON.stringify(v)));
    eq(K.normalize({ yuzdeGoster: 'maybe' }).yuzdeGoster, false, 'junk falls back (default false)');
    eq(K.normalize({ oturumFarkiGoster: 'maybe' }).oturumFarkiGoster, true, 'junk falls back (default true)');
    eq(K.normalize({ hataNotu: '' }).hataNotu, true, 'empty falls back');
    eq(K.normalize({ hataNotu: 2 }).hataNotu, true, 'number 2 falls back');
  });

  await check('sohbetSilinmeSn is clamped to 0..600; sohbetGizliKullanicilar is cut to 300', () => {
    eq(K.normalize({ sohbetSilinmeSn: -5 }).sohbetSilinmeSn, 0, '-5');
    eq(K.normalize({ sohbetSilinmeSn: 9999 }).sohbetSilinmeSn, 600, '9999');
    eq(K.normalize({ sohbetSilinmeSn: '45' }).sohbetSilinmeSn, 45, '"45"');
    eq(K.normalize({ sohbetSilinmeSn: 'x' }).sohbetSilinmeSn, 0, 'junk');
    eq(K.normalize({ sohbetGizliKullanicilar: ' Bot1, Bot2 ' }).sohbetGizliKullanicilar, 'Bot1, Bot2', 'trimmed');
    eq(K.normalize({ sohbetGizliKullanicilar: 'x'.repeat(400) }).sohbetGizliKullanicilar.length, 300, 'length');
  });

  await check('new keys can be overridden from the URL', () => {
    const { K: K2 } = loadCore({
      search: '?geriSayimSaat=8:15&sohbetKomutGizle=yes&sohbetGizliKullanicilar=Bot1%2CBot2&sohbetSilinmeSn=30&hataNotu=off&hedefKutlama=0'
    });
    eqFields(K2.readSettings(), {
      geriSayimSaat: '08:15', sohbetKomutGizle: true, sohbetGizliKullanicilar: 'Bot1,Bot2', sohbetSilinmeSn: 30,
      hataNotu: false, hedefKutlama: false
    }, '');
  });

  await check('kanal: kick.com links, @ prefix and extra path are stripped; result is lowercase and <= 40', () => {
    const cases = {
      'https://kick.com/ExAmple': 'example',
      'https://kick.com/example/videos?x=1': 'example',
      'https://www.kick.com/Example': 'example',
      'kick.com/Example': 'example',
      'KICK.COM/Example/': 'example',
      '@Example': 'example',
      '  @Example  ': 'example',
      'https://kick.com/@Example': 'example',
      'example/extra': 'example',
      'example?ref=1': 'example',
      '': '',
      '   ': ''
    };
    Object.keys(cases).forEach((v) => eq(K.normalize({ kanal: v }).kanal, cases[v], 'kanal ' + JSON.stringify(v)));
    eq(K.normalize({ kanal: 'a'.repeat(60) }).kanal, 'a'.repeat(40), 'cut to 40');
    eq(K.normalize({ kanal: 'https://kick.com/' + 'B'.repeat(60) }).kanal, 'b'.repeat(40), 'link then cut to 40');
    eq(K.normalize({ kanal: 123 }).kanal, '', 'number');
  });

  await check('kanal from the URL parameter is cleaned the same way', () => {
    const { K: K2 } = loadCore({ search: '?kanal=https%3A%2F%2Fkick.com%2FMixed' });
    eq(K2.readSettings().kanal, 'mixed', 'kanal');
  });

  await check('relayAdresi: never from the URL; accepted from AYARLAR.js and AYARLAR.local.js', () => {
    eq(loadCore({ search: '?relayAdresi=http://127.0.0.1:9999' }).K.readSettings().relayAdresi, RELAY, 'URL ignored');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://127.0.0.1:9000/' } }).K.readSettings().relayAdresi, 'http://127.0.0.1:9000', 'AYARLAR.js');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://127.0.0.1:9000' }, yerel: { relayAdresi: 'http://localhost:9100' } })
      .K.readSettings().relayAdresi, 'http://localhost:9100', 'local wins');
    eq(loadCore({ ayarlar: { relayAdresi: 'http://evil.example.com:8790' } }).K.readSettings().relayAdresi, RELAY, 'plain http to a non-loopback host is rejected');
  });
}

async function testHelpersV23() {
  section('v2.3.0 helpers: fmt cache, setFill, isDebug, loadFont, text, note, debug');

  await check('fmt() builds one Intl.NumberFormat per locale and stays correct when the locale switches', () => {
    const { K, ctx } = loadCore();
    const Real = vm.runInContext('Intl', ctx);
    let made = 0;
    ctx.Intl = { NumberFormat: function (locale, o) { made += 1; return new Real.NumberFormat(locale, o); } };
    ctx.document = fakeDocument('');
    eq(K.fmt(1234567), '1,234,567', 'en first');
    eq(K.fmt(1000), '1,000', 'en second');
    eq(K.fmt(12.6), '13', 'en rounds');
    eq(made, 1, 'formatters after 3 calls in one locale');
    K.applyLook(K.normalize({ dil: 'tr' }));
    eq(K.fmt(1234567), '1.234.567', 'tr');
    eq(K.fmt(2000), '2.000', 'tr second');
    eq(made, 2, 'formatters after switching to tr');
    K.applyLook(K.normalize({ dil: 'en' }));
    eq(K.fmt(1234567), '1,234,567', 'back to en');
    eq(made, 2, 'switching back reuses the cached formatter');
  });

  await check('fmt() still works when Intl is unavailable', () => {
    const { K, ctx } = loadCore();
    ctx.Intl = undefined;
    eq(K.fmt(1234567), '1,234,567', 'fallback');
  });

  await check('setFill() writes --fill as a 4-digit ratio, clamped to 0..1', () => {
    const { K } = loadCore();
    const el = fakeEl();
    K.setFill(el, 25);
    eq(el.style.vals['--fill'], '0.2500', '25');
    K.setFill(el, 100);
    eq(el.style.vals['--fill'], '1.0000', '100');
    K.setFill(el, 33.3333);
    eq(el.style.vals['--fill'], '0.3333', '33.3333');
    K.setFill(el, 0);
    eq(el.style.vals['--fill'], '0.0000', '0');
    K.setFill(el, 250);
    eq(el.style.vals['--fill'], '1.0000', 'over 100');
    K.setFill(el, -5);
    eq(el.style.vals['--fill'], '0.0000', 'negative');
    K.setFill(el, NaN);
    eq(el.style.vals['--fill'], '0.0000', 'NaN');
    K.setFill(null, 50);
  });

  await check('isDebug(): true only for debug=1 in the URL', () => {
    eq(loadCore({ search: '?debug=1' }).K.isDebug(), true, 'debug=1');
    eq(loadCore({ search: '?kanal=x&debug=1&stil=neon' }).K.isDebug(), true, 'among others');
    eq(loadCore({ search: '?debug=0' }).K.isDebug(), false, 'debug=0');
    eq(loadCore({ search: '?debug=10' }).K.isDebug(), false, 'debug=10');
    eq(loadCore({ search: '?xdebug=1' }).K.isDebug(), false, 'xdebug=1');
    eq(loadCore().K.isDebug(), false, 'no query');
  });

  await check('loadFont(): one Google Fonts link for the chosen family only', () => {
    const urls = {
      inter: 'family=Inter:wght@400;500;600;700;800;900',
      poppins: 'family=Poppins:wght@400;600;700;800',
      nunito: 'family=Nunito:wght@400;600;700;800;900',
      mono: 'family=Roboto+Mono:wght@400;700'
    };
    Object.keys(urls).forEach((font) => {
      const doc = fakeHeadDocument();
      const { K } = loadCore({ document: doc });
      K.loadFont(K.normalize({ yaziTipi: font }));
      eq(doc.links.length, 1, 'links for ' + font);
      const href = doc.links[0].href;
      ok(href.startsWith('https://fonts.googleapis.com/css2?'), 'host for ' + font);
      ok(href.includes(urls[font]), 'family for ' + font + ': ' + href);
      ok(href.endsWith('&display=swap'), 'display=swap for ' + font);
      // Poppins has no tabular digits, so its numerals come from Inter; every other font loads alone.
      eq((href.match(/family=/g) || []).length, font === 'poppins' ? 2 : 1, 'family count for ' + font);
      if (font === 'poppins') ok(href.includes('family=Inter:wght@600..900'), 'Inter numerals for poppins: ' + href);
      eq(doc.links[0].rel, 'stylesheet', 'rel');
    });
  });

  await check('loadFont(): calling again reuses the same link; no document is not an error', () => {
    const doc = fakeHeadDocument();
    const { K } = loadCore({ document: doc });
    K.loadFont(K.normalize({ yaziTipi: 'inter' }));
    K.loadFont(K.normalize({ yaziTipi: 'mono' }));
    eq(doc.links.length, 1, 'still one link');
    ok(doc.links[0].href.includes('Roboto+Mono'), 'switched to mono');
    K.loadFont({});
    ok(doc.links[0].href.includes('Inter'), 'unknown font gives Inter');
    loadCore().K.loadFont(K.normalize({}));
  });

  await check('text(): all keys in tr, en and both; each language stays under 40 characters', () => {
    const keys = ['hint', 'auth', 'rate', 'error', 'noData', 'unreachable', 'stale', 'relayDown'];
    const { K } = loadCore();
    const tr = K.text(K.normalize({ dil: 'tr' }));
    const en = K.text(K.normalize({ dil: 'en' }));
    const both = K.text(K.normalize({ dil: 'both' }));
    eq(Object.keys(tr).sort(), keys.slice().sort(), 'tr keys');
    eq(Object.keys(en).sort(), keys.slice().sort(), 'en keys');
    eq(Object.keys(both).sort(), keys.slice().sort(), 'both keys');
    keys.forEach((k) => {
      ok(typeof tr[k] === 'string' && tr[k].trim() && tr[k].length < 40, 'tr.' + k + ' = ' + tr[k]);
      ok(typeof en[k] === 'string' && en[k].trim() && en[k].length < 40, 'en.' + k + ' = ' + en[k]);
      ok(tr[k] !== en[k], 'tr and en differ for ' + k);
      eq(both[k], tr[k] + ' / ' + en[k], 'both.' + k);
    });
    ok(en.hint.includes('AYARLAR.js'), 'hint mentions AYARLAR.js');
    ok(/unreachable/i.test(en.unreachable), 'unreachable text');
    ok(/out of date/i.test(en.stale), 'stale text');
  });

  await check('note(): sets text and toggles is-hidden', () => {
    const { K } = loadCore();
    const S = K.normalize({});
    const el = fakeEl();
    K.note(el, S, 'Kick unreachable');
    eq(el.textContent, 'Kick unreachable', 'text');
    ok(!el.classes.has('is-hidden'), 'visible with text');
    K.note(el, S, '');
    eq(el.textContent, '', 'cleared');
    ok(el.classes.has('is-hidden'), 'hidden when empty');
    K.note(null, S, 'x');
  });

  await check('note(): hidden when hataNotu=false, unless ?debug=1', () => {
    const quiet = { hataNotu: false };
    const el = fakeEl();
    loadCore().K.note(el, quiet, 'Kick unreachable');
    eq(el.textContent, 'Kick unreachable', 'text is still set');
    ok(el.classes.has('is-hidden'), 'hidden with hataNotu=false');
    const el2 = fakeEl();
    loadCore({ search: '?debug=1' }).K.note(el2, quiet, 'Kick unreachable');
    ok(!el2.classes.has('is-hidden'), 'visible in debug mode');
  });

  await check('debug(): renders one fixed box with key: value lines, merges calls, null removes a key', () => {
    const appended = [];
    const doc = {
      body: { appendChild: (el) => appended.push(el) },
      createElement: () => ({ className: '', textContent: '', style: {} })
    };
    const { K } = loadCore({ search: '?debug=1', document: doc });
    K.debug({ src: 'relay-v2', status: 200 });
    eq(appended.length, 1, 'one element');
    eq(appended[0].className, 'ko-debug', 'class');
    eq(appended[0].textContent, 'src: relay-v2\nstatus: 200', 'first text');
    K.debug({ status: 429, next: '12s' });
    eq(appended.length, 1, 'still one element');
    eq(appended[0].textContent, 'src: relay-v2\nstatus: 429\nnext: 12s', 'merged text');
    K.debug({ src: null });
    eq(appended[0].textContent, 'status: 429\nnext: 12s', 'key removed');
  });

  await check('debug(): does nothing when not in debug mode', () => {
    let created = 0;
    const doc = { body: { appendChild() { created += 1; } }, createElement() { created += 1; return {}; } };
    const { K } = loadCore({ search: '?stil=neon', document: doc });
    K.debug({ src: 'x' });
    eq(created, 0, 'DOM touched');
    loadCore({ search: '?debug=1' }).K.debug({ src: 'x' });
  });

  await check('getJson(): exposes Retry-After (seconds) on failures and X-Kick-Source on success', async () => {
    const net = fakeNet((c, n) => (n === 1
      ? { status: 429, body: {}, headers: { 'Retry-After': '30' } }
      : n === 2 ? { status: 429, body: {}, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }
        : { status: 200, body: { a: 1 }, headers: { 'X-Kick-Source': 'V1' } }));
    const { K } = loadCore({ fetch: net.fetch });
    const r1 = await K.getJson('https://example.test/x');
    eq([r1.ok, r1.status, r1.retryAfterMs], [false, 429, 30000], 'seconds to ms');
    const r2 = await K.getJson('https://example.test/x');
    eq(r2.retryAfterMs, undefined, 'HTTP-date is ignored');
    const r3 = await K.getJson('https://example.test/x');
    eq([r3.ok, r3.source], [true, 'v1'], 'source');
  });
}

async function testCreateGoalBar() {
  section('createGoalBar()');

  function make(over = {}, goal = 1000, withChips = true) {
    const clock = fakeClock();
    const { K, env } = loadCore(clock.opts());
    const S = K.normalize(Object.assign({ animasyon: 'off', yuzdeGoster: true, oturumFarkiGoster: true }, over));
    const els = { bar: fakeEl(), fill: fakeEl(), val: fakeEl(), pct: withChips ? fakeEl() : null, delta: withChips ? fakeEl() : null };
    return { K, env, S, els, clock, gb: K.createGoalBar(els, goal, S) };
  }

  await check('set(): fill variable, value text, no bump or milestone on the first value', () => {
    const { gb, els } = make();
    gb.set(250, 0);
    eq(els.fill.style.vals['--fill'], '0.2500', '--fill');
    eq(els.val.textContent, '250', 'value');
    ok(!els.bar.classes.has('ko-bump'), 'no bump on first value');
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone on first value');
  });

  await check('set(): bump only on increase', () => {
    const { gb, els } = make();
    gb.set(100, 0);
    gb.set(150, 0);
    ok(els.bar.classes.has('ko-bump'), 'bump on increase');
    els.bar.classes.delete('ko-bump');
    gb.set(150, 0);
    ok(!els.bar.classes.has('ko-bump'), 'no bump when unchanged');
    gb.set(120, 0);
    ok(!els.bar.classes.has('ko-bump'), 'no bump on decrease');
    eq(els.val.textContent, '120', 'value follows');
  });

  await check('set(): milestone class on crossing 25/50/75 %, removed after 1.2 s', async () => {
    const { gb, els, clock } = make();
    gb.set(100, 0);
    gb.set(240, 0);
    ok(!els.bar.classes.has('ko-milestone'), '24 % is no milestone');
    gb.set(260, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 25');
    await clock.advance(1199);
    ok(els.bar.classes.has('ko-milestone'), 'still there before 1.2 s');
    await clock.advance(1);
    ok(!els.bar.classes.has('ko-milestone'), 'removed at 1.2 s');
    gb.set(300, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone inside a band');
    gb.set(510, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 50');
    await clock.advance(1200);
    gb.set(760, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 75');
    await clock.advance(1200);
    gb.set(780, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone while staying above 75 %');
  });

  await check('set(): going down across a line and back up counts as crossing again', async () => {
    const { gb, els, clock } = make();
    gb.set(800, 0);
    gb.set(700, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'down: no milestone');
    gb.set(760, 0);
    ok(els.bar.classes.has('ko-milestone'), 'up through 75 again');
    await clock.advance(1200);
  });

  await check('set(): is-goal toggles with total >= goal', () => {
    const { gb, els } = make();
    gb.set(900, 0);
    ok(!els.bar.classes.has('is-goal'), 'below goal');
    gb.set(1000, 0);
    ok(els.bar.classes.has('is-goal'), 'at goal');
    gb.set(1200, 0);
    ok(els.bar.classes.has('is-goal'), 'above goal');
    eq(els.fill.style.vals['--fill'], '1.0000', 'fill capped at 1');
    gb.set(900, 0);
    ok(!els.bar.classes.has('is-goal'), 'goal state removed when total drops');
  });

  await check('set(): hedefKutlama=false gives no milestone and no is-goal', () => {
    const { gb, els } = make({ hedefKutlama: false });
    gb.set(100, 0);
    gb.set(600, 0);
    gb.set(1000, 0);
    ok(!els.bar.classes.has('ko-milestone'), 'no milestone');
    ok(!els.bar.classes.has('is-goal'), 'no is-goal');
    ok(els.bar.classes.has('ko-bump'), 'bump is unrelated and still works');
  });

  await check('set(): a milestone replaces the bump instead of stacking on it', () => {
    const { gb, els } = make();
    gb.set(100, 0);
    gb.set(150, 0);
    ok(els.bar.classes.has('ko-bump'), 'plain increase bumps');
    gb.set(260, 0);
    ok(els.bar.classes.has('ko-milestone'), 'crossed 25');
    ok(!els.bar.classes.has('ko-bump'), 'no bump together with the milestone');
    const b = make({ hedefKutlama: false });
    b.gb.set(100, 0);
    b.gb.set(260, 0);
    ok(b.els.bar.classes.has('ko-bump'), 'without celebrations the crossing is an ordinary bump');
  });

  await check('set(): is-goal waits for the count-up; a one-off pulse follows and is removed again', async () => {
    const { gb, els, env, clock } = make({ animasyon: 'normal' });
    gb.set(900, 0);
    env.now = 1300;
    env.frames.shift()(1300);
    ok(!els.bar.classes.has('is-goal'), 'below goal');
    gb.set(1000, 0);
    ok(!els.bar.classes.has('is-goal'), 'not yet while the value is still counting');
    env.now = 1900;
    env.frames.shift()(1900);
    ok(!els.bar.classes.has('is-goal'), 'still counting');
    env.now = 2600;
    env.frames.shift()(2600);
    eq(els.val.textContent, '1,000', 'value arrived');
    ok(els.bar.classes.has('is-goal'), 'is-goal after the tween');
    ok(els.bar.classes.has('ko-goal-pulse'), 'pulse on the first arrival');
    await clock.advance(1100);
    ok(!els.bar.classes.has('ko-goal-pulse'), 'pulse removed');
    ok(els.bar.classes.has('is-goal'), 'is-goal stays');
    gb.set(900, 0);
    ok(!els.bar.classes.has('is-goal'), 'leaving the goal state is immediate');
    gb.destroy();
  });

  await check('set(): a page that loads at or above the goal gets is-goal but no pulse', () => {
    const { gb, els } = make();
    gb.set(1200, 0);
    ok(els.bar.classes.has('is-goal'), 'is-goal');
    ok(!els.bar.classes.has('ko-goal-pulse'), 'no pulse on load');
  });

  await check('set(): the value text is written only when the formatted string changes', () => {
    const { gb, els, env } = make({ animasyon: 'normal' }, 1000);
    let writes = 0, current = els.val.textContent;
    Object.defineProperty(els.val, 'textContent', {
      get() { return current; },
      set(v) { writes += 1; current = v; }
    });
    gb.set(10, 0);
    env.now = 1300;
    env.frames.shift()(1300);
    eq(current, '10', 'arrived');
    const after = writes;
    gb.set(10, 0);
    ok(writes === after, 'same value again writes nothing');
    gb.set(10.2, 0);
    env.now = 3000;
    env.frames.shift()(3000);
    ok(writes === after, 'a change below the rounding step writes nothing');
  });

  await check('set(): value text reuses the existing Text node', () => {
    const { gb, els } = make({ animasyon: 'off' });
    const node = { nodeType: 3, nodeValue: '0', parentNode: els.val };
    els.val.firstChild = node;
    gb.set(5, 0);
    gb.set(7, 0);
    eq(node.nodeValue, '7', 'node value');
  });

  await check('set(): the shine class starts after an increase only, and is removed again', async () => {
    const { gb, els, clock } = make({ animasyon: 'normal' });
    gb.set(100, 0);
    ok(!els.fill.classes.has('ko-shine'), 'none on the first value');
    gb.set(150, 0);
    ok(els.fill.classes.has('ko-shine'), 'shine after an increase');
    await clock.advance(1500);
    ok(!els.fill.classes.has('ko-shine'), 'removed again');
    gb.set(140, 0);
    ok(!els.fill.classes.has('ko-shine'), 'none on a decrease');
    const low = make({ animasyon: 'low' });
    low.gb.set(100, 0);
    low.gb.set(150, 0);
    ok(!low.els.fill.classes.has('ko-shine'), 'none in low motion');
    gb.destroy();
  });

  await check('set(): goal 0 never counts as reached', () => {
    const { gb, els } = make({}, 0);
    gb.set(50, 0);
    ok(!els.bar.classes.has('is-goal'), 'is-goal');
    eq(els.fill.style.vals['--fill'], '0.0000', 'fill');
  });

  await check('set(): percent chip follows yuzdeGoster', () => {
    const a = make({ yuzdeGoster: true });
    a.gb.set(256, 0);
    eq([a.els.pct.hidden, a.els.pct.textContent], [false, '26%'], 'shown');
    const b = make({ yuzdeGoster: false });
    b.gb.set(256, 0);
    eq(b.els.pct.hidden, true, 'hidden');
  });

  await check('set(): delta chip shows +N / -N, is-neg for negatives, hidden for 0 or oturumFarkiGoster=false', () => {
    const a = make();
    a.gb.set(100, 3);
    eq([a.els.delta.hidden, a.els.delta.textContent], [false, '+3'], 'positive');
    ok(!a.els.delta.classes.has('is-neg'), 'not negative');
    a.gb.set(100, -2);
    eq([a.els.delta.hidden, a.els.delta.textContent], [false, '-2'], 'negative');
    ok(a.els.delta.classes.has('is-neg'), 'is-neg');
    a.gb.set(100, 1234);
    eq(a.els.delta.textContent, '+1,234', 'formatted');
    ok(!a.els.delta.classes.has('is-neg'), 'is-neg removed');
    a.gb.set(100, 0);
    eq(a.els.delta.hidden, true, 'zero hides');
    const b = make({ oturumFarkiGoster: false });
    b.gb.set(100, 5);
    eq(b.els.delta.hidden, true, 'setting off hides');
  });

  await check('set(): pct and delta elements may be null', () => {
    const { gb, els } = make({}, 1000, false);
    gb.set(500, 4);
    gb.set(600, 4);
    eq(els.val.textContent, '600', 'value');
  });

  await check('set(): animasyon=normal tweens the value over frames; off jumps', () => {
    const { gb, els, env } = make({ animasyon: 'normal' });
    gb.set(100, 0);
    ok(els.val.textContent !== '100', 'not there yet');
    env.now = 1300;
    env.frames.shift()(1300);
    eq(els.val.textContent, '100', 'after the tween');
    const off = make({ animasyon: 'off' });
    off.gb.set(100, 0);
    eq(off.els.val.textContent, '100', 'immediate');
    eq(off.env.frames.length, 0, 'no frames requested');
  });
}

async function testPoller() {
  section('poller()');

  function setup(fn, over = {}, docOpts = {}) {
    const clock = fakeClock();
    const doc = docOpts.document;
    const { K, ctx } = loadCore(Object.assign(clock.opts(), doc ? { document: doc } : {}));
    setRandom(ctx, 0.5);
    const p = K.poller(fn, Object.assign({ intervalMs: 1000, jitter: 0 }, over));
    return { K, ctx, clock, p };
  }
  const delaysAfterStart = (clock) => clock.log.slice();

  await check('start() runs at once, then every intervalMs after a success', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    await clock.advance(0);
    eq(n, 1, 'immediate run');
    await clock.advance(999);
    eq(n, 1, 'before the interval');
    await clock.advance(1);
    eq(n, 2, 'after 1000 ms');
    await clock.advance(2000);
    eq(n, 4, 'two more intervals');
    p.stop();
  });

  await check('start() twice does not double the polling', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    p.start();
    await clock.advance(3000);
    eq(n, 4, 'runs at 0, 1000, 2000, 3000');
    p.stop();
  });

  await check('jitter keeps the next delay within +/- the jitter fraction', async () => {
    const lows = [], highs = [];
    for (const [rnd, bucket] of [[0, lows], [1, highs]]) {
      const { clock, ctx, p } = setup(async () => ({ ok: true }), { jitter: 0.1 });
      setRandom(ctx, rnd);
      p.start();
      await clock.advance(0);
      bucket.push(clock.log[0]);
      p.stop();
    }
    eq(lows[0], 900, 'low end');
    eq(highs[0], 1100, 'high end');
  });

  await check('failures back off: interval x 2^n, capped at maxBackoffMs', async () => {
    const { clock, p } = setup(async () => ({ ok: false }), { maxBackoffMs: 5000 });
    p.start();
    await clock.advance(0);
    for (let i = 0; i < 5; i += 1) await clock.advance(clock.timers[0].at - clock.t);
    eq(delaysAfterStart(clock).slice(0, 5), [2000, 4000, 5000, 5000, 5000], 'delays');
    p.stop();
  });

  await check('a success after failures resets the backoff', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: n === 3 || n >= 4 }; });
    p.start();
    await clock.advance(0);
    await clock.advance(2000);
    await clock.advance(4000);
    await clock.advance(1000);
    eq(delaysAfterStart(clock).slice(0, 4), [2000, 4000, 1000, 1000], 'delays');
    p.stop();
  });

  await check('a larger retryAfterMs wins over the backoff; a smaller one is ignored', async () => {
    let n = 0;
    const { clock, p } = setup(async () => {
      n += 1;
      return n === 1 ? { ok: false, retryAfterMs: 20000 } : { ok: false, retryAfterMs: 10 };
    }, { maxBackoffMs: 5000 });
    p.start();
    await clock.advance(0);
    eq(clock.log[0], 20000, 'retryAfterMs beyond the cap is honoured');
    await clock.advance(20000);
    eq(clock.log[1], 4000, 'second failure: small retryAfterMs ignored');
    p.stop();
  });

  await check('a throwing fn counts as a failure and polling continues', async () => {
    let n = 0;
    const { clock, p } = setup(() => { n += 1; if (n === 1) throw new Error('boom'); return Promise.resolve({ ok: true }); });
    p.start();
    await clock.advance(0);
    eq(clock.log[0], 2000, 'backoff after a throw');
    await clock.advance(2000);
    eq(n, 2, 'ran again');
    p.stop();
  });

  await check('busy guard: now() while a run is in flight does not start another', async () => {
    let n = 0, release;
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); });
    p.start();
    await clock.advance(0);
    eq(n, 1, 'first run started');
    p.now();
    p.now();
    await clock.advance(5000);
    eq(n, 1, 'no overlap while pending');
    release();
    await clock.advance(0);
    eq(clock.timers.length, 1, 'next run armed after it finished');
    await clock.advance(1000);
    eq(n, 2, 'second run');
    p.stop();
  });

  await check('now() runs immediately and re-arms the timer from the result', async () => {
    let n = 0;
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; });
    p.start();
    await clock.advance(0);
    await clock.advance(400);
    await p.now();
    eq(n, 2, 'ran now');
    await clock.advance(999);
    eq(n, 2, 'timer restarted from now()');
    await clock.advance(1);
    eq(n, 3, 'next run one interval after now()');
    p.stop();
  });

  await check('stop() clears the timer and later results do not re-arm', async () => {
    let n = 0, release;
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); });
    p.start();
    await clock.advance(0);
    p.stop();
    release();
    await clock.advance(10000);
    eq(n, 1, 'no more runs');
    eq(clock.timers.length, 0, 'no pending timers');
    await p.now();
    eq(n, 1, 'now() after stop does nothing');

    let m = 0;
    const b = setup(async () => { m += 1; return { ok: true }; });
    b.p.start();
    await b.clock.advance(0);
    eq(b.clock.timers.length, 1, 'timer armed');
    b.p.stop();
    eq(b.clock.timers.length, 0, 'stop clears it');
    await b.clock.advance(5000);
    eq(m, 1, 'no run after stop');
  });

  await check('hidden page: no run is scheduled; becoming visible runs at once', async () => {
    let n = 0;
    const doc = fakeVisibilityDocument(true);
    const { clock, p } = setup(async () => { n += 1; return { ok: true }; }, {}, { document: doc });
    p.start();
    await clock.advance(5000);
    eq(n, 0, 'no run while hidden');
    eq(doc.listeners.length, 1, 'visibility listener added');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 1, 'ran on becoming visible');
    await clock.advance(1000);
    eq(n, 2, 'regular polling resumed');
    doc.hidden = true;
    await clock.advance(1000);
    eq(n, 2, 'a due timer does not poll a hidden page');
    await clock.advance(5000);
    eq(n, 2, 'still paused');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 3, 'resumed with an immediate run');
    p.stop();
    eq(doc.listeners.length, 0, 'visibility listener removed on stop');
  });

  await check('a run that finishes while the page is hidden schedules nothing until it is visible again', async () => {
    let n = 0, release;
    const doc = fakeVisibilityDocument(false);
    const { clock, p } = setup(() => { n += 1; return new Promise((resolve) => { release = () => resolve({ ok: true }); }); }, {}, { document: doc });
    p.start();
    await clock.advance(0);
    doc.hidden = true;
    release();
    await clock.advance(5000);
    eq(clock.timers.length, 0, 'nothing armed');
    eq(n, 1, 'no new run');
    doc.setHidden(false);
    await clock.advance(0);
    eq(n, 2, 'run on visible');
    p.stop();
  });
}

module.exports = { testSettingsV23, testHelpersV23, testCreateGoalBar, testPoller };
