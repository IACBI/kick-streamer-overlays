'use strict';
// Relay logging. "text" writes what console would; "json" writes one object per line for log collectors:
//   {"time":"2026-11-03T10:00:00.000Z","level":"warn","msg":"..."}
// Callers pass the same arguments they would pass to console. Nothing secret is ever logged by the relay.

const util = require('util');

const FORMATS = ['text', 'json'];

/**
 * @param {string} [format] "text" (default) or "json"
 * @param {{ out?: NodeJS.WritableStream, err?: NodeJS.WritableStream, now?: () => number }} [opts]
 * @returns {{ log: (...a: any[]) => void, warn: (...a: any[]) => void, error: (...a: any[]) => void, format: string }}
 */
function createLogger(format, opts) {
  const fmt = format === undefined || format === '' ? 'text' : String(format).toLowerCase();
  if (!FORMATS.includes(fmt)) throw new Error(`RELAY_LOG_FORMAT must be one of: ${FORMATS.join(', ')}`);
  const o = Object.assign({ out: process.stdout, err: process.stderr, now: () => Date.now() }, opts || {});
  const line = (level, stream) => (...args) => {
    const msg = util.format(...args);
    stream.write(fmt === 'json'
      ? JSON.stringify({ time: new Date(o.now()).toISOString(), level, msg }) + '\n'
      : msg + '\n');
  };
  return { log: line('info', o.out), warn: line('warn', o.err), error: line('error', o.err), format: fmt };
}

module.exports = { createLogger, FORMATS };
