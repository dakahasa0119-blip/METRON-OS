#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d .git ]; then
  echo "[autosave] .git not found in $ROOT_DIR" >&2
  exit 1
fi

# Skip when there is nothing to save.
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  exit 0
fi

git add -A
if git diff --cached --quiet; then
  exit 0
fi

ts="$(date -Iseconds)"
git commit -m "autosave: $ts" --no-gpg-sign >/dev/null
printf '[autosave] committed at %s\n' "$ts"
