  // ---- Labels, numbers, look ---------------------------------------------

  // Intl locale per label language. Arabic keeps Latin digits: viewers read stream numbers at a glance,
  // and the Arabic-Indic forms change the width of goal bars between languages.
  var LOCALES = { tr: 'tr-TR', en: 'en-US', both: 'en-US', es: 'es-ES', pt: 'pt-BR', de: 'de-DE', ar: 'ar-u-nu-latn' };
  var RTL = { ar: true };

  // Numbers follow the label language (1.234 in tr, 1,234 in en). useLang() sets it.
  var numLocale = 'en-US';

  var pluralCache = {};
  function pluralOf(lang, n) {
    if (typeof Intl === 'undefined' || !Intl.PluralRules) return n === 1 ? 'one' : 'other';
    var r = pluralCache[lang] || (pluralCache[lang] = new Intl.PluralRules(LOCALES[lang] || 'en-US'));
    return r.select(n);
  }

  // One message from shared/lang/<lang>.js, falling back to English, then to the key itself.
  function message(lang, key, vars) {
    var packs = global.KICK_LANG || {};
    var v = (packs[lang] || {})[key];
    if (v == null) { lang = 'en'; v = (packs.en || {})[key]; }
    if (v == null) return key;
    if (typeof v === 'object') {
      var c = pluralOf(lang, Number(vars && vars.n) || 0);
      v = v[c] != null ? v[c] : v.other;
    }
    return String(v).replace(/\{(\w+)\}/g, function (m, k) {
      if (!vars || vars[k] == null) return m;
      return k === 'n' ? fmt(vars[k]) : String(vars[k]);
    });
  }

  /** A label in the settings language; "both" shows Turkish / English. vars fill {name} slots, {n} also picks the plural. */
  function t(s, key, vars) {
    if (s.dil === 'both') return message('tr', key, vars) + ' / ' + message('en', key, vars);
    return message(LOCALES[s.dil] ? s.dil : 'en', key, vars);
  }

  /** Sets the page language, writing direction and number locale from the settings. */
  function useLang(s) {
    var root = global.document && global.document.documentElement;
    numLocale = LOCALES[s.dil] || 'en-US';
    if (!root) return;
    // Lets the browser apply the right language rules (hyphenation, screen readers). "both" stays English.
    root.lang = s.dil === 'both' || !LOCALES[s.dil] ? 'en' : s.dil;
    root.dir = RTL[s.dil] ? 'rtl' : 'ltr';
  }

  /** The BCP 47 tag for speech and dates; "both" speaks Turkish, the first half of its labels. */
  function speechLang(s) {
    return s.dil === 'both' ? 'tr-TR' : s.dil === 'ar' ? 'ar-SA' : (LOCALES[s.dil] || 'en-US');
  }

  var fmtCache = {};
  function fmt(n) {
    var v = Math.round(Number(n) || 0);
    if (typeof Intl === 'undefined') return v.toLocaleString(numLocale);
    var f = fmtCache[numLocale] || (fmtCache[numLocale] = new Intl.NumberFormat(numLocale));
    return f.format(v);
  }

  // The goal after auto-steps: the first goal + k × step above the total, or the goal itself when step is 0.
  function stepGoal(goal, step, total) {
    goal = Number(goal) || 0;
    step = Number(step) || 0;
    total = Number(total) || 0;
    if (!(step > 0) || !(goal > 0) || total < goal) return goal;
    return goal + step * (Math.floor((total - goal) / step) + 1);
  }

  // The running sub train from the relay's sub times ({ at, n }, oldest first): subscriptions that each came
  // within windowMs of the one before. Returns { count, endsAt } while it runs, or null once it has ended.
  function subTrain(times, windowMs, now) {
    var list = (Array.isArray(times) ? times : []).filter(function (t) { return t && isFinite(t.at) && t.n >= 1; });
    if (!list.length || !(windowMs > 0)) return null;
    var lastAt = list[list.length - 1].at;
    if (now - lastAt >= windowMs) return null;
    var count = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      if (i < list.length - 1 && list[i + 1].at - list[i].at >= windowMs) break;
      count += Math.floor(list[i].n);
    }
    return { count: count, endsAt: lastAt + windowMs };
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

  function relLum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  var CHIP_DARK = '#0b0b0d', CHIP_DARK_LUM = relLum([11, 11, 13]);

  function chipText(rgb) {
    var l = relLum(rgb);
    var dark = (l + 0.05) / (CHIP_DARK_LUM + 0.05), light = 1.05 / (l + 0.05);
    return dark >= light ? CHIP_DARK : '#ffffff';
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
    useLang(s);
    var rgb = hexToRgb(s.renk);
    root.style.setProperty('--accent', s.renk);
    root.style.setProperty('--accent-rgb', rgb.join(' '));
    // Chip text is whichever of near-black or white contrasts more with the accent; computed here
    // because CSS relative colours are not available in older OBS browsers.
    var ct = chipText(rgb), cbg = rgb;
    // White chip text on a mid-tone accent (e.g. #e11d48) only reaches ~4.7:1; darken the pill until it clears 6:1.
    if (ct === '#ffffff') {
      for (var i = 0; i < 20 && 1.05 / (relLum(cbg) + 0.05) < 6; i++) {
        cbg = cbg.map(function (v) { return Math.round(v * 0.94); });
      }
    }
    root.style.setProperty('--chip-bg', s.renk);
    root.style.setProperty('--chip-fill', cbg === rgb ? s.renk : 'rgb(' + cbg.join(' ') + ')');
    root.style.setProperty('--chip-text', ct);
    // The page's own look only: the studio passes its preview root as el and keeps its UI free of custom CSS.
    if (!el || el === global.document.body) customCss(s.ozelCss);
  }

  // One <style> at the end of <head>, so custom rules win over themes.css. Set as text: never parsed as markup.
  function customCss(css) {
    var doc = global.document;
    if (!doc || !doc.head) return;
    var st = doc.getElementById('ko-custom-css');
    if (!css) { if (st) st.parentNode.removeChild(st); return; }
    if (!st) {
      st = doc.createElement('style');
      st.id = 'ko-custom-css';
      doc.head.appendChild(st);
    }
    if (st.textContent !== css) st.textContent = css;
  }

  function reducedMotion() {
    var g = global;
    return !!(typeof g.matchMedia === 'function' && g.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Eases a number from `from` to `to`. Returns a cancel function. Duration 0 (or the OS reduced-motion
  // setting) jumps straight to the end. onDone runs after the last frame, and not after a cancel.
  function tween(from, to, ms, onFrame, onDone) {
    if (!ms || quiet || reducedMotion()) {
      onFrame(to);
      if (onDone) onDone();
      return function () {};
    }
    var start = global.performance.now(), id = null, stopped = false;
    function step(now) {
      if (stopped) return;
      var p = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - p, 3);
      onFrame(from + (to - from) * e);
      if (p < 1) id = global.requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    id = global.requestAnimationFrame(step);
    return function cancel() { stopped = true; global.cancelAnimationFrame(id); };
  }

  // Drives the bar through a CSS variable; the stylesheet scales the fill with transform, so no layout work per frame.
  function setFill(el, p) {
    if (!el || !el.style) return;
    var n = Math.max(0, Math.min(100, Number(p) || 0));
    el.style.setProperty('--fill', (n / 100).toFixed(4));
  }

  var FONT_URLS = {
    inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
    // Poppins has no tabular digits, so the counting numerals use Inter (see themes.css).
    poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Inter:wght@600..900&display=swap',
    nunito: 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap',
    mono: 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap'
  };

  // Loads only the chosen family (poppins also gets Inter for its numerals) instead of all four. Safe to call again with other settings.
  function loadFont(s) {
    var d = global.document;
    if (!d || !d.head || typeof d.createElement !== 'function') return null;
    /** @type {HTMLLinkElement} */
    var link = typeof d.getElementById === 'function' ? /** @type {HTMLLinkElement} */ (d.getElementById('ko-font')) : null;
    if (!link) {
      link = d.createElement('link');
      link.id = 'ko-font';
      link.rel = 'stylesheet';
      d.head.appendChild(link);
    }
    link.href = FONT_URLS[s && s.yaziTipi] || FONT_URLS.inter;
    return link;
  }

  // Short UI strings shared by every overlay, in the viewer-chosen language.
  function text(s) {
    return {
      hint: t(s, 'hint.channel'),
      auth: t(s, 'note.auth'),
      rate: t(s, 'note.rate'),
      error: t(s, 'note.error'),
      noData: t(s, 'note.noData'),
      unreachable: t(s, 'note.unreachable'),
      stale: t(s, 'note.stale'),
      relayDown: t(s, 'note.chatRelay')
    };
  }

  // Sets the note text and shows or hides it. hataNotu=false silences it unless ?debug=1.
  function note(el, s, t) {
    if (!el) return;
    var msg = t || '';
    el.textContent = msg;
    var off = !!s && s.hataNotu === false && !isDebug();
    el.classList.toggle('is-hidden', !msg || off);
  }

  var debugState = {}, debugEl = null;
  // Fixed bottom-left box of key: value lines. Merges into earlier calls; undefined/null removes a key.
  function debug(info) {
    if (!isDebug()) return;
    var d = global.document;
    if (!d || !d.body || typeof d.createElement !== 'function') return;
    Object.keys(info || {}).forEach(function (k) {
      if (info[k] === undefined || info[k] === null) delete debugState[k];
      else debugState[k] = info[k];
    });
    if (!debugEl) {
      debugEl = typeof d.querySelector === 'function' ? d.querySelector('.ko-debug') : null;
      if (!debugEl) {
        debugEl = d.createElement('div');
        debugEl.className = 'ko-debug';
        d.body.appendChild(debugEl);
      }
    }
    debugEl.style.whiteSpace = 'pre';
    debugEl.textContent = Object.keys(debugState).map(function (k) { return k + ': ' + debugState[k]; }).join('\n');
  }

  var FILL_MS = 1200;

  // Bar + value + chips in one place: fill, count-up, bump, percent, session delta, milestones, goal state.
  // els = { bar, fill, val, pct, delta }; pct and delta may be null.
  function createGoalBar(els, goal, s) {
    els = els || {};
    s = s || {};
    var baseGoal = goal;
    var shown = 0, last = null, lastPct = 0, cancel = null, valNode = null, valText = null;
    if (els.goal) els.goal.textContent = fmt(goal);
    function restart(el, cls) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    // A one-off class: removed again after ms so no animation or compositor layer is left behind.
    function once(el, cls, ms, slot) {
      restart(el, cls);
      if (slot.t) clearTimeout(slot.t);
      slot.t = setTimeout(function () { slot.t = null; el.classList.remove(cls); }, ms);
    }
    var slots = { milestone: {}, pulse: {}, shine: {} };
    // Writes into the existing Text node, and only when the formatted string changed.
    function writeVal(v) {
      var t = fmt(v);
      if (t === valText) return;
      valText = t;
      if (!valNode || valNode.parentNode !== els.val) {
        els.val.textContent = t;
        valNode = els.val.firstChild && els.val.firstChild.nodeType === 3 ? els.val.firstChild : null;
      } else {
        valNode.nodeValue = t;
      }
    }
    function setText(el, t) {
      if (el.textContent !== t) el.textContent = t;
    }
    function reachGoal(pulse) {
      els.bar.classList.add('is-goal');
      if (pulse) once(els.bar, 'ko-goal-pulse', 1100, slots.pulse);
    }
    function set(total, delta) {
      total = Number(total) || 0;
      // Auto-step (hedefArtis): a reached goal moves up by the step. Reaching it live is still celebrated once.
      var stepped = stepGoal(baseGoal, s.hedefArtis, total);
      if (stepped !== goal) {
        var celebrate = last !== null && stepped > goal && !!s.hedefKutlama && !!els.bar;
        goal = stepped;
        lastPct = 0;
        if (els.goal) setText(els.goal, fmt(goal));
        if (celebrate) once(els.bar, 'ko-goal-pulse', 1100, slots.pulse);
      }
      var p = pct(total, goal);
      var increased = last !== null && total > last;
      var crossed = !!els.bar && !!s.hedefKutlama && last !== null &&
        [25, 50, 75].some(function (m) { return lastPct < m && p >= m; });
      var wantGoal = !!els.bar && !!s.hedefKutlama && goal > 0 && total >= goal;
      // The first value is a page load, not an event, so it gets the goal state without the pulse.
      var pulse = last !== null && !(els.bar && els.bar.classList.contains('is-goal'));
      setFill(els.fill, p);
      if (cancel) cancel();
      var instant = s.animasyon === 'off' || s.animasyon === 'low';
      var finish = function () {
        cancel = null;
        if (wantGoal) reachGoal(pulse);
      };
      if (els.val && shown !== total) {
        cancel = tween(shown, total, instant ? 0 : FILL_MS, function (v) {
          shown = v;
          writeVal(v);
        }, finish);
      } else {
        shown = total;
        if (els.val) writeVal(total);
        finish();
      }
      if (els.bar) {
        // A milestone is its own flourish, so it replaces the bump instead of stacking on it.
        if (crossed) {
          els.bar.classList.remove('ko-bump');
          once(els.bar, 'ko-milestone', 1200, slots.milestone);
        } else if (increased) {
          restart(els.bar, 'ko-bump');
        }
        // Goal state waits for the count-up to finish; leaving it is immediate.
        if (!wantGoal) els.bar.classList.remove('is-goal');
      }
      if (increased && els.fill && !instant) once(els.fill, 'ko-shine', 1500, slots.shine);
      if (els.pct) {
        els.pct.hidden = !s.yuzdeGoster;
        if (s.yuzdeGoster) setText(els.pct, Math.round(p) + '%');
      }
      if (els.delta) {
        var d = Number(delta) || 0, showDelta = !!s.oturumFarkiGoster && d !== 0;
        els.delta.hidden = !showDelta;
        if (showDelta) {
          setText(els.delta, (d > 0 ? '+' : '-') + fmt(Math.abs(d)));
          els.delta.classList.toggle('is-neg', d < 0);
        }
      }
      last = total;
      lastPct = p;
    }
    function destroy() {
      if (cancel) cancel();
      [slots.milestone, slots.pulse, slots.shine].forEach(function (sl) { if (sl.t) clearTimeout(sl.t); sl.t = null; });
      cancel = null;
    }
    return { set: set, destroy: destroy };
  }

  // Runs fn on a timer without overlapping runs. fn resolves { ok, retryAfterMs? }.
  // Failures back off exponentially; hidden pages pause and resume with an immediate run.
  function poller(fn, o) {
    o = o || {};
    var interval = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : 30000;
    var jitter = o.jitter === undefined ? 0.1 : Math.max(0, Number(o.jitter) || 0);
    var maxBackoff = Number(o.maxBackoffMs) > 0 ? Number(o.maxBackoffMs) : 300000;
    var timer = null, active = false, inflight = null, failures = 0, nextAt = 0, listening = false;

    function hidden() { var d = global.document; return !!(d && d.hidden); }
    function spread(ms) { return jitter ? ms * (1 + (Math.random() * 2 - 1) * jitter) : ms; }
    function clear() {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      nextAt = 0;
    }
    function arm(ms) {
      clear();
      if (!active || hidden()) return;
      ms = Math.max(0, Math.round(ms));
      nextAt = Date.now() + ms;
      timer = setTimeout(function () { timer = null; nextAt = 0; run(); }, ms);
    }
    function run() {
      if (!active) return Promise.resolve();
      if (inflight) return inflight;
      if (hidden()) return Promise.resolve();
      clear();
      inflight = (async function () {
        var r;
        // Promise.then so a synchronous throw from fn lands in the catch too.
        try { r = await Promise.resolve().then(fn); } catch (e) { r = null; }
        inflight = null;
        if (!active) return;
        var delay;
        if (r && r.ok) {
          failures = 0;
          delay = spread(interval);
        } else {
          failures += 1;
          delay = Math.min(maxBackoff, spread(interval * Math.pow(2, failures)));
          var ra = r ? Number(r.retryAfterMs) : 0;
          if (ra > delay) delay = ra;
        }
        arm(delay);
      })();
      return inflight;
    }
    function onVisible() { if (active && !hidden()) run(); }

    return {
      start: function () {
        if (active) return;
        active = true;
        failures = 0;
        var d = global.document;
        if (d && typeof d.addEventListener === 'function') { d.addEventListener('visibilitychange', onVisible); listening = true; }
        run();
      },
      stop: function () {
        active = false;
        clear();
        var d = global.document;
        if (listening && d && typeof d.removeEventListener === 'function') d.removeEventListener('visibilitychange', onVisible);
        listening = false;
      },
      now: function () { return run(); },
      nextInMs: function () { return nextAt ? Math.max(0, nextAt - Date.now()) : null; }
    };
  }

