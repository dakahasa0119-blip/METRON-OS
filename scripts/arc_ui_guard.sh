#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/arc_ui_guard.sh main
#   ./scripts/arc_ui_guard.sh settings
#
# What it does:
# 1) Ensures ARC screen target (MainActivity / SettingsActivity)
# 2) Dumps UI XML for machine checks
# 3) Captures screenshot (png + base64) as evidence

TARGET="${1:-main}"
PKG="com.arc"

ensure_activity() {
  local act="$1"
  adb shell am start -n "${PKG}/${act}" >/dev/null
  sleep 1
}

if [[ "$TARGET" == "main" ]]; then
  ensure_activity ".MainActivity"
elif [[ "$TARGET" == "settings" ]]; then
  # SettingsActivity is not exported; enter via Main -> settings button tap.
  ensure_activity ".MainActivity"
  adb shell input tap 486 990 >/dev/null || true
  sleep 1
else
  echo "Unknown target: $TARGET" >&2
  exit 1
fi

TOP="$(adb shell dumpsys activity activities | grep -E 'topResumedActivity=' | tail -n 1 || true)"
echo "top: ${TOP:-unknown}"

adb shell uiautomator dump /sdcard/ui_guard.xml >/dev/null
adb shell cat /sdcard/ui_guard.xml > /tmp/arc_ui_guard.xml
adb exec-out screencap -p > /tmp/arc_ui_guard.png
base64 /tmp/arc_ui_guard.png > /tmp/arc_ui_guard.b64

echo "saved: /tmp/arc_ui_guard.xml"
echo "saved: /tmp/arc_ui_guard.png"
echo "saved: /tmp/arc_ui_guard.b64"
