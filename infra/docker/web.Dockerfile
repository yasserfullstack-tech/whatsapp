FROM oven/bun:1.4.2-slim AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN bun install --ignore-scripts

# Next evaluates server modules while producing the standalone bundle. These are
# deliberately non-secret build placeholders; real values are injected at runtime.
RUN NODE_ENV=production \
    APP_URL=https://example.invalid \
    API_URL=https://example.invalid \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    BETTER_AUTH_URL=https://example.invalid \
    BETTER_AUTH_SECRET=build-only-secret-that-is-long-enough-not-for-runtime \
    RESEND_API_KEY=build-only \
    AUTH_EMAIL_FROM=security@example.invalid \
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
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup -S nextjs -g 1001 && adduser -S nextjs -u 1001 -G nextjs
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/standalone /app
COPY --from=build --chown=nextjs:nextjs /app/apps/web/.next/static /app/apps/web/.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
