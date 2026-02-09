# syntax=docker/dockerfile:1
# Build stage — install dependencies
FROM dhi.io/node:24-alpine3.23-dev AS builder

WORKDIR /loadtests

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Runtime stage — minimal DHI image
FROM dhi.io/node:24-alpine3.23 AS runtime

WORKDIR /loadtests

COPY --from=builder /loadtests/node_modules ./node_modules
COPY . .

# Default target — backend on Docker Desktop host
ENV BASE_URL=http://host.docker.internal:3051
ENV DASHBOARD_USER=admin
ENV DASHBOARD_PASS=changeme123
