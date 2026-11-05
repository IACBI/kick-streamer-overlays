  // ---- Stream stats from the relay (recent events, leaderboards) ----

  // Stroke icons per alert kind (24 × 24), shared by the alert card and the recent events list.
  var ALERT_ICONS = {
    follow: ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'],
    sub: ['M12 3.2l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6 6.8 19.4l1-5.9L3.5 9.4l5.9-.8L12 3.2z'],
    gift: ['M4 10h16v10H4z', 'M3 7h18v3H3zM12 7v13', 'M12 7C12 7 11.4 3.5 9 4c-1.9.4-1.4 3 3 3zM12 7c0 0 .6-3.5 3-3 1.9.4 1.4 3-3 3z'],
    kicks: ['M13 2L4 14h7l-1 8 9-12h-7l1-8z'],
    reward: ['M12 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z', 'M8.6 13.4L7 21l5-2.8 5 2.8-1.6-7.6']
  };

  function alertIcon(kind) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = global.document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    (ALERT_ICONS[kind] || []).forEach(function (d) {
      var p = global.document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  var STAT_KINDS = ['follow', 'sub', 'gift', 'kicks'];
  function cleanName(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : ''; }
  function statNum(v, min) { return typeof v === 'number' && isFinite(v) && v >= min ? Math.floor(v) : null; }

  // One recent event as the relay sends it, checked: anything odd is dropped rather than shown.
  function statEvent(e) {
    if (!e || typeof e !== 'object' || STAT_KINDS.indexOf(e.kind) === -1) return null;
    var anonymous = e.kind === 'gift' && e.anonymous === true;
    var name = anonymous ? '' : cleanName(e.name);
    if (!name && !anonymous) return null;
    return {
      kind: e.kind, name: name, anonymous: anonymous, at: statNum(e.at, 0) || 0,
      count: statNum(e.count, 1) || 1, amount: statNum(e.amount, 0) || 0, months: statNum(e.months, 1) || 1
    };
  }

  // The relay's stats frame (relay/stats.js), checked field by field before a page uses it.
  function parseStats(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    var t = raw.totals || {};
    var board = function (list, field) {
      return (Array.isArray(list) ? list : []).map(function (x) {
        var name = cleanName(x && x.name), v = statNum(x && x[field], 1);
        if (!name || v === null) return null;
        var out = { name: name };
        out[field] = v;
        return out;
      }).filter(Boolean).slice(0, 10);
    };
    return {
      totals: { follows: statNum(t.follows, 0) || 0, subs: statNum(t.subs, 0) || 0, gifted: statNum(t.gifted, 0) || 0, kicks: statNum(t.kicks, 0) || 0 },
      recent: (Array.isArray(raw.recent) ? raw.recent : []).map(statEvent).filter(Boolean).slice(0, 20),
      topGifters: board(raw.topGifters, 'count'),
      topKicks: board(raw.topKicks, 'amount'),
      subTimes: (Array.isArray(raw.subTimes) ? raw.subTimes : []).filter(function (x) {
        return x && statNum(x.at, 0) !== null && statNum(x.n, 1) !== null;
      }).map(function (x) { return { at: x.at, n: x.n }; }).slice(-500)
    };
  }

  // The name and the one-line detail of a recent event, in the label language.
  function eventText(s, e) {
    var name = e.anonymous ? t(s, 'name.anonymous') : e.name;
    switch (e.kind) {
      case 'follow': return { name: name, detail: t(s, 'event.followed') };
      case 'sub': return { name: name, detail: e.months > 1 ? t(s, 'event.subMonths', { n: e.months }) : t(s, 'event.subscribed') };
      case 'gift': return { name: name, detail: t(s, 'event.gifted', { n: e.count }) };
      case 'kicks': return { name: name, detail: t(s, 'event.kicks', { n: e.amount }) };
    }
    return { name: name, detail: '' };
  }

  // Sample stats for previews and sample mode: no request, the same every time.
  function sampleStats(nowMs) {
    var now = nowMs || Date.now();
    return parseStats({
      totals: { follows: 18, subs: 6, gifted: 15, kicks: 2650 },
      recent: [
        { kind: 'kicks', name: 'Luna', amount: 500, at: now - 20000 },
        { kind: 'gift', name: 'Alex', count: 5, at: now - 80000 },
        { kind: 'sub', name: 'Sora', months: 6, at: now - 140000 },
        { kind: 'follow', name: 'Mia', at: now - 200000 },
        { kind: 'sub', name: 'Kenji', months: 1, at: now - 260000 },
        { kind: 'follow', name: 'Rin', at: now - 320000 },
        { kind: 'gift', anonymous: true, count: 1, at: now - 380000 },
        { kind: 'kicks', name: 'Noah', amount: 100, at: now - 440000 },
        { kind: 'follow', name: 'Ivy', at: now - 500000 },
        { kind: 'follow', name: 'Theo', at: now - 560000 }
      ],
      topGifters: [{ name: 'Alex', count: 10 }, { name: 'Mia', count: 3 }, { name: 'Kenji', count: 1 }, { name: 'Sora', count: 1 }, { name: 'Ivy', count: 1 }],
      topKicks: [{ name: 'Luna', amount: 1500 }, { name: 'Noah', amount: 600 }, { name: 'Rin', amount: 300 }, { name: 'Theo', amount: 150 }, { name: 'Mia', amount: 100 }],
      subTimes: [{ at: now - 80000, n: 5 }, { at: now - 140000, n: 1 }]
    });
  }

  // Rewards the streamer hid from the alerts (uyariOdulGizle: titles separated by |), compared without case.
  function rewardHidden(s, title) {
    var t = String(title || '').trim().toLowerCase();
    if (!t) return false;
    return String(s.uyariOdulGizle || '').split('|').some(function (x) { return x.trim().toLowerCase() === t; });
  }

  // What text-to-speech reads for a Kicks or reward alert, or '' for nothing. Links are dropped and the message is
  // cut at a word break. When the name or the message contains a blocked word
  // (uyariTtsYasak: comma separated, any case, also inside longer words), nothing is read at all: a partly
  // read message could still say what the filter is there to stop.
  function ttsText(s, ev) {
    if (s.uyariTts !== true || !ev || (ev.kind !== 'kicks' && ev.kind !== 'reward')) return '';
    var clean = function (v) {
      return String(v || '').replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ').replace(/\s+/g, ' ').trim();
    };
    var msg = clean(ev.message);
    var name = clean(ev.username).slice(0, 40);
    if (!msg) return '';
    var hay = (name + ' ' + msg).toLowerCase();
    var blocked = String(s.uyariTtsYasak || '').split(',').some(function (w) {
      w = w.trim().toLowerCase();
      return w !== '' && hay.indexOf(w) !== -1;
    });
    if (blocked) return '';
    var max = Number(s.uyariTtsUzunluk) || 120;
    if (msg.length > max) {
      // One character past the limit shows whether the cut falls on a word break; with no break, cut hard.
      var cut = msg.slice(0, max + 1).replace(/\s+\S*$/, '');
      msg = cut && cut.length <= max ? cut : msg.slice(0, max);
    }
    return name ? name + ': ' + msg : msg;
  }

  // Sound and art for the alert overlay. `kinds` are the alert kinds in use; base is the folder the files live in.
  // play(kind) returns what it did: 'off', 'file', 'tone' or 'blocked' (no Web Audio, or the page may not play sound).
  function createAlertMedia(s, kinds, base) {
    base = base || 'alerts/';
    var volume = Math.max(0, Math.min(100, Number(s.uyariSesSeviye) || 0)) / 100;
    var soundOn = s.uyariSes === true && volume > 0;
    var sounds = {}, art = {};
    var ctx = null, playing = null;

    async function first(kind, exts, typeOf) {
      for (var i = 0; i < exts.length; i++) {
        var src = base + kind + '.' + exts[i];
        var type = typeOf(exts[i]);
        if (await probeMedia(src, type)) return { src: src, video: type === 'video' };
      }
      return null;
    }

    var ready = Promise.all((kinds || []).filter(function (k) { return Object.prototype.hasOwnProperty.call(ALERT_TONES, k); }).map(function (k) {
      return Promise.all([
        soundOn ? first(k, ALERT_SOUND_EXT, function () { return 'audio'; }) : null,
        first(k, ALERT_ART_EXT, function (ext) { return ext === 'webm' ? 'video' : 'image'; })
      ]).then(function (r) { sounds[k] = r[0]; art[k] = r[1]; });
    }));

    function tone(kind) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(function () {});
        var t0 = ctx.currentTime + 0.02;
        var master = ctx.createGain();
        master.gain.value = volume * 0.35;   // the tones are pure; this keeps 100 % near a normal alert's loudness
        master.connect(ctx.destination);
        ALERT_TONES[kind].forEach(function (n) {
          var o = ctx.createOscillator(), g = ctx.createGain(), st = t0 + n[1], end = st + n[2];
          o.type = ALERT_WAVE[kind];
          o.frequency.value = n[0];
          g.gain.setValueAtTime(0.0001, st);
          g.gain.exponentialRampToValueAtTime(1, st + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, end);
          o.connect(g);
          g.connect(master);
          o.start(st);
          o.stop(end + 0.02);
        });
        return true;
      } catch (e) { return false; }
    }

    function play(kind) {
      if (!soundOn || !Object.prototype.hasOwnProperty.call(ALERT_TONES, kind)) return 'off';
      if (playing) { try { playing.pause(); } catch (e) { /* already stopped */ } playing = null; }
      if (sounds[kind] && typeof global.Audio === 'function') {
        try {
          var a = new global.Audio(sounds[kind].src);
          a.volume = volume;
          var p = a.play();
          if (p && typeof p.catch === 'function') p.catch(function () {});
          playing = a;
          return 'file';
        } catch (e) { /* fall back to the tone */ }
      }
      return tone(kind) ? 'tone' : 'blocked';
    }

    return {
      ready: ready,
      play: play,
      art: function (kind) { return art[kind] || null; }
    };
  }

