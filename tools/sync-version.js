#!/usr/bin/env node
'use strict';
// package.json is the only place the version is written by hand. The browser core cannot read it
// (it runs as a classic script from file://), so this copies the version into shared/kick-core.js.
//
//   node tools/sync-version.js           write the version from package.json into kick-core.js
//   node tools/sync-version.js --check   exit 1 if they differ (CI)
//
// `npm version <x.y.z>` runs this through the "version" script, so a release bump touches one file.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VERSION_LINE = /^(\s*version: ')([^']*)(',)$/m;

/** Reads both versions. Throws when package.json or the core line is malformed. */
function read(root = ROOT) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version "${version}" is not x.y.z`);
  const corePath = path.join(root, 'shared', 'kick-core.js');
  const core = fs.readFileSync(corePath, 'utf8');
  const m = core.match(VERSION_LINE);
  if (!m) throw new Error('kick-core.js has no "version: \'x.y.z\'," line');
  return { version, coreVersion: m[2], core, corePath };
}

/** Writes the package.json version into kick-core.js. Returns the version it replaced, or null if already equal. */
function sync(root = ROOT) {
  const { version, coreVersion, core, corePath } = read(root);
  if (coreVersion === version) return null;
  fs.writeFileSync(corePath, core.replace(VERSION_LINE, `$1${version}$3`));
  return coreVersion;
}

function main() {
  const { version, coreVersion } = read();
  if (process.argv.includes('--check')) {
    if (coreVersion !== version) {
      console.error(`shared/kick-core.js says ${coreVersion}, package.json says ${version}. Run: node tools/sync-version.js`);
      process.exit(1);
    }
    console.log(`version ${version} is in sync`);
    return;
  }
  const old = sync();
  console.log(old === null ? `version ${version} already in sync` : `shared/kick-core.js: ${old} -> ${version}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('sync-version:', e.message); process.exit(1); }
}

module.exports = { read, sync };
