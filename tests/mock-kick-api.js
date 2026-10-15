'use strict';
// Mock of the Kick official API (token + channels), for local tests only.
// It mirrors the documented JSON shape and nothing more; it is not live data.
//
// Run:    node tests/mock-kick-api.js [port]     (default 8787, bound to 127.0.0.1)
// Use:    const { startMockKick } = require('./mock-kick-api.js');
//
// Dummy credentials below are accepted by this mock only. They are not real Kick credentials.
// Every call to the channels endpoint, including one that gets a 401, advances the
// subscriber count by 3, so a browser test can see a session delta.

const http = require('http');

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const START_SUBS = 42;
const STEP_SUBS = 3;
const MAX_BODY = 64 * 1024;

function startMockKick(opts = {}) {
  const port = opts.port === undefined ? 8787 : Number(opts.port);
  const state = {
    tokenSeq: 0,
    issued: new Set(),
    subs: START_SUBS,
    stats: { tokenRequestsRejected: 0, channelCalls: 0, unauthorizedCalls: 0 }
  };

  function reset() {
    state.tokenSeq = 0;
    state.issued.clear();
    state.subs = START_SUBS;
    state.stats = { tokenRequestsRejected: 0, channelCalls: 0, unauthorizedCalls: 0 };
  }

  function send(res, status, body) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    if (status === 204) {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  function bearerToken(req) {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
    return m ? m[1] : null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      let form;
      try { form = new URLSearchParams(await readBody(req)); } catch (e) { return send(res, 413, { message: 'Payload too large' }); }
      if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
        state.stats.tokenRequestsRejected += 1;
        return send(res, 401, { error: 'invalid_client', message: 'Unauthorized' });
      }
      state.tokenSeq += 1;
      const token = 'test-token-' + state.tokenSeq;
      state.issued.add(token);
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }

    if (req.method === 'GET' && url.pathname === '/public/v1/channels') {
      state.stats.channelCalls += 1;
      const subs = state.subs;
      state.subs += STEP_SUBS;
      const token = bearerToken(req);
      if (!token || !state.issued.has(token)) {
        state.stats.unauthorizedCalls += 1;
        return send(res, 401, { data: {}, message: 'Unauthorized' });
      }
      const slugs = url.searchParams.getAll('slug');
      const data = slugs.map((slug) => ({
        slug,
        broadcaster_user_id: 1,
        active_subscribers_count: subs,
        active_gifted_subscribers_count: 3,
        canceled_subscribers_count: 1,
        stream: { is_live: true, viewer_count: 12, start_time: '2026-10-15T20:00:00Z' },
        stream_title: 'test'
      }));
      return send(res, 200, { data, message: 'ok' });
    }

    if (req.method === 'GET' && url.pathname === '/__reset') {
      reset();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/__stats') {
      return send(res, 200, Object.assign({
        tokensIssued: state.tokenSeq,
        nextSubscriberCount: state.subs
      }, state.stats));
    }

    return send(res, 404, { message: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { message: 'Internal error' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        url: 'http://127.0.0.1:' + addr.port,
        close() {
          return new Promise((done) => {
            server.close(() => done());
            if (server.closeAllConnections) server.closeAllConnections();
          });
        }
      });
    });
  });
}

module.exports = { startMockKick, CLIENT_ID, CLIENT_SECRET };

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 8787);
  startMockKick({ port }).then((m) => {
    console.log('Mock Kick API listening on ' + m.url + ' (Ctrl+C to stop)');
  }, (err) => {
    console.error('Could not start the mock: ' + err.code + ' ' + err.message);
    process.exitCode = 1;
  });
}
