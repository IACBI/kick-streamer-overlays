# Contributing

Thanks for helping make the pack better. This project is by 𝓐.𝓒.𝓑 and free for everyone; contributions are welcome under the same terms (see [LICENSE](LICENSE)).

## Ground rules

- **Classic scripts only.** Pages must work from `file://` in OBS, so no ES modules and no build step.
- **One design system.** Use the shared `.ko-*` components and the tokens in `shared/themes.css`. A new look is a `body.theme-*` block that only sets tokens; it must work for every overlay.
- **OBS-friendly motion.** Prefer `transform` and `opacity`. Respect the `animasyon` setting (`normal`, `low`, `off`) and `prefers-reduced-motion`.
- **Never insert Kick data as HTML.** Use `textContent` and DOM APIs.
- **The relay stays local.** Its overlay port listens on `127.0.0.1`. A new endpoint must keep the `Host` and `Origin` checks in `relay/server.js`, and must never send `Access-Control-Allow-Origin: *`.
- **No secrets** in code, tests, issues or screenshots. Credentials come from the environment or `AYARLAR.local.js`, which is git-ignored.

## Layout

| Path | What it is |
|---|---|
| `follower-bar.html`, `subscriber-bar.html`, `combined-bar.html`, `info-panel.html`, `chat.html`, `countdown.html`, `ticker.html` | The overlays. Each is a classic-script page that reads its settings with `K.readSettings()`. |
| `studio.html` | The studio: previews, settings, links, and `AYARLAR.js` / `AYARLAR.local.js` downloads. Not an OBS source. |
| `AYARLAR.js` | Public settings, shared by all overlays. |
| `AYARLAR.local.js` | Your Kick app credentials. Git-ignored; you create it yourself. |
| `shared/kick-core.js` | Settings schema and normalization, Kick and relay requests, pollers, goal bars and shared UI text. Also loaded under Node by the tests. |
| `shared/themes.css` | Design tokens, themes and the `.ko-*` components. |
| `relay/server.js` | The relay: webhook listener and local events, `/health`, `/channel` and `/subscribers`. |
| `relay/webhook.js` | Signature check, freshness, replay guard, rate limit and event normalization. |
| `relay/kick-api.js` | Client for Kick's official API: app token and channel lookup. |
| `relay/config.js` | Reads the credentials and the channel name from the environment or the settings files. |
| `relay/subscribe.js` | Creates (or lists) the chat and ban subscriptions for your channel. |
| `tests/run.js` | Unit tests. They load the real `shared/kick-core.js` and check the overlay and studio pages. |
| `tests/relay-test.js` | Relay tests. They run the relay against a local mock of Kick's API. |
| `tests/e2e-chrome.js`, `tests/mock-kick-api.js`, `tests/fixtures/` | Browser tests, the local Kick mock and sample API responses. |
| `tools/record-previews.js` | Re-creates the images in `screenshots/`. |
| `tools/visual-qa.js` | Screenshot grids of every overlay, theme and accent over light, dark and busy backgrounds, with measured text contrast. |
| `tools/motion-qa.js` | Frame timing, layout and paint counts, and filmstrips of every animation, with optional CPU throttling. |
| `badges/` | Optional badge art for chat. |

## Setup

No packages are needed. Node.js 20 or newer is enough.

```bash
node tests/run.js          # unit tests
node tests/relay-test.js   # relay tests
node tests/e2e-chrome.js   # real browser tests (needs Chrome or Edge)
```

`npm test` runs the first two. The browser tests take optional flags: `--live --channel <name>` for real Kick data, `--token` for the local mock, `--preview`, `--perf` and `--relay`.

Open `studio.html` to try a change in every overlay at once. Every overlay also accepts `?onizleme=1` for sample data with no network calls.

## Adding a setting

1. Add it to `SCHEMA` in `shared/kick-core.js` (type, default, limits). A key that must never come from a URL goes in `LOCAL_SCHEMA` instead.
2. Add it to `AYARLAR.js` with a one-line comment.
3. Add the input to `studio.html` and its entry to `ayarDoc()`.
4. Add it to the Configuration tables in `README.md`, in English and in Türkçe.
5. Add a test to `tests/run.js`.

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

Keep a change focused, say what you checked, and keep the English and Türkçe README sections in step. Commit messages: a short imperative subject line.
