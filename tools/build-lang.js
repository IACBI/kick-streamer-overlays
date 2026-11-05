#!/usr/bin/env node
'use strict';
// Translations are kept as JSON in i18n/ so translators, and platforms such as Weblate, Crowdin or Tolgee, can work
// on plain files. The pages load them from file:// in OBS, where JSON cannot be fetched, so this writes each one
// into a small classic script in shared/lang/. The generated scripts are committed; the pack needs no build step.
//
//   node tools/build-lang.js            write shared/lang/**/*.js from i18n/
//   node tools/build-lang.js --check    exit 1 if a generated script is out of date (CI)
//   node tools/build-lang.js --status   per language: missing, extra and untranslated texts, and slot mismatches

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const REFERENCE = 'en';

// Each group: JSON folder, generated folder, global the script fills.
const GROUPS = [
  { name: 'overlay', src: path.join('i18n', 'overlay'), out: path.join('shared', 'lang'), global: 'KICK_LANG' },
  { name: 'studio', src: path.join('i18n', 'studio'), out: path.join('shared', 'lang', 'studio'), global: 'KICK_STUDIO_LANG' }
];

/** Language codes with a JSON file in a group, sorted. */
function codesOf(group, root = ROOT) {
  return fs.readdirSync(path.join(root, group.src))
    .filter((f) => f.endsWith('.json') && CODE.test(f.slice(0, -5)))
    .map((f) => f.slice(0, -5)).sort();
}

/** Reads one language's JSON. Throws with the file name when it is not valid JSON or not an object. */
function readJson(group, code, root = ROOT) {
  const file = path.join(root, group.src, code + '.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${path.relative(root, file)}: ${e.message}`, { cause: e }); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path.relative(root, file)}: not a JSON object`);
  return data;
}

/** The generated script for one language. */
function render(group, code, data) {
  const body = JSON.stringify(data, null, 2).replace(/\n/g, '\n  ');
  return `// Generated from ${group.src.replace(/\\/g, '/')}/${code}.json by tools/build-lang.js. Edit the JSON, then run: npm run build:lang\n`
    + '(function (g) {\n'
    + `  (g.${group.global} = g.${group.global} || {})${/^[a-z]{2}$/.test(code) ? '.' + code : '[' + JSON.stringify(code) + ']'} = ${body};\n`
    + '})(this);\n';
}

/** Every generated file: { file, text }. */
function build(root = ROOT) {
  const files = [];
  for (const group of GROUPS) {
    for (const code of codesOf(group, root)) {
      files.push({ file: path.join(root, group.out, code + '.js'), text: render(group, code, readJson(group, code, root)) });
    }
  }
  return files;
}

/** Writes the scripts that changed. Returns their paths. */
function write(root = ROOT) {
  const changed = [];
  for (const { file, text } of build(root)) {
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (old !== text) { fs.writeFileSync(file, text); changed.push(file); }
  }
  return changed;
}

// ---- Status --------------------------------------------------------------------------------

/** Flattens to "a.b" -> string; plural objects become "key.one", "key.other" and so on. */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const slotsOf = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort().join(' ');
const PLURAL_EXTRA = /\.(zero|two|few|many)$/;

/**
 * Compares each language with English.
 * @returns {{ group: string, code: string, total: number, missing: string[], extra: string[], same: string[], slots: string[] }[]}
 */
function status(root = ROOT) {
  const rows = [];
  for (const group of GROUPS) {
    const ref = flatten(readJson(group, REFERENCE, root));
    for (const code of codesOf(group, root)) {
      if (code === REFERENCE) continue;
      const tr = flatten(readJson(group, code, root));
      const missing = [], same = [], slots = [];
      const pluralBase = (key) => key.replace(/\.(one|other)$/, '');
      for (const key of Object.keys(ref)) {
        if (!(key in tr)) {
          // A language without plural forms (Turkish) may use one plain text; one with other categories may have no "one".
          const base = pluralBase(key);
          if (base !== key && (base in tr || /\.one$/.test(key))) continue;
          missing.push(key);
          continue;
        }
        // Names, codes and symbols stay the same in every language, so only longer texts count as untranslated.
        if (tr[key] === ref[key] && /[a-z]{4,}\s[a-z]/i.test(ref[key])) same.push(key);
        if (slotsOf(tr[key]) !== slotsOf(ref[key]) && !/\.(one|other)$/.test(key)) slots.push(key);
      }
      const extra = Object.keys(tr).filter((k) => !(k in ref) && !PLURAL_EXTRA.test(k) && !((k + '.other') in ref));
      rows.push({ group: group.name, code, total: Object.keys(ref).length, missing, extra, same, slots });
    }
  }
  return rows;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--status')) {
    const rows = status();
    for (const r of rows) {
      const done = Math.round(((r.total - r.missing.length - r.same.length) / r.total) * 100);
      console.log(`${r.group.padEnd(8)} ${r.code}  ${String(done).padStart(3)}%  missing ${r.missing.length}, same as English ${r.same.length}, slot mismatches ${r.slots.length}, extra ${r.extra.length}`);
      if (!argv.includes('--verbose')) continue;
      /** @type {[string, string[]][]} */
      const lists = [['missing', r.missing], ['same as English', r.same], ['slots', r.slots], ['extra', r.extra]];
      for (const [label, list] of lists) if (list.length) console.log(`    ${label}: ${list.join(', ')}`);
    }
    if (!argv.includes('--verbose')) console.log('Add --verbose to list the keys.');
    process.exit(rows.some((r) => r.missing.length || r.slots.length) ? 1 : 0);
  }
  if (argv.includes('--check')) {
    const stale = build().filter(({ file, text }) => { try { return fs.readFileSync(file, 'utf8') !== text; } catch (e) { return true; } });
    if (stale.length) {
      console.error('Out of date: ' + stale.map((s) => path.relative(ROOT, s.file).replace(/\\/g, '/')).join(', ') + '. Edit i18n/, then run: npm run build:lang');
      process.exit(1);
    }
    console.log('shared/lang matches i18n/');
    return;
  }
  const changed = write();
  console.log(changed.length ? 'Wrote ' + changed.map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).join(', ') : 'shared/lang already up to date');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('build-lang:', e.message); process.exit(1); }
}

module.exports = { GROUPS, codesOf, readJson, render, build, write, status, flatten };
