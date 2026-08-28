#!/usr/bin/env bash
set -euo pipefail

image_vars=(
  AIWORK_API_IMAGE AIWORK_FRONTEND_IMAGE POSTGRES_IMAGE FORGEJO_IMAGE
  DAYTONA_API_IMAGE DAYTONA_RUNNER_IMAGE REDIS_IMAGE MINIO_IMAGE DEX_IMAGE
  REGISTRY_IMAGE CADDY_IMAGE CLICKHOUSE_IMAGE ZOOKEEPER_IMAGE SIGNOZ_IMAGE
  SIGNOZ_OTEL_IMAGE
)

failed=0
for name in "${image_vars[@]}"; do
  value="${!name:-}"
  if [[ ! "$value" =~ ^[^[:space:]@]+@sha256:[0-9a-fA-F]{64}$ ]]; then
    echo "$name must be an immutable name:tag@sha256:<64-hex-digest> reference" >&2
    failed=1
  fi
done

if (( failed )); then
  exit 1
fi

echo "Production image references are immutable."
