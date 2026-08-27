FROM node:20-bookworm-slim

# Install Java JRE for ViaProxy, curl and ca-certificates
RUN apt-get update && \
    apt-get install -y --no-install-recommends default-jre-headless curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download ViaProxy release
ARG VIAPROXY_VERSION=3.4.12
RUN mkdir -p /app/viaproxy && \
    curl -fL -o /app/viaproxy/viaproxy.jar \
      "https://github.com/ViaVersion/ViaProxy/releases/download/v${VIAPROXY_VERSION}/ViaProxy-${VIAPROXY_VERSION}.jar"

# Install Node dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Fix any Windows CRLF line endings in start.sh and make executable
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

EXPOSE 3000

CMD ["sh", "./start.sh"]
