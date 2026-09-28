# syntax=docker/dockerfile:1
# The customer website. It builds without the API (pages are filled in at run time), so this needs no database.
# Build from the repository root:  docker build -f apps/web/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
# Baked into the build: where the website's /api/v1/public/* rewrite sends requests when Caddy is not in front.
ENV API_INTERNAL_URL=http://api:4000
COPY . .
RUN pnpm install --frozen-lockfile --filter "@mpe/web..." \
 && pnpm --filter @mpe/web build

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# "standalone" output: the server plus only the files it needs; static assets are copied beside it.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
