# Setup

Everything beyond the four steps in the README: adding all overlays at once, the control dock, the Local file method, your own sounds and art, and the Kick app for the subscriber total.

## Try it online

The studio and every overlay are published at **https://iacbi.github.io/kick-streamer-overlays/**. Copy a link from there into an OBS Browser source and it works without downloading anything: follower goal, viewers and uptime, the countdown and the announcement bar read only public data. Your settings travel in the link.

Download the release instead when you want live chat, alerts, stream stats, the dock or the subscriber total: those need the relay on your computer, and the relay answers only pages opened from that computer (`file://` or `127.0.0.1`). The online overlays skip the relay and say so ("Live features need the downloaded pack"); the online studio says the same when you check the relay.

## OBS

**All overlays at once.** In the studio's **Add to OBS** step, press **Download OBS scene collection**. In OBS choose **Scene Collection → Import**, add the downloaded `kick-overlay-obs.json`, then pick **Kick Overlay Pack** from the **Scene Collection** menu. You get one scene with every overlay as a Browser source at its size, laid out for a 1920 × 1080 canvas; the combined bar and the countdown come in hidden, and the alerts source already has **Control audio via OBS** on. Download it again after you change settings. Keep the project folder where it is: the links point at its files.

**Control dock.** With the relay running, `dock.html` works as an OBS dock: press **Copy the OBS control dock link** in the studio, then in OBS open **Docks → Custom Browser Docks**, type a name and paste the link as the URL. It shows whether the relay is running and lets you pause and resume alerts (they keep queueing while paused), skip the one on screen, replay the last one, and send a test alert of each kind. It can also restart the countdown with new minutes and a title, and replace the announcement bar's lines during the stream (**Back to settings** returns to `duyuruMetinleri`). An overlay that opens later picks up the running countdown and the current lines.

Prefer OBS's **Local file** option? Open the studio's **Settings file method**, download `AYARLAR.js`, put it in the project folder in place of the existing file, tick **Local file** in OBS, and choose the overlay file. After a change, right-click the source and choose **Refresh**. You can also edit `AYARLAR.js` by hand.

> **Local file and the relay.** OBS 33 loads a **Local file** source from a page address that its browser does not let reach the relay on `127.0.0.1`. Chat, alerts, live stream status and the dock's countdown and announcement changes then cannot work, and the overlay says to use the studio link instead. For anything that needs the relay, use the link (Local file off).

A link holds only your public settings, never your Kick app credentials. The subscriber total reads them from `AYARLAR.local.js` (or from the relay, see [Relay](relay.md#relay-endpoints-and-subscriber-total)).

## Alert sounds, alert art and badge art

**Alert sounds and art (optional).** Each alert kind plays a short built-in sound. To use your own, put `follow`, `sub`, `gift`, `kicks` or `reward` with `.mp3`, `.ogg` or `.wav` in `alerts/`; an image or video with the same name (`.webm`, `.png`, `.gif`, `.webp`) replaces the icon on the card. Only these names in that folder are opened, never a web address. In OBS, turn on **Control audio via OBS** for the alerts source so the sound reaches your stream. The studio's **Try it** row plays the sound on the page and sends test alerts through the relay (see `alerts/OKU-README.txt`).

**Badge art (optional).** Put an image named `moderator`, `vip`, `og`, `founder`, `verified`, `gifter` or `staff` (`.svg`, `.png`, `.webp`, `.gif`, `.jpg`, `.jpeg`) in `badges/` to replace the drawn chat badge. A missing file falls back to the drawn symbol. The five included icons are Kick's role artwork, added for convenience; replace or remove them freely (see `badges/OKU-README.txt`).

## Subscriber total: Kick app

1. Create an app in Kick's developer area. The documentation is at [docs.kick.com](https://docs.kick.com).
2. Next to `AYARLAR.js`, create `AYARLAR.local.js`:

   ```js
   window.KICK_OVERLAY_YEREL = {
     kickClientId: "YOUR_CLIENT_ID",
     kickClientSecret: "YOUR_CLIENT_SECRET"
   };
   ```

3. Keep this file private. `.gitignore` already lists it, so Git will not track it. Do not share it or commit it.

Without the relay, the subscriber bars request and renew their own access token from `id.kick.com`. With the relay running, they ask the relay instead (see [Relay](relay.md#relay-endpoints-and-subscriber-total)). Kick lists `active_subscribers_count` for a channel but does not explain it, so use the studio's **Test connection** button to confirm the number is your subscriber total.

---

[← README](../README.md)
