'use strict';
// Optional Cloudflare quick tunnel (`--tunnel`), so the streamer does not have to run cloudflared by hand.
// The relay starts cloudflared with fixed arguments and no shell, reads the public https://*.trycloudflare.com
// address from its output, and restarts it with backoff if it exits. A quick tunnel gets a new address on
// every start, so each new address is announced.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TUNNEL_URL = /https:\/\/[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.trycloudflare\.com\b/;
const START_TIMEOUT_MS = 30000;
const MAX_LINE = 4096;
const RESTART_MS = [2000, 5000, 15000, 30000, 60000];

/**
 * Finds the quick tunnel address in one line of cloudflared output.
 * @param {string} line
 * @returns {string | null}
 */
function tunnelUrlOf(line) {
  const m = TUNNEL_URL.exec(String(line).slice(0, MAX_LINE));
  return m ? m[0] : null;
}

/**
 * The cloudflared to run: RELAY_CLOUDFLARED, else the Windows installer's folder when it exists (it is not always
 * on PATH), else whatever "cloudflared" PATH finds.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ platform?: string, exists?: (p: string) => boolean }} [opts]
 * @returns {string}
 */
function cloudflaredPath(env, opts) {
  const o = Object.assign({ platform: process.platform, exists: fs.existsSync }, opts || {});
  if (env.RELAY_CLOUDFLARED) return env.RELAY_CLOUDFLARED;
  if (o.platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles]) {
      if (!base) continue;
      const p = path.win32.join(base, 'cloudflared', 'cloudflared.exe');
      if (o.exists(p)) return p;
    }
  }
  return 'cloudflared';
}

/**
 * Keeps a quick tunnel to http://127.0.0.1:<port> running.
 * @param {{ port: number, bin?: string, spawnImpl?: typeof spawn, logger?: { log: Function, warn: Function, error: Function },
 *   onUrl?: (url: string | null) => void, startTimeoutMs?: number, restartMs?: number[] }} opts
 * @returns {{ stop: () => void, url: () => string | null }}
 */
function startTunnel(opts) {
  const o = Object.assign({ bin: 'cloudflared', spawnImpl: spawn, logger: console, onUrl: () => {}, startTimeoutMs: START_TIMEOUT_MS, restartMs: RESTART_MS }, opts);
  let child = null, current = null, stopped = false, failures = 0, restartTimer = null, startTimer = null;

  function setUrl(url) {
    if (url === current) return;
    current = url;
    o.onUrl(url);
  }

  function scheduleRestart(reason) {
    if (stopped) return;
    const delay = o.restartMs[Math.min(failures, o.restartMs.length - 1)];
    failures += 1;
    o.logger.warn(`Tunnel ${reason}; starting it again in ${Math.round(delay / 1000)} s.`);
    restartTimer = setTimeout(() => { restartTimer = null; launch(); }, delay);
  }

  function launch() {
    if (stopped) return;
    const args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${o.port}`];
    let proc;
    try {
      proc = o.spawnImpl(o.bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (e) {
      o.logger.error(`Could not start cloudflared (${e.message}). Install it, or start the tunnel yourself (see README).`);
      return;
    }
    child = proc;
    let found = false, buf = '';
    startTimer = setTimeout(() => {
      startTimer = null;
      if (!found) { o.logger.warn('cloudflared did not report a tunnel address in time.'); try { proc.kill(); } catch (e) { /* gone */ } }
    }, o.startTimeoutMs);
    const onData = (chunk) => {
      buf = (buf + chunk.toString('utf8')).slice(-MAX_LINE * 2);
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const url = !found && tunnelUrlOf(line);
        if (url) {
          found = true;
          failures = 0;
          if (startTimer) { clearTimeout(startTimer); startTimer = null; }
          setUrl(url);
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
      // ENOENT: cloudflared is not installed or not on PATH. Retrying cannot fix that.
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      child = null;
      if (e && e.code === 'ENOENT') {
        stopped = true;
        o.logger.error('cloudflared was not found. Install it (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) or set RELAY_CLOUDFLARED to its full path.');
      } else {
        o.logger.error('cloudflared failed:', e && e.message);
      }
    });
    proc.on('exit', (code) => {
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      if (child === proc) child = null;
      setUrl(null);
      if (!stopped) scheduleRestart(`stopped (exit ${code})`);
    });
  }

  launch();
  return {
    url: () => current,
    stop() {
      stopped = true;
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      if (child) { try { child.kill(); } catch (e) { /* gone */ } child = null; }
    }
  };
}

module.exports = { startTunnel, tunnelUrlOf, cloudflaredPath };
