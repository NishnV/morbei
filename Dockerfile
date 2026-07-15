FROM node:20-alpine

WORKDIR /app

# Copy root and server files
COPY package*.json ./
COPY server/ ./server/

# Install dependencies
RUN npm ci --only=production && \
    cd server && npm ci --only=production

EXPOSE 4000

# Start the backend server
CMD ["node", "--env-file=server/.env", "server/index.js"]
