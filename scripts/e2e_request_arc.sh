#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?usage: e2e_request_arc.sh <base_url> <auth_key> [recover_mode] [target_tag]}"
AUTH="${2:?usage: e2e_request_arc.sh <base_url> <auth_key> [recover_mode] [target_tag]}"
RECOVER_MODE="${3:-off}" # off|on
TARGET_TAG="${4:-#chatgpt}"
ROUTE_MAX_ATTEMPTS="${ROUTE_MAX_ATTEMPTS:-36}"
ROUTE_RETRY_SEC="${ROUTE_RETRY_SEC:-1}"
POLL_FAST_COUNT="${POLL_FAST_COUNT:-20}"
POLL_FAST_SEC="${POLL_FAST_SEC:-2}"
POLL_SLOW_COUNT="${POLL_SLOW_COUNT:-18}"
POLL_SLOW_SEC="${POLL_SLOW_SEC:-4}"
TERMINAL_GRACE_POLLS="${TERMINAL_GRACE_POLLS:-3}"
E2E_MAX_WAIT_SEC="${E2E_MAX_WAIT_SEC:-180}"
E2E_SKIP_LOGCAT="${E2E_SKIP_LOGCAT:-0}"
TAG="E2E_REQ_$(date +%H%M%S)"
PROMPT="@arc ${TARGET_TAG} ${TAG} 受信したら『${TAG} OK』のみ返答してください"

adb_quick() {
  timeout 8s adb "$@" >/dev/null 2>&1 || true
}

echo "TAG=$TAG"
adb_quick logcat -c

curl -sS -L -m 20 -H "Content-Type: application/json" \
  -d "{\"mode\":\"submit_chat\",\"user\":\"AUTO_E2E\",\"content\":\"${PROMPT}\",\"auth_key\":\"${AUTH}\"}" \
  "$BASE_URL"
echo
sleep 2
route_res=""
job_id=""
for r in $(seq 1 "$ROUTE_MAX_ATTEMPTS"); do
  route_res="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"route_chat\",\"auth_key\":\"${AUTH}\",\"strict_fresh\":\"true\"}" \
    "$BASE_URL" || true)"
  if [ -z "${route_res:-}" ]; then
    echo "[route $r] timeout_or_empty"
    sleep "$ROUTE_RETRY_SEC"
    continue
  fi
  if printf '%s' "$route_res" | grep -qi "<!DOCTYPE html>"; then
    echo "[route $r] gateway_html_error"
    exit 2
  fi
  echo "[route $r] $route_res"
  route_source="$(printf '%s' "$route_res" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
    print(str(j.get("source","")).strip())
except Exception:
    pass
')"
  job_id="$(printf '%s' "$route_res" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
    d=j.get("details") or []
    if d and isinstance(d, list) and isinstance(d[0], dict):
        print(str(d[0].get("jobId","")).strip())
except Exception:
    pass
')"
  probe_res="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"admin_chat_probe\",\"query\":\"${TAG}\",\"auth_key\":\"${AUTH}\"}" \
    "$BASE_URL" || true)"
  probe_job_id="$(printf '%s' "$probe_res" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
    row=j.get("row") or {}
    print(str(row.get("mission_id","")).strip())
except Exception:
    pass
')"
  if [ -n "${probe_job_id:-}" ]; then
    if [ -z "${job_id:-}" ]; then
      job_id="$probe_job_id"
      echo "[route $r] chat_probe_hit mission_id=$job_id"
    else
      echo "[route $r] chat_probe_seen mission_id=$probe_job_id (ignored; keeping route job_id=$job_id)"
    fi
  fi
  if [ -n "${job_id:-}" ] && [ "${route_source:-}" = "fresh" ]; then
    break
  fi
  if [ -n "${job_id:-}" ] && [ "$r" -ge 2 ]; then
    break
  fi
  sleep "$ROUTE_RETRY_SEC"
done
if [ -z "${job_id:-}" ]; then
  echo "job_id_not_found_from_route_chat"
  exit 1
fi
echo "job_id=$job_id"

final_status=""
terminal_seen=0
poll_idx=0
elapsed_sec=0
last_job_status=""
last_main_status=""
while [ "$elapsed_sec" -le "$E2E_MAX_WAIT_SEC" ]; do
  poll_idx=$((poll_idx + 1))
  sleep_sec="$POLL_SLOW_SEC"
  if [ "$poll_idx" -le "$POLL_FAST_COUNT" ]; then
    sleep_sec="$POLL_FAST_SEC"
  fi
  if [ "${last_job_status:-}" = "pending" ] || [ "${last_job_status:-}" = "leased" ] || [ "${last_main_status:-}" = "QUEUED_ARC" ]; then
    sleep_sec=1
  fi
  sleep "$sleep_sec"
  elapsed_sec=$((elapsed_sec + sleep_sec))
  probe="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"admin_job_probe\",\"job_id\":\"${job_id}\",\"auth_key\":\"${AUTH}\"}" \
    "$BASE_URL" || true)"
  if [ -z "${probe:-}" ]; then
    echo "[poll $poll_idx] probe=empty"
    continue
  fi
  if printf '%s' "$probe" | grep -qi "<!DOCTYPE html>"; then
    echo "[poll $poll_idx] gateway_html_error"
    final_status="GATEWAY_HTML_ERROR"
    break
  fi

  parsed="$(printf '%s' "$probe" | python3 -c '
import json, sys
raw = sys.stdin.read()
try:
    j = json.loads(raw)
except Exception:
    print("parse_error\t\t\t\t")
    sys.exit(0)
job = j.get("job") or {}
main = j.get("main_chat") or {}
job_status = str(job.get("status_value",""))
main_status = str(main.get("status",""))
mission = str(main.get("mission_id","") or job.get("job_id",""))
response = str(main.get("response","")).replace("\n", " ")[:180]
print(f"ok\t{job_status}\t{main_status}\t{mission}\t{response}")
')"

  IFS=$'\t' read -r kind job_status main_status mission response <<<"$parsed"
  if [ "$kind" = "parse_error" ]; then
    echo "[poll $poll_idx] probe=parse_error"
    continue
  fi
  echo "[poll $poll_idx] job=${job_status:-unknown} main=${main_status:-unknown} mission=${mission:-}"
  if [ -n "${response:-}" ]; then
    echo "  response=$response"
  fi
  last_job_status="${job_status:-}"
  last_main_status="${main_status:-}"

  if [ "${main_status:-}" = "ARC_DONE" ]; then
    final_status="$main_status"
    break
  fi
  if [ "${main_status:-}" = "ARC_ERROR" ] && { [ "${job_status:-}" = "error" ] || [ "${job_status:-}" = "dead" ] || [ "${job_status:-}" = "done" ]; }; then
    terminal_seen=$((terminal_seen + 1))
    if [ "$terminal_seen" -ge "$TERMINAL_GRACE_POLLS" ]; then
      final_status="$main_status"
      break
    fi
  fi
  if [ "${job_status:-}" = "done" ] || [ "${job_status:-}" = "error" ] || [ "${job_status:-}" = "dead" ]; then
    terminal_seen=$((terminal_seen + 1))
    if [ "$terminal_seen" -ge "$TERMINAL_GRACE_POLLS" ]; then
      final_status="JOB_${job_status^^}"
      break
    fi
  else
    terminal_seen=0
  fi

  if [ "$RECOVER_MODE" = "on" ] && [ "$elapsed_sec" -ge 90 ] && { [ "${job_status:-}" = "leased" ] || [ "${main_status:-}" = "QUEUED_ARC" ]; }; then
    curl -sS -L -m 20 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_recover_queues\",\"scope\":\"both\",\"leased_min_sec\":45,\"pending_min_sec\":180,\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" >/dev/null || true
  fi
done

pid="$(timeout 8s adb shell pidof com.arc 2>/dev/null || true)"
if [ "$E2E_SKIP_LOGCAT" != "1" ]; then
  echo "--- ARC logs ---"
  if [ -n "$pid" ]; then
    timeout 10s adb logcat --pid="$pid" -d 2>/dev/null | grep -E "ARC_GW_INSTR|ARC_GW_HB|TIMEOUT_FAILOVER|RESULT_SEND_FAIL|MISSION OK|SCREEN_BLOCKED|WATCHDOG_TIMEOUT" | tail -n 120 || true
  fi
fi

if [ -z "$final_status" ]; then
  echo "FINAL=TIMEOUT"
else
  echo "FINAL=$final_status"
fi
