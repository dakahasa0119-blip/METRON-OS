#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PKG="com.arc"
ACT="com.arc.MainActivity"
WAIT_SEC="${WAIT_SEC:-120}"
PLACE_BOTTOM_RIGHT="${PLACE_BOTTOM_RIGHT:-auto}"
ENABLE_SYSTEMD_DAEMON="${ENABLE_SYSTEMD_DAEMON:-auto}"


arc_headless_mode() {
  local xml
  xml="$(adb shell run-as "$PKG" cat shared_prefs/arc_settings.xml 2>/dev/null | tr -d '\r' || true)"
  if [[ "$xml" == *'name="headless_mode" value="true"'* ]]; then
    echo "1"
    return
  fi
  if [[ "$xml" == *'name="headless_mode" value="false"'* ]]; then
    echo "0"
    return
  fi
  echo ""
}

should_place_bottom_right() {
  case "$PLACE_BOTTOM_RIGHT" in
    1|true|TRUE|yes|YES) echo "1" ;;
    0|false|FALSE|no|NO) echo "0" ;;
    auto|AUTO|"")
      local hm
      hm="$(arc_headless_mode)"
      if [[ "$hm" == "1" ]]; then
        echo "1"
      else
        echo "0"
      fi
      ;;
    *)
      echo "0"
      ;;
  esac
}

wait_for_device() {
  local deadline=$(( $(date +%s) + WAIT_SEC ))
  while true; do
    if adb get-state 1>/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      echo "device_not_found"
      return 1
    fi
    sleep 2
  done
}

echo "[1/4] build debug apk"
./gradlew :app:assembleDebug --no-daemon

echo "[2/4] wait for adb device (timeout=${WAIT_SEC}s)"
wait_for_device

echo "[3/4] install debug apk"
adb install -r "$ROOT_DIR/app/build/outputs/apk/debug/app-debug.apk"

echo "[4/4] launch app"
adb shell am start -n "$PKG/$ACT"

if [[ "$(should_place_bottom_right)" == "1" ]]; then
  echo "[4.5/4] move window stealth corner (ops mode)"
  sleep 1
  "$ROOT_DIR/scripts/place_arc_ops_stealth.sh" || true
else
  echo "[4.5/4] restore normal window size (debug mode)"
  sleep 1
  "$ROOT_DIR/scripts/restore_arc_window_normal.sh" || true
fi

echo "install_and_launch: DONE"
