#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.autosave.pid"
LOG_FILE="$ROOT_DIR/.autosave.log"
INTERVAL_SECONDS="${AUTOSAVE_INTERVAL_SECONDS:-300}"

is_running() {
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
  else
    return 1
  fi
}

start_daemon() {
  if is_running; then
    echo "autosave daemon already running (pid $(cat "$PID_FILE"))"
    exit 0
  fi

  (
    cd "$ROOT_DIR"
    while true; do
      "$ROOT_DIR/scripts/autosave_snapshot.sh" >>"$LOG_FILE" 2>&1 || true
      sleep "$INTERVAL_SECONDS"
    done
  ) &

  echo $! > "$PID_FILE"
  echo "autosave daemon started (pid $(cat "$PID_FILE"), interval ${INTERVAL_SECONDS}s)"
}

stop_daemon() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "autosave daemon is not running"
    exit 0
  fi
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "autosave daemon stopped"
}

status_daemon() {
  if is_running; then
    echo "running (pid $(cat "$PID_FILE"))"
  else
    echo "stopped"
  fi
}

case "${1:-}" in
  start) start_daemon ;;
  stop) stop_daemon ;;
  restart) stop_daemon; start_daemon ;;
  status) status_daemon ;;
  once) cd "$ROOT_DIR"; "$ROOT_DIR/scripts/autosave_snapshot.sh" ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|once}" >&2
    exit 1
    ;;
esac
