  // ---- Kick REST (public, no token) ----------------------------------------

  var RELAY_RETRY_MS = 5 * 60 * 1000;
  var LOOPBACK_NAME = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;
  var relayMemo = {};

  // The relay answers only requests that carry its local access key (AYARLAR.relay.js, read at call time).
  // Without the key it answers 401, and callers fall back as they do when the relay is down.
  function relayUrl(url) {
    var key = global.KICK_RELAY_KEY;
    if (!key) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'key=' + encodeURIComponent(key);
  }

  // Why this page cannot use the local relay, or '' when it can:
  //   'localFile' OBS 33 loads a "Local file" source from http://absolute/, and its browser (Chromium's Local Network
  //               Access) does not let such a page reach 127.0.0.1. A link pasted into the URL box is not affected.
  //   'hosted'    the page comes from a web site (GitHub Pages, say). The relay accepts only file:// and loopback
  //               origins, and the access key file is never published, so every request would be refused.
  // The relay is then skipped, not retried: each attempt would fail, and a public page should not probe 127.0.0.1.
  function relayBlockReason() {
    var loc = global.location;
    if (!loc || !loc.protocol || relayServed()) return '';
    if (loc.protocol === 'http:' && loc.hostname === 'absolute') return 'localFile';
    if ((loc.protocol === 'http:' || loc.protocol === 'https:') && !LOOPBACK_NAME.test(loc.hostname || '')) return 'hosted';
    return '';
  }

  function relayBlocked() {
    return relayBlockReason() !== '';
  }

  // The overlay note for a page that cannot reach the relay.
  function relayBlockedNote(s) {
    return relayBlockReason() === 'hosted' ? t(s, 'note.hosted') : t(s, 'note.localFile');
  }

  // Asks the local relay what it can do. Memoized per page; a failed probe is retried at most every 5 minutes.
  function relayInfo(s) {
    var base = s && s.relayAdresi;
    if (!base || relayBlocked()) return Promise.resolve(null);
    var m = relayMemo[base];
    if (m) {
      if (m.promise) return m.promise;
      if (Date.now() - m.failedAt < RELAY_RETRY_MS) return Promise.resolve(null);
    }
    m = relayMemo[base] = { promise: null, failedAt: 0 };
    var p = getJson(relayUrl(base + '/health'), { timeoutMs: 1500 }).then(function (r) {
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
        var rr = await getJson(relayUrl(s.relayAdresi + '/channel?slug=' + enc));
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

