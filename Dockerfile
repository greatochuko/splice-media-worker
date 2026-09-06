FROM node:22-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

# Native dependencies required by some packages
RUN apk add --no-cache python3 make g++

# Copy dependency files, including pnpm build-script configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies and allow approved native build scripts
RUN pnpm install --frozen-lockfile

# Copy Prisma schema and application source
COPY prisma ./prisma/
COPY . .

# Generate Prisma client
RUN pnpm exec prisma generate

# Build TypeScript
RUN pnpm run build


# ==========================================
# Production image
# ==========================================

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Runtime dependencies
# FFmpeg for media processing
# Fonts for subtitle rendering
# OpenSSL for Prisma
RUN apk add --no-cache \
    ffmpeg \
    fontconfig \
    ttf-dejavu \
    ttf-liberation \
    openssl

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

# Copy package metadata
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy built application and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Start worker
CMD ["node", "dist/worker.js"]