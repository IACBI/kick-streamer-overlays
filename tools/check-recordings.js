#!/usr/bin/env node
'use strict';
// Runs webhooks saved by the relay's record mode (recordings/ by default) through the same event mapping the
// relay uses, and reports what each one becomes on the overlays. A file that maps to nothing, or loses its name,
// is a sign that Kick changed a payload.
//
//   node tools/check-recordings.js [folder]
//
// Exit code 1 when any recording of a known event type maps to nothing.

const fs = require('fs');
const path = require('path');
const { normalizeEvent, EVENT_TYPES } = require('../relay/webhook.js');

/** @param {string} dir */
function checkFolder(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const results = [];
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { results.push({ file: f, status: 'unreadable' }); continue; }
    const type = rec && typeof rec.type === 'string' ? rec.type : '';
    if (!EVENT_TYPES.includes(type)) { results.push({ file: f, type, status: 'unknown type' }); continue; }
    const ev = normalizeEvent(type, rec.body);
    if (!ev) { results.push({ file: f, type, status: 'dropped' }); continue; }
    // Fields the overlays show; an empty one usually means a renamed key on Kick's side.
    const empty = ['username', 'message', 'title'].filter((k) => Object.hasOwn(ev, k) && (ev[k] === '' || ev[k] === '?'));
    results.push({ file: f, type, status: empty.length ? 'empty ' + empty.join(', ') : 'ok', kind: ev.kind });
  }
  return results;
}

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'recordings'));
  const results = checkFolder(dir);
  if (!results.length) { console.log(`No recordings in ${dir}. Start the relay with --record and stream for a while.`); process.exit(0); }
  for (const r of results) console.log(`${r.status === 'ok' ? 'ok     ' : 'CHECK  '} ${r.type || '?'}${r.kind ? ' -> ' + r.kind : ''}  ${r.status === 'ok' ? '' : r.status + '  '}${r.file}`);
  const dropped = results.filter((r) => r.status === 'dropped').length;
  console.log(`\n${results.length} recording(s), ${results.filter((r) => r.status === 'ok').length} ok, ${dropped} dropped.`);
  process.exit(dropped ? 1 : 0);
}

module.exports = { checkFolder };
