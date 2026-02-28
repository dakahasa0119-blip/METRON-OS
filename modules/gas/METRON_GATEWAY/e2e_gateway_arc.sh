#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOYMENT_ID="${1:-AKfycbyTZSv_X625o7T27_hQQ6eP_BztvrBDLx6kU_8cVLcmbvjWnhNYGFA2e8Wo7E0m7A}"
BASE_URL="https://script.google.com/macros/s/${DEPLOYMENT_ID}/exec"
ARC_AUTH_KEY="${ARC_AUTH_KEY:-${2:-}}"
E2E_TIMEOUT_SEC="${E2E_TIMEOUT_SEC:-120}"
E2E_TARGET="${E2E_TARGET:-chatgpt}"

POLL_MIN_SEC=1
POLL_MAX_SEC=4

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

now_iso() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

try_load_arc_auth_from_device() {
  if [[ -n "${ARC_AUTH_KEY:-}" ]]; then
    return 0
  fi
  if ! command -v adb >/dev/null 2>&1; then
    return 0
  fi
  local token
  token="$(adb shell run-as com.arc cat shared_prefs/arc_settings.xml 2>/dev/null | sed -n 's|.*<string name="auth_token">\(.*\)</string>.*|\1|p' | head -n 1 || true)"
  token="$(printf '%s' "$token" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  if [[ -n "$token" ]]; then
    ARC_AUTH_KEY="$token"
    echo "[auth] loaded ARC_AUTH_KEY from connected ARC device"
  fi
}

require_ok_status() {
  local name="$1"
  local json="$2"
  local status
  status="$(printf '%s' "$json" | jget 'j.status')"
  if [[ "$status" != "ok" ]]; then
    echo "[$name] failed: status=$status"
    echo "$json"
    exit 1
  fi
}

mission_id="E2E_REQ_$(date +%s%3N)"
user_text="#arc E2E gateway/arc flow test $(date +%H:%M:%S)"

try_load_arc_auth_from_device

echo "[0/8] handshake"
handshake_resp="$(post_json '{"mode":"handshake"}')"
require_ok_status "handshake" "$handshake_resp"

echo "[1/8] submit_chat mission=${mission_id}"
submit_body="$(printf '{"mode":"submit_chat","mission_id":"%s","user":"E2E","content":"%s"}' "$mission_id" "$user_text")"
submit_resp="$(post_json "$submit_body")"
require_ok_status "submit_chat" "$submit_resp"

echo "[2/8] route_chat (lease)"
if [[ -n "$ARC_AUTH_KEY" ]]; then
  route_body="$(printf '{"mode":"route_chat","auth_key":"%s","lease_sec":45,"recent_sec":180,"strict_fresh":"true","target":"%s"}' "$ARC_AUTH_KEY" "$E2E_TARGET")"
else
  route_body="$(printf '{"mode":"route_chat","lease_sec":45,"recent_sec":180,"strict_fresh":"true","target":"%s"}' "$E2E_TARGET")"
fi
route_resp="$(post_json "$route_body")"
route_status="$(printf '%s' "$route_resp" | jget 'j.status')"
if [[ "$route_status" != "ok" ]]; then
  route_error="$(printf '%s' "$route_resp" | jget 'j.error')"
  if [[ -z "$ARC_AUTH_KEY" && "$route_error" == "unauthorized" ]]; then
    echo "  route_chat unauthorized (ARC_AUTH_KEY not set) -> limited health mode"
    echo "[8/8] summary"
    echo "  mission_id: $mission_id"
    echo "  final:      limited_health_only"
    echo "e2e: PASS (limited; set ARC_AUTH_KEY for full arc simulation)"
    exit 0
  fi
  echo "[route_chat] failed: status=$route_status error=${route_error:-unknown}"
  echo "$route_resp"
  exit 1
fi
job_id="$(printf '%s' "$route_resp" | jget 'j.details && j.details[0] ? (j.details[0].jobId || "") : ""')"
if [[ -z "$job_id" ]]; then
  job_id="$mission_id"
fi
echo "  job_id=$job_id"

if [[ -n "$ARC_AUTH_KEY" ]]; then
  echo "[3/8] arc_heartbeat (auth)"
  hb_body="$(printf '{"mode":"arc_heartbeat","auth_key":"%s","worker_id":"e2e-runner","status":"online","target":"%s","lease_sec":45,"prefer_recent":"true","hud_tail":"E2E"}' "$ARC_AUTH_KEY" "$E2E_TARGET")"
  hb_resp="$(post_json "$hb_body")"
  hb_status="$(printf '%s' "$hb_resp" | jget 'j.status')"
  if [[ "$hb_status" != "ok" ]]; then
    echo "  warning: arc_heartbeat status=$hb_status"
    echo "  payload: $hb_resp"
  fi

  echo "[4/8] sent + arc_result (auth)"
  sent_resp="$(post_json "$(printf '{"mode":"sent","qid":"%s"}' "$job_id")")"
  sent_status="$(printf '%s' "$sent_resp" | jget 'j.status')"
  if [[ "$sent_status" != "ok" ]]; then
    echo "  warning: sent status=$sent_status"
    echo "  payload: $sent_resp"
  fi

  result_text="E2E_RESULT_OK $(now_iso)"
  result_body="$(printf '{"mode":"arc_result","auth_key":"%s","qid":"%s","target":"%s","prompt":"%s","text":"%s"}' "$ARC_AUTH_KEY" "$job_id" "$E2E_TARGET" "$user_text" "$result_text")"
  result_resp="$(post_json "$result_body")"
  result_status="$(printf '%s' "$result_resp" | jget 'j.status')"
  if [[ "$result_status" != "ok" ]]; then
    echo "  warning: arc_result status=$result_status"
    echo "  payload: $result_resp"
  fi
else
  echo "[3-4/8] skip arc_* simulation (ARC_AUTH_KEY is not set)"
fi

echo "[5/8] poll admin_job_probe (adaptive)"
start_ts="$(date +%s)"
last_sig=""
poll_sec="$POLL_MIN_SEC"
final_state=""
final_main=""

while true; do
  now_ts="$(date +%s)"
  elapsed=$((now_ts - start_ts))
  if (( elapsed > E2E_TIMEOUT_SEC )); then
    break
  fi

  if [[ -n "$ARC_AUTH_KEY" ]]; then
    probe_resp="$(post_json "$(printf '{"mode":"admin_job_probe","auth_key":"%s","job_id":"%s"}' "$ARC_AUTH_KEY" "$job_id")")"
  else
    probe_resp="$(post_json "$(printf '{"mode":"admin_job_probe","job_id":"%s"}' "$job_id")")"
  fi
  probe_status="$(printf '%s' "$probe_resp" | jget 'j.status')"
  if [[ "$probe_status" != "ok" ]]; then
    echo "  probe status=$probe_status"
    sleep "$poll_sec"
    continue
  fi

  job_state="$(printf '%s' "$probe_resp" | jget 'j.job ? (j.job.status_value || "") : ""')"
  main_state="$(printf '%s' "$probe_resp" | jget 'j.main_chat ? (j.main_chat.status || "") : ""')"
  main_resp="$(printf '%s' "$probe_resp" | jget 'j.main_chat ? (j.main_chat.response || "") : ""')"

  sig="${job_state}|${main_state}|${main_resp}"
  if [[ "$sig" != "$last_sig" ]]; then
    echo "  t=${elapsed}s job=${job_state:-?} main=${main_state:-?}"
    last_sig="$sig"
    poll_sec="$POLL_MIN_SEC"
  else
    if (( poll_sec < POLL_MAX_SEC )); then
      poll_sec=$((poll_sec + 1))
    fi
  fi

  final_state="$job_state"
  final_main="$main_state"

  if [[ "$job_state" == "done" || "$job_state" == "error" || "$main_state" == "ARC_DONE" || "$main_state" == "ARC_ERROR" ]]; then
    break
  fi

  sleep "$poll_sec"
done

echo "[6/8] admin_mission_timing"
if [[ -n "$ARC_AUTH_KEY" ]]; then
  timing_resp="$(post_json "$(printf '{"mode":"admin_mission_timing","auth_key":"%s","mission_id":"%s"}' "$ARC_AUTH_KEY" "$job_id")")"
else
  timing_resp="$(post_json "$(printf '{"mode":"admin_mission_timing","mission_id":"%s"}' "$job_id")")"
fi
timing_status="$(printf '%s' "$timing_resp" | jget 'j.status')"
if [[ "$timing_status" != "ok" ]]; then
  echo "  warning: admin_mission_timing status=$timing_status"
fi

echo "[7/8] admin_status"
if [[ -n "$ARC_AUTH_KEY" ]]; then
  queue_resp="$(post_json "$(printf '{"mode":"admin_status","auth_key":"%s"}' "$ARC_AUTH_KEY")")"
else
  queue_resp="$(post_json '{"mode":"admin_status"}')"
fi
queue_status="$(printf '%s' "$queue_resp" | jget 'j.status')"
if [[ "$queue_status" != "ok" ]]; then
  echo "  warning: admin_status status=$queue_status"
fi

echo "[8/8] summary"
echo "  mission_id: $mission_id"
echo "  job_id:     $job_id"
echo "  final_job:  ${final_state:-unknown}"
echo "  final_main: ${final_main:-unknown}"
echo "  jobs:       $(printf '%s' "$queue_resp" | jget 'JSON.stringify(j.jobs||{})')"
echo "  lease_sec:  $(printf '%s' "$queue_resp" | jget 'j.lease_timeout_sec')"
if [[ "$timing_status" == "ok" ]]; then
  echo "  timing:     $(printf '%s' "$timing_resp" | jget 'JSON.stringify(j.timing||{})')"
fi

if [[ -n "$ARC_AUTH_KEY" ]]; then
  if [[ "$final_main" == "ARC_DONE" || "$final_state" == "done" ]]; then
    echo "e2e: PASS (full arc simulation)"
    exit 0
  fi
  echo "e2e: FAIL (full arc simulation did not reach done)"
  exit 2
fi

if [[ "$final_state" == "leased" || "$final_state" == "pending" || "$final_state" == "done" || "$final_main" == "QUEUED_ARC" || "$final_main" == "LEASED_ARC" || "$final_main" == "ARC_DONE" ]]; then
  echo "e2e: PASS (gateway path; arc simulation skipped)"
  exit 0
fi

echo "e2e: FAIL (gateway path unexpected state)"
exit 2
