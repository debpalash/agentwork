#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
backup_dir="${BACKUP_DIR:-$(pwd)/backups}"
mkdir -p -- "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$backup_dir/aiwork-$timestamp.dump"

pg_dump --format=custom --compress=9 --no-owner --no-acl --file="$archive" "$DATABASE_URL"
pg_restore --list "$archive" >/dev/null
sha256sum "$archive" >"$archive.sha256"

echo "Verified backup: $archive"
echo "Checksum: $archive.sha256"
