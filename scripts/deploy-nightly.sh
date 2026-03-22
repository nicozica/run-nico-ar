#!/usr/bin/env bash

set -Eeuo pipefail

# Rebuild and deploy the public site using the latest already-exported local data.
# This script is intended for a nightly systemd timer on Pipa.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-pipita}"
DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/srv/data/www/run.nico.ar}"
LOCK_FILE="${LOCK_FILE:-${PROJECT_ROOT}/.deploy/locks/nightly-deploy.lock}"
LOG_DIR="${LOG_DIR:-${PROJECT_ROOT}/.deploy/logs/nightly}"

mkdir -p "$(dirname "${LOCK_FILE}")" "${LOG_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another nightly deploy is already running."
  exit 75
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
log_file="${LOG_DIR}/${timestamp}.log"
touch "${log_file}"
ln -sfn "$(basename "${log_file}")" "${LOG_DIR}/latest.log"

exec > >(tee -a "${log_file}") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting nightly run-nico-ar deploy."
echo "Project root: ${PROJECT_ROOT}"
echo "Deploy target: ${DEPLOY_HOST}:${DEPLOY_REMOTE_DIR}"

cd "${PROJECT_ROOT}"

if [[ ! -d node_modules ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing dependencies..."
  npm install
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Building site..."
npm run build

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ensuring remote directory exists..."
ssh "${DEPLOY_HOST}" "mkdir -p '${DEPLOY_REMOTE_DIR}'"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Syncing dist/..."
rsync -avz --delete dist/ "${DEPLOY_HOST}:${DEPLOY_REMOTE_DIR}/"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Nightly deploy finished."
