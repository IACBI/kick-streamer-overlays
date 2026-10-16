# Contributing

Thanks for helping make the pack better. This project is by 𝓐.𝓒.𝓑 and free for everyone; contributions are welcome under the same terms (see [LICENSE](LICENSE)).

## Ground rules

- **Classic scripts only.** Pages must work from `file://` in OBS, so no ES modules and no build step.
- **One design system.** Use the shared `.ko-*` components and the tokens in `shared/themes.css`. A new look is a `body.theme-*` block that only sets tokens; it must work for every overlay.
- **OBS-friendly motion.** Prefer `transform` and `opacity`. Respect the `animasyon` setting (`normal`, `low`, `off`) and `prefers-reduced-motion`.
- **Never insert Kick data as HTML.** Use `textContent` and DOM APIs.
- **No secrets** in code, tests, issues or screenshots.

## Setup

No packages are needed. Node.js 20 or newer is enough.

```bash
node tests/run.js          # unit tests
node tests/relay-test.js   # relay tests
node tests/e2e-chrome.js   # real browser tests (needs Chrome or Edge)
```

Open `studio.html` to try a change in every overlay at once. Every overlay also accepts `?onizleme=1` for sample data with no network calls.

## Adding a setting

1. Add it to `SCHEMA` in `shared/kick-core.js` (type, default, limits).
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
```

It needs Node.js 22 or newer, Chrome or Edge, and `ffmpeg` on the PATH.

## Pull requests

Keep a change focused, say what you checked, and keep the English and Türkçe README sections in step. Commit messages: a short imperative subject line.
