#!/usr/bin/env bash
set -euo pipefail

PKG="${PKG:-com.arc}"
VISIBLE_W="${VISIBLE_W:-6}"
VISIBLE_H="${VISIBLE_H:-24}"
MIN_W="${MIN_W:-260}"
MIN_H="${MIN_H:-320}"
MAX_W="${MAX_W:-420}"
MAX_H="${MAX_H:-560}"
W_RATIO="${W_RATIO:-20}"   # percent
H_RATIO="${H_RATIO:-32}"   # percent

get_display_size() {
  local line
  line="$(adb shell wm size 2>/dev/null | tr -d '\r' | grep -m1 'Physical size:' || true)"
  if [[ -z "$line" ]]; then
    echo "0 0"
    return
  fi
  echo "$line" | sed -n 's/.*Physical size: \([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1 \2/p'
}

find_task_id() {
  adb shell dumpsys activity activities 2>/dev/null \
    | tr -d '\r' \
    | sed -n "s/.*Task{[^#]*#\([0-9][0-9]*\).*A=[0-9][0-9]*:${PKG}.*/\1/p" \
    | head -n1
}

calc_dim() {
  local total="$1"
  local ratio="$2"
  local minv="$3"
  local maxv="$4"
  local v=$(( total * ratio / 100 ))
  if (( v < minv )); then v="$minv"; fi
  if (( v > maxv )); then v="$maxv"; fi
  echo "$v"
}

main() {
  read -r sw sh <<<"$(get_display_size)"
  if (( sw <= 0 || sh <= 0 )); then
    echo "place_arc_ops_stealth: display_size_unavailable"
    exit 1
  fi

  local tid
  tid="$(find_task_id)"
  if [[ -z "$tid" ]]; then
    echo "place_arc_ops_stealth: task_not_found"
    exit 2
  fi

  local w h l t r b
  w="$(calc_dim "$sw" "$W_RATIO" "$MIN_W" "$MAX_W")"
  h="$(calc_dim "$sh" "$H_RATIO" "$MIN_H" "$MAX_H")"

  # Fixed minimal layout: keep only a tiny tab visible at right-bottom.
  l=$(( sw - VISIBLE_W ))
  t=$(( sh - VISIBLE_H ))
  r=$(( l + w ))
  b=$(( t + h ))

  adb shell cmd activity task resizeable "$tid" 3 >/dev/null 2>&1 || true
  adb shell cmd activity task resize "$tid" "$l" "$t" "$r" "$b"
  echo "place_arc_ops_stealth: task=$tid bounds=${l},${t},${r},${b} display=${sw}x${sh} visible=${VISIBLE_W}x${VISIBLE_H}"
}

main "$@"
