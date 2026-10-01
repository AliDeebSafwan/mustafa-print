#!/bin/bash
# Builds the website against the demo API and serves it on :3380 (restarting it if already running).
set -e
R=$(cd "$(dirname "$0")/../../.." && pwd)
lsof -ti tcp:3380 | xargs -r kill 2>/dev/null || true   # by port, never by matching command lines
cd $R/apps/web && rm -rf .next
export API_INTERNAL_URL=http://127.0.0.1:4280 PUBLIC_API_URL=http://localhost:3380 SITE_URL=http://localhost:3380
timeout 250 pnpm build > /tmp/design-web-build.log 2>&1 || { tail -30 /tmp/design-web-build.log; exit 1; }
setsid nohup env NODE_ENV=production API_INTERNAL_URL=$API_INTERNAL_URL PUBLIC_API_URL=$PUBLIC_API_URL SITE_URL=$SITE_URL REVALIDATE_SECRET=design-revalidate-0123456789 \
  node_modules/.bin/next start -p 3380 > /tmp/design-web.log 2>&1 < /dev/null &
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3380/ar && break; sleep 1; done
echo "web up"
