FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Run the patch AFTER npm install — surgically edits mineflayer & minecraft-protocol
# to accept Minecraft 26.2 (Protocol 776)
COPY patch-mineflayer.js ./
RUN node patch-mineflayer.js

# Copy application files
COPY index.js builder.js ./

# Expose Railway web port
EXPOSE 3000
ENV PORT=3000

CMD ["node", "index.js"]
