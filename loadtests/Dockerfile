FROM node:22-alpine

WORKDIR /loadtests

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .

# Default target — backend on Docker Desktop host
ENV BASE_URL=http://host.docker.internal:3051
ENV DASHBOARD_USER=admin
ENV DASHBOARD_PASS=admin
