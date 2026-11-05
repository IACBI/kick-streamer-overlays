'use strict';

const {
  fs, path, vm, ROOT, CORE_FILE, CSS_FILE, OVERLAY_PAGES, STUDIO_PAGE, CORE_SOURCE, LANGS, PKG_VERSION, check,
  section, eq, ok, loadCore, fakeDocument, stripCss, pageHtml, inlineScripts, checkHeadTemplate, slots
} = require('./harness.js');

// ---- Section: themes, components, pages -----------------------------------------

async function testThemesAndPages() {
  section('Themes and pages');
  const css = stripCss(fs.readFileSync(CSS_FILE, 'utf8'));
  const { K, ctx } = loadCore();
  const SELECTOR_PREFIX = { stil: 'theme-', sekil: 'shape-', yaziTipi: 'font-', animasyon: 'motion-' };

  await check('enum lists match the documented values', () => {
    eq(K.enums('stil'), ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'], 'stil');
    eq(K.enums('sekil'), ['pill', 'rounded', 'square'], 'sekil');
    eq(K.enums('yaziTipi'), ['inter', 'poppins', 'nunito', 'mono'], 'yaziTipi');
    eq(K.enums('dil'), ['tr', 'en', 'both', 'es', 'pt', 'de', 'ar'], 'dil');
    eq(K.enums('animasyon'), ['normal', 'low', 'off'], 'animasyon');
  });

  await check('themes.css: braces balance', () => {
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    eq(open, close, 'open vs close braces');
  });

  for (const name of Object.keys(SELECTOR_PREFIX)) {
    await check(`themes.css: every ${name} value has a body selector`, () => {
      K.enums(name).forEach((v) => {
        const cls = SELECTOR_PREFIX[name] + v;
        ok(new RegExp('body\\.' + cls + '(?![\\w-])').test(css), 'missing body.' + cls);
      });
    });
  }

  await check('dil: every value has a language file or is "both" (no CSS class by design)', () => {
    eq(K.enums('dil').filter((v) => v !== 'both').sort(), LANGS.slice().sort(), 'dil values vs shared/lang files');
    K.enums('dil').forEach((v) => ok(K.t(K.normalize({ dil: v }), 'bar.follower') !== 'bar.follower', 'dil ' + v));
  });

  await check('applyLook() emits the class for every enum value', () => {
    Object.keys(SELECTOR_PREFIX).forEach((name) => K.enums(name).forEach((v) => {
      ctx.document = fakeDocument('');
      K.applyLook(K.normalize({ [name]: v }));
      const want = SELECTOR_PREFIX[name] + v;
      ok(ctx.document.body.className.split(' ').includes(want), 'applyLook did not set ' + want);
    }));
  });

  await check('themes.css: every overlay component class is defined', () => {
    const components = ['ko-bar', 'ko-fill', 'ko-row', 'ko-cur', 'ko-label', 'ko-sep', 'ko-goal', 'ko-chip', 'is-neg',
      'ko-bump', 'ko-panel', 'is-off', 'ko-dot', 'ko-stat', 'ko-val', 'ko-sep-v', 'ko-feed', 'ko-msg', 'is-leaving',
      'ko-badges', 'ko-badge', 'ko-user', 'ko-text', 'ko-emote', 'ko-bcast', 'ko-note', 'is-hidden', 'ko-hint',
      'ko-alert-stage', 'ko-alert', 'is-out', 'ko-alert-icon', 'ko-alert-body', 'ko-alert-title', 'ko-alert-name', 'ko-alert-detail', 'ko-alert-msg'];
    components.forEach((c) => ok(new RegExp('\\.' + c + '(?![\\w-])').test(css), 'missing .' + c));
  });

  for (const page of OVERLAY_PAGES) {
    await check(`head template: ${page}`, () => checkHeadTemplate(pageHtml(page), page));
  }

  await check(`studio uses the shared stylesheet and core: ${STUDIO_PAGE}`, () => {
    const html = pageHtml(STUDIO_PAGE);
    const hrefs = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)].map((m) => m[1]);
    const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
    ok(hrefs.includes('shared/themes.css'), 'shared/themes.css link missing');
    ok(srcs.includes('shared/kick-core.js'), 'shared/kick-core.js script missing');
    ok(hrefs.indexOf('shared/studio.css') > hrefs.indexOf('shared/themes.css'), 'shared/studio.css must load after shared/themes.css');
    ok(srcs.indexOf('shared/studio.js') > srcs.indexOf('shared/lang/studio/ar.js') && srcs.indexOf('shared/studio.js') === srcs.length - 1, 'shared/studio.js must load last, after the language files');
    ok(inlineScripts(html).length === 0 && !/<style>/.test(html), 'no inline script or style left in the studio');
  });
  await check('studio texts: every language file has the English keys, slots and labels, and every key used in the page exists', () => {
    const html = pageHtml(STUDIO_PAGE) + fs.readFileSync(path.join(ROOT, 'shared', 'studio.js'), 'utf8');
    const g = {};
    LANGS.forEach((l) => {
      const f = path.join(ROOT, 'shared', 'lang', 'studio', l + '.js');
      ok(html.includes('<script src="shared/lang/studio/' + l + '.js"></script>'), 'studio does not load ' + l);
      vm.runInNewContext(fs.readFileSync(f, 'utf8'), g, { filename: f });
    });
    const P = g.KICK_STUDIO_LANG;
    const en = Object.keys(P.en.ui);
    const tr = en;
    const I18N = { tr: P.tr.ui, en: P.en.ui };
    const { K } = loadCore();
    LANGS.forEach((l) => {
      const keys = Object.keys(P[l].ui);
      eq(keys.filter((k) => !en.includes(k)), [], 'keys only in ' + l);
      eq(en.filter((k) => !keys.includes(k)), [], 'keys missing in ' + l);
      en.forEach((k) => {
        const v = P[l].ui[k];
        ok(typeof v === 'string' && v.trim() !== '', 'empty text: ' + l + '.' + k);
        eq([...slots(v)].sort(), [...slots(P.en.ui[k])].sort(), 'slots of ' + l + '.' + k);
      });
      Object.keys(P.en.labels).forEach((name) => K.enums(name).forEach((v) =>
        ok(typeof P[l].labels[name][v] === 'string' && P[l].labels[name][v].trim(), 'label ' + l + '.' + name + '.' + v)));
      eq(P[l].labels.dil, P.en.labels.dil, l + ': language names are the same in every file');
    });
    eq([...html.matchAll(/data-lang="(\w+)"/g)].map((m) => m[1]), LANGS, 'language buttons');
    const used = new Set();
    for (const m of html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
    for (const m of html.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
    // Keys built from an id at run time.
    ['follower', 'subscriber', 'combined', 'info', 'countdown', 'ticker', 'chat', 'alerts', 'events', 'leaderboard', 'kicks', 'train'].forEach((id) => { used.add('ov.' + id); used.add('ov.' + id + '.d'); });
    ['minimal', 'neon', 'pastel', 'gece', 'kagit'].forEach((id) => used.add('preset.' + id));
    ['checker', 'dark', 'light', 'scene'].forEach((id) => used.add('bg.' + id));
    for (let n = 1; n <= 4; n++) used.add('help.c' + n);
    for (let n = 1; n <= 7; n++) { used.add('help.n' + n + '.t'); used.add('help.n' + n + '.d'); }
    // Prefixes of the run-time keys above (t('preset.' + id)) are not keys themselves.
    const missing = [...used].filter((k) => !tr.includes(k) && !/\.$/.test(k) && k !== 'help.n');
    eq(missing, [], 'keys used but not defined');
    for (const k of tr) ok(String(I18N.tr[k]).trim() !== '' && String(I18N.en[k]).trim() !== '', 'empty text: ' + k);
  });
}

// ---- Section: syntax -------------------------------------------------------------

async function testSyntax() {
  section('Syntax');

  await check('kick-core.js parses (vm.Script)', () => {
    new vm.Script(CORE_SOURCE, { filename: CORE_FILE });
  });

  const htmlInRoot = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f));
  const pages = [...new Set([...OVERLAY_PAGES, STUDIO_PAGE, ...htmlInRoot])];
  for (const page of pages) {
    await check(`inline scripts parse: ${page}`, () => {
      const scripts = inlineScripts(pageHtml(page));
      scripts.forEach((code, i) => new vm.Script(code, { filename: page + ' inline #' + (i + 1) }));
    });
  }
}

async function testVersionSync() {
  section('Version');
  const SV = require('../../tools/sync-version.js');

  await check('kick-core.js carries the package.json version', () => {
    const r = SV.read();
    eq(r.coreVersion, r.version, 'core version');
  });

  // Runs the real tool on a scratch copy of the two files it touches.
  await check('sync-version detects a stale core version, rewrites only that line, then reports it in sync', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-version-'));
    try {
      fs.mkdirSync(path.join(dir, 'shared'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.8.7' }));
      const stale = CORE_SOURCE.replace(/^(\s*version: ')[^']*(',)$/m, '$10.0.1$2');
      fs.writeFileSync(path.join(dir, 'shared', 'kick-core.js'), stale);
      eq(SV.read(dir).coreVersion, '0.0.1', 'stale version read');
      eq(SV.sync(dir), '0.0.1', 'sync returns the replaced version');
      const after = fs.readFileSync(path.join(dir, 'shared', 'kick-core.js'), 'utf8');
      eq(SV.read(dir).coreVersion, '9.8.7', 'version after sync');
      eq(after, stale.replace("version: '0.0.1',", "version: '9.8.7',"), 'nothing else changed');
      eq(SV.sync(dir), null, 'second sync is a no-op');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('shared/kick-core.js is exactly the src/core parts joined in order', () => {
    const B = require('../../tools/build-core.js');
    const b = B.build();
    ok(b.parts.length >= 10 && b.parts[0] === '00-head.js' && b.parts[b.parts.length - 1] === '90-api.js', 'parts: ' + b.parts.join(' '));
    eq(b.text, CORE_SOURCE, 'built text matches the committed core (run: npm run build:core)');
  });

  await check('shared/lang scripts are exactly what i18n/ JSON builds, and every language is complete', () => {
    const L = require('../../tools/build-lang.js');
    const stale = L.build().filter(({ file, text }) => fs.readFileSync(file, 'utf8') !== text).map((x) => path.basename(x.file));
    eq(stale, [], 'out of date (run: npm run build:lang)');
    const gaps = L.status().filter((r) => r.missing.length || r.slots.length || r.extra.length).map((r) => `${r.group}/${r.code}`);
    eq(gaps, [], 'languages with missing keys, extra keys or slot problems');
  });

  await check('build-lang renders a language that loads back to the same texts', () => {
    const L = require('../../tools/build-lang.js');
    const data = { 'a.b': 'x {n}', plural: { one: 'one', other: '{n} more' }, quote: 'it\'s "fine"' };
    const ctx = {};
    vm.runInNewContext(L.render(L.GROUPS[0], 'xx', data), ctx);
    eq(JSON.stringify(ctx.KICK_LANG.xx), JSON.stringify(data), 'round trip');
  });

  await check('sync-version keeps the core part and the built core on the same version', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-version-'));
    try {
      fs.mkdirSync(path.join(dir, 'shared'));
      fs.mkdirSync(path.join(dir, 'src', 'core'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.8.7' }));
      fs.writeFileSync(path.join(dir, 'shared', 'kick-core.js'), CORE_SOURCE);
      const part = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'core', '90-api.js'), 'utf8');
      fs.writeFileSync(path.join(dir, 'src', 'core', '90-api.js'), part);
      SV.sync(dir);
      ok(/version: '9\.8\.7',/.test(fs.readFileSync(path.join(dir, 'src', 'core', '90-api.js'), 'utf8')), 'part updated');
      eq(SV.read(dir).coreVersion, '9.8.7', 'core updated');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('sync-version refuses a package.json version that is not x.y.z', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ko-version-'));
    try {
      fs.mkdirSync(path.join(dir, 'shared'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.4' }));
      fs.writeFileSync(path.join(dir, 'shared', 'kick-core.js'), CORE_SOURCE);
      let err = null;
      try { SV.sync(dir); } catch (e) { err = e; }
      ok(err && /not x\.y\.z/.test(err.message), 'throws');
      eq(fs.readFileSync(path.join(dir, 'shared', 'kick-core.js'), 'utf8'), CORE_SOURCE, 'core untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const { notesFor } = require('../../tools/changelog-notes.js');
  await check('the release notes for the package version come from CHANGELOG.md', () => {
    const notes = notesFor(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), 'v' + PKG_VERSION);
    ok(notes && /^### /.test(notes), 'section starts with a ### heading');
    ok(!/^## \[/m.test(notes), 'no other version heading inside');
  });

  await check('changelog-notes stops at the next version, skips link definitions and refuses an empty section', () => {
    const md = '# Changelog\n\n## [Unreleased]\n\n## [2.0.0] - 2026-01-02\r\n\r\n### Added\r\n- B\r\n\r\n## [1.0.0] - 2026-01-01\n\n- A\n\n[1.0.0]: https://example.com/1.0.0\n';
    eq(notesFor(md, '2.0.0'), '### Added\n- B', '2.0.0 (CRLF)');
    eq(notesFor(md, 'v1.0.0'), '- A', '1.0.0, last section');
    eq(notesFor(md, 'Unreleased'), null, 'empty section');
    eq(notesFor(md, '2.0'), null, 'prefix of another version');
  });
}

// ---- Section: docs/settings.md follows the schema ---------------------------------

async function testSettingsDoc() {
  section('docs/settings.md');
  await check('docs/settings.md: every setting, with its English and Turkish name and its default, matches the code', () => {
    const { K } = loadCore();
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'settings.md'), 'utf8');
    const rows = new Map();
    for (const line of doc.split('\n')) {
      const m = /^\| `([A-Za-z]+)` \| `([A-Za-z]+)` \| (.*) \| (.*) \|$/.exec(line);
      if (m) rows.set(m[2], { en: m[1], def: m[4] });
    }
    const aliases = K.aliases();
    const enOf = {};
    Object.keys(aliases).forEach((en) => { enOf[aliases[en]] = en; });
    const d = K.normalize({});
    const problems = [];
    for (const key of K.schemaKeys()) {
      const row = rows.get(key);
      if (!row) { problems.push(key + ': missing'); continue; }
      if (row.en !== enOf[key]) problems.push(`${key}: English name ${row.en}, code says ${enOf[key]}`);
      const want = d[key] === '' ? '*(empty)*' : '`' + String(d[key]) + '`';
      if (row.def !== want) problems.push(`${key}: default ${row.def}, code says ${want}`);
    }
    for (const key of rows.keys()) if (!K.schemaKeys().includes(key)) problems.push(key + ': documented but not a setting');
    eq(problems, [], 'doc and schema agree');
  });

  await check('docs/themes.md: every theme and every studio quick look has a working studio link', () => {
    const { K } = loadCore();
    const doc = fs.readFileSync(path.join(ROOT, 'docs', 'themes.md'), 'utf8');
    const links = [...doc.matchAll(/\(https:\/\/iacbi\.github\.io\/kick-streamer-overlays\/studio\.html(\?[^)]*)\)/g)].map((m) => m[1]);
    const looks = links.map((q) => K.normalize(K.urlOverrides(q)));
    const problems = [];
    for (const theme of K.enums('stil')) if (!looks.some((s) => s.stil === theme)) problems.push('theme ' + theme + ': no link');
    const studio = fs.readFileSync(path.join(ROOT, 'shared', 'studio.js'), 'utf8');
    const presets = [...studio.matchAll(/\{ stil: '(\w+)', sekil: '(\w+)', yaziTipi: '(\w+)', animasyon: '(\w+)', renk: '(#[0-9a-f]{6})' \}/g)];
    ok(presets.length >= 10, 'presets found in studio.js: ' + presets.length);
    for (const p of presets) {
      const hit = looks.some((s) => s.stil === p[1] && s.sekil === p[2] && s.yaziTipi === p[3] && s.animasyon === p[4] && s.renk === p[5]);
      if (!hit) problems.push('quick look ' + p[1] + '/' + p[5] + ': no matching link');
    }
    eq(problems, [], 'gallery and code agree');
  });

  await check('studio: a look link applies only the five look settings', () => {
    const { K } = loadCore();
    const raw = K.urlOverrides('?theme=retro&accent=%23ff4fd8&channel=someone&ozelCss=x');
    ok(raw.stil === 'retro' && raw.kanal === 'someone', 'urlOverrides reads both names');
    const studio = fs.readFileSync(path.join(ROOT, 'shared', 'studio.js'), 'utf8');
    const m = /var LOOK_KEYS = (\[[^\]]*\]);/.exec(studio);
    ok(m, 'LOOK_KEYS in studio.js');
    eq(JSON.parse(m[1].replace(/'/g, '"')), ['stil', 'sekil', 'yaziTipi', 'animasyon', 'renk'], 'look keys');
  });
}

module.exports = { testThemesAndPages, testSyntax, testVersionSync, testSettingsDoc };
