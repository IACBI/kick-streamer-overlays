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
    duyuruSn:          { t: 'int', d: 6, min: 3, max: 60 }
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
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
    return d;
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
      case 'url': return asUrl(v, spec.d);
    }
    return spec.d;
  }

  // Normalizes raw values against the schema. Unknown or invalid values fall back to defaults.
  function normalize(raw) {
    raw = raw || {};
    var out = {};
    Object.keys(SCHEMA).forEach(function (k) {
      out[k] = coerce(SCHEMA[k], raw[k]);
    });
    if (out.kanal) out.kanal = out.kanal.toLowerCase();
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

  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString('en-US');
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
    root.style.setProperty('--accent', s.renk);
    root.style.setProperty('--accent-rgb', hexToRgb(s.renk).join(' '));
  }

  // Eases a number from `from` to `to`. Returns a cancel function. Duration 0 jumps straight to the end.
  function tween(from, to, ms, onFrame) {
    if (!ms) { onFrame(to); return function () {}; }
    var start = global.performance.now(), id = null, stopped = false;
    function step(now) {
      if (stopped) return;
      var p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
      onFrame(from + (to - from) * e);
      if (p < 1) id = global.requestAnimationFrame(step);
    }
    id = global.requestAnimationFrame(step);
    return function cancel() { stopped = true; global.cancelAnimationFrame(id); };
  }

  // ---- HTTP ----------------------------------------------------------------

  // Never throws. Returns {ok, status, data} or {ok:false, status, error}.
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
      if (!res.ok) return { ok: false, status: res.status, error: 'http' };
      var data;
      try { data = await res.json(); } catch (e) { return { ok: false, status: res.status, error: 'body' }; }
      if (!data || typeof data !== 'object') return { ok: false, status: res.status, error: 'body' };
      return { ok: true, status: res.status, data: data };
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

  async function kickChannel(slug) {
    var enc = encodeURIComponent(slug);
    var v2 = await getJson('https://kick.com/api/v2/channels/' + enc);
    if (v2.ok) return { ok: true, data: v2.data, src: 'v2' };
    var v1 = await getJson('https://kick.com/api/v1/channels/' + enc);
    if (v1.ok) return { ok: true, data: v1.data, src: 'v1' };
    return { ok: false, error: v2.error || v1.error };
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
    if (!r.ok) return { ok: false, status: r.status, error: r.error };
    // An empty data array is a valid answer: the channel has no subscriber figures to show.
    var parsed = parseOfficialChannel(r.data) || { subs: null, gifted: null, canceled: null, live: null, viewers: null, startMs: null, title: '' };
    return Object.assign({ ok: true, status: r.status }, parsed);
  }

  // Subscriber source for the subscriber and combined bars.
  //   token mode:  official active_subscribers_count, polled.
  //   manual mode: aboneSayisi from AYARLAR.js, no network.
  // The session delta counts from the first value seen in this page load.
  function createSubscriberSource(s) {
    var base = null, total = null, mode = hasCredentials(s) ? 'token' : 'manual';
    function state(status, t) {
      if (t !== null && t !== undefined) {
        total = t;
        if (base === null) base = t;
      }
      return {
        mode: mode,
        status: status,
        total: total,
        delta: total !== null && base !== null ? total - base : 0
      };
    }
    return {
      mode: mode,
      async poll() {
        if (mode === 'manual') return state('manual', s.aboneSayisi);
        if (!s.kanal) return state('no-channel', total);
        var t = await appToken(s);
        if (!t.ok) {
          if (t.error === 'no-credentials') return state('no-credentials', total);
          // Only a rejected login is "wrong credentials"; a network or server failure is not.
          return state(t.status === 400 || t.status === 401 || t.status === 403 ? 'auth' : 'error', total);
        }
        var o = await officialChannel(s, t.token);
        if (!o.ok) {
          if (o.status === 401 || o.status === 403) { clearToken(); return state('auth', total); }
          if (o.status === 429) return state('rate', total);
          return state('error', total);
        }
        if (o.subs === null) return state('no-data', total);
        return state('ok', o.subs);
      }
    };
  }

  // ---- Live chat from the local relay (relay/server.js). ----

  // Server-Sent Events: the relay sends "chat" and "ban" frames already in the overlay's shape.
  // h = { onMessage(event), onStatus(status) }. Status: 'connecting', 'open', 'reconnecting'.
  // EventSource reconnects by itself, so a missing relay shows 'reconnecting' until it starts.
  function connectRelay(url, h) {
    h.onStatus && h.onStatus('connecting');
    var es = new global.EventSource(url);
    function forward(name) {
      es.addEventListener(name, function (e) {
        var ev; try { ev = JSON.parse(e.data); } catch (err) { return; }
        if (ev && typeof ev === 'object') { ev.kind = name; h.onMessage && h.onMessage(ev); }
      });
    }
    forward('chat');
    forward('ban');
    es.onopen = function () { h.onStatus && h.onStatus('open'); };
    es.onerror = function () { h.onStatus && h.onStatus('reconnecting'); };
    return function stop() { es.close(); };
  }

  // Schema-level assertion helper for tests and the studio.
  function enumsOf(name) { return ENUMS[name] ? ENUMS[name].slice() : null; }
  function schemaKeys() { return Object.keys(SCHEMA); }

  global.KickOverlay = {
    version: '2.1.0',
    enums: enumsOf,
    schemaKeys: schemaKeys,
    normalize: normalize,
    normalizeLocal: normalizeLocal,
    readSettings: readSettings,
    isPreview: isPreview,
    sample: SAMPLE,
    splitLines: splitLines,
    label: label,
    fmt: fmt,
    pct: pct,
    applyLook: applyLook,
    tween: tween,
    getJson: getJson,
    parse: {
      followers: parseFollowers,
      live: parseLive,
      subBadges: parseSubBadges,
      official: parseOfficialChannel,
      time: parseTime
    },
    kick: { channel: kickChannel },
    official: { token: appToken, channel: officialChannel, clearToken: clearToken },
    createSubscriberSource: createSubscriberSource,
    connectRelay: connectRelay
  };
})(typeof window !== 'undefined' ? window : globalThis);
