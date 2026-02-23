#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOTE_FILE="$ROOT_DIR/docs/CHAT_MEMORY.md"
TS="$(date -Iseconds)"
NOTE="${*:-}"

if [ -z "$NOTE" ]; then
  echo "Usage: $0 <note text>" >&2
  exit 1
fi

if [ ! -f "$NOTE_FILE" ]; then
  cat > "$NOTE_FILE" <<'MD'
# Chat Memory

Session notes that should survive IDE/app crashes.
MD
fi

printf '\n## %s\n- %s\n' "$TS" "$NOTE" >> "$NOTE_FILE"
echo "saved: $NOTE_FILE"
