FROM node:22-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy application
COPY . .

# Setup database
RUN mkdir -p /data && node scripts/setup-db.js

# Build Next.js
RUN pnpm build 2>/dev/null || npm run build

EXPOSE 3100
ENV NODE_ENV=production
ENV MC_PORT=3100
ENV MC_DB_PATH=/data/mission-control.db

CMD ["node", "server.js"]
