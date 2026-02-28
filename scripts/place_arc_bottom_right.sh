#!/usr/bin/env bash
set -euo pipefail

PKG="${PKG:-com.arc}"
MARGIN="${MARGIN:-4}"
SAFE_RIGHT="${SAFE_RIGHT:-120}"
SAFE_BOTTOM="${SAFE_BOTTOM:-48}"
MIN_W="${MIN_W:-240}"
MIN_H="${MIN_H:-300}"
MAX_W="${MAX_W:-380}"
MAX_H="${MAX_H:-520}"
W_RATIO="${W_RATIO:-19}"   # percent
H_RATIO="${H_RATIO:-30}"   # percent

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
    echo "place_arc_bottom_right: display_size_unavailable"
    exit 1
  fi

  local tid
  tid="$(find_task_id)"
  if [[ -z "$tid" ]]; then
    echo "place_arc_bottom_right: task_not_found"
    exit 2
  fi

  local w h l t r b
  w="$(calc_dim "$sw" "$W_RATIO" "$MIN_W" "$MAX_W")"
  h="$(calc_dim "$sh" "$H_RATIO" "$MIN_H" "$MAX_H")"

  l=$(( sw - w - MARGIN - SAFE_RIGHT ))
  t=$(( sh - h - MARGIN - SAFE_BOTTOM ))
  if (( l < 0 )); then l=0; fi
  if (( t < 0 )); then t=0; fi
  r=$(( l + w ))
  b=$(( t + h ))

  adb shell cmd activity task resizeable "$tid" 3 >/dev/null 2>&1 || true
  adb shell cmd activity task resize "$tid" "$l" "$t" "$r" "$b"
  echo "place_arc_bottom_right: task=$tid bounds=${l},${t},${r},${b} display=${sw}x${sh}"
}

main "$@"
