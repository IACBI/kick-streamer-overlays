# FAQ

**Is it free? Can I use it on a monetized stream?**
Yes. The pack is MIT-licensed, including for commercial streaming. Keep the copyright notice if you share the code.

**Do I need a server or an account?**
No, for the goal bars, the info panel, the countdown and the announcement bar: they read Kick's public data straight from OBS. Live chat, alerts, stream stats, the dock and the subscriber total need the [relay](relay.md), a small program that runs on your own computer, and a free Kick developer app.

**Online or downloaded: which should I use?**
The [online studio](https://iacbi.github.io/kick-streamer-overlays/) is the quickest way to try a look, and its links work in OBS for everything without the relay. For the relay features, download the release, start the relay from that folder and use the studio it opens at `http://127.0.0.1:8790/`: its links never change and **Save** updates OBS directly. See [setup](setup.md#try-it-online) and [the relay](relay.md#studio-and-overlays-from-the-relay).

**Which languages are there?**
The `dil` setting picks the overlay labels: Turkish (`tr`), English (`en`), both together (`both`), Spanish (`es`), Brazilian Portuguese (`pt`), German (`de`) or Arabic (`ar`, laid out right to left). The studio itself comes in the same six languages. Names and messages from chat keep their own writing direction in every language.

**Can I add a language?**
Yes, as a small pull request: copy `shared/lang/en.js` (overlays and dock) and `shared/lang/studio/en.js` (studio), translate the values, and add the code to `dil` in `shared/kick-core.js`. The tests tell you if a key or a `{slot}` is missing.

**Does it work in Streamlabs Desktop or other software?**
Anything that has a browser source and loads a web address should work. The pack is built and tested for OBS Studio.

**Is my Kick client secret safe?**
It is read only from `AYARLAR.local.js`, the `KICK_CLIENT_SECRET` environment variable or the studio's memory, and never goes into a link, a draft, an export or the generated settings file. **Save in the relay** sends it once to the relay on your own computer, which writes `AYARLAR.local.js`; the relay never serves that file or sends the secret to a page. [SECURITY.md](../SECURITY.md) has the full model.

**Why does the countdown start over?**
It counts from the moment the source loads. Refreshing the source, or switching scenes with *Shutdown source when not visible* on, starts it again. The dock can restart it with new minutes during the stream.

**Something else is wrong.**
See [troubleshooting](troubleshooting.md), add `?debug=1` to the overlay's link, or open an issue on GitHub.

---

[← README](../README.md)
