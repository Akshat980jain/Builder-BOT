FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY index.js builder.js ./

# Expose Railway web port
EXPOSE 3000

ENV PORT=3000

CMD ["node", "index.js"]
