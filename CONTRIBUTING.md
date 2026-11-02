# Contributing

Thanks for helping make the pack better. This project is by 𝓐.𝓒.𝓑 and free for everyone; contributions are welcome under the same terms (see [LICENSE](LICENSE)).

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
| `follower-bar.html`, `subscriber-bar.html`, `combined-bar.html`, `info-panel.html`, `chat.html`, `alerts.html`, `countdown.html`, `ticker.html` | The overlays. Each is a classic-script page that reads its settings with `K.readSettings()`. |
| `studio.html` | The studio: previews, settings, links, and `AYARLAR.js` / `AYARLAR.local.js` downloads. Not an OBS source. |
| `AYARLAR.js` | Public settings, shared by all overlays. |
| `AYARLAR.local.js` | Your Kick app credentials. Git-ignored; you create it yourself. |
| `shared/kick-core.js` | Settings schema and normalization, Kick and relay requests, pollers, goal bars and shared UI text. Also loaded under Node by the tests. |
| `shared/themes.css` | Design tokens, themes and the `.ko-*` components. |
| `relay/server.js` | The relay: webhook listener and local events, `/health`, `/channel` and `/subscribers`. |
| `relay/webhook.js` | Signature check, freshness, replay guard, rate limit and event normalization. |
| `relay/kick-api.js` | Client for Kick's official API: app token and channel lookup. |
| `relay/config.js` | Reads the credentials and the channel name from the environment or the settings files. |
| `relay/subscribe.js` | Creates (or lists) the webhook subscriptions for your channel: chat, bans, follows, subscriptions, gifts and Kicks. |
| `relay/log.js` | Text or JSON log lines (`RELAY_LOG_FORMAT`). |
| `relay/sea-main.js` | Entry of the relay executable: starts the relay, or `subscribe`. |
| `tests/run.js` | Unit tests. They load the real `shared/kick-core.js` and check the overlay and studio pages. |
| `tests/relay-test.js` | Relay tests. They run the relay against a local mock of Kick's API. |
| `tests/e2e-chrome.js`, `tests/mock-kick-api.js`, `tests/fixtures/` | Browser tests, the local Kick mock, sample API responses and webhook bodies. |
| `tests/relay-binary-test.js` | Starts the built relay executable from an empty folder and checks it. |
| `tools/build-relay.js` | Builds the relay executable into `dist/`. |
| `tools/sync-version.js` | Copies the `package.json` version into `shared/kick-core.js` (`--check` only compares). |
| `tools/changelog-notes.js` | Prints one version's section of `CHANGELOG.md`, used as the release notes. |
| `tools/record-previews.js` | Re-creates the images in `screenshots/`. |
| `tools/visual-qa.js` | Screenshot grids of every overlay, theme and accent over light, dark and busy backgrounds, with measured text contrast. |
| `tools/motion-qa.js` | Frame timing, layout and paint counts, and filmstrips of every animation, with optional CPU throttling. |
| `badges/` | Optional badge art for chat. |

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
relay and in `shared/kick-core.js`; keep new functions documented there. The browser tests take optional flags: `--live --channel <name>` for real Kick data, `--token` for the local mock, `--preview`, `--perf` and `--relay`.

Open `studio.html` to try a change in every overlay at once. Every overlay also accepts `?onizleme=1` for sample data with no network calls.

## Adding a setting

1. Add it to `SCHEMA` in `shared/kick-core.js` (type, default, limits). A key that must never come from a URL goes in `LOCAL_SCHEMA` instead.
2. Add it to `AYARLAR.js` with a one-line comment.
3. Add the input to `studio.html` and its entry to `ayarDoc()`.
4. Give it an English name in `ALIASES` in `shared/kick-core.js`.
5. Add it to the Configuration tables in `README.md`, in English and in Türkçe, with its English name.
6. Add a test to `tests/run.js`.

## Adding an overlay

Copy the structure of `follower-bar.html`: shared head, `K.readSettings()`, `K.applyLook(S)`, a preview branch, and a setup hint when it needs a setting that is empty. Register it in `tests/run.js` (`OVERLAY_PAGES`), in the studio's previews, and in the README table.

## Refreshing the README images

```bash
node tools/record-previews.js            # all images in screenshots/
node tools/record-previews.js themes     # one scene
node tools/visual-qa.js --out <dir>      # contrast and look of every theme (about 12 min)
node tools/motion-qa.js --out <dir> --phase perf --throttle 4 --quick
```

It needs Node.js 22 or newer, Chrome or Edge, and `ffmpeg` on the PATH.

## Pull requests

Keep a change focused, say what you checked, and keep the English and Türkçe README sections in step. Commit messages: a short imperative subject line. CI must pass: tests on Node.js 20, 22 and 24, lint, the type check, the Chrome tests, the visual contrast gate, the relay executable and CodeQL.

## Releasing

1. Move the `[Unreleased]` notes in `CHANGELOG.md` under the new version and date.
2. `npm version minor --no-git-tag-version` (or `patch`, `major`). The `version` script copies the number into `shared/kick-core.js`.
3. Commit, merge to `main`, then tag that commit `vX.Y.Z` and push the tag.
4. The release workflow checks that the tag matches `package.json`, runs the checks, builds the zip and the relay
   executables, writes `SHA256SUMS.txt`, and publishes the release with the changelog section as notes.
