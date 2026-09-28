# syntax=docker/dockerfile:1
# Caddy with the staff app baked in. The staff app is plain files; its API address is fixed at build time.
# Build from the repository root (compose does this, passing APP_URL and SITE_URL).

FROM node:22-slim AS admin
WORKDIR /repo
RUN corepack enable
ARG APP_URL
ARG SITE_URL
COPY . .
RUN test -n "$APP_URL" && test -n "$SITE_URL" \
 && pnpm install --frozen-lockfile --filter "@mpe/admin..." \
 && VITE_API_URL="$APP_URL" VITE_PUBLIC_WEB_URL="$SITE_URL" pnpm --filter @mpe/admin build

FROM caddy:2.11
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=admin /repo/apps/admin/dist /srv/admin
