# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
[private vulnerability reporting](https://github.com/IACBI/kick-streamer-overlays/security/advisories/new)
for this repository. Include what you found, how to reproduce it, and which file is affected.

You can expect an answer within a few days.

## What matters most here

- **Secrets.** The Kick client secret lives only in the git-ignored `AYARLAR.local.js` or in the studio's memory.
  It must never reach a URL, a saved draft, the generated `AYARLAR.js`, a log or an overlay page.
- **Relay.** The webhook port accepts only correctly signed Kick events. The overlay port listens on `127.0.0.1`
  and refuses foreign `Host` headers. A report that bypasses either is in scope.
- **Chat rendering.** Kick data is inserted as text and as `<img>` elements built with the DOM API,
  never as markup. A report that shows script or markup injection is in scope.

## Supported versions

Only the latest release receives fixes.
