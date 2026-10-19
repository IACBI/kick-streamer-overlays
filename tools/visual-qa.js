#!/usr/bin/env node
/*
 * Visual QA for the overlay pack: contact sheets, pixel-based contrast and colour-blindness checks.
 * Plain Node, no npm packages. Needs Chrome or Edge (or set CHROME_PATH) and network for Google Fonts.
 *
 *   node tools/visual-qa.js --out <dir>                     everything (a few minutes)
 *   node tools/visual-qa.js --out <dir> --only main        one group: main,levels,shapes,fonts,stress,cvd,scenes
 *   node tools/visual-qa.js --out <dir> --overlays chat,ticker --themes glass,neon --accents "#53fc18"
 *   node tools/visual-qa.js --out <dir> --bgs dark,busy    backgrounds: light,dark,busy
 *   node tools/visual-qa.js --out <dir> --no-measure       screenshots only (skip contrast data)
 *   --concurrency N (default 3)   --max-px N (longest sheet edge, default 1900)   --wait ms (extra settle time)
 *   --step-timeout s (default 30) seconds one DevTools call may take; failed sheets are listed at the end (exit 1)
 *
 * Every overlay is rendered in an iframe from a local static server with ?onizleme=1 over a transparent
 * background, so the sheet background behind each cell is what a viewer would see behind the overlay.
 * Contrast is measured on pixels: the text is made transparent, the sheet is screenshotted, and the pixels
 * under each glyph box are compared with the text colour (once without and once with the text-shadow).
 *
 * Outputs in --out: sheet PNGs, scenes/*.png, contrast.json, fill-track.json, issues.json, index.json,
 * worst-contrast.txt, summary.txt.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);

const OUT = path.resolve(argOf('--out', path.join(process.cwd(), 'qa-out')));
const CONC = Number(argOf('--concurrency', 3));
const MAXPX = Number(argOf('--max-px', 1900));
const EXTRA_WAIT = Number(argOf('--wait', 0));
const STEP_MS = Number(argOf('--step-timeout', 30)) * 1000;
const MEASURE = !flag('--no-measure');
const ONLY = list(argOf('--only', null));

const THEMES_ALL = ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'];
const ACCENTS_ALL = [['#53fc18', 'green'], ['#ffd400', 'yellow'], ['#7c3aed', 'violet'], ['#e11d48', 'red']];
const BGS_ALL = { light: '#f2f2f2', dark: '#101014', busy: 'busy' };
const THEMES = list(argOf('--themes', null)) || THEMES_ALL;
const ACCENTS = (list(argOf('--accents', null)) || ACCENTS_ALL.map((a) => a[0])).map((h) => [h, (ACCENTS_ALL.find((a) => a[0] === h) || [0, h])[1]]);
const BGS = list(argOf('--bgs', null)) || Object.keys(BGS_ALL);

// Intended OBS size (from each page's <head> comment). cellH clips the tall chat to what the five sample messages use.
const OVERLAYS = {
  'follower-bar':   { file: 'follower-bar.html',   w: 520, h: 90,  wait: 3000,  params: { yuzdeGoster: 1, takipciHedefi: 2468 } },
  'subscriber-bar': { file: 'subscriber-bar.html', w: 520, h: 90,  wait: 3000,  params: { yuzdeGoster: 1 } },
  'combined-bar':   { file: 'combined-bar.html',   w: 520, h: 180, wait: 3000,  params: { yuzdeGoster: 1, takipciHedefi: 2468 } },
  'info-panel':     { file: 'info-panel.html',     w: 300, h: 80,  wait: 3000,  params: {} },
  'chat':           { file: 'chat.html',           w: 460, h: 760, cellH: 330, wait: 12000, params: {} },
  'countdown':      { file: 'countdown.html',      w: 520, h: 190, wait: 3000,  params: {} },
  'ticker':         { file: 'ticker.html',         w: 760, h: 80,  wait: 3500,  params: {} }
};
const OVERLAY_NAMES = list(argOf('--overlays', null)) || Object.keys(OVERLAYS);
const BAR_OVERLAYS = ['follower-bar', 'subscriber-bar', 'combined-bar'];

const CHROME = process.env.CHROME_PATH || [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

// ---- browser-side measurement (serialised into every sheet page) -----------------------------------

/* eslint-disable no-undef */
function qaMeasure() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  function rgba(str) {
    if (!str || str === 'none') return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000';
    cx.fillStyle = str;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  }
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const unlin = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
  const MACHADO = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
  };
  function sim(c, m) {
    const l = [lin(c[0]), lin(c[1]), lin(c[2])];
    return m.map((row) => unlin(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]));
  }
  function lab(c) {
    const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  function label(el) {
    const id = el.id ? '#' + el.id : '';
    const cls = el.classList && el.classList[0] ? '.' + el.classList[0] : '';
    const par = el.parentElement && el.parentElement.classList && el.parentElement.classList[0] ? el.parentElement.classList[0] + '>' : '';
    return par + el.tagName.toLowerCase() + cls + id;
  }

  window.__collect = function () {
    const out = [];
    for (const cell of window.__CELLS) {
      const fr = document.getElementById(cell.id);
      const res = { meta: cell, items: [], bars: [], issues: [], ok: false, bodyClass: '', fonts: '' };
      out.push(res);
      let win, doc;
      try { win = fr.contentWindow; doc = win.document; } catch (e) { res.issues.push({ type: 'noframe' }); continue; }
      if (!doc.body) { res.issues.push({ type: 'nobody' }); continue; }
      res.ok = true;
      res.bodyClass = doc.body.className;
      try {
        const fam = win.getComputedStyle(doc.body).fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        res.fonts = fam + ':' + (doc.fonts.check('700 16px "' + fam + '"') ? 'loaded' : 'MISSING');
      } catch (e) { res.fonts = 'n/a'; }
      const fb = fr.getBoundingClientRect();
      const ox = fb.left, oy = fb.top;
      const cs = (e) => win.getComputedStyle(e);
      const effOpacity = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(cs(n).opacity); return o; };
      const visible = (e) => { if (!e.getClientRects().length) return false; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = cs(n); if (s.visibility === 'hidden' || s.display === 'none') return false; } return true; };
      const rangeBox = (el) => {
        const r = doc.createRange(); let u = null;
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          r.selectNodeContents(n);
          for (const q of r.getClientRects()) {
            if (q.width < 0.5 || q.height < 0.5) continue;
            u = u ? { l: Math.min(u.l, q.left), t: Math.min(u.t, q.top), r: Math.max(u.r, q.right), b: Math.max(u.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
          }
        }
        return u;
      };
      // The chat feed fades its top 56px out with a mask, so text there is meant to dissolve and is not measured.
      const feedEl = doc.querySelector('.ko-feed');
      const feedTop = feedEl ? feedEl.getBoundingClientRect().top : null;
      const container = (e) => e.closest('.ko-bar,.ko-panel,.ko-msg,.cd');
      for (const el of doc.body.querySelectorAll('*')) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'link') continue;
        if (el.closest('svg') && tag !== 'svg') continue;
        let kind = null, box = null, col = null;
        if (tag === 'svg') {
          const shape = el.querySelector('path,circle,line,rect,polyline');
          const stroke = shape ? cs(shape).stroke : cs(el).stroke;
          col = rgba(stroke);
          if (!col || col[3] === 0) continue;
          const r = el.getBoundingClientRect();
          box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
          kind = 'icon';
        } else {
          if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
          box = rangeBox(el);
          if (!box) continue;
          col = rgba(cs(el).color);
          kind = 'text';
        }
        if (!visible(el)) continue;
        if (feedTop !== null && box.t < feedTop + 56) continue;
        const eo = effOpacity(el);
        if (eo < 0.05 || !col) continue;
        const s = cs(el);
        const fs = parseFloat(s.fontSize), fw = parseInt(s.fontWeight, 10);
        const large = kind === 'text' && (fs >= 24 || (fs >= 18.66 && fw >= 700));
        res.items.push({
          kind, sel: label(el), text: kind === 'text' ? el.textContent.trim().slice(0, 28) : '',
          x: ox + box.l, y: oy + box.t, w: box.r - box.l, h: box.b - box.t,
          col: col.slice(0, 3), a: col[3] * eo, fs, fw,
          shadow: kind === 'text' && s.textShadow !== 'none', need: kind === 'icon' || large ? 3 : 4.5
        });
        if (kind === 'text') {
          const c = container(el);
          if (c) {
            const cb = c.getBoundingClientRect();
            if (box.r > cb.right + 1 || box.l < cb.left - 1) res.issues.push({ type: 'overflow', el: label(el), text: el.textContent.trim().slice(0, 28), by: +Math.max(box.r - cb.right, cb.left - box.l).toFixed(1) });
          }
          if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) res.issues.push({ type: 'truncated', el: label(el), text: el.textContent.trim().slice(0, 28) });
        }
      }
      for (const row of doc.querySelectorAll('.ko-row')) {
        const kids = [...row.children].filter((k) => k.getClientRects().length);
        let minGap = Infinity;
        for (let i = 0; i < kids.length - 1; i++) {
          const a = kids[i].getBoundingClientRect(), b = kids[i + 1].getBoundingClientRect();
          minGap = Math.min(minGap, b.left - a.right);
        }
        if (minGap < 0) res.issues.push({ type: 'collision', gap: +minGap.toFixed(1) });
        else if (minGap < 10) res.issues.push({ type: 'tight', gap: +minGap.toFixed(1) });
        res.rowGap = minGap === Infinity ? null : +minGap.toFixed(1);
      }
      const barEls = [...doc.querySelectorAll('.ko-bar')].map((b) => ({ b, f: b.querySelector('.ko-fill') })).concat([...doc.querySelectorAll('.cd-track')].map((b) => ({ b, f: b.querySelector('.cd-fill') })));
      for (const { b, f } of barEls) {
        if (!f || !b.getClientRects().length) continue;
        const r = b.getBoundingClientRect();
        // The fill is a full-width layer slid left by (1 - fill), so the fraction is 1 + tx / width.
        const m = new win.DOMMatrix(cs(f).transform);
        const frac = f.offsetWidth ? 1 + m.e / f.offsetWidth : 0;
        res.bars.push({ sel: label(b), x: ox + r.left, y: oy + r.top, w: r.width, h: r.height, frac: Math.max(0, Math.min(1, frac)) });
      }
    }
    return out;
  };

  // Finite animations and transitions (entrance, fill tween) are jumped to their end state, so a slow
  // software-rendered frame cannot catch a bar half faded in. Looping ones (shimmer, drift) keep running.
  window.__settle = function () {
    for (const fr of document.querySelectorAll('iframe')) {
      try {
        for (const a of fr.contentDocument.getAnimations()) {
          const t = a.effect && a.effect.getComputedTiming();
          if (t && isFinite(t.endTime)) a.finish();
        }
      } catch (e) { /* cross-origin frame or already finished */ }
    }
  };

  // Cancels every timer an overlay page started (chat sample ticks, ticker rotation, countdown), so the
  // DOM cannot change between the screenshot and the measuring passes. TIMER_TRACKER records the ids.
  window.__freeze = function () {
    for (const fr of document.querySelectorAll('iframe')) {
      try {
        const w = fr.contentWindow;
        for (const [kind, id] of w.__qaTimers || []) { if (kind === 'i') w.clearInterval(id); else w.clearTimeout(id); }
      } catch (e) { /* cross-origin frame */ }
    }
  };

  window.__hide = function (mode) {
    const css = mode === 'raw'
      ? '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}svg *{stroke:transparent!important}'
      : '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important}svg *{stroke:transparent!important}';
    for (const fr of document.querySelectorAll('iframe')) {
      try {
        let st = fr.contentDocument.getElementById('qa-hide');
        if (!st) { st = fr.contentDocument.createElement('style'); st.id = 'qa-hide'; fr.contentDocument.head.appendChild(st); }
        st.textContent = css;
      } catch (e) { /* cross-origin frame */ }
    }
  };

  async function load(b64) {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  }
  function pixels(img, x, y, w, h, fn) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(img.w, Math.ceil(x + w)), y1 = Math.min(img.h, Math.ceil(y + h));
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 3000)));
    for (let yy = y0; yy < y1; yy += step) for (let xx = x0; xx < x1; xx += step) { const i = (yy * img.w + xx) * 4; fn(img.d[i], img.d[i + 1], img.d[i + 2]); }
  }
  function mean(img, x, y, w, h) {
    let r = 0, g = 0, b = 0, n = 0;
    pixels(img, x, y, w, h, (pr, pg, pb) => { r += pr; g += pg; b += pb; n++; });
    return n ? [r / n, g / n, b / n] : null;
  }
  function stats(img, it) {
    const rs = [];
    const a = it.a;
    pixels(img, it.x, it.y, it.w, it.h, (r, g, b) => {
      const tr = a * it.col[0] + (1 - a) * r, tg = a * it.col[1] + (1 - a) * g, tb = a * it.col[2] + (1 - a) * b;
      rs.push(ratio(lum(tr, tg, tb), lum(r, g, b)));
    });
    if (!rs.length) return null;
    rs.sort((p, q) => p - q);
    return { p5: +rs[Math.floor(rs.length * 0.05)].toFixed(2), med: +rs[Math.floor(rs.length / 2)].toFixed(2), min: +rs[0].toFixed(2) };
  }

  window.__sample = async function (rawB64, shB64, collected) {
    const raw = await load(rawB64), sh = await load(shB64);
    for (const cell of collected) {
      for (const it of cell.items) {
        it.raw = stats(raw, it);
        it.sh = it.shadow ? stats(sh, it) : it.raw;
      }
      cell.fills = [];
      for (const b of cell.bars) {
        const fw = b.frac * b.w;
        const yb = b.y + b.h * 0.3, hb = b.h * 0.4;
        const fillBox = fw >= 12 ? [b.x + 2, fw - 4] : [b.x + 1, Math.max(2, fw - 2)];
        const out = { sel: b.sel, frac: +b.frac.toFixed(3) };
        const fillCols = [];
        for (let i = 0; i < 6; i++) {
          const cw = fillBox[1] / 6;
          const m = mean(raw, fillBox[0] + i * cw, yb, Math.max(1, cw), hb);
          if (m) fillCols.push(m);
        }
        if (b.frac < 0.96 && fillCols.length) {
          const tx0 = b.x + fw + Math.max(14, 0.08 * (b.w - fw)), tx1 = b.x + b.w - 4;
          const track = tx1 - tx0 > 6 ? mean(raw, tx0, yb, tx1 - tx0, hb) : null;
          if (track) {
            const fillM = fillCols.reduce((s, c) => [s[0] + c[0] / fillCols.length, s[1] + c[1] / fillCols.length, s[2] + c[2] / fillCols.length], [0, 0, 0]);
            out.fill = fillM.map(Math.round); out.track = track.map(Math.round);
            out.ratio = +ratio(lum(...fillM), lum(...track)).toFixed(2);
            out.dE = +dE(fillM, track).toFixed(1);
            out.minColDE = +Math.min(...fillCols.map((c) => dE(c, track))).toFixed(1);
            for (const k of Object.keys(MACHADO)) out['dE_' + k] = +dE(sim(fillM, MACHADO[k]), sim(track, MACHADO[k])).toFixed(1);
          }
        }
        cell.fills.push(out);
      }
    }
    return collected;
  };
}
/* eslint-enable no-undef */

// ---- busy "game footage" background, drawn in the page (seeded, so it is identical on every run) ------

/* eslint-disable no-undef */
function qaBusyTile() {
  const N = 768;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  let s = 20260101;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const base = g.createLinearGradient(0, 0, N, N);
  ['#16452b', '#e8c23a', '#1d2d78', '#c0381f', '#f4f1e6', '#201028'].forEach((col, i, a) => base.addColorStop(i / (a.length - 1), col));
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  const pal = ['#ffffff', '#fff27a', '#ff4d4d', '#2fe0ff', '#7bff5a', '#ff7ad9', '#0a0a12', '#2b1b66', '#ffa31a', '#111'];
  for (let i = 0; i < 520; i++) {
    g.globalAlpha = 0.45 + rnd() * 0.55;
    g.fillStyle = pal[Math.floor(rnd() * pal.length)];
    const x = rnd() * N, y = rnd() * N, r = 3 + rnd() * rnd() * 70;
    g.beginPath();
    const t = rnd();
    if (t < 0.4) g.arc(x, y, r, 0, 7);
    else if (t < 0.75) g.rect(x, y, r * 1.6, r * 0.7);
    else { g.moveTo(x, y); g.lineTo(x + r * 2, y + r * (rnd() - 0.5) * 2); g.lineTo(x + r * (rnd() - 0.5) * 2, y + r * 2); }
    g.fill();
  }
  g.globalAlpha = 0.6;
  for (let i = 0; i < 160; i++) { g.strokeStyle = pal[Math.floor(rnd() * pal.length)]; g.lineWidth = 1 + rnd() * 2; g.beginPath(); const x = rnd() * N, y = rnd() * N; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 220, y + (rnd() - 0.5) * 220); g.stroke(); }
  g.globalAlpha = 1;
  const im = g.getImageData(0, 0, N, N), d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 70; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}
/* eslint-enable no-undef */

// Injected into every frame before its own scripts run.
const TIMER_TRACKER = '(' + function () {
  if (window.__qaTimers) return;
  window.__qaTimers = [];
  const si = window.setInterval, st = window.setTimeout;
  window.setInterval = function () { const id = si.apply(window, arguments); window.__qaTimers.push(['i', id]); return id; };
  window.setTimeout = function () { const id = st.apply(window, arguments); window.__qaTimers.push(['t', id]); return id; };
}.toString() + ')()';

const CVD_FILTERS = {
  protan: '0.152286 1.052583 -0.204868 0 0  0.114503 0.786281 0.099216 0 0  -0.003882 -0.048116 1.051998 0 0  0 0 0 1 0',
  deutan: '0.367322 0.860646 -0.227968 0 0  0.280085 0.672501 0.047413 0 0  -0.011820 0.042940 0.968881 0 0  0 0 0 1 0',
  tritan: '1.255528 -0.076749 -0.178779 0 0  -0.078411 0.930809 0.147602 0 0  0.004733 0.691367 0.303900 0 0  0 0 0 1 0'
};

// ---- sheet model ------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = (p) => '?' + Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/**
 * spec: { name, title, bg, filter, rows: [{label, params, overlay}], cols: [{label, swatch, params, overlay}],
 *         overlay, params }  -> a list of paginated jobs.
 */
function planSheets(spec) {
  const cellOf = (row, col) => {
    const ov = col.overlay || row.overlay || spec.overlay;
    const o = OVERLAYS[ov];
    return { ov, w: o.w, h: o.cellH || o.h, wait: o.wait, url: '/' + o.file + qs(Object.assign({ onizleme: 1 }, o.params, spec.params || {}, row.params || {}, col.params || {})) };
  };
  const colW = spec.cols.map((c) => Math.max(...spec.rows.map((r) => cellOf(r, c).w)));
  const rowH = spec.rows.map((r) => Math.max(...spec.cols.map((c) => cellOf(r, c).h)));
  const GAP = 10, LH = 150, TOP = 30 + 44;
  // Split evenly into pages that fit MAXPX.
  const fit = (sizes, cap, fixed) => {
    let per = 0, acc = fixed;
    for (const s of sizes) { if (acc + s + GAP > cap && per > 0) break; acc += s + GAP; per++; }
    per = Math.max(1, per);
    const pages = Math.ceil(sizes.length / per);
    const even = Math.ceil(sizes.length / pages);
    const out = [];
    for (let i = 0; i < sizes.length; i += even) out.push([i, Math.min(sizes.length, i + even)]);
    return out;
  };
  const colPages = fit(colW, MAXPX, LH), rowPages = fit(rowH, MAXPX, TOP);
  const jobs = [];
  rowPages.forEach(([r0, r1], ri) => colPages.forEach(([c0, c1], ci) => {
    const rows = spec.rows.slice(r0, r1), cols = spec.cols.slice(c0, c1);
    const cw = colW.slice(c0, c1), rh = rowH.slice(r0, r1);
    const W = LH + cw.reduce((a, b) => a + b + GAP, 0), H = TOP + rh.reduce((a, b) => a + b + GAP, 0);
    const cells = [];
    let y = TOP;
    rows.forEach((row, i) => {
      let x = LH;
      cols.forEach((col, j) => {
        const c = cellOf(row, col);
        cells.push({ id: `f${i}_${j}`, x, y, w: c.w, h: c.h, url: c.url, overlay: c.ov, row: row.label, col: col.label, theme: (row.params || {}).stil || (col.params || {}).stil || (spec.params || {}).stil || 'glass', accent: (row.params || {}).renk || (col.params || {}).renk || (spec.params || {}).renk || '#53fc18', bg: spec.bgName, variant: spec.name });
        x += cw[j] + GAP;
      });
      y += rh[i] + GAP;
    });
    const tag = (rowPages.length > 1 ? `_r${ri + 1}` : '') + (colPages.length > 1 ? `_c${ci + 1}` : '');
    const range = `${rows[0].label}..${rows[rows.length - 1].label} x ${cols[0].label}..${cols[cols.length - 1].label}`;
    const html = gridHtml({ title: `${spec.title} | bg ${spec.bgName}${spec.filterName ? ' | ' + spec.filterName : ''} | ${range}`, bg: spec.bg, filter: spec.filter, W, H, LH, TOP, rows, cols, cw, rh, GAP, cells });
    jobs.push({ file: `${spec.name}_${spec.bgName}${tag}.png`, html, W, H, wait: Math.max(...cells.map((c) => OVERLAYS[c.overlay].wait)) + EXTRA_WAIT, cells, group: spec.group, measure: MEASURE && spec.measure !== false });
  }));
  return jobs;
}

function gridHtml(g) {
  const bgCss = g.bg === 'busy' ? 'background-color:#444' : `background:${g.bg}`;
  const colHead = g.cols.map((c, j) => {
    let x = g.LH; for (let k = 0; k < j; k++) x += g.cw[k] + g.GAP;
    return `<div class="lab" style="left:${x}px;top:30px;width:${g.cw[j]}px;height:40px">${c.swatch ? `<i style="background:${esc(c.swatch)}"></i>` : ''}${esc(c.label)}</div>`;
  }).join('');
  const rowHead = g.rows.map((r, i) => {
    let y = g.TOP; for (let k = 0; k < i; k++) y += g.rh[k] + g.GAP;
    return `<div class="lab" style="left:0;top:${y}px;width:${g.LH - 10}px;height:${g.rh[i]}px">${esc(r.label)}</div>`;
  }).join('');
  const filterAttr = g.filter ? `style="filter:url(#${g.filter})"` : '';
  const cells = g.cells.map((c) => `<div class="cell" ${filterAttr ? '' : ''} style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px${g.filter ? ';filter:url(#' + g.filter + ')' : ''}"><iframe id="${c.id}" src="${esc(c.url)}" width="${c.w}" height="${c.h}" scrolling="no" frameborder="0"></iframe></div>`).join('');
  const defs = g.filter ? `<svg width="0" height="0" style="position:absolute"><filter id="${g.filter}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${CVD_FILTERS[g.filter]}"/></filter></svg>` : '';
  const cellMeta = g.cells.map((c) => ({ id: c.id, overlay: c.overlay, theme: c.theme, accent: c.accent, bg: c.bg, variant: c.variant, row: c.row, col: c.col, url: c.url }));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${g.W}px;height:${g.H}px;overflow:hidden;background:#15151b;font:600 13px/1.2 system-ui,Segoe UI,sans-serif;color:#eee}
.title{position:absolute;left:0;top:0;width:${g.W}px;height:30px;line-height:30px;padding-left:10px;box-sizing:border-box;background:#0b0b0f;color:#9fe}
.lab{position:absolute;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;background:#23232c;border-radius:4px;color:#fff}
.lab i{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #fff8}
#bg{position:absolute;left:${g.LH - 5}px;top:${g.TOP - 5}px;right:0;bottom:0;${bgCss}}
.cell{position:absolute;overflow:hidden}
iframe{display:block;border:0;background:transparent}
</style></head><body>
<div class="title">${esc(g.title)}</div>${colHead}${rowHead}<div id="bg"></div>${cells}${defs}
<script>
window.__CELLS=${JSON.stringify(cellMeta)};
${g.bg === 'busy' ? `(${qaBusyTile.toString()})` : 'null'};
${g.bg === 'busy' ? `document.getElementById('bg').style.backgroundImage='url('+(${qaBusyTile.toString()})()+')';` : ''}
window.__loaded=0;
document.querySelectorAll('iframe').forEach(function(f){f.addEventListener('load',function(){window.__loaded++;});});
window.__total=${g.cells.length};
(${qaMeasure.toString()})();
</script></body></html>`;
}

// ---- local static server ------------------------------------------------------------------------------

const PAGES = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = decodeURIComponent(u.pathname);
    if (p.startsWith('/__qa/')) {
      const html = PAGES.get(p.slice(6));
      if (!html) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    // The git-ignored credentials file is never served; the overlays treat its absence as normal.
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT) || /AYARLAR\.local\.js$/.test(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

// ---- process hygiene: Chrome, temp profiles and the static server are torn down on every exit path ------
// A watchdog child also kills Chrome if this process is killed hard (taskkill /F runs no handlers).

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
  const crash = (e) => { console.error('visual-qa crashed:', (e && e.stack) || e); runCleanups(); process.exit(1); };
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);
}

// ---- Chrome over CDP (same approach as tests/e2e-chrome.js) --------------------------------------------

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
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
      close: () => ws.close()
    });
    ws.onerror = () => reject(new Error('CDP websocket failed'));
    ws.onclose = () => { for (const p of pending.values()) p.reject(new Error('DevTools connection closed (Chrome exited?)')); pending.clear(); };
  });
}

// Port 0: Chrome picks a free port and writes it to DevToolsActivePort in the fresh temp profile.
async function launchChrome() {
  if (!CHROME) throw new Error('Chrome/Edge not found. Set CHROME_PATH.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-vqa-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars',
    '--force-device-scale-factor=1', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--window-size=1400,1000', 'about:blank'
  ], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  proc.on('error', () => {});
  track(proc, profile);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && proc.exitCode === null; i++) {
    try {
      const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
      if (port) return { proc, base: `http://127.0.0.1:${port}`, profile };
    } catch (e) { /* not written yet, or still locked by Chrome */ }
    await sleep(200);
  }
  throw new Error(`Chrome did not expose DevTools${proc.exitCode !== null ? ` (exited with ${proc.exitCode})` : ''}`);
}

// ---- running a job ---------------------------------------------------------------------------------------

const results = { sheets: [], cells: [] };

async function runJob(chrome, serverPort, job, idx) {
  const name = `job${idx}.html`;
  const t0 = Date.now(); const T = {};
  let target = null, c = null;
  PAGES.set(name, job.html);
  try {
    target = await (await fetch(`${chrome.base}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(STEP_MS) })).json();
    c = await cdp(target.webSocketDebuggerUrl);
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: TIMER_TRACKER });
    await c.send('Emulation.setDeviceMetricsOverride', { width: job.W, height: job.H, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/__qa/${name}` });
    const ev = async (expr, ms) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    };
    for (let i = 0; i < 150; i++) {
      let ok = false;
      try { ok = await ev('window.__loaded >= window.__total'); } catch (e) { /* page still loading */ }
      if (ok) break;
      await sleep(200);
    }
    T.load = Date.now() - t0;
    await sleep(job.wait);
    await ev(`Promise.all([...document.querySelectorAll('iframe')].map(f => { try { return f.contentDocument.fonts.ready; } catch (e) { return null; } })).then(() => true)`);
    await c.send('Page.bringToFront');
    await ev('window.__freeze()');
    await ev('window.__settle()');
    await sleep(500);
    const shot = async () => (await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: job.W, height: job.H, scale: 1 } })).data;
    T.pre = Date.now() - t0;
    const main = await shot();
    T.shot1 = Date.now() - t0;
    fs.mkdirSync(path.dirname(path.join(OUT, job.file)), { recursive: true });
    fs.writeFileSync(path.join(OUT, job.file), Buffer.from(main, 'base64'));
    let measured = null;
    if (job.measure) {
      const collected = await ev('window.__collect()');
      await ev(`window.__hide('raw')`);
      await sleep(150);
      const raw = await shot();
      await ev(`window.__hide('shadow')`);
      await sleep(150);
      const sh = await shot();
      T.shots = Date.now() - t0;
      measured = await ev(`window.__sample(${JSON.stringify(raw)}, ${JSON.stringify(sh)}, ${JSON.stringify(collected)})`, STEP_MS * 4);
    }
    results.sheets.push({ file: job.file, w: job.W, h: job.H, group: job.group, cells: job.cells.length });
    if (measured) results.cells.push(...measured);
    console.log(`ok   ${job.file}  ${job.W}x${job.H}  cells=${job.cells.length}  ${((Date.now() - t0) / 1000).toFixed(1)}s${process.env.VQA_TIMING ? ' ' + JSON.stringify(T) : ''}`);
  } catch (e) {
    console.log(`FAIL ${job.file}: ${e.message}`);
    results.sheets.push({ file: job.file, error: e.message, group: job.group });
  } finally {
    PAGES.delete(name);
    if (c) { try { c.close(); } catch (e) { /* closed */ } }
    if (target) await fetch(`${chrome.base}/json/close/${target.id}`).catch(() => {});
  }
}

// ---- scenes: every overlay at its true OBS size on a 1920x1080 busy frame ------------------------------

function sceneHtml(theme, accent) {
  const place = {
    'follower-bar': [40, 40], 'subscriber-bar': [40, 140], 'combined-bar': [40, 240],
    'info-panel': [1560, 40], 'countdown': [700, 60], 'ticker': [580, 960], 'chat': [1440, 200]
  };
  const frames = Object.entries(place).map(([ov, [x, y]]) => {
    const o = OVERLAYS[ov];
    const url = '/' + o.file + qs(Object.assign({ onizleme: 1, stil: theme, renk: accent }, ov === 'follower-bar' || ov === 'combined-bar' ? { takipciHedefi: 2468 } : {}, ov.includes('bar') ? { yuzdeGoster: 1 } : {}));
    return `<iframe src="${esc(url)}" style="position:absolute;left:${x}px;top:${y}px;width:${o.w}px;height:${o.h}px;border:0;background:transparent" scrolling="no"></iframe>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#444}</style></head><body>
<div id="bg" style="position:absolute;inset:0"></div>${frames}
<script>window.__loaded=0;window.__total=${Object.keys(place).length};document.querySelectorAll('iframe').forEach(function(f){f.addEventListener('load',function(){window.__loaded++;});});
document.getElementById('bg').style.backgroundImage='url('+(${qaBusyTile.toString()})()+')';</script></body></html>`;
}

// ---- plan ----------------------------------------------------------------------------------------------

function buildPlan() {
  const want = (g) => !ONLY || ONLY.includes(g);
  const jobs = [];
  const themeRows = THEMES.map((t) => ({ label: t, params: { stil: t } }));
  const accentCols = ACCENTS.map(([hex, nm]) => ({ label: `${nm} ${hex}`, swatch: hex, params: { renk: hex } }));
  // Secondary groups render on fewer backgrounds to keep the run short; --bgs still narrows them further.
  const add = (spec, group, only) => { for (const bgName of BGS.filter((b) => !only || only.includes(b))) jobs.push(...planSheets(Object.assign({}, spec, { bgName, bg: BGS_ALL[bgName], group }))); };

  if (want('main')) {
    for (const ov of OVERLAY_NAMES) add({ name: ov, title: `${ov} (themes x accents)`, overlay: ov, rows: themeRows, cols: accentCols }, 'main');
  }
  // Fill levels on the subscriber bar (42 subs): 5, 25, 42 and 100 percent, and the same for the follower bar at 5 %.
  if (want('levels')) {
    const levels = [['5%', 840], ['25%', 168], ['42%', 100], ['goal reached', 42]].map(([l, g]) => ({ label: `subs ${l}`, params: { aboneHedefi: g } }));
    if (OVERLAY_NAMES.includes('subscriber-bar')) {
      add({ name: 'levels-subscriber-green', title: 'subscriber-bar fill levels, green', overlay: 'subscriber-bar', rows: themeRows, cols: levels, params: { renk: '#53fc18' } }, 'levels', ['dark', 'busy']);
      add({ name: 'levels-subscriber-violet', title: 'subscriber-bar fill levels, violet', overlay: 'subscriber-bar', rows: themeRows, cols: levels, params: { renk: '#7c3aed' } }, 'levels', ['dark']);
    }
    if (OVERLAY_NAMES.includes('follower-bar')) {
      const fl = [['5%', 24680], ['25%', 4936], ['50%', 2468], ['goal reached', 1000]].map(([l, g]) => ({ label: `followers ${l}`, params: { takipciHedefi: g } }));
      add({ name: 'levels-follower-yellow', title: 'follower-bar fill levels, yellow', overlay: 'follower-bar', rows: themeRows, cols: fl, params: { renk: '#ffd400' } }, 'levels', ['dark', 'busy']);
    }
  }
  if (want('shapes')) {
    const shapes = ['pill', 'rounded', 'square'].map((s) => ({ label: s, params: { sekil: s } }));
    for (const ov of ['subscriber-bar', 'info-panel', 'countdown', 'ticker', 'chat'].filter((o) => OVERLAY_NAMES.includes(o))) {
      add({ name: `shapes-${ov}`, title: `${ov} shapes`, overlay: ov, rows: themeRows, cols: shapes }, 'shapes', ['busy']);
    }
  }
  if (want('fonts')) {
    const fonts = ['inter', 'poppins', 'nunito', 'mono'].map((f) => ({ label: f, params: { yaziTipi: f } }));
    const ovs = OVERLAY_NAMES.filter((o) => o in OVERLAYS);
    const cols = ovs.map((o) => ({ label: o, overlay: o }));
    for (const theme of ['glass', 'minimal']) add({ name: `fonts-${theme}`, title: `all fonts, theme ${theme}`, overlay: ovs[0], rows: fonts, cols, params: { stil: theme } }, 'fonts', ['busy']);
  }
  // Wide numbers and Turkish + English labels: does the row of value / label / goal still fit?
  if (want('stress')) {
    const fonts = ['inter', 'poppins', 'nunito', 'mono'].map((f) => ({ label: f, params: { yaziTipi: f } }));
    const cols = [
      { label: 'follower goal 99,999,999', overlay: 'follower-bar', params: { takipciHedefi: 99999999 } },
      { label: 'subscriber goal 99,999,999', overlay: 'subscriber-bar', params: { aboneHedefi: 99999999 } },
      { label: 'combined goals 99,999,999', overlay: 'combined-bar', params: { takipciHedefi: 99999999, aboneHedefi: 99999999 } },
      { label: 'follower 100% (goal 1,000)', overlay: 'follower-bar', params: { takipciHedefi: 1000 } }
    ];
    for (const theme of ['glass', 'minimal', 'soft']) add({ name: `stress-${theme}`, title: `stress: wide numbers, theme ${theme}`, rows: fonts, cols, overlay: 'follower-bar', params: { stil: theme, dil: 'both', yuzdeGoster: 1 } }, 'stress', ['dark']);
  }
  if (want('cvd')) {
    for (const ov of ['follower-bar', 'subscriber-bar', 'combined-bar', 'info-panel'].filter((o) => OVERLAY_NAMES.includes(o))) {
      for (const [f, nm] of [['protan', 'protanopia'], ['deutan', 'deuteranopia'], ['tritan', 'tritanopia']]) {
        jobs.push(...planSheets({ name: `cvd-${f}-${ov}`, title: `${ov} (${nm} simulation)`, overlay: ov, rows: themeRows, cols: accentCols, bgName: 'dark', bg: BGS_ALL.dark, filter: f, filterName: nm, group: 'cvd', measure: false }));
      }
    }
  }
  return jobs;
}

// ---- reports ---------------------------------------------------------------------------------------------

function report() {
  const flat = [];
  for (const cell of results.cells) {
    const m = cell.meta;
    for (const it of cell.items) {
      flat.push({ variant: m.variant, overlay: m.overlay, theme: m.theme, accent: m.accent, bg: m.bg, row: m.row, col: m.col, el: it.sel, text: it.text, kind: it.kind, need: it.need, fs: it.fs, fw: it.fw, shadow: it.shadow, alpha: +it.a.toFixed(2), rawP5: it.raw && it.raw.p5, rawMed: it.raw && it.raw.med, shP5: it.sh && it.sh.p5, shMed: it.sh && it.sh.med });
    }
  }
  fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify(flat, null, 1));
  const fills = [];
  const issues = [];
  for (const cell of results.cells) {
    const m = cell.meta;
    for (const f of cell.fills || []) if (f.ratio !== undefined) fills.push(Object.assign({ variant: m.variant, overlay: m.overlay, theme: m.theme, accent: m.accent, bg: m.bg, row: m.row, col: m.col }, f));
    for (const i of cell.issues) issues.push(Object.assign({ variant: m.variant, overlay: m.overlay, theme: m.theme, accent: m.accent, bg: m.bg, row: m.row, col: m.col }, i));
    if (!cell.ok || !new RegExp('theme-' + m.theme + '(\\s|$)').test(cell.bodyClass)) issues.push({ variant: m.variant, overlay: m.overlay, theme: m.theme, type: 'render-sanity', bodyClass: cell.bodyClass });
    if (/MISSING/.test(cell.fonts)) issues.push({ variant: m.variant, overlay: m.overlay, theme: m.theme, type: 'font-missing', fonts: cell.fonts });
  }
  fs.writeFileSync(path.join(OUT, 'fill-track.json'), JSON.stringify(fills, null, 1));
  fs.writeFileSync(path.join(OUT, 'issues.json'), JSON.stringify(issues, null, 1));
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(results.sheets, null, 1));

  const lines = [];
  const mainRows = flat.filter((r) => r.variant === r.overlay && r.shP5 != null);
  const pad = (s, n) => String(s).padEnd(n);
  const table = (rows, title) => {
    lines.push(`\n== ${title}`);
    lines.push(`${pad('overlay', 15)}${pad('theme', 10)}${pad('accent', 9)}${pad('bg', 6)}${pad('element', 28)}${pad('text', 20)}${pad('need', 5)}${pad('p5+shadow', 10)}${pad('p5 raw', 8)}med  shadow`);
    for (const r of rows) lines.push(`${pad(r.overlay, 15)}${pad(r.theme, 10)}${pad(r.accent, 9)}${pad(r.bg, 6)}${pad(r.el, 28)}${pad(r.text, 20)}${pad(r.need, 5)}${pad(r.shP5, 10)}${pad(r.rawP5, 8)}${pad(r.shMed, 5)}${r.shadow ? 'yes' : 'no'}`);
  };
  const worstBy = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k) || r.shP5 < m.get(k).shP5) m.set(k, r); } return [...m.values()].sort((a, b) => a.shP5 - b.shP5); };
  const sel = (rows) => rows.filter((r) => r.shP5 < r.need);
  for (const bg of ['light', 'dark', 'busy']) {
    const w = worstBy(mainRows.filter((r) => r.bg === bg), (r) => `${r.overlay}|${r.theme}|${r.el}`);
    table(w.slice(0, 25), `worst contrast over ${bg} (per overlay/theme/element, worst accent; ratio = 5th percentile of pixels under the text, with text-shadow)`);
  }
  const failing = sel(mainRows);
  lines.push(`\nItems below their WCAG target (3:1 large/bold, 4.5:1 small/icon 3:1): ${failing.length} of ${mainRows.length} measured, in the main sheets`);
  const byTheme = {};
  for (const r of failing) { const k = `${r.overlay}|${r.theme}|${r.bg}`; byTheme[k] = (byTheme[k] || 0) + 1; }
  lines.push(Object.entries(byTheme).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${v}  ${k}`).join('\n'));
  const lowFill = fills.filter((f) => f.variant === f.overlay || /levels/.test(f.variant));
  lines.push('\n== fill vs surface: lowest distinctness (dE76 between mean fill and mean track colour; ratio = luminance contrast)');
  lines.push(pad('variant', 28) + pad('theme', 10) + pad('accent', 9) + pad('bg', 6) + pad('col', 14) + pad('frac', 6) + pad('ratio', 6) + pad('dE', 6) + pad('minColDE', 9) + 'protan deutan tritan');
  for (const f of lowFill.slice().sort((a, b) => a.dE - b.dE).slice(0, 25)) lines.push(pad(f.variant, 28) + pad(f.theme, 10) + pad(f.accent, 9) + pad(f.bg, 6) + pad(f.col || '', 14) + pad(f.frac, 6) + pad(f.ratio, 6) + pad(f.dE, 6) + pad(f.minColDE, 9) + `${f.dE_protan}  ${f.dE_deutan}  ${f.dE_tritan}`);
  lines.push('\n== fill vs surface under colour blindness (lowest dE in main sheets, dark bg)');
  for (const k of ['dE_protan', 'dE_deutan', 'dE_tritan']) {
    lines.push(`-- ${k}`);
    for (const f of fills.filter((x) => x.variant === x.overlay && x.bg === 'dark').sort((a, b) => a[k] - b[k]).slice(0, 8)) lines.push(`  ${pad(f.overlay, 15)}${pad(f.theme, 10)}${pad(f.accent, 9)} frac ${f.frac}  dE ${f[k]} (normal ${f.dE})`);
  }
  const iss = {};
  for (const i of issues) { const k = `${i.type}|${i.overlay}|${i.theme}|${i.variant}`; iss[k] = (iss[k] || 0) + 1; }
  lines.push('\n== layout issues (type|overlay|theme|variant : count)');
  lines.push(Object.entries(iss).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, v]) => `${v}  ${k}`).join('\n') || 'none');
  fs.writeFileSync(path.join(OUT, 'worst-contrast.txt'), lines.join('\n'));
  return lines.join('\n');
}

// ---- main ---------------------------------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  installExitHandlers();
  const server = await startServer();
  cleanups.push(() => server.close());
  const port = server.address().port;
  const chrome = await launchChrome();
  let code = 0;
  try {
    const jobs = buildPlan();
    console.log(`${jobs.length} sheets -> ${OUT}`);
    let next = 0;
    const worker = async () => { while (next < jobs.length) { const i = next++; await runJob(chrome, port, jobs[i], i); } };
    await Promise.all(Array.from({ length: Math.max(1, CONC) }, worker));

    if (!ONLY || ONLY.includes('scenes')) {
      fs.mkdirSync(path.join(OUT, 'scenes'), { recursive: true });
      for (const theme of THEMES) {
        const hex = ACCENTS[0][0];
        const name = `scene-${theme}.html`;
        PAGES.set(name, sceneHtml(theme, hex));
        let target = null, c = null;
        try {
          target = await (await fetch(`${chrome.base}/json/new?about:blank`, { method: 'PUT', signal: AbortSignal.timeout(STEP_MS) })).json();
          c = await cdp(target.webSocketDebuggerUrl);
          await c.send('Page.enable');
          await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
          await c.send('Page.navigate', { url: `http://127.0.0.1:${port}/__qa/${name}` });
          await sleep(1500 + 12500 + EXTRA_WAIT);
          const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
          fs.writeFileSync(path.join(OUT, 'scenes', `scene-${theme}.png`), Buffer.from(shot.data, 'base64'));
          results.sheets.push({ file: `scenes/scene-${theme}.png`, w: 1920, h: 1080, group: 'scenes' });
          console.log(`ok   scenes/scene-${theme}.png`);
        } catch (e) {
          console.log(`FAIL scene ${theme}: ${e.message}`);
          results.sheets.push({ file: `scenes/scene-${theme}.png`, error: e.message, group: 'scenes' });
        } finally {
          if (c) { try { c.close(); } catch (e) { /* closed */ } }
          if (target) await fetch(`${chrome.base}/json/close/${target.id}`).catch(() => {});
        }
      }
    }
    const text = report();
    const failed = results.sheets.filter((s) => s.error).length;
    fs.writeFileSync(path.join(OUT, 'summary.txt'), `${results.sheets.length} sheets (${failed} failed)\n` + text);
    console.log(`\n${results.sheets.length} sheets, ${failed} failed. See worst-contrast.txt, contrast.json, fill-track.json, issues.json`);
    if (failed) {
      console.log('failed:\n  ' + results.sheets.filter((s) => s.error).map((s) => `${s.file}: ${s.error}`).join('\n  '));
      code = 1;
    }
  } finally {
    runCleanups();
  }
  process.exit(code);
}

main().catch((e) => { console.error('visual-qa aborted:', e.message); runCleanups(); process.exit(2); });
