#!/usr/bin/env bash
# Nightly backup: the database AND the uploaded pictures, together, encrypted, with old copies pruned.
# A backup is only as good as its last successful restore: run restore-check.sh regularly (see README).
#
#   DATABASE_URL=postgres://...  MEDIA_DIR=/srv/mpe/media  BACKUP_DIR=/srv/mpe/backups \
#   BACKUP_PASSPHRASE_FILE=/root/.mpe-backup-passphrase  [KEEP_DAYS=14]  ./backup.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
: "${MEDIA_DIR:?set MEDIA_DIR}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE (a file holding a long random passphrase; keep a copy OFF the server)}"
KEEP_DAYS="${KEEP_DAYS:-14}"

[[ -s "$BACKUP_PASSPHRASE_FILE" ]] || { echo "passphrase file is missing or empty: $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }
[[ -d "$MEDIA_DIR" ]] || { echo "media directory not found: $MEDIA_DIR" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Custom format: compressed, and restorable table by table if ever needed.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$work/database.dump"
tar -C "$MEDIA_DIR" -czf "$work/media.tar.gz" .
( cd "$work" && sha256sum database.dump media.tar.gz > SHA256SUMS )
tar -C "$work" -cf "$work/bundle.tar" database.dump media.tar.gz SHA256SUMS

out="$BACKUP_DIR/mpe-$stamp.tar.gpg"
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$BACKUP_PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --output "$out.partial" "$work/bundle.tar"
mv "$out.partial" "$out"                           # a half-written backup never looks like a finished one

find "$BACKUP_DIR" -name 'mpe-*.tar.gpg' -type f -mtime +"$KEEP_DAYS" -delete
echo "backup written: $out ($(du -h "$out" | cut -f1))"
