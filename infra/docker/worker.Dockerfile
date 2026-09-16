FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/load-test/package.json ./apps/load-test/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/worker ./apps/worker

FROM deps AS build
RUN bun build apps/worker/src/index.ts --target=bun --minify --outfile=/out/worker.js

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
COPY --from=build --chown=bun:bun /out/worker.js ./worker.js
USER bun
EXPOSE 9464
CMD ["bun", "/app/worker.js"]
