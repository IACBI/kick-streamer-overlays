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
      var r = await getJson(relayUrl(s.relayAdresi + '/subscribers?slug=' + encodeURIComponent(s.kanal)));
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

