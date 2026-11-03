# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The pack is now under the MIT License. Copies must keep the copyright notice; Kick's name and the role icons in `badges/` are not covered.
- `subscribe` now lists the existing subscriptions first and requests only the missing events, so running it again after an update cannot create duplicates.
- The README status table reflects the first checks against live Kick: chat delivered end to end, and the subscriber total read with a real app.
- The README drops the hand-written test count badge; a test keeps the theme and overlay badges in step with the code.

### Fixed

- `subscribe` failed with HTTP 400 against live Kick: it sent `broadcaster_user_id` as a string, and Kick accepts only a number. Found during the first live check; a test now pins the type.

### Added

- `docs/ROADMAP.md`: the planned milestones from v2.5 to v3.0.
- The relay passes on Kick's `livestream.status.updated` and `livestream.metadata.updated` events. With the relay running, `info-panel.html` shows or hides the moment the stream starts or ends, instead of on the next poll; for three minutes after such an event a poll that still disagrees is ignored, because Kick's public data can lag. Run `subscribe` once more to add these events.
- `bilgiBaslik` (`infoShowTitle`): shows the stream title as a tag on the info panel's bottom edge. It comes from Kick's public data and is updated at once by title changes through the relay. Off by default.
- `/health` reports `features.live`, so the info panel connects only to a relay that sends stream events.
- An alerts preview GIF in the README, and the info panel GIF shows the title tag.
- OBS control dock (`dock.html`, for **Docks → Custom Browser Docks**): relay status, pause and resume alerts, skip the one on screen, replay the last one, and a test alert per kind. The relay gains `POST /control` (same key, Host and origin checks; `pause`, `resume`, `skip`, `replay`), remembers the pause for pages that connect later, and reports `alertsPaused` and `lastAlert` in `/health`. The studio copies the dock link.
- Studio: **Download OBS scene collection** builds a file for OBS's **Scene Collection → Import**: one scene with all eight overlays as Browser sources at their sizes and current links, laid out for 1920 × 1080. The combined bar and countdown come in hidden, and the alerts source routes its audio through OBS. The format follows OBS's own importer and loader.
- Channel point reward alerts: the relay handles Kick's `channel.reward.redemption.updated`, and `alerts.html` shows the redeemer, the reward, its cost and the viewer's text. A redemption is shown once even though Kick sends it again when it is accepted; rejected ones are skipped. New setting `uyariOdul` (`alertRewards`, on). Needs the **Read Channel points rewards** scope on the Kick app; run `subscribe` again to add the event.
- Alert sounds: each kind plays its own short tone, synthesized in the page so the pack ships no sound files. `uyariSes` (`alertSound`, on by default) and `uyariSesSeviye` (`alertVolume`, 0–100, default 60). Previews and sample mode stay silent.
- Custom alert sound and art from the new `alerts/` folder: `follow`, `sub`, `gift` or `kicks` as `.mp3`/`.ogg`/`.wav` for the sound and `.webm`/`.png`/`.gif`/`.webp` for the card. Only these fixed local names are tried; nothing is loaded from a URL.
- `POST /test-alert?kind=…` on the relay's events port sends a fixed sample alert to the open alerts pages. Same key, Host and origin checks as the other routes, at most one every 1.5 s, and no request text reaches the stream.
- Studio: a sound switch, a volume field, **Play the sound here**, and one test alert button per kind.
- A logo (`branding/logo.svg`, with a 512 px PNG): a camera viewfinder framing a live dot and a goal bar. It heads the README and is the studio's tab icon.

## [2.4.0] - 2026-11-03

### Added
- Alerts overlay (`alerts.html`, 640 × 200) for new followers, new and renewed subscriptions, gifted subscriptions and Kicks. One card at a time; with five or more waiting each card stays half as long (at least 3 s), and during a raid the queue keeps at most 25 and drops the oldest follows first. New settings: `uyariSn` (3–30 s) and a switch per type (`uyariTakip`, `uyariAbone`, `uyariHediye`, `uyariKicks`). Usernames and Kicks messages are inserted as text.
- Relay: verifies and forwards Kick's `channel.followed`, `channel.subscription.new`, `channel.subscription.renewal`, `channel.subscription.gifts` and `kicks.gifted` events as `follow`, `sub`, `gift` and `kicks`. `relay/subscribe.js` subscribes to them.
- Relay executable for Windows and Linux in every release, so the relay runs without Node.js. `kick-relay-… subscribe` replaces `node relay/subscribe.js`. Each release also has the overlay zip and `SHA256SUMS.txt`.
- Relay: `RELAY_LOG_FORMAT=json` writes one `{time, level, msg}` object per line. `/health` reports `lastEventAt` and `features.alerts`.
- Studio: an Alerts tab and settings group, and a step-by-step relay check (reachable, access key, chat and alerts ready, last event received).
- Every setting has an English name (`channel`, `theme`, `followerGoal` …), accepted in `AYARLAR.js`, in links and by the relay. When both names are given, the Turkish one wins.

### Changed
- The version lives only in `package.json`; `npm version` copies it into `shared/kick-core.js`, and CI fails when they differ.
- CI adds ESLint, a JSDoc type check, the Chrome tests with the relay, a visual contrast and layout gate, a build and smoke test of the relay executable on Ubuntu and Windows, and CodeQL. Pushing a `vX.Y.Z` tag publishes the release.
- Development tools are pinned in `package.json` and tracked by Dependabot. The overlays and the relay still need no packages.

### Fixed
- Relay: Ctrl+C or a service stop closes the listeners and open overlay streams before the process exits.

## [2.3.6] - 2026-11-02

### Security
- Relay: a `RELAY_KEY` that is not 32–128 characters of `A-Z a-z 0-9 _ -` now stops the relay at startup instead of being accepted as a weak access key.

### Fixed
- Relay: `RELAY_WEBHOOK_PORT` and `RELAY_EVENTS_PORT` are validated; a typo now fails with a clear message instead of binding a random port or crashing.
- Relay and CI comments no longer state an outdated Node.js minimum or action tag.

## [2.3.5] - 2026-11-02

### Changed
- Studio: on desktop the preview tabs wrap onto a second row, so all seven overlays are visible without a scrollbar.
- Studio: every hover and state transition uses one easing curve and two durations; the language switch, preview tabs and background buttons now have hover states.
- Studio: the three setup steps are more compact on phones, so the settings start higher on the screen.
- Countdown: when the time runs out, the time pulses three times and then rests instead of pulsing forever.
- Studio: editing a setting updates the preview in place. The overlay no longer fades out and counts up from zero after every change; switching tabs or changing the motion setting still shows the intro.
- Studio: with no channel set, one notice above the link cards explains the setup hint and jumps to the channel field. The affected cards show a short "Needs channel" chip instead of repeating the sentence.
- Info panel: the live dot pulses more calmly.
- Theme shadows are tighter (4px offset, 14px blur), so they end inside the OBS source instead of being cut into a line at its edge on light footage.
- Studio: the theme cards show five per row where their names fit, so no theme sits alone on the last row at common desktop and tablet widths.
- Countdown: a long title wraps into two even lines on a narrow source.
- Studio: where the theme cards still leave one card alone on the last row (three or two per row), that card spans the row, so the grid always ends on a full row.
- README images are re-recorded from the current pages.

### Fixed
- Studio: the error toast in dark mode and the "Copied" button in light mode had text below 4.5:1 contrast; both now measure at least 5:1.
- Studio: the Pastel and Paper theme swatches keep a visible edge in light mode.
- Info panel: the live dot keeps a thin ring in the text colour, so it stays visible when the accent is close to the panel (violet or red on dark themes, yellow on Pastel).
- Subscriber bar and combined bar sat 16px low in their OBS source with their shadow cut off; they are centred now. Bars inside a wrapper no longer overhang it by 2px.
- Countdown: the Aurora fill is visible against its track (3:1 or more, was about 1.1:1).
- Studio: the setup steps are inside the page header landmark, and the preview panel (not the frame inside it) takes the keyboard stop, with a visible focus ring.

## [2.3.4] - 2026-10-22

### Security
- The relay's overlay port now requires a local access key. On first start the relay writes it to `AYARLAR.relay.js` next to the overlays (git-ignored, never commit it), and the overlays read it from there. Requests without a valid key get `401`, so a sandboxed page that sends `Origin: null` can no longer read the relay.
- Webhook rate limiting is split into a pre-auth ceiling and a separate quota for verified Kick deliveries, so unsigned traffic cannot starve real events.

## [2.3.3] - 2026-10-20

### Changed
- The milestone and goal glow is now a ready-drawn ring inside the bar that only fades in and out, so the bar is no longer repainted on every frame. Under heavy CPU load a milestone holds about 60 fps instead of about 53. The ring sits just inside the bar edge.

## [2.3.2] - 2026-10-20

### Changed
- More contrast headroom for OBS scaling and stream compression: small text (labels, titles, chips, chat) now measures at least 5.3:1 and large numbers at least 4.5:1 in every theme and accent, over light, dark and busy footage. Chip backgrounds darken by themselves until their text clears 6:1.
- Chat slides are cheaper: positions are measured once per frame for the whole burst, only visible rows move, and a ban that removes several messages no longer forces a layout per message. Under heavy CPU load a new message runs at about 55 fps instead of about 49.

### Fixed
- The gift badge count in chat is readable on every theme (7.6:1).
- `tools/visual-qa.js` and `tools/motion-qa.js` pick a free port, use a throwaway Chrome profile, and always close Chrome and their servers, even after a crash. A scenario that times out is retried once and listed at the end instead of stopping the run.

## [2.3.1] - 2026-10-19

### Fixed
- Readability over any footage: every theme now keeps value, label and goal text at 4.5:1 or better on light, dark and busy backgrounds (several were near 1:1 on light footage). Translucent themes get a real backing, and chat bubbles stay readable on bright scenes.
- Chip text picks dark or white automatically from the accent colour, and chips keep a thin outline so they never melt into the fill.
- The progress fill slides in instead of stretching, so the pill end, retro dots, terminal stripes and the ember tip keep their shape at any level.
- Chat: older messages slide up smoothly when a new one arrives or one leaves, and the oldest fades out instead of vanishing.
- Ticker: each line now enters from below, the progress line no longer snaps back, long lines scroll a little faster with soft edges, and with reduced motion they wrap or page instead of being cut off.
- A milestone no longer triggers a second bump; the goal-reached look arrives when the count finishes, with one pulse.
- Numbers no longer jitter with the Poppins font (digits use Inter there).
- The bar label stays put while the number counts, and the two rows of the combined bar line up.
- Reduced motion now also stops the count-up and the bar slides; low motion keeps every transition short.
- Countdown: retro keeps square corners, and the bar no longer redraws every second in low or reduced motion.

### Changed
- Lighter animations: the holo shine and the streamer badge no longer repaint every frame (holo idle CPU went from about 29 % to 0 % under load), the endless shimmer is now a short shine after a new follower or subscriber, and chat bubbles no longer use background blur.
- Entrances and exits share one set of durations and easing across all overlays.

### Added
- `tools/visual-qa.js` (screenshot grids of every overlay, theme and accent over light, dark and busy backgrounds, with measured contrast and colour-blindness views) and `tools/motion-qa.js` (frame timing, layout and paint counts, and filmstrips of every animation).

## [2.3.0] - 2026-10-19

### Added
- Relay endpoints: `GET /health` (version and features), `GET /channel?slug=` (cached Kick channel data, v2 with a v1 fallback) and `GET /subscribers?slug=` (official subscriber total, using the app credentials the relay holds).
- The relay finds your broadcaster ID from `kanal`, so chat works without `RELAY_BROADCASTER_ID`. The variable still works and takes precedence.
- Settings: `geriSayimSaat` (countdown to a clock time), `sohbetKomutGizle` (hide `!` commands), `sohbetGizliKullanicilar` (hide named users, e.g. bots), `sohbetSilinmeSn` (chat messages fade after N seconds), `hataNotu` (show or hide the on-screen status note) and `hedefKutlama` (goal milestones at 25, 50 and 75 %, and a goal-reached state).
- `relayAdresi` can be set in `AYARLAR.js`.
- `kanal` accepts a full `kick.com` link or an `@name`. Boolean settings accept `yes`, `no`, `on` and `off` as well.
- `?debug=1` shows a small status box in each overlay: data source, status, last poll and time to the next one.
- The info panel shows peak viewers and a note when its data may be out of date. Long ticker lines scroll as a marquee.
- Chat reconnects by itself after the relay restarts or the connection drops, with backoff.
- Studio: the new settings, copy-all-links, JSON export and import of the look (secrets are never included), an accent contrast warning, a relay health check and a confirmation before reset.
- CI runs on Node.js 24 as well, and checks the syntax of every tracked `.js` file. Dependabot keeps the pinned actions up to date.

### Changed
- Overlays poll with jitter, exponential backoff and `Retry-After`, and pause while the page is hidden.
- Overlays read Kick data through the relay when it is running, and go to Kick directly when it is not.
- Only the selected font is loaded.
- The goal bar fill uses a transform instead of animating width.
- Reduced motion is respected everywhere: `prefers-reduced-motion`, `animasyon` set to `low` or `off`.
- The studio preview no longer reloads on every edit. It shows sample data until you press "Live data".
- **Upgrade note:** `AYARLAR.local.js` is now loaded only by `subscriber-bar.html` and `combined-bar.html`. If you set `relayAdresi` in `AYARLAR.local.js`, move it to `AYARLAR.js`.

### Fixed
- Contrast of the `minimal` and `soft` themes, the broadcaster badge, and chat names on light backgrounds.
- Accessibility fixes in the studio (labels, focus, keyboard use).

### Security
- The relay no longer sends `Access-Control-Allow-Origin: *`. It accepts requests with no origin, `Origin: null` (files opened from disk) or a loopback origin (`127.0.0.1`, `localhost`, `[::1]`). Any other origin gets 403.
- The Kick client secret stays in the relay (from `KICK_CLIENT_SECRET` or `AYARLAR.local.js`). The subscriber bars use it directly only when the relay is not running.
- Kick app credentials (`kickClientId`, `kickClientSecret`) are read only from `AYARLAR.local.js`. Values placed in `AYARLAR.js` are ignored.
- Chat events are accepted only for the broadcaster's user ID. `RELAY_ALLOW_ANY_BROADCASTER=1` turns this check off.
- Relay requests to Kick have timeouts and caching, and the relay answers 429 with `Retry-After` when Kick limits it. Webhook timestamps and bodies are validated more strictly.

## [2.2.0] - 2026-10-16

### Added
- Studio rebuilt as a guided, two-language (Turkish and English) page: channel, look, content, then **Add to OBS**.
- A ready link for every overlay (Copy link). It holds only the settings that overlay reads and only the ones that differ from the defaults, never Kick app credentials.
- One sticky preview with a tab per overlay, four preview backgrounds, and "open in a new tab". On phones the preview stays pinned and compact at the top.
- Settings are grouped per overlay; the group of the overlay being previewed opens by itself. A reset button keeps the channel.
- Light and dark page following the system, skip link, keyboard-operable tabs, toast feedback.
- Tests for the studio: links, tabs, presets, language switch, reset, and a check that both languages define every text.
- `screenshots/studio.png`.

### Changed
- The AYARLAR.js file moved into an optional "Settings file method" section; links are now the main way to use the pack in OBS.
- The chat preview in the studio always shows sample messages, since live chat needs the local relay.
- README (English and Turkish) describes the link-based setup.

## [2.1.1] - 2026-10-16

### Fixed
- Countdown title read "BIRAZDAN" with a plain I: CSS uppercase on an English page broke the Turkish dotted İ. The title now keeps its normal case.
- Status notes on the subscriber and combined bars were Turkish only; they now follow the `dil` setting.
- Stale chat troubleshooting entry in the studio (it still described the old Pusher feed).

### Changed
- Numbers use Turkish separators (1.234) when `dil` is `tr`, and the page language follows `dil`.
- Wording, link and date fixes in the README and changelog; consistent header comments in the overlay pages.

## [2.1.0] - 2026-10-16

### Added
- `countdown.html`: a "starting soon" countdown (settings `geriSayimDk`, `geriSayimBaslik`).
- `ticker.html`: an announcement bar that rotates up to 12 lines (settings `duyuruMetinleri`, `duyuruSn`).
- Studio: previews and inputs for both new overlays.
- `tools/record-previews.js`: re-creates every README image from the real overlay pages.
- Project files: `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates, a GitHub Actions workflow, `package.json`, `.editorconfig`, `.gitattributes`.
- README hero image and animations for the new overlays.

### Changed
- Chat: the streamer label is now a readable gradient badge; user names are darkened on light themes (`pastel`, `paper`); status messages follow the `dil` setting.
- `soft` theme: darker fill and a stronger text shadow so the white text stays readable.
- Node.js 20 or newer is now the documented requirement for the relay and the tests.

### Fixed
- Studio previews were painted on an opaque white background in Chrome, so white text was invisible.
- Studio section numbers were out of order, and the "Minimal" preset button wrapped on narrow screens.
- `AYARLAR.js` listed 8 of the 13 themes.
- Removed a pass-through helper and an ineffective theme rule from the chat overlay.

## [2.0.0] - 2026-10-16

### Added
- Thirteen themes, three corner shapes, four fonts, three motion levels and a preview mode (`?onizleme=1`).
- Studio (`studio.html`) with live previews, presets and a downloadable `AYARLAR.js`.
- Live chat through the local relay in `relay/`, with Kick signature verification.
- Subscriber total from Kick's official API with your own app credentials.

### Changed
- Documentation rewritten in English and Türkçe.

### Removed
- The old Pusher chat and subscriber feed, which Kick no longer accepts.

## [1.0.1] - 2026-06-25

Bug fixes. Superseded by 2.0.0.

## [1.0.0] - 2026-06-24

First release. Superseded by 2.0.0.
