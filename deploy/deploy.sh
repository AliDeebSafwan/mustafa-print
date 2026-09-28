#!/usr/bin/env bash
# Builds and (re)starts everything, with a backup first when there is data to lose, then warms the website.
# Run from deploy/:  ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "deploy/.env is missing: copy .env.example and fill it in" >&2; exit 1; }
set -a; . ./.env; set +a

mkdir -p data/media data/postgres data/caddy backups
chown -R 1000:1000 data/media 2>/dev/null || true          # the API container runs as uid 1000

# Never update over data that has no fresh backup.
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  echo "backing up before the update..."
  DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
  MEDIA_DIR="$PWD/data/media" BACKUP_DIR="$PWD/backups" BACKUP_PASSPHRASE_FILE="${BACKUP_PASSPHRASE_FILE:-/root/.mpe-backup-passphrase}" \
  ./backup.sh
fi

docker compose build
docker compose up -d                       # migrate runs first; the API starts only if it succeeded

echo "waiting for the website..."
for _ in $(seq 1 60); do docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/ar').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null && break; sleep 2; done
# The website is built without the API: fill its pages now instead of letting the first visitors see empty ones.
docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/revalidate',{method:'POST',headers:{Authorization:'Bearer '+process.env.REVALIDATE_SECRET}}).then(r=>{console.log('website warmed:',r.status);process.exit(r.ok?0:1)})"
docker compose ps
