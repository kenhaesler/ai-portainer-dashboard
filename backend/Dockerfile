# syntax=docker/dockerfile:1
# Build stage — compile TypeScript to JavaScript
FROM dhi.io/node:24-alpine3.23-dev AS builder

# Install build dependencies for native modules (pg-native optional)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json ./packages/core/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY packages/security/package.json ./packages/security/
COPY packages/observability/package.json ./packages/observability/
COPY packages/operations/package.json ./packages/operations/
COPY packages/ai-intelligence/package.json ./packages/ai-intelligence/
COPY packages/server/package.json ./packages/server/
RUN --mount=type=cache,target=/root/.npm npm ci -w backend -w @dashboard/contracts -w @dashboard/core -w @dashboard/infrastructure -w @dashboard/security -w @dashboard/observability -w @dashboard/operations -w @dashboard/ai -w @dashboard/server
COPY packages/contracts/ ./packages/contracts/
COPY packages/core/ ./packages/core/
COPY packages/infrastructure/ ./packages/infrastructure/
COPY packages/security/ ./packages/security/
COPY packages/observability/ ./packages/observability/
COPY packages/operations/ ./packages/operations/
COPY packages/ai-intelligence/ ./packages/ai-intelligence/
RUN npm run build -w @dashboard/contracts && npm run build -w @dashboard/core && npm run build -w @dashboard/infrastructure && npm run build -w @dashboard/security && npm run build -w @dashboard/observability && npm run build -w @dashboard/operations && npm run build -w @dashboard/ai
COPY backend/tsconfig.json ./backend/
COPY backend/tsconfig.build.json ./backend/
COPY backend/src/ backend/src/
RUN npm run build -w backend
COPY packages/server/ ./packages/server/
RUN npm run build -w @dashboard/server

# Separate stage to build production dependencies with native bindings
FROM dhi.io/node:24-alpine3.23-dev AS prod-deps

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/core/package.json ./packages/core/
COPY packages/infrastructure/package.json ./packages/infrastructure/
COPY packages/security/package.json ./packages/security/
COPY packages/observability/package.json ./packages/observability/
COPY packages/operations/package.json ./packages/operations/
COPY packages/ai-intelligence/package.json ./packages/ai-intelligence/
COPY packages/server/package.json ./packages/server/
RUN --mount=type=cache,target=/root/.npm npm ci -w backend -w @dashboard/contracts -w @dashboard/core -w @dashboard/infrastructure -w @dashboard/security -w @dashboard/observability -w @dashboard/operations -w @dashboard/ai -w @dashboard/server --omit=dev

# Utility stage — install runtime tools and prepare filesystem
FROM dhi.io/node:24-alpine3.23-dev AS tools

RUN apk add --no-cache dumb-init wget tcpdump

# Prepare the app directory with correct ownership for node (uid 1000)
RUN mkdir -p /opt/app/data && chown -R 1000:1000 /opt/app

###########################################################
# Runtime stage — minimal DHI image with only what's needed
FROM dhi.io/node:24-alpine3.23 AS runtime

# Copy runtime utilities from tools stage
COPY --from=tools /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=tools /usr/bin/wget /usr/bin/wget
COPY --from=tools /usr/bin/tcpdump /usr/bin/tcpdump
# Copy shared libraries needed by tcpdump (libpcap + OpenSSL)
COPY --from=tools /usr/lib/libpcap* /usr/lib/
COPY --from=tools /usr/lib/libcrypto* /usr/lib/
COPY --from=tools /usr/lib/libssl* /usr/lib/
# Copy pre-created data directory with correct ownership
COPY --from=tools --chown=node:node /opt/app/data /app/data

WORKDIR /app
COPY --chown=node:node --from=builder /app/backend/package.json ./
# Copy production node_modules (hoisted to root by npm workspaces)
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
# Merge any backend-workspace-local packages not hoisted to root (e.g. fastify-type-provider-zod)
COPY --chown=node:node --from=prod-deps /app/backend/node_modules ./node_modules
# Copy built workspace packages so backend can resolve them at runtime
COPY --chown=node:node --from=builder /app/packages/core/dist/ ./node_modules/@dashboard/core/dist/
COPY --chown=node:node --from=builder /app/packages/core/package.json ./node_modules/@dashboard/core/package.json
COPY --chown=node:node --from=builder /app/packages/infrastructure/dist/ ./node_modules/@dashboard/infrastructure/dist/
COPY --chown=node:node --from=builder /app/packages/infrastructure/package.json ./node_modules/@dashboard/infrastructure/package.json
COPY --chown=node:node --from=builder /app/packages/security/dist/ ./node_modules/@dashboard/security/dist/
COPY --chown=node:node --from=builder /app/packages/security/package.json ./node_modules/@dashboard/security/package.json
COPY --chown=node:node --from=builder /app/packages/observability/dist/ ./node_modules/@dashboard/observability/dist/
COPY --chown=node:node --from=builder /app/packages/observability/package.json ./node_modules/@dashboard/observability/package.json
COPY --chown=node:node --from=builder /app/packages/operations/dist/ ./node_modules/@dashboard/operations/dist/
COPY --chown=node:node --from=builder /app/packages/operations/package.json ./node_modules/@dashboard/operations/package.json
COPY --chown=node:node --from=builder /app/packages/ai-intelligence/dist/ ./node_modules/@dashboard/ai/dist/
COPY --chown=node:node --from=builder /app/packages/ai-intelligence/package.json ./node_modules/@dashboard/ai/package.json
# backend routes (used by @dashboard/server at runtime via 'backend' workspace dep)
COPY --chown=node:node --from=builder /app/backend/dist/ ./node_modules/backend/dist/
COPY --chown=node:node --from=builder /app/backend/package.json ./node_modules/backend/package.json
# @dashboard/server is the application entry point
COPY --chown=node:node --from=builder /app/packages/server/dist/ dist/

USER node

ENV NODE_ENV=production
ENV PORT=3051

EXPOSE 3051

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3051/health').then(r=>{if(!r.ok)throw r.status;process.exit(0)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "--use-system-ca", "dist/index.js"]
