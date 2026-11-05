  // ---- Parsers (pure) --------------------------------------------------------

  function numOrNull(v) {
    var n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }

  function parseTime(v) {
    if (typeof v !== 'string' || !v) return null;
    var st = v.replace(' ', 'T');
    var hasZone = /Z$|[+-]\d\d:?\d\d$/.test(st);
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
    if (!ls || ls.is_live === false) return { live: false, viewers: 0, startMs: null, title: '' };
    return {
      live: true,
      viewers: numOrNull(ls.viewer_count) || 0,
      startMs: parseTime(ls.start_time || ls.created_at || ''),
      title: typeof ls.session_title === 'string' ? ls.session_title.trim().slice(0, 140) : ''
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


