#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GW_FILE="${1:-/home/dakahasa0119/my-gas-project/ARC_Gateway_doPost.gs}"
if [ ! -f "$GW_FILE" ]; then
  GW_FILE="$ROOT_DIR/gateway/ARC_Gateway_doPost.gs"
fi
if [ ! -f "$GW_FILE" ]; then
  echo "gateway file not found"
  exit 2
fi

python3 - "$ROOT_DIR" "$GW_FILE" <<'PY'
import re, sys, pathlib

root = pathlib.Path(sys.argv[1])
gw_file = pathlib.Path(sys.argv[2])
gw = gw_file.read_text(encoding="utf-8", errors="ignore")

gateway_modes = set(re.findall(r'mode\s*===\s*"([^"]+)"', gw))
gateway_modes.update(re.findall(r'"([a-z0-9_]+)"', "\n".join(re.findall(r'const\s+authRequiredModes\s*=\s*\[(.*?)\];', gw, re.S))))

arc_modes = set()
gc_file = root / "app/src/main/java/com/arc/GatewayClient.kt"
if gc_file.exists():
    text = gc_file.read_text(encoding="utf-8", errors="ignore")
    arc_modes.update(re.findall(r'put\(\s*"mode"\s*,\s*"([^"]+)"\s*\)', text))

for sh in (root / "scripts").glob("*.sh"):
    t = sh.read_text(encoding="utf-8", errors="ignore")
    arc_modes.update(re.findall(r'"mode"\s*:\s*"([^"]+)"', t))

missing_in_gateway = sorted(m for m in arc_modes if m and m not in gateway_modes)
unused_gateway = sorted(m for m in gateway_modes if m and m not in arc_modes)

print(f"gateway_file={gw_file}")
print(f"gateway_modes={len(gateway_modes)} arc_modes={len(arc_modes)}")
print("missing_in_gateway:")
for m in missing_in_gateway:
    print(f"  - {m}")
print("unused_gateway_sample:")
for m in unused_gateway[:30]:
    print(f"  - {m}")

if missing_in_gateway:
    sys.exit(1)
PY
