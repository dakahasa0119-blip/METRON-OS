#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/arc_window_mode_daemon.sh"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="arc-window-mode-daemon.service"
UNIT_PATH="$UNIT_DIR/$UNIT_NAME"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl_not_found"
  exit 1
fi

mkdir -p "$UNIT_DIR"

cat >"$UNIT_PATH" <<EOF
[Unit]
Description=ARC Window Mode Daemon
After=default.target

[Service]
Type=simple
ExecStart=$SCRIPT_PATH run
Restart=always
RestartSec=2
Environment=PKG=com.arc
Environment=POLL_SEC=2
Environment=ADB_TIMEOUT_SEC=6

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
systemctl --user status "$UNIT_NAME" --no-pager || true

echo "installed: $UNIT_PATH"
echo "enabled: $UNIT_NAME"

