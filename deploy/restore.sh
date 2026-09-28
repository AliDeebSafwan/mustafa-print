#!/usr/bin/env bash
# Restores a backup made by backup.sh into an EMPTY database and an empty media directory.
# It refuses to overwrite anything: restoring on top of live data is how a bad day becomes a disaster.
#
#   BACKUP_PASSPHRASE_FILE=...  ./restore.sh /srv/mpe/backups/mpe-20260101T020000Z.tar.gpg \
#       postgres://user:pass@localhost:5432/mustafa_restored  /srv/mpe/media-restored
set -euo pipefail

backup="${1:?usage: restore.sh <backup.tar.gpg> <empty-database-url> <empty-media-dir>}"
target_db="${2:?give the URL of an EMPTY database to restore into}"
target_media="${3:?give an EMPTY directory for the pictures}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"

tables="$(psql "$target_db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
[[ "$tables" == "0" ]] || { echo "refusing: the target database is not empty ($tables tables)" >&2; exit 1; }
mkdir -p "$target_media"
[[ -z "$(ls -A "$target_media")" ]] || { echo "refusing: the target media directory is not empty" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" --decrypt --output "$work/bundle.tar" "$backup"
tar -C "$work" -xf "$work/bundle.tar"
( cd "$work" && sha256sum --check --quiet SHA256SUMS ) || { echo "the backup is damaged: checksums do not match" >&2; exit 1; }

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target_db" "$work/database.dump"
tar -C "$target_media" -xzf "$work/media.tar.gz"
echo "restored $(psql "$target_db" -Atc 'SELECT count(*) FROM schema_migrations') migrations and $(find "$target_media" -type f | wc -l) picture files"
