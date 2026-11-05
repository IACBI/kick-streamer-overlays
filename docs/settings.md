# Settings

Every setting lives in `AYARLAR.js`, and the studio writes the same settings into the links it gives you. A link overrides `AYARLAR.js`. An invalid value falls back to its default, and numbers are limited to their range. Yes/no settings accept `true`/`false`, `yes`/`no`, `on`/`off` or `1`/`0`. The studio writes the English names. The Turkish names, the pack's original ones, work everywhere too; if a file or link gives both, the Turkish one wins.

| Setting | Turkish name | Values | Default |
|---|---|---|---|
| `channel` | `kanal` | Your channel name, as in `kick.com/NAME`. A full kick.com link or `@NAME` also works | *(empty)* |
| `theme` | `stil` | `glass` · `vivid` · `soft` · `cinema` · `neon` · `minimal` · `pastel` · `terminal` · `aurora` · `holo` · `ember` · `paper` · `retro` | `glass` |
| `shape` | `sekil` | `pill` · `rounded` · `square` | `pill` |
| `font` | `yaziTipi` | `inter` · `poppins` · `nunito` · `mono` | `inter` |
| `language` | `dil` | `tr` · `en` · `both` · `es` · `pt` · `de` · `ar` | `both` |
| `motion` | `animasyon` | `normal` · `low` · `off` | `normal` |
| `accent` | `renk` | Accent color, hex (e.g. `#53fc18`) | `#53fc18` |
| `customCss` | `ozelCss` | Custom CSS applied over the theme on every overlay, up to 2000 characters. A value with `url(`, `@import`, `@font-face`, `image-set` or a backslash is ignored as a whole | *(empty)* |
| `streamerLabel` | `yayinciYazisi` | Label next to your name in chat (chat only) | `Streamer` |
| `followerGoal` | `takipciHedefi` | Follower goal | `1000` |
| `followerFallback` | `takipciYedek` | Follower count shown when Kick cannot be reached | `0` |
| `subscriberGoal` | `aboneHedefi` | Subscriber goal | `100` |
| `subscriberCount` | `aboneSayisi` | Subscriber count when no Kick app is set up | `0` |
| `showSessionGain` | `oturumFarkiGoster` | Show the gain during this stream, such as "+3" | `true` |
| `showPercent` | `yuzdeGoster` | Show the percentage of the goal | `false` |
| `goalCelebration` | `hedefKutlama` | Milestone pulse at 25, 50 and 75 %, and a goal-reached state at 100 % | `true` |
| `statusNote` | `hataNotu` | Show the small status note on screen, such as "Kick unreachable" | `true` |
| `infoShowTitle` | `bilgiBaslik` | Show the stream title on the info panel's bottom edge | `false` |
| `refreshSeconds` | `yenilemeSn` | Refresh interval in seconds (10–600) | `30` |
| `chatMaxMessages` | `sohbetMaksMesaj` | Most chat messages on screen at once (3–20) | `8` |
| `chatHideCommands` | `sohbetKomutGizle` | Hide chat messages that start with `!` | `false` |
| `chatHiddenUsers` | `sohbetGizliKullanicilar` | Usernames hidden from chat, comma-separated, not case-sensitive (up to 300 characters) | *(empty)* |
| `chatFadeSeconds` | `sohbetSilinmeSn` | Seconds before a chat message fades out (0–600). `0` keeps it until newer messages push it out | `0` |
| `chatHorizontal` | `sohbetYatay` | Chat in one horizontal row, newest on the right, for a strip such as a 1280 × 80 source | `false` |
| `countdownMinutes` | `geriSayimDk` | Countdown length in minutes (1–720) | `5` |
| `countdownTime` | `geriSayimSaat` | Countdown target as a 24-hour clock time, `HH:MM` (e.g. `20:30`). Overrides `geriSayimDk`; if the time has already passed today, it counts to tomorrow | *(empty)* |
| `countdownTitle` | `geriSayimBaslik` | Countdown title. Empty shows "Starting soon" in your label language | *(empty)* |
| `announcements` | `duyuruMetinleri` | Announcement lines separated by `\|`, up to 12, e.g. `Follow for more \| !discord \| New video every Friday` | *(empty)* |
| `announcementSeconds` | `duyuruSn` | Seconds each announcement stays (3–60) | `6` |
| `alertSeconds` | `uyariSn` | Seconds each alert stays (3–30). With 5 or more waiting, each stays half as long, at least 3 | `6` |
| `alertFollows` | `uyariTakip` | Show follow alerts | `true` |
| `alertSubs` | `uyariAbone` | Show new and renewed subscription alerts | `true` |
| `alertGifts` | `uyariHediye` | Show gifted subscription alerts | `true` |
| `alertKicks` | `uyariKicks` | Show Kicks alerts | `true` |
| `alertRewards` | `uyariOdul` | Show channel point reward redemptions (pending or accepted; rejected ones are skipped) | `true` |
| `alertSound` | `uyariSes` | Play a sound with each live alert. Previews stay silent | `true` |
| `alertVolume` | `uyariSesSeviye` | Alert volume (0–100) | `60` |
| `alertRewardsHidden` | `uyariOdulGizle` | Reward names that never show an alert, separated by `\|` (not case-sensitive) | *(empty)* |
| `alertTts` | `uyariTts` | Read Kicks and reward messages aloud with the computer's voice. The speech plays on the computer's default output, not through the OBS source, so it reaches the stream only when OBS captures desktop audio. Previews stay silent | `false` |
| `alertTtsMaxLength` | `uyariTtsUzunluk` | Longest message read aloud, in characters (20–200); a longer one is cut at a word break | `120` |
| `alertTtsBlockedWords` | `uyariTtsYasak` | Words separated by commas. A message whose name or text contains one is not read at all. Links are never read | *(empty)* |
| `eventsCount` | `olaySayisi` | Recent events (`events.html`): how many events to show (3–10) | `5` |
| `leaderboardType` | `liderTur` | Leaderboard (`leaderboard.html`): `gift` ranks gifted subscriptions, `kicks` ranks Kicks | `gift` |
| `leaderboardCount` | `liderSayisi` | People on the leaderboard (3–10) | `5` |
| `kicksGoal` | `kicksHedefi` | Kicks goal bar (`kicks-bar.html`): Kicks to reach this stream | `1000` |
| `subTrainSeconds` | `trenSn` | Sub train (`sub-train.html`): seconds a new subscription has to keep the train going (30–600) | `120` |
| `goalStep` | `hedefArtis` | Goal auto-step for the follower, subscriber and Kicks bars: a reached goal rises by this much. `0` = off | `0` |

Settings that are only for the local machine. They are never read from a link:

| Key | Where | Default | Purpose |
|---|---|---|---|
| `kickClientId`, `kickClientSecret` | `AYARLAR.local.js` | *(empty)* | Kick app credentials for the subscriber bars. The relay reads them too. |
| `relayAddress` (`relayAdresi`) | `AYARLAR.js` | `http://127.0.0.1:8790` | Address of the relay's overlay port. Only `https`, or `http` on `127.0.0.1` or `localhost`, is accepted. |
| `apiBase`, `tokenBase` | `AYARLAR.js` | `https://api.kick.com`, `https://id.kick.com` | Kick API addresses used by the subscriber bars. Leave them alone unless you test against a mirror. |

**Upgrading from 2.2.x.** `AYARLAR.local.js` is now loaded only by `subscriber-bar.html` and `combined-bar.html`. If you set `relayAdresi` in that file, move it to `AYARLAR.js`. The relay still reads the credentials from `AYARLAR.local.js`.

---

[← README](../README.md)
