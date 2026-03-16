#!/usr/bin/env bash

set -euo pipefail

# Deploy the current static build to the preview directory on Pipita.
# Usage:
#   bash scripts/deploy-preview.sh
#   bash scripts/deploy-preview.sh pipita
#   PREVIEW_HOST=pipita PREVIEW_REMOTE_DIR=/srv/data/www/run-preview.nico.ar bash scripts/deploy-preview.sh

PREVIEW_HOST="${1:-${PREVIEW_HOST:-pipita}}"
PREVIEW_REMOTE_DIR="${PREVIEW_REMOTE_DIR:-/srv/data/www/run-preview.nico.ar}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${PROJECT_ROOT}"

if [[ ! -d node_modules ]]; then
  echo "node_modules missing, installing dependencies..."
  npm install
fi

echo "Building static site..."
npm run build

echo "Ensuring preview directory exists on ${PREVIEW_HOST}:${PREVIEW_REMOTE_DIR}"
ssh "${PREVIEW_HOST}" "mkdir -p '${PREVIEW_REMOTE_DIR}'"

echo "Syncing dist/ to ${PREVIEW_HOST}:${PREVIEW_REMOTE_DIR}"
rsync -avz --delete dist/ "${PREVIEW_HOST}:${PREVIEW_REMOTE_DIR}/"

echo "Preview deploy finished."
