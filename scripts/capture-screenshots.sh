#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base="${BASE_URL:-http://localhost:8082}"
out="$root/screenshots"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

mkdir -p "$out"

shot() {
  "$chrome" --headless --disable-gpu --hide-scrollbars \
    --window-size="$2" --virtual-time-budget=5000 \
    --screenshot="$out/$1.png" "$3" >/dev/null 2>&1
  echo "  $1.png"
}

echo "Capturing from $base"
shot 1-search-form 1280,900 "$base/orders/orders-by-date"
shot 2-query-results 1280,1200 "$base/orders/orders-by-date/results?start=2023-01-06&end=2023-02-28"
shot 3-order-detail 1280,1250 "$base/orders/show/10100?format=html"
shot 4-filtered-results 1280,900 "$base/orders/orders-by-date/results?start=2023-01-06&end=2025-05-31&customer=Diecast&status=Shipped"

ls -lh "$out" | tail -n +2 | awk '{print "  "$9" "$5}'
