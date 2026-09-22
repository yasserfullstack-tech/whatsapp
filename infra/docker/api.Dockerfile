FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/load-test/package.json ./apps/load-test/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/api ./apps/api

FROM deps AS build
RUN bun build apps/api/src/index.ts --target=bun --minify --outfile=/out/api.js

FROM oven/bun:1.4.2-slim AS migrator
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/load-test/package.json ./apps/load-test/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/* \
    && bun install --production --frozen-lockfile --ignore-scripts --filter "!./" --filter @wa/db
ARG IMAGE_SOURCE="https://github.com/yasserfullstack-tech/whatsapp"
ARG IMAGE_REVISION="unknown"
ARG IMAGE_VERSION="dev"
LABEL org.opencontainers.image.source="$IMAGE_SOURCE" \
      org.opencontainers.image.revision="$IMAGE_REVISION" \
      org.opencontainers.image.version="$IMAGE_VERSION"
ENV NODE_ENV=production
USER bun
CMD ["bun", "run", "--filter", "@wa/db", "db:migrate:runtime"]

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ARG IMAGE_SOURCE="https://github.com/yasserfullstack-tech/whatsapp"
ARG IMAGE_REVISION="unknown"
ARG IMAGE_VERSION="dev"
LABEL org.opencontainers.image.source="$IMAGE_SOURCE" \
      org.opencontainers.image.revision="$IMAGE_REVISION" \
      org.opencontainers.image.version="$IMAGE_VERSION"
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=bun:bun /out/api.js ./api.js
USER bun
EXPOSE 4000
CMD ["bun", "/app/api.js"]
