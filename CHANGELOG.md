# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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

## [1.0.1] and [1.0.0]

Superseded by 2.0.0. See the notes of those releases on GitHub.
