  var ENUMS = {
    stil: ['glass', 'vivid', 'soft', 'cinema', 'neon', 'minimal', 'pastel', 'terminal', 'aurora', 'holo', 'ember', 'paper', 'retro'],
    sekil: ['pill', 'rounded', 'square'],
    yaziTipi: ['inter', 'poppins', 'nunito', 'mono'],
    dil: ['tr', 'en', 'both', 'es', 'pt', 'de', 'ar'],
    animasyon: ['normal', 'low', 'off'],
    liderTur: ['gift', 'kicks']
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
    sohbetYatay:       { t: 'bool', d: false },
    ozelCss:           { t: 'css', d: '', max: 2000 },
    hataNotu:          { t: 'bool', d: true },
    bilgiBaslik:       { t: 'bool', d: false },
    hedefKutlama:      { t: 'bool', d: true },
    hedefArtis:        { t: 'int', d: 0, min: 0, max: 100000000 },
    uyariSn:           { t: 'int', d: 6, min: 3, max: 30 },
    uyariTakip:        { t: 'bool', d: true },
    uyariAbone:        { t: 'bool', d: true },
    uyariHediye:       { t: 'bool', d: true },
    uyariKicks:        { t: 'bool', d: true },
    uyariOdul:         { t: 'bool', d: true },
    uyariSes:          { t: 'bool', d: true },
    uyariSesSeviye:    { t: 'int', d: 60, min: 0, max: 100 },
    uyariOdulGizle:    { t: 'str', d: '', max: 400 },
    uyariTts:          { t: 'bool', d: false },
    uyariTtsUzunluk:   { t: 'int', d: 120, min: 20, max: 200 },
    uyariTtsYasak:     { t: 'str', d: '', max: 400 },
    olaySayisi:        { t: 'int', d: 5, min: 3, max: 10 },
    kicksHedefi:       { t: 'int', d: 1000, min: 1, max: 100000000 },
    trenSn:            { t: 'int', d: 120, min: 30, max: 600 },
    liderTur:          { t: 'enum', key: 'liderTur', d: 'gift' },
    liderSayisi:       { t: 'int', d: 5, min: 3, max: 10 }
  };

  // English names accepted for every setting. The Turkish name stays canonical: it is what the studio writes and
  // what the pages read, and when one source sets both, the Turkish one wins.
  var ALIASES = {
    channel: 'kanal', theme: 'stil', shape: 'sekil', font: 'yaziTipi', language: 'dil', motion: 'animasyon',
    accent: 'renk', streamerLabel: 'yayinciYazisi',
    followerGoal: 'takipciHedefi', followerFallback: 'takipciYedek', subscriberGoal: 'aboneHedefi',
    subscriberCount: 'aboneSayisi', showSessionGain: 'oturumFarkiGoster', showPercent: 'yuzdeGoster',
    goalCelebration: 'hedefKutlama', statusNote: 'hataNotu', infoShowTitle: 'bilgiBaslik', refreshSeconds: 'yenilemeSn',
    chatMaxMessages: 'sohbetMaksMesaj', chatHideCommands: 'sohbetKomutGizle', chatHiddenUsers: 'sohbetGizliKullanicilar',
    chatFadeSeconds: 'sohbetSilinmeSn', chatHorizontal: 'sohbetYatay', customCss: 'ozelCss',
    countdownMinutes: 'geriSayimDk', countdownTime: 'geriSayimSaat', countdownTitle: 'geriSayimBaslik',
    announcements: 'duyuruMetinleri', announcementSeconds: 'duyuruSn',
    alertSeconds: 'uyariSn', alertFollows: 'uyariTakip', alertSubs: 'uyariAbone', alertGifts: 'uyariHediye',
    alertKicks: 'uyariKicks', alertRewards: 'uyariOdul', alertSound: 'uyariSes', alertVolume: 'uyariSesSeviye',
    alertRewardsHidden: 'uyariOdulGizle', alertTts: 'uyariTts', alertTtsMaxLength: 'uyariTtsUzunluk',
    alertTtsBlockedWords: 'uyariTtsYasak',
    goalStep: 'hedefArtis', kicksGoal: 'kicksHedefi', subTrainSeconds: 'trenSn',
    eventsCount: 'olaySayisi', leaderboardType: 'liderTur', leaderboardCount: 'liderSayisi',
    relayAddress: 'relayAdresi'
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
  // Custom CSS (ozelCss) can come from a link, so it may only restyle the page: anything that could load a file or
  // a font from elsewhere, or hide such a load behind an escape, rejects the whole value. Comments are removed first,
  // so "u/**/rl(" cannot slip through. Too long is rejected too, since half a stylesheet would break the look.
  var CSS_BLOCKED = /@import|@namespace|@font-face|url\s*\(|image-set|\bsrc\s*\(|expression\s*\(|javascript:|behavior\s*:|-moz-binding|\\|</i;
  function asCss(v, d, max) {
    if (typeof v !== 'string') return d;
    var s = v.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
    return s.length > max || CSS_BLOCKED.test(s) ? d : s;
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
    return t.split(/[/?#\s]/)[0].replace(/^@/, '').toLowerCase().slice(0, 40);
  }
  function asUrl(v, d) {
    return typeof v === 'string' && URL_RE.test(v.trim()) ? v.trim().replace(/\/+$/, '') : d;
  }

  function coerce(spec, v) {
    switch (spec.t) {
      case 'str': return asStr(v, spec.d, spec.max || 200);
      case 'css': return asCss(v, spec.d, spec.max);
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
  // English names (ALIASES) are accepted; a Turkish key in the same object wins.
  function normalize(raw) {
    raw = canonical(raw);
    var out = {};
    Object.keys(SCHEMA).forEach(function (k) {
      out[k] = coerce(SCHEMA[k], k === 'kanal' ? cleanChannel(raw[k]) : raw[k]);
    });
    return out;
  }

  function normalizeLocal(raw) {
    raw = canonical(raw);
    var out = {};
    Object.keys(LOCAL_SCHEMA).forEach(function (k) {
      var spec = LOCAL_SCHEMA[k];
      out[k] = coerce(spec, raw[k]);
    });
    return out;
  }


  var ALIAS_OF = {};   // Turkish key -> English alias
  Object.keys(ALIASES).forEach(function (en) { ALIAS_OF[ALIASES[en]] = en; });
  var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  // One settings source with English names resolved. Only known keys are copied, so nothing else from the
  // source (an own "__proto__" from parsed JSON, say) reaches the merged settings.
  function canonical(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(SCHEMA).concat(Object.keys(LOCAL_SCHEMA)).forEach(function (k) {
      if (own(raw, k)) out[k] = raw[k];
      else if (own(ALIAS_OF, k) && own(raw, ALIAS_OF[k])) out[k] = raw[ALIAS_OF[k]];
    });
    return out;
  }

  // Public keys only, under either name; local keys (credentials, API bases, relay address) never come from a URL.
  function urlOverrides(search) {
    var raw = {};
    if (!search || typeof URLSearchParams === 'undefined') return raw;
    var params = new URLSearchParams(search);
    Object.keys(SCHEMA).forEach(function (k) {
      if (params.has(k)) raw[k] = params.get(k);
      else if (own(ALIAS_OF, k) && params.has(ALIAS_OF[k])) raw[k] = params.get(ALIAS_OF[k]);
    });
    return raw;
  }

  // Precedence: defaults < AYARLAR.js < AYARLAR.local.js < URL parameters (public keys only).
  function readSettings() {
    var file = canonical(global.KICK_OVERLAY_AYARLAR);
    var local = canonical(global.KICK_OVERLAY_YEREL);
    var search = global.location ? global.location.search : '';
    var pub = Object.assign({}, file, local, urlOverrides(search));
    var secrets = normalizeLocal(Object.assign({}, file, local));
    // AYARLAR.js is shared and published; app credentials are honored only from the git-ignored AYARLAR.local.js.
    secrets.kickClientId = coerce(LOCAL_SCHEMA.kickClientId, local.kickClientId);
    secrets.kickClientSecret = coerce(LOCAL_SCHEMA.kickClientSecret, local.kickClientSecret);
    // A page the relay serves talks to that same relay, whatever port it runs on, unless an address is set.
    if (relayServed() && !own(file, 'relayAdresi') && !own(local, 'relayAdresi')) secrets.relayAdresi = global.location.origin;
    var out = Object.freeze(Object.assign({}, normalize(pub), secrets));
    if (relayServed() && !isPreview()) watchSettings(secrets.relayAdresi);
    return out;
  }

  // True for a page the relay serves itself: http://127.0.0.1:PORT/... on this computer, or the https address of a
  // relay in server mode. The key script only the relay sends says so.
  function relayServed() {
    var loc = global.location;
    if (global.KICK_RELAY_SELF !== true || !loc) return false;
    return (loc.protocol === 'http:' && LOOPBACK_NAME.test(loc.hostname || '')) || loc.protocol === 'https:';
  }

  // A relay on a public https address (server mode): its pages bring the access key themselves.
  function relayRemote() {
    return relayServed() && global.location.protocol === 'https:';
  }

  // Settings saved in the studio (or AYARLAR.js edited by hand) reach a page the relay serves within a few seconds:
  // it asks for the file's revision and reloads when it changes. One watcher per page; a hidden page does not ask.
  var SETTINGS_POLL_MS = 3000;
  var watching = false;
  function watchSettings(base) {
    if (watching || typeof setInterval !== 'function' || !global.location || typeof global.location.reload !== 'function') return;
    watching = true;
    var rev = null, busy = false;
    function ask() {
      if (busy || (rev !== null && global.document && global.document.hidden)) return;
      busy = true;
      getJson(relayUrl(base + '/settings/rev'), { timeoutMs: 2000 }).then(function (r) {
        busy = false;
        if (!r.ok || !r.data || typeof r.data.rev !== 'number') return;
        if (rev === null) rev = r.data.rev;
        else if (r.data.rev !== rev) global.location.reload();
      });
    }
    // The first answer is what this page loaded with, so it is asked for at once: a save a moment later still counts.
    ask();
    setInterval(ask, SETTINGS_POLL_MS);
  }

  function hasCredentials(s) {
    return !!(s.kickClientId && s.kickClientSecret);
  }

  // Preview mode (?preview=1, or the original ?onizleme=1) shows sample numbers without any network call.
  // Used by the studio and the README. Never affects a live OBS source.
  function isPreview() {
    return !!(global.location && /(?:^|[?&])(?:preview|onizleme)=1(?:&|$)/.test(global.location.search));
  }

  // ?debug=1 shows the small diagnostics box (K.debug) and keeps error notes visible.
  function isDebug() {
    return !!(global.location && /(?:^|[?&])debug=1(?:&|$)/.test(global.location.search));
  }

  // The studio reloads its preview after every edit. With ?quiet=1 or ?sessiz=1 (preview only) that reload opens in its final
  // state: for a moment html.ko-quiet zeroes the intro durations and count-ups jump straight to their value.
  // 1.6 s outlasts every intro, so lifting the class later restarts nothing.
  var quiet = false;
  (function quietIntro() {
    if (!isPreview() || !/(?:^|[?&])(?:quiet|sessiz)=1(?:&|$)/.test(global.location.search)) return;
    var root = global.document && global.document.documentElement;
    if (!root || !root.classList || typeof setTimeout !== 'function') return;
    quiet = true;
    root.classList.add('ko-quiet');
    setTimeout(function () { quiet = false; root.classList.remove('ko-quiet'); }, 1600);
  })();

  var SAMPLE = {
    followers: 1234,
    kicks: 650,
    subs: 42,
    delta: 3,
    viewers: 2048,
    startMs: 3723000,
    title: 'Ranked games until midnight'
  };

  // Splits the announcement setting (lines separated by |) into at most 12 trimmed, non-empty lines.
  function splitLines(v) {
    return String(v || '').split('|').map(function (t) { return t.trim(); }).filter(Boolean).slice(0, 12);
  }

