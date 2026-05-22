# Multi-stage optimized Production Dockerfile
# Stage 1: Build all workspaces
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package descriptors first to optimize layer caching
COPY package.json ./
COPY sdk/package.json ./sdk/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Bootstrap workspace packages
RUN npm install

# Copy complete source scopes
COPY sdk/ ./sdk/
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build core dependency SDK first, followed by Frontend and Backend
RUN npm run build:sdk
RUN npm run build:frontend
RUN npm run build:backend

# Stage 2: Ultra-lightweight production release image
FROM node:22-alpine

WORKDIR /app

# Set production context
ENV NODE_ENV=production

# Copy root workspaces and built outputs
COPY package.json ./
COPY --from=builder /app/sdk/package.json ./sdk/
COPY --from=builder /app/sdk/dist ./sdk/dist
COPY --from=builder /app/backend/package.json ./backend/
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/frontend/dist ./frontend/dist

# Install production only packages
RUN npm install --workspace=backend --omit=dev

EXPOSE 5000

# Automated database schema creation / migration rollout before starting Express server
CMD ["sh", "-c", "if echo $DATABASE_URL | grep -q 'postgres'; then sed -i 's/provider = \"sqlite\"/provider = \"postgresql\"/g' ./backend/prisma/schema.prisma; fi && npx prisma generate --schema=./backend/prisma/schema.prisma && npx prisma migrate deploy --schema=./backend/prisma/schema.prisma && node backend/dist/server.js"]
