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

jget() {
  local expr="$1"
  node -e '
    const fs = require("fs");
    let raw = "";
    try { raw = fs.readFileSync(0, "utf8"); } catch (_) {}
    let j = {};
    try { j = JSON.parse(raw || "{}"); } catch (_) {}
    let out = "";
    try {
      const v = Function("j", "return " + process.argv[1])(j);
      if (v === null || v === undefined) out = "";
      else if (typeof v === "object") out = JSON.stringify(v);
      else out = String(v);
    } catch (_) {
      out = "";
    }
    process.stdout.write(out);
  ' "$expr"
}

mission_id="ERR_REQ_$(date +%s%3N)"
user_text="#arc #target:error_sim_target /request_arc Simulate Error Pipeline"

echo "Requesting error simulated deployment: $mission_id"
submit_body="$(printf '{"mode":"submit_chat","mission_id":"%s","user":"E2E_SIM_ERR","content":"%s"}' "$mission_id" "$user_text")"
post_json "$submit_body"

echo ""
echo "Polling for Job Lease on GEMINI target (since app deployment routing)..."

job_id=""
for i in {1..10}; do
  route_body="$(printf '{"mode":"route_chat","auth_key":"%s","lease_sec":45,"recent_sec":180,"strict_fresh":"true","target":"chatgpt","worker_id":"fake-error-worker"}' "$ARC_AUTH_KEY")"
  route_resp="$(post_json "$route_body")"
  status="$(printf '%s' "$route_resp" | jget 'j.status')"
  
  if [[ "$status" == "ok" ]]; then
     job_id="$(printf '%s' "$route_resp" | jget 'j.details && j.details[0] ? (j.details[0].jobId || "") : ""')"
     if [[ -n "$job_id" && "$job_id" != "undefined" ]]; then
         echo "Acquired Job ID: $job_id"
         break
     fi
  fi
  sleep 4
done

if [[ -z "$job_id" ]]; then
   echo "Failed to lease a job."
   exit 1
fi

echo "Sending SENT status..."
post_json "$(printf '{"mode":"sent","qid":"%s"}' "$job_id")"

echo "Sending Error Result..."
result_text="E2E_RESULT_ERROR simulated failure"
result_body="$(printf '{"mode":"arc_result","auth_key":"%s","qid":"%s","target":"chatgpt","prompt":"simulated failure","text":"%s","is_error":"true","worker_id":"fake-error-worker"}' "$ARC_AUTH_KEY" "$job_id" "$result_text")"
post_json "$result_body"

echo ""
echo "Polling admin status verification..."

for i in {1..5}; do
  probe_resp="$(post_json "$(printf '{"mode":"admin_job_probe","auth_key":"%s","job_id":"%s"}' "$ARC_AUTH_KEY" "$job_id")")"
  status="$(printf '%s' "$probe_resp" | jget 'j.job ? (j.job.status_value || "") : ""')"
  echo "Job Status: $status"
  if [[ "$status" == "error" || "$status" == "pending" ]]; then
      echo "Verified fallback handling. Final Status: $status"
      exit 0
  fi
  sleep 5
done

echo "Failed to verify error fallback state."
exit 1
