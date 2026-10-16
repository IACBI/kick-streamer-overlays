#!/usr/bin/env node
'use strict';
// Re-creates the README images in screenshots/ from the real overlay pages in preview mode.
//
// Chrome runs headless and the pages play in real time; every frame is captured with its timestamp,
// and ffmpeg turns the frames into optimised GIFs that keep the real timing.
//
//   node tools/record-previews.js            all images
//   node tools/record-previews.js themes     only the named scenes
//
// Needs: Node.js 22 or newer (global WebSocket), Chrome or Edge, and ffmpeg on the PATH.
// No packages. Every overlay is loaded with ?onizleme=1, so no Kick request is made.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const BASE_PORT = 9333 + Math.floor(Math.random() * 400) * 4;   // random, so a stale Chrome cannot be picked up
const THEMES = ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileUrl = (name, query) => pathToFileURL(path.join(ROOT, name)).href + (query || '');

function findChrome() {
  const env = process.env.CHROME_PATH;
  const list = [env,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = list.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome or Edge not found. Set CHROME_PATH.');
  return found;
}

// A stream-like backdrop so the glass and blur themes have something to sit on.
const BACKDROP = `
  html, body { margin: 0; height: 100%; overflow: hidden; font-family: Inter, system-ui, sans-serif; }
  body { background:
    radial-gradient(60% 80% at 15% 20%, rgb(83 252 24 / 22%), transparent 60%),
    radial-gradient(55% 70% at 90% 85%, rgb(124 58 237 / 38%), transparent 60%),
    radial-gradient(40% 60% at 70% 10%, rgb(14 165 233 / 25%), transparent 60%),
    #0b0f17; }
  iframe { position: absolute; border: 0; background: transparent; transform-origin: 0 0; color-scheme: normal; }
  .cap { position: absolute; left: 0; right: 0; text-align: center; color: #e5e7eb; font-weight: 700; letter-spacing: .5px; font-size: 15px; }
  .cap b { color: #53fc18; }`;

// scene: width, height (the image), duration (seconds), fps, and the page body.
const SCENES = {
  themes: {
    w: 600, h: 260, seconds: THEMES.length * 1.15, colors: 256,
    html: `<div class="cap" id="cap" style="top:16px"></div>
      <iframe id="f" width="520" height="180" style="left:40px;top:56px"></iframe>
      <script>
        const T = ${JSON.stringify(THEMES)}; let i = 0;
        function go(){ document.getElementById('cap').innerHTML = 'stil: <b>' + T[i] + '</b>';
          document.getElementById('f').src = ${JSON.stringify(fileUrl('combined-bar.html'))} + '?onizleme=1&stil=' + T[i]; i = (i + 1) % T.length; }
        go(); setInterval(go, 1150);
      </script>`
  },
  'chat-preview': {
    w: 520, h: 440, seconds: 14, colors: 256,
    html: `<iframe width="460" height="760" style="left:30px;top:-320px" src="${fileUrl('chat.html', '?onizleme=1')}"></iframe>`
  },
  'info-panel': {
    w: 360, h: 120, seconds: 6, colors: 96,
    html: `<iframe width="300" height="80" style="left:30px;top:20px;transform:scale(1)" src="${fileUrl('info-panel.html', '?onizleme=1')}"></iframe>`
  },
  combined: {
    w: 600, h: 230, seconds: 5, colors: 256,
    html: `<iframe width="520" height="180" style="left:40px;top:25px" src="${fileUrl('combined-bar.html', '?onizleme=1&stil=vivid')}"></iframe>`
  },
  countdown: {
    w: 560, h: 250, seconds: 6, colors: 96,
    html: `<iframe width="520" height="190" style="left:20px;top:30px" src="${fileUrl('countdown.html', '?onizleme=1&stil=aurora')}"></iframe>`
  },
  ticker: {
    w: 800, h: 120, seconds: 10, colors: 96,
    html: `<iframe width="760" height="80" style="left:20px;top:20px" src="${fileUrl('ticker.html', '?onizleme=1&stil=neon&duyuruSn=3')}"></iframe>`
  },
  hero: {
    w: 1280, h: 640, seconds: 11, still: true,
    html: `<iframe width="520" height="180" style="left:60px;top:60px;transform:scale(1.2)" src="${fileUrl('combined-bar.html', '?onizleme=1&stil=aurora')}"></iframe>
      <iframe width="520" height="190" style="left:60px;top:330px;transform:scale(1.2)" src="${fileUrl('countdown.html', '?onizleme=1&stil=holo')}"></iframe>
      <iframe width="460" height="760" style="left:740px;top:-120px;transform:scale(.95)" src="${fileUrl('chat.html', '?onizleme=1&stil=glass')}"></iframe>
      <div style="position:absolute;left:740px;top:70px;color:#fff"><div style="font-size:46px;font-weight:900;line-height:1.05;letter-spacing:-1px">Kick Streamer<br><span style="color:#53fc18">Overlay Pack</span></div><div style="margin-top:14px;font-size:17px;color:#9ca3af;font-weight:600">13 themes · goal bars · chat · countdown · ticker · studio</div></div>
      <iframe width="300" height="80" style="left:740px;top:230px" src="${fileUrl('info-panel.html', '?onizleme=1&stil=glass')}"></iframe>
      <iframe width="760" height="80" style="left:40px;top:560px;transform:scale(.9)" src="${fileUrl('ticker.html', '?onizleme=1&stil=ember')}"></iframe>`
  }
};

async function record(name, scene, chromePath, tmp, port) {
  const stage = path.join(tmp, name + '.html');
  fs.writeFileSync(stage, `<!doctype html><meta charset="utf-8"><style>${BACKDROP}</style><body>${scene.html}</body>`);
  const frames = path.join(tmp, name + '-frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });

  const profile = path.join(tmp, 'profile-' + name);
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${scene.w},${scene.h}`, 'about:blank'
  ], { stdio: 'ignore' });

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(250);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch (e) { /* not up yet */ }
    }
    if (!target) throw new Error('Chrome did not start');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    };
    const send = (method, params) => new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, (d) => (d.error ? rej(new Error(method + ': ' + d.error.message)) : res(d.result)));
      ws.send(JSON.stringify({ id: n, method, params: params || {} }));
    });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: scene.w, height: scene.h, deviceScaleFactor: 1, mobile: false });
    // Warm the font cache first, then load the stage again and record from its start.
    await send('Page.navigate', { url: pathToFileURL(stage).href });
    await sleep(3500);
    await send('Page.navigate', { url: pathToFileURL(stage).href });
    await sleep(400);

    if (scene.still) {
      await sleep(scene.seconds * 1000);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(frames, 'f0000.png'), Buffer.from(shot.data, 'base64'));
    } else {
      const begin = Date.now();
      const times = [];
      for (let n = 0; Date.now() - begin < scene.seconds * 1000; n++) {
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        times.push(Date.now() - begin);
        fs.writeFileSync(path.join(frames, `f${String(n).padStart(4, '0')}.png`), Buffer.from(shot.data, 'base64'));
      }
      // Real-time capture: each frame is shown for as long as it took to get the next one.
      const name4 = (n) => `f${String(n).padStart(4, '0')}.png`;
      const list = times.map((t, n) => `file '${name4(n)}'\nduration ${(((times[n + 1] || t + 100) - t) / 1000).toFixed(3)}`);
      list.push(`file '${name4(times.length - 1)}'`);   // the concat demuxer ignores the last duration without this
      fs.writeFileSync(path.join(frames, 'list.txt'), list.join('\n'));
    }
    ws.close();
  } finally {
    // The whole process tree: Chrome keeps child processes (and the debugging port) alive otherwise.
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F']);
    else chrome.kill();
    await sleep(500);
  }

  if (scene.still) {
    fs.copyFileSync(path.join(frames, 'f0000.png'), path.join(OUT, name + '.png'));
    return;
  }
  const filter = `split[a][b];[a]palettegen=max_colors=${scene.colors}:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`;
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frames, 'list.txt'), '-vf', filter, '-fps_mode', 'vfr', '-loop', '0', path.join(OUT, name + '.gif')]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr || r.error));
}

(async () => {
  const wanted = process.argv.slice(2);
  const names = wanted.length ? wanted : Object.keys(SCENES);
  const unknown = names.filter((n) => !SCENES[n]);
  if (unknown.length) { console.error('Unknown scene: ' + unknown.join(', ') + '. Known: ' + Object.keys(SCENES).join(', ')); process.exit(2); }
  const chromePath = findChrome();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-record-'));
  fs.mkdirSync(OUT, { recursive: true });
  try {
    for (const [i, name] of names.entries()) {
      process.stdout.write(`${name} ... `);
      await record(name, SCENES[name], chromePath, tmp, BASE_PORT + i);
      console.log('ok');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
