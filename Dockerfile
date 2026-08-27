# Base on Node so `npm install`/the app itself needs no extra setup;
# add a JRE on top for ViaProxy, which is what actually speaks protocol 776
# to the real 26.2 server on the bot's behalf.
FROM node:20-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends openjdk-21-jre-headless curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- ViaProxy ---
ARG VIAPROXY_VERSION=3.4.12
RUN mkdir -p /app/viaproxy && \
    curl -fL -o /app/viaproxy/viaproxy.jar \
      "https://github.com/ViaVersion/ViaProxy/releases/download/v${VIAPROXY_VERSION}/ViaProxy-${VIAPROXY_VERSION}.jar"

# --- Node app ---
COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN chmod +x start.sh

# Railway sets $PORT for you; the Express keep-alive server binds to it.
EXPOSE 3000

CMD ["./start.sh"]
