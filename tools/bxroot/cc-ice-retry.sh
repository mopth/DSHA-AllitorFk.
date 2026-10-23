#!/bin/sh
# 只对 GCC 的 internal compiler error 重试的编译器包装器。
#
# 为什么需要它：本项目的构建环境（Ubuntu 24.04 aarch64 原生 gcc-13.3.0-6ubuntu2~24.04.1）
# 存在间歇性 ICE（BUILD_RUNTIME.sh 里已有同类重试）。而 tools/bxroot/build-linux.sh 的
# 重链接循环与 launcher/ulx 编译没有重试，一次 ICE 就会让整条构建失败。
#
# 行为约定：
# - 真语法/链接错误立即返回（重试不会变好，只会掩盖问题）；
# - 只有 stderr 含 "internal compiler error" 才重试；
# - stdout / stderr 原样透传，所以 `2>file` 之类的调用方重定向仍然有效。
#
# 用法：CC=/path/to/cc-ice-retry.sh sh build-linux.sh
set -u
REAL="${BXROOT_REAL_CC:-aarch64-linux-gnu-gcc-13}"
LIMIT="${BXROOT_ICE_RETRIES:-8}"

out=$(mktemp) || exit 1
err=$(mktemp) || exit 1
trap 'rm -f "$out" "$err"' EXIT

try=0
while [ "$try" -lt "$LIMIT" ]; do
  try=$((try + 1))
  "$REAL" "$@" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    cat "$out"
    cat "$err" >&2
    exit 0
  fi
  if grep -q 'internal compiler error' "$err"; then
    printf 'cc-ice-retry: ICE on attempt %s, retrying\n' "$try" >&2
    continue
  fi
  cat "$out"
  cat "$err" >&2
  exit "$rc"
done
cat "$out"
cat "$err" >&2
printf 'cc-ice-retry: still ICE after %s attempts\n' "$try" >&2
exit 1
