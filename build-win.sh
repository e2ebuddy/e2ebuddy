#!/usr/bin/env bash
#
# 打包 Windows 发布物（e2ebuddy）。建议在 Windows 上运行（Git Bash / MSYS2）。
# 用法对齐 AICore ADE build-win.sh。
#
# 用法:
#   ./build-win.sh              # 默认 x64
#   ./build-win.sh x64
#   ./build-win.sh arm64
#   ./build-win.sh all
#   ./build-win.sh x64 --skip-build
#
# 版本:
#   ./build-win.sh x64 --keep
#   ./build-win.sh x64 --bump
#   ./build-win.sh x64 --set 0.2.0
#
# 产物: release/e2ebuddy-*.tgz + *-win-*-buildinfo.json
#
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
用法: ./build-win.sh [x64|arm64|all] [版本选项] [--skip-build] [--skip-smoke]

  x64      Windows x64（默认）
  arm64    Windows ARM64 标签
  all      x64 + arm64

版本选项:
  --keep / --bump / --set <ver>

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

# Git Bash on Windows reports MINGW/MSYS; pack.mjs checks process.platform === win32
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    ;;
  *)
    if [[ "$(uname -s)" != "Darwin" && "$(uname -s)" != "Linux" ]]; then
      :
    fi
    # Allow running only when Node reports win32; soft-check here for pure bash hosts
    if ! node -e "process.exit(process.platform==='win32'?0:1)" 2>/dev/null; then
      err "Windows 打包需要在 Windows 上运行（对齐 ADE build-win.sh）"
      exit 1
    fi
    ;;
esac

pack() {
  if ((${#VERSION_ARGS[@]} > 0)) || ((${#EXTRA_ARGS[@]} > 0)); then
    node scripts/pack.mjs "$@" ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  else
    node scripts/pack.mjs "$@"
  fi
}

info "开始打包: win ${TARGET}"

case "$TARGET" in
  win|x64|intel|amd64)
    pack --win --x64
    ;;
  arm64|aarch64)
    pack --win --arm64
    ;;
  all)
    pack --win --x64
    pack --win --arm64 --skip-build --skip-smoke
    ;;
  *)
    err "未知目标: ${TARGET}"
    usage
    exit 1
    ;;
esac

info "完成。产物见 release/"
ls -la release/ 2>/dev/null || true
