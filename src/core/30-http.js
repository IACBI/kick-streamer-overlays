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

