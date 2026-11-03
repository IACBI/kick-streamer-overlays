#!/usr/bin/env node
'use strict';
// Builds the relay as one executable (Node single executable application), so a streamer can run it
// without installing Node:
//   node tools/build-relay.js            -> dist/kick-relay-<platform>-<arch>[.exe]
//
// Steps: bundle relay/sea-main.js with esbuild (a SEA can only require() Node builtins), turn the
// bundle into a SEA blob with the running node, copy the running node binary and inject the blob.
// The executable is built for the platform and architecture of the node running this script.
// On macOS the copied node's signature is removed before injecting and replaced with an ad-hoc one after
// (codesign --sign -), as Node's SEA docs describe; without it macOS refuses to run the file.
// On Windows postject warns that the copied node.exe signature is now invalid; that is expected, the
// executable is unsigned.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
// Fixed fuse string Node looks for to decide whether a SEA blob is present (see Node's SEA docs).
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const SUPPORTED = ['win32', 'linux', 'darwin'];

/** @returns {string} file name of the executable for this platform */
function outputName(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'macos' : platform;
  return `kick-relay-${os}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

async function build() {
  if (!SUPPORTED.includes(process.platform)) {
    throw new Error(`Building the relay executable is supported on ${SUPPORTED.join(', ')}, not ${process.platform}.`);
  }
  const esbuild = require('esbuild');
  const { inject } = require('postject');
  fs.mkdirSync(DIST, { recursive: true });

  const bundle = path.join(DIST, 'relay-bundle.js');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'relay', 'sea-main.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: bundle,
    legalComments: 'none',
    logLevel: 'warning'
  });

  const blob = path.join(DIST, 'sea-prep.blob');
  const seaConfig = path.join(DIST, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const exe = path.join(DIST, outputName());
  fs.rmSync(exe, { force: true });
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
  const mac = process.platform === 'darwin';
  if (mac) execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), mac ? { sentinelFuse: SEA_FUSE, machoSegmentName: 'NODE_SEA' } : { sentinelFuse: SEA_FUSE });
  if (mac) execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

  for (const f of [bundle, blob, seaConfig]) fs.rmSync(f, { force: true });
  return exe;
}

if (require.main === module) {
  build().then((exe) => {
    console.log(`Built ${path.relative(ROOT, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB, node ${process.version})`);
  }).catch((e) => {
    console.error('Relay build failed:', e.message);
    process.exit(1);
  });
}

module.exports = { build, outputName };
