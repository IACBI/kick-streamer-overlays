/* Kick Overlay Studio. Classic script. Network use is limited to the Kick calls the
   core makes when "Test connection" is pressed. */
(function () {
  'use strict';

  var K = window.KickOverlay;
  var DRAFT_KEY = 'kickOverlayStudio.taslak';
  var UI_KEY = 'kickOverlayStudio.arayuz';
  var DEBOUNCE_MS = 250;
  var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  // ---- Text: every visible string, from shared/lang/studio/<lang>.js ----------

  // Texts live in shared/lang/studio/<lang>.js, one file per language with the same keys.
  var PACKS = window.KICK_STUDIO_LANG || {};
  var LANGS = ['tr', 'en', 'es', 'pt', 'de', 'ar'].filter(function (l) { return PACKS[l]; });
  var I18N = {}, LABELS = {};
  LANGS.forEach(function (l) { I18N[l] = PACKS[l].ui; LABELS[l] = PACKS[l].labels; });

  // Presets only set public keys. Every value still passes through K.normalize.
  var PRESETS = {
    minimal: { stil: 'minimal', sekil: 'square', yaziTipi: 'inter', animasyon: 'low', renk: '#ffffff' },
    neon: { stil: 'neon', sekil: 'rounded', yaziTipi: 'mono', animasyon: 'normal', renk: '#39ff14' },
    pastel: { stil: 'pastel', sekil: 'pill', yaziTipi: 'nunito', animasyon: 'normal', renk: '#c4a7ff' },
    gece: { stil: 'aurora', sekil: 'rounded', yaziTipi: 'poppins', animasyon: 'low', renk: '#5eead4' },
    kagit: { stil: 'paper', sekil: 'rounded', yaziTipi: 'nunito', animasyon: 'normal', renk: '#c2410c' }
  };

  // The overlays: file, OBS size, the settings each one reads (besides the common look keys),
  // the settings group that opens when it is previewed, whether it needs a channel name, and whether
  // it can show real Kick data (data) at all: countdown and ticker have none, chat only through the relay.
  var COMMON = ['kanal', 'stil', 'sekil', 'yaziTipi', 'dil', 'animasyon', 'renk', 'ozelCss'];
  var OVERLAYS = [
    { id: 'follower', file: 'follower-bar.html', w: 520, h: 90, group: 'g-goals', needsChannel: true, data: true, keys: ['takipciHedefi', 'takipciYedek', 'yuzdeGoster', 'yenilemeSn', 'hedefKutlama', 'hedefArtis', 'hataNotu'] },
    { id: 'subscriber', file: 'subscriber-bar.html', w: 520, h: 90, group: 'g-goals', needsChannel: false, data: true, keys: ['aboneHedefi', 'aboneSayisi', 'oturumFarkiGoster', 'yuzdeGoster', 'yenilemeSn', 'hedefKutlama', 'hedefArtis', 'hataNotu'] },
    { id: 'combined', file: 'combined-bar.html', w: 520, h: 180, group: 'g-goals', needsChannel: true, data: true, keys: ['takipciHedefi', 'takipciYedek', 'aboneHedefi', 'aboneSayisi', 'oturumFarkiGoster', 'yuzdeGoster', 'yenilemeSn', 'hedefKutlama', 'hedefArtis', 'hataNotu'] },
    { id: 'info', file: 'info-panel.html', w: 300, h: 80, group: 'g-goals', needsChannel: true, data: true, keys: ['yenilemeSn', 'bilgiBaslik', 'hataNotu'] },
    { id: 'countdown', file: 'countdown.html', w: 520, h: 190, group: 'g-countdown', needsChannel: false, keys: ['geriSayimDk', 'geriSayimSaat', 'geriSayimBaslik', 'hataNotu'] },
    { id: 'ticker', file: 'ticker.html', w: 760, h: 80, group: 'g-ticker', needsChannel: false, keys: ['duyuruMetinleri', 'duyuruSn', 'hataNotu'] },
    { id: 'chat', file: 'chat.html', w: 460, h: 760, group: 'g-chat', needsChannel: true, sampleOnly: true, keys: ['sohbetMaksMesaj', 'yayinciYazisi', 'sohbetKomutGizle', 'sohbetGizliKullanicilar', 'sohbetSilinmeSn', 'sohbetYatay', 'hataNotu'] },
    { id: 'alerts', file: 'alerts.html', w: 640, h: 200, group: 'g-alerts', needsChannel: true, sampleOnly: true, keys: ['uyariSn', 'uyariTakip', 'uyariAbone', 'uyariHediye', 'uyariKicks', 'uyariOdul', 'uyariSes', 'uyariSesSeviye', 'uyariOdulGizle', 'uyariTts', 'uyariTtsUzunluk', 'uyariTtsYasak', 'hataNotu'] },
    { id: 'events', file: 'events.html', w: 420, h: 400, group: 'g-stats', needsChannel: true, sampleOnly: true, keys: ['olaySayisi', 'hataNotu'] },
    { id: 'leaderboard', file: 'leaderboard.html', w: 380, h: 400, group: 'g-stats', needsChannel: true, sampleOnly: true, keys: ['liderTur', 'liderSayisi', 'hataNotu'] },
    { id: 'kicks', file: 'kicks-bar.html', w: 520, h: 90, group: 'g-stats', needsChannel: true, sampleOnly: true, keys: ['kicksHedefi', 'hedefArtis', 'yuzdeGoster', 'hedefKutlama', 'hataNotu'] },
    { id: 'train', file: 'sub-train.html', w: 520, h: 90, group: 'g-stats', needsChannel: true, sampleOnly: true, keys: ['trenSn', 'hataNotu'] }
  ];
  var BACKGROUNDS = ['checker', 'dark', 'light', 'scene'];

  // Output file layout, mirroring AYARLAR.js. Order and comments match the shipped file.
  // A function so the theme list comes from the core enums, not a copy.
  function ayarDoc() { return [
    { key: 'kanal', note: 'Kick channel name, as in kick.com/NAME' },
    { key: 'stil', note: 'Theme: ' + K.enums('stil').join(' | ') },
    { key: 'sekil', note: 'Corner shape: pill | rounded | square' },
    { key: 'yaziTipi', note: 'Font: inter | poppins | nunito | mono' },
    { key: 'dil', note: 'Labels: tr | en | both | es | pt | de | ar  (both = "Takipçi / Follower")' },
    { key: 'animasyon', note: 'Motion: normal | low | off' },
    { key: 'renk', note: "Accent color (hex). Used by every theme except pastel's fills." },
    { key: 'yayinciYazisi', note: 'Label shown next to YOUR name in chat' },
    { key: 'takipciHedefi', note: "Follower goal and fallback count (used when Kick can't be reached)" },
    { key: 'takipciYedek' },
    { key: 'aboneHedefi', note: 'Subscriber goal' },
    { key: 'aboneSayisi', note: 'Subscriber count used when no Kick app is set in AYARLAR.local.js.\nWith the app set, the live total from Kick is used instead.' },
    { key: 'oturumFarkiGoster', note: 'Show "+N this stream" next to the subscriber count' },
    { key: 'yuzdeGoster', note: 'Show the percentage of the goal' },
    { key: 'hedefKutlama', note: 'Goal bars: pulse at 25 / 50 / 75 % and a "goal reached" look at 100 %' },
    { key: 'hedefArtis', note: 'Goal auto-step: when a goal is reached it rises by this much (0 = off)' },
    { key: 'hataNotu', note: 'Show the small status / error note on overlays' },
    { key: 'bilgiBaslik', note: "Info panel (info-panel.html): show the stream title on the panel's bottom edge" },
    { key: 'yenilemeSn', note: 'Refresh interval in seconds (10–600)' },
    { key: 'sohbetMaksMesaj', note: 'Maximum chat messages on screen (3–20)' },
    { key: 'sohbetKomutGizle', note: 'Hide chat messages that start with "!" (commands)' },
    { key: 'sohbetGizliKullanicilar', note: 'Usernames hidden from chat, separated by commas (not case-sensitive). Example: "nightbot, botrix"' },
    { key: 'sohbetSilinmeSn', note: 'Chat messages fade out after this many seconds (0 = never, up to 600)' },
    { key: 'sohbetYatay', note: 'Chat in one horizontal row for a strip along the screen edge (e.g. a 1280 x 80 source)' },
    { key: 'geriSayimDk', note: 'Countdown (countdown.html): minutes to count down from when the page loads' },
    { key: 'geriSayimSaat', note: 'Countdown target time as 24-hour local HH:MM (e.g. "21:30").\nWhen set it wins over geriSayimDk; a time that has passed today means tomorrow. Empty = use minutes' },
    { key: 'geriSayimBaslik', note: 'Countdown title. Empty = "Starting soon" in your label language' },
    { key: 'duyuruMetinleri', note: 'Announcement bar (ticker.html): lines separated by |  (up to 12)\nExample: "Follow for more | !discord | New video every Friday"' },
    { key: 'duyuruSn', note: 'Seconds each announcement stays on screen (3–60)' },
    { key: 'uyariSn', note: 'Alerts (alerts.html): seconds each alert stays on screen (3–30)' },
    { key: 'uyariTakip', note: 'Which alerts to show: new followers, subscriptions, gifted subscriptions, Kicks' },
    { key: 'uyariAbone' },
    { key: 'uyariHediye' },
    { key: 'uyariKicks' },
    { key: 'uyariOdul', note: 'Channel point reward redemptions (needs the "Read Channel points rewards" scope in your Kick app)' },
    { key: 'uyariSes', note: 'Play a sound with each alert. A file in alerts/ (follow.mp3, sub.mp3, gift.mp3, kicks.mp3) replaces the built-in tone' },
    { key: 'uyariSesSeviye', note: 'Alert volume, 0–100' },
    { key: 'uyariOdulGizle', note: 'Reward names that never show an alert, separated by | (not case-sensitive)' },
    { key: 'uyariTts', note: 'Read Kicks and reward messages aloud. Plays on the computer\'s default output, not through the OBS source' },
    { key: 'uyariTtsUzunluk', note: 'Longest message read aloud, in characters (20–200)' },
    { key: 'uyariTtsYasak', note: 'Words that stop a message from being read, separated by commas (not case-sensitive)' },
    { key: 'olaySayisi', note: 'Recent events (events.html): how many events to show (3–10)' },
    { key: 'liderTur', note: 'Leaderboard (leaderboard.html): gift = top gifters | kicks = top Kicks senders' },
    { key: 'liderSayisi', note: 'People on the leaderboard (3–10)' },
    { key: 'kicksHedefi', note: 'Kicks goal bar (kicks-bar.html): Kicks to reach this stream' },
    { key: 'trenSn', note: 'Sub train (sub-train.html): seconds a new subscription has to keep the train going (30–600)' },
    { key: 'ozelCss', note: 'Custom CSS for every overlay, up to 2000 characters. url(), @import, @font-face, image-set and backslashes are not accepted' }
  ]; }

  var $ = function (id) { return document.getElementById(id); };

  var lang = 'en';
  function t(key, vars) {
    var base = I18N.en || {};
    var table = I18N[lang] || base;
    var s = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : (base[key] || key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }

  if (!K) {
    document.documentElement.lang = 'en';
    $('cikti').value = t('core.fail');
    return;
  }

  var form = $('ayar-form');
  var out = $('cikti');
  var outStatus = $('cikti-durum');
  var kickStatus = $('kick-durum');
  var kickTestBtn = $('kickTest');
  var frame = $('onizleme');
  var stage = $('sahne');
  var fit = $('sigdir');
  var activeId = 'follower';
  var background = 'checker';
  var live = false; // the preview shows real Kick data only after an explicit click; every edit session starts on sample data
  var relayEl = $('relayAdresi');
  var RELAY_DEFAULT = K.normalizeLocal({}).relayAdresi;
  // Opened from the relay (http://127.0.0.1:8790/): settings are saved there, and links carry no settings.
  var SELF = typeof K.relayServed === 'function' && K.relayServed();
  var savedJson = null;   // the settings the relay holds, for the unsaved-changes note
  // Links and settings files use the English setting names; the Turkish ones keep working everywhere.
  var EN_NAME = {};
  Object.keys(K.aliases()).forEach(function (en) { EN_NAME[K.aliases()[en]] = en; });
  function enName(key) { return EN_NAME[key] || key; }

  // ---- Small helpers ------------------------------------------------------

  function say(el, kind, text) {
    el.textContent = text;
    el.className = 'st-status' + (kind ? ' is-' + kind : '');
  }

  var toastTimer = 0;
  function toast(text, isErr) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'st-toast is-on' + (isErr ? ' is-err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'st-toast' + (isErr ? ' is-err' : ''); }, 2200);
  }

  function hex6(h) {
    var v = String(h || '');
    if (/^#[0-9a-f]{3}$/i.test(v)) {
      return '#' + v.slice(1).split('').map(function (c) { return c + c; }).join('');
    }
    return v;
  }

  function currentSettings() { return K.normalize(readRaw()); }

  // Reads public fields only. Secret inputs live outside the form and are never read here.
  function readRaw() {
    var raw = {};
    K.schemaKeys().forEach(function (key) {
      var el = form.elements.namedItem(key);
      if (!el) return;
      raw[key] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return raw;
  }

  function writeForm(s) {
    K.schemaKeys().forEach(function (key) {
      var el = form.elements.namedItem(key);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = s[key] === true;
      else el.value = key === 'renk' ? hex6(s[key]) : String(s[key]);
    });
    $('renkMetin').value = s.renk;
  }

  // Only what that overlay reads, so edits to other overlays' settings never reload the frame.
  function previewQuery(o, s, sample) {
    var q = new URLSearchParams();
    COMMON.concat(o.keys).forEach(function (key) {
      if (s[key] !== undefined) q.set(key, String(s[key]));
    });
    if (sample) q.set('onizleme', '1');
    return q.toString();
  }

  function relayValue() {
    var v = relayEl.value.trim();
    if (SELF && !v) return window.location.origin;
    return K.normalizeLocal({ relayAdresi: v }).relayAdresi;
  }

  function overlayById(id) {
    for (var i = 0; i < OVERLAYS.length; i++) if (OVERLAYS[i].id === id) return OVERLAYS[i];
    return OVERLAYS[0];
  }

  // The link for OBS: only the settings that overlay reads, and only those that differ from the defaults.
  function overlayUrl(o, s) {
    // Served by the relay, a page reads the saved AYARLAR.js, so its link never has to change.
    if (SELF) return new URL(o.file, window.location.href).href;
    var defaults = K.normalize({});
    var q = new URLSearchParams();
    COMMON.concat(o.keys).forEach(function (key) {
      if (s[key] !== defaults[key]) q.set(enName(key), String(s[key]));
    });
    var url = new URL(o.file, window.location.href);
    url.search = q.toString();
    url.hash = '';
    return url.href;
  }

  // ---- Language -------------------------------------------------------------

  function labelOf(name, value) {
    var table = LABELS[lang] || LABELS.en;
    return (table[name] && table[name][value]) || value;
  }

  function applyI18n() {
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.title = t('brand.title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria'))); });
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false'); });
    document.querySelectorAll('[data-label-name]').forEach(function (el) {
      el.textContent = labelOf(el.getAttribute('data-label-name'), el.getAttribute('data-label-value'));
    });
    document.querySelectorAll('[data-preset]').forEach(function (b) { b.querySelector('span:last-child').textContent = t('preset.' + b.getAttribute('data-preset')); });
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.textContent = t('ov.' + b.getAttribute('data-tab')); });
    document.querySelectorAll('[data-card]').forEach(function (c) {
      var id = c.getAttribute('data-card');
      c.querySelector('.st-card-name').textContent = t('ov.' + id);
      c.querySelector('.st-card-desc').textContent = t('ov.' + id + '.d');
      c.querySelector('[data-url]').setAttribute('aria-label', t('card.linkAria', { name: t('ov.' + id) }));
      c.querySelector('[data-show]').textContent = t('card.preview');
      c.querySelector('.st-card-warn').textContent = t('card.needChannel');
    });
    document.querySelectorAll('[data-bg]').forEach(function (b) { if (b.tagName === 'BUTTON') b.textContent = t('bg.' + b.getAttribute('data-bg')); });
    buildHelp();
  }

  function setLang(next) {
    lang = LANGS.indexOf(next) >= 0 ? next : 'en';
    applyI18n();
    update();
    saveUi();
  }

  // ---- Choice controls built from the core enums --------------------------

  function addChoice(container, name, value, kind) {
    var lab = document.createElement('label');
    lab.className = 'st-opt' + (kind === 'theme' ? ' st-theme' : '');

    var input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    lab.appendChild(input);

    if (kind === 'theme') {
      var sw = document.createElement('span');
      sw.className = 'st-swatch';
      sw.setAttribute('data-stil', value);
      sw.setAttribute('aria-hidden', 'true');
      sw.appendChild(document.createElement('i'));
      lab.appendChild(sw);
    }

    var text = document.createElement('span');
    text.className = 'st-opt-text';
    text.setAttribute('data-label-name', name);
    text.setAttribute('data-label-value', value);
    lab.appendChild(text);

    container.appendChild(lab);
  }

  function buildChoices() {
    K.enums('stil').forEach(function (v) { addChoice($('stil-secenekleri'), 'stil', v, 'theme'); });
    K.enums('sekil').forEach(function (v) { addChoice($('sekil-secenekleri'), 'sekil', v); });
    K.enums('dil').forEach(function (v) { addChoice($('dil-secenekleri'), 'dil', v); });
    K.enums('animasyon').forEach(function (v) { addChoice($('animasyon-secenekleri'), 'animasyon', v); });

    var select = $('yaziTipi');
    K.enums('yaziTipi').forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.setAttribute('data-label-name', 'yaziTipi');
      opt.setAttribute('data-label-value', v);
      select.appendChild(opt);
    });
  }

  function buildPresets() {
    var box = $('presets');
    Object.keys(PRESETS).forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-btn st-btn--small';
      b.setAttribute('data-preset', id);
      var dot = document.createElement('span');
      dot.className = 'st-dot';
      dot.style.background = PRESETS[id].renk;
      dot.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      b.appendChild(dot);
      b.appendChild(label);
      box.appendChild(b);
    });
  }

  function paintChoices() {
    form.querySelectorAll('.st-opt').forEach(function (lab) {
      lab.classList.toggle('is-checked', lab.querySelector('input').checked);
    });
  }

  // ---- Preview tabs and backgrounds ------------------------------------------

  function buildTabs() {
    var box = $('sekmeler');
    OVERLAYS.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'st-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('data-tab', o.id);
      b.id = 'tab-' + o.id;
      b.addEventListener('click', function () { selectTab(o.id, true); });
      b.addEventListener('keydown', onTabKey);
      box.appendChild(b);
    });
    var bgBox = $('arkaplanlar');
    BACKGROUNDS.forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-bg', id);
      b.addEventListener('click', function () { setBackground(id); saveUi(); });
      bgBox.appendChild(b);
    });
  }

  function onTabKey(e) {
    var keys = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    var i = OVERLAYS.findIndex(function (o) { return o.id === activeId; });
    var n = keys[e.key] === 'first' ? 0 : keys[e.key] === 'last' ? OVERLAYS.length - 1 : (i + keys[e.key] + OVERLAYS.length) % OVERLAYS.length;
    selectTab(OVERLAYS[n].id, true);
    $('tab-' + OVERLAYS[n].id).focus();
  }

  function selectTab(id, openGroup) {
    var next = overlayById(id).id;
    if (next !== activeId) live = false;
    activeId = next;
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      var on = b.getAttribute('data-tab') === activeId;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    stage.setAttribute('aria-labelledby', 'tab-' + activeId);
    if (openGroup) {
      var g = $(overlayById(activeId).group);
      if (g && !g.open) g.open = true;
    }
    renderFrame();
    fitPreview();
    saveUi();
  }

  function setBackground(id) {
    background = BACKGROUNDS.indexOf(id) >= 0 ? id : 'checker';
    stage.setAttribute('data-bg', background);
    document.querySelectorAll('#arkaplanlar [data-bg]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-bg') === background ? 'true' : 'false');
    });
  }

  var frameTimer = 0;
  function scheduleFrame() {
    clearTimeout(frameTimer);
    // Live mode talks to Kick on every load, so wait longer while the user is still typing.
    frameTimer = setTimeout(renderFrame, live ? 800 : DEBOUNCE_MS);
  }

  // Editing always previews sample data (onizleme=1); real data only after the "Live data" click.
  // Public settings only in the URL. The frame is touched only when its URL really changes.
  var frameUrl = '', frameFile = '', frameMotion = '';
  function renderFrame() {
    var o = overlayById(activeId);
    var s = currentSettings();
    var canLive = o.data === true && !!s.kanal;
    if (!canLive) live = false;
    var url = o.file + '?' + previewQuery(o, s, !live);
    if (frameUrl !== url) {
      // An edit to the overlay already shown reloads it without its intro (sessiz=1), so a colour tweak does not
      // replay the count-up. A new tab, live data or a change of the motion setting itself still shows the intro.
      var calm = !live && o.file === frameFile && s.animasyon === frameMotion;
      frame.setAttribute('src', calm ? url + '&sessiz=1' : url);
      frameUrl = url; frameFile = o.file; frameMotion = s.animasyon;
    }
    frame.setAttribute('width', String(o.w));
    frame.setAttribute('height', String(o.h));
    frame.setAttribute('title', t('ov.' + o.id));
    $('pv-ac').setAttribute('href', url);
    $('pv-boyut').textContent = o.w + ' × ' + o.h;
    var chip = $('pv-veri');
    chip.hidden = !o.data && !o.sampleOnly;
    chip.textContent = live ? t('pv.live') : t('pv.sample');
    var btn = $('pv-canli');
    btn.hidden = o.data !== true;
    btn.setAttribute('aria-pressed', live ? 'true' : 'false');
    btn.setAttribute('aria-disabled', canLive ? 'false' : 'true');
    if (canLive) btn.removeAttribute('title'); else btn.setAttribute('title', t('pv.liveNeed'));
  }

  function toggleLive() {
    var o = overlayById(activeId);
    if (o.data !== true) return;
    if (!currentSettings().kanal) { toast(t('pv.liveNeed'), true); return; }
    live = !live;
    announce(t(live ? 'pv.liveOn' : 'pv.liveOff'));
    clearTimeout(frameTimer);
    renderFrame();
  }

  // Scales the frame to fit the stage in width and height. It keeps its real OBS size inside.
  function fitPreview() {
    var o = overlayById(activeId);
    var availW = stage.clientWidth - 24;
    var compact = window.innerWidth < 1000;
    var maxH = compact ? Math.max(90, window.innerHeight * 0.2) : Math.max(180, window.innerHeight * 0.62);
    var k = Math.min(1, availW > 0 ? availW / o.w : 1, maxH / o.h);
    fit.style.width = Math.round(o.w * k) + 'px';
    fit.style.height = Math.round(o.h * k) + 'px';
    frame.style.transform = 'scale(' + k + ')';
  }

  // ---- OBS link cards ----------------------------------------------------------

  var COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

  function buildCards() {
    var box = $('kartlar');
    OVERLAYS.forEach(function (o) {
      var card = document.createElement('div');
      card.className = 'st-card';
      card.setAttribute('data-card', o.id);

      var head = document.createElement('div');
      head.className = 'st-card-head';
      var name = document.createElement('span');
      name.className = 'st-card-name';
      var size = document.createElement('span');
      size.className = 'st-card-size';
      size.textContent = o.w + ' × ' + o.h;
      // Short chip here; the full explanation sits once above the cards (#kanal-uyari).
      var warn = document.createElement('span');
      warn.className = 'st-card-warn';
      warn.hidden = true;
      head.appendChild(name);
      head.appendChild(warn);
      head.appendChild(size);

      var desc = document.createElement('p');
      desc.className = 'st-card-desc';

      var row = document.createElement('div');
      row.className = 'st-card-row';
      var input = document.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.setAttribute('data-url', o.id);
      input.addEventListener('focus', function () { input.select(); });
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'st-btn st-btn--small st-btn--primary';
      copy.setAttribute('data-copy', o.id);
      copy.innerHTML = COPY_ICON;
      var copyLabel = document.createElement('span');
      copyLabel.setAttribute('data-i18n', 'card.copy');
      copy.appendChild(copyLabel);
      copy.addEventListener('click', function () { copyLink(copy, input); });
      var show = document.createElement('button');
      show.type = 'button';
      show.className = 'st-btn st-btn--small st-btn--ghost';
      show.setAttribute('data-show', o.id);
      show.addEventListener('click', function () {
        selectTab(o.id, true);
        // Below 1000 px the preview is pinned to the top and always visible, and its title is hidden:
        // there is nothing to scroll to, so hand focus to the selected tab instead.
        if (window.innerWidth < 1000) $('tab-' + o.id).focus({ preventScroll: true });
        else document.querySelector('.st-preview').scrollIntoView({ block: 'nearest' });
      });
      row.appendChild(input);
      row.appendChild(copy);
      row.appendChild(show);

      card.appendChild(head);
      card.appendChild(desc);
      card.appendChild(row);
      box.appendChild(card);
    });
  }

  function refreshCards(s) {
    OVERLAYS.forEach(function (o) {
      var card = document.querySelector('[data-card="' + o.id + '"]');
      var input = card.querySelector('[data-url]');
      var url = overlayUrl(o, s);
      if (input.value !== url) input.value = url;
      card.querySelector('.st-card-warn').hidden = !(o.needsChannel && !s.kanal);
    });
    $('kanal-uyari').hidden = !!s.kanal;
  }

  var announceTimer = 0;
  function announce(text) {
    var el = $('sr-canli');
    el.textContent = '';
    clearTimeout(announceTimer);
    announceTimer = setTimeout(function () { el.textContent = text; }, 60);
  }

  // The button itself says "Copied" for a moment; no toast needed on success.
  function flashCopied(btn) {
    var label = btn.querySelector('[data-i18n]') || btn;
    clearTimeout(btn._flash);
    btn.classList.add('is-done');
    label.textContent = t('copy.done');
    announce(t('copy.done'));
    btn._flash = setTimeout(function () {
      btn.classList.remove('is-done');
      label.textContent = t(label.getAttribute('data-i18n'));
    }, 1600);
  }

  async function copyLink(btn, input) {
    try {
      await navigator.clipboard.writeText(input.value);
      flashCopied(btn);
    } catch (e) {
      input.focus();
      input.select();
      toast(t('toast.linkFail'), true);
    }
  }

  async function copyAllLinks() {
    var s = currentSettings();
    var text = OVERLAYS.map(function (o) { return t('ov.' + o.id) + ': ' + overlayUrl(o, s); }).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flashCopied($('hepsiniKopyala'));
    } catch (e) {
      toast(t('toast.linkFail'), true);
    }
  }

  // ---- OBS scene collection --------------------------------------------------

  // Where each overlay sits on a 1920 × 1080 canvas. The combined bar repeats the two goal bars and the countdown
  // belongs to a "starting soon" moment, so both come in hidden.
  var OBS_LAYOUT = {
    follower: { x: 40, y: 40 },
    subscriber: { x: 40, y: 140 },
    combined: { x: 40, y: 40, hidden: true },
    info: { x: 1580, y: 40 },
    countdown: { x: 700, y: 445, hidden: true },
    ticker: { x: 580, y: 980 },
    chat: { x: 1420, y: 150 },
    alerts: { x: 640, y: 60 },
    events: { x: 40, y: 640, hidden: true },
    leaderboard: { x: 40, y: 340, hidden: true },
    kicks: { x: 40, y: 240, hidden: true },
    train: { x: 700, y: 160, hidden: true }
  };

  async function copyDockLink() {
    var s = currentSettings();
    var url = new URL('dock.html', window.location.href);
    if (s.dil !== K.normalize({}).dil) url.search = 'dil=' + encodeURIComponent(s.dil);
    url.hash = '';
    try {
      await navigator.clipboard.writeText(url.href);
      flashCopied($('dockKopyala'));
    } catch (e) {
      toast(t('toast.linkFail'), true);
    }
  }

  function downloadObsCollection() {
    var s = currentSettings();
    var collection = K.obsSceneCollection({
      name: 'Kick Overlay Pack',
      scene: t('obs.scene'),
      items: OVERLAYS.map(function (o) {
        var at = OBS_LAYOUT[o.id];
        return { name: 'Kick · ' + t('ov.' + o.id), url: overlayUrl(o, s), width: o.w, height: o.h,
          x: at.x, y: at.y, visible: !at.hidden, audio: o.id === 'alerts' };
      })
    });
    try {
      download('kick-overlay-obs.json', JSON.stringify(collection, null, 2) + '\n', 'application/json;charset=utf-8');
      toast(t('obs.saved'));
    } catch (e) {
      toast(t('out.dlFail'), true);
    }
  }

  // ---- Help ------------------------------------------------------------------

  function buildHelp() {
    var list = $('yardim-liste');
    list.textContent = '';
    ['help.c1', 'help.c2', 'help.c3', 'help.c4'].forEach(function (k) {
      var li = document.createElement('li');
      li.textContent = t(k);
      list.appendChild(li);
    });
    var dl = $('yardim-notlar');
    dl.textContent = '';
    for (var i = 1; i <= 7; i++) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = t('help.n' + i + '.t');
      var dd = document.createElement('dd');
      dd.textContent = t('help.n' + i + '.d');
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      dl.appendChild(wrap);
    }
  }

  // ---- Output file ----------------------------------------------------------

  function buildAyarlar(s) {
    var lines = [
      '/* ============================================================',
      '   KICK OVERLAY PACK — AYARLAR / SETTINGS',
      '   ------------------------------------------------------------',
      '   Edit only the values in this file, save, then right-click the',
      '   source in OBS and choose Refresh.',
      '   Secrets (Kick app credentials) do NOT go here: use AYARLAR.local.js.',
      '   ============================================================ */',
      'window.KICK_OVERLAY_AYARLAR = {',
      ''
    ];

    // Keys the loaded core does not know are left out; relayAdresi only when it differs from the default.
    var doc = ayarDoc().filter(function (item) { return s[item.key] !== undefined; });
    var relay = relayValue();
    var entries = doc.map(function (item) { return { key: enName(item.key), note: item.note, value: s[item.key] }; });
    if (relay !== RELAY_DEFAULT) {
      entries.push({ key: enName('relayAdresi'), note: 'Chat relay address. Change it only if you run the relay somewhere else.', value: relay });
    }
    entries.forEach(function (item, i) {
      if (item.note) {
        item.note.split('\n').forEach(function (l) { lines.push('  // ' + l); });
      }
      var last = i === entries.length - 1;
      lines.push('  ' + item.key + ': ' + JSON.stringify(item.value) + (last ? '' : ','));
      if (!last) lines.push('');
    });

    lines.push('', '};', '');
    return lines.join('\n');
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(out.value);
      say(outStatus, 'ok', t('out.copied'));
      flashCopied($('kopyala'));
    } catch (e) {
      out.focus();
      out.select();
      say(outStatus, 'err', t('out.copyFail'));
    }
  }

  // ---- Kick app (secrets stay in memory) ----------------------------------

  function tokenMessage(r) {
    switch (r.error) {
      case 'no-credentials': return t('e.noCreds');
      case 'http':
        if (r.status === 400 || r.status === 401 || r.status === 403) return t('e.tokenBad', { status: r.status });
        return t('e.tokenHttp', { status: r.status });
      case 'timeout': return t('e.tokenTimeout');
      case 'network': return t('e.tokenNet');
      default: return t('e.tokenOther');
    }
  }

  function channelMessage(r) {
    if (r.status === 401 || r.status === 403) return t('e.chanAuth', { status: r.status });
    if (r.status === 429) return t('e.rate');
    if (r.error === 'empty') return t('e.empty');
    if (r.error === 'timeout') return t('e.chanTimeout');
    if (r.error === 'network') return t('e.chanNet');
    return t('e.chanOther');
  }

  async function testKick() {
    var id = $('kickClientId').value.trim();
    var secret = $('kickClientSecret').value.trim();
    if (!id || !secret) { say(kickStatus, 'err', t('e.noCreds')); return; }
    var s = Object.assign({}, currentSettings(), K.normalizeLocal({ kickClientId: id, kickClientSecret: secret }));
    if (!s.kanal) { say(kickStatus, 'err', t('e.noChannel')); return; }

    kickTestBtn.disabled = true;
    say(kickStatus, '', t('e.checking'));
    try {
      var tok = await K.official.token(s);
      if (!tok.ok) { say(kickStatus, 'err', tokenMessage(tok)); return; }

      var o = await K.official.channel(s, tok.token);
      if (!o.ok) { say(kickStatus, 'err', channelMessage(o)); return; }
      if (o.subs === null) { say(kickStatus, 'err', t('e.noSubs')); return; }

      var live = o.live === true ? t('e.live') : (o.live === false ? t('e.offline') : '');
      say(kickStatus, 'ok', t('e.ok', { n: K.fmt(o.subs), live: live }));
    } catch (e) {
      say(kickStatus, 'err', t('e.unexpected'));
    } finally {
      kickTestBtn.disabled = false;
    }
  }

  // ---- Saving through the relay ----------------------------------------------

  function relayPost(path, body) {
    return fetch(K.relayUrl(window.location.origin + path), {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok || !data || data.ok !== true) throw new Error('save');
        return data;
      });
    });
  }

  async function saveToRelay() {
    var btn = $('relayKaydet');
    var box = $('kaydet-durum');
    btn.disabled = true;
    try {
      await relayPost('/settings', { settings: readRaw() });
      savedJson = JSON.stringify(currentSettings());
      markDirty();
      say(box, 'ok', t('save.ok'));
      refreshChecklist();
    } catch (e) {
      say(box, 'err', t('save.fail'));
    } finally {
      btn.disabled = false;
    }
  }

  function markDirty() {
    if (!SELF || savedJson === null) return;
    var dirty = JSON.stringify(currentSettings()) !== savedJson;
    var bar = $('kaydetKutu');
    var box = $('kaydet-durum');
    bar.classList.toggle('is-dirty', dirty);
    if (dirty) say(box, '', t('save.dirty'));
    else if (box.textContent === t('save.dirty')) say(box, '', '');
  }

  async function loadFromRelay() {
    try {
      var res = await fetch(K.relayUrl(window.location.origin + '/settings'), { cache: 'no-store' });
      var data = res.ok ? await res.json() : null;
      if (data && data.ok && data.settings && typeof data.settings === 'object') writeForm(K.normalize(data.settings));
    } catch (e) { /* relay busy or old: the form keeps its defaults */ }
    savedJson = JSON.stringify(currentSettings());
    update();
  }

  async function saveLocalToRelay() {
    var id = $('kickClientId').value.trim();
    var secret = $('kickClientSecret').value.trim();
    if (!id !== !secret) { say(kickStatus, 'err', t('e.localNeed')); return; }
    var btn = $('yerelIndir');
    btn.disabled = true;
    try {
      var data = await relayPost('/credentials', { clientId: id, clientSecret: secret });
      $('kickClientId').value = '';
      $('kickClientSecret').value = '';
      say(kickStatus, 'ok', data.saved ? t('e.relaySaved') : t('e.relayCleared'));
      refreshChecklist();
    } catch (e) {
      say(kickStatus, 'err', t('e.relayFail'));
    } finally {
      btn.disabled = false;
    }
  }

  // Creates the missing Kick event subscriptions through the relay: chat, alerts and stream status start arriving
  // once the app's Webhook URL points at the relay's tunnel.
  var CONNECT_ERRORS = { 'no-credentials': 'e.connectNoCreds', 'no-channel': 'e.connectNoChannel', auth: 'e.connectAuth' };
  async function connectEvents() {
    var btn = $('olayBagla');
    btn.disabled = true;
    say(kickStatus, '', t('relay.checking'));
    try {
      var res = await fetch(K.relayUrl(window.location.origin + '/subscribe'), {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      var data = await res.json().catch(function () { return null; });
      if (res.ok && data && data.ok) {
        var n = Array.isArray(data.added) ? data.added.length : 0;
        say(kickStatus, 'ok', n ? t('e.connectOk', { n: n }) : t('e.connectAll'));
        refreshChecklist();
      } else {
        var code = data && typeof data.error === 'string' ? data.error : '';
        say(kickStatus, 'err', t(Object.prototype.hasOwnProperty.call(CONNECT_ERRORS, code) ? CONNECT_ERRORS[code] : 'e.connectFail'));
      }
    } catch (e) {
      say(kickStatus, 'err', t('e.connectFail'));
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Live features checklist (studio opened from the relay) ------------------

  var CHECK_MS = 5000;
  var lastChecklist = '';
  function checklistItems(data, now) {
    var f = data.features && typeof data.features === 'object' ? data.features : {};
    var items = [];
    var channel = typeof data.channel === 'string' ? data.channel.slice(0, 40) : '';
    items.push(channel ? ['ok', t('chk.channel', { name: channel })] : ['err', t('chk.noChannel')]);
    items.push(f.subscribers === true ? ['ok', t('chk.app')] : ['warn', t('chk.noApp')]);
    var tunnel = typeof data.tunnel === 'string' && /^https:\/\/[a-z0-9.-]+\.trycloudflare\.com\/kick\/webhook$/.test(data.tunnel) ? data.tunnel : '';
    items.push(tunnel ? ['ok', t('chk.tunnel'), tunnel] : ['warn', t('chk.noTunnel')]);
    items.push(f.chat === true ? ['ok', t('chk.chat')] : ['warn', t('chk.noChat')]);
    items.push(typeof data.lastEventAt === 'number' && isFinite(data.lastEventAt)
      ? ['ok', t('chk.event', { ago: ago(now - data.lastEventAt) })] : ['warn', t('chk.noEvent')]);
    return items;
  }

  function renderChecklist(items) {
    var key = JSON.stringify(items);
    if (key === lastChecklist) return;
    lastChecklist = key;
    var list = $('kurulum-liste');
    list.textContent = '';
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.className = 'is-' + it[0];
      var mark = document.createElement('span');
      mark.className = 'st-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = MARK[it[0]];
      var text = document.createElement('span');
      text.textContent = it[1];
      li.append(mark, text);
      if (it[2]) {
        var code = document.createElement('code');
        code.textContent = ' ' + it[2];
        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'st-linkbtn';
        copy.textContent = t('chk.copy');
        copy.addEventListener('click', function () {
          navigator.clipboard.writeText(it[2]).then(function () { toast(t('chk.copied')); }, function () { toast(t('chk.copyFail'), true); });
        });
        li.append(code, copy);
      }
      list.appendChild(li);
    });
    $('kurulum').hidden = false;
  }

  async function refreshChecklist() {
    if (document.hidden) return;
    try {
      var res = await fetch(K.relayUrl(window.location.origin + '/health'), { cache: 'no-store' });
      var data = res.ok ? await res.json() : null;
      if (data && data.ok) renderChecklist(checklistItems(data, Date.now()));
    } catch (e) { /* relay stopped: keep the last list */ }
  }

  function downloadLocal() {
    if (SELF) { saveLocalToRelay(); return; }
    var id = $('kickClientId').value.trim();
    var secret = $('kickClientSecret').value.trim();
    if (!id || !secret) { say(kickStatus, 'err', t('e.localNeed')); return; }
    var text = [
      '/* ' + t('localFile') + ' */',
      'window.KICK_OVERLAY_YEREL = { kickClientId: ' + JSON.stringify(id) +
        ', kickClientSecret: ' + JSON.stringify(secret) + ' };',
      ''
    ].join('\n');
    download('AYARLAR.local.js', text, 'text/javascript;charset=utf-8');
    say(kickStatus, 'ok', t('e.localDone'));
  }

  // ---- Saved state (public values only, never secrets) ----------------------

  function saveDraft() {
    try {
      var raw = readRaw();
      if (relayValue() !== RELAY_DEFAULT) raw.relayAdresi = relayValue();
      localStorage.setItem(DRAFT_KEY, JSON.stringify(raw));
    } catch (e) { /* storage blocked: optional */ }
  }

  function loadDraft() {
    try {
      var saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        writeForm(K.normalize(saved));
        var r = K.normalizeLocal({ relayAdresi: saved.relayAdresi }).relayAdresi;
        relayEl.value = r === RELAY_DEFAULT ? '' : r;
      }
    } catch (e) { /* storage blocked or corrupt draft: keep defaults */ }
  }

  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ lang: lang, tab: activeId, bg: background })); } catch (e) { /* optional */ }
  }

  function loadUi() {
    var ui = null;
    try { ui = JSON.parse(localStorage.getItem(UI_KEY) || 'null'); } catch (e) { /* storage blocked or corrupt: defaults */ }
    // The first browser language the studio has, else English.
    var prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
    var guess = 'en';
    for (var i = 0; i < prefs.length; i++) {
      var code = String(prefs[i] || '').slice(0, 2).toLowerCase();
      if (LANGS.indexOf(code) >= 0) { guess = code; break; }
    }
    lang = ui && LANGS.indexOf(ui.lang) >= 0 ? ui.lang : guess;
    if (ui && typeof ui.tab === 'string') activeId = overlayById(ui.tab).id;
    if (ui && typeof ui.bg === 'string') background = BACKGROUNDS.indexOf(ui.bg) >= 0 ? ui.bg : 'checker';
  }

  // ---- Accent contrast ------------------------------------------------------

  // Approximate bar surfaces: pastel and paper are light, every other theme sits on a dark surface.
  var LIGHT_SURFACE = { pastel: '#ffffff', paper: '#fbf6ea' };
  var DARK_SURFACE = '#14171f';

  function luminance(hex) {
    var h = hex6(hex).slice(1);
    var c = [0, 2, 4].map(function (i) {
      var v = parseInt(h.substr(i, 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // Dark themes need an accent that stands out (3:1). Light themes tint the fill with the accent, so only a near-white one disappears.
  function checkAccent(s) {
    var warn = $('renk-uyari');
    var light = Object.prototype.hasOwnProperty.call(LIGHT_SURFACE, s.stil);
    var ratio = contrast(s.renk, light ? LIGHT_SURFACE[s.stil] : DARK_SURFACE);
    var bad = light ? ratio < 1.6 : ratio < 3;
    warn.hidden = !bad;
    warn.textContent = bad ? t(light ? 'warn.accentLight' : 'warn.accentDark', { theme: labelOf('stil', s.stil), ratio: ratio.toFixed(1) }) : '';
  }

  // The overlays ignore a custom CSS value they refuse, so the studio says so instead of showing nothing.
  function checkCss() {
    var raw = $('ozelCss').value.trim();
    var refused = raw !== '' && K.normalize({ ozelCss: raw }).ozelCss === '';
    var warn = $('css-uyari');
    warn.hidden = !refused;
    warn.textContent = refused ? t('warn.css') : '';
  }

  // ---- Relay check -----------------------------------------------------------

  // A running relay's /health as [level, text] lines, each telling the streamer what to do next.
  // An older relay has no lastEventAt; its version line already asks for the update.
  function relayDiag(data, now) {
    var f = data.features && typeof data.features === 'object' ? data.features : {};
    var v = String(data.version || '?').slice(0, 20);
    var out = [];
    out.push(v === K.version ? ['ok', t('relay.d.versionOk')] : ['warn', t('relay.d.version', { relay: v, pack: K.version })]);
    out.push(f.chat === true ? ['ok', t('relay.d.chatOk')] : ['err', t('relay.d.chatNo')]);
    if (typeof data.lastEventAt === 'number' && isFinite(data.lastEventAt)) out.push(['ok', t('relay.d.events', { ago: ago(now - data.lastEventAt) })]);
    else if (Object.prototype.hasOwnProperty.call(data, 'lastEventAt')) out.push(['warn', t('relay.d.noEvents')]);
    out.push(f.subscribers === true ? ['ok', t('relay.d.subsOk')] : ['warn', t('relay.d.subsNo')]);
    if (typeof data.tunnel === 'string' && /^https:\/\/[a-z0-9.-]+\.trycloudflare\.com\/kick\/webhook$/.test(data.tunnel)) out.push(['ok', t('relay.d.tunnel', { url: data.tunnel })]);
    // The three newest warnings or errors the relay logged, newest first.
    (Array.isArray(data.recentErrors) ? data.recentErrors.slice(-3).reverse() : []).forEach(function (e) {
      if (!e || typeof e.msg !== 'string' || typeof e.at !== 'number') return;
      out.push([e.level === 'error' ? 'err' : 'warn', t('relay.d.log', { ago: ago(now - e.at), msg: e.msg.slice(0, 200) })]);
    });
    return out;
  }

  function ago(ms) {
    var sec = Math.max(0, Math.round(ms / 1000));
    var pick = sec < 60 ? [sec, 'second'] : sec < 3600 ? [Math.round(sec / 60), 'minute'] : sec < 86400 ? [Math.round(sec / 3600), 'hour'] : [Math.round(sec / 86400), 'day'];
    return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-pick[0], pick[1]);
  }

  var MARK = { ok: '✓', warn: '!', err: '✗' };
  function showDiag(lines) {
    var list = $('relay-tani');
    list.textContent = '';
    lines.forEach(function (l) {
      var li = document.createElement('li');
      li.className = 'is-' + l[0];
      var mark = document.createElement('span');
      mark.className = 'st-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = MARK[l[0]];
      var text = document.createElement('span');
      text.textContent = l[1];
      li.append(mark, text);
      list.appendChild(li);
    });
    list.hidden = lines.length === 0;
  }

  async function checkRelay() {
    var btn = $('relayKontrol');
    var box = $('relay-durum');
    var base = relayValue();
    btn.disabled = true;
    showDiag([]);
    if (K.relayBlocked()) { say(box, 'err', t('relay.hosted')); btn.disabled = false; return; }
    say(box, '', t('relay.checking'));
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 2000);
    try {
      var res = await fetch(K.relayUrl(base + '/health'), { signal: ctl.signal, cache: 'no-store' });
      if (res.status === 401) { say(box, 'err', t('relay.key')); return; }
      var data = res.ok ? await res.json() : null;
      if (!res.ok || !data || data.ok !== true) { say(box, 'err', t('relay.bad', { status: res.status })); return; }
      say(box, 'ok', t('relay.ok', { v: String(data.version || '?').slice(0, 20), n: Number(data.clients) || 0 }));
      showDiag(relayDiag(data, Date.now()));
    } catch (e) {
      say(box, 'err', t('relay.down', { url: base }));
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
    }
  }

  // ---- Alert sound and test alerts ----------------------------------------------

  var TEST_KINDS = ['follow', 'sub', 'gift', 'kicks', 'reward'];
  var soundTry = { level: -1, media: null, next: 0 };

  async function trySound() {
    var s = currentSettings();
    var box = $('test-durum');
    if (!s.uyariSes || !s.uyariSesSeviye) { say(box, 'err', t('test.muted')); return; }
    // One probe of the alerts/ folder per volume, not one per click.
    if (soundTry.level !== s.uyariSesSeviye) {
      soundTry.level = s.uyariSesSeviye;
      soundTry.media = K.createAlertMedia(s, TEST_KINDS);
    }
    await soundTry.media.ready;
    var kind = TEST_KINDS[soundTry.next % TEST_KINDS.length];
    soundTry.next += 1;
    var r = soundTry.media.play(kind);
    say(box, r === 'blocked' ? 'err' : 'ok', r === 'blocked' ? t('test.blocked') : t('test.played', { kind: kind }));
  }

  async function sendTestAlert(kind, btn) {
    var box = $('test-durum');
    var base = relayValue();
    if (K.relayBlocked()) { say(box, 'err', t('relay.hosted')); return; }
    btn.disabled = true;
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 2000);
    try {
      var res = await fetch(K.relayUrl(base + '/test-alert?kind=' + encodeURIComponent(kind)), { method: 'POST', signal: ctl.signal, cache: 'no-store' });
      if (res.status === 401) { say(box, 'err', t('relay.key')); return; }
      if (res.status === 429) { say(box, 'err', t('test.rate')); return; }
      var data = res.ok ? await res.json() : null;
      if (!data || data.ok !== true) { say(box, 'err', t('relay.bad', { status: res.status })); return; }
      var n = Number(data.clients) || 0;
      say(box, n ? 'ok' : 'err', n ? t('test.sent', { n: n }) : t('test.none'));
    } catch (e) {
      say(box, 'err', t('relay.down', { url: base }));
    } finally {
      clearTimeout(timer);
      btn.disabled = false;
    }
  }

  // ---- Export and import (public settings only) ---------------------------------

  var IMPORT_MAX = 100 * 1024;

  function exportSettings() {
    var s = currentSettings();
    var settings = {};
    K.schemaKeys().forEach(function (key) { settings[key] = s[key]; });
    if (relayValue() !== RELAY_DEFAULT) settings.relayAdresi = relayValue();
    var text = JSON.stringify({ app: 'kick-overlay-studio', version: 1, settings: settings }, null, 2) + '\n';
    try {
      download('kick-overlay-ayarlar.json', text, 'application/json;charset=utf-8');
      say($('yedek-durum'), 'ok', t('backup.exported'));
    } catch (e) {
      say($('yedek-durum'), 'err', t('out.dlFail'));
    }
  }

  function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  // Whitelist first, then K.normalize: unknown keys, credentials and non-primitive values never get in.
  function importSettings(file) {
    var box = $('yedek-durum');
    if (!file) return;
    if (file.size > IMPORT_MAX) { say(box, 'err', t('backup.tooBig')); return; }
    var reader = new FileReader();
    reader.onerror = function () { say(box, 'err', t('backup.badFile')); };
    reader.onload = function () {
      var data;
      try { data = JSON.parse(String(reader.result)); } catch (e) { data = null; }
      var src = isPlainObject(data) && isPlainObject(data.settings) ? data.settings : data;
      if (!isPlainObject(src)) { say(box, 'err', t('backup.badFile')); return; }
      var allowed = K.schemaKeys().concat(['relayAdresi']);
      var picked = {};
      var count = 0, ignored = 0;
      Object.keys(src).forEach(function (key) {
        var v = src[key];
        var primitive = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
        if (allowed.indexOf(key) >= 0 && primitive) { picked[key] = v; count++; } else { ignored++; }
      });
      if (!count) { say(box, 'err', t('backup.empty')); return; }
      writeForm(K.normalize(Object.assign(readRaw(), picked)));
      if (Object.prototype.hasOwnProperty.call(picked, 'relayAdresi')) {
        var r = K.normalizeLocal({ relayAdresi: picked.relayAdresi }).relayAdresi;
        relayEl.value = r === RELAY_DEFAULT ? '' : r;
      }
      update();
      say(box, 'ok', t('backup.imported', { n: count }) + (ignored ? t('backup.ignored', { n: ignored }) : ''));
    };
    reader.readAsText(file);
  }

  // ---- Main update ----------------------------------------------------------

  function update() {
    var s = currentSettings();
    document.documentElement.style.setProperty('--st-accent', s.renk);
    paintChoices();
    out.value = buildAyarlar(s);
    refreshCards(s);
    checkAccent(s);
    checkCss();
    saveDraft();
    markDirty();
    scheduleFrame();
  }

  // ---- Events ---------------------------------------------------------------

  function bindEvents() {
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    form.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'renk') {
        $('renkMetin').value = el.value;
      } else if (el.id === 'renkMetin') {
        var v = el.value.trim();
        var h = v.charAt(0) === '#' ? v : '#' + v;
        if (HEX_RE.test(h)) $('renk').value = hex6(h).toLowerCase();
      }
      update();
    });

    // Blur or pick: write the normalized values back so the form shows what is used.
    form.addEventListener('change', function () {
      writeForm(currentSettings());
      if (relayEl.value.trim()) relayEl.value = relayValue();
      update();
    });

    document.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = PRESETS[btn.getAttribute('data-preset')];
        if (!p) return;
        writeForm(K.normalize(Object.assign(currentSettings(), p)));
        update();
      });
    });

    // Two-step reset: an inline question instead of a native dialog, so keyboard and screen readers stay in the page.
    var resetBox = $('sifirla-onay');
    function closeReset() { resetBox.hidden = true; $('sifirla').focus(); }
    $('kanalaGit').addEventListener('click', function () {
      var k = $('kanal');
      k.focus({ preventScroll: true });
      k.scrollIntoView({ block: 'center' });
    });
    $('sifirla').addEventListener('click', function () {
      resetBox.hidden = false;
      $('sifirlaIptal').focus();
    });
    $('sifirlaIptal').addEventListener('click', closeReset);
    resetBox.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeReset(); });
    $('sifirlaEvet').addEventListener('click', function () {
      var keep = currentSettings().kanal;
      writeForm(K.normalize({ kanal: keep }));
      relayEl.value = '';
      update();
      closeReset();
      toast(t('reset.done'));
    });

    $('pv-canli').addEventListener('click', toggleLive);
    $('hepsiniKopyala').addEventListener('click', copyAllLinks);
    $('obsIndir').addEventListener('click', downloadObsCollection);
    $('dockKopyala').addEventListener('click', copyDockLink);
    $('relayKontrol').addEventListener('click', checkRelay);
    $('sesDene').addEventListener('click', trySound);
    Array.prototype.forEach.call(document.querySelectorAll('[data-test-alert]'), function (b) {
      b.addEventListener('click', function () { sendTestAlert(b.getAttribute('data-test-alert'), b); });
    });
    $('disaAktar').addEventListener('click', exportSettings);
    $('iceAktar').addEventListener('click', function () { $('iceAktarDosya').click(); });
    $('iceAktarDosya').addEventListener('change', function (e) {
      importSettings(e.target.files && e.target.files[0]);
      e.target.value = '';
    });

    document.querySelectorAll('[data-lang]').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); });
    });

    $('gizliGoster').addEventListener('change', function (e) {
      var type = e.target.checked ? 'text' : 'password';
      $('kickClientId').type = type;
      $('kickClientSecret').type = type;
    });

    // Changing the secret must drop any token the core cached for the old one.
    ['kickClientId', 'kickClientSecret'].forEach(function (id) {
      $(id).addEventListener('input', function () { K.official.clearToken(); });
    });

    $('indir').addEventListener('click', function () {
      try {
        download('AYARLAR.js', out.value, 'text/javascript;charset=utf-8');
        say(outStatus, 'ok', t('out.downloaded'));
      } catch (e) {
        say(outStatus, 'err', t('out.dlFail'));
      }
    });

    $('kopyala').addEventListener('click', copyOutput);
    kickTestBtn.addEventListener('click', testKick);
    $('yerelIndir').addEventListener('click', downloadLocal);
    $('relayKaydet').addEventListener('click', saveToRelay);
    $('olayBagla').addEventListener('click', connectEvents);

    window.addEventListener('resize', fitPreview);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitPreview).observe(stage);
  }

  // ---- New version notice -----------------------------------------------------

  // One request to GitHub's public API a day at most; the answer is cached here. Only a version number is read
  // from it, and the link is fixed, so nothing in the response can steer the page.
  var UPDATE_KEY = 'kickOverlayStudio.surum';
  var UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;
  var UPDATE_URL = 'https://api.github.com/repos/IACBI/kick-streamer-overlays/releases/latest';
  var SEMVER = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

  function newer(a, b) {
    var x = SEMVER.exec(a), y = SEMVER.exec(b);
    if (!x || !y) return false;
    for (var i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
    return false;
  }

  function showUpdate(latest) {
    if (!newer(latest, K.version)) return;
    $('guncelleme-metin').textContent = t('update.text', { latest: latest.replace(/^v/, ''), current: K.version });
    $('guncelleme').hidden = false;
  }

  async function checkUpdate() {
    if (!/^https?:|^file:/.test(window.location.protocol)) return;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(UPDATE_KEY) || 'null'); } catch (e) { /* storage blocked or corrupt: ask GitHub */ }
    if (cached && typeof cached.tag === 'string' && Date.now() - Number(cached.at) < UPDATE_EVERY_MS) { showUpdate(cached.tag); return; }
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 5000);
    try {
      var res = await fetch(UPDATE_URL, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) return;
      var data = await res.json();
      var tag = data && typeof data.tag_name === 'string' && SEMVER.test(data.tag_name) ? data.tag_name : '';
      if (!tag) return;
      try { localStorage.setItem(UPDATE_KEY, JSON.stringify({ tag: tag, at: Date.now() })); } catch (e) { /* optional */ }
      showUpdate(tag);
    } catch (e) {
      // Offline or rate-limited: no notice, try again next time.
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Init -----------------------------------------------------------------

  loadUi();
  buildChoices();
  buildPresets();
  buildTabs();
  buildCards();
  if (SELF) {
    $('kaydetKutu').hidden = false;
    $('s4-again').hidden = true;
    $('yerelIndir').setAttribute('data-i18n', 's5.saveRelay');
    $('olayBagla').hidden = false;
    document.querySelector('[data-i18n="s5.hint"]').setAttribute('data-i18n', 's5.hintRelay');
    document.querySelector('[data-i18n="s5.intro"]').setAttribute('data-i18n', 's5.introRelay');
  }
  writeForm(K.normalize({}));
  if (!SELF) loadDraft();
  bindEvents();
  applyI18n();
  setBackground(background);
  selectTab(activeId, false);
  update();
  fitPreview();
  checkUpdate();
  if (SELF) {
    loadFromRelay();
    refreshChecklist();
    setInterval(refreshChecklist, CHECK_MS);
  }
})();
