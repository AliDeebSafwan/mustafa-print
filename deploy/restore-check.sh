#!/usr/bin/env bash
# Proves the newest backup can actually be restored: restores it into a throw-away database and directory,
# compares it with the live system, and cleans up. Run it weekly (see README); an alert on failure is the point.
#
#   ADMIN_DATABASE_URL=postgres://user:pass@localhost:5432/postgres   (a role that may CREATE DATABASE)
#   DATABASE_URL=...  MEDIA_DIR=...  BACKUP_DIR=...  BACKUP_PASSPHRASE_FILE=...  ./restore-check.sh
set -euo pipefail
: "${ADMIN_DATABASE_URL:?}" "${DATABASE_URL:?}" "${MEDIA_DIR:?}" "${BACKUP_DIR:?}" "${BACKUP_PASSPHRASE_FILE:?}"

latest="$(ls -1t "$BACKUP_DIR"/mpe-*.tar.gpg 2>/dev/null | head -1)"
[[ -n "$latest" ]] || { echo "FAIL: no backup found in $BACKUP_DIR" >&2; exit 1; }
age_hours=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
(( age_hours <= 36 )) || { echo "FAIL: the newest backup is $age_hours hours old" >&2; exit 1; }

check_db="restore_check_$(date +%s)"
check_media="$(mktemp -d)"
cleanup() { psql "$ADMIN_DATABASE_URL" -qc "DROP DATABASE IF EXISTS $check_db" >/dev/null 2>&1 || true; rm -rf "$check_media"; }
trap cleanup EXIT

psql "$ADMIN_DATABASE_URL" -qc "CREATE DATABASE $check_db"
restored_url="$(python3 -c "import sys,urllib.parse as u; p=u.urlparse(sys.argv[1]); print(p._replace(path='/'+sys.argv[2]).geturl())" "$ADMIN_DATABASE_URL" "$check_db")"
"$(dirname "$0")/restore.sh" "$latest" "$restored_url" "$check_media" >/dev/null

# The restored copy must hold what the live system held when the backup was taken (it may have grown since).
for table in customers orders order_items transactions stock_movements media services gallery_items; do
  live="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM $table")"
  copy="$(psql "$restored_url" -Atc "SELECT count(*) FROM $table")"
  (( copy <= live )) || { echo "FAIL: $table has $copy rows in the backup but $live live" >&2; exit 1; }
  (( copy > 0 || live == 0 )) || { echo "FAIL: $table is empty in the backup but has $live rows live" >&2; exit 1; }
done
live_files="$(find "$MEDIA_DIR" -type f | wc -l)"
copy_files="$(find "$check_media" -type f | wc -l)"
(( copy_files > 0 || live_files == 0 )) || { echo "FAIL: no pictures in the backup" >&2; exit 1; }
echo "OK: $(basename "$latest") restores ($age_hours h old, $copy_files picture files)"
