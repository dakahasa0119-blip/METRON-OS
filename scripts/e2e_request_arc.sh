#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:?usage: e2e_request_arc.sh <base_url> <auth_key> [recover_mode] [target_tag]}"
AUTH="${2:?usage: e2e_request_arc.sh <base_url> <auth_key> [recover_mode] [target_tag]}"
RECOVER_MODE="${3:-off}" # off|on
TARGET_TAG="${4:-#chatgpt}"
ROUTE_MAX_ATTEMPTS="${ROUTE_MAX_ATTEMPTS:-36}"
ROUTE_RETRY_SEC="${ROUTE_RETRY_SEC:-5}"
POLL_FAST_COUNT="${POLL_FAST_COUNT:-20}"
POLL_FAST_SEC="${POLL_FAST_SEC:-6}"
POLL_SLOW_COUNT="${POLL_SLOW_COUNT:-18}"
POLL_SLOW_SEC="${POLL_SLOW_SEC:-10}"
TERMINAL_GRACE_POLLS="${TERMINAL_GRACE_POLLS:-3}"
TAG="E2E_REQ_$(date +%H%M%S)"
PROMPT="@arc ${TARGET_TAG} ${TAG} 受信したら『${TAG} OK』のみ返答してください"

echo "TAG=$TAG"
adb logcat -c >/dev/null 2>&1 || true

curl -sS -L -m 20 -H "Content-Type: application/json" \
  -d "{\"mode\":\"submit_chat\",\"user\":\"AUTO_E2E\",\"content\":\"${PROMPT}\",\"auth_key\":\"${AUTH}\"}" \
  "$BASE_URL"
echo
sleep 2
route_res=""
job_id=""
for r in $(seq 1 "$ROUTE_MAX_ATTEMPTS"); do
  route_res="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"route_chat\",\"auth_key\":\"${AUTH}\"}" \
    "$BASE_URL" || true)"
  if [ -z "${route_res:-}" ]; then
    echo "[route $r] timeout_or_empty"
    sleep "$ROUTE_RETRY_SEC"
    continue
  fi
  echo "[route $r] $route_res"
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
  if [ -z "${job_id:-}" ]; then
    probe_res="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_chat_probe\",\"query\":\"${TAG}\",\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" || true)"
    job_id="$(printf '%s' "$probe_res" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
    row=j.get("row") or {}
    print(str(row.get("mission_id","")).strip())
except Exception:
    pass
')"
    if [ -n "${job_id:-}" ]; then
      echo "[route $r] chat_probe_hit mission_id=$job_id"
    fi
  fi
  if [ -n "${job_id:-}" ]; then
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
total_polls=$((POLL_FAST_COUNT + POLL_SLOW_COUNT))
for i in $(seq 1 "$total_polls"); do
  if [ "$i" -le "$POLL_FAST_COUNT" ]; then
    sleep "$POLL_FAST_SEC"
  else
    sleep "$POLL_SLOW_SEC"
  fi
  probe="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"admin_job_probe\",\"job_id\":\"${job_id}\",\"auth_key\":\"${AUTH}\"}" \
    "$BASE_URL")"

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
    echo "[poll $i] probe=parse_error"
    continue
  fi
  echo "[poll $i] job=${job_status:-unknown} main=${main_status:-unknown} mission=${mission:-}"
  if [ -n "${response:-}" ]; then
    echo "  response=$response"
  fi

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

  if [ "$RECOVER_MODE" = "on" ]; then
    curl -sS -L -m 20 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_recover_queues\",\"scope\":\"both\",\"leased_min_sec\":30,\"pending_min_sec\":60,\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" >/dev/null || true
  fi
done

pid="$(adb shell pidof com.arc || true)"
echo "--- ARC logs ---"
if [ -n "$pid" ]; then
  adb logcat --pid="$pid" -d | grep -E "ARC_GW_INSTR|ARC_GW_HB|TIMEOUT_FAILOVER|RESULT_SEND_FAIL|MISSION OK|SCREEN_BLOCKED|WATCHDOG_TIMEOUT" | tail -n 120 || true
fi

if [ -z "$final_status" ]; then
  echo "FINAL=TIMEOUT"
else
  echo "FINAL=$final_status"
fi
