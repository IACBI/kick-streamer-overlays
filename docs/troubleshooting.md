# Troubleshooting

Messages appear in the language set by `dil`.

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

For relay problems, the studio's **Check relay** button goes through every step and says which one fails. See also the [FAQ](faq.md).

---

[← README](../README.md)
