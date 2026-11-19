#!/usr/bin/env bash
set -euo pipefail
umask 077
root="$(cd -- "$(dirname -- "$0")" && pwd)"
browser="${KITCHEN_BROWSER:-firefox}"
dry_run=false
if [[ "${1:-}" == --dry-run ]]; then dry_run=true; elif [[ $# -gt 0 ]]; then exit 2; fi
case "$browser" in
  firefox)
    profile="$HOME/snap/firefox/common/kitchen-display-profile"
    command=(firefox --no-remote --profile "$profile" --kiosk)
    ;;
  chromium)
    profile="$HOME/snap/chromium/common/kitchen-display-kiosk"
    command=(chromium --user-data-dir="$profile" --kiosk --no-first-run --no-default-browser-check --disable-pinch --overscroll-history-navigation=0)
    if [[ "${XDG_SESSION_TYPE:-}" == wayland ]]; then command+=(--ozone-platform=wayland); fi
    ;;
  *) printf 'Unsupported kiosk browser: %s\n' "$browser" >&2; exit 2 ;;
esac
if "$dry_run"; then printf '%q ' "${command[@]}" http://localhost:8090/; printf '\n'; exit 0; fi
mkdir -p "$profile"
chmod 700 "$profile"
if [[ "$browser" == firefox ]]; then python3 "$root/configure-kiosk.py" --profile "$profile" --apply; fi
for attempt in {1..30}; do
  if /usr/bin/curl -fsS http://127.0.0.1:8090/api/status >/dev/null; then
    break
  fi
  sleep 1
done
exec "${command[@]}" http://localhost:8090/
