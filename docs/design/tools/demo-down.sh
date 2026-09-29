#!/bin/bash
pkill -f "dist/server.js" 2>/dev/null; ps aux | grep -E "[n]ext start -p 3380|[n]ext-server" | awk '{print $2}' | xargs -r kill 2>/dev/null
PGPASSWORD=${PGPASSWORD:-app} psql -h localhost -U ${PGUSER:-app} -d postgres -qc "DROP DATABASE IF EXISTS mpe_design WITH (FORCE)" 2>/dev/null; rm -rf /tmp/design-media; echo down
