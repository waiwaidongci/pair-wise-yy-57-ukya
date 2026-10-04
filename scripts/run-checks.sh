#!/usr/bin/env bash
# 动态排程行为检查：引擎（依赖/独占/资格/增量/冻结）与存储流程（权限/旧数据升级/发布重试）
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  local src="$1"
  local out="${src%.ts}.check.mjs"
  node_modules/.bin/esbuild "$src" --bundle --platform=node --format=esm --outfile="$out" --log-level=error
  node "$out"
  rm -f "$out"
}

run scripts/check-schedule.ts
run scripts/check-store.ts
echo "全部动态排程检查通过"
