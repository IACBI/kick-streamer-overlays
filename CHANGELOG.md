# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- The README shows the studio in English in the English section and in Turkish in the Turkish section (`screenshots/studio-en.png`, `screenshots/studio-tr.png`).

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
