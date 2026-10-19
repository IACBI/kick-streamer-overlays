# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/IACBI/kick-streamer-overlays/security/advisories/new)
for this repository. Include what you found, how to reproduce it, and which file is affected.

You can expect an answer within a few days.

## What matters most here

- **Kick credentials.** The client secret is read from the `KICK_CLIENT_SECRET` environment variable or from the
  git-ignored `AYARLAR.local.js`. The relay uses it for `/subscribers` and the chat broadcaster lookup. The
  subscriber and combined bars read it from `AYARLAR.local.js` only as a fallback, when the relay is not running.
  The studio keeps it in the page's memory. It must never reach a URL, a saved draft, the JSON export, the
  generated `AYARLAR.js`, a log, or any page other than those two bars.
- **Relay, webhook port** (`127.0.0.1:8788` by default, the only port meant for a tunnel). It answers
  `POST /kick/webhook` and nothing else. Each request needs Kick's signature headers, a timestamp within five
  minutes, and a signature that verifies against Kick's public key. The key is refetched at most once a minute when
  a signature fails. Repeated message IDs are acknowledged but not shown again. Bodies are limited to 64 KiB and the
  rate is limited. A report that bypasses signature or freshness checks is in scope.
- **Relay, overlay port** (`127.0.0.1:8790` by default). It serves `/health`, `/events`, `/channel` and
  `/subscribers`, and only accepts `GET` and `OPTIONS`. Never put this port behind a tunnel.
  - **Host.** Only `127.0.0.1`, `localhost` and `[::1]` are accepted, which blocks DNS rebinding. Anything else gets 403.
  - **Origin.** A request with no `Origin`, with `Origin: null` (an overlay opened from disk), or from a loopback
    `http(s)` origin is answered. Any other origin gets 403. The allowed origin is echoed back, never `*`, and
    `Vary: Origin` is set. A web page on another site cannot read these endpoints.
- **Broadcaster check.** Chat and ban events are passed on only when their broadcaster ID matches your channel. The ID
  comes from `RELAY_BROADCASTER_ID`, or is looked up from `kanal` with Kick app credentials. While the ID is unknown,
  events are dropped. `RELAY_ALLOW_ANY_BROADCASTER=1` turns the check off and is meant for testing only.
- **Upstream requests.** The relay and the overlays use timeouts and cache Kick's answers, so a stalled Kick cannot
  hang them. When Kick answers `403` or `429` to a channel lookup, the relay stops asking for the time Kick asked for
  and answers `429` with `Retry-After` in the meantime.
- **Chat rendering.** Kick data is inserted as text and as `<img>` elements built with the DOM API,
  never as markup. A report that shows script or markup injection is in scope.
- **Settings import.** The studio's JSON import keeps only known public settings with primitive values. Anything
  else in the file, including credentials, is ignored.

## Supported versions

Only the latest release receives fixes.
