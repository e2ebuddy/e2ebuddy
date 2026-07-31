#!/usr/bin/env bash
#
# 打包 Linux 发布物（e2ebuddy）— 对齐 ADE pack --linux 入口习惯。
#
# 用法:
#   ./build-linux.sh              # 默认 x64
#   ./build-linux.sh x64
#   ./build-linux.sh arm64
#   ./build-linux.sh all
#   ./build-linux.sh x64 --skip-build
#
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
用法: ./build-linux.sh [x64|arm64|all] [版本选项] [--skip-build] [--skip-smoke]

版本选项: --keep / --bump / --set <ver>
产物: release/
EOF
}

TARGET="${1:-x64}"
if [[ "$TARGET" == "-h" || "$TARGET" == "--help" || "$TARGET" == "help" ]]; then
  usage
  exit 0
fi
if (($# > 0)); then
  shift
fi

EXTRA_ARGS=()
VERSION_ARGS=()
while (($# > 0)); do
  case "$1" in
    --keep|--bump)
      VERSION_ARGS+=("$1")
      shift
      ;;
    --set|--version)
      VERSION_ARGS+=("$1" "${2:-}")
      shift 2
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

info() { echo "[e2ebuddy] $*"; }
err()  { echo "[e2ebuddy] ERROR: $*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
  err "Linux 打包需要在 Linux 上运行"
  exit 1
fi

pack() {
  if ((${#VERSION_ARGS[@]} > 0)) || ((${#EXTRA_ARGS[@]} > 0)); then
    node scripts/pack.mjs "$@" ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  else
    node scripts/pack.mjs "$@"
  fi
}

info "开始打包: linux ${TARGET}"

case "$TARGET" in
  linux|x64|amd64)
    pack --linux --x64
    ;;
  arm64|aarch64)
    pack --linux --arm64
    ;;
  all)
    pack --linux --x64
    pack --linux --arm64 --skip-build --skip-smoke
    ;;
  *)
    err "未知目标: ${TARGET}"
    usage
    exit 1
    ;;
esac

info "完成。产物见 release/"
ls -la release/ 2>/dev/null || true
