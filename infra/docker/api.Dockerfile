FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN bun install --ignore-scripts

FROM deps AS build
RUN bun build apps/api/src/index.ts --target=bun --minify --outfile=/out/api.js

FROM deps AS migrator
ENV NODE_ENV=production
CMD ["bun", "run", "db:migrate"]

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=bun:bun /out/api.js ./api.js
USER bun
EXPOSE 4000
CMD ["bun", "/app/api.js"]
