#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

compute_hash() {
  find src -type f \( -name "*.ts" -o -name "*.d.ts" \) -print0 \
    | sort -z \
    | xargs -0 shasum \
    | shasum \
    | awk '{print $1}'
}

start_server() {
  node --import tsx src/server.ts &
  SERVER_PID=$!
}

stop_server() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

cleanup() {
  stop_server
  exit 0
}

trap cleanup INT TERM EXIT

LAST_HASH="$(compute_hash)"
SERVER_PID=""

echo "[dev-reload] starting backend with hot reload"
start_server

while true; do
  sleep 1

  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[dev-reload] server process exited, restarting..."
    start_server
    LAST_HASH="$(compute_hash)"
    continue
  fi

  NEW_HASH="$(compute_hash)"
  if [[ "$NEW_HASH" != "$LAST_HASH" ]]; then
    echo "[dev-reload] source changed, reloading..."
    LAST_HASH="$NEW_HASH"
    stop_server
    start_server
  fi
done
