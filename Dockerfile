# syntax=docker/dockerfile:1

ARG NODE_VERSION=26

FROM docker.io/library/node:${NODE_VERSION}-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

FROM base AS build

WORKDIR /app

COPY . .

RUN npm run build

FROM docker.io/library/node:${NODE_VERSION}-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

FROM docker.io/library/node:${NODE_VERSION}-alpine AS runtime

LABEL org.opencontainers.image.title="marlin-search" \
      org.opencontainers.image.description="A Jellyfin search companion backed by Meilisearch" \
      org.opencontainers.image.source="https://github.com/fredrikburmester/marlin-search"

RUN apk add --no-cache tini

ENV PORT=5000 NODE_ENV=production

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --from=build --chown=node:node /app/build ./build
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-5000}/up" >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "build/index.js"]
