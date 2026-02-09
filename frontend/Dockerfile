FROM dhi.io/node:24-alpine3.23-dev AS builder

ARG VITE_API_URL=""
ARG VITE_SOCKET_URL=""

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json components.json ./
COPY public/ public/
COPY src/ src/
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
RUN npm run build

FROM dhi.io/nginx:1.28-alpine3.23 AS runtime

USER root

RUN addgroup -S appgroup && adduser -S appuser -G appgroup -u 1001

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

RUN chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/log/nginx \
    && touch /tmp/nginx.pid && chown appuser:appgroup /tmp/nginx.pid

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --spider --quiet http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
