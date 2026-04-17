#!/usr/bin/env bash
#
# @file build_sidecar.sh
# @description PyInstaller 打包 ghostterm-thesis sidecar binary
#              输出到 ../src-tauri/binaries/ghostterm-thesis-<triple>
# @author Atlas.oi
# @date 2026-04-17
#
set -euo pipefail

cd "$(dirname "$0")"

# 确定当前平台 triple
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)   TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64)  TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)   TRIPLE="x86_64-unknown-linux-gnu" ;;
  *)              echo "unsupported platform" >&2; exit 1 ;;
esac

OUT_DIR="../src-tauri/binaries"
mkdir -p "$OUT_DIR"

uv sync
uv run pyinstaller \
  --onefile \
  --name "ghostterm-thesis-${TRIPLE}" \
  --distpath "$OUT_DIR" \
  --workpath "./build" \
  --specpath "./build" \
  --clean \
  --noconfirm \
  main.py

echo "done: ${OUT_DIR}/ghostterm-thesis-${TRIPLE}"
