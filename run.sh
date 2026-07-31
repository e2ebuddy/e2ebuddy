#!/usr/bin/env bash
# e2ebuddy local CLI launcher.
# Usage: ./run.sh [setup|cli|demo|help] ...

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

log() { printf '==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
e2ebuddy local runner

CLI + local disk only. No database or queue service is required.

Usage:
  ./run.sh                 Setup (if needed) and show CLI usage
  ./run.sh setup           Install deps, Playwright Chromium, build, prepare .env
  ./run.sh cli <args...>   Run acceptance CLI
  ./run.sh demo            Start local defect fixture (http://127.0.0.1:4173)
  ./run.sh help            Show this help

CLI examples:
  ./run.sh cli executor-demo https://example.com
  ./run.sh cli explore https://example.com --brief "demo site"
  ./run.sh cli test https://example.com --brief "demo site"

  # Local fixture acceptance
  ./run.sh demo
  E2EBUDDY_ALLOW_PRIVATE_TARGETS=true \
  E2EBUDDY_TEST_USERNAME=demo@e2ebuddy.dev \
  E2EBUDDY_TEST_PASSWORD='DemoPass123!' \
  ./run.sh cli test http://127.0.0.1:4173/demo/login \
    --brief "Users can sign in, view the dashboard, create a test run, and log out."

Requirements:
  - Node.js >= 20
  - pnpm (via corepack)
  - AI_API_KEY (or ANTHROPIC_*) in .env for explore / test
  - Screenshots stored under ./storage (local disk)
EOF
}

load_env() {
  if [[ ! -f .env ]]; then
    return 0
  fi
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  # Always use local storage for this launcher.
  export STORAGE_DRIVER=local
  export STORAGE_DIR="${STORAGE_DIR:-./storage}"
}

env_value() {
  local name="$1"
  local line value
  line="$(grep -E "^${name}=" .env 2>/dev/null || true)"
  value="${line#${name}=}"
  value="${value//$'\r'/}"
  if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

set_env_file_value() {
  local name="$1" value="$2" tmp
  tmp="$(mktemp)"
  if [[ -f .env ]]; then
    awk -v name="${name}" -v value="${value}" '
      BEGIN { done=0 }
      $0 ~ ("^" name "=") {
        print name "=" value
        done=1
        next
      }
      { print }
      END { if (!done) print name "=" value }
    ' .env > "${tmp}"
  else
    printf '%s=%s\n' "${name}" "${value}" > "${tmp}"
  fi
  mv "${tmp}" .env
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
      cp .env.example .env
      log "Created .env from .env.example"
    else
      die ".env missing and .env.example not found"
    fi
  fi

  # Pin local-only storage (no object store middleware).
  set_env_file_value STORAGE_DRIVER local
  if [[ -z "$(env_value STORAGE_DIR)" ]]; then
    set_env_file_value STORAGE_DIR ./storage
  fi

  local enc
  enc="$(env_value CREDENTIALS_ENCRYPTION_KEY)"
  if [[ -z "${enc}" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      set_env_file_value CREDENTIALS_ENCRYPTION_KEY "$(openssl rand -base64 32)"
      log "Generated CREDENTIALS_ENCRYPTION_KEY in .env"
    else
      warn "CREDENTIALS_ENCRYPTION_KEY is empty; generate with: openssl rand -base64 32"
    fi
  fi

  load_env
}

require_node() {
  command -v node >/dev/null 2>&1 || die "Node.js is required (need >= 20)"
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "${major}" -lt 20 ]]; then
    die "Node.js >= 20 required (found $(node -v))"
  fi
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  if command -v corepack >/dev/null 2>&1; then
    log "Enabling pnpm via corepack"
    corepack enable
    corepack prepare pnpm@11.8.0 --activate
  fi
  command -v pnpm >/dev/null 2>&1 || die "pnpm not found; install pnpm or enable corepack"
}

warn_ai_key() {
  local key anthropic
  key="$(env_value AI_API_KEY)"
  anthropic="$(env_value ANTHROPIC_API_KEY)"
  if [[ -z "${key}" && -z "${anthropic}" ]]; then
    warn "AI_API_KEY (or ANTHROPIC_API_KEY) is empty — explore/test need a model API key in .env"
  fi
}

ensure_built() {
  if [[ ! -f packages/cli/dist/cli.js ]]; then
    log "Build artifacts missing; building CLI stack"
    pnpm build --filter=e2ebuddy...
  fi
}

cmd_setup() {
  require_node
  ensure_pnpm
  ensure_env_file
  warn_ai_key

  log "Installing dependencies"
  pnpm install

  log "Installing Playwright Chromium"
  pnpm -F executor exec playwright install chromium

  log "Building packages (CLI path only)"
  pnpm build --filter=e2ebuddy...

  mkdir -p "${STORAGE_DIR:-./storage}"

  log "Setup complete (no middleware required)"
  printf '\nReady. Examples:\n'
  printf '  ./run.sh cli executor-demo https://example.com\n'
  printf '  ./run.sh cli explore https://example.com --brief "demo site"\n'
  printf '  ./run.sh cli test https://example.com --brief "demo site"\n'
  printf '  ./run.sh demo\n'
}

cmd_cli() {
  require_node
  ensure_pnpm
  ensure_env_file
  warn_ai_key
  load_env
  ensure_built
  mkdir -p "${STORAGE_DIR:-./storage}"

  if [[ $# -eq 0 ]]; then
    cat <<'EOF'
Usage:
  ./run.sh cli executor-demo <url>
  ./run.sh cli explore <url> [--brief "..."]
  ./run.sh cli test <url> [--brief "..."]
EOF
    exit 1
  fi

  pnpm -F e2ebuddy cli "$@"
}

cmd_demo() {
  require_node
  ensure_pnpm
  ensure_env_file
  load_env

  log "Building fixture and starting demo at http://127.0.0.1:4173"
  pnpm -F fixture build
  log "Demo login: demo@e2ebuddy.dev / DemoPass123!"
  log "Then run:"
  log "  E2EBUDDY_ALLOW_PRIVATE_TARGETS=true \\"
  log "  E2EBUDDY_TEST_USERNAME=demo@e2ebuddy.dev \\"
  log "  E2EBUDDY_TEST_PASSWORD='DemoPass123!' \\"
  log "  ./run.sh cli test http://127.0.0.1:4173/demo/login --brief \"Users can sign in...\""
  pnpm -F fixture start
}

cmd_default() {
  require_node
  ensure_pnpm
  ensure_env_file
  warn_ai_key

  if [[ ! -d node_modules ]] || [[ ! -f packages/cli/dist/cli.js ]]; then
    log "First-time or incomplete install — running setup"
    cmd_setup
    return 0
  fi

  load_env
  mkdir -p "${STORAGE_DIR:-./storage}"

  log "e2ebuddy is ready (local CLI, no middleware)"
  printf '\n  storage: %s\n' "${STORAGE_DIR:-./storage}"
  printf '  AI key:  %s\n' "$(
    if [[ -n "$(env_value AI_API_KEY)" || -n "$(env_value ANTHROPIC_API_KEY)" ]]; then
      printf 'configured'
    else
      printf 'MISSING — edit .env'
    fi
  )"
  printf '\n'
  usage
}

main() {
  local cmd="${1:-}"
  if [[ $# -gt 0 ]]; then
    shift
  fi

  case "${cmd}" in
    '' ) cmd_default ;;
    setup) cmd_setup "$@" ;;
    cli) cmd_cli "$@" ;;
    demo) cmd_demo "$@" ;;
    help|-h|--help) usage ;;
    web|worker|start)
      die "Web/worker mode is not managed by this CLI launcher.
Use CLI instead:
  ./run.sh cli test <url> --brief \"...\"
Or see README for host-based Web/worker setup."
      ;;
    *)
      die "Unknown command: ${cmd}. Run ./run.sh help"
      ;;
  esac
}

main "$@"
