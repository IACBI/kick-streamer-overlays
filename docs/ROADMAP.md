# Roadmap

Where the Kick Streamer Overlay Pack goes after v2.4.0. Each milestone ships as its own release, with tests and a CHANGELOG entry. Order is by value to streamers: first prove what exists, then remove setup pain, then add features.

Maintained by 𝓐.𝓒.𝓑. Last updated 2026-11-03.

| Milestone | Theme | Size |
|---|---|---|
| [v2.5](#v25--proven-live) | Proven live | S |
| [v2.6](#v26--alerts-with-sound-and-media) | Alerts with sound and media | M |
| [v2.7](#v27--one-click-obs) | One-click OBS | M |
| [v2.8](#v28--relay-without-the-hard-part) | Relay without the hard part | L |
| [v2.9](#v29--more-overlays) | More overlays | L |
| [v3.0](#v30--international) | International | L |

Sizes: S = a few days, M = about a week, L = more than a week.

---

## v2.5 — Proven live

Every feature in the README status table is marked "Works" from a real broadcast, not only from test events.

- Run a real stream with a Kick app and a tunnel; check follower goal, viewers and uptime, subscriber total, chat and every alert type against what Kick shows.
- Handle `livestream.status.updated` in the relay: forward `is_live`, `started_at` and `ended_at` so the info panel switches the moment the stream starts or ends, instead of on the next poll.
- Handle `livestream.metadata.updated`: optional stream title line on the info panel.
- Confirm that `moderation.banned` removes the banned user's messages from `chat.html`; add a test if it is missing.
- Add an alerts preview GIF to the README.
- Replace the hand-written test and overlay count badges with values CI produces, or drop them.

**Done when:** the status table has no "not yet checked" entries, and the new events are covered by fixtures in `tests/fixtures/`.

## v2.6 — Alerts with sound and media

The alerts overlay matches what streamers expect from paid alert tools.

- A sound per alert type, with a volume setting. Ship a small set of license-free default sounds.
- Custom image or video per alert type (PNG, GIF, WEBM), loaded from the project folder.
- Channel point reward alerts from `channel.reward.redemption.updated`, with a per-reward on/off list.
- Optional text-to-speech for Kicks and gift messages, with a word filter and a length limit. Off by default.
- Studio buttons to send a test alert of each type through the relay.

**Done when:** each alert type can play a sound and show custom media, and the studio can fire a test alert for each type.

**Status (2026-11-03):** done, including the hidden-rewards list and text-to-speech (Kicks and reward messages; Kick's gifted subscriptions carry no message). Default sound files were not added: the built-in tones need no files.

## v2.7 — One-click OBS

Setting up all overlays in OBS takes one import instead of eight manual sources.

- Studio export of an OBS scene collection JSON: one scene with every chosen overlay as a Browser source, at the right size and with the current link.
- An OBS control dock (a page for **Docks → Custom Browser Docks**): test alerts, replay the last alert, pause alerts, change the countdown and announcement lines live.
- ~~Accept `settings.js` as an English-named alternative to `AYARLAR.js`.~~ Dropped: every setting already has an English name inside `AYARLAR.js`, and a second optional file would make every overlay request a missing file on each load.
- The studio checks the latest GitHub release and shows a notice when a newer version exists.

**Status (2026-11-03):** scene collection export (checked by loading it in OBS 33 on Windows), the control dock and the update notice are done. Changing the countdown and announcement lines live from the dock is done too.

**Done when:** a fresh OBS install gets every overlay from one import, tested on Windows OBS.

## v2.8 — Relay without the hard part

Live chat and alerts work without the streamer knowing what a tunnel or a webhook is.

- A first-run wizard in the relay: asks for the Kick app credentials, starts a `cloudflared` quick tunnel, registers the webhook with Kick, and confirms each step with a check mark.
- A relay status page on localhost: tunnel up, last event received, subscribed events, recent errors.
- A macOS relay executable in the release.
- The Windows executable stays unsigned. The README explains the SmartScreen prompt and how to check the file against `SHA256SUMS.txt`.

**Done when:** a new user goes from a downloaded executable to working chat by following the wizard alone.

**Status (2026-11-03):** `--tunnel` (the relay runs cloudflared and prints the Webhook URL), tunnel and recent errors in the studio's relay check (used as the status page, so the access key never has to be printed), the macOS executable, and the SmartScreen and checksum notes are done. Kick has no API for setting an app's Webhook URL, so pasting it stays a manual step; the guided setup (`setup`) asks for the channel and credentials and checks them with Kick. Registering the webhook stays a separate `subscribe` run.

## v2.9 — More overlays

The pack covers the widgets streamers usually add from other tools.

- Recent events list: latest follower, subscriber, gifter and Kicks.
- Leaderboards: top gifters and top Kicks senders for the stream.
- A Kicks goal bar.
- A sub train / event streak counter.
- Plain-text labels (latest follower and so on) for OBS Text sources.
- Goal auto-step: when a goal is reached, raise it by a set amount.
- A custom CSS field in the studio for advanced users.
- Chat: name colors, larger emote-only messages, and a horizontal layout. 7TV emotes, after confirming 7TV's public API supports Kick channels.

**Done when:** each new overlay has a preview mode, a studio tab and e2e coverage, like the existing ones.

**Status (2026-11-04):** the recent events list, both leaderboards and the plain-text labels are done, fed by stream stats the relay keeps.

## v3.0 — International

Streamers outside Turkey and English-speaking countries can use the pack in their own language.

- Move every label into one language file per language, so translations come in as small pull requests.
- Add Spanish, Brazilian Portuguese, German and Arabic. Arabic needs right-to-left layout checks.
- Format numbers, times and the countdown with `Intl`, by language.
- Host the studio and previews on GitHub Pages, so people can try it without downloading.
- Move long guides from the README into `docs/` (setup, relay, troubleshooting, FAQ) and keep the README short.

**Done when:** the studio and every overlay work in all listed languages, and the visual QA gate passes for right-to-left.

---

## Ongoing

- Split `studio.html` into separate script and style files, and `tests/run.js` into one file per overlay.
- Keep Dependabot and CodeQL green; keep actions pinned to commit hashes.
- Quick QA pass on every PR; a full visual and motion sweep before each release.
