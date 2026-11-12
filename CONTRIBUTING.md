# Contributing

Thanks for helping make the pack better. This project is by 𝓐.𝓒.𝓑 and free for everyone; contributions are welcome under the same MIT terms (see [LICENSE](LICENSE)).

## Ground rules

- **Classic scripts only.** Pages must work from `file://` in OBS, so no ES modules and no build step. The only build is the optional relay executable, made from the same `relay/` sources.
- **One design system.** Use the shared `.ko-*` components and the tokens in `shared/themes.css`. A new look is a `body.theme-*` block that only sets tokens; it must work for every overlay.
- **OBS-friendly motion.** Prefer `transform` and `opacity`. Respect the `animasyon` setting (`normal`, `low`, `off`) and `prefers-reduced-motion`.
- **Never insert Kick data as HTML.** Use `textContent` and DOM APIs.
- **The relay stays local.** Its overlay port listens on `127.0.0.1`. A new endpoint must keep the `Host` and `Origin` checks in `relay/server.js`, and must never send `Access-Control-Allow-Origin: *`.
- **No secrets** in code, tests, issues or screenshots. Credentials come from the environment or `AYARLAR.local.js`, which is git-ignored.

## Layout

| Path | What it is |
|---|---|
| `follower-bar.html`, `subscriber-bar.html`, `combined-bar.html`, `info-panel.html`, `chat.html`, `alerts.html`, `countdown.html`, `ticker.html`, `events.html`, `leaderboard.html`, `kicks-bar.html`, `sub-train.html` | The overlays. Each is a classic-script page that reads its settings with `K.readSettings()`. |
| `dock.html` | The OBS control dock: relay status, alert controls, countdown and announcement changes, stats reset. |
| `studio.html` | The studio: previews, settings, links, and `AYARLAR.js` / `AYARLAR.local.js` downloads. Not an OBS source. Its script is `shared/studio.js` and its styles `shared/studio.css`. |
| `AYARLAR.js` | Public settings, shared by all overlays. |
| `AYARLAR.local.js` | Your Kick app credentials. Git-ignored; you create it yourself. |
| `src/core/` | The source of `shared/kick-core.js`, one part per area: settings schema, look, HTTP, Kick parsers, Kick REST, official API, OBS export, alert media, stats, relay stream, public API. |
| `shared/kick-core.js` | Built from `src/core/` by `tools/build-core.js` and committed, so OBS can load it from `file://`. Also loaded under Node by the tests. |
| `shared/themes.css` | Design tokens, themes and the `.ko-*` components. |
| `shared/lang/<code>.js` | Overlay and dock texts (`tr`, `en`, `es`, `pt`, `de`, `ar`), read through `K.t()`. Generated from `i18n/overlay/` by `tools/build-lang.js`. |
| `shared/lang/studio/<code>.js` | Studio texts and choice labels. Generated from `i18n/studio/`. |
| `relay/server.js` | The relay: HTTP listeners, rate limits, the overlay stream, the studio API, `/health`, `/channel`, `/subscribers`, `/stats`, `/control` and `/overlay`. Kick-specific code lives in `relay/kick.js`. |
| `relay/kick.js` | The Kick adapter: reads a webhook delivery, checks its signature (with key rotation), turns it into an overlay event, looks up channels and manages event subscriptions. A change on Kick's side is fixed here. |
| `Dockerfile` | The relay image for server mode ([docs/cloud.md](docs/cloud.md)). |
| `relay/site.js` | Serves the pack's pages on the relay's local port and saves the studio's settings and credentials. |
| `relay/record.js` | Record mode: redacted copies of verified webhooks in `recordings/`. |
| `relay/stats.js` | This stream's numbers (totals, recent events, leaderboards, sub train), saved to `kick-relay-stats.json` and written to `labels/`. |
| `relay/setup.js` | Guided setup: asks for the channel and the Kick app, checks them, saves them. |
| `relay/tunnel.js` | Runs and restarts the cloudflared quick tunnel for `--tunnel`. |
| `relay/webhook.js` | Signature check, freshness, replay guard, rate limit and event normalization. |
| `relay/kick-api.js` | Client for Kick's official API: app token and channel lookup. |
| `relay/config.js` | Reads the credentials and the channel name from the environment or the settings files. |
| `relay/subscribe.js` | Creates (or lists) the webhook subscriptions for your channel: chat, bans, follows, subscriptions, gifts and Kicks. |
| `relay/log.js` | Text or JSON log lines (`RELAY_LOG_FORMAT`). |
| `relay/sea-main.js` | Entry of the relay executable: starts the relay, or `subscribe` / `setup`. |
| `tests/run.js` | Runs the unit tests in order and prints the summary. |
| `tests/unit/` | The unit tests, one file per area (`lang`, `core`, `kick`, `core-v23`, `relay-client`, `pages`), and `harness.js` with the shared loader, fakes and checks. They load the real `shared/kick-core.js` and check the overlay and studio pages. |
| `tests/relay-test.js` | Relay tests. They run the relay against a local mock of Kick's API. |
| `tests/e2e-chrome.js`, `tests/mock-kick-api.js`, `tests/fixtures/` | Browser tests, the local Kick mock, sample API responses and webhook bodies. |
| `tests/relay-binary-test.js` | Starts the built relay executable from an empty folder and checks it. |
| `tools/build-relay.js` | Builds the relay executable into `dist/`. |
| `i18n/overlay/<code>.json`, `i18n/studio/<code>.json` | The translations: overlay and dock texts, and studio texts and choice labels. English is the reference. |
| `tools/build-lang.js` | Writes `shared/lang/**/*.js` from `i18n/` (`--check` only compares; `--status` reports missing and untranslated texts). |
| `tools/build-core.js` | Joins `src/core/` into `shared/kick-core.js` (`--check` only compares; CI runs it). |
| `tools/sync-version.js` | Copies the `package.json` version into `shared/kick-core.js` (`--check` only compares). |
| `tools/changelog-notes.js` | Prints one version's section of `CHANGELOG.md`, used as the release notes. |
| `tools/record-previews.js` | Re-creates the images in `screenshots/`. |
| `tools/check-recordings.js` | Runs recorded webhooks through the relay's event mapping and reports what changed. |
| `tools/kick-drift.js` | Checks that Kick's public channel data and webhook key still parse; run daily by `.github/workflows/kick-drift.yml`. |
| `tools/visual-qa.js` | Screenshot grids of every overlay, theme and accent over light, dark and busy backgrounds, with measured text contrast. |
| `tools/motion-qa.js` | Frame timing, layout and paint counts, and filmstrips of every animation, with optional CPU throttling. |
| `badges/`, `alerts/` | Optional badge art for chat; optional alert sounds and art. |
| `docs/` | Guides (setup, relay, settings, troubleshooting, FAQ) and the roadmap. English only. |
| `.github/workflows/` | CI, CodeQL, the tag-driven release, and `pages.yml`, which publishes the page files to GitHub Pages. |

## Setup

The overlays and the relay need no packages; Node.js 20 or newer runs the tests. The development tools (ESLint,
TypeScript, esbuild, postject) are pinned in `package.json`:

```bash
npm ci                     # development tools only
npm run check              # lint, type check, version check, unit and relay tests
node tests/e2e-chrome.js   # real browser tests (needs Chrome or Edge)
npm run build:relay        # relay executable for this platform, into dist/
npm run test:relay-binary  # start that executable from an empty folder and check it
```

`npm test` runs the unit and relay tests without installing anything. The type check reads the JSDoc in the
relay and in `src/core/`; keep new functions documented there. After editing a part, run `npm run build:core` (`npm run check` fails until you do). The browser tests take optional flags: `--live --channel <name>` for real Kick data, `--token` for the local mock, `--preview`, `--perf` and `--relay`.

Open `studio.html` to try a change in every overlay at once. Every overlay also accepts `?preview=1` (or the original `?onizleme=1`) for sample data with no network calls.

## Adding a setting

1. Add it to `SCHEMA` in `src/core/10-settings.js` (type, default, limits). A key that must never come from a URL goes in `LOCAL_SCHEMA` instead.
2. Add it to `AYARLAR.js` with a one-line comment.
3. Add the input to `studio.html` and its entry to `ayarDoc()` in `shared/studio.js`. Its label and help text go into every `i18n/studio/<code>.json` (then `npm run build:lang`).
4. Give it an English name in `ALIASES` in `src/core/10-settings.js`.
5. Add it to the table in `docs/settings.md`, with its English name.
6. Add a test to the matching `tests/unit/*.test.js`.

## Adding an overlay

Copy the structure of `follower-bar.html`: shared head (with the `shared/lang/*.js` scripts before `kick-core.js`), `K.readSettings()`, `K.applyLook(S)`, a preview branch, and a setup hint when it needs a setting that is empty. Visible text comes from `K.t(S, 'key')`, with the key in every `i18n/overlay/<code>.json` (then `npm run build:lang`). Register it in `tests/unit/harness.js` (`OVERLAY_PAGES`), in the studio's previews, in `tools/visual-qa.js`, and in the README table.

## Adding a language

1. Copy `i18n/overlay/en.json` and `i18n/studio/en.json` to the new code, translate the values, and run `npm run build:lang`. Keep `{slots}`; plural forms use `Intl.PluralRules` categories (`one`, `other`, and `zero`, `two`, `few`, `many` where the language has them). [docs/translating.md](docs/translating.md) has the details.
2. Add the code to `dil` in `src/core/10-settings.js`, to `LOCALES` in `src/core/20-look.js`, to the script tags of every page and the studio, to the studio's language buttons, and to `LANGS` in `tests/unit/harness.js`.
3. Run `npm run i18n:status` and `npm test` (they name any missing key or slot) and `node tools/visual-qa.js --out <dir> --only lang --gate`. For a right-to-left language, add it to `RTL` in `src/core/20-look.js` and look at the sheets.

## Refreshing the README images

```bash
node tools/record-previews.js            # all images in screenshots/
node tools/record-previews.js themes     # one scene
node tools/visual-qa.js --out <dir>      # contrast and look of every theme (about 12 min)
node tools/motion-qa.js --out <dir> --phase perf --throttle 4 --quick
```

It needs Node.js 22 or newer, Chrome or Edge, and `ffmpeg` on the PATH.

## Pull requests

Keep a change focused, say what you checked, and keep the English and Türkçe README sections in step. Text changes go into every language file. Commit messages: a short imperative subject line. CI must pass: tests on Node.js 20, 22 and 24, lint, the type check, the Chrome tests, the visual contrast and layout gate in every label language, the relay executable and CodeQL.

## Releasing

1. Move the `[Unreleased]` notes in `CHANGELOG.md` under the new version and date.
2. `npm version minor --no-git-tag-version` (or `patch`, `major`). The `version` script copies the number into `shared/kick-core.js`.
3. Commit, merge to `main`, then tag that commit `vX.Y.Z` and push the tag.
4. The release workflow checks that the tag matches `package.json`, runs the checks, builds the zip, the relay
   executables and one zip per system with the relay inside, writes `SHA256SUMS.txt`, and publishes the release with the changelog section as notes.
