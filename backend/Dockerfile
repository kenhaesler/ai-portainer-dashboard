FROM dhi.io/node:24-alpine3.23-dev AS builder

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM dhi.io/node:24-alpine3.23-dev AS runtime

RUN apk add --no-cache dumb-init wget tcpdump && \
    addgroup -S appgroup && adduser -S appuser -G appgroup -u 1001

WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/src/db/migrations/ dist/db/migrations/

RUN mkdir -p /app/data && chown -R appuser:appgroup /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3051

EXPOSE 3051

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider --quiet http://127.0.0.1:3051/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
