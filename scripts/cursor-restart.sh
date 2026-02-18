#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5193}"
HOST="${2:-127.0.0.1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Stopping existing Vite servers for ${ROOT_DIR}..."
pkill -f "${ROOT_DIR}/node_modules/.bin/vite" >/dev/null 2>&1 || true
pkill -f "vite --host ${HOST} --port ${PORT}" >/dev/null 2>&1 || true

echo "Clearing Vite cache..."
rm -rf "${ROOT_DIR}/node_modules/.vite"

echo "Starting app on http://${HOST}:${PORT}/ ..."
cd "${ROOT_DIR}"
npm run dev -- --host "${HOST}" --port "${PORT}" --strictPort
