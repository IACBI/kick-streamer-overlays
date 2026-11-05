# The relay in server mode: studio, overlays and Kick webhooks on one port, behind your HTTPS reverse proxy.
# See docs/cloud.md. Settings, the access key and stream stats live in the /data volume.
FROM node:22.22.0-alpine3.22@sha256:7aa86fa052f6e4b101557ccb56717cb4311be1334381f526fe013418fe157384

WORKDIR /app
# Only what the relay and the pages need at runtime; the relay itself has no npm dependencies.
COPY package.json ./
COPY relay/ relay/
COPY shared/ shared/
COPY alerts/ alerts/
COPY badges/ badges/
COPY branding/ branding/
COPY *.html ./

RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production \
    RELAY_HOST=0.0.0.0 \
    RELAY_EVENTS_PORT=8790 \
    RELAY_DATA_DIR=/data \
    RELAY_LABELS=0 \
    RELAY_TUNNEL=0 \
    RELAY_OPEN=0

VOLUME ["/data"]
EXPOSE 8790

# The studio page needs no key, so it doubles as a liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8790/studio.html || exit 1

CMD ["node", "relay/server.js"]
