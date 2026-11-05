  // ---- Live chat from the local relay (relay/server.js). ----

  var ES_CLOSED = 2;
  // Event names the relay streams (relay/server.js). Each page acts on the kinds it shows and ignores the rest.
  var RELAY_EVENTS = ['chat', 'ban', 'delete', 'follow', 'sub', 'gift', 'kicks', 'reward', 'live', 'meta', 'control', 'overlay', 'stats'];

  // Server-Sent Events: the relay sends chat, ban, alert and stream frames (RELAY_EVENTS) already in the overlay's shape.
  // h = { onMessage(event), onStatus(status) }. Status: 'connecting', 'open', 'reconnecting', or 'blocked' (see relayBlocked; nothing is tried).
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
      RELAY_EVENTS.forEach(forward);
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
      try { es = new global.EventSource(relayUrl(url)); } catch (e) { retry(); return; }
      attach(es);
    }
    if (relayBlocked()) {
      status('blocked');
      return function stop() {};
    }
    status('connecting');
    es = new global.EventSource(relayUrl(url));
    attach(es);
    return function stop() {
      stopped = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (es) es.close();
    };
  }

