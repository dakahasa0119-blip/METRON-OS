#!/usr/bin/env bash
set -euo pipefail

ARC_AUTH_KEY="${ARC_AUTH_KEY:-c522c86a-a11d-487b-a3e1-29c780acd2ae}"
DEPLOYMENT_ID="$1"
BASE_URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"

if [[ -z "$DEPLOYMENT_ID" ]]; then
    echo "Usage: $0 <DEPLOYMENT_ID>"
    exit 1
fi

post_json() {
  local body="$1"
  curl -sS -L -m 30 -H "Content-Type: application/json" -d "$body" "$BASE_URL"
}

mission_id="SIM_REQ_$(date +%s%3N)"
user_text="#arc /request_app_deployment Create a simple weather dashboard app"

echo "Requesting app deployment: $mission_id"
submit_body="$(printf '{"mode":"submit_chat","mission_id":"%s","user":"E2E_SIM","content":"%s"}' "$mission_id" "$user_text")"
post_json "$submit_body"

