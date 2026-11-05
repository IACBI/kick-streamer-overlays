  // ---- Alert sound and art (alerts.html) ----------------------------------

  // Built-in tones per alert kind, as [frequency Hz, start s, length s]. They are synthesized with Web Audio,
  // so the pack ships no sound files to license or load. A file in alerts/ replaces the tone for its kind.
  var ALERT_TONES = {
    follow: [[659.25, 0, 0.2], [880, 0.13, 0.42]],
    sub: [[523.25, 0, 0.16], [659.25, 0.1, 0.16], [783.99, 0.2, 0.18], [1046.5, 0.3, 0.5]],
    gift: [[1318.5, 0, 0.12], [1568, 0.07, 0.12], [1760, 0.14, 0.12], [2093, 0.21, 0.45]],
    kicks: [[987.77, 0, 0.09], [1318.5, 0.08, 0.5]],
    reward: [[783.99, 0, 0.14], [987.77, 0.11, 0.14], [1174.66, 0.22, 0.4]]
  };
  var ALERT_WAVE = { follow: 'sine', sub: 'sine', gift: 'triangle', kicks: 'triangle', reward: 'sine' };
  // Only fixed names in the local alerts/ folder are tried. Nothing is ever loaded from a URL in the settings,
  // so a link cannot make an overlay fetch remote content.
  var ALERT_SOUND_EXT = ['mp3', 'ogg', 'wav'];
  var ALERT_ART_EXT = ['webm', 'png', 'gif', 'webp'];
  var MEDIA_PROBE_MS = 4000;

  function probeMedia(src, type) {
    return new Promise(function (resolve) {
      var doc = global.document, el = null, done = false;
      function finish(ok) { if (done) return; done = true; clearTimeout(timer); resolve(ok); }
      var timer = setTimeout(function () { finish(false); }, MEDIA_PROBE_MS);
      try {
        if (type === 'audio' && typeof global.Audio === 'function') {
          el = new global.Audio();
          el.preload = 'auto';
          el.oncanplaythrough = function () { finish(true); };
        } else if (type === 'video' && doc) {
          el = doc.createElement('video');
          el.muted = true;
          el.preload = 'auto';
          el.onloadeddata = function () { finish(true); };
        } else if (type === 'image' && typeof global.Image === 'function') {
          el = new global.Image();
          el.onload = function () { finish(true); };
        }
      } catch (e) { el = null; }
      if (!el) return finish(false);
      el.onerror = function () { finish(false); };
      el.src = src;
    });
  }

