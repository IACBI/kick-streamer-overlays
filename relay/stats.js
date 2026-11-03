'use strict';
// Stream statistics for the event overlays (recent events, leaderboards, Kicks goal, sub train) and the plain-text
// label files for OBS Text sources. Fed with the alerts the relay accepts from Kick; test alerts and replays are
// not counted. The numbers start over when Kick reports the stream going live, or from the dock.
//
// The state is saved to a small JSON file next to AYARLAR.js, so restarting the relay mid-stream keeps it.

const fs = require('fs');
const path = require('path');

const RECENT_MAX = 20;
const TOP_MAX = 10;
const USERS_MAX = 5000;            // leaderboard entries per stream; past this, new names are not added
const SUB_WINDOW_MS = 10 * 60 * 1000;   // the longest sub train window the overlay offers (trenSn max)
const SUB_TIMES_MAX = 500;
const SAVE_DELAY_MS = 1000;
const NAME_MAX = 60;

const KINDS = new Set(['follow', 'sub', 'gift', 'kicks']);
const num = (v, min) => (Number.isSafeInteger(v) && v >= min ? v : null);
const nameOf = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');

function emptyState(now) {
  return {
    since: now,
    totals: { follows: 0, subs: 0, gifted: 0, kicks: 0 },
    latest: { follow: null, sub: null, gift: null, kicks: null },
    recent: [],
    gifters: {},     // lower-case name -> { name, count }
    kickers: {},     // lower-case name -> { name, amount }
    subTimes: []     // { at, n }: subscriptions and gifted subscriptions, for the sub train
  };
}

// A saved file is the relay's own output, but it is still checked field by field: a damaged or hand-edited file
// must not crash the relay or put odd values on stream.
function fromSaved(raw, now) {
  const s = emptyState(now);
  if (!raw || typeof raw !== 'object') return s;
  if (num(raw.since, 0) !== null && raw.since <= now) s.since = raw.since;
  for (const k of Object.keys(s.totals)) if (raw.totals && num(raw.totals[k], 0) !== null) s.totals[k] = raw.totals[k];
  for (const k of Object.keys(s.latest)) {
    const e = raw.latest && raw.latest[k];
    const ev = e && cleanEntry(Object.assign({ kind: k }, e));
    if (ev) s.latest[k] = ev;
  }
  if (Array.isArray(raw.recent)) s.recent = raw.recent.map(cleanEntry).filter(Boolean).slice(0, RECENT_MAX);
  const board = (src, field) => {
    const out = {};
    if (!src || typeof src !== 'object') return out;
    for (const v of Object.values(src).slice(0, USERS_MAX)) {
      const name = nameOf(v && v.name);
      if (name && num(v[field], 1) !== null) out[name.toLowerCase()] = { name, [field]: v[field] };
    }
    return out;
  };
  s.gifters = board(raw.gifters, 'count');
  s.kickers = board(raw.kickers, 'amount');
  if (Array.isArray(raw.subTimes)) {
    s.subTimes = trainTimes(raw.subTimes.filter((t) => t && num(t.at, 0) !== null && num(t.n, 1) !== null && t.at <= now)
      .map((t) => ({ at: t.at, n: t.n })).sort((a, b) => a.at - b.at), now);
  }
  return s;
}

// One recent-events entry: only the fields the overlay shows.
function cleanEntry(e) {
  if (!e || !KINDS.has(e.kind) || num(e.at, 0) === null) return null;
  const anonymous = e.kind === 'gift' && e.anonymous === true;
  const name = anonymous ? '' : nameOf(e.name);
  if (!name && !anonymous) return null;
  const out = { kind: e.kind, name, at: e.at };
  if (e.kind === 'gift') { out.count = num(e.count, 1) || 1; out.anonymous = anonymous; }
  if (e.kind === 'kicks') out.amount = num(e.amount, 0) || 0;
  if (e.kind === 'sub') out.months = num(e.months, 1) || 1;
  return out;
}

// The sub times the sub train can still use: the last chain of entries less than SUB_WINDOW_MS apart, kept only
// while its newest entry is inside the window. A long train keeps all of its entries (up to SUB_TIMES_MAX).
function trainTimes(list, now) {
  if (!list.length || now - list[list.length - 1].at >= SUB_WINDOW_MS) return [];
  let i = list.length - 1;
  while (i > 0 && list[i].at - list[i - 1].at < SUB_WINDOW_MS) i--;
  return list.slice(Math.max(i, list.length - SUB_TIMES_MAX));
}

function top(board, field) {
  return Object.values(board).sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name)).slice(0, TOP_MAX)
    .map((v) => ({ name: v.name, [field]: v[field] }));
}

/**
 * @param {{ now?: () => number, file?: string | null, labelsDir?: string | null, logger?: { warn: Function } }} [opts]
 */
function createStats(opts) {
  const o = Object.assign({ now: () => Date.now(), file: null, labelsDir: null, logger: console }, opts || {});
  let state = emptyState(o.now());
  if (o.file) {
    try { state = fromSaved(JSON.parse(fs.readFileSync(o.file, 'utf8')), o.now()); } catch (e) {
      if (e.code !== 'ENOENT') o.logger.warn(`Stream stats file could not be read (${e.message}); starting from zero.`);
    }
  }
  let saveTimer = null;
  let dirty = false;      // nothing is written until something changed, so a relay that saw no event leaves no files
  const lastLabels = new Map();

  function snapshot() {
    const now = o.now();
    return {
      since: state.since,
      totals: Object.assign({}, state.totals),
      latest: Object.assign({}, state.latest),
      recent: state.recent.slice(),
      topGifters: top(state.gifters, 'count'),
      topKicks: top(state.kickers, 'amount'),
      subTimes: trainTimes(state.subTimes, now)
    };
  }

  // Writes a file only through a temporary name, so OBS or a reader never sees half of it.
  function writeAtomic(file, text) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  }

  // Plain text for OBS Text sources ("Read from file"). A file is rewritten only when its text changed.
  function labels(snap) {
    const top1 = (list, field) => (list[0] ? `${list[0].name} (${list[0][field]})` : '');
    const latestName = (e) => (e ? (e.kind === 'gift' && e.anonymous ? 'Anonymous' : e.name) : '');
    return {
      'latest-follower.txt': latestName(snap.latest.follow),
      'latest-subscriber.txt': latestName(snap.latest.sub),
      'latest-gifter.txt': latestName(snap.latest.gift),
      'latest-kicks.txt': snap.latest.kicks ? `${snap.latest.kicks.name} (${snap.latest.kicks.amount})` : '',
      'top-gifter.txt': top1(snap.topGifters, 'count'),
      'top-kicks.txt': top1(snap.topKicks, 'amount'),
      'follows-total.txt': String(snap.totals.follows),
      'subs-total.txt': String(snap.totals.subs + snap.totals.gifted),
      'kicks-total.txt': String(snap.totals.kicks)
    };
  }

  /** Writes pending changes now (the relay calls it on stop). */
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty) return;
    dirty = false;
    const snap = snapshot();
    try {
      if (o.file) writeAtomic(o.file, JSON.stringify(Object.assign({}, state, { subTimes: snap.subTimes })));
      if (o.labelsDir) {
        fs.mkdirSync(o.labelsDir, { recursive: true });
        for (const [name, text] of Object.entries(labels(snap))) {
          if (lastLabels.get(name) === text) continue;
          writeAtomic(path.join(o.labelsDir, name), text);
          lastLabels.set(name, text);
        }
      }
    } catch (e) {
      o.logger.warn(`Stream stats could not be saved (${e.message}).`);
    }
  }

  function changed() {
    if (!o.file && !o.labelsDir) return;
    dirty = true;
    if (!saveTimer) {
      saveTimer = setTimeout(flush, SAVE_DELAY_MS);
      if (saveTimer.unref) saveTimer.unref();
    }
  }

  /**
   * Counts one alert the relay accepted. Returns true when the stats changed.
   * @param {any} ev a normalized alert (relay/webhook.js)
   */
  function record(ev) {
    if (!ev || !KINDS.has(ev.kind) || ev.test || ev.replay) return false;
    const at = o.now();
    const e = cleanEntry({ kind: ev.kind, name: ev.username, at, count: ev.count, amount: ev.amount, months: ev.months, anonymous: ev.anonymous });
    if (!e) return false;
    const t = state.totals;
    if (e.kind === 'follow') t.follows += 1;
    if (e.kind === 'sub') { t.subs += 1; state.subTimes.push({ at, n: 1 }); }
    if (e.kind === 'gift') {
      t.gifted += e.count;
      state.subTimes.push({ at, n: e.count });
      if (!e.anonymous) bump(state.gifters, e.name, 'count', e.count);
    }
    if (e.kind === 'kicks') { t.kicks += e.amount; bump(state.kickers, e.name, 'amount', e.amount); }
    if (e.kind === 'sub' || e.kind === 'gift') state.subTimes = trainTimes(state.subTimes, at);
    state.latest[e.kind] = e;
    state.recent.unshift(e);
    if (state.recent.length > RECENT_MAX) state.recent.length = RECENT_MAX;
    changed();
    return true;
  }

  function bump(board, name, field, by) {
    const key = name.toLowerCase();
    const cur = board[key];
    if (cur) { cur[field] += by; cur.name = name; return; }
    if (Object.keys(board).length >= USERS_MAX || by < 1) return;
    board[key] = { name, [field]: by };
  }

  /** Starts the stream's numbers over (stream start, or the dock's reset). */
  function reset() {
    state = emptyState(o.now());
    changed();
  }

  /** True once anything was counted this stream. */
  function hasData() { return state.recent.length > 0; }

  return { record, reset, snapshot, flush, hasData, labels: () => labels(snapshot()) };
}

module.exports = { createStats, SUB_WINDOW_MS, RECENT_MAX, TOP_MAX };
