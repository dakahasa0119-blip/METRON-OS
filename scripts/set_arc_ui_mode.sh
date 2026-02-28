#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
if [[ -z "$MODE" ]]; then
  echo "usage: $0 [ops|debug]"
  exit 1
fi

MODE_LC="$(echo "$MODE" | tr '[:upper:]' '[:lower:]')"
if [[ "$MODE_LC" != "ops" && "$MODE_LC" != "debug" ]]; then
  echo "invalid mode: $MODE (use ops|debug)"
  exit 2
fi

PKG="com.arc"
ACT="com.arc.MainActivity"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

adb exec-out run-as "$PKG" cat shared_prefs/arc_settings.xml > /tmp/arc_settings.xml

if [[ "$MODE_LC" == "ops" ]]; then
  sed -i 's/name="headless_mode" value="false"/name="headless_mode" value="true"/g; s/name="compact_corner_mode" value="false"/name="compact_corner_mode" value="true"/g' /tmp/arc_settings.xml
else
  sed -i 's/name="headless_mode" value="true"/name="headless_mode" value="false"/g; s/name="compact_corner_mode" value="true"/name="compact_corner_mode" value="false"/g' /tmp/arc_settings.xml
fi

adb push /tmp/arc_settings.xml /data/local/tmp/arc_settings.xml >/dev/null
adb shell run-as "$PKG" cp /data/local/tmp/arc_settings.xml shared_prefs/arc_settings.xml
adb shell am force-stop "$PKG"
adb shell am start -n "$PKG/$ACT" >/dev/null
sleep 1

if [[ "$MODE_LC" == "ops" ]]; then
  "$ROOT_DIR/scripts/place_arc_ops_stealth.sh" || true
else
  "$ROOT_DIR/scripts/restore_arc_window_normal.sh" || true
fi

echo "set_arc_ui_mode: $MODE_LC"
