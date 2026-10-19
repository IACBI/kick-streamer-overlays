#!/usr/bin/env node
'use strict';
/*
 * Motion QA for the Kick overlay pack. Headless Chrome driven over the DevTools protocol, no npm packages.
 * It never writes to the project: pages are served from a tiny local server, and results go to --out.
 *
 *   node tools/motion-qa.js --out <dir>                       everything (audit, perf, shots)
 *   node tools/motion-qa.js --out <dir> --phase audit         only the infinite-animation audit
 *   node tools/motion-qa.js --out <dir> --phase perf          only the performance matrix
 *   node tools/motion-qa.js --out <dir> --phase shots         only the frame sequences and filmstrips
 *   node tools/motion-qa.js --out <dir> --phase shots --only fill-grid,ticker-swap   only the shots whose name contains one of these
 *   node tools/motion-qa.js --out <dir> --overlays chat,ticker --themes glass,holo --throttle 4
 *
 * Output in --out: audit.md / audit.json, perf.md / perf.json / perf.jsonl, shots/*.png (filmstrips) and shots/fill-grid.png.
 * A full run takes about 45 minutes (perf is serial on purpose: one page at a time, so the numbers do not fight each other).
 * Needs Node 22+ (global WebSocket) and Chrome or Edge. Run it while the machine is otherwise idle.
 *
 * Options
 *   --out <dir>        output folder (required)
 *   --phase <list>     audit,perf,shots (default: all three)
 *   --overlays <list>  follower-bar,subscriber-bar,combined-bar,info-panel,chat,countdown,ticker (default: all)
 *   --themes <list>    themes for the audit and the per-theme perf sweep (default: all 13)
 *   --modes <list>     normal,low,off,reduced for the perf matrix (default: all four, on the glass theme)
 *   --throttle <n>     CPU throttling rate for perf runs, simulates OBS plus a game (default 4; a 1x baseline on glass is added unless --quick)
 *   --quick            shorter windows and fewer combinations
 *   --only <list>      shots phase: only sequences whose name contains one of these words (fill-grid is the static fill table)
 *   --no-fonts         block Google Fonts (the system font is used, text metrics differ from OBS)
 *   --chrome <path>    Chrome or Edge executable (or CHROME_PATH)
 *   --step-timeout <s> seconds one DevTools call may take before it fails (default 30). A timeout retries the
 *                      scenario once; a failure is listed at the end and the exit code is 1.
 *
 * What it drives (all through the real page code, nothing is patched in the project):
 *   - goal bars: createGoalBar is wrapped before the page script runs, so the tool calls the very
 *     bar.set() the page uses (bump, count-up, fill, 25/50/75 pulse, goal state).
 *   - chat: a mock relay on the same server sends SSE chat and ban events to the unmodified chat.html.
 *   - countdown "done": Date.now is shifted inside the page.
 *   - ticker: duyuruMetinleri and duyuruSn in the URL.
 * Reported per scenario: rAF fps and frames over 20 ms, main-thread busy time, layout / style /
 * paint / commit / draw counts from a Chrome trace, raster tasks, layout shifts, and which running
 * animations are composited (LayerTree compositing reasons plus the trace's compositeFailed flag).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes('--' + n);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const list = (v, d) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const THEMES = ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'];
const MODES = ['normal', 'low', 'off', 'reduced'];
const OVERLAYS = {
  'follower-bar': { file: 'follower-bar.html', size: [520, 90], goals: [1000], delta: [0] },
  'subscriber-bar': { file: 'subscriber-bar.html', size: [520, 90], goals: [100], delta: [3] },
  'combined-bar': { file: 'combined-bar.html', size: [520, 180], goals: [1000, 100], delta: [0, 3] },
  'info-panel': { file: 'info-panel.html', size: [300, 80] },
  chat: { file: 'chat.html', size: [460, 760] },
  countdown: { file: 'countdown.html', size: [520, 190] },
  ticker: { file: 'ticker.html', size: [760, 80] }
};
const LONG_LINE = 'Big announcement: the community charity stream starts this Saturday, bring your friends, join the Discord for the schedule and the giveaway rules, and do not forget to follow';

const CHROME = arg('chrome', process.env.CHROME_PATH) || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
const STEP_MS = Number(arg('step-timeout', 30)) * 1000;
const FAILURES = [];
let DEVTOOLS = null; // set by launchChrome: Chrome picks a free port for each run
const THROTTLE = Number(arg('throttle', 4));
const QUICK = flag('quick');
const FONTS = !flag('no-fonts');

// ---------------------------------------------------------------- process hygiene
// Every Chrome (with its temp profile) and the static server are registered here and torn down on every exit
// path. A watchdog child also kills Chrome if this process is killed hard (taskkill /F runs no handlers).

const cleanups = [];
let cleaned = false;
function runCleanups() {
  if (cleaned) return;
  cleaned = true;
  while (cleanups.length) { try { cleanups.pop()(); } catch (e) { /* keep tearing down the rest */ } }
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function killTree(pid) {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch (e) { /* already exited */ }
  // Chrome holds its profile files until the browser process is really gone, so wait for that first.
  for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); sleepSync(250); } catch (e) { break; } }
}

// Chrome releases files a moment after it exits, so retry for up to about 15 s.
function removeProfile(dir) {
  for (let i = 0; i < 50 && fs.existsSync(dir); i++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* still locked */ }
    sleepSync(300);
  }
}

// Runs as `node -e` in a detached child: once the parent is gone, it kills Chrome and removes the profile.
function watchdogMain() {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const [parent, chrome, profile] = process.argv.slice(1);
  const alive = (pid) => { try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const timer = setInterval(() => {
    if (alive(parent)) return;
    clearInterval(timer);
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', chrome, '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else process.kill(-Number(chrome), 'SIGKILL');
    } catch (e) { /* already exited */ }
    for (let i = 0; i < 40 && alive(chrome); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    for (let i = 0; i < 50 && fs.existsSync(profile); i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* still locked */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
    process.exit(0);
  }, 500);
}

function track(child, profile) {
  const watchdog = spawn(process.execPath, ['-e', `(${watchdogMain.toString()})()`, String(process.pid), String(child.pid), profile],
    { detached: true, stdio: 'ignore', windowsHide: true });
  watchdog.on('error', () => {});
  watchdog.unref();
  cleanups.push(() => { killTree(child.pid); removeProfile(profile); });
}

function installExitHandlers() {
  process.on('exit', runCleanups);
  const stop = (sig, code) => process.on(sig, () => { console.error(`\n${sig}: stopping Chrome and the local server`); runCleanups(); process.exit(code); });
  stop('SIGINT', 130);
  stop('SIGTERM', 143);
  if (process.platform === 'win32') stop('SIGBREAK', 149);
  const crash = (e) => { console.error('motion-qa crashed:', (e && e.stack) || e); runCleanups(); process.exit(1); };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}

// ---------------------------------------------------------------- server (static + mock relay)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function startServer() {
  const clients = new Set();
  let port = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    if (u.pathname === '/health') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end('{"ok":true,"features":{}}'); return; }
    if (u.pathname === '/events') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (u.pathname === '/AYARLAR.js') {
      res.writeHead(200, { ...cors, 'Content-Type': MIME['.js'] });
      res.end(`window.KICK_OVERLAY_AYARLAR = { relayAdresi: "http://127.0.0.1:${port}" };\n`);
      return;
    }
    if (u.pathname === '/AYARLAR.local.js') { res.writeHead(200, { ...cors, 'Content-Type': MIME['.js'] }); res.end(''); return; }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, cors); res.end('not found'); return; }
    res.writeHead(200, { ...cors, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve({
      port,
      url: (file, query) => `http://127.0.0.1:${port}/${file}${query ? '?' + query : ''}`,
      emit: (kind, obj) => { for (const c of clients) c.write(`event: ${kind}\ndata: ${JSON.stringify(obj)}\n\n`); },
      clients: () => clients.size,
      close: () => { for (const c of clients) c.end(); server.close(); }
    });
  }));
}

// ---------------------------------------------------------------- CDP

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    } else if (m.method) {
      for (const f of [...listeners]) f(m);
    }
  };
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      send: (method, params = {}, ms = STEP_MS) => new Promise((ok, bad) => {
        const id = ++nextId;
        const t = setTimeout(() => { pending.delete(id); bad(new Error(`timeout after ${ms / 1000}s in ${method}`)); }, ms);
        pending.set(id, { resolve: (v) => { clearTimeout(t); ok(v); }, reject: (e) => { clearTimeout(t); bad(e); } });
        try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(t); pending.delete(id); bad(e); }
      }),
      on: (f) => { listeners.add(f); return () => listeners.delete(f); },
      once: (method, ms = 15000) => new Promise((ok, bad) => {
        const t = setTimeout(() => { off(); bad(new Error('timeout waiting for ' + method)); }, ms);
        const off = (() => { const f = (m) => { if (m.method === method) { clearTimeout(t); listeners.delete(f); ok(m.params); } }; listeners.add(f); return () => listeners.delete(f); })();
      }),
      close: () => { try { ws.close(); } catch (e) { /* closed */ } }
    });
    ws.onerror = () => reject(new Error('CDP websocket failed'));
    ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('DevTools connection closed (Chrome exited?)')); pending.clear(); };
  });
}

// Port 0: Chrome picks a free port and writes it to DevToolsActivePort in the fresh temp profile.
async function launchChrome() {
  if (!CHROME) throw new Error('Chrome or Edge not found. Use --chrome or CHROME_PATH.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-motion-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=1280,900', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  proc.on('error', () => {});
  track(proc, profile);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
      if (port) {
        DEVTOOLS = `http://127.0.0.1:${port}`;
        const r = await fetch(`${DEVTOOLS}/json/version`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) return { proc, profile, version: (await r.json()).Browser };
      }
    } catch (e) { /* not written yet, or Chrome still starting */ }
    await sleep(200);
  }
  throw new Error(`Chrome did not expose DevTools${proc.exitCode !== null ? ` (exited with ${proc.exitCode})` : ''}`);
}

// Runs in every page before its own scripts. Provides the probes and the hooks the scenarios use.
const PAGE_HOOKS = `(() => {
  const qa = window.__qa = { run: false, frames: [], last: 0, shifts: [], longTasks: [], rects: [], watch: null, dateShift: 0 };
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + qa.dateShift;
  window.__bars = [];
  let K;
  Object.defineProperty(window, 'KickOverlay', {
    configurable: true,
    get() { return K; },
    set(v) {
      K = v;
      if (v && typeof v.createGoalBar === 'function') {
        const make = v.createGoalBar;
        v.createGoalBar = function () { const b = make.apply(this, arguments); window.__bars.push(b); return b; };
      }
    }
  });
  const tick = (t) => {
    if (!qa.run) return;
    if (qa.last) qa.frames.push(t - qa.last);
    qa.last = t;
    if (qa.watch) qa.rects.push([Math.round(t)].concat(qa.watch.map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })));
    requestAnimationFrame(tick);
  };
  qa.start = (watch) => { qa.frames = []; qa.shifts = []; qa.longTasks = []; qa.rects = []; qa.watch = watch || null; qa.last = 0; qa.run = true; requestAnimationFrame(tick); };
  qa.stop = () => { qa.run = false; return { frames: qa.frames, shifts: qa.shifts, longTasks: qa.longTasks, rects: qa.rects }; };
  const name = (n) => n ? (n.id ? '#' + n.id : n.nodeName.toLowerCase() + (n.classList && n.classList.length ? '.' + Array.from(n.classList).join('.') : '')) : '?';
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (qa.run) qa.shifts.push({ v: e.value, t: Math.round(e.startTime), src: (e.sources || []).map((s) => name(s.node)) }); }).observe({ type: 'layout-shift', buffered: false });
  } catch (e) { /* not supported */ }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (qa.run) qa.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false });
  } catch (e) { /* not supported */ }
})();`;

const TRACE_CATEGORIES = [
  'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.invalidationTracking', 'toplevel', 'cc', 'blink.animations'
];

// A page ready for a scenario. Emulation is set before the first navigation.
async function newPage(srv, o = {}) {
  const target = await (await fetch(`${DEVTOOLS}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(STEP_MS) })).json();
  const c = await cdp(target.webSocketDebuggerUrl);
  const logs = [];
  c.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Network.setBlockedURLs', { urls: ['*://kick.com/*', '*://*.kick.com/*', ...(FONTS ? [] : ['*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*'])] });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HOOKS });
  const size = o.size || [520, 90];
  await c.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: o.dpr || 1, mobile: false });
  if (o.bg) await c.send('Emulation.setDefaultBackgroundColorOverride', { color: o.bg });
  if (o.reduced) await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  if (o.throttle && o.throttle > 1) await c.send('Emulation.setCPUThrottlingRate', { rate: o.throttle });
  const page = {
    c, logs, target,
    eval: async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'evaluate failed');
      return r.result.value;
    },
    goto: async (url) => {
      const loaded = c.once('Page.loadEventFired', 20000);
      await c.send('Page.navigate', { url });
      await loaded;
    },
    fontsReady: async () => { try { await page.eval('Promise.race([document.fonts.ready.then(() => 1), new Promise((r) => setTimeout(r, 4000))])'); } catch (e) { /* page gone */ } },
    close: async () => { c.close(); await fetch(`${DEVTOOLS}/json/close/${target.id}`).catch(() => {}); }
  };
  return page;
}

// ---------------------------------------------------------------- trace analysis

async function traceStart(p) {
  p.traceEvents = [];
  p.offTrace = p.c.on((m) => { if (m.method === 'Tracing.dataCollected') for (const e of m.params.value) p.traceEvents.push(e); });
  await p.c.send('Tracing.start', {
    traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATEGORIES },
    transferMode: 'ReportEvents'
  });
  await p.eval("console.timeStamp('qa-marker')");
}
async function traceStop(p) {
  const done = p.c.once('Tracing.tracingComplete', 60000);
  await p.c.send('Tracing.end');
  await done;
  p.offTrace();
  return p.traceEvents;
}

const dur = (e) => (e.dur || 0) / 1000;

// Reduces a trace to the numbers that matter for a smooth overlay. Times are in ms.
function analyze(events) {
  const threadName = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(e.pid + ':' + e.tid, e.args.name);
  const marker = events.find((e) => e.name === 'TimeStamp' && e.args && e.args.data && e.args.data.message === 'qa-marker');
  const score = new Map();
  for (const e of events) {
    if (threadName.get(e.pid + ':' + e.tid) !== 'CrRendererMain') continue;
    if (/^(Layout|UpdateLayoutTree|Paint|FireAnimationFrame|TimerFire|FunctionCall|EventDispatch|Commit)$/.test(e.name)) score.set(e.pid, (score.get(e.pid) || 0) + 1);
  }
  let pid = null, best = 30;
  for (const [k, v] of score) if (v > best) { best = v; pid = k; }
  if (pid === null && marker) pid = marker.pid;
  if (pid === null) {
    for (const [k, n] of threadName) if (n === 'CrRendererMain') { pid = Number(k.split(':')[0]); break; }
  }
  const mine = events.filter((e) => e.pid === pid);
  const nameOf = (e) => threadName.get(e.pid + ':' + e.tid) || '';
  const main = mine.filter((e) => nameOf(e) === 'CrRendererMain');
  const comp = mine.filter((e) => nameOf(e) === 'Compositor');
  const raster = mine.filter((e) => /^CompositorTileWorker/.test(nameOf(e)));
  const x = (arr, name) => arr.filter((e) => e.name === name && e.ph === 'X');
  const sum = (arr) => arr.reduce((a, e) => a + dur(e), 0);

  const layouts = x(main, 'Layout');
  const styles = x(main, 'UpdateLayoutTree');
  const paints = x(main, 'Paint');
  const prePaints = x(main, 'PrePaint');
  const commits = x(main, 'Commit');
  const layerize = x(main, 'Layerize');
  const rasterTasks = raster.filter((e) => e.name === 'RasterTask' && e.ph === 'X');
  const tasks = main.filter((e) => e.name === 'ThreadControllerImpl::RunTask' && e.ph === 'X');
  const compTasks = comp.filter((e) => e.name === 'ThreadControllerImpl::RunTask' && e.ph === 'X');
  const draws = events.filter((e) => e.name === 'DrawFrame' && e.pid === pid).map((e) => e.ts).sort((a, b) => a - b);
  const drawFrames = draws.length;
  let drawGapMax = 0, drawGaps25 = 0;
  for (let i = 1; i < draws.length; i++) { const g = (draws[i] - draws[i - 1]) / 1000; if (g > drawGapMax) drawGapMax = g; if (g > 25) drawGaps25++; }
  const beginMain = main.filter((e) => e.name === 'BeginMainThreadFrame').length;
  const activate = comp.filter((e) => e.name === 'ActivateLayerTree').length;
  const raf = x(main, 'FireAnimationFrame');
  const fnCalls = x(main, 'FunctionCall');

  // Why was layout or style work scheduled? Top reasons by count, from invalidation tracking.
  const why = {};
  for (const e of main) {
    if (e.name === 'LayoutInvalidationTracking' || e.name === 'StyleRecalcInvalidationTracking') {
      const d = (e.args && e.args.data) || {};
      const key = `${e.name === 'LayoutInvalidationTracking' ? 'layout' : 'style'}:${d.reason || '?'}:${d.nodeName || ''}`;
      why[key] = (why[key] || 0) + 1;
    }
  }
  const whyTop = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} x${n}`);

  // Animation events carry compositeFailed (a bitmask) when Blink could not run an animation on the compositor.
  const anim = {};
  for (const e of mine) {
    if (e.name !== 'Animation' || (e.ph !== 'b' && e.ph !== 'n')) continue;
    const d = (e.args && e.args.data) || {};
    const key = d.displayName || d.name || d.id;
    if (!key) continue;
    const prev = anim[key] || (anim[key] = { failed: 0, unsupported: [] });
    if (d.compositeFailed) prev.failed |= d.compositeFailed;
    if (Array.isArray(d.unsupportedProperties)) for (const p of d.unsupportedProperties) if (!prev.unsupported.includes(p)) prev.unsupported.push(p);
    prev.state = d.state || prev.state;
  }

  const round = (n) => Math.round(n * 100) / 100;
  return {
    layoutCount: layouts.length, layoutMs: round(sum(layouts)),
    layoutDirtyMax: layouts.reduce((a, e) => Math.max(a, (e.args && e.args.beginData && e.args.beginData.dirtyObjects) || 0), 0),
    styleCount: styles.length, styleMs: round(sum(styles)),
    paintCount: paints.length, paintMs: round(sum(paints)), prePaintCount: prePaints.length,
    layerizeCount: layerize.length, commitCount: commits.length,
    rasterTasks: rasterTasks.length, rasterMs: round(sum(rasterTasks)),
    mainBusyMs: round(sum(tasks)), mainMaxTaskMs: round(tasks.reduce((a, e) => Math.max(a, dur(e)), 0)),
    compBusyMs: round(sum(compTasks)),
    jsMs: round(sum(fnCalls) + sum(x(main, 'TimerFire'))),
    rafCallbacks: raf.length,
    drawFrames, drawGapMax: round(drawGapMax), drawGaps25, beginMainFrames: beginMain, activateTree: activate,
    why: whyTop, animations: anim
  };
}

function probeStats(probe, windowMs) {
  const f = probe.frames;
  if (!f.length) return { frames: 0, fps: 0, over20: 0, over33: 0, p95: 0, max: 0, shifts: 0, shiftSum: 0 };
  const total = f.reduce((a, b) => a + b, 0);
  const sorted = [...f].sort((a, b) => a - b);
  const r = (n) => Math.round(n * 10) / 10;
  return {
    frames: f.length, fps: r(f.length / (total / 1000)),
    over20: f.filter((d) => d > 20).length, over33: f.filter((d) => d > 33.5).length,
    p95: r(sorted[Math.floor(sorted.length * 0.95)]), max: r(sorted[sorted.length - 1]),
    shifts: probe.shifts.length, shiftSum: Math.round(probe.shifts.reduce((a, s) => a + s.v, 0) * 1000) / 1000,
    shiftSrc: [...new Set(probe.shifts.flatMap((s) => s.src))].slice(0, 6),
    longTasks: probe.longTasks.length
  };
}

// Which elements got their own compositor layer because of a running animation?
async function compositedAnimations(p) {
  const c = p.c;
  const layers = new Map();
  const off = c.on((m) => { if (m.method === 'LayerTree.layerTreeDidChange' && m.params.layers) for (const l of m.params.layers) layers.set(l.layerId, l); });
  await c.send('DOM.enable');
  await c.send('LayerTree.enable');
  // The tree is only reported after a commit, and an idle page makes none: a custom property nobody uses forces one.
  for (let i = 0; i < 3; i++) { await sleep(150); await p.eval(`document.documentElement.style.setProperty('--qa-tick', '${i + 1}')`); }
  await sleep(300);
  off();
  const out = [];
  for (const l of layers.values()) {
    if (!l.backendNodeId) continue;
    let reasons = [];
    try { reasons = (await c.send('LayerTree.compositingReasons', { layerId: l.layerId })).compositingReasonIds || []; } catch (e) { continue; }
    const anim = reasons.filter((r) => /animation/i.test(r));
    if (!anim.length) continue;
    let node = '?';
    try {
      const d = (await c.send('DOM.describeNode', { backendNodeId: l.backendNodeId })).node;
      const attrs = {};
      for (let i = 0; d.attributes && i < d.attributes.length; i += 2) attrs[d.attributes[i]] = d.attributes[i + 1];
      node = d.nodeName.toLowerCase() + (attrs.id ? '#' + attrs.id : '') + (attrs.class ? '.' + attrs.class.split(/\s+/).join('.') : '');
    } catch (e) { /* node gone */ }
    out.push({ node, reasons: anim, size: `${Math.round(l.width)}x${Math.round(l.height)}` });
  }
  try { await c.send('LayerTree.disable'); } catch (e) { /* ignore */ }
  return out;
}

// ---------------------------------------------------------------- audit (infinite animations per theme and mode)

const AUDIT_JS = `(() => {
  const sel = (n) => n ? (n.id ? '#' + n.id : n.nodeName.toLowerCase() + (n.classList && n.classList.length ? '.' + Array.from(n.classList).join('.') : '')) : '?';
  const skip = ['offset', 'easing', 'composite', 'computedOffset'];
  return document.getAnimations().map((a) => {
    const e = a.effect, t = e && e.getComputedTiming ? e.getComputedTiming() : {};
    let props = [];
    try { props = Array.from(new Set(e.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !skip.includes(p))))); } catch (x) { /* none */ }
    return { type: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '?', target: sel(e && e.target) + ((e && e.pseudoElement) || ''),
      iterations: t.iterations === Infinity ? 'inf' : t.iterations, duration: t.duration, state: a.playState, props };
  });
})()`;

function auditVariants(name, srv) {
  const o = OVERLAYS[name];
  const base = (extra) => ({ url: (q) => srv.url(o.file, [extra, q].filter(Boolean).join('&')), size: o.size });
  const v = [];
  if (name === 'chat') v.push({ id: 'preview', ...base('onizleme=1') });
  else if (name === 'ticker') {
    v.push({ id: 'two-lines', ...base('duyuruMetinleri=' + encodeURIComponent('Follow the channel|Join the Discord') + '&duyuruSn=3') });
    v.push({ id: 'marquee', ...base('duyuruMetinleri=' + encodeURIComponent(LONG_LINE + '|Short') + '&duyuruSn=3') });
  } else if (name === 'countdown') {
    v.push({ id: 'running', ...base('onizleme=1') });
    v.push({ id: 'done', ...base('geriSayimDk=1'), shift: 61000 });
  } else v.push({ id: 'preview', ...base('onizleme=1') });
  return v;
}

async function runAudit(srv, outDir, overlays, themes) {
  console.log('\n== audit: running infinite animations per overlay, theme and mode (no throttling)');
  const jobs = [];
  for (const name of overlays) for (const v of auditVariants(name, srv)) for (const theme of themes) for (const mode of MODES) jobs.push({ name, v, theme, mode });
  const rows = [];
  const POOL = 4;
  const pages = await Promise.all(Array.from({ length: POOL }, async () => ({ busy: false, mode: null, p: null })));
  let next = 0;
  async function worker(slot) {
    while (next < jobs.length) {
      const j = jobs[next++];
      const reduced = j.mode === 'reduced';
      const q = `stil=${j.theme}&animasyon=${reduced ? 'normal' : j.mode}`;
      try {
        if (!slot.p || slot.size !== j.v.size.join('x') || slot.reduced !== reduced) {
          if (slot.p) await slot.p.close();
          slot.p = null;
          slot.p = await newPage(srv, { size: j.v.size, reduced });
          slot.size = j.v.size.join('x');
          slot.reduced = reduced;
        }
        await slot.p.goto(j.v.url(q));
        if (j.v.shift) { await sleep(150); await slot.p.eval(`__qa.dateShift = ${j.v.shift}`); await sleep(700); }
        await sleep(800);
        const anims = await slot.p.eval(AUDIT_JS);
        const classes = await slot.p.eval('document.body.className');
        rows.push({ overlay: j.name, variant: j.v.id, theme: j.theme, mode: j.mode, bodyClass: classes, animations: anims, errors: slot.p.logs.splice(0) });
      } catch (e) {
        rows.push({ overlay: j.name, variant: j.v.id, theme: j.theme, mode: j.mode, error: e.message, animations: [] });
        if (slot.p) { try { await slot.p.close(); } catch (x) { /* ignore */ } }
        slot.p = null;
      }
    }
    if (slot.p) await slot.p.close();
  }
  await Promise.all(pages.map(worker));
  for (const r of rows) if (r.error) FAILURES.push(`audit ${r.overlay}/${r.variant} ${r.theme} ${r.mode}: ${r.error}`);
  rows.sort((a, b) => (a.overlay + a.variant + a.theme + a.mode).localeCompare(b.overlay + b.variant + b.theme + b.mode));
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(rows, null, 1));

  // Summary: infinite animations by mode, and anything that should have stopped.
  const lines = ['# Audit: infinite animations that are running', ''];
  const inf = (r) => r.animations.filter((a) => a.iterations === 'inf' && a.state === 'running');
  const sig = (a) => `${a.name} on ${a.target} [${a.props.join(', ')}] ${a.duration}ms`;
  const violations = [];
  for (const mode of MODES) {
    const set = rows.filter((r) => r.mode === mode);
    const bad = set.filter((r) => inf(r).length);
    lines.push(`## ${mode}: ${bad.length} of ${set.length} loads have a running infinite animation`);
    const byKey = {};
    for (const r of bad) for (const a of inf(r)) { const k = `${r.overlay}/${r.variant} ${sig(a)}`; (byKey[k] = byKey[k] || []).push(r.theme); }
    for (const [k, t] of Object.entries(byKey)) lines.push(`- ${k}  (themes: ${t.length === THEMES.length ? 'all' : [...new Set(t)].join(', ')})`);
    if (mode !== 'normal') for (const r of bad) violations.push(`${r.overlay}/${r.variant} ${r.theme} ${mode}`);
    lines.push('');
  }
  const offLeft = rows.filter((r) => r.mode === 'off' && r.animations.length);
  lines.push(`## off: ${offLeft.length} loads still have any animation or transition object`);
  for (const r of offLeft.slice(0, 20)) lines.push(`- ${r.overlay}/${r.variant} ${r.theme}: ${r.animations.map(sig).join('; ')}`);
  lines.push('');
  const redLeft = rows.filter((r) => r.mode === 'reduced');
  const redKinds = {};
  for (const r of redLeft) for (const a of r.animations) { const k = `${r.overlay}/${r.variant} ${a.type} ${a.name} on ${a.target} (${a.iterations === 'inf' ? 'infinite' : 'finite'})`; redKinds[k] = (redKinds[k] || 0) + 1; }
  lines.push('## reduced-motion: animation and transition objects present after 1.5 s (non-message)');
  for (const [k, n] of Object.entries(redKinds)) lines.push(`- ${k} x${n}`);
  lines.push('');
  const errs = rows.filter((r) => r.errors && r.errors.length || r.error);
  lines.push(`## load errors: ${errs.length}`);
  for (const r of errs.slice(0, 10)) lines.push(`- ${r.overlay}/${r.variant} ${r.theme} ${r.mode}: ${r.error || r.errors.join(' | ')}`);
  fs.writeFileSync(path.join(outDir, 'audit.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\naudit violations (low/off/reduced with a running infinite animation): ${violations.length}`);
  return rows;
}

// ---------------------------------------------------------------- shots (frame sequences and filmstrips)

// Visual only: gives the glass blur something to sit on. The overlays style html and body as transparent.
const BACKDROP_JS = `document.addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style');
  st.textContent = 'html { background: linear-gradient(135deg, #1b2434 0%, #3a2a55 55%, #16343c 100%) !important; }';
  document.head.appendChild(st);
});`;

async function startCast(p, size, dpr) {
  const frames = [];
  const off = p.c.on((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    frames.push({ t: m.params.metadata.timestamp * 1000, data: m.params.data });
    p.c.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  await p.c.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: Math.round(size[0] * dpr), maxHeight: Math.round(size[1] * dpr) });
  return { frames, stop: async () => { await p.c.send('Page.stopScreencast').catch(() => {}); off(); return frames; } };
}

// Renders a local HTML file to a PNG at the size of its content.
async function renderHtml(htmlPath, pngPath, width) {
  const p = await newPage(null, { size: [width, 600] });
  await p.goto('file:///' + htmlPath.replace(/\\/g, '/'));
  await sleep(600);
  const h = await p.eval('Math.ceil(document.documentElement.scrollHeight)');
  const w = await p.eval('Math.ceil(document.documentElement.scrollWidth)');
  await p.c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const r = await p.c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(pngPath, Buffer.from(r.data, 'base64'));
  await p.close();
}

// Picks the frame in force at each requested time (ms after t0) and writes a labelled filmstrip PNG.
async function filmstrip(outDir, name, frames, t0, times, o) {
  const dir = path.join(outDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const cells = [];
  times.forEach((t, i) => {
    let pick = null;
    for (const f of frames) if (f.t <= t0 + t) pick = f;
    if (!pick) pick = frames[0];
    if (!pick) return;
    const file = 'f' + String(i).padStart(2, '0') + '.png';
    fs.writeFileSync(path.join(dir, file), Buffer.from(pick.data, 'base64'));
    cells.push(`<figure><img src="${name}/${file}"><figcaption>${t >= 0 ? '+' : ''}${t} ms</figcaption></figure>`);
  });
  const w = o.cellW;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 12px; background: #0e1118; color: #9aa4b2; font: 12px/1.3 system-ui, sans-serif; }
    h1 { font-size: 13px; margin: 0 0 8px; color: #e5e7eb; }
    .g { display: grid; grid-template-columns: repeat(${o.cols}, ${w}px); gap: 8px; }
    figure { margin: 0; } img { width: ${w}px; display: block; outline: 1px solid #2a3140; }
    figcaption { margin-top: 2px; }
  </style><h1>${name}</h1><div class="g">${cells.join('')}</div>`;
  const htmlPath = path.join(outDir, name + '.html');
  fs.writeFileSync(htmlPath, html);
  await renderHtml(htmlPath, path.join(outDir, name + '.png'), o.cols * (w + 8) + 24);
}

const steps = (from, to, by) => { const a = []; for (let t = from; t <= to; t += by) a.push(t); return a; };

// Each sequence: a page, an optional setup (not filmed) and the action to film. times are ms after the action starts.
function sequences(srv) {
  const bar = (theme) => ({ overlay: 'follower-bar', size: [520, 90], dpr: 2, theme, query: 'onizleme=1&takipciHedefi=1000' });
  const set = (n) => (p) => p.eval(`__bars[0].set(${n}, 0)`);
  const settleTo = (n) => async (p) => { await p.eval(`__bars[0].set(${n}, 0)`); await sleep(2200); };
  const live = async () => { for (let i = 0; i < 40 && srv.clients() === 0; i++) await sleep(100); await sleep(400); };
  const chat = (name, query, setup, action, times) => ({ name, overlay: 'chat', size: [460, 760], dpr: 1, theme: 'glass', query: 'kanal=qa' + (query ? '&' + query : ''), setup, action, times, cols: 5, cellW: 260 });
  const out = [];
  out.push({ name: 'bar-entrance-glass', ...bar('glass'), fromLoad: true, times: steps(0, 700, 70), cols: 2, cellW: 520 });
  out.push({ name: 'bar-bump-milestone-glass', ...bar('glass'), setup: settleTo(200), action: set(260), times: steps(0, 2000, 125), cols: 2, cellW: 520 });
  out.push({ name: 'bar-goal-reached-glass', ...bar('glass'), setup: settleTo(950), action: set(1000), times: steps(0, 2000, 125), cols: 2, cellW: 520 });
  for (const th of ['glass', 'retro', 'terminal', 'ember', 'aurora', 'holo', 'neon', 'paper']) {
    out.push({ name: 'bar-fill-sweep-' + th, ...bar(th), setup: settleTo(40), action: set(500), times: [0, 100, 200, 350, 500, 700, 1000, 1500], cols: 2, cellW: 520 });
  }
  out.push(chat('chat-enter-glass', '', async () => { await live(); await emitMany(srv, 4, 150); await sleep(1500); }, () => emitMany(srv, 2, 700), steps(0, 840, 60)));
  out.push(chat('chat-leave-ban-glass', '', async () => { await live(); await emitMany(srv, 5, 120, (i) => i % 2); await sleep(1500); }, async () => { srv.emit('ban', { userId: 1, username: 'Kenji' }); }, steps(0, 700, 50)));
  out.push(chat('chat-overflow-glass', 'sohbetMaksMesaj=4', async () => { await live(); await emitMany(srv, 4, 100); await sleep(1500); }, () => emitMany(srv, 2, 700), steps(0, 840, 60)));
  out.push(chat('chat-fade-glass', 'sohbetSilinmeSn=2', async () => { await live(); await emitMany(srv, 3, 100); }, () => sleep(3700), [1500, 2000, 2300, 2500, 2700, 2900, 3100, 3300, 3500, 3600]));
  const two = encodeURIComponent('Follow the channel so you never miss a stream|Join the Discord: !discord');
  out.push({ name: 'ticker-swap-glass', overlay: 'ticker', size: [760, 80], dpr: 1, theme: 'glass', query: `duyuruMetinleri=${two}&duyuruSn=3`, settle: 1500, action: () => sleep(2400), times: steps(900, 2100, 100), cols: 2, cellW: 760 });
  out.push({ name: 'ticker-marquee-glass', overlay: 'ticker', size: [760, 80], dpr: 1, theme: 'glass', query: 'duyuruMetinleri=' + encodeURIComponent(LONG_LINE) + '&duyuruSn=3', action: () => sleep(6300), times: steps(0, 6000, 500), cols: 2, cellW: 760 });
  out.push({ name: 'countdown-tick-glass', overlay: 'countdown', size: [520, 190], dpr: 1, theme: 'glass', query: 'onizleme=1', action: () => sleep(2300), times: steps(0, 2000, 100), cols: 4, cellW: 300 });
  out.push({ name: 'countdown-done-glass', overlay: 'countdown', size: [520, 190], dpr: 1, theme: 'glass', query: 'geriSayimDk=1', action: async (p) => { await p.eval('__qa.dateShift = 57400'); await sleep(5600); }, times: [0, 1000, 2000, 2500, 2700, 2900, 3100, 3300, 3600, 3900, 4200, 5000], cols: 4, cellW: 300 });
  out.push({ name: 'info-panel-glass', overlay: 'info-panel', size: [300, 80], dpr: 2, theme: 'glass', query: 'onizleme=1', action: () => sleep(2700), times: steps(0, 2500, 250), cols: 4, cellW: 300 });
  out.push({ name: 'info-panel-toggle-glass', overlay: 'info-panel', size: [300, 80], dpr: 2, theme: 'glass', query: 'onizleme=1',
    action: async (p) => { await p.eval("document.getElementById('panel').classList.add('is-off')"); await sleep(1000); await p.eval("document.getElementById('panel').classList.remove('is-off')"); await sleep(800); },
    times: [0, 100, 200, 300, 400, 500, 700, 1000, 1100, 1200, 1300, 1400, 1500, 1700], cols: 4, cellW: 300 });
  return out;
}

async function runShots(srv, outDir, overlays, themes) {
  console.log('\n== shots: frame sequences and filmstrips');
  const dir = path.join(outDir, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const only = list(arg('only'), null);
  for (const sq of sequences(srv)) {
    if (!overlays.includes(sq.overlay)) continue;
    if (only && !only.some((k) => sq.name.includes(k))) continue;
    const o = OVERLAYS[sq.overlay];
    let p = null;
    const url = srv.url(o.file, `stil=${sq.theme}&animasyon=normal&${sq.query}`);
    try {
      p = await newPage(srv, { size: sq.size, dpr: sq.dpr });
      await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: BACKDROP_JS });
      let cast, t0;
      if (sq.fromLoad) {
        cast = await startCast(p, sq.size, sq.dpr);
        t0 = Date.now();
        await p.goto(url);
        await sleep(1200);
      } else {
        await p.goto(url);
        await p.fontsReady();
        await sleep(sq.settle || 2200);
        if (sq.setup) await sq.setup(p);
        cast = await startCast(p, sq.size, sq.dpr);
        t0 = Date.now();
        if (sq.action) await sq.action(p);
        await sleep(Math.max(0, sq.times[sq.times.length - 1] + 300 - (Date.now() - t0)));
      }
      const frames = await cast.stop();
      await filmstrip(dir, sq.name, frames, t0, sq.times, sq);
      console.log(`${sq.name}: ${frames.length} frames`);
    } catch (e) {
      console.log(sq.name + ': ' + e.message);
      FAILURES.push(`shot ${sq.name}: ${e.message}`);
    } finally {
      if (p) await p.close();
    }
  }
  if (!only || only.includes('fill-grid')) {
    try { await fillGrid(srv, dir, themes); } catch (e) { console.log('fill-grid: ' + e.message); FAILURES.push('shot fill-grid: ' + e.message); }
  }
}

// Static fills at 2 / 6 / 25 / 50 / 100 %: how the scaled fill ends, and how patterns and tips look when squeezed.
async function fillGrid(srv, dir, themes) {
  const fills = [2, 6, 25, 50, 100];
  const cells = [];
  const p = await newPage(srv, { size: [520, 90], dpr: 2 });
  await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: BACKDROP_JS });
  fs.mkdirSync(path.join(dir, 'fill-grid'), { recursive: true });
  for (const th of themes) for (const f of fills) {
    const goal = Math.max(1, Math.round(1234 / (f / 100)));
    await p.goto(srv.url('follower-bar.html', `onizleme=1&animasyon=off&stil=${th}&takipciHedefi=${goal}`));
    await sleep(350);
    const shot = await p.c.send('Page.captureScreenshot', { format: 'png' });
    const file = `fill-${th}-${f}.png`;
    fs.writeFileSync(path.join(dir, 'fill-grid', file), Buffer.from(shot.data, 'base64'));
    cells.push({ th, f, file });
  }
  await p.close();
  const rows = themes.map((th) => `<div class="r"><b>${th}</b>${cells.filter((c) => c.th === th).map((c) => `<figure><img src="fill-grid/${c.file}"><figcaption>${c.f}%</figcaption></figure>`).join('')}</div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 12px; background: #0e1118; color: #9aa4b2; font: 12px system-ui, sans-serif; }
    .r { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; } b { width: 60px; color: #e5e7eb; }
    figure { margin: 0; } img { width: 340px; display: block; } figcaption { text-align: center; }
  </style>${rows}`;
  const htmlPath = path.join(dir, 'fill-grid.html');
  fs.writeFileSync(htmlPath, html);
  await renderHtml(htmlPath, path.join(dir, 'fill-grid.png'), 5 * 346 + 100);
  console.log('fill-grid.png written');
}

module.exports = { newPage, startServer, launchChrome, analyze, probeStats, traceStart, traceStop, compositedAnimations, OVERLAYS, THEMES, MODES, LONG_LINE, sleep, auditVariants };

// ---------------------------------------------------------------- scenarios

const CHAT_USERS = [
  { username: 'Mia', senderId: 1, color: '#7bdcff', badges: [{ type: 'vip' }, { type: 'subscriber', count: 3 }] },
  { username: 'Kenji', senderId: 2, color: '#ffd166', badges: [{ type: 'moderator' }] },
  { username: 'StreamerName', senderId: 3, color: '#53fc18', badges: [{ type: 'broadcaster' }] },
  { username: 'Luna', senderId: 4, color: '#ff8bd1', badges: [] },
  { username: 'Alex', senderId: 5, color: '#a78bfa', badges: [{ type: 'og' }, { type: 'sub_gifter', count: 5 }] }
];
const CHAT_TEXT = [
  'Hey chat!', 'This overlay looks clean', 'GG! ranked when?', 'Audio is crystal clear today, great stream so far',
  'thanks for the gifts', 'lol that was close, did you see that last second clutch from the other team? unreal',
  'first time here, love the vibe', 'Selam!'
];
let chatSeq = 0;
function chatMsg(i, userIdx) {
  const u = CHAT_USERS[(userIdx !== undefined ? userIdx : i) % CHAT_USERS.length];
  return Object.assign({ id: 'qa-' + (++chatSeq), message: CHAT_TEXT[i % CHAT_TEXT.length] }, u);
}
async function emitMany(srv, n, gapMs, userPick) {
  for (let i = 0; i < n; i++) { srv.emit('chat', chatMsg(i, userPick ? userPick(i) : undefined)); if (gapMs) await sleep(gapMs); }
}

// A scenario: id, query (extra URL params), prepare (untraced setup), action (traced), ms (window), probe (rAF probe on/off),
// traceLoad (trace and probe from before navigation), watch (selectors whose rects are sampled per frame), layers (check compositing).
function scenarios(name, srv) {
  const o = OVERLAYS[name];
  if (o.goals) {
    const setAll = (frac) => o.goals.map((g, i) => `__bars[${i}].set(${Math.round(g * frac)}, ${o.delta[i]})`).join(';');
    const reset = (frac) => async (p) => { await p.eval(setAll(frac)); await sleep(2100); };
    const jump = (from, to, id) => ({ id, prepare: reset(from), action: (p) => p.eval(setAll(to)), ms: 2400 });
    return [
      { id: 'load', traceLoad: true, ms: 2600, layers: false },
      { id: 'idle', ms: 5000, probe: false, layers: true },
      { id: 'bump', prepare: reset(0.10), action: (p) => p.eval(setAll(0.11)), ms: 2400 },
      jump(0.24, 0.26, 'milestone25'), jump(0.49, 0.51, 'milestone50'), jump(0.74, 0.76, 'milestone75'),
      jump(0.95, 1.0, 'goal'), jump(0.05, 0.95, 'bigjump'),
      { id: 'textshift', query: 'takipciHedefi=5000&aboneHedefi=5000', prepare: async (p) => { await p.eval(o.goals.map((g, i) => `__bars[${i}].set(0, 0)`).join(';')); await sleep(2100); },
        action: (p) => p.eval(`__bars[0].set(${o.goals.length > 1 ? 1234 : 1234}, ${o.delta[0]}); ${o.goals.length > 1 ? '__bars[1].set(1234, 3)' : ''}`), ms: 2000, probe: true,
        watch: o.goals.length > 1 ? ['#followRow .ko-label', '#followRow .ko-cur', '#followRow .ko-goal', '#subRow .ko-label'] : ['.ko-label', '.ko-cur', '.ko-goal'], noStats: true }
    ];
  }
  if (name === 'info-panel') {
    return [
      { id: 'load', traceLoad: true, ms: 2200 },
      { id: 'idle', ms: 6000, probe: false, layers: true },
      { id: 'toggle', action: async (p) => { await p.eval("document.getElementById('panel').classList.add('is-off')"); await sleep(1100); await p.eval("document.getElementById('panel').classList.remove('is-off')"); }, ms: 2600 }
    ];
  }
  if (name === 'chat') {
    const live = async (p) => { for (let i = 0; i < 40 && srv.clients() === 0; i++) await sleep(100); await sleep(400); };
    return [
      { id: 'enter', live: true, prepare: live, action: () => emitMany(srv, 6, 450), ms: 4200 },
      { id: 'overflow', live: true, prepare: async (p) => { await live(p); await emitMany(srv, 8, 80); await sleep(1500); }, action: () => emitMany(srv, 8, 350), ms: 3800 },
      { id: 'burst', live: true, prepare: async (p) => { await live(p); await emitMany(srv, 4, 150); await sleep(1500); }, action: () => emitMany(srv, 8, 20), ms: 2500 },
      { id: 'ban', live: true, prepare: async (p) => { await live(p); await emitMany(srv, 6, 120, (i) => i % 2); await sleep(1500); }, action: async () => { srv.emit('ban', { userId: 1, username: 'Kenji' }); }, ms: 1600 },
      { id: 'fade', live: true, query: 'sohbetSilinmeSn=2', prepare: async (p) => { await live(p); await emitMany(srv, 4, 100); }, action: () => sleep(4200), ms: 4400 },
      { id: 'idle', live: true, prepare: async (p) => { await live(p); await emitMany(srv, 8, 80, (i) => i % 5); await sleep(1500); }, ms: 5000, probe: false, layers: true }
    ];
  }
  if (name === 'ticker') {
    const three = 'duyuruMetinleri=' + encodeURIComponent('Follow the channel so you never miss a stream|Join the Discord: !discord|Gifted subs today: thank you!') + '&duyuruSn=3';
    const longq = 'duyuruMetinleri=' + encodeURIComponent(LONG_LINE) + '&duyuruSn=3';
    return [
      { id: 'swap', query: three, ms: 8200 },
      { id: 'marquee', query: longq, ms: 6000, layers: true,
        extra: async (p) => {
          const a = await p.eval("(() => { const e = document.querySelector('.ko-marquee > span'); return e ? { x: new DOMMatrix(getComputedStyle(e).transform).m41, t: performance.now(), w: e.offsetWidth, mq: getComputedStyle(e.parentElement).getPropertyValue('--mq-ms') } : null; })()");
          await sleep(2000);
          const b = await p.eval("(() => { const e = document.querySelector('.ko-marquee > span'); return e ? { x: new DOMMatrix(getComputedStyle(e).transform).m41, t: performance.now() } : null; })()");
          return a && b ? { marqueePxPerS: Math.round(Math.abs(b.x - a.x) / ((b.t - a.t) / 1000) * 10) / 10, textWidth: a.w, cycleMs: a.mq } : { marqueePxPerS: null };
        } },
      { id: 'idle', query: 'duyuruMetinleri=' + encodeURIComponent('A single short line'), ms: 4000, probe: false, layers: true }
    ];
  }
  if (name === 'countdown') {
    return [
      { id: 'tick', query: 'onizleme=1', ms: 5000, layers: true },
      { id: 'digits', query: 'onizleme=1', ms: 4000, watch: ['#time'], noStats: true },
      { id: 'done', query: 'geriSayimDk=1', action: async (p) => { await p.eval('__qa.dateShift = 57000'); }, ms: 7000, layers: true }
    ];
  }
  return [];
}

// Scenarios that matter when the theme changes: infinite loops, fills, per-message blur.
const THEME_SCENARIOS = { 'follower-bar': ['idle', 'bump'], 'subscriber-bar': ['idle'], 'combined-bar': ['idle', 'bump'], 'info-panel': ['idle'], chat: ['enter', 'idle'], countdown: ['tick'], ticker: ['swap'] };

function windowFor(sc) { return QUICK ? Math.min(sc.ms, 3000) : sc.ms; }

async function perfRun(srv, name, sc, ctx) {
  const o = OVERLAYS[name];
  const reduced = ctx.mode === 'reduced';
  let own;
  if (o.goals || name === 'info-panel') own = 'onizleme=1';
  else if (name === 'chat') own = sc.live ? 'kanal=qa' : 'onizleme=1';
  else own = '';
  const query = [`stil=${ctx.theme}`, `animasyon=${reduced ? 'normal' : ctx.mode}`, own, sc.query].filter(Boolean).join('&');
  const url = srv.url(o.file, query);
  const res = { overlay: name, scenario: sc.id, theme: ctx.theme, mode: ctx.mode, throttle: ctx.throttle, pass: ctx.noProbe ? 'no-probe' : 'probe' };
  let p = null;
  try {
    p = await newPage(srv, { size: o.size, reduced, throttle: ctx.throttle });
    if (sc.traceLoad) {
      await p.c.send('Page.addScriptToEvaluateOnNewDocument', { source: '__qa.start()' });
      await traceStart(p);
      const t0 = Date.now();
      await p.goto(url);
      await sleep(Math.max(0, windowFor(sc) - (Date.now() - t0)));
    } else {
      await p.goto(url);
      await p.fontsReady();
      await sleep(sc.id === 'idle' ? 2800 : 1800);
      if (sc.prepare) await sc.prepare(p);
      await traceStart(p);
      if (sc.probe !== false && !ctx.noProbe) await p.eval(`__qa.start(${sc.watch ? JSON.stringify(sc.watch) : ''})`);
      const t0 = Date.now();
      if (sc.action) await sc.action(p);
      await sleep(Math.max(0, windowFor(sc) - (Date.now() - t0)));
      if (sc.extra) Object.assign(res, await sc.extra(p));
    }
    const probe = sc.probe !== false && !ctx.noProbe ? await p.eval('__qa.stop()') : null;
    const events = await traceStop(p);
    Object.assign(res, { windowMs: windowFor(sc) }, probe ? probeStats(probe, windowFor(sc)) : {}, analyze(events));
    if (probe && sc.watch) { res.rects = probe.rects; res.rectSummary = rectSummary(probe.rects, sc.watch); }
    if (sc.layers && ctx.mode !== 'off') res.composited = await compositedAnimations(p);
    if (p.logs.length) res.errors = p.logs.slice(0, 3);
  } catch (e) {
    res.error = e.message;
  } finally {
    if (p) await p.close();
  }
  return res;
}

// Per watched element: how far x, y and width moved while the animation ran (px).
function rectSummary(rows, watch) {
  const out = {};
  watch.forEach((sel, i) => {
    const v = rows.map((r) => r[i + 1]).filter(Boolean);
    if (!v.length) return;
    const rng = (k) => { const a = v.map((r) => r[k]); return Math.round((Math.max(...a) - Math.min(...a)) * 100) / 100; };
    out[sel] = { xRange: rng(0), yRange: rng(1), widthRange: rng(2), heightRange: rng(3), widthMin: Math.round(Math.min(...v.map((r) => r[2])) * 10) / 10, widthMax: Math.round(Math.max(...v.map((r) => r[2])) * 10) / 10 };
  });
  return out;
}

function fmtRow(r) {
  if (r.error) return `${r.overlay} ${r.scenario} ${r.theme} ${r.mode} ${r.throttle}x ERROR ${r.error}`;
  const busy = r.windowMs ? Math.round(r.mainBusyMs / r.windowMs * 100) : 0;
  return `${r.overlay.padEnd(14)} ${r.scenario.padEnd(11)} ${r.theme.padEnd(8)} ${r.mode.padEnd(7)} ${r.throttle}x ${r.pass === 'no-probe' ? 'NP' : '  '}| fps ${String(r.fps ?? '-').padEnd(5)} >20ms ${String(r.over20 ?? '-').padEnd(3)} max ${String(r.max ?? '-').padEnd(5)} | busy ${String(busy).padStart(3)}% | layout ${r.layoutCount}/${r.layoutMs}ms style ${r.styleCount} paint ${r.paintCount}/${r.paintMs}ms raster ${r.rasterTasks} draw ${r.drawFrames}(gap ${r.drawGapMax}) commit ${r.commitCount} | shifts ${r.shifts ?? '-'}`;
}

async function runPerf(srv, outDir, overlays, themes) {
  console.log(`\n== perf: scenarios x modes (glass) and a per-theme sweep, CPU throttle ${THROTTLE}x (plus a 1x baseline)`);
  const modes = list(arg('modes'), MODES);
  const jsonl = path.join(outDir, 'perf.jsonl');
  fs.writeFileSync(jsonl, '');
  const all = [];
  const run = async (name, sc, ctx) => {
    let r = await perfRun(srv, name, sc, ctx);
    // A DevTools timeout (a stalled trace or hung page) gets one more try. A second failure is recorded, not fatal.
    if (r.error && /timeout/i.test(r.error)) {
      console.log(`retry ${name}/${sc.id} ${ctx.theme} ${ctx.mode}: ${r.error}`);
      r = await perfRun(srv, name, sc, ctx);
      r.attempts = 2;
    }
    if (r.error) FAILURES.push(`perf ${name}/${sc.id} ${ctx.theme} ${ctx.mode} ${ctx.throttle}x: ${r.error}`);
    all.push(r);
    fs.appendFileSync(jsonl, JSON.stringify(r) + '\n');
    console.log(fmtRow(r));
  };
  const KEY = /^(idle|bump|milestone50|enter|swap|marquee|tick|done|toggle|overflow)$/;
  for (const name of overlays) {
    const scs = scenarios(name, srv);
    // 1. Every scenario on the default theme at full motion, throttled: with the rAF probe (fps) and without (what OBS sees).
    for (const sc of scs) {
      await run(name, sc, { theme: 'glass', mode: 'normal', throttle: THROTTLE });
      if (sc.probe !== false && !sc.noStats) await run(name, sc, { theme: 'glass', mode: 'normal', throttle: THROTTLE, noProbe: true });
    }
    // 2. The other motion settings: key scenarios only.
    for (const mode of modes.filter((m) => m !== 'normal')) for (const sc of scs) {
      if (!KEY.test(sc.id)) continue;
      await run(name, sc, { theme: 'glass', mode, throttle: THROTTLE });
    }
    // 3. 1x baseline on the default theme at full motion.
    if (!QUICK && THROTTLE > 1) for (const sc of scs) await run(name, sc, { theme: 'glass', mode: 'normal', throttle: 1 });
    // 4. The other themes at full motion, only the scenarios a theme can change.
    for (const theme of themes.filter((t) => t !== 'glass')) for (const id of THEME_SCENARIOS[name] || []) {
      const sc = scs.find((s) => s.id === id);
      if (sc) await run(name, sc, { theme, mode: 'normal', throttle: THROTTLE });
    }
  }
  fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify(all.map((r) => { const c = { ...r }; delete c.rects; return c; }), null, 1));
  writePerfReport(all, outDir);
  return all;
}

function writePerfReport(all, outDir) {
  const lines = ['# Motion perf', '', `CPU throttle ${THROTTLE}x unless the row says 1x. busy = renderer main-thread task time / window.`, '',
    '| overlay | scenario | theme | mode | thr | pass | fps | >20ms | max ms | busy % | layout n/ms | style n | paint n/ms | raster n | draw (max gap) | commit | compositor ms | shifts |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of all) {
    if (r.error) { lines.push(`| ${r.overlay} | ${r.scenario} | ${r.theme} | ${r.mode} | ${r.throttle} | ERROR ${r.error} |`); continue; }
    lines.push(`| ${r.overlay} | ${r.scenario} | ${r.theme} | ${r.mode} | ${r.throttle}x | ${r.pass === 'no-probe' ? 'np' : 'probe'} | ${r.fps ?? '-'} | ${r.over20 ?? '-'} | ${r.max ?? '-'} | ${Math.round(r.mainBusyMs / r.windowMs * 100)} | ${r.layoutCount}/${r.layoutMs} | ${r.styleCount} | ${r.paintCount}/${r.paintMs} | ${r.rasterTasks} | ${r.drawFrames} (${r.drawGapMax}) | ${r.commitCount} | ${r.compBusyMs} | ${r.shifts ?? '-'} |`);
  }
  lines.push('', '## Compositing (running animations that own a compositor layer, and Blink compositeFailed flags)', '');
  for (const r of all) {
    if (!r.composited && !Object.keys(r.animations || {}).length) continue;
    const failed = Object.entries(r.animations || {}).filter(([, a]) => a.failed).map(([k, a]) => `${k}(0x${a.failed.toString(16)}${a.unsupported.length ? ' ' + a.unsupported.join('/') : ''})`);
    if (!r.composited && !failed.length) continue;
    lines.push(`- ${r.overlay}/${r.scenario} ${r.theme} ${r.mode}: layers[${(r.composited || []).map((c) => c.node + ' ' + c.reasons.join('+')).join('; ')}] failed[${failed.join('; ')}]`);
  }
  fs.writeFileSync(path.join(outDir, 'perf.md'), lines.join('\n'));
}

if (require.main === module) {
  (async () => {
    const out = arg('out');
    if (!out || out === true) { console.error('Usage: node tools/motion-qa.js --out <dir> [--phase audit,perf,shots] [--overlays a,b] [--themes x,y]'); process.exit(2); }
    fs.mkdirSync(out, { recursive: true });
    const phases = list(arg('phase'), ['audit', 'perf', 'shots']);
    const overlays = list(arg('overlays'), Object.keys(OVERLAYS));
    const themes = list(arg('themes'), THEMES);
    installExitHandlers();
    const chrome = await launchChrome();
    const srv = await startServer();
    cleanups.push(() => srv.close());
    console.log(`Chrome ${chrome.version} on ${DEVTOOLS}, server on ${srv.port}, throttle ${THROTTLE}x, fonts ${FONTS ? 'online' : 'blocked'}`);
    try {
      if (phases.includes('audit')) await runAudit(srv, out, overlays, themes);
      if (phases.includes('perf')) await runPerf(srv, out, overlays, themes);
      if (phases.includes('shots')) await runShots(srv, out, overlays, themes);
    } finally {
      runCleanups();
    }
    if (FAILURES.length) {
      console.error(`\n${FAILURES.length} failed:`);
      for (const f of FAILURES) console.error('  - ' + f);
      process.exit(1);
    }
    console.log('\nNo failed scenarios.');
    process.exit(0);
  })().catch((e) => { console.error('motion-qa aborted:', e.stack || e.message); runCleanups(); process.exit(1); });
}
