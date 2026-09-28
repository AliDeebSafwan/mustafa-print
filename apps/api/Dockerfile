# syntax=docker/dockerfile:1
# The API, the message worker and the migration runner share this image; compose picks the command.
# Build from the repository root:  docker build -f apps/api/Dockerfile .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@mpe/api..."
# A standalone folder with production dependencies only (no dev tools, no workspace links).
RUN pnpm --filter @mpe/api build \
 && pnpm --filter @mpe/api deploy --prod /out \
 && rm -rf /out/src /out/tests /out/scripts /out/drizzle.config.ts

FROM node:22-slim
ENV NODE_ENV=production MEDIA_DIR=/data/media
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
