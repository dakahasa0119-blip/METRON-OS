#!/usr/bin/env bash
set -euo pipefail

PKG="${PKG:-com.arc}"
MARGIN="${MARGIN:-24}"
SAFE_TOP="${SAFE_TOP:-56}"
SAFE_BOTTOM="${SAFE_BOTTOM:-40}"
MIN_W="${MIN_W:-980}"
MIN_H="${MIN_H:-760}"
MAX_W="${MAX_W:-1700}"
MAX_H="${MAX_H:-1160}"
W_RATIO="${W_RATIO:-86}"   # percent
H_RATIO="${H_RATIO:-88}"   # percent

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
    echo "restore_arc_window_normal: display_size_unavailable"
    exit 1
  fi

  local tid
  tid="$(find_task_id)"
  if [[ -z "$tid" ]]; then
    echo "restore_arc_window_normal: task_not_found"
    exit 2
  fi

  local w h l t r b
  w="$(calc_dim "$sw" "$W_RATIO" "$MIN_W" "$MAX_W")"
  h="$(calc_dim "$sh" "$H_RATIO" "$MIN_H" "$MAX_H")"

  l=$(( (sw - w) / 2 ))
  t=$(( (sh - h) / 2 ))
  if (( l < MARGIN )); then l="$MARGIN"; fi
  if (( t < SAFE_TOP )); then t="$SAFE_TOP"; fi

  r=$(( l + w ))
  b=$(( t + h ))

  local max_r=$(( sw - MARGIN ))
  local max_b=$(( sh - SAFE_BOTTOM ))
  if (( r > max_r )); then
    r="$max_r"
    l=$(( r - w ))
  fi
  if (( b > max_b )); then
    b="$max_b"
    t=$(( b - h ))
  fi

  if (( l < 0 )); then l=0; fi
  if (( t < 0 )); then t=0; fi

  adb shell cmd activity task resizeable "$tid" 3 >/dev/null 2>&1 || true
  adb shell cmd activity task resize "$tid" "$l" "$t" "$r" "$b"
  echo "restore_arc_window_normal: task=$tid bounds=${l},${t},${r},${b} display=${sw}x${sh}"
}

main "$@"
