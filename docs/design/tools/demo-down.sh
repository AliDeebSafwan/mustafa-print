#!/bin/bash
# By port, never by matching command lines (that would also kill a calling shell that mentions the same text).
lsof -ti tcp:4280 | xargs -r kill 2>/dev/null; lsof -ti tcp:3380 | xargs -r kill 2>/dev/null
PGPASSWORD=${PGPASSWORD:-app} psql -h localhost -U ${PGUSER:-app} -d postgres -qc "DROP DATABASE IF EXISTS mpe_design WITH (FORCE)" 2>/dev/null; rm -rf /tmp/design-media; echo down
