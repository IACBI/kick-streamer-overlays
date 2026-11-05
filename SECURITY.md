# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/IACBI/kick-streamer-overlays/security/advisories/new)
for this repository. Include what you found, how to reproduce it, and which file is affected.

You can expect an answer within a few days.

## What matters most here

- **Kick credentials.** The client secret is read from the `KICK_CLIENT_SECRET` environment variable or from the
  git-ignored `AYARLAR.local.js`. The relay uses it for `/subscribers` and the broadcaster lookup. The
  subscriber and combined bars read it from `AYARLAR.local.js` only as a fallback, when the relay is not running.
  The studio keeps it in the page's memory, or sends it once to the relay (`POST /credentials`), which writes
  `AYARLAR.local.js`. It must never reach a URL, a saved draft, the JSON export, the generated `AYARLAR.js`, a log,
  or any page other than those two bars. The relay never serves `AYARLAR.local.js`; its own pages get an empty stub.
- **Relay, webhook port** (`127.0.0.1:8788` by default, the only port meant for a tunnel). It answers
  `POST /kick/webhook` and nothing else. Each request needs Kick's signature headers, a timestamp within five
  minutes, and a signature that verifies against Kick's public key. The key is refetched at most once a minute when
  a signature fails. Repeated message IDs are acknowledged but not shown again. Bodies are limited to 64 KiB. The
  rate is limited before the signature check, and verified deliveries have a separate quota, so unsigned traffic
  cannot starve real events. A report that bypasses signature or freshness checks is in scope.
- **Relay, overlay port** (`127.0.0.1:8790` by default). Never put this port behind a tunnel.
  - **Pages.** It serves the pack's top-level pages and the `shared/`, `alerts/`, `badges/` and `branding/` folders,
    by file type, without a key; every other path, dot files and anything outside the folder are refused. Pages carry
    `X-Content-Type-Options: nosniff` and `frame-ancestors 'self'`. The key script `AYARLAR.relay.js` is generated for
    the relay's own pages only (`Sec-Fetch-Site: same-origin` or `none`, or a loopback referer for clients without it).
  - **API.** `/health`, `/events`, `/channel`, `/subscribers`, `/stats` and `/settings/rev` are `GET`; `/test-alert`,
    `/control`, `/overlay`, `/stats/reset`, `/credentials` and `/subscribe` are `POST`; `/settings` is both.
    Saving (`/settings`, `/credentials`) and `/subscribe` also need an `Origin` header and a JSON body, are rate
    limited, and saved settings are normalized by the overlay core and written as plain data.
  - **Access key.** Every request must carry the key from the git-ignored `AYARLAR.relay.js` as a `key` query
    parameter. The relay writes that file next to the overlays on first start. Without a valid key it answers `401`.
    This matters because a sandboxed frame can send `Origin: null` and pass the origin check below.
  - **Host.** Only `127.0.0.1`, `localhost` and `[::1]` are accepted, which blocks DNS rebinding. Anything else gets 403.
  - **Origin.** A request with no `Origin`, with `Origin: null` (an overlay opened from disk), or from a loopback
    `http(s)` origin is answered. Any other origin gets 403. The allowed origin is echoed back, never `*`, and
    `Vary: Origin` is set. A web page on another site cannot read these endpoints.
- **Server mode** (`RELAY_PUBLIC_URL`, see [docs/cloud.md](docs/cloud.md)). The overlay port then sits behind the
  owner's HTTPS reverse proxy. Only that address's host and origin are added to the loopback ones; Kick's webhook is
  taken on the same port with the same checks, while the separate webhook listener stays on loopback. The key script
  never contains the key: the studio asks for it and keeps it in that browser, and OBS links carry it. The address must
  be plain `https://`.
- **Broadcaster check.** Chat, ban and alert events are passed on only when their broadcaster ID matches your channel. The ID
  comes from `RELAY_BROADCASTER_ID`, or is looked up from `kanal` with Kick app credentials. While the ID is unknown,
  events are dropped. `RELAY_ALLOW_ANY_BROADCASTER=1` turns the check off and is meant for testing only.
- **Upstream requests.** The relay and the overlays use timeouts and cache Kick's answers, so a stalled Kick cannot
  hang them. When Kick answers `403` or `429` to a channel lookup, the relay stops asking for the time Kick asked for
  and answers `429` with `Retry-After` in the meantime.
- **Chat and alert rendering.** Kick data, including usernames and Kicks messages in alerts, is inserted as text
  and as `<img>` elements built with the DOM API, never as markup. A report that shows script or markup injection
  is in scope.
- **Relay executable.** The release builds it in GitHub Actions from the tagged source and publishes its SHA-256 in
  `SHA256SUMS.txt`. It is not code-signed. It writes `AYARLAR.relay.js` next to itself and nowhere else.
- **Settings import.** The studio's JSON import keeps only known public settings with primitive values. Anything
  else in the file, including credentials, is ignored.

## Supported versions

Only the latest release receives fixes.
