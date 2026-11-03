<a id="top"></a>
# <img src="branding/logo.svg" width="44" height="44" alt="" align="top"> Kick Streamer Overlay Pack

Free OBS overlays for [Kick](https://kick.com): goal bars, a viewer and uptime panel, a chat overlay, follow, subscription, gift and Kicks alerts, a "starting soon" countdown, a rotating announcement bar, and a studio that gives you a ready link for each overlay. The basic setup needs no server and no account.

[![CI](https://github.com/IACBI/kick-streamer-overlays/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/kick-streamer-overlays/actions/workflows/ci.yml) ![License](https://img.shields.io/badge/license-MIT-53fc18) ![OBS](https://img.shields.io/badge/OBS-Browser%20source-111) ![Themes](https://img.shields.io/badge/themes-13-7c3aed) ![Overlays](https://img.shields.io/badge/overlays-12-0ea5e9)

<p align="center"><img src="screenshots/hero.png" alt="Goal bars, a countdown, an announcement bar, an info panel and chat in one theme family" width="860"></p>

**Read this in:** [English](#english) · [Türkçe](#turkce)

---

<a id="english"></a>
## English

### Overview

![All thirteen themes in turn, shown on the combined goal bars](screenshots/themes.gif)

<sub>Each of the 13 themes in turn, with sample numbers. The bars fill and a light sweep crosses the fill.</sub>

Open `studio.html`, enter your channel name, pick a look, and copy the link of each overlay into an OBS Browser source. The overlays read Kick's public channel data directly. If the optional relay is running, they ask it first instead. The relay keeps the answers for a few seconds, so several overlays share one request to Kick.

<p align="center"><img src="screenshots/studio-en.png" alt="The studio: channel, look and theme choices on the left, a live preview with overlay tabs on the right" width="860"></p>

| Feature | Status (checked 2026-11-03) |
|---|---|
| Follower goal | Works. The number on screen matches Kick's public count for kick.com/iacbi. |
| Viewers and uptime | Works from Kick's public data. Not yet checked on a live broadcast. |
| Subscriber total | Needs a free Kick developer app (see [Configuration](#configuration-en)). Checked with a real app on 2026-11-03: the token and channel lookup work, and the count (0) matches the channel. Not yet checked with a channel that has subscribers. Without an app, enter the count by hand. |
| Live chat | Works through the optional relay (see [Live chat](#live-chat-en)). Needs a Kick app and a public tunnel. Checked with a real message sent in kick.com/iacbi's chat on 2026-11-03: it went from Kick through a Cloudflare tunnel and the relay's signature check onto the overlay. Without the relay, `chat.html` stays empty instead of showing fake messages. |
| Alerts | Same relay and setup as live chat. Tested with signed test events built from the payloads in Kick's documentation, in a real browser; not yet with live Kick delivery. |

### Features

- 13 themes: `glass`, `vivid`, `soft`, `cinema`, `neon`, `minimal`, `pastel`, `terminal`, `aurora`, `holo`, `ember`, `paper`, `retro`
- Corner shapes (`pill`, `rounded`, `square`), four fonts (only the one you pick is loaded), labels in Turkish, English, Spanish, Brazilian Portuguese, German or Arabic (right to left), or Turkish and English together, three motion levels, and an optional percentage. Reduced-motion settings are respected everywhere
- A session gain next to the subscriber count, such as "+3 this stream". It survives an OBS refresh for 12 hours
- Goal bars pulse at 25, 50 and 75 %, and show a goal-reached state at 100 % (`hedefKutlama`). With `hedefArtis` a reached goal moves up by a set step instead
- A countdown to a length in minutes or to a clock time (`geriSayimSaat`), and an announcement bar that rotates your lines. Both work without any Kick data
- Chat filters: hide `!` commands and named users such as bots, and fade messages out after a set time. A message of emotes alone shows them larger, and `sohbetYatay` puts the chat in one row for a strip along the screen edge
- Custom CSS for every overlay (`ozelCss`), checked so it can only restyle the page and never load anything from elsewhere
- An info panel with viewers, uptime, peak viewers and, optionally, the stream title (`bilgiBaslik`). With the relay it switches the moment the stream starts or ends
- An alerts overlay for new followers, new and renewed subscriptions, gifted subscriptions, Kicks and channel point rewards. One card at a time; during a raid the queue keeps at most 25 and drops the oldest follows first. Each alert type can be turned off. Each type plays its own short sound, and your own sound and image or video can replace it
- A Kicks goal bar and a sub train (subscriptions in a row, with the time left to keep it going) for the current stream
- A recent events list and a leaderboard (top gifters or top Kicks senders) for the current stream. The numbers start over when the stream goes live, survive a relay restart, and can be cleared from the dock. The relay also writes them as plain text files for OBS Text sources
- Preview mode (`?onizleme=1`) with sample numbers and no network calls, and a status box with `?debug=1`
- Studio in Turkish and English: live preview with a tab per overlay, quick looks, a copy-link button for each overlay or all of them, JSON export and import of the look (credentials are never included), the `AYARLAR.js` file as an alternative, a step-by-step relay check, and a connection test for your Kick app
- Every setting also has an English name (`channel`, `theme`, `followerGoal` …), in `AYARLAR.js` and in links
- The studio tells you when a newer release is out (one request to GitHub a day at most)
- Built for OBS: animations use `transform` and `opacity`. Polls back off when Kick is slow or limits requests, pause while the page is hidden, and never overlap. Chat reconnects by itself, and no Kick data is ever inserted as HTML

### Requirements

- OBS Studio with Browser sources
- A Kick channel name
- Optional: a Kick developer app (client ID and secret) for the subscriber total
- For the relay: Node.js 20 or newer, or the relay executable from the [releases page](https://github.com/IACBI/kick-streamer-overlays/releases), which needs no Node.js
- Node.js 20 or newer, for the tests
- Optional, for live chat: a tunnel tool such as `cloudflared` or `ngrok`

### Installation

1. Download the `kick-streamer-overlays-vX.Y.Z.zip` file from the [releases page](https://github.com/IACBI/kick-streamer-overlays/releases) (or clone this repository), unpack it, and keep the folder somewhere permanent.
2. Open `studio.html` in your browser. Enter your channel name and pick a look.
3. In the studio's **Add to OBS** step, press **Copy link** on the overlay you want. In OBS add a source with **Sources → + → Browser**, turn **Local file** off, paste the link into **URL**, and set the width and height shown on the card (they are also in the table below).
4. After you change a setting in the studio, copy the link again and paste it into the source.

**All overlays at once.** In the same step, press **Download OBS scene collection**. In OBS choose **Scene Collection → Import**, add the downloaded `kick-overlay-obs.json`, then pick **Kick Overlay Pack** from the **Scene Collection** menu. You get one scene with every overlay as a Browser source at its size, laid out for a 1920 × 1080 canvas; the combined bar and the countdown come in hidden, and the alerts source already has **Control audio via OBS** on. Download it again after you change settings. Keep the project folder where it is: the links point at its files.

**Control dock.** With the relay running, `dock.html` works as an OBS dock: press **Copy the OBS control dock link** in the studio, then in OBS open **Docks → Custom Browser Docks**, type a name and paste the link as the URL. It shows whether the relay is running and lets you pause and resume alerts (they keep queueing while paused), skip the one on screen, replay the last one, and send a test alert of each kind. It can also restart the countdown with new minutes and a title, and replace the announcement bar's lines during the stream (**Back to settings** returns to `duyuruMetinleri`). An overlay that opens later picks up the running countdown and the current lines.

Prefer OBS's **Local file** option? Open the studio's **Settings file method**, download `AYARLAR.js`, put it in the project folder in place of the existing file, tick **Local file** in OBS, and choose the overlay file. After a change, right-click the source and choose **Refresh**. You can also edit `AYARLAR.js` by hand.

> **Local file and the relay.** OBS 33 loads a **Local file** source from a page address that its browser does not let reach the relay on `127.0.0.1`. Chat, alerts, live stream status and the dock's countdown and announcement changes then cannot work, and the overlay says to use the studio link instead. For anything that needs the relay, use the link (Local file off).

A link holds only your public settings, never your Kick app credentials. The subscriber total reads them from `AYARLAR.local.js` (or from the relay, see [Relay](#relay-en)).

### Usage

| File | Shows | OBS size (W × H) |
|---|---|---|
| `follower-bar.html` | Follower goal | 520 × 90 |
| `subscriber-bar.html` | Subscriber goal | 520 × 90 |
| `combined-bar.html` | Followers and subscribers in one panel | 520 × 180 |
| `info-panel.html` | Viewers and uptime, shown only while live | 300 × 80 |
| `chat.html` | Live chat (needs the relay, see Live chat) | 460 × 760 |
| `alerts.html` | Follow, subscription, gift and Kicks alerts (needs the relay, see Live chat) | 640 × 200 |
| `countdown.html` | "Starting soon" countdown that starts when the source loads | 520 × 190 |
| `ticker.html` | Announcement bar that rotates your lines | 760 × 80 |
| `events.html` | Recent follows, subscriptions, gifts and Kicks of this stream (needs the relay) | 420 × 400 |
| `leaderboard.html` | Top gifters or top Kicks senders of this stream (needs the relay) | 380 × 400 |
| `kicks-bar.html` | Kicks goal for this stream (needs the relay) | 520 × 90 |
| `sub-train.html` | Sub train: subscriptions in a row and the time left; hidden while no train runs (needs the relay) | 520 × 90 |
| `studio.html` | Studio: previews, settings and links. Open it in a browser, not in OBS | — |

These previews use sample data (`?onizleme=1`), so they show the design and make no request to Kick.

<p align="center">
  <img src="screenshots/chat-preview.gif" width="500" alt="Chat preview: sample messages arrive one by one, with badge art"><br>
  <sub><b>Chat preview.</b> Messages arrive one by one and the feed keeps a fixed number. The crown is badge art from <code>badges/</code>.</sub>
</p>

<p align="center">
  <img src="screenshots/info-panel.gif" width="360" alt="Info panel: the viewer count rises and the uptime counts each second"><br>
  <sub><b>Info panel.</b> The viewer count eases up and the uptime counts every second while the channel is live. The title tag at the bottom is optional (<code>bilgiBaslik</code>).</sub>
</p>

<p align="center">
  <img src="screenshots/alerts.gif" width="560" alt="Alerts: a follow, a subscription, gifted subscriptions, Kicks and a renewal appear one at a time"><br>
  <sub><b>Alerts.</b> One card at a time: follows, new and renewed subscriptions, gifted subscriptions and Kicks. Each type can be turned off.</sub>
</p>

<p align="center">
  <img src="screenshots/combined.gif" width="560" alt="Combined panel: both goal bars fill and the subscriber chip shows +3"><br>
  <sub><b>Combined panel.</b> Both goal bars fill smoothly. The chip shows how many subscribers were gained during this stream.</sub>
</p>

<p align="center">
  <img src="screenshots/countdown.gif" width="460" alt="Countdown: the clock ticks down and the bar drains"><br>
  <sub><b>Countdown.</b> Put it on your "starting soon" scene. The clock starts when the source loads, so refreshing the source restarts it. At zero it shows "Going live!".</sub>
</p>

<p align="center">
  <img src="screenshots/ticker.gif" width="640" alt="Announcement bar: three lines rotate with a progress line"><br>
  <sub><b>Announcement bar.</b> Your lines rotate with a soft transition. A thin line shows when the next one arrives.</sub>
</p>

Troubleshooting. Messages appear in the language set by `dil`.

- **`⚙ AYARLAR.js → kanal`** is shown: enter your channel name in the studio and copy the link again (or set `kanal` in `AYARLAR.js` and refresh the source).
- **Kick app credentials rejected**: check `kickClientId` and `kickClientSecret` in `AYARLAR.local.js`. The studio's connection test shows the same error.
- **Kick unreachable** or **Kick error, showing last value**: the last value stays on screen and the overlay tries again, waiting longer after each failure.
- **Kick rate limit, showing last value**: Kick asked the overlay to slow down. It waits for the time Kick gave and then carries on.
- **Chat relay not running** (`chat.html`) or **Alert relay not running** (`alerts.html`): start the relay (`node relay/server.js`, or the relay executable). Until then the chat stays empty and no alerts appear. The studio's **Check relay** button shows which step fails.
- **No subscriber data**: the Kick app answered without a subscriber figure for this channel.
- **Subscriber count is 0**: no Kick app is set up, so the value comes from `aboneSayisi`.
- **The countdown restarted**: it counts from the moment the source loads. Refreshing the source, or switching scenes with *Shutdown source when not visible* on, starts it again.
- **`⚙ AYARLAR.js → duyuruMetinleri`** on the announcement bar: fill in `duyuruMetinleri`, then refresh the source.
- **Anything else**: add `?debug=1` to the link. A small box at the bottom left shows the data source, the status, the last poll and the next one. Remove the parameter when you are done.

<a id="live-chat-en"></a>
#### Live chat and alerts (optional)

Kick sends chat messages, bans, follows, subscriptions, gifted subscriptions, Kicks, channel point reward redemptions and stream start, end and title changes to a web address you register in your Kick app. The relay in `relay/` receives them, checks Kick's signature, and passes them to `chat.html`, `alerts.html` and `info-panel.html`.

1. Create a Kick developer app. Put its client ID and secret in `AYARLAR.local.js` (see [Configuration](#configuration-en)), or in the environment as `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`.

   **Guided setup:** run `node relay/setup.js` (or `kick-relay-win-x64.exe setup`). It asks for your channel, Client ID and Client Secret (the secret is not shown while you type), checks them with Kick, and saves them: the credentials to `AYARLAR.local.js`, the channel to `kanal` in `AYARLAR.js`. Other keys in `AYARLAR.local.js` are kept, but comments in that file are not. That covers steps 1 and 2.
2. Let the relay know your channel. It looks up your broadcaster ID from `kanal` in `AYARLAR.js` (or from `KICK_CHANNEL`) when it starts. If you already know the ID, set `RELAY_BROADCASTER_ID` instead and the lookup is skipped.
3. Start the relay and leave it running while you stream:

   ```bash
   node relay/server.js
   ```

   Without Node.js, use the relay executable instead (see [Relay](#relay-en)).
4. Make the relay's webhook port reachable from the internet with a tunnel, for example:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8788
   ```

   Use the HTTPS address the tunnel prints, with `/kick/webhook` added at the end.

   **Shortcut:** with [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) installed, start the relay with `--tunnel` instead (`node relay/server.js --tunnel`, or `kick-relay-win-x64.exe --tunnel`). The relay runs the quick tunnel itself, prints the full **Webhook URL for your Kick app**, starts the tunnel again if it stops, and closes it when the relay stops. A quick tunnel gets a new address each time it starts, so paste the new one into Kick when it changes. The studio's **Check relay** shows the current Webhook URL and the relay's latest warnings. If cloudflared is not on `PATH`, set `RELAY_CLOUDFLARED` to its full path.
5. Go to [kick.com/settings/developer](https://kick.com/settings/developer), click **Edit** on your app, turn on **Enable Webhooks**, and paste the address into the **Webhook URL** box. Kick's [event introduction](https://github.com/KickEngineering/KickDevDocs/blob/main/events/introduction.md) describes these steps.
6. Subscribe to the events (chat, bans, follows, subscriptions, renewals, gifted subscriptions, Kicks, channel point rewards, and stream status and title). Reward alerts need the **Read Channel points rewards** scope on your Kick app. If you subscribed with an older version, run this again; it adds only the missing events:

   ```bash
   node relay/subscribe.js
   ```

   With the relay executable, run it with `subscribe` instead, for example `kick-relay-win-x64.exe subscribe`. Add `--list` to see the subscriptions that already exist.
7. Add `chat.html` and `alerts.html` in OBS as usual. Messages and alerts appear as soon as Kick delivers them. `info-panel.html` keeps reading viewers from Kick's public data, and with the relay running it also switches on and off as soon as the stream starts or ends.

The relay accepts only events with a valid Kick signature, passes each one on only once, and passes events on only for your broadcaster ID. While that ID is unknown, events are dropped and the relay says so in its log; it retries the lookup at most once a minute. Its overlay port listens on `127.0.0.1` only and refuses requests with a foreign `Host` header, so the tunnel exposes just the webhook path. Kick limits subscriptions per app: 10,000 per event type, and 1,000 for chat messages while the app is unverified.

<a id="relay-en"></a>
#### Relay: endpoints and subscriber total (optional)

The relay is one small Node.js program with no packages. It has two listeners, both bound to `127.0.0.1`. The webhook port (8788 by default) takes Kick's events on `POST /kick/webhook`, and is the only path meant for a tunnel. The overlay port (8790 by default) serves the overlays:

| Endpoint | Answer |
|---|---|
| `GET /events` | Server-sent events: `chat` and `ban` for `chat.html`; `follow`, `sub`, `gift`, `kicks` and `reward` for `alerts.html`; `stats` for `events.html` and `leaderboard.html`. |
| `GET /health` | The relay version, the number of open event streams, `lastEventAt` (when the last signed Kick event arrived, or `null`), and what it can do: `chat`, `alerts`, `channel` and `subscribers`. The studio's **Check relay** button shows each of these as a line. |
| `POST /test-alert?kind=KIND` | Sends a fixed sample alert (`follow`, `sub`, `gift`, `kicks` or `reward`) to the open alerts pages, sound and art included. The studio's test buttons use it. At most one every 1.5 seconds. |
| `POST /control?action=ACTION` | The control dock's buttons: `pause`, `resume`, `skip` or `replay` (the last alert again, under a new id). A page that connects while alerts are paused is told at once. At most one every 0.3 seconds. |
| `POST /overlay?target=countdown&minutes=N&title=TEXT` | The dock's countdown: starts a new countdown of 0–720 minutes on every connected `countdown.html`. The title is optional (up to 60 characters). A page that connects before it ends gets it too. |
| `POST /overlay?target=ticker&lines=A\|B` | The dock's announcement lines for every connected `ticker.html`, separated by `\|` (up to 12 lines, 400 characters in all). `reset=1` instead of `lines` goes back to `duyuruMetinleri`. Same limit as `/control`. |
| `GET /stats` | This stream's numbers: totals, the last 20 events, the top 10 gifters and Kicks senders. Test alerts and replays are not counted. |
| `POST /stats/reset` | Starts the numbers over (the dock's **Reset stream stats**). They also start over when Kick reports the stream going live. Same limit as `/control`. |
| `GET /channel?slug=NAME` | Kick's public channel data, cached for 20 seconds. The `X-Kick-Source` header says whether it came from Kick's v2 or v1 API. |
| `GET /subscribers?slug=NAME` | Your subscriber total from Kick's official API, using the app credentials the relay holds. Cached for 15 seconds. Returns `subs`, `gifted`, `canceled`, `live`, `viewers`, `startMs` and `title`. |

Every request must carry the access key from `AYARLAR.relay.js` as a `key` query parameter, for example `/health?key=…`. The relay writes that file next to the overlays on its first start, and the overlays read it from there. Without a valid key the relay answers `401`. The file is git-ignored, so do not share it.

When Kick limits the relay, it answers `429` with `Retry-After`. Without credentials `/subscribers` answers `503`, and a rejected login answers `401`.

**Relay without Node.js.** Each release has a relay executable: `kick-relay-win-x64.exe` for Windows, `kick-relay-linux-x64` for Linux and `kick-relay-macos-arm64` for macOS on Apple silicon. Put it in the overlay folder, next to `AYARLAR.js`, and run it in place of `node relay/server.js`; it reads and writes the same files there. Compare its checksum with `SHA256SUMS.txt` from the same release. The executables are not code-signed. On Windows, SmartScreen may say "Windows protected your PC" on the first start: check the checksum first, then choose **More info → Run anyway**. On macOS, make the file runnable and clear the download quarantine once (`chmod +x kick-relay-macos-arm64 && xattr -d com.apple.quarantine kick-relay-macos-arm64`), then start it from Terminal; on an Intel Mac, use Node.js.

**Stream stats and text files.** The relay keeps this stream's numbers in `kick-relay-stats.json` next to `AYARLAR.js`, so a restart mid-stream loses nothing. After the first event it also writes plain text files to `labels/` for OBS Text sources (**Read from file**): `latest-follower.txt`, `latest-subscriber.txt`, `latest-gifter.txt`, `latest-kicks.txt`, `top-gifter.txt`, `top-kicks.txt`, `follows-total.txt`, `subs-total.txt` (subscriptions plus gifted ones) and `kicks-total.txt`. Set `RELAY_LABELS=0` to turn the text files off. Both are git-ignored.

The subscriber bars need no client secret in the browser when the relay runs. Put the app credentials in `AYARLAR.local.js` or the environment and start the relay. The bars then get the total from `/subscribers`, and the page sends no request to Kick itself. If the relay is not running, the bars use `AYARLAR.local.js` directly. If that is missing too, they show `aboneSayisi`.

The relay reads these environment variables. Each has a default, and the settings files are used when a variable is not set:

| Variable | Default | Purpose |
|---|---|---|
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | from `AYARLAR.local.js` | Kick app credentials. The environment wins. |
| `KICK_CHANNEL` | `kanal` in `AYARLAR.js` | Channel used for the broadcaster lookup. |
| `RELAY_BROADCASTER_ID` | looked up | Your broadcaster user ID. Skips the lookup. |
| `RELAY_ALLOW_ANY_BROADCASTER` | off | `1` accepts events from any channel. For testing only. |
| `RELAY_WEBHOOK_PORT` | `8788` | Webhook port. |
| `RELAY_EVENTS_PORT` | `8790` | Overlay port. If you change it, set `relayAdresi` to match. |
| `RELAY_KEY` | generated into `AYARLAR.relay.js` | Overlay access key. Must be 32–128 characters of `A-Z a-z 0-9 _ -`; the relay refuses to start otherwise. |
| `RELAY_LOG_FORMAT` | `text` | `json` writes each log line as one `{"time", "level", "msg"}` object, for a log collector or a service manager. |
| `RELAY_LABELS` | on | `0` stops the plain text files in `labels/`. |

<a id="configuration-en"></a>
### Configuration

Every setting lives in `AYARLAR.js`, and the studio writes the same settings into the links it gives you. A link overrides `AYARLAR.js`. An invalid value falls back to its default, and numbers are limited to their range. Yes/no settings accept `true`/`false`, `yes`/`no`, `on`/`off` or `1`/`0`. Each setting can be written with its Turkish or its English name; if both are given, the Turkish one wins.

| Setting | English name | Values | Default |
|---|---|---|---|
| `kanal` | `channel` | Your channel name, as in `kick.com/NAME`. A full kick.com link or `@NAME` also works | *(empty)* |
| `stil` | `theme` | `glass` · `vivid` · `soft` · `cinema` · `neon` · `minimal` · `pastel` · `terminal` · `aurora` · `holo` · `ember` · `paper` · `retro` | `glass` |
| `sekil` | `shape` | `pill` · `rounded` · `square` | `pill` |
| `yaziTipi` | `font` | `inter` · `poppins` · `nunito` · `mono` | `inter` |
| `dil` | `language` | `tr` · `en` · `both` · `es` · `pt` · `de` · `ar` | `both` |
| `animasyon` | `motion` | `normal` · `low` · `off` | `normal` |
| `renk` | `accent` | Accent color, hex (e.g. `#53fc18`) | `#53fc18` |
| `ozelCss` | `customCss` | Custom CSS applied over the theme on every overlay, up to 2000 characters. A value with `url(`, `@import`, `@font-face`, `image-set` or a backslash is ignored as a whole | *(empty)* |
| `yayinciYazisi` | `streamerLabel` | Label next to your name in chat (chat only) | `Streamer` |
| `takipciHedefi` | `followerGoal` | Follower goal | `1000` |
| `takipciYedek` | `followerFallback` | Follower count shown when Kick cannot be reached | `0` |
| `aboneHedefi` | `subscriberGoal` | Subscriber goal | `100` |
| `aboneSayisi` | `subscriberCount` | Subscriber count when no Kick app is set up | `0` |
| `oturumFarkiGoster` | `showSessionGain` | Show the gain during this stream, such as "+3" | `true` |
| `yuzdeGoster` | `showPercent` | Show the percentage of the goal | `false` |
| `hedefKutlama` | `goalCelebration` | Milestone pulse at 25, 50 and 75 %, and a goal-reached state at 100 % | `true` |
| `hataNotu` | `statusNote` | Show the small status note on screen, such as "Kick unreachable" | `true` |
| `bilgiBaslik` | `infoShowTitle` | Show the stream title on the info panel's bottom edge | `false` |
| `yenilemeSn` | `refreshSeconds` | Refresh interval in seconds (10–600) | `30` |
| `sohbetMaksMesaj` | `chatMaxMessages` | Most chat messages on screen at once (3–20) | `8` |
| `sohbetKomutGizle` | `chatHideCommands` | Hide chat messages that start with `!` | `false` |
| `sohbetGizliKullanicilar` | `chatHiddenUsers` | Usernames hidden from chat, comma-separated, not case-sensitive (up to 300 characters) | *(empty)* |
| `sohbetSilinmeSn` | `chatFadeSeconds` | Seconds before a chat message fades out (0–600). `0` keeps it until newer messages push it out | `0` |
| `sohbetYatay` | `chatHorizontal` | Chat in one horizontal row, newest on the right, for a strip such as a 1280 × 80 source | `false` |
| `geriSayimDk` | `countdownMinutes` | Countdown length in minutes (1–720) | `5` |
| `geriSayimSaat` | `countdownTime` | Countdown target as a 24-hour clock time, `HH:MM` (e.g. `20:30`). Overrides `geriSayimDk`; if the time has already passed today, it counts to tomorrow | *(empty)* |
| `geriSayimBaslik` | `countdownTitle` | Countdown title. Empty shows "Starting soon" in your label language | *(empty)* |
| `duyuruMetinleri` | `announcements` | Announcement lines separated by `\|`, up to 12, e.g. `Follow for more \| !discord \| New video every Friday` | *(empty)* |
| `duyuruSn` | `announcementSeconds` | Seconds each announcement stays (3–60) | `6` |
| `uyariSn` | `alertSeconds` | Seconds each alert stays (3–30). With 5 or more waiting, each stays half as long, at least 3 | `6` |
| `uyariTakip` | `alertFollows` | Show follow alerts | `true` |
| `uyariAbone` | `alertSubs` | Show new and renewed subscription alerts | `true` |
| `uyariHediye` | `alertGifts` | Show gifted subscription alerts | `true` |
| `uyariKicks` | `alertKicks` | Show Kicks alerts | `true` |
| `uyariOdul` | `alertRewards` | Show channel point reward redemptions (pending or accepted; rejected ones are skipped) | `true` |
| `uyariSes` | `alertSound` | Play a sound with each live alert. Previews stay silent | `true` |
| `uyariSesSeviye` | `alertVolume` | Alert volume (0–100) | `60` |
| `uyariOdulGizle` | `alertRewardsHidden` | Reward names that never show an alert, separated by `\|` (not case-sensitive) | *(empty)* |
| `uyariTts` | `alertTts` | Read Kicks and reward messages aloud with the computer's voice. The speech plays on the computer's default output, not through the OBS source, so it reaches the stream only when OBS captures desktop audio. Previews stay silent | `false` |
| `uyariTtsUzunluk` | `alertTtsMaxLength` | Longest message read aloud, in characters (20–200); a longer one is cut at a word break | `120` |
| `uyariTtsYasak` | `alertTtsBlockedWords` | Words separated by commas. A message whose name or text contains one is not read at all. Links are never read | *(empty)* |
| `olaySayisi` | `eventsCount` | Recent events (`events.html`): how many events to show (3–10) | `5` |
| `liderTur` | `leaderboardType` | Leaderboard (`leaderboard.html`): `gift` ranks gifted subscriptions, `kicks` ranks Kicks | `gift` |
| `liderSayisi` | `leaderboardCount` | People on the leaderboard (3–10) | `5` |
| `kicksHedefi` | `kicksGoal` | Kicks goal bar (`kicks-bar.html`): Kicks to reach this stream | `1000` |
| `trenSn` | `subTrainSeconds` | Sub train (`sub-train.html`): seconds a new subscription has to keep the train going (30–600) | `120` |
| `hedefArtis` | `goalStep` | Goal auto-step for the follower, subscriber and Kicks bars: a reached goal rises by this much. `0` = off | `0` |

Settings that are only for the local machine. They are never read from a link:

| Key | Where | Default | Purpose |
|---|---|---|---|
| `kickClientId`, `kickClientSecret` | `AYARLAR.local.js` | *(empty)* | Kick app credentials for the subscriber bars. The relay reads them too. |
| `relayAdresi` (`relayAddress`) | `AYARLAR.js` | `http://127.0.0.1:8790` | Address of the relay's overlay port. Only `https`, or `http` on `127.0.0.1` or `localhost`, is accepted. |
| `apiBase`, `tokenBase` | `AYARLAR.js` | `https://api.kick.com`, `https://id.kick.com` | Kick API addresses used by the subscriber bars. Leave them alone unless you test against a mirror. |

**Upgrading from 2.2.x.** `AYARLAR.local.js` is now loaded only by `subscriber-bar.html` and `combined-bar.html`. If you set `relayAdresi` in that file, move it to `AYARLAR.js`. The relay still reads the credentials from `AYARLAR.local.js`.

**Alert sounds and art (optional).** Each alert kind plays a short built-in sound. To use your own, put `follow`, `sub`, `gift`, `kicks` or `reward` with `.mp3`, `.ogg` or `.wav` in `alerts/`; an image or video with the same name (`.webm`, `.png`, `.gif`, `.webp`) replaces the icon on the card. Only these names in that folder are opened, never a web address. In OBS, turn on **Control audio via OBS** for the alerts source so the sound reaches your stream. The studio's **Try it** row plays the sound on the page and sends test alerts through the relay (see `alerts/OKU-README.txt`).

**Badge art (optional).** Put an image named `moderator`, `vip`, `og`, `founder`, `verified`, `gifter` or `staff` (`.svg`, `.png`, `.webp`, `.gif`, `.jpg`, `.jpeg`) in `badges/` to replace the drawn chat badge. A missing file falls back to the drawn symbol. The five included icons are Kick's role artwork, added for convenience; replace or remove them freely (see `badges/OKU-README.txt`).

**Kick app for the subscriber total (optional)**

1. Create an app in Kick's developer area. The documentation is at [docs.kick.com](https://docs.kick.com).
2. Next to `AYARLAR.js`, create `AYARLAR.local.js`:

   ```js
   window.KICK_OVERLAY_YEREL = {
     kickClientId: "YOUR_CLIENT_ID",
     kickClientSecret: "YOUR_CLIENT_SECRET"
   };
   ```

3. Keep this file private. `.gitignore` already lists it, so Git will not track it. Do not share it or commit it.

Without the relay, the subscriber bars request and renew their own access token from `id.kick.com`. With the relay running, they ask the relay instead (see [Relay](#relay-en)). Kick lists `active_subscribers_count` for a channel but does not explain it, so use the studio's **Test connection** button to confirm the number is your subscriber total.

**Secrets and privacy.** Your client secret is read only from `AYARLAR.local.js`, from the `KICK_CLIENT_SECRET` environment variable, or from the studio's memory. It is never placed in a link, a saved draft, the JSON export or the generated settings file. In the browser, only `subscriber-bar.html` and `combined-bar.html` read it. The overlays contact `kick.com` (channel data), `api.kick.com` and `id.kick.com` (subscriber total, only with your app), `files.kick.com` (chat emotes), and Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`) for the one typeface you pick. Live chat and relay answers come from `127.0.0.1`. The relay talks only to Kick, and checks every webhook signature before it accepts an event. [SECURITY.md](SECURITY.md) describes the full model.

### Contributing

- Unit tests: `node tests/run.js`. Relay tests: `node tests/relay-test.js`. Both need Node.js 20 or newer and no packages, and `npm test` runs them together.
- `npm ci` installs the development tools only: ESLint, TypeScript (type-checks the JavaScript through JSDoc), esbuild and postject (relay executable). The overlays and the relay still need no packages. `npm run check` runs lint, the type check, the version check and both test suites.
- `npm run build:relay` builds the relay executable for your platform into `dist/`, and `npm run test:relay-binary` starts it from an empty folder and checks it.
- GitHub Actions runs both suites on Node.js 20, 22 and 24 on Ubuntu and Windows, plus lint, the type check, the Chrome tests with the relay, the visual contrast gate, the relay executable on both systems and CodeQL, for every push to `main` and every pull request. Pushing a `vX.Y.Z` tag publishes the release with the zip, the executables and their checksums.
- Browser tests: `node tests/e2e-chrome.js`. They need Chrome or Edge. Add `--live --channel <name>` for real Kick data, `--token` for the local mock, `--preview` for sample mode, `--perf` for a 30-second heap and DOM check, and `--relay` for live chat through the relay with signed test events.
- Overlay and dock texts live in `shared/lang/<code>.js`, one file per language with the same keys as `en.js`; the tests check that every file has every key. To add a language, copy `en.js`, translate the values and add the code to `dil` in `shared/kick-core.js`.
- The studio keeps all its texts in one Turkish and English table. A new setting needs an entry in both languages.
- Pages must stay classic scripts so they work from `file://`. Use the shared `.ko-*` components and tokens in `shared/themes.css`, and prefer `transform` and `opacity` for new animations.
- `node tools/record-previews.js` re-creates the images in `screenshots/` (needs Node.js 22 or newer, Chrome or Edge, and `ffmpeg`).
- `node tools/visual-qa.js --out <dir>` and `node tools/motion-qa.js --out <dir>` check every theme for readability and every animation for smoothness before a change ships (Node.js 22 or newer, Chrome). Add `--only main --gate` to fail on any text below its contrast target, as CI does.
- More in [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and the [changelog](CHANGELOG.md).

### License

[MIT](LICENSE). Free for everyone, including commercial streaming; keep the copyright notice when you share the code. "Kick" and the role icons in `badges/` belong to their owners and are not covered by the license. This project is not affiliated with Kick.

© 2026 𝓐.𝓒.𝓑 · [kick.com/iacbi](https://kick.com/iacbi)

[⬆ Back to top](#top)

---

<a id="turkce"></a>
## Türkçe

### Genel Bakış

![On üç temanın hepsi sırayla, birleşik hedef çubuklarında](screenshots/themes.gif)

<sub>13 temanın her biri sırayla, örnek sayılarla. Çubuklar dolar ve dolgunun üzerinden bir ışık geçer.</sub>

`studio.html` dosyasını aç, kanal adını yaz, bir görünüm seç ve her overlay'in bağlantısını OBS'te bir Tarayıcı kaynağına yapıştır. Overlay'ler Kick'in herkese açık kanal verisini doğrudan okur. İsteğe bağlı relay çalışıyorsa önce ondan ister. Relay yanıtları birkaç saniye saklar; böylece birden çok overlay Kick'e tek bir istek paylaşır.

<p align="center"><img src="screenshots/studio-tr.png" alt="Stüdyo: solda kanal, görünüm ve tema seçimi, sağda overlay sekmeli canlı önizleme" width="860"></p>

| Özellik | Durum (2026-11-03 kontrolü) |
|---|---|
| Takipçi hedefi | Çalışıyor. Ekrandaki sayı kick.com/iacbi için Kick'in herkese açık sayısıyla eşleşiyor. |
| İzleyici ve yayın süresi | Kick'in herkese açık verisinden çalışıyor. Canlı yayında henüz kontrol edilmedi. |
| Abone toplamı | Ücretsiz bir Kick geliştirici uygulaması gerektirir (bkz. [Yapılandırma](#yapilandirma-tr)). 2026-11-03'te gerçek bir uygulamayla kontrol edildi: token alma ve kanal sorgusu çalışıyor, sayı (0) kanalla uyuşuyor. Abonesi olan bir kanalda henüz kontrol edilmedi. Uygulaman yoksa sayıyı elle gir. |
| Canlı sohbet | Opsiyonel relay ile çalışıyor (bkz. [Canlı sohbet](#canli-sohbet-tr)). Bir Kick uygulaması ve herkese açık bir tünel gerektirir. 2026-11-03'te kick.com/iacbi chat'ine yazılan gerçek bir mesajla kontrol edildi: mesaj Kick'ten Cloudflare tüneli ve relay'in imza kontrolü üzerinden overlay'e ulaştı. Relay yoksa `chat.html` sahte mesaj yerine boş kalır. |
| Bildirimler | Canlı sohbetle aynı relay ve kurulum. Kick'in dokümantasyonundaki örnek verilerden üretilen imzalı test olaylarıyla gerçek bir tarayıcıda test edildi; gerçek Kick teslimatıyla henüz değil. |

### Özellikler

- 13 tema: `glass`, `vivid`, `soft`, `cinema`, `neon`, `minimal`, `pastel`, `terminal`, `aurora`, `holo`, `ember`, `paper`, `retro`
- Köşe şekilleri (`pill`, `rounded`, `square`), dört yazı tipi (yalnızca seçtiğin yüklenir), Türkçe, İngilizce, İspanyolca, Brezilya Portekizcesi, Almanca ya da Arapça (sağdan sola) veya Türkçe ve İngilizce birlikte etiketler, üç hareket seviyesi ve isteğe bağlı yüzde gösterimi. Hareket azaltma ayarları her yerde geçerlidir
- Abone sayısının yanında "bu yayında +3" gibi yayın içi artış. OBS'te kaynağı yenilesen de 12 saat boyunca korunur
- Hedef çubukları yüzde 25, 50 ve 75'te nabız atar, yüzde 100'de "hedefe ulaşıldı" durumuna geçer (`hedefKutlama`). `hedefArtis` ile ulaşılan hedef belirlenen adım kadar yükselir
- Dakika cinsinden ya da saat olarak (`geriSayimSaat`) geri sayım ve satırlarını döndüren duyuru çubuğu. İkisi de Kick verisi olmadan çalışır
- Sohbet filtreleri: `!` ile başlayan komutları ve bot gibi adı verilen kullanıcıları gizle, mesajları belli bir süre sonra soluklaştır. Yalnızca emote'tan oluşan mesajda emote'lar büyük görünür; `sohbetYatay` sohbeti ekran kenarındaki bir şerit için tek satıra dizer
- Tüm overlay'ler için özel CSS (`ozelCss`): yalnızca görünümü değiştirebilir, dışarıdan hiçbir şey yükleyemez
- İzleyici, yayın süresi, en yüksek izleyici sayısı ve istersen yayın başlığını (`bilgiBaslik`) gösteren bir yayın paneli. Relay açıksa yayın başlar başlamaz ya da biter bitmez değişir
- Yeni takipçi, yeni ve yenilenen abonelik, hediye abonelik, Kicks ve kanal puanı ödülleri için bildirim overlay'i. Kartlar tek tek gelir; raid sırasında sırada en çok 25 bildirim tutulur ve önce en eski takip bildirimleri atılır. Her bildirim türü ayrı ayrı kapatılabilir. Her tür kendi kısa sesini çalar; yerine kendi sesini ve görselini ya da videonu koyabilirsin
- O yayın için Kicks hedef çubuğu ve abone treni (art arda gelen abonelikler ve treni sürdürmek için kalan süre)
- O yayının son olayları ve liderlik tablosu (en çok hediye eden ya da Kicks gönderenler). Sayılar yayın başlayınca sıfırlanır, relay yeniden başlasa da korunur ve panelden elle sıfırlanabilir. Relay bunları OBS Metin kaynakları için düz metin dosyalarına da yazar
- Önizleme modu (`?onizleme=1`): ağ çağrısı yapmadan örnek sayılar gösterir. `?debug=1` ile küçük bir durum kutusu açılır
- Türkçe ve İngilizce stüdyo: her overlay için sekmeli canlı önizleme, hazır görünümler, her overlay için ya da hepsi için bağlantı kopyalama, görünümü JSON olarak dışa ve içe aktarma (kimlik bilgileri hiçbir zaman dahil edilmez), alternatif olarak `AYARLAR.js` dosyası, adım adım relay denetimi ve Kick uygulaman için bağlantı testi
- Her ayarın İngilizce bir adı da var (`channel`, `theme`, `followerGoal` …); `AYARLAR.js` dosyasında da bağlantılarda da çalışır
- Stüdyo yeni bir sürüm çıktığında haber verir (GitHub'a günde en fazla bir istek)
- OBS için tasarlandı: animasyonlar `transform` ve `opacity` kullanır. Kick yavaşladığında ya da istek sınırı koyduğunda sorgular geri çekilir, sayfa gizliyken durur ve hiçbir zaman üst üste binmez. Sohbet kendiliğinden yeniden bağlanır; Kick verisi hiçbir zaman HTML olarak eklenmez

### Gereksinimler

- Tarayıcı kaynağı destekleyen OBS Studio
- Bir Kick kanal adı
- İsteğe bağlı: abone toplamı için bir Kick geliştirici uygulaması (client ID ve client secret)
- Relay için Node.js 20 veya üstü ya da [sürümler sayfasındaki](https://github.com/IACBI/kick-streamer-overlays/releases) Node.js gerektirmeyen relay programı
- Testler için Node.js 20 veya üstü
- Opsiyonel, canlı sohbet için: `cloudflared` veya `ngrok` gibi bir tünel aracı

### Kurulum

1. [Sürümler sayfasından](https://github.com/IACBI/kick-streamer-overlays/releases) `kick-streamer-overlays-vX.Y.Z.zip` dosyasını indir (ya da depoyu klonla), arşivi aç ve klasörü kalıcı bir yere koy.
2. `studio.html` dosyasını tarayıcıda aç. Kanal adını yaz ve bir görünüm seç.
3. Stüdyonun **OBS'e ekle** adımında istediğin overlay'in **Bağlantıyı kopyala** düğmesine bas. OBS'te **Kaynaklar → + → Tarayıcı** ile bir kaynak ekle, **Yerel dosya** kutusunu kapat, bağlantıyı **URL** kutusuna yapıştır ve genişlik ile yüksekliği kartta yazan boyuta ayarla (aşağıdaki tabloda da var).
4. Stüdyoda bir ayarı değiştirdikten sonra bağlantıyı yeniden kopyalayıp kaynağa yapıştır.

**Tüm overlay'ler tek seferde.** Aynı adımda **OBS sahne koleksiyonunu indir** düğmesine bas. OBS'te **Sahne Koleksiyonu → İçe Aktar**'ı seç, indirdiğin `kick-overlay-obs.json` dosyasını ekle, sonra **Sahne Koleksiyonu** menüsünden **Kick Overlay Pack**'i seç. Her overlay kendi boyutunda bir Tarayıcı kaynağı olarak, 1920 × 1080 tuvale göre yerleştirilmiş tek bir sahnede gelir. Birleşik çubuk ve geri sayım gizli eklenir; bildirim kaynağında **Sesi OBS ile kontrol et** zaten açıktır. Ayarları değiştirirsen dosyayı yeniden indir. Proje klasörünün yerini değiştirme: bağlantılar oradaki dosyaları gösterir.

**Kontrol paneli.** Relay çalışırken `dock.html` bir OBS paneli olarak kullanılabilir: stüdyoda **OBS kontrol paneli linkini kopyala**'ya bas, sonra OBS'te **Paneller → Özel Tarayıcı Panelleri**'ni aç, bir ad yaz ve linki URL olarak yapıştır. Panel relay'in çalışıp çalışmadığını gösterir; bildirimleri duraklatıp devam ettirmeni (duraklatılınca sırada beklerler), ekrandakini geçmeni, sonuncuyu tekrarlamanı ve her türden test bildirimi göndermeni sağlar. Yayın sırasında geri sayımı yeni bir süre ve başlıkla yeniden başlatabilir, duyuru çubuğunun satırlarını değiştirebilirsin (**Ayarlara dön** `duyuruMetinleri` değerine geri döner). Sonradan açılan bir overlay de süren geri sayımı ve güncel satırları alır.

OBS'in **Yerel dosya** seçeneğini mi tercih edersin? Stüdyodaki **Ayar dosyası yöntemi** bölümünden `AYARLAR.js` dosyasını indir, proje klasöründeki dosyanın yerine koy, OBS'te **Yerel dosya** kutusunu işaretle ve overlay dosyasını seç. Değişiklikten sonra kaynağa sağ tıklayıp **Yenile**'yi seç. `AYARLAR.js` dosyasını elle de düzenleyebilirsin.

> **Yerel dosya ve relay.** OBS 33, **Yerel dosya** kaynağını tarayıcısının `127.0.0.1` üzerindeki relay'e erişmesine izin vermediği bir sayfa adresinden yükler. Bu durumda sohbet, bildirimler, canlı yayın durumu ve paneldeki geri sayım ile duyuru değişiklikleri çalışamaz; overlay de stüdyodaki bağlantıyı kullanmanı söyler. Relay gereken her şey için bağlantıyı kullan (Yerel dosya kapalı).

Bağlantı yalnızca herkese açık ayarlarını taşır, Kick uygulaman bilgilerini asla. Abone toplamı bu bilgileri `AYARLAR.local.js` dosyasından (ya da relay üzerinden, bkz. [Relay](#relay-tr)) okur.

### Kullanım

| Dosya | Gösterdiği | OBS boyutu (G × Y) |
|---|---|---|
| `follower-bar.html` | Takipçi hedefi | 520 × 90 |
| `subscriber-bar.html` | Abone hedefi | 520 × 90 |
| `combined-bar.html` | Takipçi ve aboneler tek panelde | 520 × 180 |
| `info-panel.html` | İzleyici ve yayın süresi, yalnızca yayındayken | 300 × 80 |
| `chat.html` | Canlı sohbet (relay gerektirir, bkz. Canlı sohbet) | 460 × 760 |
| `alerts.html` | Takip, abonelik, hediye ve Kicks bildirimleri (relay gerektirir, bkz. Canlı sohbet) | 640 × 200 |
| `countdown.html` | Kaynak yüklenince başlayan "birazdan başlıyoruz" geri sayımı | 520 × 190 |
| `ticker.html` | Satırlarını sırayla gösteren duyuru çubuğu | 760 × 80 |
| `events.html` | Bu yayının son takip, abonelik, hediye ve Kicks olayları (relay gerektirir) | 420 × 400 |
| `leaderboard.html` | Bu yayında en çok hediye eden ya da Kicks gönderenler (relay gerektirir) | 380 × 400 |
| `kicks-bar.html` | Bu yayının Kicks hedefi (relay gerektirir) | 520 × 90 |
| `sub-train.html` | Abone treni: art arda gelen abonelikler ve kalan süre; tren yokken gizlenir (relay gerektirir) | 520 × 90 |
| `studio.html` | Stüdyo: önizleme, ayarlar ve bağlantılar. OBS'de değil, tarayıcıda aç | — |

Buradaki tüm animasyonlar örnek veri kullanır (`?onizleme=1`); yani tasarımı gösterir ve Kick'e istek yapmaz.

<p align="center">
  <img src="screenshots/chat-preview.gif" width="500" alt="Sohbet önizlemesi: örnek mesajlar teker teker gelir, rozet görselleriyle"><br>
  <sub><b>Sohbet önizlemesi.</b> Mesajlar teker teker gelir ve akış sabit sayıda mesaj tutar. Taç, <code>badges/</code> klasöründeki rozet görselidir.</sub>
</p>

<p align="center">
  <img src="screenshots/info-panel.gif" width="360" alt="Yayın paneli: izleyici sayısı artar, süre her saniye ilerler"><br>
  <sub><b>Yayın paneli.</b> İzleyici sayısı yumuşakça artar, kanal yayındayken süre her saniye ilerler. Alttaki başlık etiketi isteğe bağlıdır (<code>bilgiBaslik</code>).</sub>
</p>

<p align="center">
  <img src="screenshots/alerts.gif" width="560" alt="Bildirimler: takip, abonelik, hediye abonelik, Kicks ve yenileme sırayla görünür"><br>
  <sub><b>Bildirimler.</b> Ekranda tek seferde bir kart: takip, yeni ve yenilenen abonelik, hediye abonelik ve Kicks. Her türü ayrı ayrı kapatabilirsin.</sub>
</p>

<p align="center">
  <img src="screenshots/combined.gif" width="560" alt="Birleşik panel: iki hedef çubuğu dolar, abone rozeti +3 gösterir"><br>
  <sub><b>Birleşik panel.</b> İki hedef çubuğu yumuşakça dolar. Rozet, bu yayında kazanılan abone sayısını gösterir.</sub>
</p>

<p align="center">
  <img src="screenshots/countdown.gif" width="460" alt="Geri sayım: saat geriye sayar, çubuk boşalır"><br>
  <sub><b>Geri sayım.</b> "Birazdan başlıyoruz" sahnene koy. Saat kaynak yüklenince başlar; kaynağı yenilersen yeniden başlar. Sıfırda "Başlıyoruz!" yazar.</sub>
</p>

<p align="center">
  <img src="screenshots/ticker.gif" width="640" alt="Duyuru çubuğu: üç satır ilerleme çizgisiyle sırayla döner"><br>
  <sub><b>Duyuru çubuğu.</b> Satırların yumuşak bir geçişle döner. İnce bir çizgi bir sonrakinin ne zaman geleceğini gösterir.</sub>
</p>

Sorun giderme. Mesajlar `dil` ayarındaki dilde görünür.

- **`⚙ AYARLAR.js → kanal`** yazısı görünüyorsa stüdyoda kanal adını yaz ve bağlantıyı yeniden kopyala (ya da `AYARLAR.js` içinde `kanal` alanını doldurup kaynağı yenile).
- **Kick uygulama bilgisi hatalı**: Kick uygulama bilgilerini reddetti. `AYARLAR.local.js` içindeki `kickClientId` ve `kickClientSecret` değerlerini kontrol et. Stüdyonun bağlantı testi aynı hatayı gösterir.
- **Kick'e ulaşılamıyor** ya da **Kick yanıt vermedi, son değer**: Ekranda son değer kalır, overlay yeniden dener ve her hatadan sonra biraz daha uzun bekler.
- **Kick istek sınırı, son değer**: Kick overlay'den yavaşlamasını istedi. Kick'in verdiği süre kadar bekler, sonra devam eder.
- **Sohbet köprüsü çalışmıyor** (`chat.html`) ya da **Bildirim köprüsü çalışmıyor** (`alerts.html`): relay'i başlat (`node relay/server.js` ya da relay programı). Başlatana kadar sohbet boş kalır, bildirim gelmez. Stüdyodaki **Relay'i kontrol et** düğmesi hangi adımın takıldığını gösterir.
- **Abone verisi yok**: Kick uygulaması yanıt verdi ama bu kanal için bir abone sayısı döndürmedi.
- **Abone sayısı 0**: Kick uygulaması kurulu değil, değer `aboneSayisi` alanından gelir.
- **Geri sayım yeniden başladı**: sayım kaynağın yüklendiği andan başlar. Kaynağı yenilemek ya da OBS'de *Shutdown source when not visible* seçeneği açıkken sahne değiştirmek onu baştan başlatır.
- Duyuru çubuğunda **`⚙ AYARLAR.js → duyuruMetinleri`** yazıyorsa `duyuruMetinleri` alanını doldur, sonra kaynağı yenile.
- **Başka bir sorun**: bağlantıya `?debug=1` ekle. Sol altta çıkan kutu veri kaynağını, durumu, son sorguyu ve bir sonrakini gösterir. İş bitince parametreyi kaldır.

<a id="canli-sohbet-tr"></a>
#### Canlı sohbet ve bildirimler (opsiyonel)

Kick; sohbet mesajlarını, yasakları, takipleri, abonelikleri, hediye abonelikleri, Kicks'i, kanal puanı ödüllerini ve yayının başlama, bitme ve başlık değişikliklerini Kick uygulamanda kayıtlı bir web adresine gönderir. `relay/` klasöründeki relay bunları alır, Kick'in imzasını doğrular ve `chat.html`, `alerts.html` ile `info-panel.html`'e iletir.

1. Bir Kick geliştirici uygulaması oluştur. Client ID ile secret değerlerini `AYARLAR.local.js` dosyasına ekle (bkz. [Yapılandırma](#yapilandirma-tr)) ya da ortam değişkeni olarak `KICK_CLIENT_ID` ve `KICK_CLIENT_SECRET` ayarla.

   **Adım adım kurulum:** `node relay/setup.js` (ya da `kick-relay-win-x64.exe setup`) çalıştır. Kanalını, Client ID'yi ve Client Secret'ı sorar (secret yazarken ekranda görünmez), Kick'e karşı dener ve kaydeder: uygulama bilgilerini `AYARLAR.local.js` dosyasına, kanalı `AYARLAR.js` içindeki `kanal` değerine. `AYARLAR.local.js` içindeki diğer ayarlar korunur, ama o dosyadaki yorumlar korunmaz. 1. ve 2. adımı birlikte halleder.
2. Relay'in kanalını tanıması gerekir. Başlarken `AYARLAR.js` içindeki `kanal` değerinden (ya da `KICK_CHANNEL`'dan) yayıncı kimliğini bulur. Kimliğini zaten biliyorsan `RELAY_BROADCASTER_ID` değerine yaz; bu durumda arama yapılmaz.
3. Relay'i başlat ve yayın sırasında açık bırak:

   ```bash
   node relay/server.js
   ```

   Node.js yoksa yerine relay programını kullan (bkz. [Relay](#relay-tr)).
4. Relay'in webhook portunu bir tünelle internete aç, örneğin:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8788
   ```

   Tünelin verdiği HTTPS adresinin sonuna `/kick/webhook` ekle.

   **Kısa yol:** [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) kuruluysa relay'i `--tunnel` ile başlat (`node relay/server.js --tunnel` ya da `kick-relay-win-x64.exe --tunnel`). Relay hızlı tüneli kendisi çalıştırır, **Kick uygulaman için Webhook URL**'yi tam haliyle yazar, tünel durursa yeniden başlatır ve relay kapanınca tüneli de kapatır. Hızlı tünel her başladığında yeni bir adres alır; adres değişince yenisini Kick'e yapıştır. Stüdyodaki **Relay'i kontrol et** güncel Webhook URL'yi ve relay'in son uyarılarını gösterir. cloudflared `PATH` üzerinde değilse `RELAY_CLOUDFLARED` değerine tam yolunu yaz.
5. [kick.com/settings/developer](https://kick.com/settings/developer) adresine git, uygulamanın yanındaki **Edit**'e tıkla, **Enable Webhooks** anahtarını aç ve adresi **Webhook URL** kutusuna yapıştır. Kick'in [olay tanıtım sayfası](https://github.com/KickEngineering/KickDevDocs/blob/main/events/introduction.md) bu adımları anlatır.
6. Olaylara abone ol (sohbet, yasak, takip, abonelik, yenileme, hediye abonelik, Kicks, kanal puanı ödülleri, yayın durumu ve başlık). Ödül bildirimleri için Kick uygulamanda **Read Channel points rewards** izni açık olmalı. Daha eski bir sürümle abone olduysan bunu yeniden çalıştır; yalnızca eksik olayları ekler:

   ```bash
   node relay/subscribe.js
   ```

   Relay programını kullanıyorsan bunun yerine `subscribe` ile çalıştır, örneğin `kick-relay-win-x64.exe subscribe`. Var olan abonelikleri görmek için `--list` ekle.
7. `chat.html` ve `alerts.html` dosyalarını OBS'ye her zamanki gibi ekle. Mesajlar ve bildirimler Kick teslim eder etmez görünür. `info-panel.html` izleyici sayısını yine Kick'in herkese açık verisinden okur; relay açıksa yayın başlar ya da biter bitmez görünür veya gizlenir.

Relay yalnızca geçerli Kick imzası taşıyan olayları kabul eder, her olayı bir kez iletir ve olayları yalnızca kendi yayıncı kimliğin için iletir. Kimlik bilinmiyorsa olaylar düşürülür ve relay bunu günlüğüne yazar; aramayı en fazla dakikada bir tekrarlar. Overlay portu yalnızca `127.0.0.1`'de dinler ve yabancı `Host` başlığı taşıyan istekleri reddeder; tünel sadece webhook yolunu dışarı açar. Kick, uygulama başına abonelikleri sınırlar: olay türü başına 10.000, doğrulanmamış uygulamada sohbet mesajları için 1.000.

<a id="relay-tr"></a>
#### Relay: uç noktalar ve abone toplamı (opsiyonel)

Relay, paket gerektirmeyen küçük bir Node.js programıdır. İki dinleyicisi vardır; ikisi de `127.0.0.1`'e bağlanır. Webhook portu (varsayılan 8788) Kick'in olaylarını `POST /kick/webhook` üzerinden alır ve tünel için tek açık yoldur. Overlay portu (varsayılan 8790) overlay'lere hizmet eder:

| Uç nokta | Yanıt |
|---|---|
| `GET /events` | Sunucu gönderimli olaylar (SSE): `chat.html` için `chat` ve `ban`; `alerts.html` için `follow`, `sub`, `gift`, `kicks` ve `reward`; `events.html` ve `leaderboard.html` için `stats`. |
| `GET /health` | Relay sürümü, açık olay bağlantısı sayısı, `lastEventAt` (son imzalı Kick olayının geldiği an ya da `null`) ve neler yapabildiği: `chat`, `alerts`, `channel`, `subscribers`. Stüdyodaki **Relay'i kontrol et** düğmesi bunların her birini ayrı bir satırda gösterir. |
| `POST /test-alert?kind=TÜR` | Açık bildirim sayfalarına sabit bir örnek bildirim (`follow`, `sub`, `gift`, `kicks` ya da `reward`) gönderir; ses ve görsel dahil. Stüdyodaki test düğmeleri bunu kullanır. En fazla 1,5 saniyede bir. |
| `POST /control?action=İŞLEM` | Kontrol panelinin düğmeleri: `pause`, `resume`, `skip` ya da `replay` (son bildirim, yeni bir kimlikle yeniden). Bildirimler duraklatılmışken bağlanan sayfaya bu hemen bildirilir. En fazla 0,3 saniyede bir. |
| `POST /overlay?target=countdown&minutes=N&title=METİN` | Panelin geri sayımı: bağlı her `countdown.html` için 0–720 dakikalık yeni bir geri sayım başlatır. Başlık isteğe bağlıdır (en çok 60 karakter). Geri sayım bitmeden bağlanan sayfa da bunu alır. |
| `POST /overlay?target=ticker&lines=A\|B` | Panelin duyuru satırları, bağlı her `ticker.html` için; `\|` ile ayrılır (en çok 12 satır, toplam 400 karakter). `lines` yerine `reset=1` `duyuruMetinleri` değerine döner. `/control` ile aynı sınır. |
| `GET /stats` | Bu yayının sayıları: toplamlar, son 20 olay, en çok hediye eden ve Kicks gönderen ilk 10 kişi. Test bildirimleri ve tekrarlar sayılmaz. |
| `POST /stats/reset` | Sayıları sıfırlar (paneldeki **İstatistikleri sıfırla**). Kick yayının başladığını bildirdiğinde de sıfırlanırlar. `/control` ile aynı sınır. |
| `GET /channel?slug=AD` | Kick'in herkese açık kanal verisi, 20 saniye önbellekte tutulur. `X-Kick-Source` başlığı verinin Kick'in v2 mi v1 mi API'sinden geldiğini söyler. |
| `GET /subscribers?slug=AD` | Relay'in tuttuğu uygulama bilgileriyle Kick'in resmi API'sinden abone toplamın. 15 saniye önbellekte tutulur. `subs`, `gifted`, `canceled`, `live`, `viewers`, `startMs` ve `title` döndürür. |

Her istek erişim anahtarını `key` sorgu parametresiyle taşımalıdır, örneğin `/health?key=…`. Relay ilk başlatıldığında bu anahtarı içeren `AYARLAR.relay.js` dosyasını overlay'lerin yanına yazar; overlay'ler anahtarı oradan okur. Geçerli anahtar yoksa relay `401` döndürür. Dosya git'e eklenmez, kimseyle paylaşma.

Kick sınır koyarsa relay `429` ve `Retry-After` ile yanıt verir. Uygulama bilgisi yoksa `/subscribers` `503`, reddedilen giriş `401` döndürür.

**Node.js olmadan relay.** Her sürümde bir relay programı var: Windows için `kick-relay-win-x64.exe`, Linux için `kick-relay-linux-x64`, Apple işlemcili macOS için `kick-relay-macos-arm64`. Programı overlay klasörüne, `AYARLAR.js` dosyasının yanına koy ve `node relay/server.js` yerine onu çalıştır; aynı dosyaları orada okur ve yazar. Sağlama toplamını aynı sürümdeki `SHA256SUMS.txt` ile karşılaştır. Programlar kod imzalı değil. Windows'ta SmartScreen ilk açılışta "Windows bilgisayarınızı korudu" diyebilir: önce sağlama toplamını kontrol et, sonra **Ek bilgi → Yine de çalıştır**'ı seç. macOS'ta dosyayı bir kez çalıştırılabilir yap ve indirme karantinasını kaldır (`chmod +x kick-relay-macos-arm64 && xattr -d com.apple.quarantine kick-relay-macos-arm64`), sonra Terminal'den başlat; Intel Mac'te Node.js kullan.

**Yayın istatistikleri ve metin dosyaları.** Relay bu yayının sayılarını `AYARLAR.js` dosyasının yanındaki `kick-relay-stats.json` dosyasında tutar; yayın ortasında yeniden başlasa da bir şey kaybolmaz. İlk olaydan sonra OBS Metin kaynakları (**Dosyadan oku**) için `labels/` klasörüne düz metin dosyaları da yazar: `latest-follower.txt`, `latest-subscriber.txt`, `latest-gifter.txt`, `latest-kicks.txt`, `top-gifter.txt`, `top-kicks.txt`, `follows-total.txt`, `subs-total.txt` (abonelikler ve hediye edilenler) ve `kicks-total.txt`. Metin dosyalarını kapatmak için `RELAY_LABELS=0` yap. İkisi de git'e eklenmez.

Relay çalışırken abone çubuklarının tarayıcıda istemci sırrına ihtiyacı yoktur. Uygulama bilgilerini `AYARLAR.local.js` dosyasına ya da ortama koy ve relay'i başlat. Çubuklar toplamı `/subscribers` üzerinden alır, sayfa Kick'e kendisi istek göndermez. Relay çalışmıyorsa çubuklar `AYARLAR.local.js` dosyasını doğrudan kullanır. O da yoksa `aboneSayisi` gösterilir.

Relay şu ortam değişkenlerini okur. Her birinin bir varsayılanı vardır; değişken tanımlı değilse ayar dosyalarındaki değer kullanılır:

| Değişken | Varsayılan | Amaç |
|---|---|---|
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | `AYARLAR.local.js` içinden | Kick uygulama bilgileri. Ortam değişkeni önceliklidir. |
| `KICK_CHANNEL` | `AYARLAR.js` içindeki `kanal` | Yayıncı kimliğini aramak için kullanılan kanal. |
| `RELAY_BROADCASTER_ID` | aranır | Yayıncının kullanıcı kimliği. Aramayı atlar. |
| `RELAY_ALLOW_ANY_BROADCASTER` | kapalı | `1` yapılırsa her kanaldan olaylar kabul edilir. Yalnızca test için. |
| `RELAY_WEBHOOK_PORT` | `8788` | Webhook portu. |
| `RELAY_EVENTS_PORT` | `8790` | Overlay portu. Değiştirirsen `relayAdresi` değerini de aynı yap. |
| `RELAY_KEY` | `AYARLAR.relay.js` içine üretilir | Overlay erişim anahtarı. `A-Z a-z 0-9 _ -` karakterlerinden 32–128 uzunlukta olmalı; değilse relay başlamaz. |
| `RELAY_LOG_FORMAT` | `text` | `json` yapılırsa her günlük satırı tek bir `{"time", "level", "msg"}` nesnesi olarak yazılır; günlük toplayıcılar ve servis yöneticileri için. |
| `RELAY_LABELS` | açık | `0` yapılırsa `labels/` içindeki metin dosyaları yazılmaz. |

<a id="yapilandirma-tr"></a>
### Yapılandırma

Tüm ayarlar `AYARLAR.js` içindedir; stüdyo aynı ayarları verdiği bağlantılara da yazar. Bağlantı `AYARLAR.js` değerlerinin üzerine yazar. Geçersiz bir değer varsayılanına döner, sayılar kendi aralıklarına sınırlanır. Evet/hayır ayarları `true`/`false`, `yes`/`no`, `on`/`off` ya da `1`/`0` kabul eder. Her ayar Türkçe ya da İngilizce adıyla yazılabilir; ikisi birden verilirse Türkçe ad geçerli olur.

| Ayar | İngilizce adı | Değerler | Varsayılan |
|---|---|---|---|
| `kanal` | `channel` | Kick kanal adın, `kick.com/ADIN` içindeki gibi. Tam kick.com bağlantısı ya da `@ADIN` da olur | *(boş)* |
| `stil` | `theme` | `glass` · `vivid` · `soft` · `cinema` · `neon` · `minimal` · `pastel` · `terminal` · `aurora` · `holo` · `ember` · `paper` · `retro` | `glass` |
| `sekil` | `shape` | `pill` · `rounded` · `square` | `pill` |
| `yaziTipi` | `font` | `inter` · `poppins` · `nunito` · `mono` | `inter` |
| `dil` | `language` | `tr` · `en` · `both` · `es` · `pt` · `de` · `ar` | `both` |
| `animasyon` | `motion` | `normal` · `low` · `off` | `normal` |
| `renk` | `accent` | Vurgu rengi, hex (ör. `#53fc18`) | `#53fc18` |
| `ozelCss` | `customCss` | Her overlay'de temanın üzerine uygulanan özel CSS, en çok 2000 karakter. `url(`, `@import`, `@font-face`, `image-set` ya da ters eğik çizgi içeren değer tümüyle yok sayılır | *(boş)* |
| `yayinciYazisi` | `streamerLabel` | Sohbette senin adının yanındaki etiket (yalnızca sohbet) | `Streamer` |
| `takipciHedefi` | `followerGoal` | Takipçi hedefi | `1000` |
| `takipciYedek` | `followerFallback` | Kick'e ulaşılamadığında gösterilecek takipçi sayısı | `0` |
| `aboneHedefi` | `subscriberGoal` | Abone hedefi | `100` |
| `aboneSayisi` | `subscriberCount` | Kick uygulaması kurulu değilken gösterilecek abone sayısı | `0` |
| `oturumFarkiGoster` | `showSessionGain` | Bu yayındaki artışı göster, ör. "+3" | `true` |
| `yuzdeGoster` | `showPercent` | Hedefin yüzdesini göster | `false` |
| `hedefKutlama` | `goalCelebration` | Yüzde 25, 50 ve 75'te nabız, yüzde 100'de "hedefe ulaşıldı" durumu | `true` |
| `hataNotu` | `statusNote` | "Kick'e ulaşılamıyor" gibi küçük durum notunu ekranda göster | `true` |
| `bilgiBaslik` | `infoShowTitle` | Yayın başlığını bilgi panelinin alt kenarında göster | `false` |
| `yenilemeSn` | `refreshSeconds` | Yenileme aralığı, saniye (10–600) | `30` |
| `sohbetMaksMesaj` | `chatMaxMessages` | Ekranda aynı anda en fazla sohbet mesajı (3–20) | `8` |
| `sohbetKomutGizle` | `chatHideCommands` | `!` ile başlayan sohbet mesajlarını gizle | `false` |
| `sohbetGizliKullanicilar` | `chatHiddenUsers` | Sohbetten gizlenecek kullanıcı adları, virgülle ayrılmış, büyük/küçük harf duyarsız (en çok 300 karakter) | *(boş)* |
| `sohbetSilinmeSn` | `chatFadeSeconds` | Bir sohbet mesajının soluklaşmadan önceki süresi, saniye (0–600). `0` yeni mesajlar itene kadar bırakır | `0` |
| `sohbetYatay` | `chatHorizontal` | Sohbeti tek yatay satıra dizer, en yenisi sağda; örneğin 1280 × 80 boyutunda bir şerit için | `false` |
| `geriSayimDk` | `countdownMinutes` | Geri sayım süresi, dakika (1–720) | `5` |
| `geriSayimSaat` | `countdownTime` | Geri sayımın hedef saati, 24 saatlik `SS:DD` (ör. `20:30`). `geriSayimDk`'nın yerine geçer; saat bugün geçtiyse yarına sayar | *(boş)* |
| `geriSayimBaslik` | `countdownTitle` | Geri sayım başlığı. Boşsa etiket dilinde "Birazdan başlıyoruz" yazar | *(boş)* |
| `duyuruMetinleri` | `announcements` | `\|` ile ayrılmış duyuru satırları, en çok 12, ör. `Takip et \| !discord \| Her cuma yeni video` | *(boş)* |
| `duyuruSn` | `announcementSeconds` | Her duyurunun ekranda kalma süresi, saniye (3–60) | `6` |
| `uyariSn` | `alertSeconds` | Her bildirimin ekranda kalma süresi, saniye (3–30). Sırada 5 veya daha fazla bildirim varsa her biri yarı süre, en az 3 saniye kalır | `6` |
| `uyariTakip` | `alertFollows` | Takip bildirimlerini göster | `true` |
| `uyariAbone` | `alertSubs` | Yeni ve yenilenen abonelik bildirimlerini göster | `true` |
| `uyariHediye` | `alertGifts` | Hediye abonelik bildirimlerini göster | `true` |
| `uyariKicks` | `alertKicks` | Kicks bildirimlerini göster | `true` |
| `uyariOdul` | `alertRewards` | Kanal puanı ödül kullanımlarını göster (bekleyen ya da onaylanan; reddedilenler gösterilmez) | `true` |
| `uyariSes` | `alertSound` | Her canlı bildirimde ses çal. Önizlemeler sessizdir | `true` |
| `uyariSesSeviye` | `alertVolume` | Bildirim ses seviyesi (0–100) | `60` |
| `uyariOdulGizle` | `alertRewardsHidden` | Hiç bildirim göstermeyecek ödül adları, `\|` ile ayrılır (büyük-küçük harf fark etmez) | *(boş)* |
| `uyariTts` | `alertTts` | Kicks ve ödül mesajlarını bilgisayarın sesiyle oku. Ses OBS kaynağından değil, bilgisayarın varsayılan çıkışından gelir; yayına ancak OBS masaüstü sesini alıyorsa gider. Önizlemeler sessizdir | `false` |
| `uyariTtsUzunluk` | `alertTtsMaxLength` | Sesli okunacak en uzun mesaj, karakter olarak (20–200); daha uzunu kelime sınırında kesilir | `120` |
| `uyariTtsYasak` | `alertTtsBlockedWords` | Virgülle ayrılmış kelimeler. İsminde ya da metninde bunlardan biri geçen mesaj hiç okunmaz. Bağlantılar hiçbir zaman okunmaz | *(boş)* |
| `olaySayisi` | `eventsCount` | Son olaylar (`events.html`): gösterilecek olay sayısı (3–10) | `5` |
| `liderTur` | `leaderboardType` | Liderlik tablosu (`leaderboard.html`): `gift` hediye aboneliklere, `kicks` Kicks'e göre sıralar | `gift` |
| `liderSayisi` | `leaderboardCount` | Tablodaki kişi sayısı (3–10) | `5` |
| `kicksHedefi` | `kicksGoal` | Kicks hedef çubuğu (`kicks-bar.html`): bu yayında ulaşılacak Kicks | `1000` |
| `trenSn` | `subTrainSeconds` | Abone treni (`sub-train.html`): treni sürdürmek için yeni aboneliğin gelmesi gereken süre, saniye (30–600) | `120` |
| `hedefArtis` | `goalStep` | Takipçi, abone ve Kicks çubukları için hedef otomatik artışı: ulaşılan hedef bu kadar yükselir. `0` = kapalı | `0` |

Yalnızca yerel makinede geçerli olan anahtarlar. Bağlantıdan asla okunmazlar:

| Anahtar | Nerede | Varsayılan | Amaç |
|---|---|---|---|
| `kickClientId`, `kickClientSecret` | `AYARLAR.local.js` | *(boş)* | Abone çubukları için Kick uygulama bilgileri. Relay de bunları okur. |
| `relayAdresi` (`relayAddress`) | `AYARLAR.js` | `http://127.0.0.1:8790` | Relay'in overlay portunun adresi. Yalnızca `https`, ya da `127.0.0.1` veya `localhost` üzerinde `http` kabul edilir. |
| `apiBase`, `tokenBase` | `AYARLAR.js` | `https://api.kick.com`, `https://id.kick.com` | Abone çubuklarının kullandığı Kick API adresleri. Bir yansı ile test etmiyorsan dokunma. |

**2.2.x sürümünden yükseltiyorsan.** `AYARLAR.local.js` artık yalnızca `subscriber-bar.html` ve `combined-bar.html` tarafından yüklenir. `relayAdresi` değerini bu dosyaya yazdıysan `AYARLAR.js` dosyasına taşı. Relay uygulama bilgilerini yine `AYARLAR.local.js` dosyasından okur.

**Bildirim sesleri ve görselleri (isteğe bağlı).** Her bildirim türü kısa bir yerleşik ses çalar. Kendi sesini kullanmak için `alerts/` klasörüne `follow`, `sub`, `gift`, `kicks` ya da `reward` adıyla `.mp3`, `.ogg` veya `.wav` bir dosya koy; aynı adla bir görsel ya da video (`.webm`, `.png`, `.gif`, `.webp`) karttaki simgenin yerine geçer. Yalnızca o klasördeki bu adlar açılır, hiçbir web adresi açılmaz. Sesin yayına gitmesi için OBS'te bildirim kaynağının **Sesi OBS ile kontrol et** seçeneğini aç. Stüdyodaki **Dene** satırı sesi sayfada çalar ve relay üzerinden test bildirimi gönderir (bkz. `alerts/OKU-README.txt`).

**Rozet görselleri (isteğe bağlı).** `badges/` klasörüne `moderator`, `vip`, `og`, `founder`, `verified`, `gifter` veya `staff` adıyla bir görsel (`.svg`, `.png`, `.webp`, `.gif`, `.jpg`, `.jpeg`) koyarsan çizili sohbet rozetinin yerine geçer. Dosya yoksa çizili simge gösterilir. Pakete eklenen beş ikon Kick'in rol görselleridir, kolaylık için eklenmiştir; istediğin gibi değiştirebilir veya kaldırabilirsin (bkz. `badges/OKU-README.txt`).

**Abone toplamı için Kick uygulaması (isteğe bağlı)**

1. Kick'in geliştirici alanında bir uygulama oluştur. Dokümantasyon [docs.kick.com](https://docs.kick.com) adresinde.
2. `AYARLAR.js` ile aynı klasörde `AYARLAR.local.js` dosyası oluştur:

   ```js
   window.KICK_OVERLAY_YEREL = {
     kickClientId: "CLIENT_ID_BURAYA",
     kickClientSecret: "CLIENT_SECRET_BURAYA"
   };
   ```

3. Bu dosyayı gizli tut. `.gitignore` onu zaten listeler, Git takip etmez. Kimseyle paylaşma, commit etme.

Relay yoksa abone çubukları erişim anahtarını `id.kick.com` üzerinden kendileri alır ve yeniler. Relay çalışıyorsa bunun yerine relay'e sorarlar (bkz. [Relay](#relay-tr)). Kick, kanal için `active_subscribers_count` alanını belgeler ama açıklamaz. Sayının gerçekten abone toplamın olduğunu stüdyodaki **Bağlantıyı test et** düğmesiyle doğrula.

**Gizli bilgiler ve gizlilik.** Client secret yalnızca `AYARLAR.local.js` dosyasından, `KICK_CLIENT_SECRET` ortam değişkeninden ya da stüdyonun belleğinden okunur. Hiçbir zaman bir bağlantıya, kaydedilmiş taslağa, JSON dışa aktarımına ya da üretilen ayar dosyasına konmaz. Tarayıcıda bunu yalnızca `subscriber-bar.html` ve `combined-bar.html` okur. Overlay'ler `kick.com` (kanal verisi), `api.kick.com` ve `id.kick.com` (abone toplamı, yalnızca kendi uygulamanla), `files.kick.com` (sohbet emote'ları) ve seçtiğin tek yazı tipi için Google Fonts'a (`fonts.googleapis.com`, `fonts.gstatic.com`) bağlanır. Canlı sohbet ve relay yanıtları `127.0.0.1`'den gelir. Relay yalnızca Kick ile konuşur ve her webhook imzasını kabul etmeden önce doğrular. Tam model için [SECURITY.md](SECURITY.md) dosyasına bak.

### Katkı

- Birim testleri: `node tests/run.js`. Relay testleri: `node tests/relay-test.js`. İkisi de Node.js 20 veya üstünü ister, paket gerektirmez; `npm test` ikisini birlikte çalıştırır.
- `npm ci` yalnızca geliştirme araçlarını kurar: ESLint, TypeScript (JavaScript'i JSDoc üzerinden tip denetiminden geçirir), esbuild ve postject (relay programı). Overlay'ler ve relay hâlâ paket gerektirmez. `npm run check`; lint, tip denetimi, sürüm denetimi ve iki test takımını çalıştırır.
- `npm run build:relay` kendi platformun için relay programını `dist/` klasörüne derler; `npm run test:relay-binary` onu boş bir klasörden başlatıp denetler.
- GitHub Actions, `main` dalına her push'ta ve her pull request'te iki test takımını Node.js 20, 22 ve 24 ile Ubuntu ve Windows'ta çalıştırır; ayrıca lint, tip denetimi, relay'li Chrome testleri, görsel kontrast kapısı, iki sistemde relay programı ve CodeQL çalışır. `vX.Y.Z` etiketi push edilince sürüm; zip, programlar ve sağlama toplamlarıyla yayınlanır.
- Tarayıcı testleri: `node tests/e2e-chrome.js`. Chrome veya Edge gerekir. Gerçek Kick verisi için `--live --channel <ad>`, yerel sahte sunucu için `--token`, önizleme modu için `--preview`, 30 saniyelik bellek ve DOM kontrolü için `--perf`, imzalı test olaylarıyla relay üzerinden canlı sohbet için `--relay` ekle.
- Overlay ve panel metinleri `shared/lang/<kod>.js` içindedir: her dil için bir dosya, anahtarları `en.js` ile aynı. Testler her dosyada her anahtarın olduğunu denetler. Yeni bir dil için `en.js` dosyasını kopyala, değerleri çevir ve kodu `shared/kick-core.js` içindeki `dil` listesine ekle.
- Stüdyo tüm metinlerini tek bir Türkçe ve İngilizce tabloda tutar. Yeni bir ayar için iki dilde de giriş gerekir.
- Sayfalar `file://` üzerinden çalışabilmek için klasik script olarak kalmalı. Ortak `.ko-*` bileşenlerini ve `shared/themes.css` içindeki değişkenleri kullan, yeni animasyonlar için `transform` ve `opacity` tercih et.
- `node tools/record-previews.js`, `screenshots/` içindeki görselleri yeniden üretir (Node.js 22 veya üstü, Chrome veya Edge ve `ffmpeg` gerekir).
- `node tools/visual-qa.js --out <dir>` ve `node tools/motion-qa.js --out <dir>`, bir değişiklik yayınlanmadan önce her temanın okunabilirliğini ve her animasyonun akıcılığını ölçer (Node.js 22 veya üstü, Chrome). CI'daki gibi kontrast hedefinin altındaki her metinde hata vermesi için `--only main --gate` ekle.
- Ayrıntılar: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) ve [değişiklik günlüğü](CHANGELOG.md).

### Lisans

[MIT](LICENSE). Ticari yayın dahil herkes için ücretsiz; kodu paylaşırken telif notunu koru. "Kick" adı ve `badges/` klasöründeki rol ikonları sahiplerine aittir, lisansa dahil değildir. Bu proje Kick ile bağlantılı değildir.

© 2026 𝓐.𝓒.𝓑 · [kick.com/iacbi](https://kick.com/iacbi)

[⬆ Başa Dön](#top)
