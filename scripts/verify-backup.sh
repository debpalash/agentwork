#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:?Usage: scripts/verify-backup.sh /explicit/path/to/backup.dump}"
if [[ "$archive" != /* ]]; then
  echo "Backup path must be absolute" >&2
  exit 2
fi
if [[ ! -f "$archive" || ! -f "$archive.sha256" ]]; then
  echo "Backup archive and adjacent .sha256 file are required" >&2
  exit 2
fi

sha256sum --check "$archive.sha256"
pg_restore --list "$archive" >/dev/null
echo "Backup checksum and PostgreSQL catalog verified: $archive"
