FROM oven/bun:1.4.2-slim AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/load-test/package.json ./apps/load-test/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/web ./apps/web

# Next evaluates server modules while producing the standalone bundle. These are
# deliberately non-secret build placeholders; real values are injected at runtime.
RUN NODE_ENV=production \
    APP_URL=https://example.invalid \
    API_URL=https://example.invalid \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    BETTER_AUTH_URL=https://example.invalid \
    BETTER_AUTH_SECRET=build-only-secret-that-is-long-enough-not-for-runtime \
    SMTP_HOST=smtp.example.invalid \
    SMTP_PORT=465 \
    SMTP_SECURITY=tls \
    SMTP_USER=security@example.invalid \
    SMTP_PASSWORD=build-only \
    EMAIL_FROM=security@example.invalid \
    CREDENTIAL_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    META_APP_ID=build-only \
    META_APP_SECRET=build-only \
    META_CONFIG_ID=build-only \
    META_VERIFY_TOKEN=build-only-verify-token \
    R2_ACCOUNT_ID=build-only \
    R2_ACCESS_KEY_ID=build-only \
    R2_SECRET_ACCESS_KEY=build-only \
    R2_BUCKET=build-only \
    bun run --filter @wa/web build

FROM node:22-alpine AS runtime
WORKDIR /app/apps/web
ARG IMAGE_SOURCE="https://github.com/yasserfullstack-tech/whatsapp"
ARG IMAGE_REVISION="unknown"
ARG IMAGE_VERSION="dev"
LABEL org.opencontainers.image.source="$IMAGE_SOURCE" \
      org.opencontainers.image.revision="$IMAGE_REVISION" \
      org.opencontainers.image.version="$IMAGE_VERSION"
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Keep the runtime OS patched and remove package-manager tooling that the standalone
# server never executes. This reduces both image surface area and scanner findings.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && addgroup -S nextjs -g 1001 \
    && adduser -S nextjs -u 1001 -G nextjs
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/standalone /app
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/static /app/apps/web/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
