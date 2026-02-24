#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.arc_health_watch.pid"
LOG_FILE="$ROOT_DIR/.arc_health_watch.log"
INTERVAL_SECONDS="${ARC_WATCH_INTERVAL_SECONDS:-30}"

PATTERN='JOB_DEAD|WATCHDOG_TIMEOUT|TIMEOUT|lease_expire|max_retry|route_lock_timeout|auth|429|403|network error|failed'

is_running() {
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
  else
    return 1
  fi
}

extract_pref() {
  local key="$1"
  local xml
  xml="$(adb shell run-as com.arc cat shared_prefs/arc_settings.xml 2>/dev/null || true)"
  printf '%s' "$xml" | sed -n "s|.*<string name=\"$key\">\\(.*\\)</string>.*|\\1|p" | head -n 1
}

check_once() {
  local ts device_line gas_url auth_token pid status_json tmp_log anomalies
  local pending_count leased_count recover_json recover_pending recover_leased
  ts="$(date -Iseconds)"
  echo "[$ts] === ARC health check ==="

  device_line="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  if [ -z "${device_line:-}" ]; then
    echo "[$ts] ERROR: adb device not connected"
    return 1
  fi
  echo "[$ts] device=$device_line"

  pid="$(adb shell pidof com.arc 2>/dev/null || true)"
  if [ -z "${pid:-}" ]; then
    echo "[$ts] ERROR: com.arc process not running"
    return 1
  fi
  echo "[$ts] arc_pid=$pid"

  gas_url="$(extract_pref gas_url)"
  auth_token="$(extract_pref auth_token)"
  if [ -z "${gas_url:-}" ] || [ -z "${auth_token:-}" ]; then
    echo "[$ts] ERROR: gas_url/auth_token not found in arc_settings.xml"
    return 1
  fi

  status_json="$(curl -sS -L -m 20 -H 'Content-Type: application/json' \
    -d "{\"mode\":\"admin_status\",\"auth_key\":\"$auth_token\"}" \
    "$gas_url" 2>/dev/null || true)"
  if [ -z "${status_json:-}" ]; then
    echo "[$ts] ERROR: admin_status empty response"
  else
    echo "[$ts] admin_status=$status_json"
    pending_count="$(printf '%s' "$status_json" | sed -n 's|.*"pending":\([0-9][0-9]*\).*|\1|p' | head -n 1)"
    leased_count="$(printf '%s' "$status_json" | sed -n 's|.*"leased":\([0-9][0-9]*\).*|\1|p' | head -n 1)"
    pending_count="${pending_count:-0}"
    leased_count="${leased_count:-0}"
    if [ "$pending_count" -gt 0 ] || [ "$leased_count" -gt 0 ]; then
      recover_json="$(curl -sS -L -m 20 -H 'Content-Type: application/json' \
        -d "{\"mode\":\"admin_recover_queues\",\"scope\":\"both\",\"auth_key\":\"$auth_token\"}" \
        "$gas_url" 2>/dev/null || true)"
      recover_pending="$(printf '%s' "$recover_json" | sed -n 's|.*"pending_recovered":\([0-9][0-9]*\).*|\1|p' | head -n 1)"
      recover_leased="$(printf '%s' "$recover_json" | sed -n 's|.*"leased_recovered":\([0-9][0-9]*\).*|\1|p' | head -n 1)"
      echo "[$ts] auto_recover triggered pending=$pending_count leased=$leased_count recover=$recover_json"
      echo "[$ts] auto_recover_result pending_recovered=${recover_pending:-0} leased_recovered=${recover_leased:-0}"
    fi
  fi

  tmp_log="$(mktemp)"
  adb logcat --pid="$pid" -d | tail -n 250 > "$tmp_log" || true
  anomalies="$(grep -Ein "$PATTERN" "$tmp_log" | tail -n 20 || true)"
  if [ -n "${anomalies:-}" ]; then
    echo "[$ts] anomalies_detected:"
    echo "$anomalies"
  else
    echo "[$ts] anomalies_detected: none"
  fi
  rm -f "$tmp_log"
  echo "[$ts] === done ==="
}

start_daemon() {
  if is_running; then
    echo "arc health watch already running (pid $(cat "$PID_FILE"))"
    exit 0
  fi

  nohup bash -lc '
    set -euo pipefail
    ROOT_DIR="$1"
    LOG_FILE="$2"
    INTERVAL_SECONDS="$3"
    while true; do
      "$ROOT_DIR/scripts/arc_health_watch.sh" once >>"$LOG_FILE" 2>&1 || true
      sleep "$INTERVAL_SECONDS"
    done
  ' _ "$ROOT_DIR" "$LOG_FILE" "$INTERVAL_SECONDS" >/dev/null 2>&1 &

  echo $! > "$PID_FILE"
  echo "arc health watch started (pid $(cat "$PID_FILE"), interval ${INTERVAL_SECONDS}s)"
}

stop_daemon() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "arc health watch is not running"
    return 0
  fi
  pid="$(cat "$PID_FILE")"
  kill "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "arc health watch stopped"
}

status_daemon() {
  if is_running; then
    echo "running (pid $(cat "$PID_FILE"))"
  else
    echo "stopped"
  fi
}

case "${1:-}" in
  once) check_once ;;
  start) start_daemon ;;
  stop) stop_daemon ;;
  restart) stop_daemon; start_daemon ;;
  status) status_daemon ;;
  *)
    echo "Usage: $0 {once|start|stop|restart|status}" >&2
    exit 1
    ;;
esac
