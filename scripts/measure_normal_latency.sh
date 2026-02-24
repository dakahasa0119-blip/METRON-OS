#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-5}"
TARGET_TAG="${2:-#chatgpt}"
POLL_SEC="${POLL_SEC:-3}"
MAX_WAIT_SEC="${MAX_WAIT_SEC:-180}"

GAS_XML="$(adb shell run-as com.arc cat shared_prefs/arc_settings.xml)"
BASE_URL="$(printf '%s' "$GAS_XML" | sed -n 's|.*<string name="gas_url">\(.*\)</string>.*|\1|p' | head -n1)"
AUTH="$(printf '%s' "$GAS_XML" | sed -n 's|.*<string name="auth_token">\(.*\)</string>.*|\1|p' | head -n1)"

if [ -z "${BASE_URL:-}" ] || [ -z "${AUTH:-}" ]; then
  echo "gas_url/auth_token not found"
  exit 1
fi

echo "runs=$RUNS target=$TARGET_TAG poll=${POLL_SEC}s max_wait=${MAX_WAIT_SEC}s"

results=()

for n in $(seq 1 "$RUNS"); do
  tag="NORM_$(date +%H%M%S)_$n"
  prompt="@arc $TARGET_TAG ${tag} 受信したら「${tag} OK」だけ返答"
  t0="$(date +%s)"

  curl -sS -L -m 20 -H "Content-Type: application/json" \
    -d "{\"mode\":\"submit_chat\",\"user\":\"AUTO_MEASURE\",\"content\":\"${prompt}\",\"auth_key\":\"${AUTH}\"}" \
    "$BASE_URL" >/dev/null

  mission_id=""
  status=""
  response=""
  waited=0

  while [ "$waited" -le "$MAX_WAIT_SEC" ]; do
    chat_probe="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_chat_probe\",\"query\":\"${tag}\",\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" || true)"

    parsed="$(printf '%s' "$chat_probe" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
except Exception:
    print("\t\t")
    raise SystemExit(0)
r=j.get("row") or {}
print(str(r.get("mission_id","")).strip()+"\t"+str(r.get("status","")).strip()+"\t"+str(r.get("response","")).replace("\n"," ")[:120])
')"
    IFS=$'\t' read -r mission_id status response <<<"$parsed"

    if [ -n "${mission_id:-}" ]; then
      if [ "$status" = "ARC_DONE" ] || [ "$status" = "ARC_ERROR" ]; then
        break
      fi
    fi

    sleep "$POLL_SEC"
    waited=$((waited + POLL_SEC))
  done

  t1="$(date +%s)"
  elapsed=$((t1 - t0))
  measured_sec="$elapsed"
  if [ -n "${mission_id:-}" ]; then
    timing_json="$(curl -sS -L -m 20 -H "Content-Type: application/json" \
      -d "{\"mode\":\"admin_mission_timing\",\"mission_id\":\"${mission_id}\",\"auth_key\":\"${AUTH}\"}" \
      "$BASE_URL" || true)"
    measured="$(printf '%s' "$timing_json" | python3 -c '
import json,sys
try:
    j=json.load(sys.stdin)
except Exception:
    print("")
    raise SystemExit(0)
t=j.get("timing") or {}
if t.get("done_latency_sec") is not None:
    print(str(t.get("done_latency_sec")))
elif t.get("error_latency_sec") is not None:
    print(str(t.get("error_latency_sec")))
else:
    print("")
')"
    if [ -n "${measured:-}" ]; then
      measured_sec="$measured"
    fi
  fi
  if [ -z "${mission_id:-}" ]; then
    status="TIMEOUT_NO_MISSION"
  elif [ -z "${status:-}" ]; then
    status="TIMEOUT_UNKNOWN"
  elif [ "$waited" -gt "$MAX_WAIT_SEC" ] && [ "$status" != "ARC_DONE" ] && [ "$status" != "ARC_ERROR" ]; then
    status="TIMEOUT_${status}"
  fi

  echo "run=$n tag=$tag mission=${mission_id:-none} status=$status sec_wall=$elapsed sec_measured=$measured_sec resp=${response:-}"
  results+=("${measured_sec}|${status}")
done

printf '%s\n' "${results[@]}" | python3 -c '
import sys
rows=[x.strip() for x in sys.stdin if x.strip()]
secs=[]
done=0
err=0
other=0
for r in rows:
    s,st=r.split("|",1)
    try: secs.append(int(s))
    except: pass
    if st=="ARC_DONE": done+=1
    elif st=="ARC_ERROR": err+=1
    else: other+=1
secs_sorted=sorted(secs)
def pct(p):
    if not secs_sorted: return None
    idx=max(0,min(len(secs_sorted)-1, int((len(secs_sorted)-1)*p)))
    return secs_sorted[idx]
avg=(sum(secs_sorted)/len(secs_sorted)) if secs_sorted else None
print("summary:")
print(f"  total={len(rows)} done={done} error={err} other={other}")
if secs_sorted:
    print(f"  min={secs_sorted[0]}s p50={pct(0.5)}s p95={pct(0.95)}s max={secs_sorted[-1]}s avg={avg:.1f}s")
'
