#!/usr/bin/env node
'use strict';
// shared/kick-core.js is built from the parts in src/core/, joined in file-name order. OBS loads the overlays from
// file://, where a page cannot import modules, so the browser still gets one classic script; the parts keep the
// source in small, single-purpose files. The built file is committed, so the pack runs without a build step.
//
//   node tools/build-core.js           write shared/kick-core.js from src/core/
//   node tools/build-core.js --check   exit 1 if shared/kick-core.js is not what the parts build (CI)

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PART = /^\d{2}-[a-z0-9-]+\.js$/;

/**
 * Joins the parts. Each part ends with a newline except the last, so the joined text is the parts back to back.
 * @param {string} [root]
 * @returns {{ text: string, parts: string[], outPath: string }}
 */
function build(root = ROOT) {
  const dir = path.join(root, 'src', 'core');
  const parts = fs.readdirSync(dir).filter((f) => PART.test(f)).sort();
  if (!parts.length) throw new Error('src/core has no parts');
  const text = parts.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  return { text, parts, outPath: path.join(root, 'shared', 'kick-core.js') };
}

/** Writes the built core. Returns true when the file changed. */
function write(root = ROOT) {
  const { text, outPath } = build(root);
  const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  if (old === text) return false;
  fs.writeFileSync(outPath, text);
  return true;
}

function main() {
  if (process.argv.includes('--check')) {
    const { text, parts, outPath } = build();
    if (fs.readFileSync(outPath, 'utf8') !== text) {
      console.error('shared/kick-core.js is not built from src/core/. Edit the parts, then run: node tools/build-core.js');
      process.exit(1);
    }
    console.log(`shared/kick-core.js matches the ${parts.length} parts in src/core/`);
    return;
  }
  console.log(write() ? 'shared/kick-core.js rebuilt' : 'shared/kick-core.js already up to date');
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('build-core:', e.message); process.exit(1); }
}

module.exports = { build, write };
