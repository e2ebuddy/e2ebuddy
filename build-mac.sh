#!/usr/bin/env bash
#
# 打包 macOS 发布物（e2ebuddy）— 用法对齐 AICore ADE build-dmg.sh。
#
# e2ebuddy 是 Node CLI + 本地 Web（非 Electron）。本脚本在 macOS 上：
#   构建 monorepo → 校验 → smoke → npm pack → release/
#
# 用法:
#   ./build-mac.sh              # 本机架构（默认 mac）
#   ./build-mac.sh mac          # 同上
#   ./build-mac.sh x64          # Intel 标签
#   ./build-mac.sh arm64        # Apple Silicon 标签
#   ./build-mac.sh all          # x64 + arm64 各打一套 buildinfo / stamp
#
# 版本（写回 packages/cli/package.json）:
#   ./build-mac.sh arm64 --keep
#   ./build-mac.sh arm64 --bump
#   ./build-mac.sh arm64 --set 0.2.0
#
# 可选:
#   ./build-mac.sh x64 --skip-build
#   ./build-mac.sh x64 --skip-smoke
#
# 产物: release/
#   e2ebuddy-<version>.tgz
#   e2ebuddy-<version>-mac-<arch>.tgz
#   e2ebuddy-<version>-mac-<arch>-buildinfo.json
#
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
用法: ./build-mac.sh [mac|x64|arm64|all] [版本选项] [--skip-build] [--skip-smoke]

  mac      本机架构（默认）
  x64      Intel macOS 标签
  arm64    Apple Silicon 标签
  all      x64 + arm64

版本选项:
  --keep         保持 packages/cli 版本不变
  --bump         patch +1
  --set <ver>    指定版本（如 --set 0.2.0）

产物: release/e2ebuddy-*.tgz + *-buildinfo.json
EOF
}

TARGET="${1:-mac}"
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

if [[ "$(uname -s)" != "Darwin" ]]; then
  err "macOS 打包需要在 macOS 上运行（对齐 ADE build-dmg.sh）"
  exit 1
fi

pack() {
  if ((${#VERSION_ARGS[@]} > 0)) || ((${#EXTRA_ARGS[@]} > 0)); then
    node scripts/pack.mjs "$@" ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
  else
    node scripts/pack.mjs "$@"
  fi
}

info "开始打包: mac ${TARGET}"

case "$TARGET" in
  mac)
    pack --mac
    ;;
  x64|intel|amd64)
    pack --mac --x64
    ;;
  arm64|aarch64|m1|m2|m3|apple)
    pack --mac --arm64
    ;;
  all|mac:all|mac-all|both)
    # ADE 风格：两套 arch 标签（tarball 内容相同，buildinfo/stamp 不同）
    pack --mac --x64
    pack --mac --arm64 --skip-build --skip-smoke
    ;;
  *)
    err "未知目标: ${TARGET}"
    usage
    exit 1
    ;;
esac

info "完成。产物见 release/"
ls -la release/ 2>/dev/null || true
