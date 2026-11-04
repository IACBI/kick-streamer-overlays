'use strict';

const {
  fs, path, ROOT, CORE_SOURCE, LANGS, LANG_FILES, check, section, eq, ok, loadCore, PLURAL_CATS, slots
} = require('./harness.js');

async function testLangFiles() {
  section('Language files (shared/lang)');
  const { ctx } = loadCore();
  const packs = ctx.KICK_LANG;
  const en = packs.en;

  await check('every language file registers itself and has exactly the English keys', () => {
    LANGS.forEach((l) => {
      ok(packs[l] && typeof packs[l] === 'object', l + ' not registered');
      const missing = Object.keys(en).filter((k) => !(k in packs[l]));
      const extra = Object.keys(packs[l]).filter((k) => !(k in en));
      eq(missing, [], l + ' missing keys');
      eq(extra, [], l + ' extra keys');
    });
  });

  await check('values are non-empty; plural forms use CLDR categories and always have "other"', () => {
    LANGS.forEach((l) => Object.keys(packs[l]).forEach((k) => {
      const v = packs[l][k];
      if (typeof v === 'string') { ok(v.trim(), l + '.' + k + ' is empty'); return; }
      ok(v && typeof v === 'object', l + '.' + k + ' must be a string or plural forms');
      ok(typeof v.other === 'string' && v.other.trim(), l + '.' + k + ' has no "other" form');
      Object.keys(v).forEach((c) => ok(PLURAL_CATS.includes(c) && typeof v[c] === 'string' && v[c].trim(), l + '.' + k + '.' + c));
      ok(typeof en[k] === 'object', l + '.' + k + ' is plural but en.' + k + ' is not, so callers pass no {n}');
    }));
  });

  await check('placeholders: a translation uses only the English slots, and "other" keeps all of them', () => {
    LANGS.forEach((l) => Object.keys(en).forEach((k) => {
      const enSlots = new Set([].concat(...[].concat(en[k]).map((v) => typeof v === 'object' ? Object.values(v) : [v]).map((v) => [...slots(v)])));
      const v = packs[l][k];
      const forms = typeof v === 'object' ? Object.values(v) : [v];
      forms.forEach((f) => slots(f).forEach((x) => ok(enSlots.has(x), l + '.' + k + ' uses unknown ' + x)));
      const other = typeof v === 'object' ? v.other : v;
      enSlots.forEach((x) => ok(slots(other).has(x), l + '.' + k + ' drops ' + x));
    }));
  });

  await check('every key the pages and kick-core use exists in en.js, and every en.js key is used', () => {
    const sources = [CORE_SOURCE].concat(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')));
    const used = new Set();
    sources.forEach((src) => {
      for (const m of src.matchAll(/\b(?:K\.t|t)\(\s*\w+\s*,\s*'([\w.]+)'/g)) used.add(m[1]);
      // A key ending in "." is a prefix joined at run time (dock.kind.<kind>); those are added below.
      for (const m of src.matchAll(/\bL\(\s*'([\w.]*\w)'/g)) used.add(m[1]);
    });
    ['follow', 'sub', 'gift', 'kicks', 'reward'].forEach((k) => used.add('dock.kind.' + k));
    eq([...used].filter((k) => !(k in en)).sort(), [], 'used but not in en.js');
    eq(Object.keys(en).filter((k) => !used.has(k)).sort(), [], 'in en.js but never used');
  });

  await check('language files are plain data: no code beyond the registration wrapper', () => {
    LANG_FILES.forEach((f) => {
      const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '');
      ok(/^\s*\(function \(g\) \{\s*\(g\.KICK_LANG = g\.KICK_LANG \|\| \{\}\)\.\w+ = \{/.test(src), path.basename(f) + ' wrapper');
      ok(!/\b(function|=>|eval|document|window|fetch)\b/.test(src.replace(/^\s*\(function \(g\) \{/, '')), path.basename(f) + ' contains code');
    });
  });
}

module.exports = { testLangFiles };
