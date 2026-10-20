/*!
 * Kick Overlay Pack — shared core.
 *
 * A classic script (not an ES module) so it works from file:// in OBS.
 * It does no DOM work at load time, so it also runs under Node for tests.
 * Exposes window.KickOverlay.
 */
(function (global) {
  'use strict';

  var ENUMS = {
    stil: ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'],
    sekil: ['pill', 'rounded', 'square'],
    yaziTipi: ['inter', 'poppins', 'nunito', 'mono'],
    dil: ['tr', 'en', 'both'],
    animasyon: ['normal', 'low', 'off']
  };

  // Public settings. Anything here may be overridden by AYARLAR.local.js or a URL parameter.
  var SCHEMA = {
    kanal:             { t: 'str', d: '', max: 40 },
    stil:              { t: 'enum', key: 'stil', d: 'glass' },
    sekil:             { t: 'enum', key: 'sekil', d: 'pill' },
    yaziTipi:          { t: 'enum', key: 'yaziTipi', d: 'inter' },
    dil:               { t: 'enum', key: 'dil', d: 'both' },
    animasyon:         { t: 'enum', key: 'animasyon', d: 'normal' },
    renk:              { t: 'hex', d: '#53fc18' },
    yayinciYazisi:     { t: 'str', d: 'Streamer', max: 24 },
    takipciHedefi:     { t: 'int', d: 1000, min: 1, max: 100000000 },
    takipciYedek:      { t: 'int', d: 0, min: 0, max: 100000000 },
    aboneHedefi:       { t: 'int', d: 100, min: 1, max: 100000000 },
    aboneSayisi:       { t: 'int', d: 0, min: 0, max: 100000000 },
    oturumFarkiGoster: { t: 'bool', d: true },
    yuzdeGoster:       { t: 'bool', d: false },
    yenilemeSn:        { t: 'int', d: 30, min: 10, max: 600 },
    sohbetMaksMesaj:   { t: 'int', d: 8, min: 3, max: 20 },
    geriSayimDk:       { t: 'int', d: 5, min: 1, max: 720 },
    geriSayimBaslik:   { t: 'str', d: '', max: 60 },
    duyuruMetinleri:   { t: 'str', d: '', max: 400 },
    duyuruSn:          { t: 'int', d: 6, min: 3, max: 60 },
    geriSayimSaat:     { t: 'clock', d: '' },
    sohbetKomutGizle:  { t: 'bool', d: false },
    sohbetGizliKullanicilar: { t: 'str', d: '', max: 300 },
    sohbetSilinmeSn:   { t: 'int', d: 0, min: 0, max: 600 },
    hataNotu:          { t: 'bool', d: true },
    hedefKutlama:      { t: 'bool', d: true }
  };

  // Local-only keys. Never read from the URL, so secrets never end up in a URL.
  var LOCAL_SCHEMA = {
    kickClientId:     { t: 'str', d: '', max: 200 },
    kickClientSecret: { t: 'str', d: '', max: 400 },
    apiBase:          { t: 'url', d: 'https://api.kick.com' },
    tokenBase:        { t: 'url', d: 'https://id.kick.com' },
    relayAdresi:      { t: 'url', d: 'http://127.0.0.1:8790' }
  };

  var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  // https anywhere, or plain http only for loopback (local mock servers and tests).
  var CLOCK_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  var URL_RE = /^(https:\/\/\S+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?)$/i;

  function asStr(v, d, max) {
    if (typeof v !== 'string') return d;
    var s = v.trim();
    return s.length > max ? s.slice(0, max) : s;
  }
  function asEnum(v, list, d) {
    var s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return list.indexOf(s) >= 0 ? s : d;
  }
  function asHex(v, d) {
    return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : d;
  }
  function asInt(v, min, max, d) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !isFinite(n)) return d;
    n = Math.round(n);
    return Math.min(max, Math.max(min, n));
  }
  function asBool(v, d) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    if (typeof v !== 'string') return d;
    var s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return d;
  }
  // "HH:MM" 24h, zero-padded; anything else falls back (an empty default means "not set").
  function asClock(v, d) {
    var m = typeof v === 'string' ? CLOCK_RE.exec(v.trim()) : null;
    return m ? (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2] : d;
  }
  // Accepts a bare slug, @slug or a pasted kick.com link; keeps the first path segment.
  function cleanChannel(v) {
    if (typeof v !== 'string') return '';
    var t = v.trim().replace(/^(?:https?:\/\/)?(?:www\.)?kick\.com\//i, '').replace(/^@/, '');
    return t.split(/[\/?#\s]/)[0].replace(/^@/, '').toLowerCase().slice(0, 40);
  }
  function asUrl(v, d) {
    return typeof v === 'string' && URL_RE.test(v.trim()) ? v.trim().replace(/\/+$/, '') : d;
  }

  function coerce(spec, v) {
    switch (spec.t) {
      case 'str': return asStr(v, spec.d, spec.max || 200);
      case 'enum': return asEnum(v, ENUMS[spec.key], spec.d);
      case 'hex': return asHex(v, spec.d);
      case 'int': return asInt(v, spec.min, spec.max, spec.d);
      case 'bool': return asBool(v, spec.d);
      case 'clock': return asClock(v, spec.d);
      case 'url': return asUrl(v, spec.d);
    }
    return spec.d;
  }

  // Normalizes raw values against the schema. Unknown or invalid values fall back to defaults.
  function normalize(raw) {
    raw = raw || {};
    var out = {};
    Object.keys(SCHEMA).forEach(function (k) {
      out[k] = coerce(SCHEMA[k], k === 'kanal' ? cleanChannel(raw[k]) : raw[k]);
    });
    return out;
  }

  function normalizeLocal(raw) {
    raw = raw || {};
    var out = {};
    Object.keys(LOCAL_SCHEMA).forEach(function (k) {
      var spec = LOCAL_SCHEMA[k];
      out[k] = coerce(spec, raw[k]);
    });
    return out;
  }


  function urlOverrides(search) {
    var out = {};
    if (!search || typeof URLSearchParams === 'undefined') return out;
    var params = new URLSearchParams(search);
    Object.keys(SCHEMA).forEach(function (k) {
      if (params.has(k)) out[k] = params.get(k);
    });
    return out;
  }

  // Precedence: defaults < AYARLAR.js < AYARLAR.local.js < URL parameters (public keys only).
  function readSettings() {
    var file = global.KICK_OVERLAY_AYARLAR || {};
    var local = global.KICK_OVERLAY_YEREL || {};
    var search = global.location ? global.location.search : '';
    var pub = Object.assign({}, file, local, urlOverrides(search));
    var secrets = normalizeLocal(Object.assign({}, file, local));
    // AYARLAR.js is shared and published; app credentials are honored only from the git-ignored AYARLAR.local.js.
    secrets.kickClientId = coerce(LOCAL_SCHEMA.kickClientId, local.kickClientId);
    secrets.kickClientSecret = coerce(LOCAL_SCHEMA.kickClientSecret, local.kickClientSecret);
    return Object.freeze(Object.assign({}, normalize(pub), secrets));
  }

  function hasCredentials(s) {
    return !!(s.kickClientId && s.kickClientSecret);
  }

  // Preview mode (?onizleme=1) shows sample numbers without any network call.
  // Used by the studio and the README. Never affects a live OBS source.
  function isPreview() {
    return !!(global.location && /(?:^|[?&])onizleme=1(?:&|$)/.test(global.location.search));
  }

  // ?debug=1 shows the small diagnostics box (K.debug) and keeps error notes visible.
  function isDebug() {
    return !!(global.location && /(?:^|[?&])debug=1(?:&|$)/.test(global.location.search));
  }

  var SAMPLE = {
    followers: 1234,
    subs: 42,
    delta: 3,
    viewers: 2048,
    startMs: 3723000
  };

  // Splits the announcement setting (lines separated by |) into at most 12 trimmed, non-empty lines.
  function splitLines(v) {
    return String(v || '').split('|').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 12);
  }

  // ---- Labels, numbers, look ---------------------------------------------

  function label(s, tr, en) {
    if (s.dil === 'tr') return tr;
    if (s.dil === 'en') return en;
    return tr + ' / ' + en;
  }

  // Thousands separators follow the label language: 1.234 for tr, 1,234 otherwise. applyLook() sets it.
  var numLocale = 'en-US';

  var fmtCache = {};
  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    if (typeof Intl === 'undefined') return v.toLocaleString(numLocale);
    var f = fmtCache[numLocale] || (fmtCache[numLocale] = new Intl.NumberFormat(numLocale));
    return f.format(v);
  }

  function pct(current, goal) {
    if (!(goal > 0)) return 0;
    return Math.max(0, Math.min(100, (Number(current) / goal) * 100));
  }

  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function relLum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var CHIP_DARK = '#0b0b0d', CHIP_DARK_LUM = relLum([11, 11, 13]);

  function chipText(rgb) {
    var l = relLum(rgb);
    var dark = (l + 0.05) / (CHIP_DARK_LUM + 0.05), light = 1.05 / (l + 0.05);
    return dark >= light ? CHIP_DARK : '#ffffff';
  }

  function applyLook(s, el) {
    el = el || global.document.body;
    var keep = el.className.split(/\s+/).filter(function (c) {
      return c && !/^(theme|shape|font|motion)-/.test(c);
    });
    el.className = keep.concat(
      'theme-' + s.stil,
      'shape-' + s.sekil,
      'font-' + s.yaziTipi,
      'motion-' + s.animasyon
    ).join(' ');
    var root = global.document.documentElement;
    // Lets the browser apply the right language rules (hyphenation, screen readers). "both" stays English.
    root.lang = s.dil === 'tr' ? 'tr' : 'en';
    numLocale = s.dil === 'tr' ? 'tr-TR' : 'en-US';
    var rgb = hexToRgb(s.renk);
    root.style.setProperty('--accent', s.renk);
    root.style.setProperty('--accent-rgb', rgb.join(' '));
    // Chip text is whichever of near-black or white contrasts more with the accent; computed here
    // because CSS relative colours are not available in older OBS browsers.
    var ct = chipText(rgb), cbg = rgb;
    // White chip text on a mid-tone accent (e.g. #e11d48) only reaches ~4.7:1; darken the pill until it clears 6:1.
    if (ct === '#ffffff') {
      for (var i = 0; i < 20 && 1.05 / (relLum(cbg) + 0.05) < 6; i++) {
        cbg = cbg.map(function (v) { return Math.round(v * 0.94); });
      }
    }
    root.style.setProperty('--chip-bg', s.renk);
    root.style.setProperty('--chip-fill', cbg === rgb ? s.renk : 'rgb(' + cbg.join(' ') + ')');
    root.style.setProperty('--chip-text', ct);
  }

  function reducedMotion() {
    var g = global;
    return !!(typeof g.matchMedia === 'function' && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Eases a number from `from` to `to`. Returns a cancel function. Duration 0 (or the OS reduced-motion
  // setting) jumps straight to the end. onDone runs after the last frame, and not after a cancel.
  function tween(from, to, ms, onFrame, onDone) {
    if (!ms || reducedMotion()) {
      onFrame(to);
      if (onDone) onDone();
      return function () {};
    }
    var start = global.performance.now(), id = null, stopped = false;
    function step(now) {
      if (stopped) return;
      var p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
      onFrame(from + (to - from) * e);
      if (p < 1) id = global.requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    id = global.requestAnimationFrame(step);
    return function cancel() { stopped = true; global.cancelAnimationFrame(id); };
  }

  // Drives the bar through a CSS variable; the stylesheet scales the fill with transform, so no layout work per frame.
  function setFill(el, p) {
    if (!el || !el.style) return;
    var n = Math.max(0, Math.min(100, Number(p) || 0));
    el.style.setProperty('--fill', (n / 100).toFixed(4));
  }

  var FONT_URLS = {
    inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
    // Poppins has no tabular digits, so the counting numerals use Inter (see themes.css).
    poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Inter:wght@600..900&display=swap',
    nunito: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
    mono: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap'
  };

  // Loads only the chosen family (poppins also gets Inter for its numerals) instead of all four. Safe to call again with other settings.
  function loadFont(s) {
    var d = global.document;
    if (!d || !d.head || typeof d.createElement !== 'function') return null;
    var link = typeof d.getElementById === 'function' ? d.getElementById('ko-font') : null;
    if (!link) {
      link = d.createElement('link');
      link.id = 'ko-font';
      link.rel = 'stylesheet';
      d.head.appendChild(link);
    }
    link.href = FONT_URLS[s && s.yaziTipi] || FONT_URLS.inter;
    return link;
  }

  // Short UI strings shared by every overlay, in the viewer-chosen language.
  function text(s) {
    return {
      hint: label(s, '⚙ AYARLAR.js → kanal ayarla', '⚙ Set kanal in AYARLAR.js'),
      auth: label(s, 'Kick uygulama bilgisi hatalı', 'Kick app credentials rejected'),
      rate: label(s, 'Kick istek sınırı, son değer', 'Kick rate limit, showing last value'),
      error: label(s, 'Kick yanıt vermedi, son değer', 'Kick error, showing last value'),
      noData: label(s, 'Abone verisi yok', 'No subscriber data'),
      unreachable: label(s, "Kick'e ulaşılamıyor", 'Kick unreachable'),
      stale: label(s, 'Veri güncel olmayabilir', 'Data may be out of date'),
      relayDown: label(s, 'Sohbet köprüsü çalışmıyor', 'Chat relay not running')
    };
  }

  // Sets the note text and shows or hides it. hataNotu=false silences it unless ?debug=1.
  function note(el, s, t) {
    if (!el) return;
    var msg = t || '';
    el.textContent = msg;
    var off = !!s && s.hataNotu === false && !isDebug();
    el.classList.toggle('is-hidden', !msg || off);
  }

  var debugState = {}, debugEl = null;
  // Fixed bottom-left box of key: value lines. Merges into earlier calls; undefined/null removes a key.
  function debug(info) {
    if (!isDebug()) return;
    var d = global.document;
    if (!d || !d.body || typeof d.createElement !== 'function') return;
    Object.keys(info || {}).forEach(function (k) {
      if (info[k] === undefined || info[k] === null) delete debugState[k];
      else debugState[k] = info[k];
    });
    if (!debugEl) {
      debugEl = typeof d.querySelector === 'function' ? d.querySelector('.ko-debug') : null;
      if (!debugEl) {
        debugEl = d.createElement('div');
        debugEl.className = 'ko-debug';
        d.body.appendChild(debugEl);
      }
    }
    debugEl.style.whiteSpace = 'pre';
    debugEl.textContent = Object.keys(debugState).map(function (k) { return k + ': ' + debugState[k]; }).join('\n');
  }

  var FILL_MS = 1200;

  // Bar + value + chips in one place: fill, count-up, bump, percent, session delta, milestones, goal state.
  // els = { bar, fill, val, pct, delta }; pct and delta may be null.
  function createGoalBar(els, goal, s) {
    els = els || {};
    s = s || {};
    var shown = 0, last = null, lastPct = 0, cancel = null, valNode = null, valText = null;
    function restart(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    // A one-off class: removed again after ms so no animation or compositor layer is left behind.
    function once(el, cls, ms, slot) {
      restart(el, cls);
      if (slot.t) clearTimeout(slot.t);
      slot.t = setTimeout(function () { slot.t = null; el.classList.remove(cls); }, ms);
    }
    var slots = { milestone: {}, pulse: {}, shine: {} };
    // Writes into the existing Text node, and only when the formatted string changed.
    function writeVal(v) {
      var t = fmt(v);
      if (t === valText) return;
      valText = t;
      if (!valNode || valNode.parentNode !== els.val) {
        els.val.textContent = t;
        valNode = els.val.firstChild && els.val.firstChild.nodeType === 3 ? els.val.firstChild : null;
      } else {
        valNode.nodeValue = t;
      }
    }
    function setText(el, t) {
      if (el.textContent !== t) el.textContent = t;
    }
    function reachGoal(pulse) {
      els.bar.classList.add('is-goal');
      if (pulse) once(els.bar, 'ko-goal-pulse', 1100, slots.pulse);
    }
    function set(total, delta) {
      total = Number(total) || 0;
      var p = pct(total, goal);
      var increased = last !== null && total > last;
      var crossed = !!els.bar && !!s.hedefKutlama && last !== null &&
        [25, 50, 75].some(function (m) { return lastPct < m && p >= m; });
      var wantGoal = !!els.bar && !!s.hedefKutlama && goal > 0 && total >= goal;
      // The first value is a page load, not an event, so it gets the goal state without the pulse.
      var pulse = last !== null && !(els.bar && els.bar.classList.contains('is-goal'));
      setFill(els.fill, p);
      if (cancel) cancel();
      var instant = s.animasyon === 'off' || s.animasyon === 'low';
      var finish = function () {
        cancel = null;
        if (wantGoal) reachGoal(pulse);
      };
      if (els.val && shown !== total) {
        cancel = tween(shown, total, instant ? 0 : FILL_MS, function (v) {
          shown = v;
          writeVal(v);
        }, finish);
      } else {
        shown = total;
        if (els.val) writeVal(total);
        finish();
      }
      if (els.bar) {
        // A milestone is its own flourish, so it replaces the bump instead of stacking on it.
        if (crossed) {
          els.bar.classList.remove('ko-bump');
          once(els.bar, 'ko-milestone', 1200, slots.milestone);
        } else if (increased) {
          restart(els.bar, 'ko-bump');
        }
        // Goal state waits for the count-up to finish; leaving it is immediate.
        if (!wantGoal) els.bar.classList.remove('is-goal');
      }
      if (increased && els.fill && !instant) once(els.fill, 'ko-shine', 1500, slots.shine);
      if (els.pct) {
        els.pct.hidden = !s.yuzdeGoster;
        if (s.yuzdeGoster) setText(els.pct, Math.round(p) + '%');
      }
      if (els.delta) {
        var d = Number(delta) || 0, showDelta = !!s.oturumFarkiGoster && d !== 0;
        els.delta.hidden = !showDelta;
        if (showDelta) {
          setText(els.delta, (d > 0 ? '+' : '-') + fmt(Math.abs(d)));
          els.delta.classList.toggle('is-neg', d < 0);
        }
      }
      last = total;
      lastPct = p;
    }
    function destroy() {
      if (cancel) cancel();
      [slots.milestone, slots.pulse, slots.shine].forEach(function (sl) { if (sl.t) clearTimeout(sl.t); sl.t = null; });
      cancel = null;
    }
    return { set: set, destroy: destroy };
  }

  // Runs fn on a timer without overlapping runs. fn resolves { ok, retryAfterMs? }.
  // Failures back off exponentially; hidden pages pause and resume with an immediate run.
  function poller(fn, o) {
    o = o || {};
    var interval = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : 30000;
    var jitter = o.jitter === undefined ? 0.1 : Math.max(0, Number(o.jitter) || 0);
    var maxBackoff = Number(o.maxBackoffMs) > 0 ? Number(o.maxBackoffMs) : 300000;
    var timer = null, active = false, inflight = null, failures = 0, nextAt = 0, listening = false;

    function hidden() { var d = global.document; return !!(d && d.hidden); }
    function spread(ms) { return jitter ? ms * (1 + (Math.random() * 2 - 1) * jitter) : ms; }
    function clear() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      nextAt = 0;
    }
    function arm(ms) {
      clear();
      if (!active || hidden()) return;
      ms = Math.max(0, Math.round(ms));
      nextAt = Date.now() + ms;
      timer = setTimeout(function () { timer = null; nextAt = 0; run(); }, ms);
    }
    function run() {
      if (!active) return Promise.resolve();
      if (inflight) return inflight;
      if (hidden()) return Promise.resolve();
      clear();
      inflight = (async function () {
        var r;
        // Promise.then so a synchronous throw from fn lands in the catch too.
        try { r = await Promise.resolve().then(fn); } catch (e) { r = null; }
        inflight = null;
        if (!active) return;
        var delay;
        if (r && r.ok) {
          failures = 0;
          delay = spread(interval);
        } else {
          failures += 1;
          delay = Math.min(maxBackoff, spread(interval * Math.pow(2, failures)));
          var ra = r ? Number(r.retryAfterMs) : 0;
          if (ra > delay) delay = ra;
        }
        arm(delay);
      })();
      return inflight;
    }
    function onVisible() { if (active && !hidden()) run(); }

    return {
      start: function () {
        if (active) return;
        active = true;
        failures = 0;
        var d = global.document;
        if (d && typeof d.addEventListener === 'function') { d.addEventListener('visibilitychange', onVisible); listening = true; }
        run();
      },
      stop: function () {
        active = false;
        clear();
        var d = global.document;
        if (listening && d && typeof d.removeEventListener === 'function') d.removeEventListener('visibilitychange', onVisible);
        listening = false;
      },
      now: function () { return run(); },
      nextInMs: function () { return nextAt ? Math.max(0, nextAt - Date.now()) : null; }
    };
  }

  // ---- HTTP ----------------------------------------------------------------

  function headerOf(res, name) {
    try { return res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null; } catch (e) { return null; }
  }

  // Retry-After in seconds. The HTTP-date form is ignored.
  function retryAfterOf(res) {
    var v = headerOf(res, 'Retry-After');
    var n = v === null || v === undefined || String(v).trim() === '' ? NaN : Number(v);
    return isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
  }

  // Never throws. Returns {ok, status, data, source?} or {ok:false, status, error, retryAfterMs?}.
  async function getJson(url, opts) {
    opts = opts || {};
    var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { ac.abort(); }, opts.timeoutMs || 10000) : null;
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    try {
      var res = await fetch(url, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body,
        cache: 'no-store',
        signal: ac ? ac.signal : undefined
      });
      if (!res.ok) {
        var fail = { ok: false, status: res.status, error: 'http' };
        var ra = retryAfterOf(res);
        if (ra !== null) fail.retryAfterMs = ra;
        return fail;
      }
      var data;
      try { data = await res.json(); } catch (e) { return { ok: false, status: res.status, error: 'body' }; }
      if (!data || typeof data !== 'object') return { ok: false, status: res.status, error: 'body' };
      var out = { ok: true, status: res.status, data: data };
      var src = headerOf(res, 'X-Kick-Source');
      if (src) out.source = String(src).toLowerCase();
      return out;
    } catch (e) {
      return { ok: false, status: 0, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---- Parsers (pure) --------------------------------------------------------

  function numOrNull(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }

  function parseTime(v) {
    if (typeof v !== 'string' || !v) return null;
    var st = v.replace(' ', 'T');
    var hasZone = /Z$|[+\-]\d\d:?\d\d$/.test(st);
    var ms = Date.parse(hasZone ? st : st + 'Z');
    return isNaN(ms) ? null : ms;
  }

  // Kick v2 returns followers_count as a numeric string; v1 returns followersCount as a number.
  function parseFollowers(d) {
    if (!d) return null;
    var list = [d.followers_count, d.followersCount, d.followers];
    for (var i = 0; i < list.length; i++) {
      var n = numOrNull(list[i]);
      if (n !== null) return n;
    }
    return null;
  }

  function parseLive(d) {
    var ls = d && d.livestream;
    if (!ls || ls.is_live === false) return { live: false, viewers: 0, startMs: null };
    return {
      live: true,
      viewers: numOrNull(ls.viewer_count) || 0,
      startMs: parseTime(ls.start_time || ls.created_at || '')
    };
  }

  function parseSubBadges(d) {
    var list = d && Array.isArray(d.subscriber_badges) ? d.subscriber_badges : [];
    return list
      .map(function (b) {
        return { months: numOrNull(b && b.months) || 0, src: (b && b.badge_image && b.badge_image.src) || '' };
      })
      .filter(function (b) { return b.src; })
      .sort(function (a, b) { return b.months - a.months; });
  }

  // Parses the official GET /public/v1/channels response (documented schema).
  function parseOfficialChannel(body) {
    var arr = body && Array.isArray(body.data) ? body.data : [];
    var ch = arr[0];
    if (!ch || typeof ch !== 'object') return null;
    var st = ch.stream || {};
    return {
      subs: numOrNull(ch.active_subscribers_count),
      gifted: numOrNull(ch.active_gifted_subscribers_count),
      canceled: numOrNull(ch.canceled_subscribers_count),
      live: typeof st.is_live === 'boolean' ? st.is_live : null,
      viewers: numOrNull(st.viewer_count),
      startMs: parseTime(st.start_time),
      title: typeof ch.stream_title === 'string' ? ch.stream_title : ''
    };
  }


  // ---- Kick REST (public, no token) ----------------------------------------

  var RELAY_RETRY_MS = 5 * 60 * 1000;
  var relayMemo = {};

  // Asks the local relay what it can do. Memoized per page; a failed probe is retried at most every 5 minutes.
  function relayInfo(s) {
    var base = s && s.relayAdresi;
    if (!base) return Promise.resolve(null);
    var m = relayMemo[base];
    if (m) {
      if (m.promise) return m.promise;
      if (Date.now() - m.failedAt < RELAY_RETRY_MS) return Promise.resolve(null);
    }
    m = relayMemo[base] = { promise: null, failedAt: 0 };
    var p = getJson(base + '/health', { timeoutMs: 1500 }).then(function (r) {
      var info = r.ok && r.data.ok !== false ? r.data : null;
      if (!info) { m.promise = null; m.failedAt = Date.now(); }
      return info;
    });
    m.promise = p;
    return p;
  }

  function limited(status) { return status === 403 || status === 429; }

  // Relay first when it offers /channel, then Kick directly: v2, and v1 only for 404, 5xx or network trouble.
  // A 403/429 stops at once (another request would only deepen the block) and carries retryAfterMs.
  async function kickChannel(slug, s) {
    var enc = encodeURIComponent(slug);
    if (s) {
      var info = await relayInfo(s);
      if (info && info.features && info.features.channel) {
        var rr = await getJson(s.relayAdresi + '/channel?slug=' + enc);
        if (rr.ok) return { ok: true, data: rr.data, src: rr.source === 'v1' ? 'relay-v1' : 'relay-v2', status: rr.status };
        if (rr.status === 429) {
          return { ok: false, error: rr.error, status: 429, src: 'relay-v2', retryAfterMs: rr.retryAfterMs || 60000 };
        }
      }
    }
    var v2 = await getJson('https://kick.com/api/v2/channels/' + enc);
    if (v2.ok) return { ok: true, data: v2.data, src: 'v2', status: v2.status };
    if (limited(v2.status)) {
      return { ok: false, error: v2.error, status: v2.status, src: 'v2', retryAfterMs: v2.retryAfterMs || 60000 };
    }
    var v1 = await getJson('https://kick.com/api/v1/channels/' + enc);
    if (v1.ok) return { ok: true, data: v1.data, src: 'v1', status: v1.status };
    var res = { ok: false, error: v2.error || v1.error, status: v1.status, src: 'v1' };
    if (limited(v1.status)) res.retryAfterMs = v1.retryAfterMs || 60000;
    return res;
  }

  // ---- Official API (token required) ---------------------------------------

  var tokenCache = { value: null, expiresAt: 0 };

  function clearToken() { tokenCache = { value: null, expiresAt: 0 }; }

  // Client credentials grant. The secret goes in the form body, never in a URL. Never logged.
  async function appToken(s) {
    if (!hasCredentials(s)) return { ok: false, error: 'no-credentials' };
    if (tokenCache.value && Date.now() < tokenCache.expiresAt) return { ok: true, token: tokenCache.value };
    var form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: s.kickClientId,
      client_secret: s.kickClientSecret
    });
    var r = await getJson(s.tokenBase + '/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
    if (!r.ok || typeof r.data.access_token !== 'string') {
      return { ok: false, status: r.status, error: r.error || 'token' };
    }
    // expires_in is in seconds per RFC 6749; the docs do not state a unit. Fall back to 10 min.
    var ttl = Number(r.data.expires_in);
    if (!isFinite(ttl) || ttl <= 120) ttl = 600;
    tokenCache = { value: r.data.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
    return { ok: true, token: tokenCache.value };
  }

  async function officialChannel(s, token) {
    var r = await getJson(s.apiBase + '/public/v1/channels?slug=' + encodeURIComponent(s.kanal), {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return { ok: false, status: r.status, error: r.error, retryAfterMs: r.retryAfterMs };
    // An empty data array is a valid answer: the channel has no subscriber figures to show.
    var parsed = parseOfficialChannel(r.data) || { subs: null, gifted: null, canceled: null, live: null, viewers: null, startMs: null, title: '' };
    return Object.assign({ ok: true, status: r.status }, parsed);
  }

  var BASE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

  // Subscriber source for the subscriber and combined bars. The mode is decided on each poll:
  //   relay:  the local relay holds the Kick app credentials (relayInfo says so).
  //   token:  official active_subscribers_count with credentials in this page.
  //   manual: aboneSayisi from AYARLAR.js, no Kick request.
  // The session delta counts from a baseline kept in localStorage for 12 hours, so an OBS
  // scene switch or page reload does not reset "+N".
  function createSubscriberSource(s) {
    var base = null, total = null, mode = hasCredentials(s) ? 'token' : 'manual';
    var api = { mode: mode };
    var key = 'ko:subBase:' + s.kanal;

    function setMode(m) { mode = m; api.mode = m; }

    // First value of this page load: reuse a fresh stored baseline, otherwise start one.
    function startBase(t) {
      var now = Date.now();
      try {
        var ls = global.localStorage;
        if (!ls) return t;
        var o = null;
        try { o = JSON.parse(ls.getItem(key)); } catch (e) { /* corrupt entry: replaced below */ }
        if (o && typeof o.base === 'number' && isFinite(o.base) && typeof o.at === 'number' &&
            now - o.at >= 0 && now - o.at < BASE_MAX_AGE_MS) return o.base;
        ls.setItem(key, JSON.stringify({ base: t, at: now }));
      } catch (e) { /* storage blocked: the baseline lives for this page load only */ }
      return t;
    }

    function state(status, t, extra) {
      if (t !== null && t !== undefined) {
        total = t;
        if (base === null) base = mode === 'manual' ? t : startBase(t);
      }
      var out = {
        mode: mode,
        status: status,
        total: total,
        delta: total !== null && base !== null ? total - base : 0
      };
      return extra ? Object.assign(out, extra) : out;
    }

    // Returns null when the relay is unreachable and this page has credentials of its own.
    async function relayPoll() {
      var r = await getJson(s.relayAdresi + '/subscribers?slug=' + encodeURIComponent(s.kanal));
      if (r.ok) {
        var subs = numOrNull(r.data.subs);
        return subs === null ? state('no-data', total) : state('ok', subs);
      }
      if (r.status === 0 && hasCredentials(s)) return null;
      if (r.status === 503) return state('no-credentials', total);
      if (r.status === 401 || r.status === 403) return state('auth', total);
      if (r.status === 429) return state('rate', total, { retryAfterMs: r.retryAfterMs || 60000 });
      return state('error', total);
    }

    async function tokenPoll() {
      var t = await appToken(s);
      if (!t.ok) {
        if (t.error === 'no-credentials') return state('no-credentials', total);
        // Only a rejected login is "wrong credentials"; a network or server failure is not.
        return state(t.status === 400 || t.status === 401 || t.status === 403 ? 'auth' : 'error', total);
      }
      var o = await officialChannel(s, t.token);
      if (!o.ok) {
        if (o.status === 401 || o.status === 403) { clearToken(); return state('auth', total); }
        if (o.status === 429) return state('rate', total, { retryAfterMs: o.retryAfterMs || 60000 });
        return state('error', total);
      }
      if (o.subs === null) return state('no-data', total);
      return state('ok', o.subs);
    }

    api.poll = async function () {
      var viaRelay = false;
      if (s.kanal) {
        var info = await relayInfo(s);
        viaRelay = !!(info && info.features && info.features.subscribers);
      }
      setMode(viaRelay ? 'relay' : hasCredentials(s) ? 'token' : 'manual');
      if (mode === 'manual') return state('manual', s.aboneSayisi);
      if (!s.kanal) return state('no-channel', total);
      if (mode === 'relay') {
        var rr = await relayPoll();
        if (rr) return rr;
        setMode('token');
      }
      return tokenPoll();
    };
    return api;
  }

  // ---- Live chat from the local relay (relay/server.js). ----

  var ES_CLOSED = 2;

  // Server-Sent Events: the relay sends "chat" and "ban" frames already in the overlay's shape.
  // h = { onMessage(event), onStatus(status) }. Status: 'connecting', 'open', 'reconnecting'.
  // A browser retries a dropped stream by itself, but gives up for good after some failures
  // (readyState CLOSED); then we reopen it ourselves with backoff: 1 s, 2 s, ... up to 30 s.
  function connectRelay(url, h) {
    var es = null, timer = null, stopped = false, attempt = 0;
    function status(st) { if (h.onStatus) h.onStatus(st); }
    function attach(src) {
      function forward(name) {
        src.addEventListener(name, function (e) {
          var ev; try { ev = JSON.parse(e.data); } catch (err) { return; }
          if (ev && typeof ev === 'object') { ev.kind = name; if (h.onMessage) h.onMessage(ev); }
        });
      }
      forward('chat');
      forward('ban');
      src.onopen = function () { attempt = 0; status('open'); };
      src.onerror = function () {
        status('reconnecting');
        if (src.readyState === ES_CLOSED && !stopped) {
          src.close();
          retry();
        }
      };
    }
    function retry() {
      if (timer !== null) return;
      var delay = Math.min(30000, 1000 * Math.pow(2, attempt)) * (1 + (Math.random() * 2 - 1) * 0.2);
      attempt += 1;
      timer = setTimeout(function () { timer = null; reopen(); }, Math.min(30000, Math.round(delay)));
    }
    function reopen() {
      if (stopped) return;
      try { es = new global.EventSource(url); } catch (e) { retry(); return; }
      attach(es);
    }
    status('connecting');
    es = new global.EventSource(url);
    attach(es);
    return function stop() {
      stopped = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (es) es.close();
    };
  }

  // Schema-level assertion helper for tests and the studio.
  function enumsOf(name) { return ENUMS[name] ? ENUMS[name].slice() : null; }
  function schemaKeys() { return Object.keys(SCHEMA); }

  global.KickOverlay = {
    version: '2.3.3',
    enums: enumsOf,
    schemaKeys: schemaKeys,
    normalize: normalize,
    normalizeLocal: normalizeLocal,
    readSettings: readSettings,
    isPreview: isPreview,
    isDebug: isDebug,
    sample: SAMPLE,
    splitLines: splitLines,
    label: label,
    fmt: fmt,
    pct: pct,
    applyLook: applyLook,
    tween: tween,
    setFill: setFill,
    poller: poller,
    loadFont: loadFont,
    text: text,
    note: note,
    debug: debug,
    createGoalBar: createGoalBar,
    getJson: getJson,
    parse: {
      followers: parseFollowers,
      live: parseLive,
      subBadges: parseSubBadges,
      official: parseOfficialChannel,
      time: parseTime
    },
    relayInfo: relayInfo,
    kick: { channel: kickChannel },
    official: { token: appToken, channel: officialChannel, clearToken: clearToken },
    createSubscriberSource: createSubscriberSource,
    connectRelay: connectRelay
  };
})(typeof window !== 'undefined' ? window : globalThis);
