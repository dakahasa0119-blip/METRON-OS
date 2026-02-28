#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${PKG:-com.arc}"
PID_FILE="${PID_FILE:-/tmp/arc_window_mode_daemon.pid}"
LOG_FILE="${LOG_FILE:-/tmp/arc_window_mode_daemon.log}"
POLL_SEC="${POLL_SEC:-2}"
ADB_TIMEOUT_SEC="${ADB_TIMEOUT_SEC:-6}"

run_adb() {
  timeout "${ADB_TIMEOUT_SEC}s" adb "$@" 2>/dev/null || true
}

read_headless_mode() {
  local xml
  xml="$(run_adb shell run-as "$PKG" cat shared_prefs/arc_settings.xml)"
  xml="${xml//$'\r'/}"
  if [[ "$xml" == *'name="headless_mode" value="true"'* ]]; then
    echo "ops"
    return
  fi
  if [[ "$xml" == *'name="headless_mode" value="false"'* ]]; then
    echo "debug"
    return
  fi
  echo ""
}

apply_mode() {
  local mode="$1"
  if [[ "$mode" == "ops" ]]; then
    "$ROOT_DIR/scripts/place_arc_ops_stealth.sh" >>"$LOG_FILE" 2>&1 || true
  elif [[ "$mode" == "debug" ]]; then
    "$ROOT_DIR/scripts/restore_arc_window_normal.sh" >>"$LOG_FILE" 2>&1 || true
  fi
}

run_loop() {
  local last_mode=""
  echo "[$(date '+%F %T')] daemon_start poll=${POLL_SEC}s" >>"$LOG_FILE"
  while true; do
    if [[ "$(run_adb get-state)" != "device" ]]; then
      sleep "$POLL_SEC"
      continue
    fi
    local mode
    mode="$(read_headless_mode)"
    if [[ -n "$mode" && "$mode" != "$last_mode" ]]; then
      echo "[$(date '+%F %T')] mode_change ${last_mode:-none} -> $mode" >>"$LOG_FILE"
      apply_mode "$mode"
      last_mode="$mode"
    fi
    sleep "$POLL_SEC"
  done
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  rm -f "$PID_FILE"
  return 1
}

start_daemon() {
  if is_running; then
    echo "arc_window_mode_daemon: already_running pid=$(cat "$PID_FILE")"
    return 0
  fi
  nohup bash -c "exec \"$0\" run" >/dev/null 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"
  echo "arc_window_mode_daemon: started pid=$pid log=$LOG_FILE"
}

stop_daemon() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "arc_window_mode_daemon: not_running"
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "arc_window_mode_daemon: stopped pid=$pid"
}

status_daemon() {
  if is_running; then
    echo "arc_window_mode_daemon: running pid=$(cat "$PID_FILE") log=$LOG_FILE"
  else
    echo "arc_window_mode_daemon: stopped"
  fi
}

cmd="${1:-start}"
case "$cmd" in
  run)
    while true; do
      run_loop || true
      echo "[$(date '+%F %T')] daemon_restart_after_unexpected_exit" >>"$LOG_FILE"
      sleep 1
    done
    ;;
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  restart)
    stop_daemon
    start_daemon
    ;;
  status)
    status_daemon
    ;;
  *)
    echo "usage: $0 [start|stop|restart|status|run]"
    exit 1
    ;;
esac
