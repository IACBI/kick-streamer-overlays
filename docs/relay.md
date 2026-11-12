# Relay

The relay is optional. It brings live chat, alerts, live stream status, stream stats, the control dock and the subscriber total without a secret in the browser.

## Studio and overlays from the relay

To run the relay on an always-on server instead of the streaming PC, see [server mode](cloud.md).

The relay also serves the pack itself on its local port. Open `http://127.0.0.1:8790/` (the relay executable opens it for you; with Node.js add `--open`, and set `RELAY_OPEN=0` to turn it off).

- **One link per overlay, for good.** Links such as `http://127.0.0.1:8790/chat.html` carry no settings. The studio's **Save and apply to OBS** writes them to `AYARLAR.js` (the previous file is kept as `AYARLAR.backup.js`), and every overlay served by the relay reloads within a few seconds. A hand edit of `AYARLAR.js` is picked up the same way.
- **Kick app from the browser.** In the studio's Kick app step, **Save in the relay** writes the client ID and secret to `AYARLAR.local.js`. The relay uses them at once; pages never receive them.
- **Kick events from the browser.** **Connect chat and alerts** creates the missing webhook subscriptions, the same as `node relay/subscribe.js` (step 6 below), and tells the relay your broadcaster ID.
- **Live features checklist.** The Kick app step lists what is set up and what is missing (channel, Kick app, tunnel with its Webhook URL and a copy button, channel ID, last event from Kick), and updates every few seconds.
- **Tunnel by itself.** The relay executable starts the Cloudflare quick tunnel on its own once Kick app credentials exist and `cloudflared` is installed (next to the relay, in its install folder, or on `PATH`). `RELAY_TUNNEL=0` turns that off; with Node.js, use `--tunnel` as before.
- **Works in OBS as a plain URL.** OBS's **Local file** sources cannot reach the relay; these links do.
- **What it serves:** the top-level pages and the `shared/`, `alerts/`, `badges/` and `branding/` folders, by file type. Nothing else in the folder can be read through it. The access key goes only to the relay's own pages (the browser's `Sec-Fetch-Site` header decides), and saving needs the key, a JSON body and a local `Origin`.

## Chat without a Kick app

Save your channel in the studio and start the relay: that is all live chat needs. The relay opens Kick's own realtime feed, the one kick.com's chat uses, and passes chat messages, deleted messages, bans, subscriptions, gifted subscriptions and Kicks to the overlays. No Kick developer app, no tunnel and no Webhook URL.

- **Why the relay, and not the overlay page.** Kick lets only kick.com pages open that feed from a browser, so a page on GitHub Pages or in OBS cannot. The relay is a program, not a page, so it can.
- **What still needs a Kick app.** Follows, channel point rewards, stream start, end and title, and the live subscriber total come only through the signed webhooks below. With both running, an event that arrives both ways is shown once.
- **Not an official API.** Kick does not document this feed and may change it. If it stops answering, the relay retries by itself (every 2 seconds at first, then up to once a minute), says why in its log and in the studio's **Check relay**, and the webhooks keep working. `RELAY_KICK_LIVE=0` turns the feed off. It needs Node.js 22 or newer; the relay executable and the Docker image have it.
- **What it sends to Kick.** One request to `web.kick.com` for an anonymous connection token, then the socket at `realtime.us-east-1.platform.kick.com`. No name, key or setting of yours is sent; the channel's chat room ID comes from kick.com's public channel data.

## Live chat and alerts

Kick sends chat messages, bans, follows, subscriptions, gifted subscriptions, Kicks, channel point reward redemptions and stream start, end and title changes to a web address you register in your Kick app. The relay in `relay/` receives them, checks Kick's signature, and passes them to `chat.html`, `alerts.html` and `info-panel.html`.

1. Create a Kick developer app. Put its client ID and secret in `AYARLAR.local.js` (see [Subscriber total: Kick app](setup.md#subscriber-total-kick-app)), or in the environment as `KICK_CLIENT_ID` and `KICK_CLIENT_SECRET`.

   **Guided setup:** run `node relay/setup.js` (or `kick-relay-win-x64.exe setup`). It asks for your channel, Client ID and Client Secret (the secret is not shown while you type), checks them with Kick, and saves them: the credentials to `AYARLAR.local.js`, the channel to `kanal` in `AYARLAR.js`. Other keys in `AYARLAR.local.js` are kept, but comments in that file are not. That covers steps 1 and 2.
2. Let the relay know your channel. It looks up your broadcaster ID from `kanal` in `AYARLAR.js` (or from `KICK_CHANNEL`) when it starts. If you already know the ID, set `RELAY_BROADCASTER_ID` instead and the lookup is skipped.
3. Start the relay and leave it running while you stream:

   ```bash
   node relay/server.js
   ```

   Without Node.js, use the relay executable instead (see [Relay](#relay-endpoints-and-subscriber-total)).
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

   In the studio opened from the relay, **Connect chat and alerts** does the same. With the relay executable, run it with `subscribe` instead, for example `kick-relay-win-x64.exe subscribe`. Add `--list` to see the subscriptions that already exist.
7. Add `chat.html` and `alerts.html` in OBS as usual. Messages and alerts appear as soon as Kick delivers them. `info-panel.html` keeps reading viewers from Kick's public data, and with the relay running it also switches on and off as soon as the stream starts or ends.

The relay accepts only events with a valid Kick signature, passes each one on only once, and passes events on only for your broadcaster ID. While that ID is unknown, events are dropped and the relay says so in its log; it retries the lookup at most once a minute. Its overlay port listens on `127.0.0.1` only and refuses requests with a foreign `Host` header, so the tunnel exposes just the webhook path. Kick limits subscriptions per app: 10,000 per event type, and 1,000 for chat messages while the app is unverified.

## Record mode

Start the relay with `--record` (or `RELAY_RECORD=1`) during a stream, and every webhook that passes the signature check is also saved to `recordings/`. Names, user IDs, profile pictures and message text are replaced with placeholders before anything is written; the event structure and numbers stay. At most 500 files are saved per run.

Then check them:

```bash
node tools/check-recordings.js
```

It runs each file through the same mapping the relay uses and prints what the overlays would show. A file marked `dropped` or `empty` means Kick changed that payload; please open an issue and attach the file. Separately, a daily GitHub workflow checks Kick's public channel data and webhook key, and opens an issue labelled `kick-drift` when their shape changes.

## Relay endpoints and subscriber total

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

**Relay without Node.js.** Each release has a relay executable: `kick-relay-win-x64.exe` for Windows, `kick-relay-linux-x64` for Linux and `kick-relay-macos-arm64` for macOS on Apple silicon. The zip named after your system (`kick-streamer-overlays-vX.Y.Z-win-x64.zip` and so on) is the overlay folder with that executable already inside. The executables are also released on their own, for updating a folder you already have: put the file in the overlay folder, next to `AYARLAR.js`. Either way, run it in place of `node relay/server.js`; it reads and writes the same files there. Compare its checksum with `SHA256SUMS.txt` from the same release. The executables are not code-signed. On Windows, SmartScreen may say "Windows protected your PC" on the first start: check the checksum first, then choose **More info → Run anyway**. On macOS, make the file runnable and clear the download quarantine once (`chmod +x kick-relay-macos-arm64 && xattr -d com.apple.quarantine kick-relay-macos-arm64`), then start it from Terminal; on an Intel Mac, use Node.js.

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

---

[← README](../README.md)
