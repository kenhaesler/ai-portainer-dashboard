# syntax=docker/dockerfile:1
# Build stage — compile TypeScript to JavaScript
FROM dhi.io/node:24-alpine3.23-dev AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Separate stage to build production dependencies with native bindings
FROM dhi.io/node:24-alpine3.23-dev AS prod-deps

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Utility stage — install runtime tools and prepare filesystem
FROM dhi.io/node:24-alpine3.23-dev AS tools

RUN apk add --no-cache dumb-init wget tcpdump

# Prepare the app directory with correct ownership for node (uid 1000)
RUN mkdir -p /opt/app/data && chown -R 1000:1000 /opt/app

# Runtime stage — minimal DHI image with only what's needed
FROM dhi.io/node:24-alpine3.23 AS runtime

# Copy runtime utilities from tools stage
COPY --from=tools /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=tools /usr/bin/wget /usr/bin/wget
COPY --from=tools /usr/bin/tcpdump /usr/bin/tcpdump
# Copy shared libraries needed by tcpdump/wget
COPY --from=tools /usr/lib/libpcap* /usr/lib/
# Copy pre-created data directory with correct ownership
COPY --from=tools --chown=node:node /opt/app/data /app/data

WORKDIR /app
COPY --chown=node:node --from=builder /app/package.json /app/package-lock.json ./
# Copy production node_modules with pre-built native bindings from prod-deps
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist/ dist/
COPY --chown=node:node --from=builder /app/src/db/migrations/ dist/db/migrations/

USER node

ENV NODE_ENV=production
ENV PORT=3051

EXPOSE 3051

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/bin/wget", "--spider", "--quiet", "http://127.0.0.1:3051/health"]

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
