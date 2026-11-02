#!/usr/bin/env node
'use strict';
// Smoke test for the built relay executable (node tools/build-relay.js). The executable is copied
// into an empty temporary folder, as a streamer would place it, and run there with no Node project
// around it. Run: node tests/relay-binary-test.js [path-to-executable]

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { outputName } = require(path.join(__dirname, '..', 'tools', 'build-relay.js'));
const PKG_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

const results = [];
function check(name, ok, detail) {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = /** @type {net.AddressInfo} */ (s.address()).port; s.close(() => resolve(p)); });
});

async function main() {
  const built = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', outputName()));
  if (!fs.existsSync(built)) {
    console.error(`No relay executable at ${built}. Build it first: node tools/build-relay.js`);
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-'));
  const exe = path.join(dir, path.basename(built));
  fs.copyFileSync(built, exe);
  fs.chmodSync(exe, 0o755);
  // Only what the relay reads, so neither RELAY_KEY nor credentials leak in from the caller's shell.
  const baseEnv = { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '' };

  console.log('\n== relay executable: ' + path.basename(built));

  const bad = spawnSync(exe, [], { cwd: dir, env: { ...baseEnv, RELAY_LOG_FORMAT: 'xml' }, encoding: 'utf8', timeout: 30000 });
  check('a bad RELAY_LOG_FORMAT stops the executable with exit 1', bad.status === 1 && /RELAY_LOG_FORMAT must be one of/.test(bad.stderr), `status ${bad.status}`);
  check('no Node warning about an experimental feature is printed', !/ExperimentalWarning|single executable/i.test(bad.stderr));

  // No credentials in the empty folder, so the subcommand must stop before any request to Kick.
  for (const extra of [[], ['--list']]) {
    const sub = spawnSync(exe, ['subscribe', ...extra], { cwd: dir, env: baseEnv, encoding: 'utf8', timeout: 30000 });
    check(`"${['subscribe', ...extra].join(' ')}" runs the subscription tool, which stops on missing credentials`,
      sub.status === 1 && /Subscription failed: Kick app credentials are missing/.test(sub.stderr) && !/Kick relay/.test(sub.stdout), `status ${sub.status}`);
  }

  const [webhookPort, eventsPort] = [await freePort(), await freePort()];
  const child = spawn(exe, [], {
    cwd: os.tmpdir(), // not the executable's folder: files must still land next to the executable
    env: { ...baseEnv, RELAY_LOG_FORMAT: 'json', RELAY_WEBHOOK_PORT: String(webhookPort), RELAY_EVENTS_PORT: String(eventsPort) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => child.on('exit', (code) => r(code)));

  try {
    const base = `http://127.0.0.1:${eventsPort}`;
    let health = null;
    for (let i = 0; i < 100 && !health; i++) {
      await sleep(100);
      try { health = await fetch(base + '/health'); } catch (e) { /* not listening yet */ }
    }
    check('the executable starts and listens on the configured events port', !!health, `port ${eventsPort}`);
    check('/health without the access key is refused (401)', health && health.status === 401, health ? 'HTTP ' + health.status : '');

    const keyFile = path.join(dir, 'AYARLAR.relay.js');
    const keyText = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : '';
    const m = /window\.KICK_RELAY_KEY = "([A-Za-z0-9_-]{32,128})";/.exec(keyText);
    check('the access key file is created next to the executable', !!m);
    check('nothing is written to the working directory', !fs.existsSync(path.join(os.tmpdir(), 'AYARLAR.relay.js')));

    if (m) {
      const r = await fetch(`${base}/health?key=${m[1]}`);
      const body = await r.json();
      check('/health with the generated key reports the package version', r.status === 200 && body.ok === true && body.version === PKG_VERSION, JSON.stringify(body));
      check('/health reports alerts and the lastEventAt field', body.features && 'alerts' in body.features && body.lastEventAt === null);
      const ev = await fetch(`${base}/events?key=${m[1]}`);
      const reader = ev.body.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      check('/events opens a Server-Sent Events stream', ev.status === 200 && /text\/event-stream/.test(ev.headers.get('content-type') || '') && first.startsWith(': connected'));
      await reader.cancel();
    }

    const lines = out.split('\n').filter(Boolean);
    let parsed = [];
    try { parsed = lines.map((l) => JSON.parse(l)); } catch (e) { parsed = []; }
    check('every startup line is a JSON log object', parsed.length >= 3 && parsed.every((o) => o.time && o.level && typeof o.msg === 'string'), lines[0]);
    check('the startup line names the version', parsed.some((o) => o.msg === `Kick relay ${PKG_VERSION} starting...`));
    check('the access key value never appears in the log', !m || !(out + err).includes(m[1]));
  } finally {
    child.kill();
    await Promise.race([exited, sleep(5000)]);
    // Windows can hold the image file briefly after the process ends.
    for (let i = 0; i < 20; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(250); }
    }
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
