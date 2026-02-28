#!/usr/bin/env bash
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="arc-window-mode-daemon.service"
UNIT_PATH="$UNIT_DIR/$UNIT_NAME"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl_not_found"
  exit 1
fi

systemctl --user disable --now "$UNIT_NAME" >/dev/null 2>&1 || true
rm -f "$UNIT_PATH"
systemctl --user daemon-reload
systemctl --user reset-failed >/dev/null 2>&1 || true

echo "removed: $UNIT_PATH"
echo "disabled: $UNIT_NAME"

