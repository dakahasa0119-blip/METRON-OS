#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/modules/gas_projects.json"

if ! command -v clasp >/dev/null 2>&1; then
  echo "clasp is required. Install: npm i -g @google/clasp"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required. Install jq to parse $MANIFEST"
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "manifest not found: $MANIFEST"
  exit 1
fi

mkdir -p "$ROOT_DIR/modules/gas"

count="$(jq '.projects | length' "$MANIFEST")"
for i in $(seq 0 $((count - 1))); do
  name="$(jq -r ".projects[$i].name" "$MANIFEST")"
  script_id="$(jq -r ".projects[$i].scriptId" "$MANIFEST")"
  local_dir_rel="$(jq -r ".projects[$i].localDir" "$MANIFEST")"
  local_dir="$ROOT_DIR/$local_dir_rel"

  mkdir -p "$local_dir"
  if [ -f "$local_dir/.clasp.json" ]; then
    echo "[skip] $name already initialized: $local_dir"
    continue
  fi

  echo "[clone] $name -> $local_dir"
  (
    cd "$local_dir"
    clasp clone "$script_id" --rootDir .
  )
done

echo "done: GAS modules bootstrap complete"
