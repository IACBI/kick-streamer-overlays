# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
