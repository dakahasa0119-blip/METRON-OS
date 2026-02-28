#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-10}"
RECOVER_MODE="${2:-on}"
TARGET_TAG="${3:-#chatgpt}"
SLEEP_BETWEEN_SEC="${SLEEP_BETWEEN_SEC:-0}"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
E2E_SCRIPT="$ROOT_DIR/scripts/e2e_request_arc.sh"

if [ ! -x "$E2E_SCRIPT" ]; then
  echo "missing executable: $E2E_SCRIPT"
  exit 1
fi

GAS_XML="$(adb shell run-as com.arc cat shared_prefs/arc_settings.xml)"
BASE_URL="$(printf '%s' "$GAS_XML" | sed -n 's|.*<string name="gas_url">\(.*\)</string>.*|\1|p' | head -n1)"
AUTH="$(printf '%s' "$GAS_XML" | sed -n 's|.*<string name="auth_token">\(.*\)</string>.*|\1|p' | head -n1)"

if [ -z "${BASE_URL:-}" ] || [ -z "${AUTH:-}" ]; then
  echo "gas_url/auth_token not found"
  exit 1
fi

ts="$(date +%Y%m%d_%H%M%S)"
out_file="/tmp/soak_gateway_${ts}.log"

pass=0
fail=0
dead=0
arc_error=0
arc_done=0
route_fresh=0
route_recent=0
route_empty=0
timeout_err=0

probe_final_by_jobid() {
  local job_id="$1"
  local result=""
  [ -z "${job_id:-}" ] && return 0
  for _ in 1 2 3 4 5; do
    local probe
    probe="$(curl -sS -L -m 25 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_job_probe\",\"job_id\":\"${job_id}\",\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" || true)"
    if [ -n "${probe:-}" ]; then
      result="$(printf '%s' "$probe" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)
job=(j.get("job") or {}).get("status_value","")
main=(j.get("main_chat") or {}).get("status","")
if str(main)=="ARC_DONE":
    print("ARC_DONE")
elif str(main)=="ARC_ERROR":
    print("ARC_ERROR")
elif str(job)=="dead":
    print("JOB_DEAD")
elif str(job)=="done":
    print("JOB_DONE")
elif str(job)=="error":
    print("JOB_ERROR")
else:
    print("")
')"
      if [ -n "$result" ]; then
        printf '%s' "$result"
        return 0
      fi
    fi
    sleep 2
  done
  return 0
}

echo "runs=$RUNS target=$TARGET_TAG recover=$RECOVER_MODE"
echo "log=$out_file"
echo "=== SOAK START $(date '+%F %T') ===" | tee -a "$out_file"

for n in $(seq 1 "$RUNS"); do
  echo "--- RUN $n ---" | tee -a "$out_file"
  OUT="$(
    ROUTE_MAX_ATTEMPTS="${ROUTE_MAX_ATTEMPTS:-14}" \
    ROUTE_RETRY_SEC="${ROUTE_RETRY_SEC:-1}" \
    POLL_FAST_COUNT="${POLL_FAST_COUNT:-8}" \
    POLL_FAST_SEC="${POLL_FAST_SEC:-2}" \
    POLL_SLOW_COUNT="${POLL_SLOW_COUNT:-10}" \
    POLL_SLOW_SEC="${POLL_SLOW_SEC:-4}" \
    TERMINAL_GRACE_POLLS="${TERMINAL_GRACE_POLLS:-2}" \
    E2E_MAX_WAIT_SEC="${E2E_MAX_WAIT_SEC:-180}" \
    E2E_SKIP_LOGCAT="${E2E_SKIP_LOGCAT:-1}" \
    "$E2E_SCRIPT" "$BASE_URL" "$AUTH" "$RECOVER_MODE" "$TARGET_TAG" || true
  )"
  printf '%s\n' "$OUT" >> "$out_file"

  final="$(printf '%s\n' "$OUT" | sed -n 's/^FINAL=//p' | tail -n1)"
  job_id="$(printf '%s\n' "$OUT" | sed -n 's/^job_id=//p' | tail -n1)"
  [ -z "$final" ] && final="UNKNOWN"
  if [ "$final" = "UNKNOWN" ] || [ "$final" = "TIMEOUT" ]; then
    probed="$(probe_final_by_jobid "$job_id" || true)"
    if [ -n "${probed:-}" ]; then
      final="$probed"
    fi
  fi

  if printf '%s\n' "$OUT" | grep -q '"source":"fresh"'; then route_fresh=$((route_fresh+1)); fi
  if printf '%s\n' "$OUT" | grep -q '"source":"recent"'; then route_recent=$((route_recent+1)); fi
  if printf '%s\n' "$OUT" | grep -q '"source":"empty"'; then route_empty=$((route_empty+1)); fi
  if printf '%s\n' "$OUT" | grep -q 'LEASE_EXPIRE_MAX\|PENDING_TIMEOUT'; then timeout_err=$((timeout_err+1)); fi

  case "$final" in
    ARC_DONE)
      pass=$((pass+1))
      arc_done=$((arc_done+1))
      ;;
    JOB_DEAD)
      fail=$((fail+1))
      dead=$((dead+1))
      ;;
    ARC_ERROR)
      fail=$((fail+1))
      arc_error=$((arc_error+1))
      ;;
    *)
      fail=$((fail+1))
      ;;
  esac

  echo "run=$n final=$final pass=$pass fail=$fail" | tee -a "$out_file"
  sleep "$SLEEP_BETWEEN_SEC"
done

echo "=== SOAK SUMMARY $(date '+%F %T') ===" | tee -a "$out_file"
echo "pass=$pass fail=$fail arc_done=$arc_done arc_error=$arc_error dead=$dead timeout_err_runs=$timeout_err" | tee -a "$out_file"
echo "route_source fresh=$route_fresh recent=$route_recent empty=$route_empty" | tee -a "$out_file"

admin_json="$(
  curl -sS -L -m 30 -H "Content-Type: application/json" \
    -d "{\"mode\":\"admin_status\",\"auth_key\":\"$AUTH\"}" \
    "$BASE_URL" || true
)"
if [ -n "$admin_json" ]; then
  echo "$admin_json" > "/tmp/soak_gateway_admin_${ts}.json"
  printf '%s\n' "$admin_json" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
except Exception:
    print("admin_status_parse_error")
    raise SystemExit(0)
m=j.get("metrics") or {}
print("admin.gateway_version", j.get("gateway_version"))
print("admin.lease_timeout_sec", j.get("lease_timeout_sec"))
print("admin.pending_timeout_sec", j.get("pending_timeout_sec"))
print("admin.done_rate_recent", m.get("done_rate_recent"))
print("admin.timeout_rate_recent", m.get("timeout_rate_recent"))
print("admin.compact_saved_rows_recent", m.get("compact_saved_rows_recent"))
'
fi

echo "soak_log=$out_file"
