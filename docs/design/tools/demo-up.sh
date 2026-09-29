#!/bin/bash
# Starts (or restarts) a throwaway demo shop API on :4280 with realistic content, and leaves it running.
# Local development only. Stop everything with demo-down.sh.
set -e
R=$(cd "$(dirname "$0")/../../.." && pwd); T=$R/docs/design/tools
export PGPASSWORD=${PGPASSWORD:-app}; PG="psql -h localhost -U ${PGUSER:-app}"
pkill -f "dist/server.js" 2>/dev/null || true; sleep 1
$PG -d postgres -qc "DROP DATABASE IF EXISTS mpe_design WITH (FORCE)" -c "CREATE DATABASE mpe_design" 2>/dev/null
export DATABASE_URL=postgres://${PGUSER:-app}:${PGPASSWORD}@localhost:5432/mpe_design
cd $R/apps/api && node dist/migrate.js >/dev/null && SEED_ADMIN_EMAIL=owner@demo.example SEED_ADMIN_PASSWORD=demo-owner-password-long node dist/seed.js >/dev/null
rm -rf /tmp/design-media
setsid nohup env JWT_ACCESS_SECRET=design-secret-design-secret-0123456789 PORT=4280 NODE_ENV=production COOKIE_SECURE=false MEDIA_DIR=/tmp/design-media \
  PUBLIC_WEB_URL=http://localhost:3380 EMAIL_PROVIDER=console DATABASE_URL=$DATABASE_URL node dist/server.js > /tmp/design-api.log 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -sf -o /dev/null http://127.0.0.1:4280/health && break; sleep 1; done
node $T/demo-images.mjs /tmp/demo-img >/dev/null
python3 $T/seed_demo.py http://127.0.0.1:4280 owner@demo.example demo-owner-password-long /tmp/demo-img
