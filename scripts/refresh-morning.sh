#!/usr/bin/env bash

set -Eeuo pipefail

# Refresh Strava-backed Pacer exports in the morning and redeploy run.nico.ar.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACER_REPO="${PACER_REPO:-${RUN_REPO}/../pacer}"
LOCK_FILE="${LOCK_FILE:-${RUN_REPO}/.deploy/locks/morning-refresh.lock}"
LOG_DIR="${LOG_DIR:-${RUN_REPO}/.deploy/logs/morning-refresh}"

export DEPLOY_HOST="${DEPLOY_HOST:-pizero}"
export DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/srv/data/www/run.nico.ar}"

mkdir -p "$(dirname "${LOCK_FILE}")" "${LOG_DIR}"

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "Another morning refresh is already running."
  exit 75
fi

timestamp="$(date '+%Y%m%d-%H%M%S')"
log_file="${LOG_DIR}/${timestamp}.log"
touch "${log_file}"
ln -sfn "$(basename "${log_file}")" "${LOG_DIR}/latest.log"

exec > >(tee -a "${log_file}") 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting morning run.nico.ar refresh."
echo "Pacer repo: ${PACER_REPO}"
echo "Run repo: ${RUN_REPO}"
echo "Deploy target: ${DEPLOY_HOST}:${DEPLOY_REMOTE_DIR}"

if [[ ! -d "${PACER_REPO}" ]]; then
  echo "Pacer repo not found at ${PACER_REPO}"
  exit 1
fi

cd "${PACER_REPO}"

if [[ ! -d node_modules ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installing Pacer dependencies..."
  npm install
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fetching latest Strava activities..."
npm run strava:fetch

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Publishing fresh Pacer snapshots..."
npm run sessions:publish

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rebuilding and deploying run.nico.ar..."
cd "${RUN_REPO}"
"${RUN_REPO}/scripts/deploy-nightly.sh"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Morning refresh finished."
