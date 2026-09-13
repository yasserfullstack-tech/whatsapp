FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN bun install --ignore-scripts

FROM deps AS build
RUN bun build apps/worker/src/index.ts --target=bun --minify --outfile=/out/worker.js

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /out/worker.js ./worker.js
USER bun
EXPOSE 9464
CMD ["bun", "/app/worker.js"]
