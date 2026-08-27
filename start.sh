#!/bin/sh
set -e

VIAPROXY_PORT="${VIAPROXY_PORT:-25577}"
MC_HOST="${MC_HOST:-${SERVER_HOST:-localhost}}"
MC_PORT="${MC_PORT:-${SERVER_PORT:-25565}}"
MC_VERSION="${MC_VERSION:-26.2}"

echo "[start.sh] Launching ViaProxy: 127.0.0.1:${VIAPROXY_PORT} -> ${MC_HOST}:${MC_PORT} (target-version ${MC_VERSION})"

java -jar /app/viaproxy/viaproxy.jar cli \
  --bind-address "127.0.0.1:${VIAPROXY_PORT}" \
  --target-address "${MC_HOST}:${MC_PORT}" \
  --target-version "${MC_VERSION}" \
  --auth-method "${VIAPROXY_AUTH_METHOD:-NONE}" \
  > /app/viaproxy.log 2>&1 &

VIAPROXY_PID=$!

echo "[start.sh] Waiting for ViaProxy to open ${VIAPROXY_PORT}..."
i=0
until node -e "
const net = require('net');
const s = net.createConnection({ host: '127.0.0.1', port: ${VIAPROXY_PORT} }, () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
"; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[start.sh] ViaProxy did not open its port after 30s. Log follows:"
    cat /app/viaproxy.log
    exit 1
  fi
  sleep 1
done

echo "[start.sh] ViaProxy is up (pid ${VIAPROXY_PID}). Starting the bot..."
exec node index.js
