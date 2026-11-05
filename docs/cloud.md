# Server mode: the relay on your own server

Normally the relay runs on the streaming PC, and a Cloudflare tunnel carries Kick's events to it. In server mode it runs on an always-on machine instead (a VPS, a home server or a NAS) behind your HTTPS address. Then:

- no tunnel, and no new webhook URL after a restart: Kick posts to `https://your-address/kick/webhook`;
- chat, alerts and stream stats keep working when the streaming PC is off or restarts;
- the studio and every overlay come from that address, so OBS on any computer uses the same links.

You need a server that can run Docker, and a domain name (or subdomain) pointing at it.

## Run it

The image is built from this repository:

```bash
git clone https://github.com/IACBI/kick-streamer-overlays.git
cd kick-streamer-overlays
docker build -t kick-relay .
```

The relay listens on port 8790 over plain HTTP; a reverse proxy in front of it provides HTTPS. With [Caddy](https://caddyserver.com/), which gets the certificate by itself, a `compose.yaml` like this is all you need:

```yaml
services:
  relay:
    image: kick-relay
    restart: unless-stopped
    environment:
      RELAY_PUBLIC_URL: https://overlays.example.com
    volumes:
      - relay-data:/data
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from overlays.example.com --to relay:8790
    volumes:
      - caddy-data:/data
volumes:
  relay-data:
  caddy-data:
```

Replace `overlays.example.com` with your address in both places and run `docker compose up -d`. Any other reverse proxy works the same way: forward everything for your address to port 8790 and keep the `Host` header.

## First start

1. Open `https://overlays.example.com/`. The studio asks for the **access key**, once per browser. Read it with `docker compose exec relay cat /data/AYARLAR.relay.js`, or set your own with `RELAY_KEY` (32 to 128 letters, digits, `_` or `-`).
2. Set your channel and look, and press **Save**.
3. Under **Live features**, save your Kick app's client ID and secret, set the app's **Webhook URL** to `https://overlays.example.com/kick/webhook`, and press **Connect chat and alerts**.
4. Copy the overlay links into OBS. In server mode each link carries the access key, because OBS cannot sign in.

## Settings

| Variable | Meaning |
| --- | --- |
| `RELAY_PUBLIC_URL` | The HTTPS address in front of the relay. Turns server mode on. Must be `https://` with no path. |
| `RELAY_KEY` | The access key. Unset: one is created in `/data/AYARLAR.relay.js`. |
| `RELAY_DATA_DIR` | Where settings, credentials, the key and stats are kept (`/data` in the image). |
| `RELAY_HOST`, `RELAY_EVENTS_PORT` | Listening address and port (`0.0.0.0`, `8790` in the image). |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET`, `KICK_CHANNEL` | Optional: the same values the studio saves, from the environment instead. |

Back up the `/data` volume: it holds `AYARLAR.js` (your settings), `AYARLAR.local.js` (the Kick app secret), `AYARLAR.relay.js` (the key) and the stream stats.

## Security

- Pages and their images are public, as they are on GitHub. Everything else (settings, credentials, the event stream, the dock's controls) needs the access key, and saves also need your address as their origin.
- The relay never sends the key to a page. The studio keeps it in the browser where you entered it (**Forget the key here** removes it); OBS links carry it. Treat an overlay link like a password and do not show it on stream.
- Only requests for your address are answered; others get 403. Kick's webhooks are checked against Kick's signature as on the local relay.
- Run it only behind HTTPS. The relay refuses a `RELAY_PUBLIC_URL` that is not `https://`.
