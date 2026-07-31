#!/usr/bin/env bash
# Start e2ebuddy local Web UI for page debugging.
# Usage:
#   ./run-web.sh              # http://127.0.0.1:6558  (API + built UI)
#   ./run-web.sh --dev        # Vite HMR :5173 + API :6558
#   ./run-web.sh --no-open
#   ./run-web.sh --port 6558

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

DEV=0
OPEN=1
HOST=127.0.0.1
PORT=6558
EXTRA=()

while (($# > 0)); do
  case "$1" in
    --dev) DEV=1; shift ;;
    --no-open) OPEN=0; shift ;;
    --host) HOST="${2:?}"; shift 2 ;;
    --port) PORT="${2:?}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
./run-web.sh [--dev] [--no-open] [--host 127.0.0.1] [--port 6558]

  (default)  Single process: e2ebuddy web  →  http://127.0.0.1:6558
  --dev      Vite UI with HMR on :5173, API still on --port (default 6558)
EOF
      exit 0
      ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

need_build=0
[[ -f packages/cli/dist/cli.js ]] || need_build=1
[[ -f packages/cli/web/index.html || -f apps/local-web/dist/index.html ]] || need_build=1
if [[ "$need_build" -eq 1 ]]; then
  echo "==> building local-web + cli"
  pnpm --filter local-web build
  pnpm --filter e2ebuddy build
fi

if [[ "$DEV" -eq 1 ]]; then
  echo "==> API:  http://${HOST}:${PORT}/"
  echo "==> UI:   http://127.0.0.1:5173/  (Vite HMR, proxies /api → :${PORT})"
  # start API without opening browser
  pnpm -F e2ebuddy exec node dist/cli.js web --host "$HOST" --port "$PORT" --no-open &
  API_PID=$!
  cleanup() { kill "$API_PID" 2>/dev/null || true; }
  trap cleanup EXIT INT TERM
  sleep 1
  if [[ "$OPEN" -eq 1 ]] && command -v open >/dev/null 2>&1; then
    (sleep 1.5 && open "http://127.0.0.1:5173/") &
  fi
  pnpm --filter local-web dev -- --host 127.0.0.1 --port 5173
  exit 0
fi

ARGS=(web --host "$HOST" --port "$PORT")
if [[ "$OPEN" -eq 0 ]]; then
  ARGS+=(--no-open)
fi
ARGS+=("${EXTRA[@]+"${EXTRA[@]}"}")

echo "==> Web UI: http://${HOST}:${PORT}/"
echo "==> stop with Ctrl+C"
pnpm -F e2ebuddy exec node dist/cli.js "${ARGS[@]}"
