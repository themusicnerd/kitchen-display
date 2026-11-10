#!/usr/bin/env bash
set -euo pipefail
profile="$HOME/snap/firefox/common/kitchen-display-profile"
mkdir -p "$profile"
for attempt in {1..30}; do
  if /usr/bin/curl -fsS http://127.0.0.1:8090/api/status >/dev/null; then
    break
  fi
  sleep 1
done
exec firefox --no-remote --profile "$profile" --kiosk http://localhost:8090/
